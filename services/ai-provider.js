/**
 * AI Provider Service - Unified interface for multiple AI models
 * Supports: Innovate AI (custom smart router), OpenAI, Google Gemini, xAI Grok, 
 *           Anthropic Claude, DeepSeek, Groq (FREE), HuggingFace (FREE), 
 *           Ollama (LOCAL/FREE), LM Studio (LOCAL), GPT4All (LOCAL), Jan.ai (LOCAL),
 *           KoboldCPP (LOCAL), Cohere (FREE tier), Mistral (FREE tier), OpenRouter (FREE models)
 */

const axios = require('axios');

// ===================== Google GenAI SDK (Official) =====================
let _geminiClient = null;
function getGeminiClient() {
  if (!_geminiClient) {
    const { GoogleGenAI } = require('@google/genai');
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');
    _geminiClient = new GoogleGenAI({ apiKey });
  }
  return _geminiClient;
}

// ===================== Local AI Auto-Detection =====================
// Automatically detect local AI services — no env config needed

// Ollama (localhost:11434)
let ollamaAutoDetected = false;
let ollamaAvailableModels = [];

// LM Studio (localhost:1234) - OpenAI-compatible
let lmStudioDetected = false;
let lmStudioModels = [];

// GPT4All (localhost:4891) - OpenAI-compatible
let gpt4allDetected = false;
let gpt4allModels = [];

// Jan.ai (localhost:1337) - OpenAI-compatible
let janDetected = false;
let janModels = [];

// KoboldCPP (localhost:5001) - OpenAI-compatible
let koboldDetected = false;
let koboldModels = [];

// Pollinations AI (remote, free, no key needed)
let pollinationsAvailable = true; // Assume available initially

async function detectOllama() {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  try {
    const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 3000 });
    const models = response.data?.models || [];
    if (models.length > 0) {
      ollamaAutoDetected = true;
      ollamaAvailableModels = models.map(m => m.name);
      console.log(`[Ollama] Auto-detected with ${models.length} models: ${ollamaAvailableModels.join(', ')}`);
      // Dynamically register any Ollama models not already in AI_MODELS
      registerDynamicOllamaModels(ollamaAvailableModels);
    }
  } catch {
    ollamaAutoDetected = false;
    ollamaAvailableModels = [];
  }
}

/**
 * Dynamically register Ollama models that aren't hardcoded in AI_MODELS.
 * This ensures any model pulled via `ollama pull <model>` automatically
 * appears in the dropdown without needing code changes.
 */
function registerDynamicOllamaModels(modelNames) {
  for (const fullName of modelNames) {
    // Normalize: 'codellama:latest' -> 'codellama', 'qwen2.5:0.5b' stays as-is
    const baseName = fullName.replace(':latest', '');
    const modelId = `ollama/${baseName}`;

    // Skip if already defined
    if (AI_MODELS[modelId]) continue;

    // Generate a friendly display name from the model name
    const displayName = baseName
      .split(/[-_:/]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    AI_MODELS[modelId] = {
      provider: 'ollama',
      name: `${displayName} (Local)`,
      description: 'FREE LOCAL - Auto-detected Ollama model',
      maxTokens: 4096,
      envKey: '_AUTO_DETECT_',
      free: true,
      local: true
    };

    console.log(`[Ollama] Registered new model: ${modelId} → ${displayName}`);
  }
}

/**
 * Detect OpenAI-compatible local AI services (LM Studio, GPT4All, Jan.ai, KoboldCPP)
 * All expose /v1/models endpoint
 */
async function detectLocalAIService(name, baseUrl, timeout = 3000) {
  try {
    const response = await axios.get(`${baseUrl}/v1/models`, { timeout });
    const models = response.data?.data || [];
    const modelIds = models.map(m => m.id || m.name || 'default');
    if (modelIds.length > 0 || response.status === 200) {
      return { detected: true, models: modelIds.length > 0 ? modelIds : ['default'] };
    }
  } catch {
    // Some services don't have /v1/models, try a lightweight health check
    try {
      const healthResp = await axios.get(baseUrl, { timeout: 2000 });
      if (healthResp.status === 200) {
        return { detected: true, models: ['default'] };
      }
    } catch { /* not running */ }
  }
  return { detected: false, models: [] };
}

/**
 * Check if Pollinations AI is reachable
 */
async function detectPollinationsHealth() {
  try {
    const resp = await axios.get('https://text.pollinations.ai/openai/models', { timeout: 5000 });
    return resp.status === 200;
  } catch {
    return false;
  }
}

// ===================== OpenRouter Dynamic Model Fetching =====================
let openRouterModelsFetched = false;

/**
 * Fetch all available FREE models from OpenRouter API and register them dynamically.
 * Only registers free models (ending in :free).
 */
async function fetchOpenRouterModels() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return;

  try {
    const resp = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 10000
    });

    const models = resp.data?.data || [];
    if (models.length === 0) return;

    // Remove any existing dynamically-added OpenRouter models
    for (const key of Object.keys(AI_MODELS)) {
      if (key.startsWith('openrouter/') && AI_MODELS[key]._dynamic) {
        delete AI_MODELS[key];
      }
    }

    let freeCount = 0;

    for (const m of models) {
      const isFree = m.id.endsWith(':free');
      if (!isFree) continue; // Only register FREE models

      const modelId = `openrouter/${m.id}`;
      const contextLen = m.context_length || 4096;
      const maxOut = Math.min(m.top_provider?.max_completion_tokens || 4096, 4096);

      // Skip if already hardcoded
      if (AI_MODELS[modelId] && !AI_MODELS[modelId]._dynamic) continue;

      AI_MODELS[modelId] = {
        provider: 'openrouter',
        name: m.name || m.id,
        description: `FREE - ${contextLen > 100000 ? Math.round(contextLen / 1000) + 'K context' : contextLen + ' context'} via OpenRouter`,
        maxTokens: maxOut,
        envKey: 'OPENROUTER_API_KEY',
        free: true,
        _dynamic: true
      };

      freeCount++;
    }

    if (!openRouterModelsFetched) {
      console.log(`[OpenRouter] Loaded ${freeCount} free models`);
      openRouterModelsFetched = true;
    }
  } catch (err) {
    if (!openRouterModelsFetched) {
      console.log(`[OpenRouter] Failed to fetch models: ${err.message}`);
    }
  }
}

// ===================== Groq Dynamic Model Fetching =====================
let groqModelsFetched = false;

/**
 * Fetch all available models from Groq API and register them dynamically.
 * All Groq models are FREE.
 */
async function fetchGroqModels() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return;

  try {
    const resp = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 10000
    });

    const models = resp.data?.data || [];
    if (models.length === 0) return;

    // Remove existing dynamically-added Groq models
    for (const key of Object.keys(AI_MODELS)) {
      if (AI_MODELS[key]?.provider === 'groq' && AI_MODELS[key]._dynamic) {
        delete AI_MODELS[key];
      }
    }

    // Skip non-chat models (whisper = audio transcription, guard/safeguard = safety, embed = embeddings)
    const skipPatterns = ['whisper', 'guard', 'safeguard', 'embed'];
    let count = 0;

    for (const m of models) {
      const modelId = m.id;
      if (skipPatterns.some(p => modelId.toLowerCase().includes(p))) continue;

      // Skip if already hardcoded
      if (AI_MODELS[modelId] && !AI_MODELS[modelId]._dynamic) continue;

      // Generate a friendly name from model ID
      const name = modelId
        .replace(/^(meta-llama|canopylabs|moonshotai|openai|qwen)\//i, '')
        .replace(/-instruct$/i, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      AI_MODELS[modelId] = {
        provider: 'groq',
        name: name,
        description: 'FREE - Ultra-fast via Groq',
        maxTokens: 4096,
        envKey: 'GROQ_API_KEY',
        free: true,
        _dynamic: true
      };
      count++;
    }

    if (!groqModelsFetched) {
      console.log(`[Groq] Loaded ${count} free models`);
      groqModelsFetched = true;
    }
  } catch (err) {
    if (!groqModelsFetched) {
      console.log(`[Groq] Failed to fetch models: ${err.message}`);
    }
  }
}

// ===================== Mistral Dynamic Model Fetching =====================
let mistralModelsFetched = false;

/**
 * Fetch all available chat-capable models from Mistral API and register them dynamically.
 * All Mistral models are on the FREE tier.
 */
async function fetchMistralModels() {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return;

  try {
    const resp = await axios.get('https://api.mistral.ai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 10000
    });

    const models = resp.data?.data || [];
    if (models.length === 0) return;

    // Remove existing dynamically-added Mistral models
    for (const key of Object.keys(AI_MODELS)) {
      if (AI_MODELS[key]?.provider === 'mistral' && AI_MODELS[key]._dynamic) {
        delete AI_MODELS[key];
      }
    }

    // Only include chat-capable models, skip embed/moderation/ocr/transcribe
    const skipPatterns = ['embed', 'moderation', 'ocr', 'transcribe'];
    let count = 0;

    for (const m of models) {
      const modelId = m.id;
      const caps = m.capabilities || {};
      
      // Skip non-chat models
      if (caps.completion_chat === false) continue;
      if (skipPatterns.some(p => modelId.toLowerCase().includes(p))) continue;
      // Skip duplicate -latest aliases (keep versioned ones + latest)
      // Actually keep all - let user choose

      // Skip if already hardcoded
      if (AI_MODELS[modelId] && !AI_MODELS[modelId]._dynamic) continue;

      const name = modelId
        .replace(/-latest$/i, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      AI_MODELS[modelId] = {
        provider: 'mistral',
        name: name,
        description: 'FREE tier - Mistral AI',
        maxTokens: 4096,
        envKey: 'MISTRAL_API_KEY',
        free: true,
        _dynamic: true
      };
      count++;
    }

    if (!mistralModelsFetched) {
      console.log(`[Mistral] Loaded ${count} free models`);
      mistralModelsFetched = true;
    }
  } catch (err) {
    if (!mistralModelsFetched) {
      console.log(`[Mistral] Failed to fetch models: ${err.message}`);
    }
  }
}

