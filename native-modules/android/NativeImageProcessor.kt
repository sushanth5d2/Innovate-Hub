package com.innovatehub.native

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.renderscript.Allocation
import android.renderscript.Element
import android.renderscript.RenderScript
import android.renderscript.ScriptIntrinsicBlur
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * Native Android Image Processing using RenderScript and Kotlin
 * Provides hardware-accelerated image filters
 */
class NativeImageProcessor(private val context: Context) {
    
    private val renderScript: RenderScript = RenderScript.create(context)
    
    /**
     * Apply Gaussian blur using RenderScript (GPU-accelerated)
     */
    fun applyGaussianBlur(bitmap: Bitmap, radius: Float = 15f): Bitmap {
        val input = Allocation.createFromBitmap(renderScript, bitmap)
        val output = Allocation.createTyped(renderScript, input.type)
        
        val blurScript = ScriptIntrinsicBlur.create(renderScript, Element.U8_4(renderScript))
        blurScript.setRadius(radius.coerceIn(0f, 25f))
        blurScript.setInput(input)
        blurScript.forEach(output)
        
        output.copyTo(bitmap)
        
        input.destroy()
        output.destroy()
        blurScript.destroy()
        
        return bitmap
    }
    
    /**
     * Apply Instagram-like filters
     */
    fun applyFilter(bitmap: Bitmap, filterType: FilterType): Bitmap {
        return when (filterType) {
            FilterType.GRAYSCALE -> applyGrayscale(bitmap)
            FilterType.SEPIA -> applySepia(bitmap)
            FilterType.VINTAGE -> applyVintage(bitmap)
            FilterType.BRIGHTNESS -> adjustBrightness(bitmap, 1.2f)
            FilterType.CONTRAST -> adjustContrast(bitmap, 1.3f)
            FilterType.SATURATION -> adjustSaturation(bitmap, 1.5f)
            FilterType.BLUR -> applyGaussianBlur(bitmap, 10f)
            FilterType.SHARPEN -> applySharpen(bitmap)
            FilterType.NONE -> bitmap
        }
    }
    
    /**
     * Grayscale filter
     */
    private fun applyGrayscale(bitmap: Bitmap): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val r = (pixel shr 16) and 0xff
            val g = (pixel shr 8) and 0xff
            val b = pixel and 0xff
            
