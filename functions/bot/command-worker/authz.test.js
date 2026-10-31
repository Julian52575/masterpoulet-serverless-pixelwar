const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createAuthorizer, requiresAdmin } = require("./authz");

describe("requiresAdmin", () => {
  for (const type of ["admin.pause", "admin.resume", "admin.clear", "admin.ratelimit", "snapshot"]) {
    test(`${type} is reserved to admins`, () => {
      assert.equal(requiresAdmin(type), true);
    });
  }

  for (const type of ["draw", "get"]) {
    test(`${type} is open to every user`, () => {
      assert.equal(requiresAdmin(type), false);
    });
  }
});

describe("isAdmin", () => {
  const { isAdmin } = createAuthorizer({ adminUserIds: ["999"], adminRoleIds: ["777", "778"] });

  test("accepts a user in the allow-list, even without roles (DM)", () => {
    assert.equal(isAdmin({ user_id: "999", roles: [] }), true);
  });

  test("accepts a member holding one of the admin roles", () => {
    assert.equal(isAdmin({ user_id: "111", roles: ["500", "778"] }), true);
  });

  test("refuses a member without any admin role", () => {
    assert.equal(isAdmin({ user_id: "111", roles: ["500", "501"] }), false);
  });

  test("refuses a user id that only looks like an admin one", () => {
    assert.equal(isAdmin({ user_id: "9999", roles: [] }), false);
    assert.equal(isAdmin({ user_id: 999, roles: [] }), false);
  });

  test("refuses events with missing or malformed fields", () => {
    assert.equal(isAdmin({}), false);
    assert.equal(isAdmin(undefined), false);
    assert.equal(isAdmin({ user_id: "111", roles: "777" }), false);
  });

  test("refuses everyone when no admin is configured", () => {
    const empty = createAuthorizer();
    assert.equal(empty.isAdmin({ user_id: "999", roles: ["777"] }), false);
  });
});
