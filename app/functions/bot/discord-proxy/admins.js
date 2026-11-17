function createAuthorizer({ userIds = [], roleIds = [] } = {}) {
  const users = new Set(userIds);
  const roles = new Set(roleIds);

  function isAdmin(command) {
    if (typeof command?.user_id === "string" && users.has(command.user_id)) return true;
    return Array.isArray(command?.roles) && command.roles.some((role) => roles.has(role));
  }

  return { isAdmin };
}

module.exports = { createAuthorizer };
