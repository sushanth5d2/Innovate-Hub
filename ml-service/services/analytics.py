from datetime import datetime, timedelta
from collections import Counter, defaultdict
import logging

logger = logging.getLogger(__name__)

class AnalyticsEngine:
    """Analytics and insights engine for user data"""
    
    def __init__(self):
        self.analytics_cache = {}
    
    def get_user_analytics(self, user_id):
        """
        Get comprehensive analytics for a user
        
        Returns engagement metrics, growth trends, audience insights
        """
        try:
            # Mock analytics - will be replaced with actual data from database
            analytics = {
                'engagement': {
                    'total_posts': 45,
                    'total_likes': 1250,
                    'total_comments': 340,
                    'total_shares': 89,
                    'avg_engagement_rate': 0.078,
                    'engagement_trend': 'up'  # up, down, stable
                },
                'growth': {
                    'followers': 523,
                    'following': 287,
                    'follower_growth_7d': 34,
                    'follower_growth_30d': 127,
                    'growth_rate': 0.32
                },
                'content_performance': {
                    'best_performing_post': {
                        'post_id': 123,
                        'engagement_score': 0.95
                    },
                    'avg_likes_per_post': 27.8,
                    'avg_comments_per_post': 7.6,
                    'best_posting_time': '18:00-20:00',
                    'best_posting_day': 'Wednesday'
                },
                'audience_insights': {
                    'top_interests': ['technology', 'sports', 'music'],
                    'engagement_by_type': {
                        'posts': 65,
                        'comments': 25,
                        'shares': 10
                    },
                    'active_hours': ['17:00', '18:00', '19:00', '20:00']
                }
            }
            
            return analytics
        except Exception as e:
            logger.error(f"Error getting user analytics: {str(e)}")
            raise
    
    def get_trending_topics(self, timeframe='24h', limit=10):
        """
        Get trending topics and hashtags
        
        Args:
            timeframe: '24h', '7d', '30d'
            limit: number of trending topics to return
        """
        try:
            # Mock trending topics - will be replaced with actual data
            trending = [
                {
                    'topic': '#Innovation',
                    'mentions': 1234,
                    'growth': 45.2,
                    'sentiment': 'positive'
                },
                {
                    'topic': '#Technology',
                    'mentions': 987,
                    'growth': 32.1,
                    'sentiment': 'positive'
                },
                {
                    'topic': '#Sports',
                    'mentions': 856,
                    'growth': 28.5,
                    'sentiment': 'neutral'
                },
                {
                    'topic': '#Music',
                    'mentions': 745,
                    'growth': 22.3,
                    'sentiment': 'positive'
                },
                {
                    'topic': '#Art',
                    'mentions': 678,
                    'growth': 18.7,
                    'sentiment': 'positive'
                }
            ]
            
            return trending[:limit]
        except Exception as e:
            logger.error(f"Error getting trending topics: {str(e)}")
            raise
    
    def get_post_analytics(self, post_id):
        """Get detailed analytics for a specific post"""
        try:
            analytics = {
                'post_id': post_id,
                'views': 1234,
                'unique_views': 987,
                'likes': 156,
                'comments': 43,
                'shares': 23,
                'saves': 67,
                'engagement_rate': 0.089,
                'reach': 2340,
                'impressions': 3456,
                'click_through_rate': 0.034,
                'audience_demographics': {
                    'age_groups': {
                        '18-24': 35,
                        '25-34': 42,
                        '35-44': 18,
                        '45+': 5
                    },
                    'locations': [
                        {'country': 'US', 'percentage': 45},
                        {'country': 'UK', 'percentage': 25},
                        {'country': 'India', 'percentage': 15}
                    ]
                }
            }
            
            return analytics
        except Exception as e:
            logger.error(f"Error getting post analytics: {str(e)}")
            raise
    
    def predict_engagement(self, post_data):
        """
        Predict expected engagement for a post
        
        Args:
            post_data: dict with content, hashtags, posting_time, etc.
        """
        try:
            # Simple prediction model (can be improved with ML)
            base_score = 0.5
            
            # Factor in hashtags
            hashtag_count = len(post_data.get('hashtags', []))
            if 1 <= hashtag_count <= 5:
                base_score += 0.1
            
            # Factor in content length
            content_length = len(post_data.get('content', ''))
            if 100 <= content_length <= 300:
                base_score += 0.1
            
            # Factor in posting time
            posting_hour = post_data.get('posting_hour', 12)
            if 17 <= posting_hour <= 21:  # Peak hours
                base_score += 0.15
            
            # Factor in day of week
            posting_day = post_data.get('posting_day', 'Monday')
            if posting_day in ['Wednesday', 'Thursday', 'Friday']:
                base_score += 0.1
            
            prediction = {
                'expected_engagement_rate': round(min(base_score, 1.0), 2),
                'expected_likes': int(base_score * 200),
                'expected_comments': int(base_score * 50),
                'expected_shares': int(base_score * 20),
                'confidence': 0.75,
                'best_time_to_post': '18:00-20:00',
                'suggestions': []
            }
            
            # Add suggestions
            if hashtag_count == 0:
                prediction['suggestions'].append('Add relevant hashtags to increase discoverability')
            if content_length < 50:
                prediction['suggestions'].append('Consider adding more details to your post')
            if posting_hour < 17 or posting_hour > 21:
                prediction['suggestions'].append('Post during peak hours (6-9 PM) for better engagement')
            
            return prediction
        except Exception as e:
            logger.error(f"Error predicting engagement: {str(e)}")
            raise
