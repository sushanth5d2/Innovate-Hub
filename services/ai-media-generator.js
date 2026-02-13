/**
 * AI Media Generator Service
 * Handles: Text-to-Image, Text-to-Video, Image-to-Video generation
 * 
 * Providers (tried in order):
 * 1. Pollinations.ai (FREE, no API key)
 * 2. Stable Horde (FREE, community-powered, no API key)
 * 3. HuggingFace Inference API (FREE tier, needs key)
 * 4. OpenAI DALL-E (paid, highest quality)
 * 
 * All images are upscaled to 4K (3840x2160) using sharp Lanczos3
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

// 4K resolution constants
const RESOLUTION_4K = { width: 3840, height: 2160 };
const RESOLUTION_4K_SQUARE = { width: 2160, height: 2160 };


// ===================== 4K UPSCALE UTILITY =====================

/**
 * Upscale image buffer to 4K resolution using Lanczos3 with sharpening
 */
async function upscaleTo4K(imageBuffer, targetWidth, targetHeight, outputPath) {
  const metadata = await sharp(imageBuffer).metadata();
  const srcW = metadata.width || 512;
  const srcH = metadata.height || 512;

  // Calculate target dimensions maintaining aspect ratio if not specified
  let finalW = targetWidth || RESOLUTION_4K.width;
  let finalH = targetHeight || RESOLUTION_4K.height;

  // If source is square-ish, use square 4K
  if (Math.abs(srcW - srcH) < srcW * 0.15) {
    finalW = Math.max(finalW, RESOLUTION_4K_SQUARE.width);
    finalH = Math.max(finalH, RESOLUTION_4K_SQUARE.height);
  }

  console.log(`[AI Media] Upscaling from ${srcW}x${srcH} → ${finalW}x${finalH} (4K)...`);

  await sharp(imageBuffer)
    .resize(finalW, finalH, {
      kernel: sharp.kernel.lanczos3,
      fit: 'cover',
      position: 'centre'
    })
    .sharpen({ sigma: 1.5, m1: 1.2, m2: 0.7 })
    .png({ compressionLevel: 4, effort: 7 })
    .toFile(outputPath);

  return { width: finalW, height: finalH };
}


// ===================== TEXT-TO-IMAGE =====================

/**
 * Generate image from text prompt using best available provider,
 * then upscale to 4K quality
 */
async function generateImage(prompt, options = {}) {
  const { width = 3840, height = 2160, style } = options;
  
  const errors = [];

  // 1. Try Pollinations.ai (free, no key needed)
  try {
    return await generateImagePollinations(prompt, width, height, style);
  } catch (err) {
    errors.push(`Pollinations: ${err.message}`);
    console.log('[AI Media] Pollinations failed, trying next provider...');
  }

  // 2. Try Stable Horde (free, community-powered, no key)
  try {
    return await generateImageStableHorde(prompt, width, height);
  } catch (err) {
    errors.push(`StableHorde: ${err.message}`);
    console.log('[AI Media] Stable Horde failed, trying next provider...');
  }

  // 3. Try HuggingFace
  if (process.env.HUGGINGFACE_API_KEY) {
    try {
      return await generateImageHuggingFace(prompt, width, height);
    } catch (err) {
      errors.push(`HuggingFace: ${err.message}`);
      console.log('[AI Media] HuggingFace image gen failed, trying next...');
    }
  }

  // 4. Try OpenAI DALL-E
  if (process.env.OPENAI_API_KEY) {
    try {
      return await generateImageDallE(prompt, options);
    } catch (err) {
      errors.push(`DALL-E: ${err.message}`);
    }
  }

  throw new Error(`Image generation failed with all providers. ${errors.join('; ')}`);
}


// ===================== POLLINATIONS =====================

/**
 * Pollinations.ai — Completely free, no API key
 */
