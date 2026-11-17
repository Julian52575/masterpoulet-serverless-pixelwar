const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createAuthorizer } = require("./admins");

describe("createAuthorizer", () => {
  const { isAdmin } = createAuthorizer({ userIds: ["111"], roleIds: ["900"] });

  test("accepts a user from the allow-list", () => {
    assert.equal(isAdmin({ user_id: "111", roles: [] }), true);
  });

  test("accepts a user with an admin role", () => {
    assert.equal(isAdmin({ user_id: "222", roles: ["123", "900"] }), true);
  });

  test("refuses anyone else", () => {
    assert.equal(isAdmin({ user_id: "222", roles: ["123"] }), false);
  });

  test("refuses malformed commands without throwing", () => {
    assert.equal(isAdmin(undefined), false);
    assert.equal(isAdmin({ user_id: 111, roles: "900" }), false);
  });

  test("refuses everyone when no admin is configured", () => {
    assert.equal(createAuthorizer().isAdmin({ user_id: "111", roles: ["900"] }), false);
  });
});
