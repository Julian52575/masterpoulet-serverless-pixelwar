const SNOWFLAKE = /^\d{1,20}$/;

function parseIdList(value) {
  return String(value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function loadConfig(env = process.env) {
  const adminUserIds = parseIdList(env.ADMIN_USER_IDS);
  const adminRoleIds = parseIdList(env.ADMIN_ROLE_IDS);
  const problems = [];
  const warnings = [];

  for (const [name, ids] of [["ADMIN_USER_IDS", adminUserIds], ["ADMIN_ROLE_IDS", adminRoleIds]]) {
    const invalid = ids.filter((id) => !SNOWFLAKE.test(id));
    if (invalid.length > 0) problems.push(`${name} contains invalid Discord ids: ${invalid.join(", ")}`);
  }

  if (adminUserIds.length === 0 && adminRoleIds.length === 0) {
    warnings.push("no admin configured: every admin command will be refused");
  }

  return { adminUserIds, adminRoleIds, problems, warnings };
}

module.exports = { loadConfig };
