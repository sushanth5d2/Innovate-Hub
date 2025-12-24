const axios = require('axios');

const ML_SERVICE_URL = process.env.PYTHON_ML_SERVICE_URL || 'http://localhost:5000';

class MLServiceClient {
  constructor() {
    this.baseURL = ML_SERVICE_URL;
    this.timeout = 10000; // 10 seconds
  }

  /**
   * Check if ML service is healthy
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.baseURL}/health`, {
        timeout: this.timeout
      });
      return response.data;
    } catch (error) {
      console.error('ML Service health check failed:', error.message);
      return { status: 'unavailable' };
    }
  }

  /**
   * Get personalized recommendations for a user
   */
  async getUserRecommendations(userId, limit = 10) {
    try {
      const response = await axios.get(
        `${this.baseURL}/api/recommendations/users/${userId}`,
        {
          params: { limit },
          timeout: this.timeout
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting recommendations:', error.message);
      throw new Error('Failed to get recommendations');
    }
  }

  /**
   * Get similar users
   */
  async getSimilarUsers(userId, limit = 10) {
    try {
      const response = await axios.get(
        `${this.baseURL}/api/recommendations/similar-users/${userId}`,
        {
          params: { limit },
          timeout: this.timeout
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting similar users:', error.message);
      throw new Error('Failed to get similar users');
    }
  }

  /**
   * Analyze content
   */
  async analyzeContent(content) {
    try {
      const response = await axios.post(
        `${this.baseURL}/api/analysis/content`,
        { content },
        { timeout: this.timeout }
      );
      return response.data;
    } catch (error) {
      console.error('Error analyzing content:', error.message);
      throw new Error('Failed to analyze content');
    }
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(userId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/api/analytics/user/${userId}`,
        { timeout: this.timeout }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting user analytics:', error.message);
      throw new Error('Failed to get user analytics');
    }
  }

  /**
   * Get trending topics
   */
  async getTrendingTopics(timeframe = '24h', limit = 10) {
    try {
      const response = await axios.get(
        `${this.baseURL}/api/analytics/trending`,
        {
          params: { timeframe, limit },
          timeout: this.timeout
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting trending topics:', error.message);
      throw new Error('Failed to get trending topics');
    }
  }

  /**
   * Train the ML model with user interaction data
   */
  async trainModel(userInteractions) {
    try {
      const response = await axios.post(
        `${this.baseURL}/api/ml/train`,
        { user_interactions: userInteractions },
        { timeout: 30000 } // Longer timeout for training
      );
      return response.data;
    } catch (error) {
      console.error('Error training model:', error.message);
      throw new Error('Failed to train model');
    }
  }

  /**
   * Analyze image for task extraction
   */
  async analyzeImageForTasks(imagePath) {
    try {
      const fs = require('fs');
      const imageData = fs.readFileSync(imagePath, { encoding: 'base64' });
      
      const response = await axios.post(
        `${this.baseURL}/api/tasks/from-image`,
        { image: `data:image/jpeg;base64,${imageData}` },
        { timeout: this.timeout }
      );
      return response.data;
    } catch (error) {
      console.error('Error analyzing image for tasks:', error.message);
      throw new Error('Failed to analyze image');
    }
  }
}

module.exports = new MLServiceClient();
