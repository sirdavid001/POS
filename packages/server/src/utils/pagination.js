export function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function pagination(query = {}, { defaultLimit = 50, maximumLimit = 200 } = {}) {
  const page = positiveInteger(query.page, 1);
  const limit = positiveInteger(query.limit, defaultLimit, maximumLimit);
  return { page, limit, offset: (page - 1) * limit };
}