async function detectAllLocalServices() {
  // Detect Ollama (has its own API format)
  await detectOllama();

  // Detect OpenAI-compatible local services in parallel
  const lmStudioUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234';
  const gpt4allUrl = process.env.GPT4ALL_URL || 'http://localhost:4891';
  const janUrl = process.env.JAN_AI_URL || 'http://localhost:1337';
  const koboldUrl = process.env.KOBOLDCPP_URL || 'http://localhost:5001';

  const [lmResult, gpt4allResult, janResult, koboldResult, pollinationsResult] = await Promise.allSettled([
    detectLocalAIService('LM Studio', lmStudioUrl),
    detectLocalAIService('GPT4All', gpt4allUrl),
    detectLocalAIService('Jan.ai', janUrl),
    detectLocalAIService('KoboldCPP', koboldUrl),
    detectPollinationsHealth(),
  ]);

  const prev = { lmStudioDetected, gpt4allDetected, janDetected, koboldDetected };

  if (lmResult.status === 'fulfilled') {
    lmStudioDetected = lmResult.value.detected;
    lmStudioModels = lmResult.value.models;
  } else { lmStudioDetected = false; lmStudioModels = []; }

  if (gpt4allResult.status === 'fulfilled') {
    gpt4allDetected = gpt4allResult.value.detected;
    gpt4allModels = gpt4allResult.value.models;
  } else { gpt4allDetected = false; gpt4allModels = []; }

  if (janResult.status === 'fulfilled') {
    janDetected = janResult.value.detected;
    janModels = janResult.value.models;
  } else { janDetected = false; janModels = []; }

  if (koboldResult.status === 'fulfilled') {
    koboldDetected = koboldResult.value.detected;
    koboldModels = koboldResult.value.models;
  } else { koboldDetected = false; koboldModels = []; }

  // Log newly detected services
  if (lmStudioDetected && !prev.lmStudioDetected) console.log(`[LM Studio] Auto-detected with models: ${lmStudioModels.join(', ')}`);
  if (gpt4allDetected && !prev.gpt4allDetected) console.log(`[GPT4All] Auto-detected with models: ${gpt4allModels.join(', ')}`);
  if (janDetected && !prev.janDetected) console.log(`[Jan.ai] Auto-detected with models: ${janModels.join(', ')}`);
  if (koboldDetected && !prev.koboldDetected) console.log(`[KoboldCPP] Auto-detected with models: ${koboldModels.join(', ')}`);

  // Log services that went offline
  if (!lmStudioDetected && prev.lmStudioDetected) console.log('[LM Studio] No longer detected');
  if (!gpt4allDetected && prev.gpt4allDetected) console.log('[GPT4All] No longer detected');
  if (!janDetected && prev.janDetected) console.log('[Jan.ai] No longer detected');
  if (!koboldDetected && prev.koboldDetected) console.log('[KoboldCPP] No longer detected');

  // Update Pollinations status
  const prevPollinations = pollinationsAvailable;
  if (pollinationsResult.status === 'fulfilled') {
    pollinationsAvailable = pollinationsResult.value;
  } else {
    pollinationsAvailable = false;
  }
  if (pollinationsAvailable && !prevPollinations) console.log('[Pollinations] Back online');
  if (!pollinationsAvailable && prevPollinations) console.log('[Pollinations] Offline — hiding from model list');
}

// Run auto-detection on startup
detectAllLocalServices();
// Re-check periodically (every 60 seconds)
setInterval(detectAllLocalServices, 60000);

// Fetch OpenRouter models on startup and refresh every 5 minutes
fetchOpenRouterModels();
setInterval(fetchOpenRouterModels, 5 * 60 * 1000);

// Fetch Groq models on startup and refresh every 5 minutes
fetchGroqModels();
setInterval(fetchGroqModels, 5 * 60 * 1000);

// Fetch Mistral models on startup and refresh every 5 minutes
fetchMistralModels();
setInterval(fetchMistralModels, 5 * 60 * 1000);

// ===================== Pollinations Dynamic Model Fetching =====================
let pollinationsModelsFetched = false;
let pollinationsDefaultModel = 'openai-fast'; // Fallback default

/**
 * Fetch all available text models from Pollinations API and register them dynamically.
 * All Pollinations models are FREE with no API key needed.
 */
async function fetchPollinationsModels() {
  try {
    const resp = await axios.get('https://text.pollinations.ai/models', { timeout: 10000 });
    const models = Array.isArray(resp.data) ? resp.data : [];
    if (models.length === 0) return;

    // Remove existing dynamically-added Pollinations models
    for (const key of Object.keys(AI_MODELS)) {
      if (AI_MODELS[key]?.provider === 'pollinations' && AI_MODELS[key]._dynamic) {
        delete AI_MODELS[key];
      }
    }

    // Filter to text-capable models only (must have text output)
    const textModels = models.filter(m => {
      const outputMods = m.output_modalities || [];
      return outputMods.includes('text');
    });

    let count = 0;
    for (const m of textModels) {
      const modelName = m.name;
      const modelId = `pollinations/${modelName}`;

      // Skip if already hardcoded (keep the base pollinations-openai entry)
      if (AI_MODELS[modelId] && !AI_MODELS[modelId]._dynamic) continue;

      const displayName = m.description || modelName
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      const features = [];
      if (m.vision) features.push('vision');
      if (m.reasoning) features.push('reasoning');
      if (m.tools) features.push('tools');
      if (m.audio) features.push('audio');
      const featureStr = features.length > 0 ? ` (${features.join(', ')})` : '';

      AI_MODELS[modelId] = {
        provider: 'pollinations',
        name: displayName,
        description: `FREE - No API key needed${featureStr}`,
        maxTokens: 4096,
        envKey: '_ALWAYS_AVAILABLE_',
        free: true,
        noKeyRequired: true,
        _dynamic: true,
        _pollinationsModelName: modelName,
        _vision: m.vision || false,
        _aliases: m.aliases || []
      };
      count++;
    }

    // Set the default model to the first available text model
    if (textModels.length > 0) {
      pollinationsDefaultModel = textModels[0].name;
    }

    // Update the static pollinations-openai entry to use the current default
    if (AI_MODELS['pollinations-openai']) {
      AI_MODELS['pollinations-openai']._pollinationsModelName = pollinationsDefaultModel;
    }

    pollinationsAvailable = true;
    if (!pollinationsModelsFetched) {
      console.log(`[Pollinations] Loaded ${count} free models (default: ${pollinationsDefaultModel})`);
      pollinationsModelsFetched = true;
    }
  } catch (err) {
    if (!pollinationsModelsFetched) {
      console.log(`[Pollinations] Failed to fetch models: ${err.message}`);
    }
  }
}

// Fetch Pollinations models on startup and refresh every 5 minutes
fetchPollinationsModels();
setInterval(fetchPollinationsModels, 5 * 60 * 1000);

// ===================== Provider Failure Cache =====================
// Skip providers that failed recently to avoid wasting time on retries
const providerFailureCache = new Map(); // key: 'provider:modelId' → timestamp of failure
const FAILURE_COOLDOWN_MS = 2 * 60 * 1000; // Skip failed providers for 2 minutes

function isProviderCoolingDown(provider, modelId) {
  const key = `${provider}:${modelId}`;
  const failedAt = providerFailureCache.get(key);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAILURE_COOLDOWN_MS) {
    providerFailureCache.delete(key);
    return false;
  }
  return true;
}

function markProviderFailed(provider, modelId) {
  providerFailureCache.set(`${provider}:${modelId}`, Date.now());
}

// ===================== INNOVATE AI - Custom Smart Engine =====================
// The platform's own AI that intelligently routes to the best available provider.
// No separate API key needed — it uses whatever keys the user has configured.
// Priority: Groq (fastest free) → Google Gemini → Mistral → Cohere → OpenRouter → HuggingFace → OpenAI → etc.

