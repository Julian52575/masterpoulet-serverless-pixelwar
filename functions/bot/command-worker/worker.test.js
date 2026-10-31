const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createWorker } = require("./worker");
const { createAuthorizer } = require("./authz");
const { DiscordApiError } = require("./discord");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

const ADMIN_USER = "999";
const ADMIN_ROLE = "777";

function push(event, deliveryAttempt = 1) {
  return Buffer.from(JSON.stringify({
    message: { data: encode(event), messageId: "msg-1" },
    subscription: "projects/demo/subscriptions/command-worker",
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

const drawEvent = {
  type: "draw",
  payload: { x: 10, y: 20, color: "#ff0000" },
  user_id: "111",
  roles: [],
  interaction_id: "interaction-1",
  interaction_token: "secret-interaction-token",
  correlation_id: "corr-1"
};

const adminEvent = (type, extra = {}) => ({
  type,
  payload: {},
  user_id: "111",
  roles: ["500"],
  application_id: "123456789012345678",
  interaction_token: "secret-interaction-token",
  interaction_id: "interaction-2",
  correlation_id: "corr-2",
  ...extra
});

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
  test("routes the event to the handler of its type and acks with 204", async () => {
    const received = [];
    const { handle } = make({ handlers: { draw: async (event) => { received.push(event); } } });

    const { result } = await captureLogs(() => handle(push(drawEvent)));

    assert.equal(result.statusCode, 204);
    assert.deepEqual(received, [drawEvent]);
  });

  test("only calls the handler matching the type", async () => {
    const calls = [];
    const { handle } = make({
      handlers: {
        draw: async () => calls.push("draw"),
        get: async () => calls.push("get")
      }
    });
    await captureLogs(() => handle(push({ type: "get" })));
    assert.deepEqual(calls, ["get"]);
  });

  test("rejects an unknown command type with 400 so it ends up in the DLQ", async () => {
    const { handle } = make({ handlers: { draw: async () => {} } });
    const { result, entries } = await captureLogs(() => handle(push({ type: "hack", correlation_id: "c" })));

    assert.equal(result.statusCode, 400);
    const entry = entries.find((e) => e.message === "unsupported command type");
    assert.equal(entry.severity, "WARNING");
    assert.equal(entry.command, "hack");
    assert.equal(entry.correlation_id, "c");
  });

  test("does not treat inherited object keys as handlers", async () => {
    const { handle } = make({ handlers: {} });
    const { result } = await captureLogs(() => handle(push({ type: "toString" })));
    assert.equal(result.statusCode, 400);
  });

  test("rejects a malformed push message with 400", async () => {
    const { handle } = make({ handlers: { draw: async () => {} } });
    const { result, entries } = await captureLogs(() => handle(Buffer.from("not json")));

    assert.equal(result.statusCode, 400);
    assert.equal(entries[0].message, "invalid pubsub push message");
    assert.equal(entries[0].error, "body is not valid JSON");
  });

  test("answers 500 when the handler fails, so Pub/Sub retries", async () => {
    const { handle } = make({ handlers: { draw: async () => { throw new Error("firestore down"); } } });
    const { result, entries } = await captureLogs(() => handle(push(drawEvent, 3)));

    assert.equal(result.statusCode, 500);
    const entry = entries.find((e) => e.message === "command failed");
    assert.equal(entry.severity, "ERROR");
    assert.equal(entry.error, "firestore down");
    assert.equal(entry.correlation_id, "corr-1");
    assert.equal(entry.delivery_attempt, 3);
    assert.equal(typeof entry.duration_ms, "number");
  });

  test("logs the received and processed command with the correlation id", async () => {
    const { handle } = make({ handlers: { draw: async () => {} } });
    const { entries } = await captureLogs(() => handle(push(drawEvent, 2)));

    const received = entries.find((e) => e.message === "command received");
    assert.equal(received.severity, "INFO");
    assert.equal(received.function, "command-worker");
    assert.equal(received.correlation_id, "corr-1");
    assert.equal(received.command, "draw");
    assert.equal(received.user_id, "111");
    assert.equal(received.interaction_id, "interaction-1");
    assert.equal(received.message_id, "msg-1");
    assert.equal(received.delivery_attempt, 2);

    const processed = entries.find((e) => e.message === "command processed");
    assert.equal(processed.correlation_id, "corr-1");
    assert.equal(typeof processed.duration_ms, "number");
  });

  test("never writes the interaction token to the logs", async () => {
    const { handle } = make({ handlers: { draw: async () => { throw new Error("boom"); } } });
    const { lines } = await captureLogs(() => handle(push(drawEvent)));
    assert.ok(!lines.join("\n").includes("secret-interaction-token"));
  });
});

describe("createWorker admin authorization", () => {
  for (const type of ["admin.pause", "admin.resume", "admin.clear", "admin.ratelimit", "snapshot"]) {
    test(`refuses ${type} to a normal user without running the handler`, async () => {
      const calls = [];
      const { handle, replies } = make({ handlers: { [type]: async () => calls.push(type) } });

      const { result } = await captureLogs(() => handle(push(adminEvent(type))));

      assert.equal(result.statusCode, 204);
      assert.deepEqual(calls, []);
      assert.equal(replies.length, 1);
      assert.match(replies[0].message.content, /réservée aux administrateurs/);
    });
  }

  test("logs a WARNING with the user and the correlation id when refusing", async () => {
    const { handle } = make({ handlers: { "admin.clear": async () => {} } });
    const { entries } = await captureLogs(() => handle(push(adminEvent("admin.clear"))));

    const entry = entries.find((e) => e.message === "admin command refused");
    assert.equal(entry.severity, "WARNING");
    assert.equal(entry.user_id, "111");
    assert.equal(entry.command, "admin.clear");
    assert.equal(entry.correlation_id, "corr-2");
    assert.ok(!entries.some((e) => e.message === "command received"));
  });

  test("runs an admin command for a user in the admin allow-list", async () => {
    const calls = [];
    const { handle, replies } = make({ handlers: { "admin.pause": async () => calls.push("pause") } });
    const { result } = await captureLogs(() =>
      handle(push(adminEvent("admin.pause", { user_id: ADMIN_USER, roles: [] })))
    );
    assert.equal(result.statusCode, 204);
    assert.deepEqual(calls, ["pause"]);
    assert.equal(replies.length, 0);
  });

  test("runs an admin command for a member with an admin role", async () => {
    const calls = [];
    const { handle } = make({ handlers: { "admin.clear": async () => calls.push("clear") } });
    await captureLogs(() => handle(push(adminEvent("admin.clear", { roles: ["500", ADMIN_ROLE] }))));
    assert.deepEqual(calls, ["clear"]);
  });

  test("lets every user run /draw and /get", async () => {
    const calls = [];
    const { handle, replies } = make({
      handlers: { draw: async () => calls.push("draw"), get: async () => calls.push("get") }
    });
    await captureLogs(() => handle(push(drawEvent)));
    await captureLogs(() => handle(push({ ...drawEvent, type: "get" })));
    assert.deepEqual(calls, ["draw", "get"]);
    assert.equal(replies.length, 0);
  });

  test("asks Pub/Sub to retry when Discord cannot be told about the refusal for now", async () => {
    const { handle } = make({
      handlers: { "admin.clear": async () => {} },
      discordError: new DiscordApiError(503, "")
    });
    const { result } = await captureLogs(() => handle(push(adminEvent("admin.clear"))));
    assert.equal(result.statusCode, 500);
  });

  test("still acks the refusal when the interaction token has expired", async () => {
    const calls = [];
    const { handle } = make({
      handlers: { "admin.clear": async () => calls.push("clear") },
      discordError: new DiscordApiError(404, "Unknown Webhook")
    });
    const { result, entries } = await captureLogs(() => handle(push(adminEvent("admin.clear"))));

    assert.equal(result.statusCode, 204);
    assert.deepEqual(calls, []);
    const entry = entries.find((e) => e.message === "could not tell the user the command was refused");
    assert.equal(entry.status, 404);
  });
});
