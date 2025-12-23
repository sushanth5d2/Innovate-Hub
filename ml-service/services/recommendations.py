import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)

class RecommendationEngine:
    """Content-based and collaborative filtering recommendation engine"""
    
    def __init__(self):
        self.user_profiles = {}
        self.item_features = {}
        self.user_item_matrix = None
        
    def get_user_recommendations(self, user_id, limit=10):
        """
        Get personalized content recommendations for a user
        
        Uses collaborative filtering based on user interactions
        """
        try:
            # Mock recommendations for now - will be replaced with actual ML model
            recommendations = [
                {
                    'post_id': i,
                    'score': round(np.random.random(), 2),
                    'reason': 'Based on your interests' if i % 2 == 0 else 'Popular in your network',
                    'type': 'post'
                }
                for i in range(1, limit + 1)
            ]
            
            # Sort by score
            recommendations.sort(key=lambda x: x['score'], reverse=True)
            
            return recommendations
        except Exception as e:
            logger.error(f"Error in get_user_recommendations: {str(e)}")
            return []
    
    def get_similar_users(self, user_id, limit=10):
        """
        Find users with similar interests using collaborative filtering
        """
        try:
            # Mock similar users - will be replaced with actual similarity calculation
            similar_users = [
                {
                    'user_id': i,
                    'similarity_score': round(np.random.random(), 2),
                    'common_interests': ['technology', 'sports', 'music'][i % 3]
                }
                for i in range(1, limit + 1)
                if i != user_id
            ]
            
            # Sort by similarity score
            similar_users.sort(key=lambda x: x['similarity_score'], reverse=True)
            
            return similar_users
        except Exception as e:
            logger.error(f"Error in get_similar_users: {str(e)}")
            return []
    
    def train_model(self, user_interactions):
        """
        Train the recommendation model with user interaction data
        
        Args:
            user_interactions: List of dicts with user_id, item_id, interaction_type, timestamp
        """
        try:
            # Build user-item interaction matrix
            users = set()
            items = set()
            
            for interaction in user_interactions:
                users.add(interaction['user_id'])
                items.add(interaction['item_id'])
            
            # Create interaction matrix
            n_users = len(users)
            n_items = len(items)
            
            user_to_idx = {user: idx for idx, user in enumerate(users)}
            item_to_idx = {item: idx for idx, item in enumerate(items)}
            
            interaction_matrix = np.zeros((n_users, n_items))
            
            # Weight different interaction types
            weights = {
                'like': 1,
                'comment': 2,
                'share': 3,
                'save': 2
            }
            
            for interaction in user_interactions:
                user_idx = user_to_idx[interaction['user_id']]
                item_idx = item_to_idx[interaction['item_id']]
                interaction_type = interaction.get('interaction_type', 'like')
                
                interaction_matrix[user_idx][item_idx] += weights.get(interaction_type, 1)
            
            self.user_item_matrix = interaction_matrix
            
            # Calculate user similarity matrix
            user_similarity = cosine_similarity(interaction_matrix)
            
            return {
                'n_users': n_users,
                'n_items': n_items,
                'avg_similarity': float(np.mean(user_similarity)),
                'status': 'trained'
            }
        except Exception as e:
            logger.error(f"Error training model: {str(e)}")
            raise
    
    def get_content_recommendations(self, item_id, limit=10):
        """
        Get similar content based on content features
        """
        try:
            # Mock content-based recommendations
            recommendations = [
                {
                    'item_id': i,
                    'similarity_score': round(np.random.random(), 2),
                    'matching_features': ['topic', 'style', 'length'][i % 3]
                }
                for i in range(1, limit + 1)
                if i != item_id
            ]
            
            recommendations.sort(key=lambda x: x['similarity_score'], reverse=True)
            
            return recommendations
        except Exception as e:
            logger.error(f"Error in get_content_recommendations: {str(e)}")
            return []
