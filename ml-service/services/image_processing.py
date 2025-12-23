from PIL import Image
import numpy as np
import io
import base64
import logging

logger = logging.getLogger(__name__)

class ImageProcessor:
    """Advanced image processing using Python"""
    
    def __init__(self):
        self.supported_formats = ['JPEG', 'PNG', 'WEBP']
        
    def optimize_image(self, image_data, max_size=(1920, 1080), quality=85):
        """
        Optimize image for web/mobile
        
        Args:
            image_data: Binary image data or base64 string
            max_size: Maximum dimensions (width, height)
            quality: JPEG quality (1-100)
        """
        try:
            # Open image
            if isinstance(image_data, str):
                # Base64 encoded
                image_bytes = base64.b64decode(image_data)
                img = Image.open(io.BytesIO(image_bytes))
            else:
                img = Image.open(io.BytesIO(image_data))
            
            # Get original size
            original_size = img.size
            original_format = img.format
            
            # Resize if needed
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # Convert RGBA to RGB if saving as JPEG
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            
            # Save optimized
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=quality, optimize=True)
            optimized_data = output.getvalue()
            
            # Calculate compression ratio
            original_bytes = len(image_data) if isinstance(image_data, bytes) else len(base64.b64decode(image_data))
            optimized_bytes = len(optimized_data)
            compression_ratio = (1 - optimized_bytes / original_bytes) * 100
            
            return {
                'success': True,
                'optimized_image': base64.b64encode(optimized_data).decode('utf-8'),
                'original_size': original_size,
                'new_size': img.size,
                'original_bytes': original_bytes,
                'optimized_bytes': optimized_bytes,
                'compression_ratio': round(compression_ratio, 2),
                'format': 'JPEG'
            }
        except Exception as e:
            logger.error(f"Image optimization error: {str(e)}")
            raise
    
    def apply_filter(self, image_data, filter_type='none'):
        """
        Apply filters to image
        
        Filters: grayscale, sepia, blur, sharpen, edge_detect, vintage
        """
        try:
            # Open image
            if isinstance(image_data, str):
                image_bytes = base64.b64decode(image_data)
                img = Image.open(io.BytesIO(image_bytes))
            else:
                img = Image.open(io.BytesIO(image_data))
            
            # Apply filter
            if filter_type == 'grayscale':
                img = img.convert('L').convert('RGB')
            
            elif filter_type == 'sepia':
                img = img.convert('RGB')
                pixels = np.array(img, dtype=np.float32)
                
                # Sepia matrix
                sepia_filter = np.array([
                    [0.393, 0.769, 0.189],
                    [0.349, 0.686, 0.168],
                    [0.272, 0.534, 0.131]
                ])
                
                sepia_img = pixels @ sepia_filter.T
                sepia_img = np.clip(sepia_img, 0, 255).astype(np.uint8)
                img = Image.fromarray(sepia_img)
            
            elif filter_type == 'blur':
                from PIL import ImageFilter
                img = img.filter(ImageFilter.GaussianBlur(radius=2))
            
            elif filter_type == 'sharpen':
                from PIL import ImageFilter
                img = img.filter(ImageFilter.SHARPEN)
            
            elif filter_type == 'edge_detect':
                from PIL import ImageFilter
                img = img.filter(ImageFilter.FIND_EDGES)
            
            elif filter_type == 'vintage':
                # Vintage effect: desaturate + warm tones
                from PIL import ImageEnhance
                img = img.convert('RGB')
                
                # Reduce saturation
                enhancer = ImageEnhance.Color(img)
                img = enhancer.enhance(0.7)
                
                # Add warm tones
                pixels = np.array(img, dtype=np.float32)
                pixels[:, :, 0] = np.clip(pixels[:, :, 0] * 1.1, 0, 255)  # More red
                pixels[:, :, 2] = np.clip(pixels[:, :, 2] * 0.9, 0, 255)  # Less blue
                img = Image.fromarray(pixels.astype(np.uint8))
            
            # Save filtered image
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=90)
            filtered_data = output.getvalue()
            
            return {
                'success': True,
                'filtered_image': base64.b64encode(filtered_data).decode('utf-8'),
                'filter_applied': filter_type,
                'size': img.size
            }
        except Exception as e:
            logger.error(f"Filter application error: {str(e)}")
            raise
    
    def detect_faces(self, image_data):
        """
        Detect faces in image (basic implementation)
        For production, use face_recognition or OpenCV
        """
        try:
            # Placeholder for face detection
            # In production, integrate with face_recognition library
            return {
                'success': True,
                'faces_detected': 0,
                'note': 'Face detection requires opencv-python or face_recognition library'
            }
        except Exception as e:
            logger.error(f"Face detection error: {str(e)}")
            raise
    
    def generate_thumbnail(self, image_data, size=(150, 150)):
        """Generate thumbnail from image"""
        try:
            if isinstance(image_data, str):
                image_bytes = base64.b64decode(image_data)
                img = Image.open(io.BytesIO(image_bytes))
            else:
                img = Image.open(io.BytesIO(image_data))
            
            # Create thumbnail
            img.thumbnail(size, Image.Resampling.LANCZOS)
            
            # Save
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=85)
            thumbnail_data = output.getvalue()
            
            return {
                'success': True,
                'thumbnail': base64.b64encode(thumbnail_data).decode('utf-8'),
                'size': img.size
            }
        except Exception as e:
            logger.error(f"Thumbnail generation error: {str(e)}")
            raise
    
    def extract_dominant_colors(self, image_data, num_colors=5):
        """Extract dominant colors from image"""
        try:
            if isinstance(image_data, str):
                image_bytes = base64.b64decode(image_data)
                img = Image.open(io.BytesIO(image_bytes))
            else:
                img = Image.open(io.BytesIO(image_data))
            
            # Resize for faster processing
            img = img.resize((100, 100))
            img = img.convert('RGB')
            
            # Get pixel data
            pixels = np.array(img).reshape(-1, 3)
            
            # Simple clustering (k-means would be better)
            from collections import Counter
            pixel_list = [tuple(pixel) for pixel in pixels]
            color_counts = Counter(pixel_list)
            dominant_colors = color_counts.most_common(num_colors)
            
            colors = [
                {
                    'rgb': list(color),
                    'hex': '#{:02x}{:02x}{:02x}'.format(*color),
                    'percentage': round(count / len(pixel_list) * 100, 2)
                }
                for color, count in dominant_colors
            ]
            
            return {
                'success': True,
                'dominant_colors': colors
            }
        except Exception as e:
            logger.error(f"Color extraction error: {str(e)}")
            raise
