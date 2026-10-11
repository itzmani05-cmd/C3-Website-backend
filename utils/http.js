const { isValidId } = require('../lib/prisma');

// Express query values can be arrays; Prisma filters need a single string.
const queryString = (value) => (typeof value === 'string' && value ? value : undefined);

// findUnique by id, or null without querying when the id isn't a valid UUID.
const findByIdOrNull = (delegate, id, args = {}) =>
  isValidId(id) ? delegate.findUnique({ where: { id }, ...args }) : null;

// Deletes one row by id; resolves to whether a row was removed.
const deleteById = async (delegate, id, where = {}) => {
  if (!isValidId(id)) return false;
  const { count } = await delegate.deleteMany({ where: { id, ...where } });
  return count > 0;
};

// Optional numeric body field: undefined stays undefined, anything else becomes a number (fallback when invalid).
const optionalNumber = (value, fallback = 0) =>
  value === undefined || value === null ? undefined : Number(value) || fallback;

// ?page=&pageSize= → { page, pageSize, skip, take } for Prisma, or null when the request doesn't ask
// for a page (list endpoints then return the whole list, as before).
const pageParams = (query, { defaultSize = 10, maxSize = 100 } = {}) => {
  if (query.page === undefined) return null;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

// Response body for one page of a list.
const pagedResponse = (items, total, { page, pageSize }) => ({
  items,
  total,
  page,
  pageSize,
  totalPages: Math.max(1, Math.ceil(total / pageSize))
});

// Case-insensitive "name or email contains" filter on a user.
const userSearchFilter = (search) => ({
  OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }]
});

// Logs a failed request and sends a generic 500, so database/Prisma details never reach the client.
const serverError = (res, error, message = 'Server error') => {
  console.error(message + ':', error);
  return res.status(500).json({ message });
};

module.exports = { serverError, queryString, findByIdOrNull, deleteById, optionalNumber, pageParams, pagedResponse, userSearchFilter };
