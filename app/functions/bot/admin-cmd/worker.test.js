const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createWorker } = require("./worker");
const { createAuthorizer } = require("./authz");
const { DiscordApiError } = require("./discord");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

const ADMIN_USER = "999";
const ADMIN_ROLE = "777";
const ADMIN_TYPES = ["admin.pause", "admin.resume", "admin.clear", "admin.ratelimit"];

function push(event, deliveryAttempt = 1) {
  return Buffer.from(JSON.stringify({
    message: { data: encode(event), messageId: "msg-1" },
    subscription: "projects/demo/subscriptions/admin-cmd",
    deliveryAttempt
  }));
}

function make({ handlers, discordError } = {}) {
  const replies = [];
  const discord = {
    editOriginal: async (event, message) => {
      if (discordError) throw discordError;
      replies.push({ event, message });
    }
  };
  const authorizer = createAuthorizer({ adminUserIds: [ADMIN_USER], adminRoleIds: [ADMIN_ROLE] });
  return { handle: createWorker({ handlers, authorizer, discord }), replies };
}

const adminEvent = (type, extra = {}) => ({
  type,
  payload: {},
  user_id: ADMIN_USER,
  roles: [],
  application_id: "123456789012345678",
  interaction_token: "secret-interaction-token",
  interaction_id: "interaction-2",
  correlation_id: "corr-2",
  ...extra
});

const userEvent = (type) => adminEvent(type, { user_id: "111", roles: ["500"] });

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

describe("createWorker routing", () => {
  test("routes an admin's command to the handler of its type and acks with 204", async () => {
    const received = [];
    const { handle } = make({ handlers: { "admin.pause": async (event) => { received.push(event); } } });

    const { result } = await captureLogs(() => handle(push(adminEvent("admin.pause"))));

    assert.equal(result.statusCode, 204);
    assert.deepEqual(received, [adminEvent("admin.pause")]);
  });

  for (const type of ["draw", "web.draw", "get", "snapshot", "hack", "toString"]) {
    test(`rejects ${type} with 400 so it ends up in the DLQ`, async () => {
      const { handle, replies } = make({ handlers: { "admin.pause": async () => {} } });
      const { result } = await captureLogs(() => handle(push(adminEvent(type))));
      assert.equal(result.statusCode, 400);
      assert.equal(replies.length, 0);
    });
  }

  test("rejects a malformed push message with 400", async () => {
    const { handle } = make({ handlers: {} });
    const { result, entries } = await captureLogs(() => handle(Buffer.from("not json")));

    assert.equal(result.statusCode, 400);
    assert.equal(entries[0].message, "invalid pubsub push message");
  });

  test("answers 500 when the handler fails, so Pub/Sub retries", async () => {
    const { handle } = make({ handlers: { "admin.clear": async () => { throw new Error("firestore down"); } } });
    const { result, entries } = await captureLogs(() => handle(push(adminEvent("admin.clear"), 3)));

    assert.equal(result.statusCode, 500);
    const entry = entries.find((e) => e.message === "command failed");
    assert.equal(entry.severity, "ERROR");
    assert.equal(entry.correlation_id, "corr-2");
    assert.equal(entry.delivery_attempt, 3);
  });

  test("logs the received and processed command with the correlation id", async () => {
    const { handle } = make({ handlers: { "admin.pause": async () => {} } });
    const { entries } = await captureLogs(() => handle(push(adminEvent("admin.pause"), 2)));

    const received = entries.find((e) => e.message === "command received");
    assert.equal(received.function, "admin-cmd");
    assert.equal(received.correlation_id, "corr-2");
    assert.equal(received.command, "admin.pause");
    assert.equal(received.message_id, "msg-1");
    assert.equal(received.delivery_attempt, 2);
    assert.ok(entries.some((e) => e.message === "command processed"));
  });

  test("never writes the interaction token to the logs", async () => {
    const { handle } = make({ handlers: { "admin.clear": async () => { throw new Error("boom"); } } });
    const { lines } = await captureLogs(() => handle(push(adminEvent("admin.clear"))));
    assert.ok(!lines.join("\n").includes("secret-interaction-token"));
  });
});

describe("createWorker admin authorization", () => {
  for (const type of ADMIN_TYPES) {
    test(`refuses ${type} to a normal user without running the handler`, async () => {
      const calls = [];
      const { handle, replies } = make({ handlers: { [type]: async () => calls.push(type) } });

      const { result } = await captureLogs(() => handle(push(userEvent(type))));

      assert.equal(result.statusCode, 204);
      assert.deepEqual(calls, []);
      assert.equal(replies.length, 1);
      assert.match(replies[0].message.content, /for administrators only/);
    });
  }

  test("logs a WARNING with the user and the correlation id when refusing", async () => {
    const { handle } = make({ handlers: { "admin.clear": async () => {} } });
    const { entries } = await captureLogs(() => handle(push(userEvent("admin.clear"))));

    const entry = entries.find((e) => e.message === "admin command refused");
    assert.equal(entry.severity, "WARNING");
    assert.equal(entry.user_id, "111");
    assert.equal(entry.command, "admin.clear");
    assert.equal(entry.correlation_id, "corr-2");
    assert.ok(!entries.some((e) => e.message === "command received"));
  });

  test("runs a command for a user in the admin allow-list", async () => {
    const calls = [];
    const { handle, replies } = make({ handlers: { "admin.pause": async () => calls.push("pause") } });
    const { result } = await captureLogs(() => handle(push(adminEvent("admin.pause"))));
    assert.equal(result.statusCode, 204);
    assert.deepEqual(calls, ["pause"]);
    assert.equal(replies.length, 0);
  });

  test("runs a command for a member with an admin role", async () => {
    const calls = [];
    const { handle } = make({ handlers: { "admin.clear": async () => calls.push("clear") } });
    await captureLogs(() => handle(push(adminEvent("admin.clear", { user_id: "111", roles: ["500", ADMIN_ROLE] }))));
    assert.deepEqual(calls, ["clear"]);
  });

  test("refuses everyone when no admin is configured", async () => {
    const calls = [];
    const discord = { editOriginal: async () => {} };
    const handle = createWorker({
      handlers: { "admin.clear": async () => calls.push("clear") },
      authorizer: createAuthorizer({}),
      discord
    });
    const { result } = await captureLogs(() => handle(push(adminEvent("admin.clear"))));
    assert.equal(result.statusCode, 204);
    assert.deepEqual(calls, []);
  });

  test("asks Pub/Sub to retry when Discord cannot be told about the refusal for now", async () => {
    const { handle } = make({
      handlers: { "admin.clear": async () => {} },
      discordError: new DiscordApiError(503, "")
    });
    const { result } = await captureLogs(() => handle(push(userEvent("admin.clear"))));
    assert.equal(result.statusCode, 500);
  });

  test("still acks the refusal when the interaction token has expired", async () => {
    const { handle } = make({
      handlers: { "admin.clear": async () => {} },
      discordError: new DiscordApiError(404, "Unknown Webhook")
    });
    const { result } = await captureLogs(() => handle(push(userEvent("admin.clear"))));
    assert.equal(result.statusCode, 204);
  });
});