const INNOVATE_AI_PROVIDER_PRIORITY = [
  // Free/fast providers first
  { provider: 'groq', modelId: 'llama-3.3-70b-versatile', envKey: 'GROQ_API_KEY' },
  { provider: 'groq', modelId: 'meta-llama/llama-4-scout-17b-16e-instruct', envKey: 'GROQ_API_KEY' },
  // FREE zero-config — ALWAYS available, no API key needed
  { provider: 'pollinations', modelId: 'pollinations-openai', envKey: '_ALWAYS_AVAILABLE_' },
  // Ollama LOCAL — auto-detected, no config needed
  { provider: 'ollama', modelId: 'ollama/qwen2.5:0.5b', envKey: '_AUTO_DETECT_' },
  { provider: 'ollama', modelId: 'ollama/tinyllama', envKey: '_AUTO_DETECT_' },
  // LM Studio / GPT4All / Jan.ai / KoboldCPP — auto-detected local services
  { provider: 'lmstudio', modelId: 'lmstudio/default', envKey: '_AUTO_DETECT_' },
  { provider: 'gpt4all', modelId: 'gpt4all/default', envKey: '_AUTO_DETECT_' },
  { provider: 'jan', modelId: 'jan/default', envKey: '_AUTO_DETECT_' },
  { provider: 'koboldcpp', modelId: 'koboldcpp/default', envKey: '_AUTO_DETECT_' },
  // Gemini 3.x (newest)
  { provider: 'google', modelId: 'gemini-3.1-pro-preview', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-3-pro-preview', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-3-flash-preview', envKey: 'GOOGLE_AI_API_KEY' },
  // Gemini 2.5
  { provider: 'google', modelId: 'gemini-2.5-flash', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.5-pro', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.5-flash-lite', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.5-flash-preview', envKey: 'GOOGLE_AI_API_KEY' },
  // Gemini 2.0
  { provider: 'google', modelId: 'gemini-2.0-flash', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.0-flash-lite', envKey: 'GOOGLE_AI_API_KEY' },
  // Latest aliases
  { provider: 'google', modelId: 'gemini-flash-latest', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-pro-latest', envKey: 'GOOGLE_AI_API_KEY' },
  // Gemma open models
  { provider: 'google', modelId: 'gemma-3-27b-it', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'groq', modelId: 'qwen/qwen3-32b', envKey: 'GROQ_API_KEY' },
  { provider: 'mistral', modelId: 'mistral-small-latest', envKey: 'MISTRAL_API_KEY' },
  { provider: 'cohere', modelId: 'command-r-plus', envKey: 'COHERE_API_KEY' },
  { provider: 'openrouter', modelId: 'openrouter/meta-llama/llama-3.3-70b-instruct:free', envKey: 'OPENROUTER_API_KEY' },
  { provider: 'huggingface', modelId: 'mistralai/Mistral-7B-Instruct-v0.3', envKey: 'HUGGINGFACE_API_KEY' },
  // Premium fallbacks
  { provider: 'openai', modelId: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' },
  { provider: 'anthropic', modelId: 'claude-3-haiku-20240307', envKey: 'ANTHROPIC_API_KEY' },
  { provider: 'deepseek', modelId: 'deepseek-chat', envKey: 'DEEPSEEK_API_KEY' },
  { provider: 'xai', modelId: 'grok-2', envKey: 'XAI_API_KEY' },
  // Local fallback
  { provider: 'ollama', modelId: 'ollama/llama3.2', envKey: 'OLLAMA_ENABLED' },
  // Built-in fallback — always works, no external service needed
  { provider: 'builtin', modelId: 'builtin-fallback', envKey: '_ALWAYS_AVAILABLE_' },
];

const INNOVATE_AI_SYSTEM_PROMPT = `You are Innovate AI, the custom built-in AI assistant of the Innovate Hub social platform. 

Your personality:
- Friendly, approachable, and slightly witty
- You speak like a knowledgeable friend, not a corporate bot
- You're proud to be Innovate Hub's own AI
- You use emojis sparingly but naturally
- You give concise, well-structured answers
- You format code, lists, and complex info with markdown

Your capabilities:
- General knowledge and conversation
- Code help (write, debug, explain in any language)
- Creative writing (stories, poems, scripts)
- Analysis and summarization
- Math, science, and education
- Travel, fitness, cooking, and lifestyle advice
- Tech trends and news discussions

Rules:
- Never reveal which underlying model you're running on
- Always identify yourself as "Innovate AI" if asked who you are
- Keep responses focused and avoid unnecessary padding
- If you're unsure, say so honestly
- Be inclusive and respectful`;

// Available AI models configuration
const AI_MODELS = {
  // ==================== INNOVATE AI - Platform's Custom Model ====================
  'innovate-ai': {
    provider: 'innovate',
    name: 'Innovate AI',
    description: 'Our custom AI — smart, fast, and always available',
    maxTokens: 4096,
    envKey: '_INNOVATE_AI_AUTO_',
    free: true,
    custom: true
  },
  'innovate-ai-creative': {
    provider: 'innovate',
    name: 'Innovate AI Creative',
    description: 'Tuned for stories, ideas, and creative writing',
    maxTokens: 4096,
    envKey: '_INNOVATE_AI_AUTO_',
    free: true,
    custom: true
  },
  'innovate-ai-coder': {
    provider: 'innovate',
    name: 'Innovate AI Coder',
    description: 'Optimized for code generation and debugging',
    maxTokens: 4096,
    envKey: '_INNOVATE_AI_AUTO_',
    free: true,
    custom: true
  },
  // ==================== FREE / OPEN-SOURCE MODELS ====================

  // Groq models are loaded dynamically from the API at startup
  // See fetchGroqModels() — loads all available chat models automatically

  // HuggingFace - FREE inference API
  // Sign up: https://huggingface.co/settings/tokens (free)
  'mistralai/Mistral-7B-Instruct-v0.3': {
    provider: 'huggingface',
    name: 'Mistral 7B',
    description: 'FREE - Open-source via HuggingFace',
    maxTokens: 2048,
    envKey: 'HUGGINGFACE_API_KEY',
    free: true
  },
  'microsoft/Phi-3-mini-4k-instruct': {
    provider: 'huggingface',
    name: 'Phi-3 Mini',
    description: 'FREE - Microsoft\'s compact model',
    maxTokens: 2048,
    envKey: 'HUGGINGFACE_API_KEY',
    free: true
  },

  // Ollama - LOCAL, completely free, no API key needed
  'ollama/llama3.2': {
    provider: 'ollama',
    name: 'Llama 3.2 (Local)',
    description: 'FREE LOCAL - No API key needed',
    maxTokens: 4096,
    envKey: 'OLLAMA_ENABLED',
    free: true,
    local: true
  },
  'ollama/qwen2.5:0.5b': {
    provider: 'ollama',
    name: 'Qwen 2.5 (Local)',
    description: 'FREE LOCAL - Fast, compact model',
    maxTokens: 2048,
    envKey: '_AUTO_DETECT_',
    free: true,
    local: true
  },
  'ollama/tinyllama': {
    provider: 'ollama',
    name: 'TinyLlama (Local)',
    description: 'FREE LOCAL - Ultra-fast tiny model',
    maxTokens: 2048,
    envKey: '_AUTO_DETECT_',
    free: true,
    local: true
  },
  'ollama/mistral': {
    provider: 'ollama',
    name: 'Mistral (Local)',
    description: 'FREE LOCAL - No API key needed',
    maxTokens: 4096,
    envKey: 'OLLAMA_ENABLED',
    free: true,
    local: true
  },
  'ollama/phi3': {
    provider: 'ollama',
    name: 'Phi-3 (Local)',
    description: 'FREE LOCAL - Microsoft model',
    maxTokens: 4096,
    envKey: 'OLLAMA_ENABLED',
    free: true,
    local: true
  },
  'ollama/gemma2': {
    provider: 'ollama',
    name: 'Gemma 2 (Local)',
    description: 'FREE LOCAL - Google model',
    maxTokens: 4096,
    envKey: 'OLLAMA_ENABLED',
    free: true,
    local: true
  },

  // LM Studio - LOCAL, OpenAI-compatible (localhost:1234)
  'lmstudio/default': {
    provider: 'lmstudio',
    name: 'LM Studio',
    description: 'FREE LOCAL - Auto-detected LM Studio model',
    maxTokens: 4096,
    envKey: '_AUTO_DETECT_',
    free: true,
    local: true
  },

  // GPT4All - LOCAL, OpenAI-compatible (localhost:4891)
  'gpt4all/default': {
    provider: 'gpt4all',
    name: 'GPT4All',
    description: 'FREE LOCAL - Auto-detected GPT4All model',
    maxTokens: 4096,
    envKey: '_AUTO_DETECT_',
    free: true,
    local: true
  },

  // Jan.ai - LOCAL, OpenAI-compatible (localhost:1337)
  'jan/default': {
    provider: 'jan',
    name: 'Jan.ai',
    description: 'FREE LOCAL - Auto-detected Jan.ai model',
    maxTokens: 4096,
    envKey: '_AUTO_DETECT_',
    free: true,
    local: true
  },

  // KoboldCPP - LOCAL, OpenAI-compatible (localhost:5001)
  'koboldcpp/default': {
    provider: 'koboldcpp',
    name: 'KoboldCPP',
    description: 'FREE LOCAL - Auto-detected KoboldCPP model',
    maxTokens: 4096,
    envKey: '_AUTO_DETECT_',
    free: true,
    local: true
  },

  // Built-in fallback - always works, no external service needed
  'builtin-fallback': {
    provider: 'builtin',
    name: 'Innovate AI (Built-in)',
    description: 'Built-in fallback - always available',
    maxTokens: 2048,
    envKey: '_ALWAYS_AVAILABLE_',
    free: true,
    custom: true
  },

  // Cohere - FREE tier (1000 req/month)
  // Sign up: https://dashboard.cohere.com/api-keys (free)
  'command-r-plus': {
    provider: 'cohere',
    name: 'Command R+',
    description: 'FREE tier - Cohere\'s best model',
    maxTokens: 4096,
    envKey: 'COHERE_API_KEY',
    free: true
  },
  'command-r': {
    provider: 'cohere',
    name: 'Command R',
    description: 'FREE tier - Fast Cohere model',
    maxTokens: 4096,
    envKey: 'COHERE_API_KEY',
    free: true
  },

  // Mistral models are loaded dynamically from the API at startup
  // See fetchMistralModels() — loads all available chat models automatically

  // OpenRouter models are loaded dynamically from the API at startup
  // See fetchOpenRouterModels() — loads all free + paid models automatically

  // ==================== PREMIUM MODELS (Paid API keys) ====================

  // OpenAI Models
  'gpt-4o': {
    provider: 'openai',
    name: 'GPT-4o',
    description: 'Most capable OpenAI model with vision',
    maxTokens: 4096,
    envKey: 'OPENAI_API_KEY'
  },
  'gpt-4o-mini': {
    provider: 'openai',
    name: 'GPT-4o Mini',
    description: 'Fast and affordable OpenAI model',
    maxTokens: 4096,
    envKey: 'OPENAI_API_KEY'
  },
  'gpt-4-turbo': {
    provider: 'openai',
    name: 'GPT-4 Turbo',
    description: 'Powerful reasoning with large context',
    maxTokens: 4096,
    envKey: 'OPENAI_API_KEY'
  },
  'gpt-3.5-turbo': {
    provider: 'openai',
    name: 'GPT-3.5 Turbo',
    description: 'Fast and cost-effective',
    maxTokens: 4096,
    envKey: 'OPENAI_API_KEY'
  },

  // ===== Google Gemini Models (ALL 43 models from Google AI API) =====

  // --- Gemini 3.x Series (Latest & Most Powerful) ---
  'gemini-3.1-pro-preview': {
    provider: 'google',
    name: 'Gemini 3.1 Pro Preview',
    description: 'FREE - Newest Gemini 3.1 Pro, 1M context, 65K output',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-3.1-pro-preview-customtools': {
    provider: 'google',
    name: 'Gemini 3.1 Pro Custom Tools',
    description: 'FREE - Gemini 3.1 Pro optimized for custom tool usage',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-3-pro-preview': {
    provider: 'google',
    name: 'Gemini 3 Pro Preview',
    description: 'FREE - Gemini 3 Pro, 1M context, 65K output',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-3-flash-preview': {
    provider: 'google',
    name: 'Gemini 3 Flash Preview',
    description: 'FREE - Gemini 3 Flash, fast & powerful, 1M context',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-3-pro-image-preview': {
    provider: 'google',
    name: 'Gemini 3 Pro Image',
    description: 'FREE - Gemini 3 Pro with image generation, 128K context',
    maxTokens: 32768,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },

  // --- Gemini 2.5 Series ---
  'gemini-2.5-flash': {
    provider: 'google',
    name: 'Gemini 2.5 Flash',
    description: 'FREE - Stable 2.5 Flash with thinking, 1M context, 65K output',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.5-pro': {
    provider: 'google',
    name: 'Gemini 2.5 Pro',
    description: 'FREE - Stable 2.5 Pro, thinking, 1M context, 65K output',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.5-flash-lite': {
    provider: 'google',
    name: 'Gemini 2.5 Flash-Lite',
    description: 'FREE - Lightweight 2.5, 1M context, 65K output',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.5-flash-preview': {
    provider: 'google',
    name: 'Gemini 2.5 Flash Preview',
    description: 'FREE - Preview of Gemini 2.5 Flash',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.5-flash-image': {
    provider: 'google',
    name: 'Gemini 2.5 Flash Image',
    description: 'FREE - 2.5 Flash with image generation, 32K context',
    maxTokens: 32768,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.5-flash-lite-preview-09-2025': {
    provider: 'google',
    name: 'Gemini 2.5 Flash-Lite Preview Sep 2025',
    description: 'FREE - Preview of 2.5 Flash-Lite, 1M context',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },

  // --- Gemini 2.0 Series ---
  'gemini-2.0-flash': {
    provider: 'google',
    name: 'Gemini 2.0 Flash',
    description: 'FREE - Fast and versatile multimodal model, 1M context',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.0-flash-001': {
    provider: 'google',
    name: 'Gemini 2.0 Flash 001',
    description: 'FREE - Stable version of 2.0 Flash',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.0-flash-lite': {
    provider: 'google',
    name: 'Gemini 2.0 Flash-Lite',
    description: 'FREE - Lightweight, fastest Gemini 2.0 model',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.0-flash-lite-001': {
    provider: 'google',
    name: 'Gemini 2.0 Flash-Lite 001',
    description: 'FREE - Stable version of 2.0 Flash-Lite',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.0-flash-exp-image-generation': {
    provider: 'google',
    name: 'Gemini 2.0 Flash Image Gen',
    description: 'FREE - Experimental image generation model',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },

  // --- Gemini Latest Aliases ---
  'gemini-flash-latest': {
    provider: 'google',
    name: 'Gemini Flash Latest',
    description: 'FREE - Always points to latest Flash release, 1M context',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-flash-lite-latest': {
    provider: 'google',
    name: 'Gemini Flash-Lite Latest',
    description: 'FREE - Always points to latest Flash-Lite, 1M context',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-pro-latest': {
    provider: 'google',
    name: 'Gemini Pro Latest',
    description: 'FREE - Always points to latest Pro release, 1M context',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-1.5-pro-latest': {
    provider: 'google',
    name: 'Gemini 1.5 Pro',
    description: 'FREE - 1M context window',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-1.5-flash-latest': {
    provider: 'google',
    name: 'Gemini 1.5 Flash',
    description: 'FREE - Fast and versatile',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },

  // --- Special Purpose Gemini Models ---
  'gemini-2.5-computer-use-preview-10-2025': {
    provider: 'google',
    name: 'Gemini 2.5 Computer Use',
    description: 'FREE - Computer Use preview model, 128K context',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'deep-research-pro-preview-12-2025': {
    provider: 'google',
    name: 'Deep Research Pro',
    description: 'FREE - Deep Research model for complex queries, 128K context',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-robotics-er-1.5-preview': {
    provider: 'google',
    name: 'Gemini Robotics ER 1.5',
    description: 'FREE - Robotics embodied reasoning model, 1M context',
    maxTokens: 65536,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },

  // --- TTS & Audio Models ---
  'gemini-2.5-flash-preview-tts': {
    provider: 'google',
    name: 'Gemini 2.5 Flash TTS',
    description: 'FREE - Text-to-speech preview, 8K input',
    maxTokens: 16384,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.5-pro-preview-tts': {
    provider: 'google',
    name: 'Gemini 2.5 Pro TTS',
    description: 'FREE - Pro text-to-speech preview',
    maxTokens: 16384,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-2.5-flash-native-audio-latest': {
    provider: 'google',
    name: 'Gemini 2.5 Flash Native Audio',
    description: 'FREE - Native audio processing, 128K context',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },

  // --- Imagen (Image Generation) ---
  'imagen-4.0-generate-001': {
    provider: 'google',
    name: 'Imagen 4',
    description: 'Image generation model',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY'
  },
  'imagen-4.0-ultra-generate-001': {
    provider: 'google',
    name: 'Imagen 4 Ultra',
    description: 'Premium image generation',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY'
  },
  'imagen-4.0-fast-generate-001': {
    provider: 'google',
    name: 'Imagen 4 Fast',
    description: 'Fast image generation',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY'
  },

  // --- Veo (Video Generation) ---
  'veo-3.1-generate-preview': {
    provider: 'google',
    name: 'Veo 3.1',
    description: 'Latest video generation model',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY'
  },
  'veo-3.1-fast-generate-preview': {
    provider: 'google',
    name: 'Veo 3.1 Fast',
    description: 'Fast video generation',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY'
  },
  'veo-3.0-generate-001': {
    provider: 'google',
    name: 'Veo 3',
    description: 'Video generation model',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY'
  },
  'veo-3.0-fast-generate-001': {
    provider: 'google',
    name: 'Veo 3 Fast',
    description: 'Fast video generation',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY'
  },
  'veo-2.0-generate-001': {
    provider: 'google',
    name: 'Veo 2',
    description: 'Video generation model',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY'
  },

  // --- Embedding & QA Models ---
  'gemini-embedding-001': {
    provider: 'google',
    name: 'Gemini Embedding',
    description: 'Text embedding model',
    maxTokens: 1,
    envKey: 'GOOGLE_AI_API_KEY'
  },
  'aqa': {
    provider: 'google',
    name: 'Attributed QA',
    description: 'Grounded question answering model',
    maxTokens: 1024,
    envKey: 'GOOGLE_AI_API_KEY'
  },

  // --- Google Gemma Open Models (FREE via Gemini API) ---
  'gemma-3-27b-it': {
    provider: 'google',
    name: 'Gemma 3 27B',
    description: 'FREE - Open model, 128K context',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemma-3-12b-it': {
    provider: 'google',
    name: 'Gemma 3 12B',
    description: 'FREE - Open model, 32K context',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemma-3-4b-it': {
    provider: 'google',
    name: 'Gemma 3 4B',
    description: 'FREE - Small open model, 32K context',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemma-3-1b-it': {
    provider: 'google',
    name: 'Gemma 3 1B',
    description: 'FREE - Tiny open model, 32K context',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemma-3n-e4b-it': {
    provider: 'google',
    name: 'Gemma 3n E4B',
    description: 'FREE - Efficient edge model',
    maxTokens: 2048,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemma-3n-e2b-it': {
    provider: 'google',
    name: 'Gemma 3n E2B',
    description: 'FREE - Smallest edge model',
    maxTokens: 2048,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },

  // xAI Grok Models
  'grok-3': {
    provider: 'xai',
    name: 'Grok 3',
    description: 'Latest xAI flagship model',
    maxTokens: 4096,
    envKey: 'XAI_API_KEY'
  },
  'grok-2': {
    provider: 'xai',
    name: 'Grok 2',
    description: 'Powerful xAI reasoning model',
    maxTokens: 4096,
    envKey: 'XAI_API_KEY'
  },

  // Anthropic Claude Models
  'claude-sonnet-4-20250514': {
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    description: 'Latest balanced Claude model',
    maxTokens: 4096,
    envKey: 'ANTHROPIC_API_KEY'
  },
  'claude-3-5-sonnet-20241022': {
    provider: 'anthropic',
    name: 'Claude 3.5 Sonnet',
    description: 'Fast and intelligent Claude model',
    maxTokens: 4096,
    envKey: 'ANTHROPIC_API_KEY'
  },
  'claude-3-haiku-20240307': {
    provider: 'anthropic',
    name: 'Claude 3 Haiku',
    description: 'Fastest Claude model',
    maxTokens: 4096,
    envKey: 'ANTHROPIC_API_KEY'
  },

  // DeepSeek Models  
  'deepseek-chat': {
    provider: 'deepseek',
    name: 'DeepSeek V3',
    description: 'Powerful open-weight model',
    maxTokens: 4096,
    envKey: 'DEEPSEEK_API_KEY'
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    name: 'DeepSeek R1',
    description: 'Advanced reasoning model',
    maxTokens: 4096,
    envKey: 'DEEPSEEK_API_KEY'
  },

  // Pollinations - FREE, no API key needed, always available
  'pollinations-openai': {
    provider: 'pollinations',
    name: 'Pollinations AI',
    description: 'FREE - Always available, no API key needed',
    maxTokens: 4096,
    envKey: '_ALWAYS_AVAILABLE_',
    free: true,
    noKeyRequired: true
  }
};

// Provider API configurations
const PROVIDER_CONFIGS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  },
  google: {
    baseUrl: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: () => ({
      'Content-Type': 'application/json'
    })
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    })
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  },
  huggingface: {
    baseUrl: (model) => `https://api-inference.huggingface.co/models/${model}/v1/chat/completions`,
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    headers: () => ({
      'Content-Type': 'application/json'
    })
  },
  cohere: {
    baseUrl: 'https://api.cohere.com/v2/chat',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://innovate-hub.app',
      'X-Title': 'Innovate Hub AI Chat'
    })
  },
  pollinations: {
    baseUrl: 'https://text.pollinations.ai/openai',
    headers: () => ({
      'Content-Type': 'application/json'
    })
  }
};

