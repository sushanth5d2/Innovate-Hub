const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const mlClient = require('../services/ml-client');
const { cacheMiddleware } = require('../middleware/performance');

// Get personalized recommendations
router.get('/recommendations', auth, cacheMiddleware(300), async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 10;
    
    const recommendations = await mlClient.getUserRecommendations(userId, limit);
    
    res.json(recommendations);
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Get similar users
router.get('/similar-users', auth, cacheMiddleware(600), async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 10;
    
    const similarUsers = await mlClient.getSimilarUsers(userId, limit);
    
    res.json(similarUsers);
  } catch (error) {
    console.error('Similar users error:', error);
    res.status(500).json({ error: 'Failed to get similar users' });
  }
});

// Analyze content
router.post('/analyze-content', auth, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    const analysis = await mlClient.analyzeContent(content);
    
    res.json(analysis);
  } catch (error) {
    console.error('Content analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze content' });
  }
});

// Get user analytics
router.get('/analytics', auth, cacheMiddleware(300), async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const analytics = await mlClient.getUserAnalytics(userId);
    
    res.json(analytics);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Get trending topics
router.get('/trending', cacheMiddleware(180), async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '24h';
    const limit = parseInt(req.query.limit) || 10;
    
    const trending = await mlClient.getTrendingTopics(timeframe, limit);
    
    res.json(trending);
  } catch (error) {
    console.error('Trending topics error:', error);
    res.status(500).json({ error: 'Failed to get trending topics' });
  }
});

// Health check for ML service
router.get('/ml-health', async (req, res) => {
  try {
    const health = await mlClient.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(503).json({ status: 'unavailable', error: error.message });
  }
});

module.exports = router;
