const LIMITS_COLLECTION = "limits";
const DEFAULT_RATE_LIMIT = 20;
const MIN_RATE_LIMIT = 1;
const MAX_RATE_LIMIT = 10000;

function isValidLimit(limit) {
  return Number.isInteger(limit) && limit >= MIN_RATE_LIMIT && limit <= MAX_RATE_LIMIT;
}

function createRateLimits({ db, defaultLimit = DEFAULT_RATE_LIMIT }) {
  const limits = db.collection(LIMITS_COLLECTION);

  async function setLimit(userId, limit, updatedBy) {
    await limits.doc(userId).set({
      limit,
      updated_by: updatedBy,
      updated_at: new Date()
    });
  }

  async function limitFor(userId) {
    const snapshot = await limits.doc(userId).get();
    const limit = snapshot.exists ? snapshot.data().limit : undefined;
    return isValidLimit(limit) ? limit : defaultLimit;
  }

  return { setLimit, limitFor };
}

module.exports = {
  createRateLimits,
  isValidLimit,
  LIMITS_COLLECTION,
  DEFAULT_RATE_LIMIT,
  MIN_RATE_LIMIT,
  MAX_RATE_LIMIT
};