async function generateImagePollinations(prompt, targetWidth = 3840, targetHeight = 2160, style, seed) {
  // Enhance prompt for higher quality output
  const qualityPrefix = 'ultra high resolution, highly detailed, sharp focus, professional quality, 8k, ';
  const enhancedPrompt = qualityPrefix + prompt;
  const encodedPrompt = encodeURIComponent(enhancedPrompt);
  const styleParam = style ? `&style=${encodeURIComponent(style)}` : '';
  const useSeed = seed !== undefined ? seed : Math.floor(Math.random() * 999999);
  // Request at max native resolution (Pollinations caps around 1280)
  const nativeW = Math.min(targetWidth, 1280);
  const nativeH = Math.min(targetHeight, 1280);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${nativeW}&height=${nativeH}&seed=${useSeed}&nologo=true&enhance=true&model=flux-realism${styleParam}`;

  console.log(`[AI Media] Generating image via Pollinations.ai (${nativeW}x${nativeH}, will upscale to 4K)...`);
  
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxRedirects: 5,
    validateStatus: (status) => status < 400
  });

  const filename = `ai-img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  const filepath = path.join(OUTPUT_DIR, 'images', filename);

  // Upscale to 4K
  const finalDims = await upscaleTo4K(response.data, targetWidth, targetHeight, filepath);

  return {
    url: `/uploads/ai-generated/images/${filename}`,
    filepath,
    provider: 'Pollinations.ai',
    prompt,
    width: finalDims.width,
    height: finalDims.height,
    quality: '4K'
  };
}


// ===================== STABLE HORDE =====================

/**
 * Stable Horde — Free, community-powered image generation
 * Async flow: submit job → poll for completion → download image
 */
