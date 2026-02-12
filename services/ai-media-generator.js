/**
 * AI Media Generator Service
 * Handles: Text-to-Image, Text-to-Video, Image-to-Video generation
 * 
 * Providers:
 * - Pollinations.ai (FREE, no API key) — Text-to-Image
 * - HuggingFace Inference API (FREE tier) — Text-to-Image
 * - OpenAI DALL-E (paid) — Text-to-Image
 * - Multi-frame + ffmpeg — Text-to-Video, Image-to-Video (generates frames then compiles)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, exec } = require('child_process');
const sharp = require('sharp');

// Ensure output directories
const OUTPUT_DIR = path.resolve(__dirname, '../uploads/ai-generated');
['images', 'videos', 'frames'].forEach(sub => {
  const dir = path.join(OUTPUT_DIR, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Check ffmpeg availability
let FFMPEG_AVAILABLE = false;
try { execSync('which ffmpeg', { stdio: 'ignore' }); FFMPEG_AVAILABLE = true; } catch(e) {}
console.log(`[AI Media] ffmpeg available: ${FFMPEG_AVAILABLE}`);


// ===================== TEXT-TO-IMAGE =====================

/**
 * Generate image from text prompt using best available provider
 */
async function generateImage(prompt, options = {}) {
  const { width = 1280, height = 1280, style } = options;
  
  const errors = [];

  // 1. Try Pollinations.ai (always free, no key needed)
  try {
    return await generateImagePollinations(prompt, width, height, style);
  } catch (err) {
    errors.push(`Pollinations: ${err.message}`);
    console.log('Pollinations failed, trying next provider...');
  }

  // 2. Try HuggingFace
  if (process.env.HUGGINGFACE_API_KEY) {
    try {
      return await generateImageHuggingFace(prompt, width, height);
    } catch (err) {
      errors.push(`HuggingFace: ${err.message}`);
      console.log('HuggingFace image gen failed, trying next...');
    }
  }

  // 3. Try OpenAI DALL-E
  if (process.env.OPENAI_API_KEY) {
    try {
      return await generateImageDallE(prompt, options);
    } catch (err) {
      errors.push(`DALL-E: ${err.message}`);
    }
  }

  throw new Error(`Image generation failed with all providers. ${errors.join('; ')}`);
}

/**
 * Pollinations.ai — Completely free, no API key
 */
async function generateImagePollinations(prompt, width = 1280, height = 1280, style, seed) {
  // Enhance prompt for higher quality output
  const qualityPrefix = 'ultra high resolution, highly detailed, sharp focus, professional quality, 8k, ';
  const enhancedPrompt = qualityPrefix + prompt;
  const encodedPrompt = encodeURIComponent(enhancedPrompt);
  const styleParam = style ? `&style=${encodeURIComponent(style)}` : '';
  const useSeed = seed !== undefined ? seed : Math.floor(Math.random() * 999999);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${useSeed}&nologo=true&enhance=true&model=flux-realism${styleParam}`;

  console.log(`Generating HD image via Pollinations.ai (${width}x${height})...`);
  
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxRedirects: 5,
    validateStatus: (status) => status < 400
  });

  // Upscale to requested resolution with sharp (Pollinations may return lower res)
  const filename = `ai-img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  const filepath = path.join(OUTPUT_DIR, 'images', filename);

  const metadata = await sharp(response.data).metadata();
  const actualW = metadata.width || 768;
  const actualH = metadata.height || 768;

  if (actualW < width || actualH < height) {
    console.log(`Upscaling from ${actualW}x${actualH} to ${width}x${height}...`);
    await sharp(response.data)
      .resize(width, height, {
        kernel: sharp.kernel.lanczos3,
        fit: 'cover'
      })
      .sharpen({ sigma: 1.2, m1: 1.0, m2: 0.5 })
      .png({ quality: 95, compressionLevel: 6 })
      .toFile(filepath);
  } else {
    fs.writeFileSync(filepath, response.data);
  }

  return {
    url: `/uploads/ai-generated/images/${filename}`,
    filepath,
    provider: 'Pollinations.ai',
    prompt,
    width,
    height
  };
}

/**
 * HuggingFace Inference API — Stable Diffusion
 */
