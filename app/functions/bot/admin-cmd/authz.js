const ADMIN_ONLY = new Set(["snapshot"]);

function requiresAdmin(type) {
  return type.startsWith("admin.") || ADMIN_ONLY.has(type);
}

function createAuthorizer({ adminUserIds = [], adminRoleIds = [] } = {}) {
  const users = new Set(adminUserIds);
  const roles = new Set(adminRoleIds);

  function isAdmin(event) {
    if (typeof event?.user_id === "string" && users.has(event.user_id)) return true;
    return Array.isArray(event?.roles) && event.roles.some((role) => roles.has(role));
  }

  return { requiresAdmin, isAdmin };
}

module.exports = { createAuthorizer, requiresAdmin };
