const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { routeCommand, SNAPSHOT_REQUESTED } = require("./routing");

const base = {
  user_id: "111",
  username: "alice",
  roles: ["900"],
  guild_id: "guild-1",
  channel_id: "channel-1",
  application_id: "app-1",
  interaction_id: "1300000000000000000",
  interaction_token: "token-1",
  correlation_id: "corr-1"
};

describe("routeCommand", () => {
  test("sends /draw to the draw topic unchanged", () => {
    const command = { ...base, type: "draw", payload: { x: 1, y: 2, color: "red" } };
    assert.deepEqual(routeCommand(command), {
      route: "draw",
      event: command,
      attributes: { type: "draw", correlation_id: "corr-1" }
    });
  });

  for (const type of ["get", "admin.pause", "admin.resume", "admin.clear", "admin.ratelimit"]) {
    test(`sends ${type} to the commands topic with a filterable type attribute`, () => {
      const command = { ...base, type, payload: {} };
      assert.deepEqual(routeCommand(command), {
        route: "commands",
        event: command,
        attributes: { type, correlation_id: "corr-1" }
      });
    });
  }

  test("turns /snapshot into the snapshot request the snapshot worker expects", () => {
    const now = new Date("2026-11-12T10:00:00.000Z");
    const { route, event, attributes } = routeCommand({ ...base, type: "snapshot", payload: {} }, now);

    assert.equal(route, "snapshot");
    assert.deepEqual(event, {
      type: SNAPSHOT_REQUESTED,
      snapshot_id: "1300000000000000000",
      requested_at: "2026-11-12T10:00:00.000Z",
      requested_by: "111",
      application_id: "app-1",
      interaction_token: "token-1",
      channel_id: "channel-1",
      correlation_id: "corr-1"
    });
    assert.deepEqual(attributes, {
      type: SNAPSHOT_REQUESTED,
      snapshot_id: "1300000000000000000",
      correlation_id: "corr-1"
    });
  });

  test("keeps a null channel for a snapshot asked in a direct message", () => {
    const { event } = routeCommand({ ...base, type: "snapshot", channel_id: null });
    assert.equal(event.channel_id, null);
  });

  test("never puts the interaction token in the attributes", () => {
    for (const type of ["draw", "get", "snapshot", "admin.clear"]) {
      const { attributes } = routeCommand({ ...base, type });
      assert.ok(!Object.values(attributes).includes("token-1"), type);
    }
  });
});
