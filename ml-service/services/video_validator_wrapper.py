"""
C++ Video Validator Wrapper
Provides Python interface to high-performance C++ video validation
"""

import ctypes
import os
from pathlib import Path

class VideoValidator:
    """
    Python wrapper for C++ video validation library
    Provides fast video duration checking for stories
    """
    
    def __init__(self):
        """Initialize C++ library"""
        self.lib = None
        self._load_library()
    
    def _load_library(self):
        """Load the C++ shared library"""
        # Try to find the library
        lib_name = "video_validator.so"
        search_paths = [
            # Same directory as this file
            Path(__file__).parent / lib_name,
            # Native modules directory
            Path(__file__).parent / "native" / lib_name,
            # Build directory
            Path(__file__).parent.parent / "native-modules" / "cpp" / "build" / lib_name,
        ]
        
        for path in search_paths:
            if path.exists():
                try:
                    self.lib = ctypes.CDLL(str(path))
                    self._setup_functions()
                    print(f"✅ Loaded C++ video validator from {path}")
                    return
                except Exception as e:
                    print(f"⚠️  Failed to load {path}: {e}")
        
        print("⚠️  C++ video validator not found. Using Python fallback.")
    
    def _setup_functions(self):
        """Setup function signatures for C++ library"""
        if not self.lib:
            return
        
        # py_get_video_duration
        self.lib.py_get_video_duration.argtypes = [ctypes.c_char_p]
        self.lib.py_get_video_duration.restype = ctypes.c_double
        
        # py_validate_story_video
        self.lib.py_validate_story_video.argtypes = [
            ctypes.c_char_p,  # filepath
            ctypes.c_char_p,  # message buffer
            ctypes.c_int      # message buffer size
        ]
        self.lib.py_validate_story_video.restype = ctypes.c_int
    
    def get_duration(self, filepath):
        """
        Get video duration in seconds using C++
        
        Args:
            filepath: Path to video file
            
        Returns:
            float: Duration in seconds, or -1 if error
        """
        if not self.lib:
            return -1.0
        
        try:
            filepath_bytes = filepath.encode('utf-8')
            duration = self.lib.py_get_video_duration(filepath_bytes)
            return float(duration)
        except Exception as e:
            print(f"Error getting video duration: {e}")
            return -1.0
    
    def validate_story(self, filepath):
        """
        Validate video for story upload (max 120 seconds)
        
        Args:
            filepath: Path to video file
            
        Returns:
            dict: {
                'is_valid': bool,
                'duration': float,
                'message': str
            }
        """
        if not self.lib:
            return {
                'is_valid': False,
                'duration': -1.0,
                'message': 'C++ library not loaded'
            }
        
        try:
            filepath_bytes = filepath.encode('utf-8')
            message_buffer = ctypes.create_string_buffer(256)
            
            is_valid = self.lib.py_validate_story_video(
                filepath_bytes,
                message_buffer,
                256
            )
            
            duration = self.get_duration(filepath)
            
            return {
                'is_valid': bool(is_valid),
                'duration': duration,
                'message': message_buffer.value.decode('utf-8')
            }
        except Exception as e:
            return {
                'is_valid': False,
                'duration': -1.0,
                'message': f'Error: {str(e)}'
            }
    
    def validate_duration(self, filepath, max_seconds):
        """
        Validate video is under max_seconds
        
        Args:
            filepath: Path to video file
            max_seconds: Maximum allowed duration
            
        Returns:
            bool: True if valid, False otherwise
        """
        duration = self.get_duration(filepath)
        return duration > 0 and duration <= max_seconds


# Global instance
_validator_instance = None

def get_validator():
    """Get or create global validator instance"""
    global _validator_instance
    if _validator_instance is None:
        _validator_instance = VideoValidator()
    return _validator_instance


# Convenience functions
def validate_story_video(filepath):
    """Validate video for story upload"""
    validator = get_validator()
    return validator.validate_story(filepath)

def get_video_duration(filepath):
    """Get video duration in seconds"""
    validator = get_validator()
    return validator.get_duration(filepath)


if __name__ == '__main__':
    # Test the wrapper
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python video_validator_wrapper.py <video_file>")
        sys.exit(1)
    
    video_path = sys.argv[1]
    
    print(f"\nTesting C++ Video Validator")
    print(f"Video: {video_path}\n")
    
    validator = VideoValidator()
    
    # Test duration
    duration = validator.get_duration(video_path)
    print(f"Duration: {duration} seconds")
    
    # Test story validation
    result = validator.validate_story(video_path)
    print(f"Valid for story: {result['is_valid']}")
    print(f"Message: {result['message']}")
    
    # Test custom duration
    is_valid_60 = validator.validate_duration(video_path, 60)
    print(f"\nValid for 60s limit: {is_valid_60}")