// Vision-capable model priority (for image analysis)
const INNOVATE_AI_VISION_PRIORITY = [
  // Gemini 3.x (newest, most capable)
  { provider: 'google', modelId: 'gemini-3.1-pro-preview', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-3-pro-preview', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-3-flash-preview', envKey: 'GOOGLE_AI_API_KEY' },
  // Gemini 2.5
  { provider: 'google', modelId: 'gemini-2.5-flash', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.5-pro', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.5-flash-lite', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.5-flash-preview', envKey: 'GOOGLE_AI_API_KEY' },
  // Gemini 2.0
  { provider: 'google', modelId: 'gemini-2.0-flash', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-1.5-pro-latest', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-1.5-flash-latest', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'groq', modelId: 'meta-llama/llama-4-scout-17b-16e-instruct', envKey: 'GROQ_API_KEY' },
  { provider: 'groq', modelId: 'meta-llama/llama-4-maverick-17b-128e-instruct', envKey: 'GROQ_API_KEY' },
  { provider: 'openai', modelId: 'gpt-4o', envKey: 'OPENAI_API_KEY' },
  { provider: 'openai', modelId: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' },
  { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', envKey: 'ANTHROPIC_API_KEY' },
  { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', envKey: 'ANTHROPIC_API_KEY' },
  // FREE zero-config vision fallback - no API key needed
  { provider: 'pollinations', modelId: 'pollinations-openai', envKey: '_ALWAYS_AVAILABLE_' },
];

const SYSTEM_PROMPT = INNOVATE_AI_SYSTEM_PROMPT;

/**
 * Check if the Innovate AI meta-provider has any available backend
 */
function isInnovateAIAvailable() {
  return true; // Built-in fallback is always available even if Pollinations is down
}

/**
 * Get the best available backend for Innovate AI
 */
function getInnovateAIBackend() {
  for (const p of INNOVATE_AI_PROVIDER_PRIORITY) {
    if (p.provider === 'pollinations') {
      if (pollinationsAvailable) return p;
      continue; // Skip if Pollinations is down
    }
    if (p.provider === 'builtin') return p; // Always available
    if (p.provider === 'ollama') {
      if (ollamaAutoDetected || process.env.OLLAMA_ENABLED === 'true') return p;
    } else if (LOCAL_AI_PROVIDERS.includes(p.provider)) {
      if (isLocalProviderDetected(p.provider)) return p;
    } else {
      if (process.env[p.envKey]) return p;
    }
  }
  // Built-in fallback is always available
  return INNOVATE_AI_PROVIDER_PRIORITY[INNOVATE_AI_PROVIDER_PRIORITY.length - 1];
}

/**
 * Get list of available models (that have API keys configured)
 */
function isOllamaModelInstalled(modelId) {
  const modelName = modelId.replace('ollama/', '');
  return ollamaAvailableModels.some(m => m === modelName || m.startsWith(modelName + ':') || modelName.startsWith(m.split(':')[0]));
}

/**
 * Check if a local AI provider is detected and running
 */
function isLocalProviderDetected(provider) {
  switch (provider) {
    case 'lmstudio': return lmStudioDetected;
    case 'gpt4all': return gpt4allDetected;
    case 'jan': return janDetected;
    case 'koboldcpp': return koboldDetected;
    default: return false;
  }
}

const LOCAL_AI_PROVIDERS = ['lmstudio', 'gpt4all', 'jan', 'koboldcpp'];

function getAvailableModels() {
  const models = [];
  for (const [id, config] of Object.entries(AI_MODELS)) {
    let isAvailable;
    if (config.provider === 'innovate') {
      isAvailable = isInnovateAIAvailable();
    } else if (config.provider === 'pollinations') {
      isAvailable = pollinationsAvailable;
    } else if (config.provider === 'builtin') {
      isAvailable = true;
    } else if (config.provider === 'ollama') {
      // Only mark as available if the model is actually installed in Ollama
      isAvailable = (ollamaAutoDetected || process.env.OLLAMA_ENABLED === 'true') && isOllamaModelInstalled(id);
    } else if (LOCAL_AI_PROVIDERS.includes(config.provider)) {
      isAvailable = isLocalProviderDetected(config.provider);
    } else {
      isAvailable = !!process.env[config.envKey];
    }
    models.push({
      id,
      name: config.name,
      provider: config.provider,
      description: config.description,
      available: isAvailable,
      free: config.free || false,
      local: config.local || false,
      custom: config.custom || false
    });
  }
  return models;
}

/**
 * Get all models including unavailable ones
 */
function getAllModels() {
  return Object.entries(AI_MODELS).map(([id, config]) => {
    let isAvailable;
    if (config.provider === 'innovate') {
      isAvailable = isInnovateAIAvailable();
    } else if (config.provider === 'pollinations') {
      isAvailable = pollinationsAvailable;
    } else if (config.provider === 'builtin') {
      isAvailable = true;
    } else if (config.provider === 'ollama') {
      // Only mark as available if the model is actually installed in Ollama
      isAvailable = (ollamaAutoDetected || process.env.OLLAMA_ENABLED === 'true') && isOllamaModelInstalled(id);
    } else if (LOCAL_AI_PROVIDERS.includes(config.provider)) {
      isAvailable = isLocalProviderDetected(config.provider);
    } else {
      isAvailable = !!process.env[config.envKey];
    }
    return {
      id,
      name: config.name,
      provider: config.provider,
      description: config.description,
      available: isAvailable,
      free: config.free || false,
      local: config.local || false,
      custom: config.custom || false
    };
  });
}

/**
 * Send a chat request to the selected AI provider
 * @param {string} modelId - The model identifier
 * @param {Array} messages - Conversation history [{role, content}]
 * @param {Object} options - Additional options (temperature, maxTokens)
 * @returns {Promise<{content: string, model: string, tokens: object}>}
 */
async function chat(modelId, messages, options = {}) {
  let modelConfig = AI_MODELS[modelId];
  
  // If model not found but starts with 'openrouter/', create a dynamic config for it
  // This handles cases where the model was selected from the dynamic list
  if (!modelConfig && modelId.startsWith('openrouter/')) {
    modelConfig = {
      provider: 'openrouter',
      name: modelId.replace('openrouter/', ''),
      description: 'Via OpenRouter',
      maxTokens: 4096,
      envKey: 'OPENROUTER_API_KEY',
      free: modelId.endsWith(':free')
    };
    AI_MODELS[modelId] = modelConfig;
  }
  
  if (!modelConfig) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  // Innovate AI uses smart routing — no separate API key check
  if (modelConfig.provider === 'innovate') {
    // Always available — smart routing with built-in fallback ensures Innovate AI always works
  } else if (modelConfig.provider === 'pollinations' || modelConfig.provider === 'builtin') {
    // Always available — no API key needed
  } else if (modelConfig.provider === 'ollama') {
    if (!ollamaAutoDetected && process.env.OLLAMA_ENABLED !== 'true') {
      throw new Error('Ollama is not enabled. Set OLLAMA_ENABLED=true in .env and ensure Ollama is running locally.');
    }
    const ollamaModelName = modelId.replace('ollama/', '');
    if (!isOllamaModelInstalled(modelId)) {
      throw new Error(`Model '${ollamaModelName}' is not installed in Ollama. Run: ollama pull ${ollamaModelName}`);
    }
  } else if (LOCAL_AI_PROVIDERS.includes(modelConfig.provider)) {
    if (!isLocalProviderDetected(modelConfig.provider)) {
      const serviceNames = { lmstudio: 'LM Studio', gpt4all: 'GPT4All', jan: 'Jan.ai', koboldcpp: 'KoboldCPP' };
      throw new Error(`${serviceNames[modelConfig.provider]} is not running. Start it locally to use this model.`);
    }
  } else {
    const apiKey = process.env[modelConfig.envKey];
    if (!apiKey) {
      throw new Error(`API key not configured for ${modelConfig.name}. Set ${modelConfig.envKey} in your .env file.`);
    }
  }

  const apiKey = process.env[modelConfig.envKey] || '';
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? modelConfig.maxTokens;

  try {
    switch (modelConfig.provider) {
      case 'innovate':
        return await callInnovateAI(modelId, messages, temperature, maxTokens);
      case 'openai':
        return await callOpenAI(modelId, apiKey, messages, temperature, maxTokens);
      case 'google':
        return await callGemini(modelId, apiKey, messages, temperature, maxTokens);
      case 'xai':
        return await callXAI(modelId, apiKey, messages, temperature, maxTokens);
      case 'anthropic':
        return await callAnthropic(modelId, apiKey, messages, temperature, maxTokens);
      case 'deepseek':
        return await callDeepSeek(modelId, apiKey, messages, temperature, maxTokens);
      case 'groq':
        return await callGroq(modelId, apiKey, messages, temperature, maxTokens);
      case 'huggingface':
        return await callHuggingFace(modelId, apiKey, messages, temperature, maxTokens);
      case 'ollama':
        return await callOllama(modelId, messages, temperature, maxTokens);
      case 'lmstudio':
      case 'gpt4all':
      case 'jan':
      case 'koboldcpp':
        return await callLocalAIService(modelConfig.provider, modelId, messages, temperature, maxTokens);
      case 'cohere':
        return await callCohere(modelId, apiKey, messages, temperature, maxTokens);
      case 'mistral':
        return await callMistral(modelId, apiKey, messages, temperature, maxTokens);
      case 'openrouter':
        return await callOpenRouter(modelId, apiKey, messages, temperature, maxTokens);
      case 'pollinations':
        return await callPollinationsWithPrompt(messages, temperature, maxTokens, INNOVATE_AI_SYSTEM_PROMPT, modelId);
      case 'builtin':
        return await callBuiltinFallback(messages, INNOVATE_AI_SYSTEM_PROMPT);
      default:
        throw new Error(`Unsupported provider: ${modelConfig.provider}`);
    }
  } catch (error) {
    // Normalize API errors
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      const errMsg = data?.error?.message || data?.error?.type || data?.message || JSON.stringify(data);
      
      if (status === 401 || status === 403) {
        throw new Error(`Authentication failed for ${modelConfig.name}. Check your API key.`);
      }
      if (status === 429) {
        const isFreeModel = modelConfig.free;
        throw new Error(isFreeModel 
          ? `${modelConfig.name} is temporarily busy (free tier rate limit). Try another free model or wait a moment.`
          : `Rate limit exceeded for ${modelConfig.name}. Your API key has hit its usage limit.`);
      }
      if (status === 400) {
        // Check for OpenRouter provider-level errors
        const providerErr = data?.error?.metadata?.raw || '';
        if (providerErr && modelConfig.provider === 'openrouter') {
          throw new Error(`${modelConfig.name}: Provider error. Try a different model.`);
        }
        throw new Error(`Invalid request to ${modelConfig.name}: ${errMsg}`);
      }
      throw new Error(`${modelConfig.name} API error (${status}): ${errMsg}`);
    }
    throw error;
  }
}

// ===================== INNOVATE AI - Smart Router Engine =====================

const INNOVATE_CREATIVE_PROMPT = `${INNOVATE_AI_SYSTEM_PROMPT}

CREATIVE MODE ACTIVE: You are now in creative writing mode. Be more expressive, imaginative, and artistic. Use vivid descriptions, metaphors, and engaging narratives. Let your creativity flow freely while maintaining quality and coherence.`;

const INNOVATE_CODER_PROMPT = `${INNOVATE_AI_SYSTEM_PROMPT}

CODER MODE ACTIVE: You are now in expert programmer mode. Focus on writing clean, efficient, well-commented code. Always explain your approach. Follow best practices and design patterns. Include error handling. Use proper formatting with code blocks and language tags.`;

/**
 * Innovate AI - Routes to the best available provider automatically.
 * Supports 3 modes: default, creative, coder — each with tailored system prompts.
 * Falls back through providers in priority order if one fails.
 */
async function callInnovateAI(modelId, messages, temperature, maxTokens) {
  const backend = getInnovateAIBackend();
  if (!backend) {
    throw new Error('No AI providers available');
  }

  // Select system prompt based on model variant
  let systemPrompt = INNOVATE_AI_SYSTEM_PROMPT;
  if (modelId === 'innovate-ai-creative') {
    systemPrompt = INNOVATE_CREATIVE_PROMPT;
    temperature = Math.max(temperature, 0.9); // Higher creativity
  } else if (modelId === 'innovate-ai-coder') {
    systemPrompt = INNOVATE_CODER_PROMPT;
    temperature = Math.min(temperature, 0.3); // More precise
  }

  // Override messages with Innovate AI system prompt
  const innovateMessages = messages.map(m => ({ ...m }));

  // Try providers in priority order with fallback
  const triedProviders = [];
  for (const candidate of INNOVATE_AI_PROVIDER_PRIORITY) {
    // Skip providers that recently failed (cooldown period)
    if (isProviderCoolingDown(candidate.provider, candidate.modelId)) {
      console.log(`Innovate AI: Skipping ${candidate.provider}/${candidate.modelId} (cooling down after recent failure)`);
      continue;
    }

    // Check availability
    const isAvailable = candidate.provider === 'builtin'
      ? true  // Built-in always available
      : candidate.provider === 'pollinations'
        ? pollinationsAvailable
        : candidate.provider === 'ollama' 
          ? (ollamaAutoDetected || process.env.OLLAMA_ENABLED === 'true')
          : LOCAL_AI_PROVIDERS.includes(candidate.provider)
            ? isLocalProviderDetected(candidate.provider)
            : !!process.env[candidate.envKey];
    
    if (!isAvailable) continue;

    try {
      const targetModel = AI_MODELS[candidate.modelId];
      if (!targetModel && candidate.provider !== 'pollinations' && candidate.provider !== 'builtin') continue;

      const apiKey = targetModel ? (process.env[targetModel.envKey] || '') : '';

      let result;
      switch (candidate.provider) {
        case 'groq':
          result = await callGroqWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'google':
          result = await callGeminiWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'openai':
          result = await callOpenAIWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'mistral':
          result = await callMistralWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'cohere':
          result = await callCohereWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'openrouter':
          result = await callOpenRouterWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'huggingface':
          result = await callHuggingFaceWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'anthropic':
          result = await callAnthropicWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'deepseek':
          result = await callDeepSeekWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'xai':
          result = await callXAIWithPrompt(candidate.modelId, apiKey, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'ollama':
          result = await callOllamaWithPrompt(candidate.modelId, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'lmstudio':
        case 'gpt4all':
        case 'jan':
        case 'koboldcpp':
          result = await callLocalAIServiceWithPrompt(candidate.provider, candidate.modelId, innovateMessages, temperature, maxTokens, systemPrompt);
          break;
        case 'pollinations':
          result = await callPollinationsWithPrompt(innovateMessages, temperature, maxTokens, systemPrompt, candidate.modelId);
          break;
        case 'builtin':
          result = await callBuiltinFallback(innovateMessages, systemPrompt);
          break;
        default:
          continue;
      }

      // Override model name in response to show "Innovate AI"
      result.model = modelId;
      result.backed_by = candidate.modelId;
      return result;

    } catch (err) {
      console.log(`Innovate AI: ${candidate.provider}/${candidate.modelId} failed: ${err.message}, trying next...`);
      // Don't cooldown Pollinations — it's the free-tier fallback and only zero-config provider
      // Empty responses and rate limits are transient, not permanent failures
      if (candidate.provider !== 'pollinations') {
        markProviderFailed(candidate.provider, candidate.modelId);
      }
      triedProviders.push(candidate.provider);
      continue;
    }
  }

  throw new Error(`All AI providers failed. Tried: ${triedProviders.join(', ') || 'none available'}. Check your API keys in .env`);
}

// ===================== Provider-specific implementations =====================
// Each provider has a base function + a WithPrompt variant for Innovate AI routing

// Helper to create WithPrompt variants for OpenAI-compatible APIs
function makeOpenAICompatibleCall(baseUrl, headersFactory) {
  return async function(modelId, apiKey, messages, temperature, maxTokens, systemPrompt) {
    const actualModel = modelId.replace('openrouter/', '');
    const payload = {
      model: actualModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature,
      max_tokens: maxTokens
    };
    const response = await axios.post(baseUrl, payload, {
      headers: headersFactory(apiKey),
      timeout: 15000
    });
    return {
      content: response.data.choices[0].message.content,
      model: modelId,
      tokens: {
        prompt: response.data.usage?.prompt_tokens,
        completion: response.data.usage?.completion_tokens,
        total: response.data.usage?.total_tokens
      }
    };
  };
}

const callOpenAIWithPrompt = makeOpenAICompatibleCall(
  PROVIDER_CONFIGS.openai.baseUrl, PROVIDER_CONFIGS.openai.headers
);
const callGroqWithPrompt = makeOpenAICompatibleCall(
  PROVIDER_CONFIGS.groq.baseUrl, PROVIDER_CONFIGS.groq.headers
);
const callMistralWithPrompt = makeOpenAICompatibleCall(
  PROVIDER_CONFIGS.mistral.baseUrl, PROVIDER_CONFIGS.mistral.headers
);
const callXAIWithPrompt = makeOpenAICompatibleCall(
  PROVIDER_CONFIGS.xai.baseUrl, PROVIDER_CONFIGS.xai.headers
);
const callDeepSeekWithPrompt = makeOpenAICompatibleCall(
  PROVIDER_CONFIGS.deepseek.baseUrl, PROVIDER_CONFIGS.deepseek.headers
);
const callOpenRouterWithPrompt = makeOpenAICompatibleCall(
  PROVIDER_CONFIGS.openrouter.baseUrl, PROVIDER_CONFIGS.openrouter.headers
);

/**
 * Pollinations AI - FREE, no API key needed, always available
 * Uses OpenAI-compatible format at https://text.pollinations.ai/openai
 */
async function callPollinationsWithPrompt(messages, temperature, maxTokens, systemPrompt, modelId) {
  const MAX_RETRIES = 2;
  let lastError = null;

  // Resolve which Pollinations model name to use
  let pollinationsModel = pollinationsDefaultModel;
  if (modelId) {
    const config = AI_MODELS[modelId];
    if (config?._pollinationsModelName) {
      pollinationsModel = config._pollinationsModelName;
    } else if (modelId.startsWith('pollinations/')) {
      pollinationsModel = modelId.replace('pollinations/', '');
    }
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const payload = {
        model: pollinationsModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature,
        max_tokens: maxTokens,
        seed: Math.floor(Math.random() * 1000000) + attempt,  // Random seed to bypass Pollinations cache
        cache: false  // Disable Pollinations response caching
      };

      console.log(`[Pollinations] Attempt ${attempt}/${MAX_RETRIES} - ${messages.length} messages, seed: ${payload.seed}`);

      const response = await axios.post(PROVIDER_CONFIGS.pollinations.baseUrl, payload, {
        headers: PROVIDER_CONFIGS.pollinations.headers(),
        timeout: 30000
      });

      // Extract content from various response formats
      let content = '';
      if (response.data?.choices?.[0]?.message?.content) {
        content = response.data.choices[0].message.content;
      } else if (typeof response.data === 'string' && response.data.trim()) {
        content = response.data;
      } else {
        console.warn(`[Pollinations] Unexpected response format:`, JSON.stringify(response.data).substring(0, 300));
      }

      if (content && content.trim()) {
        console.log(`[Pollinations] Success on attempt ${attempt}, content length: ${content.length}`);
        return {
          content: content.trim(),
          model: 'pollinations-openai',
          tokens: {
            prompt: response.data?.usage?.prompt_tokens || 0,
            completion: response.data?.usage?.completion_tokens || 0,
            total: response.data?.usage?.total_tokens || 0
          }
        };
      }

      // Empty response — log and retry after delay
      console.warn(`[Pollinations] Attempt ${attempt}/${MAX_RETRIES}: empty response body`);
      lastError = new Error('Empty response from Pollinations');
      
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }

    } catch (err) {
      console.warn(`[Pollinations] Attempt ${attempt}/${MAX_RETRIES} error: ${err.message}`);
      lastError = err;
      
      // Don't retry on hard network errors
      if (err.code === 'ECONNABORTED' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        break;
      }
      
      // For 429 rate limit, wait longer before retry
      if (err.response?.status === 429) {
        if (attempt < MAX_RETRIES) {
          console.log('[Pollinations] Rate limited, waiting 5s before retry...');
          await new Promise(r => setTimeout(r, 5000));
        }
      } else if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  throw lastError || new Error('Pollinations failed after retries');
}

/**
 * Built-in Fallback AI — Always works, no external service needed
 * Uses Ollama if available, otherwise provides intelligent template responses
 */
async function callBuiltinFallback(messages, systemPrompt) {
  // First try: use Ollama if auto-detected
  if (ollamaAutoDetected && ollamaAvailableModels.length > 0) {
    try {
      const preferredModels = ['qwen2.5:0.5b', 'tinyllama', 'llama3.2', 'mistral', 'phi3', 'gemma2'];
      let modelToUse = ollamaAvailableModels[0]; // Default to first available
      for (const pref of preferredModels) {
        if (ollamaAvailableModels.some(m => m.includes(pref))) {
          modelToUse = ollamaAvailableModels.find(m => m.includes(pref));
          break;
        }
      }
      console.log(`[Built-in Fallback] Using Ollama model: ${modelToUse}`);
      return await callOllamaWithPrompt(`ollama/${modelToUse}`, messages, 0.7, 2048, systemPrompt);
    } catch (err) {
      console.log(`[Built-in Fallback] Ollama failed: ${err.message}, trying other local services...`);
    }
  }

  // Second try: use any detected local AI service (LM Studio, GPT4All, Jan.ai, KoboldCPP)
  for (const provider of LOCAL_AI_PROVIDERS) {
    if (isLocalProviderDetected(provider)) {
      try {
        const serviceNames = { lmstudio: 'LM Studio', gpt4all: 'GPT4All', jan: 'Jan.ai', koboldcpp: 'KoboldCPP' };
        console.log(`[Built-in Fallback] Using ${serviceNames[provider]}`);
        return await callLocalAIServiceWithPrompt(provider, `${provider}/default`, messages, 0.7, 2048, systemPrompt);
      } catch (err) {
        console.log(`[Built-in Fallback] ${provider} failed: ${err.message}, trying next...`);
      }
    }
  }

  // Last resort: generate intelligent response from templates
  const lastMessage = messages[messages.length - 1]?.content || '';
  const response = generateBuiltinResponse(lastMessage);
  
  return {
    content: response,
    model: 'builtin-fallback',
    tokens: { prompt: 0, completion: 0, total: 0 }
  };
}

/**
 * Generate an intelligent template-based response
 * Handles common queries with helpful answers
 */
function generateBuiltinResponse(userMessage) {
  const msg = userMessage.toLowerCase().trim();
  
  // Greeting patterns
  if (msg.match(/^(hi+|hey+|hello+|hola|sup|yo|what'?s? ?up|howdy|good ?(morning|afternoon|evening|night)|greetings)/i)) {
    const greetings = [
      "Hey there! 👋 I'm Innovate AI, your built-in assistant. How can I help you today?",
      "Hello! 😊 Welcome to Innovate AI. I'm here to help — ask me anything!",
      "Hi! 👋 I'm Innovate AI. What would you like to know or talk about?",
      "Hey! Great to see you! I'm Innovate AI — your personal assistant on Innovate Hub. What can I do for you?",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  // Who are you / about
  if (msg.match(/who ?are ?you|what ?are ?you|about ?you|your ?name|introduce/i)) {
    return "I'm **Innovate AI** 💡 — the built-in AI assistant of the Innovate Hub social platform!\n\nI can help you with:\n• 💬 General conversations and questions\n• 💻 Coding help and debugging\n• 🎨 Creative writing and ideas\n• 📚 Learning and explanations\n• 🎨 Image generation (/imagine prompt)\n• 🎬 Video generation (/video prompt)\n\nI use smart multi-model routing to give you the best responses. No API keys needed!";
  }

  // Help / what can you do
  if (msg.match(/help|what can you|capabilities|features|what do you|how to use/i)) {
    return "Here's what I can do for you! 🚀\n\n**Chat & Knowledge:**\n• Answer questions on any topic\n• Help with coding, math, science\n• Creative writing & brainstorming\n\n**Media Generation:**\n• 🎨 `/imagine [description]` — Generate images\n• 🎬 `/video [description]` — Create short video clips\n\n**Document Analysis:**\n• Upload PDFs, docs, images for analysis\n• Vision-powered image understanding\n\n**Voice:**\n• 🎙️ Voice chat — talk naturally with AI\n\nJust type your question or use the quick action buttons!";
  }

  // Coding questions
  if (msg.match(/code|programming|javascript|python|html|css|debug|error|function|variable|api|react|node|java|sql|git/i)) {
    return "I'd love to help with your coding question! 💻\n\nI'm currently running in built-in fallback mode with limited capabilities. For the best coding assistance, I recommend:\n\n1. **Try again in a moment** — my AI providers may come back online\n2. **Check your message** — be specific about what language, framework, and error you're seeing\n3. **Share code snippets** — paste your code and I'll analyze it when my full AI is available\n\nIn the meantime, here are some general coding tips:\n• Break problems into smaller pieces\n• Use console.log/print to debug\n• Read error messages carefully — they often point to the exact issue\n• Check documentation for the libraries you're using\n\nFeel free to ask again and I'll do my best to help! 🚀";
  }

  // Math
  if (msg.match(/(\d+\s*[\+\-\*\/\%]\s*\d+)|calculate|math|equation|solve/i)) {
    // Try to evaluate simple math
    const mathMatch = msg.match(/(\d+(?:\.\d+)?)\s*([\+\-\*\/\%])\s*(\d+(?:\.\d+)?)/);
    if (mathMatch) {
      const a = parseFloat(mathMatch[1]);
      const op = mathMatch[2];
      const b = parseFloat(mathMatch[3]);
      let result;
      switch(op) {
        case '+': result = a + b; break;
        case '-': result = a - b; break;
        case '*': result = a * b; break;
        case '/': result = b !== 0 ? a / b : 'undefined (division by zero)'; break;
        case '%': result = a % b; break;
      }
      return `**${a} ${op} ${b} = ${result}** ✨\n\nNeed help with more complex math? Just ask!`;
    }
    return "I can help with math! Please share the specific equation or problem you'd like me to solve. For complex calculations, my full AI engine will provide detailed step-by-step solutions.";
  }

  // Jokes / fun
  if (msg.match(/joke|funny|laugh|humor|tell me a/i)) {
    const jokes = [
      "Why do programmers prefer dark mode? Because light attracts bugs! 🐛😄",
      "Why did the developer go broke? Because he used up all his cache! 💸😂",
      "What's a programmer's favorite hangout place? Foo Bar! 🍸😄",
      "Why do Java developers wear glasses? Because they don't C#! 👓😂",
      "What did the HTML say to the CSS? 'You make me look good!' 💅✨",
      "Why was the JavaScript developer sad? Because he didn't Node how to Express himself! 😢😄",
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  }

  // Thanks / bye
  if (msg.match(/^(thanks?|thank you|thx|ty|bye|goodbye|see ya|later|good ?bye)/i)) {
    const responses = [
      "You're welcome! 😊 Feel free to come back anytime!",
      "Happy to help! 👋 See you around on Innovate Hub!",
      "Anytime! Don't hesitate to ask if you need anything else! 🌟",
      "Glad I could help! Have a great day! ✨",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  // Weather, time, etc
  if (msg.match(/weather|time|date|today/i)) {
    const now = new Date();
    return `The current date and time is: **${now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}**\n\nFor weather information, I'd need access to a weather API. You can check weather at [weather.com](https://weather.com) or ask me when my full AI capabilities are available! 🌤️`;
  }

  // Default — intelligent fallback
  const defaults = [
    `Great question! 🤔 I'm Innovate AI running in built-in mode right now.\n\nI received your message: *"${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"*\n\nWhile my external AI providers are reconnecting, here's what I can tell you:\n• I'm still here and listening! 💡\n• Try asking me basic questions, math, jokes, or coding tips\n• My full AI capabilities will be back shortly\n• You can also try switching models using the dropdown above\n\nPlease try again in a moment — I'll give you a much more helpful answer! 🚀`,
    `Thanks for your message! 💬 I'm currently using my built-in response system while my AI providers reconnect.\n\nYour question about *"${userMessage.substring(0, 80)}${userMessage.length > 80 ? '...' : ''}"* is a great one! I'll be able to provide a comprehensive answer once my full AI is back online.\n\n**In the meantime:**\n• Try simple questions — I can handle greetings, math, jokes, and basic help\n• Check back in a minute for full AI responses\n• Try the model switcher above for other providers\n\nI appreciate your patience! 🙏`,
  ];
  return defaults[Math.floor(Math.random() * defaults.length)];
}

/**
 * Pollinations Vision - FREE, no API key needed
 * Sends image in OpenAI vision format
 */
async function callPollinationsVision(messages, imageData, temperature, maxTokens, systemPrompt) {
  const apiMessages = [{ role: 'system', content: systemPrompt }];
  
  for (const msg of messages.slice(0, -1)) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }
  
  const lastMsg = messages[messages.length - 1];
  apiMessages.push({
    role: 'user',
    content: [
      {
        type: 'image_url',
        image_url: {
          url: `data:${imageData.mimeType};base64,${imageData.base64}`
        }
      },
      {
        type: 'text',
        text: lastMsg?.content || 'Describe this image in detail.'
      }
    ]
  });

  const payload = {
    model: 'openai-fast',
    messages: apiMessages,
    temperature,
    max_tokens: maxTokens,
    seed: Math.floor(Math.random() * 1000000),
    cache: false
  };

  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(PROVIDER_CONFIGS.pollinations.baseUrl, payload, {
        headers: PROVIDER_CONFIGS.pollinations.headers(),
        timeout: 90000
      });

      let content = '';
      if (response.data?.choices?.[0]?.message?.content) {
        content = response.data.choices[0].message.content;
      } else if (typeof response.data === 'string' && response.data.trim()) {
        content = response.data;
      }

      if (content && content.trim()) {
        return {
          content: content.trim(),
          model: 'pollinations-openai',
          tokens: {
            prompt: response.data?.usage?.prompt_tokens || 0,
            completion: response.data?.usage?.completion_tokens || 0,
            total: response.data?.usage?.total_tokens || 0
          }
        };
      }

      console.warn(`Pollinations Vision attempt ${attempt}/${MAX_RETRIES}: empty response`);
      lastError = new Error('Vision AI returned an empty response');
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.warn(`Pollinations Vision attempt ${attempt}/${MAX_RETRIES} error: ${err.message}`);
      lastError = err;
      if (err.code === 'ECONNABORTED' || err.code === 'ENOTFOUND') break;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 2000));
    }
  }

  throw lastError || new Error('Vision failed after retries');
}

async function callHuggingFaceWithPrompt(modelId, apiKey, messages, temperature, maxTokens, systemPrompt) {
  const modelPath = modelId.replace('huggingface/', '');
  const url = PROVIDER_CONFIGS.huggingface.baseUrl(modelPath);
  const payload = {
    model: modelPath,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature, max_tokens: maxTokens, stream: false
  };
  const response = await axios.post(url, payload, {
    headers: PROVIDER_CONFIGS.huggingface.headers(apiKey), timeout: 20000
  });
  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    tokens: { prompt: response.data.usage?.prompt_tokens, completion: response.data.usage?.completion_tokens, total: response.data.usage?.total_tokens }
  };
}

async function callGeminiWithPrompt(modelId, apiKey, messages, temperature, maxTokens, systemPrompt) {
  try {
    const client = getGeminiClient();
    // Build contents from messages
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
    const response = await client.models.generateContent({
      model: modelId,
      contents: contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: temperature,
        maxOutputTokens: maxTokens,
        topP: 0.95
      }
    });
    const text = response.text;
    if (!text) throw new Error('No response from Gemini');
    return {
      content: text,
      model: modelId,
      tokens: {
        prompt: response.usageMetadata?.promptTokenCount,
        completion: response.usageMetadata?.candidatesTokenCount,
        total: response.usageMetadata?.totalTokenCount
      }
    };
  } catch (err) {
    console.error('[Gemini SDK] callGeminiWithPrompt error:', err.message);
    throw err;
  }
}

async function callAnthropicWithPrompt(modelId, apiKey, messages, temperature, maxTokens, systemPrompt) {
  const config = PROVIDER_CONFIGS.anthropic;
  const payload = {
    model: modelId, system: systemPrompt,
    messages: messages.map(msg => ({ role: msg.role, content: msg.content })),
    temperature, max_tokens: maxTokens
  };
  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey), timeout: 15000
  });
  return {
    content: response.data.content[0].text,
    model: modelId,
    tokens: { prompt: response.data.usage?.input_tokens, completion: response.data.usage?.output_tokens, total: (response.data.usage?.input_tokens || 0) + (response.data.usage?.output_tokens || 0) }
  };
}

async function callCohereWithPrompt(modelId, apiKey, messages, temperature, maxTokens, systemPrompt) {
  const config = PROVIDER_CONFIGS.cohere;
  const payload = {
    model: modelId,
    messages: [{ role: 'system', content: systemPrompt }, ...messages.map(msg => ({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content }))],
    temperature, max_tokens: maxTokens
  };
  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey), timeout: 15000
  });
  const content = response.data.message?.content?.[0]?.text || response.data.text || response.data.message?.content || '';
  return {
    content, model: modelId,
    tokens: { prompt: response.data.usage?.tokens?.input_tokens || 0, completion: response.data.usage?.tokens?.output_tokens || 0, total: (response.data.usage?.tokens?.input_tokens || 0) + (response.data.usage?.tokens?.output_tokens || 0) }
  };
}

