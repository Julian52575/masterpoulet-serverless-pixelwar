const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createNotifier, snapshotMessage } = require("./notifier");
const { OBJECT_FINALIZED } = require("./cloudevent");
const { DiscordApiError } = require("./discord");

const NAME = "snapshots/2026-10-29T12-43-03-572Z_1565345221745573888.png";
const SIGNED = "https://storage.googleapis.com/snaps/snapshots/x.png?X-Goog-Signature=SECRET-SIGNATURE";

const metadata = {
  snapshot_id: "1565345221745573888",
  requested_at: "2026-10-29T12:43:03.572Z",
  requested_by: "999",
  pixel_count: "51",
  application_id: "123456789012345678",
  interaction_token: "secret-token",
  channel_id: "555",
  correlation_id: "corr-snap"
};

function make({ meta = metadata, metadataError, signError, discordError } = {}) {
  const calls = [];
  const files = {
    metadataOf: async (name) => {
      if (metadataError) throw metadataError;
      calls.push({ metadataOf: name });
      return meta;
    },
    signedUrl: async (name, ttl) => {
      if (signError) throw signError;
      calls.push({ signedUrl: { name, ttl } });
      return SIGNED;
    }
  };
  const discord = {
    editOriginal: async (event, message) => {
      if (discordError) throw discordError;
      calls.push({ discord: { event, message } });
    }
  };
  return { handle: createNotifier({ files, discord, bucket: "snaps", ttlMinutes: 60 }), calls };
}

const event = (name = NAME, type = OBJECT_FINALIZED, bucket = "snaps") => [
  { "ce-id": "evt-1", "ce-type": type },
  Buffer.from(JSON.stringify({ bucket, name }))
];

async function captureLogs(fn) {
  const out = mock.method(console, "log", () => {});
  const err = mock.method(console, "error", () => {});
  try {
    const result = await fn();
    const lines = [...out.mock.calls, ...err.mock.calls].map((call) => call.arguments[0]);
    return { result, lines, entries: lines.map((line) => JSON.parse(line)) };
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
}

describe("snapshot notifier", () => {
  test("reads the metadata, signs a one-hour link and edits the Discord reply", async () => {
    const { handle, calls } = make();
    const { result } = await captureLogs(() => handle(...event()));

    assert.equal(result.statusCode, 204);
    assert.deepEqual(calls, [
      { metadataOf: NAME },
      { signedUrl: { name: NAME, ttl: 60 } },
      {
        discord: {
          event: { application_id: "123456789012345678", interaction_token: "secret-token" },
          message: { content: snapshotMessage({ url: SIGNED, requestedAt: metadata.requested_at, pixelCount: "51", ttlMinutes: 60 }) }
        }
      }
    ]);
  });

  test("writes a message with the date, the pixel count, the link and how long it works", () => {
    const text = snapshotMessage({ url: SIGNED, requestedAt: "2026-10-29T12:43:03.572Z", pixelCount: "51", ttlMinutes: 60 });
    assert.equal(text, `📸 Snapshot du 2026-10-29 12:43:03 UTC, 51 pixels : ${SIGNED}\n(lien valable 1 heure)`);
    assert.match(snapshotMessage({ url: "u", requestedAt: "x", pixelCount: "x", ttlMinutes: 90 }), /^📸 Snapshot : u\n\(lien valable 90 minutes\)$/);
    assert.match(snapshotMessage({ url: "u", requestedAt: "x", pixelCount: "1", ttlMinutes: 120 }), /1 pixel : u\n\(lien valable 2 heures\)/);
  });

  test("never writes the signed link or the interaction token to the logs", async () => {
    const { handle } = make();
    const { lines } = await captureLogs(() => handle(...event()));
    const all = lines.join("\n");
    assert.ok(!all.includes("SECRET-SIGNATURE"));
    assert.ok(!all.includes("secret-token"));
    assert.ok(lines.some((l) => JSON.parse(l).message === "snapshot link sent"));
  });

  test("logs the correlation id so the snapshot can be followed from the proxy to Discord", async () => {
    const { handle } = make();
    const { entries } = await captureLogs(() => handle(...event()));
    const sent = entries.find((e) => e.message === "snapshot link sent");
    assert.equal(sent.correlation_id, "corr-snap");
    assert.equal(sent.function, "snapshot-notifier");
  });

  for (const [name, args] of Object.entries({
    "a file outside of snapshots/": event("exports/a.png"),
    "a file that is not a PNG": event("snapshots/a.txt"),
    "another bucket": event(NAME, OBJECT_FINALIZED, "other-bucket"),
    "a deleted object": event(NAME, "google.cloud.storage.object.v1.deleted")
  })) {
    test(`ignores ${name} without touching anything`, async () => {
      const { handle, calls } = make();
      const { result } = await captureLogs(() => handle(...args));
      assert.equal(result.statusCode, 204);
      assert.deepEqual(calls, []);
    });
  }

  test("acks a snapshot that has no Discord interaction to answer", async () => {
    const { handle, calls } = make({ meta: { snapshot_id: "1" } });
    const { result } = await captureLogs(() => handle(...event()));
    assert.equal(result.statusCode, 204);
    assert.equal(calls.length, 1);
  });

  test("answers 400 to a request that is not a storage event", async () => {
    const { handle } = make();
    const { result } = await captureLogs(() => handle({}, Buffer.from("{}")));
    assert.equal(result.statusCode, 400);
  });

  test("asks Eventarc to retry when the metadata cannot be read", async () => {
    const { handle } = make({ metadataError: new Error("503") });
    assert.equal((await captureLogs(() => handle(...event()))).result.statusCode, 500);
  });

  test("asks Eventarc to retry when the link cannot be signed", async () => {
    const { handle } = make({ signError: new Error("Permission iam.serviceAccounts.signBlob denied") });
    const { result, entries } = await captureLogs(() => handle(...event()));
    assert.equal(result.statusCode, 500);
    assert.equal(entries.find((e) => e.message === "snapshot notification failed").severity, "ERROR");
  });

  test("asks Eventarc to retry when Discord is temporarily unavailable", async () => {
    const { handle } = make({ discordError: new DiscordApiError(503, "") });
    assert.equal((await captureLogs(() => handle(...event()))).result.statusCode, 500);
  });

  test("gives up quietly when the interaction token has expired", async () => {
    const { handle } = make({ discordError: new DiscordApiError(404, "Unknown Webhook") });
    const { result, entries } = await captureLogs(() => handle(...event()));
    assert.equal(result.statusCode, 204);
    assert.equal(entries.find((e) => e.message === "could not send the snapshot link to Discord").status, 404);
  });
});