async function generateImageHuggingFace(prompt, width, height) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error('HuggingFace API key not configured');

  const model = 'stabilityai/stable-diffusion-xl-base-1.0';

  console.log(`Generating image via HuggingFace (${model})...`);

  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    { inputs: prompt },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer',
      timeout: 120000
    }
  );

  const filename = `ai-img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  const filepath = path.join(OUTPUT_DIR, 'images', filename);
  fs.writeFileSync(filepath, response.data);

  return {
    url: `/uploads/ai-generated/images/${filename}`,
    filepath,
    provider: 'HuggingFace (Stable Diffusion XL)',
    prompt,
    width,
    height
  };
}

/**
 * OpenAI DALL-E — Paid but highest quality
 */
async function generateImageDallE(prompt, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const size = options.size || '1024x1024';
  const quality = options.quality || 'standard';
  const model = 'dall-e-3';

  console.log('Generating image via DALL-E 3...');

  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    { model, prompt, n: 1, size, quality, response_format: 'b64_json' },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const imageData = response.data.data[0];
  const buffer = Buffer.from(imageData.b64_json, 'base64');
  const filename = `ai-img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  const filepath = path.join(OUTPUT_DIR, 'images', filename);
  fs.writeFileSync(filepath, buffer);

  return {
    url: `/uploads/ai-generated/images/${filename}`,
    filepath,
    provider: 'DALL-E 3',
    prompt: imageData.revised_prompt || prompt,
    width: parseInt(size.split('x')[0]),
    height: parseInt(size.split('x')[1])
  };
}


// ===================== TEXT-TO-VIDEO =====================

/**
 * Generate video from text prompt.
 * Strategy: Generate multiple image frames with varying seeds via Pollinations,
 * then compile them into an MP4 using ffmpeg.
 * Each frame uses a slightly modified prompt for natural motion.
 */
async function generateVideo(prompt, options = {}) {
  const { frames: numFrames = 8, fps = 2, width = 512, height = 512 } = options;
  
  if (!FFMPEG_AVAILABLE) {
    throw new Error('Video generation requires ffmpeg. Please install ffmpeg on the server.');
  }

  console.log(`Generating ${numFrames}-frame video for: "${prompt}"`);
  
  // Create temp frame directory
  const sessionId = `vid-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const frameDir = path.join(OUTPUT_DIR, 'frames', sessionId);
  fs.mkdirSync(frameDir, { recursive: true });

  // Generate prompt variations for smooth scene transitions
  const framePrompts = generateFramePrompts(prompt, numFrames);

  // Generate all frames via Pollinations (parallel, max 4 at a time)
  const baseSeed = Math.floor(Math.random() * 100000);
  const frameFiles = [];

  for (let batch = 0; batch < numFrames; batch += 4) {
    const batchPromises = [];
    for (let i = batch; i < Math.min(batch + 4, numFrames); i++) {
      const framePrompt = framePrompts[i];
      const seed = baseSeed + i * 111; // Sequential seeds for coherent frames
      batchPromises.push(
        generateSingleFrame(framePrompt, width, height, seed, frameDir, i)
      );
    }
    const results = await Promise.allSettled(batchPromises);
    for (const r of results) {
      if (r.status === 'fulfilled') frameFiles.push(r.value);
      else console.log('Frame generation failed:', r.reason?.message);
    }
  }

  if (frameFiles.length < 3) {
    // Cleanup
    try { fs.rmSync(frameDir, { recursive: true }); } catch(e) {}
    throw new Error(`Only ${frameFiles.length} frames generated. Need at least 3 for a video.`);
  }

  // Sort frames by index
  frameFiles.sort((a, b) => a.index - b.index);

  // Compile frames into MP4 using ffmpeg
  const outputFilename = `ai-vid-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, 'videos', outputFilename);

  try {
    // Create a concat file for ffmpeg to handle variable frame durations
    const concatFile = path.join(frameDir, 'frames.txt');
    let concatContent = '';
    for (const f of frameFiles) {
      // Show each frame for the duration (1/fps seconds), repeat last frame longer
      const duration = f.index === frameFiles.length - 1 ? 1.5 : (1 / fps);
      concatContent += `file '${f.path}'\nduration ${duration}\n`;
    }
    // ffmpeg concat demuxer needs the last file listed again
    concatContent += `file '${frameFiles[frameFiles.length - 1].path}'\n`;
    fs.writeFileSync(concatFile, concatContent);

    // ffmpeg: concat images → MP4 with smooth transition
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p" -c:v libx264 -preset fast -crf 23 -movflags +faststart "${outputPath}" 2>&1`;
    
    console.log('Compiling frames into video...');
    execSync(ffmpegCmd, { timeout: 30000 });

    // Cleanup frame directory
    try { fs.rmSync(frameDir, { recursive: true }); } catch(e) {}

    return {
      url: `/uploads/ai-generated/videos/${outputFilename}`,
      provider: 'Pollinations.ai + ffmpeg',
      prompt,
      type: 'video',
      frameCount: frameFiles.length,
      fps
    };
  } catch (err) {
    try { fs.rmSync(frameDir, { recursive: true }); } catch(e) {}
    throw new Error(`Video compilation failed: ${err.message}`);
  }
}

