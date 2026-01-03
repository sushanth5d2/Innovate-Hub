from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv
import logging

# Import ML modules
from services.recommendations import RecommendationEngine
from services.analytics import AnalyticsEngine
from services.content_analysis import ContentAnalyzer
from services.image_processing import ImageProcessor
from services.video_processing import VideoProcessor

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize ML services
recommendation_engine = RecommendationEngine()
analytics_engine = AnalyticsEngine()
content_analyzer = ContentAnalyzer()
image_processor = ImageProcessor()
video_processor = VideoProcessor()

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'Innovate Hub ML Service',
        'version': '1.0.0'
    })

# Get user recommendations
@app.route('/api/recommendations/users/<int:user_id>', methods=['GET'])
def get_user_recommendations(user_id):
    """Get personalized content recommendations for a user"""
    try:
        limit = request.args.get('limit', default=10, type=int)
        recommendations = recommendation_engine.get_user_recommendations(user_id, limit)
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'recommendations': recommendations
        })
    except Exception as e:
        logger.error(f"Error getting recommendations: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get similar users
@app.route('/api/recommendations/similar-users/<int:user_id>', methods=['GET'])
def get_similar_users(user_id):
    """Find users with similar interests"""
    try:
        limit = request.args.get('limit', default=10, type=int)
        similar_users = recommendation_engine.get_similar_users(user_id, limit)
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'similar_users': similar_users
        })
    except Exception as e:
        logger.error(f"Error finding similar users: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Analyze content
@app.route('/api/analysis/content', methods=['POST'])
def analyze_content():
    """Analyze post content for sentiment, topics, etc."""
    try:
        data = request.json
        content = data.get('content', '')
        
        if not content:
            return jsonify({
                'success': False,
                'error': 'Content is required'
            }), 400
        
        analysis = content_analyzer.analyze(content)
        
        return jsonify({
            'success': True,
            'analysis': analysis
        })
    except Exception as e:
        logger.error(f"Error analyzing content: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get user analytics
@app.route('/api/analytics/user/<int:user_id>', methods=['GET'])
def get_user_analytics(user_id):
    """Get analytics and insights for a user"""
    try:
        analytics = analytics_engine.get_user_analytics(user_id)
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'analytics': analytics
        })
    except Exception as e:
        logger.error(f"Error getting analytics: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get trending topics
@app.route('/api/analytics/trending', methods=['GET'])
def get_trending_topics():
    """Get trending topics and hashtags"""
    try:
        timeframe = request.args.get('timeframe', default='24h', type=str)
        limit = request.args.get('limit', default=10, type=int)
        
        trending = analytics_engine.get_trending_topics(timeframe, limit)
        
        return jsonify({
            'success': True,
            'trending': trending
        })
    except Exception as e:
        logger.error(f"Error getting trending topics: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Train recommendation model
@app.route('/api/ml/train', methods=['POST'])
def train_model():
    """Train or retrain the recommendation model"""
    try:
        data = request.json
        user_interactions = data.get('user_interactions', [])
        
        if not user_interactions:
            return jsonify({
                'success': False,
                'error': 'Training data is required'
            }), 400
        
        result = recommendation_engine.train_model(user_interactions)
        
        return jsonify({
            'success': True,
            'message': 'Model trained successfully',
            'metrics': result
        })
    except Exception as e:
        logger.error(f"Error training model: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Image Processing Endpoints
@app.route('/api/image/optimize', methods=['POST'])
def optimize_image():
    """Optimize image for web/mobile"""
    try:
        data = request.json
        image_data = data.get('image')  # Base64 encoded
        max_size = data.get('max_size', [1920, 1080])
        quality = data.get('quality', 85)
        
        if not image_data:
            return jsonify({
                'success': False,
                'error': 'Image data is required'
            }), 400
        
        result = image_processor.optimize_image(
            image_data,
            tuple(max_size),
            quality
        )
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error optimizing image: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/image/filter', methods=['POST'])
def apply_image_filter():
    """Apply filter to image"""
    try:
        data = request.json
        image_data = data.get('image')
        filter_type = data.get('filter', 'none')
        
        if not image_data:
            return jsonify({
                'success': False,
                'error': 'Image data is required'
            }), 400
        
        result = image_processor.apply_filter(image_data, filter_type)
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error applying filter: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/image/thumbnail', methods=['POST'])
def generate_thumbnail():
    """Generate thumbnail from image"""
    try:
        data = request.json
        image_data = data.get('image')
        size = data.get('size', [150, 150])
        
        if not image_data:
            return jsonify({
                'success': False,
                'error': 'Image data is required'
            }), 400
        
        result = image_processor.generate_thumbnail(image_data, tuple(size))
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error generating thumbnail: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/image/colors', methods=['POST'])
def extract_colors():
    """Extract dominant colors from image"""
    try:
        data = request.json
        image_data = data.get('image')
        num_colors = data.get('num_colors', 5)
        
        if not image_data:
            return jsonify({
                'success': False,
                'error': 'Image data is required'
            }), 400
        
        result = image_processor.extract_dominant_colors(image_data, num_colors)
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error extracting colors: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Video Processing Endpoints
@app.route('/api/video/info', methods=['POST'])
def get_video_info():
    """Get video metadata"""
    try:
        data = request.json
        video_path = data.get('path')
        
        if not video_path:
            return jsonify({
                'success': False,
                'error': 'Video path is required'
            }), 400
        
        result = video_processor.get_video_info(video_path)
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error getting video info: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/video/compress', methods=['POST'])
def compress_video():
    """Compress video for web/mobile"""
    try:
        data = request.json
        input_path = data.get('input_path')
        output_path = data.get('output_path')
        quality = data.get('quality', 'medium')
        
        if not input_path or not output_path:
            return jsonify({
                'success': False,
                'error': 'Input and output paths are required'
            }), 400
        
        result = video_processor.compress_video(input_path, output_path, quality)
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error compressing video: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/video/thumbnail', methods=['POST'])
def generate_video_thumbnail():
    """Generate thumbnail from video"""
    try:
        data = request.json
        input_path = data.get('input_path')
        output_path = data.get('output_path')
        timestamp = data.get('timestamp', '00:00:01')
        
        if not input_path or not output_path:
            return jsonify({
                'success': False,
                'error': 'Input and output paths are required'
            }), 400
        
        result = video_processor.generate_video_thumbnail(
            input_path,
            output_path,
            timestamp
        )
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error generating video thumbnail: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Video validation endpoints for stories
@app.route('/api/video/validate-story', methods=['POST'])
def validate_story_video():
    """Validate video for story upload (max 120 seconds)"""
    try:
        data = request.get_json()
        video_path = data.get('video_path')
        
        if not video_path:
            return jsonify({
                'success': False,
                'error': 'video_path is required'
            }), 400
        
        # Get video info
        info = video_processor.get_video_info(video_path)
        
        if not info or 'duration' not in info:
            return jsonify({
                'success': False,
                'error': 'Could not read video information'
            }), 400
        
        duration = info['duration']
        max_duration = 120  # 120 seconds for stories
        
        is_valid = duration <= max_duration
        
        return jsonify({
            'success': True,
            'is_valid': is_valid,
            'duration': duration,
            'max_duration': max_duration,
            'message': 'Video is valid for story' if is_valid else f'Video too long. Max {max_duration}s, got {duration}s'
        })
        
    except Exception as e:
        logger.error(f'Error validating story video: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/video/duration', methods=['POST'])
def get_video_duration():
    """Get duration of a video file"""
    try:
        data = request.get_json()
        video_path = data.get('video_path')
        
        if not video_path:
            return jsonify({
                'success': False,
                'error': 'video_path is required'
            }), 400
        
        info = video_processor.get_video_info(video_path)
        
        if not info or 'duration' not in info:
            return jsonify({
                'success': False,
                'error': 'Could not read video information'
            }), 400
        
        return jsonify({
            'success': True,
            'duration': info['duration'],
            'duration_formatted': f"{int(info['duration'] // 60)}:{int(info['duration'] % 60):02d}"
        })
        
    except Exception as e:
        logger.error(f'Error getting video duration: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Hashtag suggestions using ML
@app.route('/api/content/suggest-hashtags', methods=['POST'])
def suggest_hashtags():
    """Suggest hashtags based on post content using ML"""
    try:
        data = request.get_json()
        content = data.get('content', '')
        
        if not content:
            return jsonify({
                'success': False,
                'error': 'content is required'
            }), 400
        
        # Analyze content
        analysis = content_analyzer.analyze(content)
        
        # Extract topics as hashtags
        suggested_hashtags = []
        
        # Add topics as hashtags
        if 'topics' in analysis:
            suggested_hashtags.extend([f"#{topic}" for topic in analysis['topics'][:5]])
        
        # Add extracted hashtags
        if 'hashtags' in analysis:
            suggested_hashtags.extend(analysis['hashtags'][:3])
        
        # Remove duplicates
        suggested_hashtags = list(set(suggested_hashtags))
        
        return jsonify({
            'success': True,
            'hashtags': suggested_hashtags[:8],  # Max 8 suggestions
            'sentiment': analysis.get('sentiment', 'neutral'),
            'quality_score': analysis.get('quality_score', 0)
        })
        
    except Exception as e:
        logger.error(f'Error suggesting hashtags: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Extract tasks from image (OCR + AI)
@app.route('/api/tasks/from-image', methods=['POST'])
def extract_tasks_from_image():
    """Extract task list from image using OCR"""
    try:
        data = request.get_json()
        image_data = data.get('image')  # Base64 encoded
        
        if not image_data:
            return jsonify({
                'success': False,
                'error': 'image data is required'
            }), 400
        
        # Try to use OCR (pytesseract) if available
        try:
            import pytesseract
            from PIL import Image
            import base64
            import io
            
            # Decode image
            image_bytes = base64.b64decode(image_data.split(',')[-1])
            img = Image.open(io.BytesIO(image_bytes))
            
            # Extract text
            text = pytesseract.image_to_string(img)
            
            if not text.strip():
                return jsonify({
                    'success': False,
                    'error': 'No text found in image'
                }), 400
            
            # Extract tasks from text
            tasks = content_analyzer.extract_tasks_from_text(text)
            
            if not tasks:
                return jsonify({
                    'success': False,
                    'error': 'No tasks found in extracted text',
                    'extracted_text': text
                }), 400
            
            # Generate title
            title = content_analyzer.generate_todo_title(tasks)
            
            return jsonify({
                'success': True,
                'tasks': tasks,
                'title': title,
                'extracted_text': text,
                'task_count': len(tasks)
            })
            
        except ImportError:
            # OCR not available, use simple pattern matching
            return jsonify({
                'success': False,
                'error': 'OCR not available. Please install pytesseract for image analysis.',
                'suggestion': 'Use text input instead'
            }), 501
        
    except Exception as e:
        logger.error(f'Error extracting tasks from image: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Story analytics
@app.route('/api/stories/analytics', methods=['POST'])
def get_story_analytics():
    """Get analytics for stories"""
    try:
        data = request.get_json()
        story_data = data.get('stories', [])
        
        if not story_data:
            return jsonify({
                'success': False,
                'error': 'stories array is required'
            }), 400
        
        # Calculate story metrics
        total_views = sum(story.get('views', 0) for story in story_data)
        total_stories = len(story_data)
        avg_views = total_views / total_stories if total_stories > 0 else 0
        
        # Find best performing story
        best_story = max(story_data, key=lambda x: x.get('views', 0)) if story_data else None
        
        return jsonify({
            'success': True,
            'analytics': {
                'total_stories': total_stories,
                'total_views': total_views,
                'average_views': round(avg_views, 2),
                'best_performing': best_story,
                'engagement_rate': round((total_views / total_stories) * 100, 2) if total_stories > 0 else 0
            }
        })
        
    except Exception as e:
        logger.error(f'Error calculating story analytics: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    # Prefer ML-specific port env vars to avoid conflict with Node's PORT=3000
    port_env = (
        os.getenv('ML_PORT')
        or os.getenv('PYTHON_ML_SERVICE_PORT')
        or os.getenv('PYTHON_ML_PORT')
        or os.getenv('FLASK_RUN_PORT')
        or os.getenv('PORT')  # fallback only if others not set
    )
    port = int(port_env) if port_env else 5000
    app.run(host='0.0.0.0', port=port, debug=os.getenv('DEBUG', 'False') == 'True')
