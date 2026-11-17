const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createQuota, WINDOW_MS } = require("./quota");
const { fakeFirestore } = require("./fake-firestore");

const NOW = 100 * WINDOW_MS + 15000;

describe("createQuota", () => {
  test("accepts the whole area when the user has enough quota", async () => {
    const quota = createQuota({ db: fakeFirestore(), now: () => NOW });
    assert.deepEqual(await quota.check("111", 5), { status: "ok", accepted: 5 });
  });

  test("accepts only what is left this minute", async () => {
    const db = fakeFirestore();
    await db.collection("ratelimit").doc("111_100").set({ count: 17 });
    const quota = createQuota({ db, now: () => NOW });
    assert.deepEqual(await quota.check("111", 9), { status: "ok", accepted: 3 });
  });

  test("uses the admin override from limits/{user}", async () => {
    const db = fakeFirestore();
    await db.collection("limits").doc("111").set({ limit: 100 });
    const quota = createQuota({ db, now: () => NOW });
    assert.deepEqual(await quota.check("111", 64), { status: "ok", accepted: 64 });
  });

  test("refuses when the quota is used up and says when to retry", async () => {
    const db = fakeFirestore();
    await db.collection("ratelimit").doc("111_100").set({ count: 20 });
    const quota = createQuota({ db, now: () => NOW });
    assert.deepEqual(await quota.check("111", 1), { status: "rate_limited", limit: 20, retryAfterSeconds: 45 });
  });

  test("ignores the counters of previous minutes", async () => {
    const db = fakeFirestore();
    await db.collection("ratelimit").doc("111_99").set({ count: 20 });
    const quota = createQuota({ db, now: () => NOW });
    assert.equal((await quota.check("111", 1)).status, "ok");
  });

  test("refuses everything while the canvas is paused", async () => {
    const db = fakeFirestore();
    await db.collection("state").doc("canvas").set({ paused: true });
    const quota = createQuota({ db, now: () => NOW });
    assert.deepEqual(await quota.check("111", 1), { status: "paused" });
  });

  test("never writes to Firestore", async () => {
    const db = fakeFirestore();
    await createQuota({ db, now: () => NOW }).check("111", 4);
    assert.equal(db.docs.size, 0);
  });
});
