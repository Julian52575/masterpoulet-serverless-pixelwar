const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createNotifier, snapshotMessage, isPostTime } = require("./notifier");
const { OBJECT_FINALIZED, OBJECT_FINALIZE } = require("./cloudevent");
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

const notification = (name = NAME, eventType = OBJECT_FINALIZE, bucketId = "snaps") => [
  { "content-type": "application/json" },
  Buffer.from(JSON.stringify({
    message: { attributes: { eventType, bucketId, objectId: name, payloadFormat: "NONE" }, data: "", messageId: "msg-1" },
    deliveryAttempt: 2
  }))
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

describe("scheduled snapshots", () => {
  const scheduledMeta = (requestedAt) => ({
    snapshot_id: "scheduled-9",
    requested_at: requestedAt,
    requested_by: "scheduler",
    pixel_count: "12",
    application_id: "",
    interaction_token: "",
    channel_id: "",
    correlation_id: "scheduled-9"
  });

  const manifests = (chain) => {
    const byName = {};
    chain.forEach(([id, at], i) => {
      byName[`manifests/m${i}.json`] = { snapshot_id: id, requested_at: at, previous: i + 1 < chain.length ? `manifests/m${i + 1}.json` : null };
    });
    return byName;
  };

  function makeScheduled({
    requestedAt = "2026-11-13T13:10:01.000Z",
    chain = [["scheduled-9", "2026-11-13T13:10:01.000Z"], ["scheduled-8", "2026-11-13T12:55:01.000Z"]],
    withWebhook = true,
    webhookError,
    readError,
    every = 60
  } = {}) {
    const posts = [];
    const stored = manifests(chain);
    const files = {
      metadataOf: async () => ({ ...scheduledMeta(requestedAt), manifest: "manifests/m0.json" }),
      signedUrl: async () => SIGNED,
      readJson: async (name) => { if (readError) throw readError; return stored[name] ?? null; }
    };
    const discord = { editOriginal: async () => assert.fail("no interaction to edit") };
    const webhook = withWebhook
      ? { post: async (message) => { if (webhookError) throw webhookError; posts.push(message); } }
      : null;
    return { handle: createNotifier({ files, discord, bucket: "snaps", ttlMinutes: 60, webhook, postEveryMinutes: every }), posts };
  }

  test("posts the first scheduled snapshot of each hour in the channel", async () => {
    const { handle, posts } = makeScheduled();
    const { result, lines } = await captureLogs(() => handle(...notification()));

    assert.equal(result.statusCode, 204);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].content, snapshotMessage({
      url: SIGNED, requestedAt: "2026-11-13T13:10:01.000Z", pixelCount: "12", ttlMinutes: 60, title: "🕒 Scheduled snapshot"
    }));
    assert.ok(!lines.join("\n").includes("SECRET-SIGNATURE"));
  });

  test("does not post the other scheduled snapshots of the same hour", async () => {
    const { handle, posts } = makeScheduled({
      requestedAt: "2026-11-13T13:40:01.000Z",
      chain: [["scheduled-9", "2026-11-13T13:40:01.000Z"], ["scheduled-8", "2026-11-13T13:10:01.000Z"]]
    });
    const { result, entries } = await captureLogs(() => handle(...notification()));
    assert.equal(result.statusCode, 204);
    assert.equal(posts.length, 0);
    assert.ok(entries.some((e) => e.message === "scheduled snapshot not posted: already one in this period"));
  });

  test("still posts when only a Discord /snapshot was taken earlier in the hour", async () => {
    const { handle, posts } = makeScheduled({
      requestedAt: "2026-11-13T13:40:01.000Z",
      chain: [["scheduled-9", "2026-11-13T13:40:01.000Z"], ["1300000000000000000", "2026-11-13T13:20:00.000Z"], ["scheduled-7", "2026-11-13T12:50:01.000Z"]]
    });
    await captureLogs(() => handle(...notification()));
    assert.equal(posts.length, 1);
  });

  test("posts the very first snapshot, or the first after a clear (no previous manifest)", async () => {
    const { handle, posts } = makeScheduled({ chain: [["scheduled-9", "2026-11-13T13:10:01.000Z"]] });
    await captureLogs(() => handle(...notification()));
    assert.equal(posts.length, 1);
  });

  test("retries when the manifests cannot be read", async () => {
    const { handle, posts } = makeScheduled({ readError: Object.assign(new Error("503"), { code: 503 }) });
    const { result } = await captureLogs(() => handle(...notification()));
    assert.equal(result.statusCode, 500);
    assert.equal(posts.length, 0);
  });

  test("posts every scheduled snapshot when asked every 5 minutes", async () => {
    const { handle, posts } = makeScheduled({
      requestedAt: "2026-11-13T13:15:01.000Z",
      chain: [["scheduled-9", "2026-11-13T13:15:01.000Z"], ["scheduled-8", "2026-11-13T13:10:01.000Z"]],
      every: 5
    });
    await captureLogs(() => handle(...notification()));
    assert.equal(posts.length, 1);
  });

  test("does nothing without a channel webhook", async () => {
    const { handle } = makeScheduled({ withWebhook: false });
    const { result, entries } = await captureLogs(() => handle(...notification()));
    assert.equal(result.statusCode, 204);
    assert.ok(entries.some((e) => e.message === "scheduled snapshot not posted: no channel webhook configured"));
  });

  test("retries when Discord is overloaded, gives up on a deleted webhook", async () => {
    const retry = makeScheduled({ webhookError: new DiscordApiError(429, "") });
    assert.equal((await captureLogs(() => retry.handle(...notification()))).result.statusCode, 500);
    const gone = makeScheduled({ webhookError: new DiscordApiError(404, "") });
    assert.equal((await captureLogs(() => gone.handle(...notification()))).result.statusCode, 204);
  });

  test("isPostTime is true for the first snapshot of a period", () => {
    assert.equal(isPostTime("2026-11-13T13:00:00.000Z", "2026-11-13T12:59:59.000Z", 60), true);
    assert.equal(isPostTime("2026-11-13T13:59:00.000Z", "2026-11-13T13:00:00.000Z", 60), false);
    assert.equal(isPostTime("2026-11-13T13:30:02.000Z", "2026-11-13T13:25:02.000Z", 30), true);
    assert.equal(isPostTime("2026-11-13T13:30:02.000Z", null, 60), true);
    assert.equal(isPostTime("not a date", null, 60), false);
  });
});

