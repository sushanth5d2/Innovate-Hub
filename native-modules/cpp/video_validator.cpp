/**
 * Video Validator for Stories
 * High-performance C++ module for validating video duration
 * Used to ensure story videos are under 120 seconds
 */

#include <iostream>
#include <fstream>
#include <cstring>
#include <cstdint>
#include <vector>

// Video validation result structure
struct ValidationResult {
    bool is_valid;
    double duration;
    int max_duration;
    char message[256];
};

/**
 * Extract duration from MP4 file
 * Reads MP4 header to get video duration quickly
 */
double get_mp4_duration(const char* filepath) {
    std::ifstream file(filepath, std::ios::binary);
    if (!file.is_open()) {
        return -1.0;
    }
    
    // Read first 8KB (enough for most MP4 headers)
    std::vector<uint8_t> buffer(8192);
    file.read(reinterpret_cast<char*>(buffer.data()), buffer.size());
    size_t bytes_read = file.gcount();
    file.close();
    
    if (bytes_read < 100) {
        return -1.0;
    }
    
    // Look for 'mvhd' atom (Movie Header Atom)
    // This contains duration and timescale
    for (size_t i = 0; i < bytes_read - 100; i++) {
        if (buffer[i] == 'm' && buffer[i+1] == 'v' && 
            buffer[i+2] == 'h' && buffer[i+3] == 'd') {
            
            // Found mvhd atom
            // Skip version and flags (4 bytes)
            size_t pos = i + 4;
            
            // Skip creation time (4 or 8 bytes depending on version)
            uint8_t version = buffer[i-8];
            if (version == 1) {
                pos += 16; // 64-bit values
            } else {
                pos += 8; // 32-bit values
            }
            
            // Read timescale (4 bytes, big-endian)
            uint32_t timescale = 
                (buffer[pos] << 24) | 
                (buffer[pos+1] << 16) | 
                (buffer[pos+2] << 8) | 
                buffer[pos+3];
            pos += 4;
            
            // Read duration (4 or 8 bytes, big-endian)
            uint64_t duration_units;
            if (version == 1) {
                duration_units = 
                    ((uint64_t)buffer[pos] << 56) |
                    ((uint64_t)buffer[pos+1] << 48) |
                    ((uint64_t)buffer[pos+2] << 40) |
                    ((uint64_t)buffer[pos+3] << 32) |
                    ((uint64_t)buffer[pos+4] << 24) |
                    ((uint64_t)buffer[pos+5] << 16) |
                    ((uint64_t)buffer[pos+6] << 8) |
                    (uint64_t)buffer[pos+7];
            } else {
                duration_units = 
                    (buffer[pos] << 24) | 
                    (buffer[pos+1] << 16) | 
                    (buffer[pos+2] << 8) | 
                    buffer[pos+3];
            }
            
            // Calculate duration in seconds
            if (timescale > 0) {
                return (double)duration_units / (double)timescale;
            }
        }
    }
    
    return -1.0;
}

/**
 * Extract duration from WebM file
 * Reads WebM/MKV header
 */
double get_webm_duration(const char* filepath) {
    std::ifstream file(filepath, std::ios::binary);
    if (!file.is_open()) {
        return -1.0;
    }
    
    // Read first 16KB for WebM header
    std::vector<uint8_t> buffer(16384);
    file.read(reinterpret_cast<char*>(buffer.data()), buffer.size());
    size_t bytes_read = file.gcount();
    file.close();
    
    if (bytes_read < 100) {
        return -1.0;
    }
    
    // Simple duration extraction for WebM
    // Look for Duration element (ID: 0x4489)
    for (size_t i = 0; i < bytes_read - 12; i++) {
        if (buffer[i] == 0x44 && buffer[i+1] == 0x89) {
            // Found duration element
            size_t pos = i + 2;
            
            // Read length
            uint8_t length_byte = buffer[pos++];
            int length = length_byte & 0x7F;
            
            if (length == 8) {
                // Read 8-byte float (duration in milliseconds)
                uint64_t raw_value = 0;
                for (int j = 0; j < 8; j++) {
                    raw_value = (raw_value << 8) | buffer[pos + j];
                }
                
                double duration_ms = *reinterpret_cast<double*>(&raw_value);
                return duration_ms / 1000.0; // Convert to seconds
            }
        }
    }
    
    return -1.0;
}

/**
 * Get video duration from file
 * Supports MP4, WebM, MOV, AVI
 */
extern "C" double get_video_duration(const char* filepath) {
    if (!filepath) {
        return -1.0;
    }
    
    // Determine file type from extension
    const char* ext = strrchr(filepath, '.');
    if (!ext) {
        return -1.0;
    }
    
    ext++; // Skip the dot
    
    // Try MP4 format (also works for MOV)
    if (strcasecmp(ext, "mp4") == 0 || 
        strcasecmp(ext, "mov") == 0 || 
        strcasecmp(ext, "m4v") == 0) {
        return get_mp4_duration(filepath);
    }
    
    // Try WebM format
    if (strcasecmp(ext, "webm") == 0 || 
        strcasecmp(ext, "mkv") == 0) {
        return get_webm_duration(filepath);
    }
    
    // For other formats, return -1 (use FFmpeg fallback)
    return -1.0;
}

/**
 * Validate video duration for stories
 * Returns true if video is under max_seconds
 */
extern "C" bool validate_video_duration(const char* filepath, int max_seconds) {
    double duration = get_video_duration(filepath);
    
    if (duration < 0) {
        return false; // Could not read duration
    }
    
    return duration <= (double)max_seconds;
}

/**
 * Validate video for story with detailed result
 */
extern "C" ValidationResult validate_story_video(const char* filepath) {
    ValidationResult result;
    result.max_duration = 120; // 120 seconds for stories
    
    result.duration = get_video_duration(filepath);
    
    if (result.duration < 0) {
        result.is_valid = false;
        strcpy(result.message, "Could not read video duration");
        return result;
    }
    
    result.is_valid = result.duration <= result.max_duration;
    
    if (result.is_valid) {
        snprintf(result.message, sizeof(result.message), 
                "Video is valid (%.1fs / %ds)", 
                result.duration, result.max_duration);
    } else {
        snprintf(result.message, sizeof(result.message), 
                "Video too long (%.1fs / %ds max)", 
                result.duration, result.max_duration);
    }
    
    return result;
}

// Python integration wrapper
extern "C" {
    // Simple C interface for Python ctypes
    int py_validate_story_video(const char* filepath, char* message_out, int message_size) {
        ValidationResult result = validate_story_video(filepath);
        
        if (message_out && message_size > 0) {
            strncpy(message_out, result.message, message_size - 1);
            message_out[message_size - 1] = '\0';
        }
        
        return result.is_valid ? 1 : 0;
    }
    
    double py_get_video_duration(const char* filepath) {
        return get_video_duration(filepath);
    }
}

// Command-line testing
#ifdef BUILD_CLI
int main(int argc, char** argv) {
    if (argc < 2) {
        std::cout << "Usage: " << argv[0] << " <video_file>" << std::endl;
        return 1;
    }
    
    const char* filepath = argv[1];
    ValidationResult result = validate_story_video(filepath);
    
    std::cout << "Video: " << filepath << std::endl;
    std::cout << "Duration: " << result.duration << " seconds" << std::endl;
    std::cout << "Max Duration: " << result.max_duration << " seconds" << std::endl;
    std::cout << "Valid: " << (result.is_valid ? "YES" : "NO") << std::endl;
    std::cout << "Message: " << result.message << std::endl;
    
    return result.is_valid ? 0 : 1;
}
#endif
