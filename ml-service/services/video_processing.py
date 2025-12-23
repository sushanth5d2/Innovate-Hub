import subprocess
import os
import logging
import json

# Try to import C++ video validator
try:
    from .video_validator_wrapper import get_validator
    CPP_VALIDATOR_AVAILABLE = True
except:
    CPP_VALIDATOR_AVAILABLE = False

logger = logging.getLogger(__name__)

class VideoProcessor:
    """
    Video processing using FFmpeg and C++ validator
    Handles compression, format conversion, thumbnail generation, validation
    """
    
    def __init__(self):
        self.ffmpeg_path = 'ffmpeg'
        self.supported_formats = ['mp4', 'webm', 'mov', 'avi']
        
        # Initialize C++ validator if available
        if CPP_VALIDATOR_AVAILABLE:
            try:
                self.cpp_validator = get_validator()
                logger.info("✅ C++ video validator loaded")
            except:
                self.cpp_validator = None
                logger.warning("⚠️  C++ validator failed to load")
        else:
            self.cpp_validator = None
            logger.info("ℹ️  C++ validator not available (using FFmpeg only)")
    
    def check_ffmpeg(self):
        """Check if FFmpeg is installed"""
        try:
            result = subprocess.run(
                [self.ffmpeg_path, '-version'],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except:
            return False
    
    def get_video_duration_cpp(self, video_path):
        """
        Get video duration using fast C++ parser
        Falls back to FFmpeg if C++ not available
        """
        if self.cpp_validator:
            duration = self.cpp_validator.get_duration(video_path)
            if duration > 0:
                return duration
        
        # Fallback to FFmpeg
        return self._get_duration_ffmpeg(video_path)
    
    def _get_duration_ffmpeg(self, video_path):
        """Get duration using FFmpeg (slower but more reliable)"""
        try:
            info = self.get_video_info(video_path)
            return info.get('duration', -1) if info else -1
        except:
            return -1
    
    def validate_story_video(self, video_path):
        """
        Validate video for story upload (max 120 seconds)
        Uses C++ for speed, FFmpeg as fallback
        
        Returns:
            dict: {
                'is_valid': bool,
                'duration': float,
                'max_duration': int,
                'message': str,
                'method': str  # 'cpp' or 'ffmpeg'
            }
        """
        max_duration = 120  # 120 seconds for stories
        
        # Try C++ validator first (much faster)
        if self.cpp_validator:
            try:
                result = self.cpp_validator.validate_story(video_path)
                result['method'] = 'cpp'
                result['max_duration'] = max_duration
                logger.info(f"✅ C++ validation: {result['message']}")
                return result
            except Exception as e:
                logger.warning(f"⚠️  C++ validation failed: {e}, using FFmpeg")
        
        # Fallback to FFmpeg
        duration = self._get_duration_ffmpeg(video_path)
        
        if duration < 0:
            return {
                'is_valid': False,
                'duration': -1,
                'max_duration': max_duration,
                'message': 'Could not read video duration',
                'method': 'error'
            }
        
        is_valid = duration <= max_duration
        
        return {
            'is_valid': is_valid,
            'duration': duration,
            'max_duration': max_duration,
            'message': f'Video is valid ({duration}s / {max_duration}s)' if is_valid else f'Video too long ({duration}s / {max_duration}s max)',
            'method': 'ffmpeg'
        }
    
    def compress_video(self, input_path, output_path, quality='medium'):
        """
        Compress video for web/mobile
        
        Args:
            input_path: Path to input video
            output_path: Path to save compressed video
            quality: 'low', 'medium', 'high'
        """
        try:
            if not self.check_ffmpeg():
                return {
                    'success': False,
                    'error': 'FFmpeg not installed. Install with: apt-get install ffmpeg'
                }
            
            # Quality presets
            quality_settings = {
                'low': {'crf': 28, 'preset': 'fast'},
                'medium': {'crf': 23, 'preset': 'medium'},
                'high': {'crf': 18, 'preset': 'slow'}
            }
            
            settings = quality_settings.get(quality, quality_settings['medium'])
            
            # FFmpeg command for H.264 compression
            command = [
                self.ffmpeg_path,
                '-i', input_path,
                '-c:v', 'libx264',
                '-crf', str(settings['crf']),
                '-preset', settings['preset'],
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',  # Enable streaming
                '-y',  # Overwrite output
                output_path
            ]
            
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            if result.returncode == 0:
                # Get file sizes
                original_size = os.path.getsize(input_path)
                compressed_size = os.path.getsize(output_path)
                compression_ratio = (1 - compressed_size / original_size) * 100
                
                return {
                    'success': True,
                    'output_path': output_path,
                    'original_size': original_size,
                    'compressed_size': compressed_size,
                    'compression_ratio': round(compression_ratio, 2),
                    'quality': quality
                }
            else:
                return {
                    'success': False,
                    'error': result.stderr
                }
                
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': 'Video compression timeout (file too large)'
            }
        except Exception as e:
            logger.error(f"Video compression error: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def generate_video_thumbnail(self, input_path, output_path, timestamp='00:00:01'):
        """
        Generate thumbnail from video at specific timestamp
        
        Args:
            input_path: Path to video
            output_path: Path to save thumbnail
            timestamp: Time position (HH:MM:SS)
        """
        try:
            if not self.check_ffmpeg():
                return {
                    'success': False,
                    'error': 'FFmpeg not installed'
                }
            
            command = [
                self.ffmpeg_path,
                '-i', input_path,
                '-ss', timestamp,
                '-vframes', '1',
                '-q:v', '2',
                '-y',
                output_path
            ]
            
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                return {
                    'success': True,
                    'thumbnail_path': output_path,
                    'timestamp': timestamp
                }
            else:
                return {
                    'success': False,
                    'error': result.stderr
                }
                
        except Exception as e:
            logger.error(f"Thumbnail generation error: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def get_video_info(self, input_path):
        """Get video metadata (duration, resolution, codec, etc.)"""
        try:
            if not self.check_ffmpeg():
                return {
                    'success': False,
                    'error': 'FFmpeg not installed'
                }
            
            command = [
                'ffprobe',
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                input_path
            ]
            
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                info = json.loads(result.stdout)
                
                # Extract useful information
                video_stream = next(
                    (s for s in info['streams'] if s['codec_type'] == 'video'),
                    None
                )
                
                if video_stream:
                    return {
                        'success': True,
                        'duration': float(info['format'].get('duration', 0)),
                        'size': int(info['format'].get('size', 0)),
                        'bitrate': int(info['format'].get('bit_rate', 0)),
                        'width': video_stream.get('width', 0),
                        'height': video_stream.get('height', 0),
                        'codec': video_stream.get('codec_name', 'unknown'),
                        'fps': eval(video_stream.get('r_frame_rate', '0/1'))
                    }
            
            return {
                'success': False,
                'error': 'Could not extract video info'
            }
            
        except Exception as e:
            logger.error(f"Video info error: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def convert_format(self, input_path, output_path, output_format='mp4'):
        """
        Convert video to different format
        
        Args:
            input_path: Input video path
            output_path: Output video path
            output_format: Target format (mp4, webm, etc.)
        """
        try:
            if not self.check_ffmpeg():
                return {
                    'success': False,
                    'error': 'FFmpeg not installed'
                }
            
            # Format-specific settings
            if output_format == 'webm':
                command = [
                    self.ffmpeg_path,
                    '-i', input_path,
                    '-c:v', 'libvpx-vp9',
                    '-crf', '30',
                    '-b:v', '0',
                    '-c:a', 'libopus',
                    '-y',
                    output_path
                ]
            else:  # mp4
                command = [
                    self.ffmpeg_path,
                    '-i', input_path,
                    '-c:v', 'libx264',
                    '-c:a', 'aac',
                    '-movflags', '+faststart',
                    '-y',
                    output_path
                ]
            
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if result.returncode == 0:
                return {
                    'success': True,
                    'output_path': output_path,
                    'format': output_format
                }
            else:
                return {
                    'success': False,
                    'error': result.stderr
                }
                
        except Exception as e:
            logger.error(f"Format conversion error: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