async function callOllamaWithPrompt(modelId, messages, temperature, maxTokens, systemPrompt) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const modelName = modelId.replace('ollama/', '');
  const payload = {
    model: modelName,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream: false, options: { temperature, num_predict: maxTokens }
  };
  const response = await axios.post(`${baseUrl}/api/chat`, payload, {
    headers: { 'Content-Type': 'application/json' }, timeout: 120000
  });
  return {
    content: response.data.message?.content || response.data.response,
    model: modelId,
    tokens: { prompt: response.data.prompt_eval_count || 0, completion: response.data.eval_count || 0, total: (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0) }
  };
}

// ===================== Local AI Service Calls (LM Studio, GPT4All, Jan.ai, KoboldCPP) =====================
// All use OpenAI-compatible /v1/chat/completions API

const LOCAL_SERVICE_URLS = {
  lmstudio: () => process.env.LM_STUDIO_URL || 'http://localhost:1234',
  gpt4all: () => process.env.GPT4ALL_URL || 'http://localhost:4891',
  jan: () => process.env.JAN_AI_URL || 'http://localhost:1337',
  koboldcpp: () => process.env.KOBOLDCPP_URL || 'http://localhost:5001',
};

function getLocalModelName(provider, modelId) {
  // Strip provider prefix: 'lmstudio/default' -> 'default', 'jan/mistral' -> 'mistral'
  const name = modelId.replace(`${provider}/`, '');
  // For auto-detected services, use the first available model or 'default'
  if (name === 'default') {
    switch (provider) {
      case 'lmstudio': return lmStudioModels[0] || 'default';
      case 'gpt4all': return gpt4allModels[0] || 'default';
      case 'jan': return janModels[0] || 'default';
      case 'koboldcpp': return koboldModels[0] || 'default';
    }
  }
  return name;
}

