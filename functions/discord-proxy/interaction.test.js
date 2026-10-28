const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { parseInteraction } = require("./interaction");

const member = {
  user: { id: "111", username: "alice", global_name: "Alice" },
  roles: ["900", "901"]
};

function command(data, extra = {}) {
  return {
    type: 2,
    id: "interaction-1",
    application_id: "app-1",
    token: "token-1",
    guild_id: "guild-1",
    channel_id: "channel-1",
    member,
    data,
    ...extra
  };
}

describe("parseInteraction", () => {
  test("parses /draw with its options and the context needed by the worker", () => {
    const result = parseInteraction(command({
      name: "draw",
      options: [
        { name: "x", type: 4, value: 10 },
        { name: "y", type: 4, value: 20 },
        { name: "color", type: 3, value: "#ff0000" }
      ]
    }));

    assert.deepEqual(result, {
      type: "draw",
      payload: { x: 10, y: 20, color: "#ff0000" },
      user_id: "111",
      username: "Alice",
      roles: ["900", "901"],
      guild_id: "guild-1",
      channel_id: "channel-1",
      application_id: "app-1",
      interaction_id: "interaction-1",
      interaction_token: "token-1"
    });
  });

  test("does not depend on the order of the options", () => {
    const result = parseInteraction(command({
      name: "draw",
      options: [
        { name: "color", type: 3, value: "red" },
        { name: "y", type: 4, value: 2 },
        { name: "x", type: 4, value: 1 }
      ]
    }));
    assert.deepEqual(result.payload, { x: 1, y: 2, color: "red" });
  });

  test("parses /get and /snapshot with an empty payload", () => {
    assert.deepEqual(parseInteraction(command({ name: "get" })).payload, {});
    assert.equal(parseInteraction(command({ name: "get" })).type, "get");
    assert.equal(parseInteraction(command({ name: "snapshot" })).type, "snapshot");
  });

  for (const sub of ["pause", "resume", "clear"]) {
    test(`parses /admin ${sub} as admin.${sub}`, () => {
      const result = parseInteraction(command({
        name: "admin",
        options: [{ name: sub, type: 1 }]
      }));
      assert.equal(result.type, `admin.${sub}`);
      assert.deepEqual(result.payload, {});
    });
  }

  test("parses /admin ratelimit with its nested options", () => {
    const result = parseInteraction(command({
      name: "admin",
      options: [{
        name: "ratelimit",
        type: 1,
        options: [
          { name: "user", type: 6, value: "222" },
          { name: "limit", type: 4, value: 5 }
        ]
      }]
    }));
    assert.equal(result.type, "admin.ratelimit");
    assert.deepEqual(result.payload, { user: "222", limit: 5 });
  });

  test("reads the user from `user` when the command comes from a DM", () => {
    const result = parseInteraction(command({ name: "get" }, {
      member: undefined,
      guild_id: undefined,
      user: { id: "333", username: "bob" }
    }));
    assert.equal(result.user_id, "333");
    assert.equal(result.username, "bob");
    assert.deepEqual(result.roles, []);
    assert.equal(result.guild_id, null);
  });

  test("returns null for an unknown command", () => {
    assert.equal(parseInteraction(command({ name: "hack" })), null);
  });

  test("returns null for an unknown /admin subcommand", () => {
    assert.equal(parseInteraction(command({ name: "admin", options: [{ name: "delete", type: 1 }] })), null);
  });

  test("returns null for /admin without a subcommand", () => {
    assert.equal(parseInteraction(command({ name: "admin" })), null);
  });

  test("returns null when a required option is missing", () => {
    const result = parseInteraction(command({
      name: "draw",
      options: [{ name: "x", type: 4, value: 10 }]
    }));
    assert.equal(result, null);
  });

  test("ignores options that the command does not declare", () => {
    const result = parseInteraction(command({
      name: "get",
      options: [{ name: "admin", type: 5, value: true }]
    }));
    assert.deepEqual(result.payload, {});
  });

  test("does not treat inherited object keys as commands", () => {
    assert.equal(parseInteraction(command({ name: "toString" })), null);
    assert.equal(parseInteraction(command({ name: "admin", options: [{ name: "constructor", type: 1 }] })), null);
  });

  test("returns null when the user is missing", () => {
    assert.equal(parseInteraction(command({ name: "get" }, { member: undefined })), null);
  });

  test("returns null for malformed input without throwing", () => {
    assert.equal(parseInteraction(undefined), null);
    assert.equal(parseInteraction({}), null);
    assert.equal(parseInteraction({ type: 2, data: { name: 42 } }), null);
  });
});
