const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimits, isValidLimit, DEFAULT_RATE_LIMIT } = require("./limits");
const { fakeFirestore } = require("./fake-firestore");

describe("isValidLimit", () => {
  for (const limit of [1, 20, 10000]) {
    test(`accepts ${limit}`, () => assert.equal(isValidLimit(limit), true));
  }

  for (const limit of [0, -5, 10001, 2.5, "5", null, undefined, Number.NaN]) {
    test(`refuses ${String(limit)}`, () => assert.equal(isValidLimit(limit), false));
  }
});

describe("rate limits", () => {
  test("uses the subject's default of 20 pixels per minute", () => {
    assert.equal(DEFAULT_RATE_LIMIT, 20);
  });

  test("returns the default for a user without override", async () => {
    const limits = createRateLimits({ db: fakeFirestore() });
    assert.equal(await limits.limitFor("111"), 20);
  });

  test("stores the override in limits/{user} with who and when", async () => {
    const db = fakeFirestore();
    const before = Date.now();
    await createRateLimits({ db }).setLimit("222", 5, "999");

    const doc = db.docs.get("limits/222");
    assert.equal(doc.limit, 5);
    assert.equal(doc.updated_by, "999");
    assert.ok(doc.updated_at instanceof Date);
    assert.ok(doc.updated_at.getTime() >= before);
  });

  test("returns the override once it is set, only for that user", async () => {
    const limits = createRateLimits({ db: fakeFirestore() });
    await limits.setLimit("222", 5, "999");
    assert.equal(await limits.limitFor("222"), 5);
    assert.equal(await limits.limitFor("111"), 20);
  });

  test("replaces a previous override", async () => {
    const limits = createRateLimits({ db: fakeFirestore() });
    await limits.setLimit("222", 5, "999");
    await limits.setLimit("222", 100, "999");
    assert.equal(await limits.limitFor("222"), 100);
  });

  test("falls back to the default when the stored value is not a valid limit", async () => {
    const db = fakeFirestore();
    db.docs.set("limits/222", { limit: "illimité" });
    assert.equal(await createRateLimits({ db }).limitFor("222"), 20);
  });

  test("accepts another default limit", async () => {
    const limits = createRateLimits({ db: fakeFirestore(), defaultLimit: 50 });
    assert.equal(await limits.limitFor("111"), 50);
  });
});