async function callLocalAIService(provider, modelId, messages, temperature, maxTokens) {
  const baseUrl = LOCAL_SERVICE_URLS[provider]();
  const modelName = getLocalModelName(provider, modelId);
  const payload = {
    model: modelName,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false
  };
  const response = await axios.post(`${baseUrl}/v1/chat/completions`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000
  });
  const choice = response.data.choices?.[0];
  return {
    content: choice?.message?.content || '',
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens || 0,
      completion: response.data.usage?.completion_tokens || 0,
      total: response.data.usage?.total_tokens || 0
    }
  };
}

async function callLocalAIServiceWithPrompt(provider, modelId, messages, temperature, maxTokens, systemPrompt) {
  const baseUrl = LOCAL_SERVICE_URLS[provider]();
  const modelName = getLocalModelName(provider, modelId);
  const payload = {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false
  };
  const response = await axios.post(`${baseUrl}/v1/chat/completions`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000
  });
  const choice = response.data.choices?.[0];
  return {
    content: choice?.message?.content || '',
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens || 0,
      completion: response.data.usage?.completion_tokens || 0,
      total: response.data.usage?.total_tokens || 0
    }
  };
}

// ===================== Standard provider calls (used when user picks a specific model) =====================

async function callOpenAI(modelId, apiKey, messages, temperature, maxTokens) {
  const config = PROVIDER_CONFIGS.openai;
  const payload = {
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey),
    timeout: 15000
  });

  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens,
      completion: response.data.usage?.completion_tokens,
      total: response.data.usage?.total_tokens
    }
  };
}

