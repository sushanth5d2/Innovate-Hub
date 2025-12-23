package com.innovatehub.native

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.File
import java.nio.ByteBuffer

/**
 * Native Android Video Processing using MediaCodec
 * Hardware-accelerated video compression and processing
 */
class NativeVideoProcessor {
    
    companion object {
        private const val TAG = "NativeVideoProcessor"
        private const val TIMEOUT_USEC = 10000L
    }
    
    /**
     * Compress video using hardware-accelerated H.264 encoder
     */
    fun compressVideo(
        inputPath: String,
        outputPath: String,
        quality: VideoQuality = VideoQuality.MEDIUM,
        onProgress: ((Float) -> Unit)? = null
    ): VideoCompressionResult {
        try {
            val extractor = MediaExtractor()
            extractor.setDataSource(inputPath)
            
            // Find video track
            var videoTrackIndex = -1
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/")) {
                    videoTrackIndex = i
                    break
                }
            }
            
            if (videoTrackIndex < 0) {
                return VideoCompressionResult(false, "No video track found")
            }
            
            val inputFormat = extractor.getTrackFormat(videoTrackIndex)
            extractor.selectTrack(videoTrackIndex)
            
            // Get video properties
            val width = inputFormat.getInteger(MediaFormat.KEY_WIDTH)
            val height = inputFormat.getInteger(MediaFormat.KEY_HEIGHT)
            val duration = inputFormat.getLong(MediaFormat.KEY_DURATION)
            
            // Create output format
            val outputFormat = createOutputFormat(width, height, quality)
            
            // Create encoder
            val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            encoder.configure(outputFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()
            
            // Create muxer
            val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            var muxerStarted = false
            var outputTrackIndex = -1
            
            val bufferInfo = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            
            val originalSize = File(inputPath).length()
            var compressedSize = 0L
            
            while (!outputDone) {
                // Feed input
                if (!inputDone) {
                    val inputBufferId = encoder.dequeueInputBuffer(TIMEOUT_USEC)
                    if (inputBufferId >= 0) {
                        val inputBuffer = encoder.getInputBuffer(inputBufferId)
                        val sampleSize = extractor.readSampleData(inputBuffer!!, 0)
                        
                        if (sampleSize < 0) {
                            encoder.queueInputBuffer(
                                inputBufferId, 0, 0, 0,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM
                            )
                            inputDone = true
                        } else {
                            val presentationTimeUs = extractor.sampleTime
                            encoder.queueInputBuffer(
                                inputBufferId, 0, sampleSize,
                                presentationTimeUs, 0
                            )
                            extractor.advance()
                            
                            // Report progress
                            val progress = (presentationTimeUs.toFloat() / duration) * 100
                            onProgress?.invoke(progress)
                        }
                    }
                }
                
                // Get output
                val outputBufferId = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_USEC)
                when {
                    outputBufferId == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        if (muxerStarted) {
                            throw RuntimeException("Format changed twice")
                        }
                        outputTrackIndex = muxer.addTrack(encoder.outputFormat)
                        muxer.start()
                        muxerStarted = true
                    }
                    outputBufferId >= 0 -> {
                        val outputBuffer = encoder.getOutputBuffer(outputBufferId)
                        
                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                            bufferInfo.size = 0
                        }
                        
                        if (bufferInfo.size != 0 && muxerStarted) {
                            outputBuffer?.position(bufferInfo.offset)
                            outputBuffer?.limit(bufferInfo.offset + bufferInfo.size)
                            muxer.writeSampleData(outputTrackIndex, outputBuffer!!, bufferInfo)
                            compressedSize += bufferInfo.size
                        }
                        
                        encoder.releaseOutputBuffer(outputBufferId, false)
                        
                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            outputDone = true
                        }
                    }
                }
            }
            
            // Cleanup
            extractor.release()
            encoder.stop()
            encoder.release()
            muxer.stop()
            muxer.release()
            
            val compressionRatio = ((originalSize - compressedSize).toFloat() / originalSize) * 100
            
            return VideoCompressionResult(
                success = true,
                message = "Video compressed successfully",
                originalSize = originalSize,
                compressedSize = compressedSize,
                compressionRatio = compressionRatio
            )
            
        } catch (e: Exception) {
            Log.e(TAG, "Video compression error", e)
            return VideoCompressionResult(false, e.message ?: "Unknown error")
        }
    }
    
    /**
     * Generate video thumbnail
     */
    fun generateThumbnail(videoPath: String, timeUs: Long = 0): android.graphics.Bitmap? {
        try {
            val retriever = android.media.MediaMetadataRetriever()
            retriever.setDataSource(videoPath)
            val bitmap = retriever.getFrameAtTime(
                timeUs,
                android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC
            )
            retriever.release()
            return bitmap
        } catch (e: Exception) {
            Log.e(TAG, "Thumbnail generation error", e)
            return null
        }
    }
    
    /**
     * Get video metadata
     */
    fun getVideoInfo(videoPath: String): VideoInfo? {
        try {
            val retriever = android.media.MediaMetadataRetriever()
            retriever.setDataSource(videoPath)
            
            val width = retriever.extractMetadata(
                android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH
            )?.toIntOrNull() ?: 0
            
            val height = retriever.extractMetadata(
                android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT
            )?.toIntOrNull() ?: 0
            
            val duration = retriever.extractMetadata(
                android.media.MediaMetadataRetriever.METADATA_KEY_DURATION
            )?.toLongOrNull() ?: 0
            
            val rotation = retriever.extractMetadata(
                android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION
            )?.toIntOrNull() ?: 0
            
            val bitrate = retriever.extractMetadata(
                android.media.MediaMetadataRetriever.METADATA_KEY_BITRATE
            )?.toLongOrNull() ?: 0
            
            retriever.release()
            
            return VideoInfo(
                width = width,
                height = height,
                duration = duration,
                rotation = rotation,
                bitrate = bitrate,
                fileSize = File(videoPath).length()
            )
        } catch (e: Exception) {
            Log.e(TAG, "Get video info error", e)
            return null
        }
    }
    
    private fun createOutputFormat(width: Int, height: Int, quality: VideoQuality): MediaFormat {
        val bitrate = when (quality) {
            VideoQuality.LOW -> 1_000_000  // 1 Mbps
            VideoQuality.MEDIUM -> 3_000_000  // 3 Mbps
            VideoQuality.HIGH -> 6_000_000  // 6 Mbps
        }
        
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
        format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        format.setInteger(MediaFormat.KEY_FRAME_RATE, 30)
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        format.setInteger(
            MediaFormat.KEY_COLOR_FORMAT,
            MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
        )
        
        return format
    }
    
    enum class VideoQuality {
        LOW, MEDIUM, HIGH
    }
    
    data class VideoCompressionResult(
        val success: Boolean,
        val message: String,
        val originalSize: Long = 0,
        val compressedSize: Long = 0,
        val compressionRatio: Float = 0f
    )
    
    data class VideoInfo(
        val width: Int,
        val height: Int,
        val duration: Long,
        val rotation: Int,
        val bitrate: Long,
        val fileSize: Long
    )
}
