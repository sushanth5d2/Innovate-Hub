# 🚀 Innovate Hub - Quick Reference Card

## ⚡ Start Commands

```bash
# Start Node.js backend (always required)
npm start

# Start Python ML service (optional, for AI features)
./start-ml-service.sh
```

## 📡 New ML API Endpoints

All ML endpoints require authentication (except trending and health check).

### Get Smart Recommendations
```bash
GET /api/ml/recommendations?limit=10
Authorization: Bearer YOUR_TOKEN
```

### Find Similar Users
```bash
GET /api/ml/similar-users?limit=10
Authorization: Bearer YOUR_TOKEN
```

### Analyze Post Content
```bash
POST /api/ml/analyze-content
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "content": "Your post text here #hashtag @mention"
}
```

### Get User Analytics
```bash
GET /api/ml/analytics
Authorization: Bearer YOUR_TOKEN
```

### Get Trending Topics
```bash
GET /api/ml/trending?timeframe=24h&limit=10
```

### ML Service Health Check
```bash
GET /api/ml/ml-health
```

## 🎨 Frontend Integration Examples

### Load Personalized Feed
```javascript
async function loadSmartFeed() {
  const token = localStorage.getItem('token');
  const response = await fetch('/api/ml/recommendations?limit=20', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  console.log(data.recommendations);
}
```

### Analyze Content Before Posting
```javascript
async function checkPostQuality(content) {
  const token = localStorage.getItem('token');
  const response = await fetch('/api/ml/analyze-content', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  });
  const data = await response.json();
  
  // Results:
  // data.analysis.sentiment - positive/negative/neutral
  // data.analysis.quality_score - 0 to 1
  // data.analysis.topics - array of keywords
  // data.analysis.hashtags - array of hashtags
  // data.analysis.readability - easy/moderate
}
```

### Show User Analytics Dashboard
```javascript
async function loadAnalytics() {
  const token = localStorage.getItem('token');
  const response = await fetch('/api/ml/analytics', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  
  // Available data:
  // data.analytics.engagement - likes, comments, shares
  // data.analytics.growth - followers, growth rate
  // data.analytics.content_performance - best posts
  // data.analytics.audience_insights - interests, active hours
}
```

### Display Trending Topics
```javascript
async function showTrending() {
  const response = await fetch('/api/ml/trending?timeframe=24h&limit=5');
  const data = await response.json();
  
  data.trending.forEach(trend => {
    console.log(`${trend.topic}: ${trend.mentions} mentions`);
  });
}
```

## 🔧 Configuration

### .env (Node.js)
```env
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key
REDIS_ENABLED=false
PYTHON_ML_SERVICE_URL=http://localhost:5000
```

### ml-service/.env (Python)
```env
PORT=5000
DEBUG=True
NODE_SERVICE_URL=http://localhost:3000
```

## ⚙️ What's Optimized

### Backend Performance
- ✅ Gzip compression (70% smaller responses)
- ✅ Response time monitoring
- ✅ Static file caching
- ✅ Request size limits (10MB max)

### Security
- ✅ 11 security headers (Helmet.js)
- ✅ Rate limiting (100 req/15min)
- ✅ Auth rate limiting (5 attempts/15min)
- ✅ Trust proxy configured

### ML Features
- ✅ Content recommendations
- ✅ User discovery
- ✅ Sentiment analysis
- ✅ Topic extraction
- ✅ Quality scoring
- ✅ User analytics
- ✅ Trending topics

## 📊 Response Examples

### Recommendations Response
```json
{
  "success": true,
  "user_id": 123,
  "recommendations": [
    {
      "post_id": 456,
      "score": 0.95,
      "reason": "Based on your interests",
      "type": "post"
    }
  ]
}
```

### Content Analysis Response
```json
{
  "success": true,
  "analysis": {
    "sentiment": {
      "label": "positive",
      "score": 0.85
    },
    "topics": ["innovation", "technology"],
    "hashtags": ["innovation", "tech"],
    "mentions": ["username"],
    "quality_score": 0.78,
    "word_count": 45,
    "readability": "easy"
  }
}
```

### Analytics Response
```json
{
  "success": true,
  "analytics": {
    "engagement": {
      "total_posts": 45,
      "total_likes": 1250,
      "avg_engagement_rate": 0.078
    },
    "growth": {
      "followers": 523,
      "follower_growth_7d": 34
    },
    "content_performance": {
      "best_posting_time": "18:00-20:00"
    }
  }
}
```

## 🐛 Troubleshooting

### Port Already in Use
```bash
lsof -i :3000  # Check what's using port 3000
lsof -i :5000  # Check what's using port 5000
```

### ML Service Not Working
App works fine without ML service. Features gracefully degrade.
To enable: Run `./start-ml-service.sh`

### Redis Connection Failed
Redis is optional. To disable:
```env
REDIS_ENABLED=false
```

## 📚 Documentation Files

- `IMPLEMENTATION_SUMMARY.md` - Complete overview
- `OPTIMIZATION_QUICKSTART.md` - Quick start guide
- `ML_OPTIMIZATION_GUIDE.md` - Detailed ML documentation

## 🎯 Use Cases

1. **Smart Feed** - Show personalized content
2. **Content Assistant** - Analyze before posting
3. **People to Follow** - Suggest similar users
4. **Analytics** - Show engagement insights
5. **Trending** - Display hot topics

---

**Need more help?** Check the documentation files above! 🚀