async function callGemini(modelId, apiKey, messages, temperature, maxTokens) {
  try {
    const client = getGeminiClient();
    // Convert OpenAI-style messages to Gemini format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
    const response = await client.models.generateContent({
      model: modelId,
      contents: contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: temperature,
        maxOutputTokens: maxTokens,
        topP: 0.95
      }
    });
    const text = response.text;
    if (!text) throw new Error('No response generated by Gemini');
    return {
      content: text,
      model: modelId,
      tokens: {
        prompt: response.usageMetadata?.promptTokenCount,
        completion: response.usageMetadata?.candidatesTokenCount,
        total: response.usageMetadata?.totalTokenCount
      }
    };
  } catch (err) {
    console.error('[Gemini SDK] callGemini error:', err.message);
    throw err;
  }
}

async function callXAI(modelId, apiKey, messages, temperature, maxTokens) {
  const config = PROVIDER_CONFIGS.xai;
  const payload = {
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey),
    timeout: 15000
  });

  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens,
      completion: response.data.usage?.completion_tokens,
      total: response.data.usage?.total_tokens
    }
  };
}

async function callAnthropic(modelId, apiKey, messages, temperature, maxTokens) {
  const config = PROVIDER_CONFIGS.anthropic;
  const payload = {
    model: modelId,
    system: SYSTEM_PROMPT,
    messages: messages.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey),
    timeout: 15000
  });

  return {
    content: response.data.content[0].text,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.input_tokens,
      completion: response.data.usage?.output_tokens,
      total: (response.data.usage?.input_tokens || 0) + (response.data.usage?.output_tokens || 0)
    }
  };
}

async function callDeepSeek(modelId, apiKey, messages, temperature, maxTokens) {
  const config = PROVIDER_CONFIGS.deepseek;
  const payload = {
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey),
    timeout: 15000
  });

  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens,
      completion: response.data.usage?.completion_tokens,
      total: response.data.usage?.total_tokens
    }
  };
}

