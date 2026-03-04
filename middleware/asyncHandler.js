/**
 * Wraps route handlers to catch both synchronous throws and unhandled promise rejections.
 * Usage: router.get('/path', asyncHandler((req, res) => { ... }));
 * 
 * For callback-based routes (db.all/db.get), wrap critical sections in try/catch manually.
 * This handler catches errors thrown synchronously or from async handlers.
 */
const asyncHandler = (fn) => (req, res, next) => {
  try {
    const result = fn(req, res, next);
    // If handler returns a promise, catch rejections
    if (result && typeof result.catch === 'function') {
      result.catch(next);
    }
  } catch (err) {
    next(err);
  }
};

module.exports = asyncHandler;
