const { createStore } = require("../src/store");
const { parseRateLimit } = require("../src/env");

function setup({ count, override = null, defaultLimit = 20 } = {}) {
  const db = {
    rateLimit: { findUnique: jest.fn().mockResolvedValue(override) },
    $queryRaw: jest.fn().mockResolvedValue([{ count }]),
    $executeRaw: jest.fn(),
  };
  return { db, store: createStore(db, { defaultLimit, now: () => 60000 * 5 }) };
}

describe("store", () => {
  it("grants the whole cost when it fits", async () => {
    const { store, db } = setup({ count: 5 });
    expect(await store.take("bob", 5)).toEqual({ granted: 5, minute: 5 });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("grants the remainder and hands the rest back", async () => {
    const { store, db } = setup({ count: 25 });
    expect((await store.take("bob", 10)).granted).toBe(5);
    expect(db.$executeRaw.mock.calls[0].slice(1)).toEqual([5, "bob", 5]);
  });

  it("uses the per-user override", async () => {
    const { store } = setup({ count: 3, override: { limit: 2 } });
    expect((await store.take("bob", 3)).granted).toBe(2);
  });

  it("skips accounting when the default limit is 0", async () => {
    const { store, db } = setup({ defaultLimit: 0 });
    expect(await store.take("bob", 100)).toEqual({ granted: 100 });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("still applies an override when the default limit is 0", async () => {
    const { store } = setup({ defaultLimit: 0, count: 1, override: { limit: 0 } });
    expect((await store.take("bob", 1)).granted).toBe(0);
  });
});

describe("store state", () => {
  function stateDb(row) {
    return {
      setting: { findUnique: jest.fn().mockResolvedValue(row), upsert: jest.fn() },
      rateLimit: { upsert: jest.fn() },
      $executeRaw: jest.fn(),
    };
  }

  it("reads and writes the pause flag", async () => {
    const db = stateDb({ value: "true" });
    const store = createStore(db);
    expect(await store.isPaused()).toBe(true);
    await store.setPaused(false);
    expect(db.setting.upsert.mock.calls[0][0].update).toEqual({ value: "false" });
    expect(await createStore(stateDb(null)).isPaused()).toBe(false);
  });

  it("stores a per-user override", async () => {
    const db = stateDb(null);
    await createStore(db).setLimit("bob", 7);
    expect(db.rateLimit.upsert.mock.calls[0][0]).toMatchObject({ create: { userId: "bob", limit: 7 } });
  });

  it("does not refund when nothing was accounted", async () => {
    const db = stateDb(null);
    await createStore(db).refund("bob", 3, undefined);
    await createStore(db).refund("bob", 0, 5);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("parseRateLimit", () => {
  it("defaults to the spec value", () => {
    expect(parseRateLimit(undefined)).toBe(20);
    expect(parseRateLimit(" ")).toBe(20);
  });

  it("accepts 0 and positive integers", () => {
    expect(parseRateLimit("0")).toBe(0);
    expect(parseRateLimit("50")).toBe(50);
  });

  it.each(["abc", "-1", "1.5"])("rejects %s", (raw) => {
    expect(() => parseRateLimit(raw)).toThrow("RATE_LIMIT");
  });
});
