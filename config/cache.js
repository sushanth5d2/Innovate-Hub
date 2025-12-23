const redis = require('redis');

let redisClient = null;
let isRedisConnected = false;

// Initialize Redis client
async function initRedis() {
  if (process.env.REDIS_ENABLED !== 'true') {
    console.log('Redis caching is disabled');
    return null;
  }

  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 5000
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
      isRedisConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('Redis connected successfully');
      isRedisConnected = true;
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    console.error('Failed to connect to Redis:', error.message);
    console.log('Continuing without cache...');
    return null;
  }
}

// Get cached data
async function getCache(key) {
  if (!isRedisConnected || !redisClient) return null;
  
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

// Set cached data
async function setCache(key, data, expirationInSeconds = 300) {
  if (!isRedisConnected || !redisClient) return false;
  
  try {
    await redisClient.setEx(key, expirationInSeconds, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Cache set error:', error);
    return false;
  }
}

// Delete cached data
async function deleteCache(key) {
  if (!isRedisConnected || !redisClient) return false;
  
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.error('Cache delete error:', error);
    return false;
  }
}

// Delete cache by pattern
async function deleteCachePattern(pattern) {
  if (!isRedisConnected || !redisClient) return false;
  
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    return true;
  } catch (error) {
    console.error('Cache pattern delete error:', error);
    return false;
  }
}

// Close Redis connection
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    isRedisConnected = false;
  }
}

module.exports = {
  initRedis,
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
  closeRedis,
  isConnected: () => isRedisConnected
};
