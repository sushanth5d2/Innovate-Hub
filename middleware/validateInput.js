/**
 * Input validation middleware for common fields.
 * Provides length limits and basic sanitization.
 */

const MAX_LENGTHS = {
  title: 500,
  name: 200,
  username: 50,
  email: 254,
  password: 128,
  content: 50000,
  message: 10000,
  description: 5000,
  caption: 5000,
  bio: 500,
  comment: 5000,
  query: 500,
  url: 2048
};

/**
 * Validates request body/query fields against max lengths.
 * Usage: router.post('/path', validateInput({ body: ['title', 'content'] }), handler)
 * Or:    router.get('/path', validateInput({ query: ['q'] }), handler)
 */
function validateInput(config = {}) {
  return (req, res, next) => {
    const errors = [];

    // Validate body fields
    if (config.body) {
      for (const field of config.body) {
        const value = req.body && req.body[field];
        if (value !== undefined && value !== null && typeof value === 'string') {
          const maxLen = config.maxLengths?.[field] || MAX_LENGTHS[field] || MAX_LENGTHS.content;
          if (value.length > maxLen) {
            errors.push(`${field} exceeds maximum length of ${maxLen} characters`);
          }
        }
      }
    }

    // Validate query fields
    if (config.query) {
      for (const field of config.query) {
        const value = req.query && req.query[field];
        if (value !== undefined && value !== null && typeof value === 'string') {
          const maxLen = config.maxLengths?.[field] || MAX_LENGTHS[field] || MAX_LENGTHS.query;
          if (value.length > maxLen) {
            errors.push(`${field} exceeds maximum length of ${maxLen} characters`);
          }
        }
      }
    }

    // Validate required fields
    if (config.required) {
      for (const field of config.required) {
        const value = req.body && req.body[field];
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
          errors.push(`${field} is required`);
        }
      }
    }

    // Validate numeric params
    if (config.params) {
      for (const field of config.params) {
        const value = req.params && req.params[field];
        if (value !== undefined && isNaN(Number(value))) {
          errors.push(`${field} must be a number`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0], errors });
    }

    next();
  };
}

/**
 * Sanitize string by trimming and removing null bytes
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/\0/g, '');
}

module.exports = { validateInput, sanitizeString, MAX_LENGTHS };