// ===================== FREE Provider implementations =====================

async function callGroq(modelId, apiKey, messages, temperature, maxTokens) {
  const config = PROVIDER_CONFIGS.groq;
  const payload = {
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey),
    timeout: 15000
  });

  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens,
      completion: response.data.usage?.completion_tokens,
      total: response.data.usage?.total_tokens
    }
  };
}

async function callHuggingFace(modelId, apiKey, messages, temperature, maxTokens) {
  // Extract the actual model path (remove 'huggingface/' prefix if present)
  const modelPath = modelId.replace('huggingface/', '');
  const url = PROVIDER_CONFIGS.huggingface.baseUrl(modelPath);
  
  const payload = {
    model: modelPath,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false
  };

  const response = await axios.post(url, payload, {
    headers: PROVIDER_CONFIGS.huggingface.headers(apiKey),
    timeout: 120000 // HF can be slower
  });

  // HF returns OpenAI-compatible format
  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens,
      completion: response.data.usage?.completion_tokens,
      total: response.data.usage?.total_tokens
    }
  };
}

async function callOllama(modelId, messages, temperature, maxTokens) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  // Extract model name: 'ollama/llama3.2' -> 'llama3.2'
  const modelName = modelId.replace('ollama/', '');
  
  const payload = {
    model: modelName,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    stream: false,
    options: {
      temperature,
      num_predict: maxTokens
    }
  };

  const response = await axios.post(`${baseUrl}/api/chat`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000 // Local models can be slow
  });

  return {
    content: response.data.message?.content || response.data.response,
    model: modelId,
    tokens: {
      prompt: response.data.prompt_eval_count || 0,
      completion: response.data.eval_count || 0,
      total: (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0)
    }
  };
}

async function callCohere(modelId, apiKey, messages, temperature, maxTokens) {
  const config = PROVIDER_CONFIGS.cohere;
  
  const payload = {
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }))
    ],
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey),
    timeout: 15000
  });

  // Cohere v2 chat API
  const content = response.data.message?.content?.[0]?.text || 
                   response.data.text ||
                   response.data.message?.content || '';

  return {
    content,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.tokens?.input_tokens || response.data.meta?.tokens?.input_tokens || 0,
      completion: response.data.usage?.tokens?.output_tokens || response.data.meta?.tokens?.output_tokens || 0,
      total: (response.data.usage?.tokens?.input_tokens || 0) + (response.data.usage?.tokens?.output_tokens || 0)
    }
  };
}

async function callMistral(modelId, apiKey, messages, temperature, maxTokens) {
  const config = PROVIDER_CONFIGS.mistral;
  const payload = {
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey),
    timeout: 15000
  });

  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens,
      completion: response.data.usage?.completion_tokens,
      total: response.data.usage?.total_tokens
    }
  };
}

async function callOpenRouter(modelId, apiKey, messages, temperature, maxTokens) {
  const config = PROVIDER_CONFIGS.openrouter;
  // Extract actual model path: 'openrouter/google/gemma-3-4b-it:free' -> 'google/gemma-3-4b-it:free'
  const modelPath = modelId.replace('openrouter/', '');
  
  const payload = {
    model: modelPath,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens
  };

  try {
    const response = await axios.post(config.baseUrl, payload, {
      headers: config.headers(apiKey),
      timeout: 30000
    });

    return {
      content: response.data.choices[0].message.content,
      model: modelId,
      tokens: {
        prompt: response.data.usage?.prompt_tokens,
        completion: response.data.usage?.completion_tokens,
        total: response.data.usage?.total_tokens
      }
    };
  } catch (err) {
    // Some models (e.g. Gemma) don't support system prompts — retry without it
    const errMsg = err.response?.data?.error?.message || err.response?.data?.error?.metadata?.raw || '';
    if (err.response?.status === 400 && (errMsg.includes('Developer instruction') || errMsg.includes('system') || errMsg.includes('not enabled'))) {
      console.log(`[OpenRouter] ${modelPath} doesn't support system prompts, retrying without...`);
      // Prepend system prompt as first user message instead
      const fallbackMessages = [
        { role: 'user', content: SYSTEM_PROMPT + '\n\nPlease follow the above instructions. Now respond to the conversation below.' },
        ...messages
      ];
      payload.messages = fallbackMessages;
      
      const response = await axios.post(config.baseUrl, payload, {
        headers: config.headers(apiKey),
        timeout: 30000
      });

      return {
        content: response.data.choices[0].message.content,
        model: modelId,
        tokens: {
          prompt: response.data.usage?.prompt_tokens,
          completion: response.data.usage?.completion_tokens,
          total: response.data.usage?.total_tokens
        }
      };
    }
    throw err; // Re-throw if it's not a system prompt issue
  }
}

/**
 * Chat with vision (image analysis) support
 * Routes to vision-capable models (Gemini, GPT-4o, Groq Vision, Claude)
 * @param {string} modelId - Requested model ID
 * @param {Array} messages - Conversation history [{role, content}]
 * @param {Object} imageData - { base64, mimeType } of the image to analyze
 * @param {Object} options - Additional options
 */
async function chatWithVision(modelId, messages, imageData, options = {}) {
  const systemPrompt = options.systemPrompt || INNOVATE_AI_SYSTEM_PROMPT;
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 4096;

  // Build the list of vision providers to try
  const triedProviders = [];
  
  for (const candidate of INNOVATE_AI_VISION_PRIORITY) {
    // Pollinations is always available, others need API keys
    const isAvailable = candidate.provider === 'pollinations' 
      ? true 
      : !!process.env[candidate.envKey];
    if (!isAvailable) continue;
    
    const apiKey = candidate.provider === 'pollinations' ? '' : process.env[candidate.envKey];
    
    try {
      let result;
      
      if (candidate.provider === 'google') {
        result = await callGeminiVision(candidate.modelId, apiKey, messages, imageData, temperature, maxTokens, systemPrompt);
      } else if (candidate.provider === 'groq') {
        result = await callOpenAICompatibleVision(
          candidate.modelId, apiKey, messages, imageData, temperature, maxTokens, systemPrompt,
          PROVIDER_CONFIGS.groq.baseUrl, PROVIDER_CONFIGS.groq.headers
        );
      } else if (candidate.provider === 'openai') {
        result = await callOpenAICompatibleVision(
          candidate.modelId, apiKey, messages, imageData, temperature, maxTokens, systemPrompt,
          PROVIDER_CONFIGS.openai.baseUrl, PROVIDER_CONFIGS.openai.headers
        );
      } else if (candidate.provider === 'anthropic') {
        result = await callAnthropicVision(candidate.modelId, apiKey, messages, imageData, temperature, maxTokens, systemPrompt);
      } else if (candidate.provider === 'pollinations') {
        result = await callPollinationsVision(messages, imageData, temperature, maxTokens, systemPrompt);
      }
      
      if (result) {
        // Wrap as Innovate AI if using innovate model
        if (modelId.startsWith('innovate-ai')) {
          result.model = modelId;
          result.backed_by = candidate.modelId;
        }
        console.log(`[Vision] Success via ${candidate.provider}/${candidate.modelId}`);
        return result;
      }
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.response?.data?.error || err.response?.status || '';
      console.log(`[Vision] ${candidate.provider}/${candidate.modelId} failed: ${err.message} | Detail: ${JSON.stringify(detail).substring(0, 200)}`);
      triedProviders.push(`${candidate.provider}/${candidate.modelId}`);
      continue;
    }
  }

  throw new Error(`Vision analysis failed. Tried: ${triedProviders.join(', ') || 'none configured'}.`);
}

/**
 * Google Gemini Vision - Send image for analysis
 */
async function callGeminiVision(modelId, apiKey, messages, imageData, temperature, maxTokens, systemPrompt) {
  try {
    const client = getGeminiClient();
    // Build multimodal contents
    const contents = [];
    // Add conversation history (text only)
    for (const msg of messages.slice(0, -1)) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
    // Last message includes the image
    const lastMsg = messages[messages.length - 1];
    const lastParts = [];
    // Add image data
    lastParts.push({
      inlineData: {
        mimeType: imageData.mimeType,
        data: imageData.base64
      }
    });
    // Add text prompt
    if (lastMsg?.content) {
      lastParts.push({ text: lastMsg.content });
    }
    contents.push({ role: 'user', parts: lastParts });

    const response = await client.models.generateContent({
      model: modelId,
      contents: contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: temperature,
        maxOutputTokens: maxTokens,
        topP: 0.95
      }
    });
    const text = response.text;
    if (!text) throw new Error('No response from Gemini Vision');
    return {
      content: text,
      model: modelId,
      tokens: {
        prompt: response.usageMetadata?.promptTokenCount,
        completion: response.usageMetadata?.candidatesTokenCount,
        total: response.usageMetadata?.totalTokenCount
      }
    };
  } catch (err) {
    console.error('[Gemini SDK] callGeminiVision error:', err.message);
    throw err;
  }
}

/**
 * OpenAI-compatible Vision (GPT-4o, Groq Llama Vision) 
 */
async function callOpenAICompatibleVision(modelId, apiKey, messages, imageData, temperature, maxTokens, systemPrompt, baseUrl, headersFactory) {
  // Build messages with image in the last user message
  const apiMessages = [{ role: 'system', content: systemPrompt }];
  
  for (const msg of messages.slice(0, -1)) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }
  
  // Last message with image
  const lastMsg = messages[messages.length - 1];
  apiMessages.push({
    role: 'user',
    content: [
      {
        type: 'image_url',
        image_url: {
          url: `data:${imageData.mimeType};base64,${imageData.base64}`
        }
      },
      {
        type: 'text',
        text: lastMsg?.content || 'Describe this image in detail.'
      }
    ]
  });

  const payload = {
    model: modelId,
    messages: apiMessages,
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(baseUrl, payload, {
    headers: headersFactory(apiKey),
    timeout: 15000
  });

  return {
    content: response.data.choices[0].message.content,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.prompt_tokens,
      completion: response.data.usage?.completion_tokens,
      total: response.data.usage?.total_tokens
    }
  };
}

/**
 * Anthropic Claude Vision
 */
async function callAnthropicVision(modelId, apiKey, messages, imageData, temperature, maxTokens, systemPrompt) {
  const config = PROVIDER_CONFIGS.anthropic;
  
  const apiMessages = [];
  for (const msg of messages.slice(0, -1)) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }
  
  const lastMsg = messages[messages.length - 1];
  apiMessages.push({
    role: 'user',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageData.mimeType,
          data: imageData.base64
        }
      },
      {
        type: 'text',
        text: lastMsg?.content || 'Describe this image in detail.'
      }
    ]
  });

  const payload = {
    model: modelId,
    system: systemPrompt,
    messages: apiMessages,
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(config.baseUrl, payload, {
    headers: config.headers(apiKey),
    timeout: 15000
  });

  return {
    content: response.data.content[0].text,
    model: modelId,
    tokens: {
      prompt: response.data.usage?.input_tokens,
      completion: response.data.usage?.output_tokens,
      total: (response.data.usage?.input_tokens || 0) + (response.data.usage?.output_tokens || 0)
    }
  };
}

module.exports = {
  AI_MODELS,
  getAvailableModels,
  getAllModels,
  chat,
  chatWithVision
};
