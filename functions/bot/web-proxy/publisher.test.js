const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createPublisher } = require("./publisher");

const event = { type: "web.draw", source: "web", user_id: "1", correlation_id: "c-1", rect: { x0: 0, y0: 0, x1: 1, y1: 1 } };

describe("createPublisher", () => {
  test("publishes on DRAW_TOPIC with filterable attributes", async () => {
    const sent = [];
    const created = [];
    const publish = createPublisher({
      env: { DRAW_TOPIC: " draw-pixel " },
      createTopic: (name) => {
        created.push(name);
        return { publishMessage: async (message) => { sent.push(message); return "msg-1"; } };
      }
    });

    assert.equal(await publish(event), "msg-1");
    await publish(event);

    assert.deepEqual(created, ["draw-pixel"]);
    assert.deepEqual(sent[0], { json: event, attributes: { type: "web.draw", source: "web", correlation_id: "c-1" } });
  });

  test("fails clearly when DRAW_TOPIC is not configured", async () => {
    const publish = createPublisher({ env: {}, createTopic: () => assert.fail("no topic expected") });
    await assert.rejects(publish(event), /DRAW_TOPIC is not configured/);
  });
});
