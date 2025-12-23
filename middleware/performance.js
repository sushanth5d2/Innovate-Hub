const { getCache, setCache } = require('../config/cache');

// Cache middleware for GET requests
function cacheMiddleware(duration = 300) {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = `cache:${req.originalUrl || req.url}`;
    
    try {
      const cachedResponse = await getCache(key);
      
      if (cachedResponse) {
        return res.json(cachedResponse);
      }
      
      // Store original res.json
      const originalJson = res.json.bind(res);
      
      // Override res.json
      res.json = (data) => {
        // Cache the response
        setCache(key, data, duration).catch(err => 
          console.error('Failed to cache response:', err)
        );
        
        // Send the response
        return originalJson(data);
      };
      
      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
}

// Response time logger
function responseTimeLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`Slow request: ${req.method} ${req.url} - ${duration}ms`);
    }
  });
  
  next();
}

module.exports = {
  cacheMiddleware,
  responseTimeLogger
};