describe("snapshot notifier fed by the bucket's Pub/Sub topic", () => {
  test("sends the signed link exactly as with Eventarc", async () => {
    const { handle, calls } = make();
    const { result, entries } = await captureLogs(() => handle(...notification()));

    assert.equal(result.statusCode, 204);
    assert.deepEqual(calls.map((c) => Object.keys(c)[0]), ["metadataOf", "signedUrl", "discord"]);
    const sent = entries.find((e) => e.message === "snapshot link sent");
    assert.equal(sent.event_source, "pubsub");
    assert.equal(sent.event_id, "msg-1");
    assert.equal(sent.delivery_attempt, 2);
  });

  for (const [label, args] of [
    ["a tile", notification("tiles/0_0/a.png")],
    ["a manifest", notification("manifests/latest.json")],
    ["a deleted snapshot", notification(NAME, "OBJECT_DELETE")],
    ["another bucket", notification(NAME, OBJECT_FINALIZE, "other")]
  ]) {
    test(`acks and ignores ${label}`, async () => {
      const { handle, calls } = make();
      const { result } = await captureLogs(() => handle(...args));
      assert.equal(result.statusCode, 204);
      assert.equal(calls.length, 0);
    });
  }

  test("rejects a malformed notification with 400, so it goes to the dead-letter topic", async () => {
    const { handle } = make();
    const { result } = await captureLogs(() => handle({}, Buffer.from(JSON.stringify({ message: { attributes: {} } }))));
    assert.equal(result.statusCode, 400);
  });
});

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
    assert.equal(text, `📸 Snapshot from 2026-10-29 12:43:03 UTC, 51 pixels: ${SIGNED}\n(link valid for 1 hour)`);
    assert.match(snapshotMessage({ url: "u", requestedAt: "x", pixelCount: "x", ttlMinutes: 90 }), /^📸 Snapshot: u\n\(link valid for 90 minutes\)$/);
    assert.match(snapshotMessage({ url: "u", requestedAt: "x", pixelCount: "1", ttlMinutes: 120 }), /1 pixel: u\n\(link valid for 2 hours\)/);
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
