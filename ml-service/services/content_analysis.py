import re
from collections import Counter
import logging

logger = logging.getLogger(__name__)

class ContentAnalyzer:
    """Analyze post content for sentiment, topics, and quality"""
    
    def __init__(self):
        # Simple sentiment words (can be expanded with ML models)
        self.positive_words = {
            'good', 'great', 'awesome', 'excellent', 'amazing', 'love', 'best',
            'wonderful', 'fantastic', 'happy', 'excited', 'beautiful', 'perfect'
        }
        self.negative_words = {
            'bad', 'terrible', 'awful', 'worst', 'hate', 'horrible', 'poor',
            'disappointing', 'sad', 'angry', 'ugly', 'boring'
        }
    
    def analyze(self, content):
        """
        Analyze content and return insights
        
        Returns:
            dict with sentiment, topics, hashtags, mentions, quality_score
        """
        try:
            analysis = {
                'sentiment': self._analyze_sentiment(content),
                'topics': self._extract_topics(content),
                'hashtags': self._extract_hashtags(content),
                'mentions': self._extract_mentions(content),
                'quality_score': self._calculate_quality_score(content),
                'word_count': len(content.split()),
                'char_count': len(content),
                'readability': self._calculate_readability(content)
            }
            
            return analysis
        except Exception as e:
            logger.error(f"Error analyzing content: {str(e)}")
            raise
    
    def _analyze_sentiment(self, content):
        """
        Simple sentiment analysis
        Returns: positive, negative, or neutral
        """
        content_lower = content.lower()
        words = re.findall(r'\b\w+\b', content_lower)
        
        positive_count = sum(1 for word in words if word in self.positive_words)
        negative_count = sum(1 for word in words if word in self.negative_words)
        
        if positive_count > negative_count:
            sentiment = 'positive'
            score = min(positive_count / max(len(words), 1) * 10, 1.0)
        elif negative_count > positive_count:
            sentiment = 'negative'
            score = min(negative_count / max(len(words), 1) * 10, 1.0)
        else:
            sentiment = 'neutral'
            score = 0.5
        
        return {
            'label': sentiment,
            'score': round(score, 2),
            'positive_words': positive_count,
            'negative_words': negative_count
        }
    
    def _extract_topics(self, content):
        """Extract main topics from content"""
        # Simple keyword extraction (can be improved with NLP)
        words = re.findall(r'\b\w{4,}\b', content.lower())
        
        # Remove common words
        stop_words = {'that', 'this', 'with', 'from', 'have', 'been', 'were', 'will'}
        words = [w for w in words if w not in stop_words]
        
        # Get most common words as topics
        word_freq = Counter(words)
        topics = [word for word, count in word_freq.most_common(5)]
        
        return topics
    
    def _extract_hashtags(self, content):
        """Extract hashtags from content"""
        hashtags = re.findall(r'#(\w+)', content)
        return hashtags
    
    def _extract_mentions(self, content):
        """Extract user mentions from content"""
        mentions = re.findall(r'@(\w+)', content)
        return mentions
    
    def _calculate_quality_score(self, content):
        """
        Calculate content quality score based on various factors
        Returns: score between 0 and 1
        """
        score = 0.5  # Base score
        
        # Length factor (optimal length around 100-300 chars)
        length = len(content)
        if 100 <= length <= 300:
            score += 0.2
        elif length > 50:
            score += 0.1
        
        # Has hashtags
        if '#' in content:
            score += 0.1
        
        # Has mentions (engagement potential)
        if '@' in content:
            score += 0.1
        
        # Sentiment bonus
        sentiment = self._analyze_sentiment(content)
        if sentiment['label'] == 'positive':
            score += 0.1
        
        return round(min(score, 1.0), 2)
    
    def _calculate_readability(self, content):
        """
        Simple readability score
        """
        words = content.split()
        if not words:
            return 0
        
        avg_word_length = sum(len(word) for word in words) / len(words)
        
        # Optimal word length is around 5-6 characters
        if 4 <= avg_word_length <= 7:
            readability = 'easy'
        elif avg_word_length < 4:
            readability = 'very_easy'
        else:
            readability = 'moderate'
        
        return readability
    
    def extract_tasks_from_text(self, text):
        """
        Extract task items from text (e.g., from image OCR)
        Returns list of tasks with priorities
        """
        try:
            tasks = []
            
            # Common task indicators
            task_markers = [
                r'^\s*[-•*]\s*(.+)$',  # Bullet points
                r'^\s*\d+[.)]\s*(.+)$',  # Numbered lists
                r'^\s*\[[ x]\]\s*(.+)$',  # Checkboxes
                r'^TODO:\s*(.+)$',  # TODO prefix
                r'^Task:\s*(.+)$',  # Task prefix
            ]
            
            # Priority keywords
            priority_high = ['urgent', 'asap', 'important', 'critical', 'priority']
            priority_low = ['optional', 'maybe', 'someday', 'low priority']
            
            lines = text.split('\n')
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # Try to match task markers
                task_text = None
                for pattern in task_markers:
                    match = re.match(pattern, line, re.IGNORECASE)
                    if match:
                        task_text = match.group(1).strip()
                        break
                
                # If no marker found, treat any line as potential task
                if not task_text and len(line) > 3:
                    task_text = line
                
                if task_text:
                    # Determine priority
                    priority = 'medium'
                    line_lower = task_text.lower()
                    
                    if any(word in line_lower for word in priority_high):
                        priority = 'high'
                    elif any(word in line_lower for word in priority_low):
                        priority = 'low'
                    
                    tasks.append({
                        'text': task_text,
                        'priority': priority,
                        'completed': False
                    })
            
            return tasks
        except Exception as e:
            logger.error(f"Error extracting tasks: {str(e)}")
            return []
    
    def generate_todo_title(self, tasks):
        """
        Generate a meaningful title from task list
        """
        if not tasks:
            return "Task List"
        
        # Common project keywords
        if any('meeting' in t['text'].lower() for t in tasks):
            return "Meeting Tasks"
        elif any('shop' in t['text'].lower() or 'buy' in t['text'].lower() for t in tasks):
            return "Shopping List"
        elif any('work' in t['text'].lower() or 'office' in t['text'].lower() for t in tasks):
            return "Work Tasks"
        elif any('home' in t['text'].lower() for t in tasks):
            return "Home Tasks"
        else:
            # Use first task as title (truncated)
            first_task = tasks[0]['text'][:30]
            if len(tasks) > 1:
                return f"{first_task}... ({len(tasks)} tasks)"
            return first_task