/**
 * Generate a single frame image for video compilation
 */
async function generateSingleFrame(prompt, width, height, seed, frameDir, index) {
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

  console.log(`  Generating frame ${index + 1}...`);
  
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxRedirects: 5,
    validateStatus: (s) => s < 400
  });

  const framePath = path.join(frameDir, `frame-${String(index).padStart(4, '0')}.png`);
  fs.writeFileSync(framePath, response.data);

  return { index, path: framePath };
}

/**
 * Generate varied prompts for each frame to create a sense of motion
 */
function generateFramePrompts(basePrompt, numFrames) {
  const timeProgression = [
    'beginning of the scene',
    'early moment',
    'the action starting',
    'mid-action',
    'peak moment',
    'the scene continuing',
    'later in the scene',
    'final moment of the scene'
  ];
  
  const prompts = [];
  for (let i = 0; i < numFrames; i++) {
    const timeIdx = Math.floor((i / numFrames) * timeProgression.length);
    const timeDesc = timeProgression[Math.min(timeIdx, timeProgression.length - 1)];
    // Subtle variation to maintain coherence but add motion
    prompts.push(`${basePrompt}, ${timeDesc}, cinematic, high quality, frame ${i + 1} of ${numFrames}`);
  }
  return prompts;
}


// ===================== IMAGE-TO-VIDEO =====================

/**
 * Animate a static image into a short video using ffmpeg.
 * Creates a Ken Burns effect (pan + zoom) on the source image.
 */