            val gray = (0.299 * r + 0.587 * g + 0.114 * b).toInt()
            pixels[i] = (0xff shl 24) or (gray shl 16) or (gray shl 8) or gray
        }
        
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }
    
    /**
     * Sepia filter
     */
    private fun applySepia(bitmap: Bitmap): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val r = (pixel shr 16) and 0xff
            val g = (pixel shr 8) and 0xff
            val b = pixel and 0xff
            
            val tr = (0.393 * r + 0.769 * g + 0.189 * b).toInt().coerceIn(0, 255)
            val tg = (0.349 * r + 0.686 * g + 0.168 * b).toInt().coerceIn(0, 255)
            val tb = (0.272 * r + 0.534 * g + 0.131 * b).toInt().coerceIn(0, 255)
            
            pixels[i] = (0xff shl 24) or (tr shl 16) or (tg shl 8) or tb
        }
        
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }
    
    /**
     * Vintage filter
     */
    private fun applyVintage(bitmap: Bitmap): Bitmap {
        var result = applySepia(bitmap)
        result = adjustSaturation(result, 0.7f)
        return adjustBrightness(result, 0.9f)
    }
    
    /**
     * Brightness adjustment
     */
    private fun adjustBrightness(bitmap: Bitmap, factor: Float): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val r = ((pixel shr 16) and 0xff)
            val g = ((pixel shr 8) and 0xff)
            val b = (pixel and 0xff)
            
            val nr = (r * factor).toInt().coerceIn(0, 255)
            val ng = (g * factor).toInt().coerceIn(0, 255)
            val nb = (b * factor).toInt().coerceIn(0, 255)
            
            pixels[i] = (0xff shl 24) or (nr shl 16) or (ng shl 8) or nb
        }
        
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }
    
    /**
     * Contrast adjustment
     */
    private fun adjustContrast(bitmap: Bitmap, factor: Float): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val r = ((pixel shr 16) and 0xff)
            val g = ((pixel shr 8) and 0xff)
            val b = (pixel and 0xff)
            
            val nr = (((r - 128) * factor) + 128).toInt().coerceIn(0, 255)
            val ng = (((g - 128) * factor) + 128).toInt().coerceIn(0, 255)
            val nb = (((b - 128) * factor) + 128).toInt().coerceIn(0, 255)
            
            pixels[i] = (0xff shl 24) or (nr shl 16) or (ng shl 8) or nb
        }
        
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }
    
    /**
     * Saturation adjustment
     */
    private fun adjustSaturation(bitmap: Bitmap, factor: Float): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val r = ((pixel shr 16) and 0xff) / 255f
            val g = ((pixel shr 8) and 0xff) / 255f
            val b = (pixel and 0xff) / 255f
            
            val gray = 0.299f * r + 0.587f * g + 0.114f * b
            
            val nr = ((gray + (r - gray) * factor) * 255).toInt().coerceIn(0, 255)
            val ng = ((gray + (g - gray) * factor) * 255).toInt().coerceIn(0, 255)
            val nb = ((gray + (b - gray) * factor) * 255).toInt().coerceIn(0, 255)
            
            pixels[i] = (0xff shl 24) or (nr shl 16) or (ng shl 8) or nb
        }
        
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }
    
    /**
     * Sharpen filter
     */
    private fun applySharpen(bitmap: Bitmap): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        
        val kernel = floatArrayOf(
            0f, -1f, 0f,
            -1f, 5f, -1f,
            0f, -1f, 0f
        )
        
        val newPixels = pixels.clone()
        
        for (y in 1 until height - 1) {
            for (x in 1 until width - 1) {
                var sumR = 0f
                var sumG = 0f
                var sumB = 0f
                
                for (ky in -1..1) {
                    for (kx in -1..1) {
                        val pixel = pixels[(y + ky) * width + (x + kx)]
                        val kernelValue = kernel[(ky + 1) * 3 + (kx + 1)]
                        
                        sumR += ((pixel shr 16) and 0xff) * kernelValue
                        sumG += ((pixel shr 8) and 0xff) * kernelValue
                        sumB += (pixel and 0xff) * kernelValue
                    }
                }
                
                val r = sumR.toInt().coerceIn(0, 255)
                val g = sumG.toInt().coerceIn(0, 255)
                val b = sumB.toInt().coerceIn(0, 255)
                
                newPixels[y * width + x] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        
        bitmap.setPixels(newPixels, 0, width, 0, 0, width, height)
        return bitmap
    }
    
    /**
     * Compress bitmap to JPEG with quality setting
     */
    fun compressBitmap(bitmap: Bitmap, quality: Int = 85): ByteArray {
        val outputStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
        return outputStream.toByteArray()
    }
    
    /**
     * Generate thumbnail
     */
    fun generateThumbnail(bitmap: Bitmap, maxWidth: Int = 150, maxHeight: Int = 150): Bitmap {
        val ratio = bitmap.width.toFloat() / bitmap.height.toFloat()
        val width: Int
        val height: Int
        
        if (ratio > 1) {
            width = maxWidth
            height = (maxWidth / ratio).toInt()
        } else {
            height = maxHeight
            width = (maxHeight * ratio).toInt()
        }
        
        return Bitmap.createScaledBitmap(bitmap, width, height, true)
    }
    
    fun cleanup() {
        renderScript.destroy()
    }
    
    enum class FilterType {
        NONE, GRAYSCALE, SEPIA, VINTAGE, BRIGHTNESS, 
        CONTRAST, SATURATION, BLUR, SHARPEN
    }
}