async function generateImageStableHorde(prompt, targetWidth = 3840, targetHeight = 2160) {
  const enhancedPrompt = `${prompt}, ultra detailed, sharp focus, professional quality, 8k resolution, masterpiece`;

  // Submit async generation job (use 512x512 to stay within free-tier kudos)
  console.log('[AI Media] Generating image via Stable Horde (community, free)...');
  
  const submitResp = await axios.post(
    'https://stablehorde.net/api/v2/generate/async',
    {
      prompt: enhancedPrompt,
      params: {
        width: 512,
        height: 512,
        steps: 25,
        cfg_scale: 7,
        sampler_name: 'k_euler_a'
      },
      nsfw: false,
      models: ['stable_diffusion'],
      r2: true
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'apikey': '0000000000' // Anonymous key
      },
      timeout: 15000
    }
  );

  const jobId = submitResp.data?.id;
  if (!jobId) throw new Error('Stable Horde did not return a job ID');

  console.log(`[AI Media] Stable Horde job submitted: ${jobId}`);

  // Poll for completion (max 120 seconds)
  const maxWait = 120000;
  const startTime = Date.now();
  let done = false;

  while (!done && (Date.now() - startTime) < maxWait) {
    await new Promise(r => setTimeout(r, 4000)); // Poll every 4s

    const checkResp = await axios.get(
      `https://stablehorde.net/api/v2/generate/check/${jobId}`,
      { timeout: 10000 }
    );

    if (checkResp.data?.done) {
      done = true;
    } else if (checkResp.data?.faulted) {
      throw new Error('Stable Horde generation faulted');
    } else {
      const queuePos = checkResp.data?.queue_position || '?';
      const waitTime = checkResp.data?.wait_time || '?';
      console.log(`[AI Media] Stable Horde: queue position ${queuePos}, ETA ${waitTime}s`);
    }
  }

  if (!done) throw new Error('Stable Horde generation timed out (120s)');

  // Get the result
  const statusResp = await axios.get(
    `https://stablehorde.net/api/v2/generate/status/${jobId}`,
    { timeout: 15000 }
  );

  const generations = statusResp.data?.generations || [];
  if (generations.length === 0) throw new Error('Stable Horde returned no generations');

  const gen = generations[0];
  const imgUrl = gen.img;

  if (!imgUrl) throw new Error('Stable Horde returned no image URL');

  // Download the image
  console.log('[AI Media] Downloading generated image from Stable Horde...');
  const imgResp = await axios.get(imgUrl, {
    responseType: 'arraybuffer',
    timeout: 30000
  });

  const filename = `ai-img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  const filepath = path.join(OUTPUT_DIR, 'images', filename);

  // Upscale to 4K
  const finalDims = await upscaleTo4K(imgResp.data, targetWidth, targetHeight, filepath);

  return {
    url: `/uploads/ai-generated/images/${filename}`,
    filepath,
    provider: `Stable Horde (${gen.model || 'stable_diffusion'})`,
    prompt,
    width: finalDims.width,
    height: finalDims.height,
    quality: '4K'
  };
}


// ===================== HUGGINGFACE =====================

/**
 * HuggingFace Inference API — Stable Diffusion
 */
async function generateImageHuggingFace(prompt, targetWidth = 3840, targetHeight = 2160) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error('HuggingFace API key not configured');

  // Use FLUX.1-dev or SDXL (updated model names)
  const models = [
    'stabilityai/stable-diffusion-xl-base-1.0',
    'runwayml/stable-diffusion-v1-5'
  ];

  let lastErr = null;
  for (const model of models) {
    try {
      console.log(`[AI Media] Generating image via HuggingFace (${model})...`);

      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        { inputs: `${prompt}, ultra detailed, 4k quality, masterpiece` },
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

      // Upscale to 4K
      const finalDims = await upscaleTo4K(response.data, targetWidth, targetHeight, filepath);

      return {
        url: `/uploads/ai-generated/images/${filename}`,
        filepath,
        provider: `HuggingFace (${model.split('/')[1]})`,
        prompt,
        width: finalDims.width,
        height: finalDims.height,
        quality: '4K'
      };
    } catch (err) {
      lastErr = err;
      console.log(`[AI Media] HuggingFace ${model} failed: ${err.message}`);
      continue;
    }
  }

  throw lastErr || new Error('HuggingFace image generation failed');
}


// ===================== DALL-E =====================

/**
 * OpenAI DALL-E — Paid but highest quality
 */
async function generateImageDallE(prompt, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const size = options.size || '1024x1024';
  const quality = options.quality || 'hd';
  const model = 'dall-e-3';

  console.log('[AI Media] Generating image via DALL-E 3...');

  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    { model, prompt: `${prompt}, ultra detailed, 4K quality`, n: 1, size, quality, response_format: 'b64_json' },
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

  // Upscale to 4K
  const finalDims = await upscaleTo4K(buffer, 3840, 2160, filepath);

  return {
    url: `/uploads/ai-generated/images/${filename}`,
    filepath,
    provider: 'DALL-E 3',
    prompt: imageData.revised_prompt || prompt,
    width: finalDims.width,
    height: finalDims.height,
    quality: '4K'
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
 * Tries Gemini → Pollinations → Stable Horde
 */
async function generateSingleFrame(prompt, width, height, seed, frameDir, index) {
  console.log(`  Generating frame ${index + 1}...`);
  const framePath = path.join(frameDir, `frame-${String(index).padStart(4, '0')}.png`);

  // Try Pollinations
  try {
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400
    });
    fs.writeFileSync(framePath, response.data);
    return { index, path: framePath };
  } catch (err) {
    console.log(`  Frame ${index + 1} Pollinations failed: ${err.message}`);
  }

  // Try Stable Horde as last resort
  try {
    const submitResp = await axios.post(
      'https://stablehorde.net/api/v2/generate/async',
      {
        prompt: prompt,
        params: { width: Math.min(width, 512), height: Math.min(height, 512), steps: 20 },
        nsfw: false,
        r2: true
      },
      { headers: { 'Content-Type': 'application/json', 'apikey': '0000000000' }, timeout: 15000 }
    );
    const jobId = submitResp.data?.id;
    if (jobId) {
      // Poll for up to 60s
      for (let t = 0; t < 15; t++) {
        await new Promise(r => setTimeout(r, 4000));
        const check = await axios.get(`https://stablehorde.net/api/v2/generate/check/${jobId}`, { timeout: 10000 });
        if (check.data?.done) break;
      }
      const status = await axios.get(`https://stablehorde.net/api/v2/generate/status/${jobId}`, { timeout: 15000 });
      const imgUrl = status.data?.generations?.[0]?.img;
      if (imgUrl) {
        const imgResp = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 30000 });
        await sharp(imgResp.data).resize(width, height, { kernel: sharp.kernel.lanczos3, fit: 'cover' }).png().toFile(framePath);
        return { index, path: framePath };
      }
    }
  } catch (err) {
    console.log(`  Frame ${index + 1} Stable Horde failed: ${err.message}`);
  }

  throw new Error(`Failed to generate frame ${index + 1} with all providers`);
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
    textToImage: true,
    textToVideo: FFMPEG_AVAILABLE,
    imageToVideo: FFMPEG_AVAILABLE,
    quality: '4K (3840x2160)',
    providers: {
      pollinations: { available: true, free: true, features: ['text-to-image'], quality: '4K upscaled' },
      stableHorde: { available: true, free: true, features: ['text-to-image'], quality: '4K upscaled' },
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