async function imageToVideo(imagePath, prompt, options = {}) {
  if (!FFMPEG_AVAILABLE) {
    throw new Error('Video generation requires ffmpeg. Please install ffmpeg on the server.');
  }

  const { duration = 5, effect = 'kenburns' } = options;

  // Resolve image path
  const fullPath = path.resolve(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(fullPath)) {
    throw new Error('Input image not found');
  }

  console.log(`Animating image to video (${effect} effect, ${duration}s)...`);

  const outputFilename = `ai-i2v-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, 'videos', outputFilename);

  try {
    let filterComplex;
    
    if (effect === 'kenburns') {
      // Ken Burns: slow zoom in + pan effect
      filterComplex = [
        `scale=8000:-1`,
        `zoompan=z='min(zoom+0.0015,1.5)':d=${duration * 25}:s=1024x1024:fps=25`,
        `format=yuv420p`
      ].join(',');
    } else if (effect === 'zoomout') {
      // Zoom out from center
      filterComplex = [
        `scale=8000:-1`,
        `zoompan=z='if(lte(zoom,1.0),1.5,max(1.001,zoom-0.003))':d=${duration * 25}:s=1024x1024:fps=25`,
        `format=yuv420p`
      ].join(',');
    } else {
      // Simple slow pan
      filterComplex = [
        `scale=8000:-1`,
        `zoompan=z='1.2':x='if(lte(on,1),(iw-iw/zoom)/2,x+1)':y='(ih-ih/zoom)/2':d=${duration * 25}:s=1024x1024:fps=25`,
        `format=yuv420p`
      ].join(',');
    }

    const ffmpegCmd = `ffmpeg -y -i "${fullPath}" -vf "${filterComplex}" -c:v libx264 -preset fast -crf 23 -t ${duration} -movflags +faststart "${outputPath}" 2>&1`;
    
    execSync(ffmpegCmd, { timeout: 60000 });

    return {
      url: `/uploads/ai-generated/videos/${outputFilename}`,
      provider: 'ffmpeg (Ken Burns)',
      type: 'video',
      sourceImage: imagePath,
      duration,
      effect
    };
  } catch (err) {
    throw new Error(`Image-to-video conversion failed: ${err.message}`);
  }
}


// ===================== UTILITY =====================

/**
 * Detect if a message is requesting media generation
 */
function detectGenerationIntent(message) {
  if (!message) return { type: null, prompt: '' };
  const lower = message.toLowerCase().trim();

  // Image generation patterns — explicit
  const imagePatterns = [
    /^(?:generate|create|make|draw|paint|design|produce|render)\s+(?:an?\s+)?(?:image|picture|photo|illustration|artwork|art|painting|drawing)\s+(?:of|about|showing|depicting|with|for)\s+(.+)/i,
    /^(?:generate|create|make|draw|paint|design|produce|render)\s+(?:an?\s+)?(?:image|picture|photo|illustration|artwork|art|painting|drawing)\s*:?\s+(.+)/i,
    /^\/imagine\s+(.+)/i,
    /^\/img\s+(.+)/i,
    /^(?:generate|create)\s+image\s*:?\s*(.+)/i
  ];

  for (const pattern of imagePatterns) {
    const match = lower.match(pattern);
    if (match) return { type: 'image', prompt: match[1].trim() };
  }

  // Video generation patterns — explicit
  const videoPatterns = [
    /^(?:generate|create|make|produce|render)\s+(?:an?\s+)?(?:video|clip|animation|motion)\s+(?:of|about|showing|depicting|with|for)\s+(.+)/i,
    /^(?:generate|create|make|produce|render)\s+(?:an?\s+)?(?:video|clip|animation|motion)\s*:?\s+(.+)/i,
    /^\/video\s+(.+)/i,
    /^(?:generate|create)\s+video\s*:?\s*(.+)/i
  ];

  for (const pattern of videoPatterns) {
    const match = lower.match(pattern);
    if (match) return { type: 'video', prompt: match[1].trim() };
  }

  // Image-to-video patterns
  const i2vPatterns = [
    /^(?:animate|convert|turn|transform|make)\s+(?:this|the|my)?\s*(?:image|picture|photo)?\s*(?:into|to|into a)?\s*(?:video|animation|motion|gif)/i,
    /^\/animate/i,
    /^\/i2v/i
  ];

  for (const pattern of i2vPatterns) {
    if (pattern.test(lower)) return { type: 'image-to-video', prompt: message };
  }

  // Trailing media keyword — "X image", "X picture"
  const trailingImageMatch = message.match(/^(.+)\s+(?:image|picture|photo|illustration|artwork|art|pic)\s*$/i);
  if (trailingImageMatch) {
    return { type: 'image', prompt: trailingImageMatch[1].trim() };
  }
  const trailingVideoMatch = message.match(/^(.+)\s+(?:video|clip|animation)\s*$/i);
  if (trailingVideoMatch) {
    return { type: 'video', prompt: trailingVideoMatch[1].trim() };
  }

  // Implicit image generation — "generate a [subject]" without specifying media type
  const implicitImagePattern = /^(?:generate|create|draw|paint|design|render|sketch|make me)\s+(?:an?\s+)?(.+)/i;
  const implicitMatch = message.match(implicitImagePattern);
  if (implicitMatch) {
    const subject = implicitMatch[1].trim().toLowerCase();
    const textKeywords = ['code', 'function', 'script', 'program', 'list', 'essay', 'email', 'letter', 'paragraph', 'story', 'poem', 'summary', 'table', 'report', 'plan', 'idea', 'name', 'title', 'password', 'response', 'answer', 'text', 'message', 'json', 'html', 'css', 'sql', 'api', 'query'];
    const isTextRequest = textKeywords.some(kw => subject.startsWith(kw + ' ') || subject === kw);
    if (!isTextRequest) {
      return { type: 'image', prompt: implicitMatch[1].trim() };
    }
  }

  return { type: null, prompt: '' };
}

/**
 * Get available generation capabilities
 */
function getCapabilities() {
  return {
    textToImage: true, // Pollinations is always available
    textToVideo: FFMPEG_AVAILABLE, // Need ffmpeg for frame compilation
    imageToVideo: FFMPEG_AVAILABLE, // Need ffmpeg for Ken Burns
    providers: {
      pollinations: { available: true, free: true, features: ['text-to-image'] },
      huggingface: { available: !!process.env.HUGGINGFACE_API_KEY, free: true, features: ['text-to-image'] },
      dalle: { available: !!process.env.OPENAI_API_KEY, free: false, features: ['text-to-image'] },
      ffmpeg: { available: FFMPEG_AVAILABLE, free: true, features: ['text-to-video', 'image-to-video'] }
    }
  };
}

module.exports = {
  generateImage,
  generateVideo,
  imageToVideo,
  detectGenerationIntent,
  getCapabilities
};
