// Image Filters using C++ for Performance
// Compile with: g++ -O3 -fPIC -shared -o image_filters.so image_filters.cpp

#include <iostream>
#include <vector>
#include <algorithm>
#include <cmath>

extern "C" {

// Apply Gaussian blur filter
void apply_gaussian_blur(unsigned char* image, int width, int height, int channels, float sigma) {
    int kernel_size = (int)(6 * sigma + 1);
    if (kernel_size % 2 == 0) kernel_size++;
    int radius = kernel_size / 2;
    
    // Create Gaussian kernel
    std::vector<float> kernel(kernel_size);
    float sum = 0.0f;
    
    for (int i = 0; i < kernel_size; i++) {
        int x = i - radius;
        kernel[i] = exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
    }
    
    // Normalize kernel
    for (int i = 0; i < kernel_size; i++) {
        kernel[i] /= sum;
    }
    
    // Create temporary buffer
    std::vector<unsigned char> temp(width * height * channels);
    
    // Horizontal pass
    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            for (int c = 0; c < channels; c++) {
                float sum = 0.0f;
                for (int k = -radius; k <= radius; k++) {
                    int px = std::max(0, std::min(width - 1, x + k));
                    sum += image[(y * width + px) * channels + c] * kernel[k + radius];
                }
                temp[(y * width + x) * channels + c] = (unsigned char)sum;
            }
        }
    }
    
    // Vertical pass
    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            for (int c = 0; c < channels; c++) {
                float sum = 0.0f;
                for (int k = -radius; k <= radius; k++) {
                    int py = std::max(0, std::min(height - 1, y + k));
                    sum += temp[(py * width + x) * channels + c] * kernel[k + radius];
                }
                image[(y * width + x) * channels + c] = (unsigned char)sum;
            }
        }
    }
}

// Sharpen filter
void apply_sharpen(unsigned char* image, int width, int height, int channels) {
    // Sharpen kernel
    float kernel[3][3] = {
        { 0, -1,  0},
        {-1,  5, -1},
        { 0, -1,  0}
    };
    
    std::vector<unsigned char> temp(width * height * channels);
    std::copy(image, image + width * height * channels, temp.begin());
    
    for (int y = 1; y < height - 1; y++) {
        for (int x = 1; x < width - 1; x++) {
            for (int c = 0; c < channels; c++) {
                float sum = 0.0f;
                
                for (int ky = -1; ky <= 1; ky++) {
                    for (int kx = -1; kx <= 1; kx++) {
                        int px = x + kx;
                        int py = y + ky;
                        sum += temp[(py * width + px) * channels + c] * kernel[ky + 1][kx + 1];
                    }
                }
                
                image[(y * width + x) * channels + c] = 
                    (unsigned char)std::max(0.0f, std::min(255.0f, sum));
            }
        }
    }
}

// Edge detection (Sobel)
void apply_edge_detection(unsigned char* image, int width, int height, int channels) {
    // Sobel kernels
    int sobel_x[3][3] = {
        {-1, 0, 1},
        {-2, 0, 2},
        {-1, 0, 1}
    };
    
    int sobel_y[3][3] = {
        {-1, -2, -1},
        { 0,  0,  0},
        { 1,  2,  1}
    };
    
    std::vector<unsigned char> temp(width * height * channels);
    std::copy(image, image + width * height * channels, temp.begin());
    
    for (int y = 1; y < height - 1; y++) {
        for (int x = 1; x < width - 1; x++) {
            for (int c = 0; c < channels; c++) {
                float gx = 0.0f, gy = 0.0f;
                
                for (int ky = -1; ky <= 1; ky++) {
                    for (int kx = -1; kx <= 1; kx++) {
                        int px = x + kx;
                        int py = y + ky;
                        unsigned char pixel = temp[(py * width + px) * channels + c];
                        gx += pixel * sobel_x[ky + 1][kx + 1];
                        gy += pixel * sobel_y[ky + 1][kx + 1];
                    }
                }
                
                float magnitude = sqrt(gx * gx + gy * gy);
                image[(y * width + x) * channels + c] = 
                    (unsigned char)std::min(255.0f, magnitude);
            }
        }
    }
}

// Brightness adjustment
void adjust_brightness(unsigned char* image, int width, int height, int channels, float factor) {
    int total_pixels = width * height * channels;
    
    for (int i = 0; i < total_pixels; i++) {
        float value = image[i] * factor;
        image[i] = (unsigned char)std::max(0.0f, std::min(255.0f, value));
    }
}

// Contrast adjustment
void adjust_contrast(unsigned char* image, int width, int height, int channels, float factor) {
    int total_pixels = width * height * channels;
    
    for (int i = 0; i < total_pixels; i++) {
        float value = ((image[i] - 128.0f) * factor) + 128.0f;
        image[i] = (unsigned char)std::max(0.0f, std::min(255.0f, value));
    }
}

// Fast resize using bilinear interpolation
void resize_bilinear(unsigned char* src, int src_width, int src_height,
                     unsigned char* dst, int dst_width, int dst_height, int channels) {
    float x_ratio = (float)src_width / dst_width;
    float y_ratio = (float)src_height / dst_height;
    
    for (int y = 0; y < dst_height; y++) {
        for (int x = 0; x < dst_width; x++) {
            float src_x = x * x_ratio;
            float src_y = y * y_ratio;
            
            int x1 = (int)src_x;
            int y1 = (int)src_y;
            int x2 = std::min(x1 + 1, src_width - 1);
            int y2 = std::min(y1 + 1, src_height - 1);
            
            float x_diff = src_x - x1;
            float y_diff = src_y - y1;
            
            for (int c = 0; c < channels; c++) {
                unsigned char p11 = src[(y1 * src_width + x1) * channels + c];
                unsigned char p12 = src[(y1 * src_width + x2) * channels + c];
                unsigned char p21 = src[(y2 * src_width + x1) * channels + c];
                unsigned char p22 = src[(y2 * src_width + x2) * channels + c];
                
                float value = p11 * (1 - x_diff) * (1 - y_diff) +
                            p12 * x_diff * (1 - y_diff) +
                            p21 * (1 - x_diff) * y_diff +
                            p22 * x_diff * y_diff;
                
                dst[(y * dst_width + x) * channels + c] = (unsigned char)value;
            }
        }
    }
}

} // extern "C"

// Compile instructions:
// g++ -O3 -fPIC -shared -o image_filters.so image_filters.cpp
// This creates a shared library that can be loaded from Python using ctypes
