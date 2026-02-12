/**
 * AI Provider Service - Unified interface for multiple AI models
 * Supports: Innovate AI (custom smart router), OpenAI, Google Gemini, xAI Grok, 
 *           Anthropic Claude, DeepSeek, Groq (FREE), HuggingFace (FREE), 
 *           Ollama (LOCAL/FREE), Cohere (FREE tier), Mistral (FREE tier), OpenRouter (FREE models)
 */

const axios = require('axios');

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
  { provider: 'google', modelId: 'gemini-2.5-flash', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.0-flash', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'groq', modelId: 'qwen/qwen3-32b', envKey: 'GROQ_API_KEY' },
  { provider: 'mistral', modelId: 'mistral-small-latest', envKey: 'MISTRAL_API_KEY' },
  { provider: 'cohere', modelId: 'command-r-plus', envKey: 'COHERE_API_KEY' },
  { provider: 'openrouter', modelId: 'openrouter/meta-llama/llama-3.1-8b-instruct:free', envKey: 'OPENROUTER_API_KEY' },
  { provider: 'huggingface', modelId: 'mistralai/Mistral-7B-Instruct-v0.3', envKey: 'HUGGINGFACE_API_KEY' },
  // Premium fallbacks
  { provider: 'openai', modelId: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' },
  { provider: 'anthropic', modelId: 'claude-3-haiku-20240307', envKey: 'ANTHROPIC_API_KEY' },
  { provider: 'deepseek', modelId: 'deepseek-chat', envKey: 'DEEPSEEK_API_KEY' },
  { provider: 'xai', modelId: 'grok-2', envKey: 'XAI_API_KEY' },
  // Local fallback
  { provider: 'ollama', modelId: 'ollama/llama3.2', envKey: 'OLLAMA_ENABLED' },
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

  // Groq - FREE, super fast inference for open-source models
  // Sign up: https://console.groq.com (instant, free)
  'llama-3.3-70b-versatile': {
    provider: 'groq',
    name: 'Llama 3.3 70B',
    description: 'FREE - Meta\'s best open model via Groq',
    maxTokens: 4096,
    envKey: 'GROQ_API_KEY',
    free: true
  },
  'llama-3.1-8b-instant': {
    provider: 'groq',
    name: 'Llama 3.1 8B',
    description: 'FREE - Ultra-fast small Llama model',
    maxTokens: 4096,
    envKey: 'GROQ_API_KEY',
    free: true
  },
  'mixtral-8x7b-32768': {
    provider: 'groq',
    name: 'Mixtral 8x7B',
    description: 'FREE - Mistral\'s MoE model via Groq',
    maxTokens: 4096,
    envKey: 'GROQ_API_KEY',
    free: true
  },
  'gemma2-9b-it': {
    provider: 'groq',
    name: 'Gemma 2 9B',
    description: 'FREE - Google\'s open model via Groq',
    maxTokens: 4096,
    envKey: 'GROQ_API_KEY',
    free: true
  },

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

  // Mistral AI - FREE tier available
  // Sign up: https://console.mistral.ai (free tier)
  'mistral-small-latest': {
    provider: 'mistral',
    name: 'Mistral Small',
    description: 'FREE tier - Fast and efficient',
    maxTokens: 4096,
    envKey: 'MISTRAL_API_KEY',
    free: true
  },
  'mistral-large-latest': {
    provider: 'mistral',
    name: 'Mistral Large',
    description: 'FREE tier - Most capable Mistral',
    maxTokens: 4096,
    envKey: 'MISTRAL_API_KEY',
    free: true
  },

  // OpenRouter - aggregator, some free models
  // Sign up: https://openrouter.ai/keys (free)
  'openrouter/google/gemma-2-9b-it:free': {
    provider: 'openrouter',
    name: 'Gemma 2 9B (Free)',
    description: 'FREE - Via OpenRouter',
    maxTokens: 4096,
    envKey: 'OPENROUTER_API_KEY',
    free: true
  },
  'openrouter/meta-llama/llama-3.1-8b-instruct:free': {
    provider: 'openrouter',
    name: 'Llama 3.1 8B (Free)',
    description: 'FREE - Via OpenRouter',
    maxTokens: 4096,
    envKey: 'OPENROUTER_API_KEY',
    free: true
  },
  'openrouter/qwen/qwen-2.5-7b-instruct:free': {
    provider: 'openrouter',
    name: 'Qwen 2.5 7B (Free)',
    description: 'FREE - Alibaba model via OpenRouter',
    maxTokens: 4096,
    envKey: 'OPENROUTER_API_KEY',
    free: true
  },

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

  // Google Gemini Models (generous free tier)
  'gemini-2.0-flash': {
    provider: 'google',
    name: 'Gemini 2.0 Flash',
    description: 'FREE tier available - Latest fast model',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-1.5-pro': {
    provider: 'google',
    name: 'Gemini 1.5 Pro',
    description: 'FREE tier - 1M context window',
    maxTokens: 8192,
    envKey: 'GOOGLE_AI_API_KEY',
    free: true
  },
  'gemini-1.5-flash': {
    provider: 'google',
    name: 'Gemini 1.5 Flash',
    description: 'FREE tier - Fast and versatile',
    maxTokens: 8192,
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
  { provider: 'google', modelId: 'gemini-2.5-flash', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.0-flash', envKey: 'GOOGLE_AI_API_KEY' },
  { provider: 'google', modelId: 'gemini-2.0-flash-lite', envKey: 'GOOGLE_AI_API_KEY' },
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
  return true; // Always available — Pollinations works without any API key
}

/**
 * Get the best available backend for Innovate AI
 */
function getInnovateAIBackend() {
  for (const p of INNOVATE_AI_PROVIDER_PRIORITY) {
    if (p.provider === 'pollinations') return p; // Always available
    if (p.provider === 'ollama') {
      if (process.env.OLLAMA_ENABLED === 'true') return p;
    } else {
      if (process.env[p.envKey]) return p;
    }
  }
  // Should never reach here since pollinations is always available
  return INNOVATE_AI_PROVIDER_PRIORITY[INNOVATE_AI_PROVIDER_PRIORITY.length - 1];
}

/**
 * Get list of available models (that have API keys configured)
 */
function getAvailableModels() {
  const models = [];
  for (const [id, config] of Object.entries(AI_MODELS)) {
    let isAvailable;
    if (config.provider === 'innovate') {
      isAvailable = isInnovateAIAvailable();
    } else if (config.provider === 'pollinations') {
      isAvailable = true; // Always available
    } else if (config.provider === 'ollama') {
      isAvailable = process.env.OLLAMA_ENABLED === 'true';
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
      isAvailable = true; // Always available
    } else if (config.provider === 'ollama') {
      isAvailable = process.env.OLLAMA_ENABLED === 'true';
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
  const modelConfig = AI_MODELS[modelId];
  if (!modelConfig) {
    throw new Error(`Unknown model: ${modelId}. Available: ${Object.keys(AI_MODELS).join(', ')}`);
  }

  // Innovate AI uses smart routing — no separate API key check
  if (modelConfig.provider === 'innovate') {
    // Always available — Pollinations fallback ensures Innovate AI always works
  } else if (modelConfig.provider === 'pollinations') {
    // Always available — no API key needed
  } else if (modelConfig.provider === 'ollama') {
    if (process.env.OLLAMA_ENABLED !== 'true') {
      throw new Error('Ollama is not enabled. Set OLLAMA_ENABLED=true in .env and ensure Ollama is running locally.');
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
      case 'cohere':
        return await callCohere(modelId, apiKey, messages, temperature, maxTokens);
      case 'mistral':
        return await callMistral(modelId, apiKey, messages, temperature, maxTokens);
      case 'openrouter':
        return await callOpenRouter(modelId, apiKey, messages, temperature, maxTokens);
      case 'pollinations':
        return await callPollinationsWithPrompt(messages, temperature, maxTokens, INNOVATE_AI_SYSTEM_PROMPT);
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
        throw new Error(`Rate limit exceeded for ${modelConfig.name}. Your API key has hit its usage limit. Try a free model like Groq Llama 3.3.`);
      }
      if (status === 400) {
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
    const isAvailable = candidate.provider === 'pollinations' 
      ? true  // Always available, no API key needed
      : candidate.provider === 'ollama' 
        ? process.env.OLLAMA_ENABLED === 'true'
        : !!process.env[candidate.envKey];
    
    if (!isAvailable) continue;

    try {
      const targetModel = AI_MODELS[candidate.modelId];
      if (!targetModel && candidate.provider !== 'pollinations') continue;

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
        case 'pollinations':
          result = await callPollinationsWithPrompt(innovateMessages, temperature, maxTokens, systemPrompt);
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
      markProviderFailed(candidate.provider, candidate.modelId);
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
async function callPollinationsWithPrompt(messages, temperature, maxTokens, systemPrompt) {
  const payload = {
    model: 'mistral',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(PROVIDER_CONFIGS.pollinations.baseUrl, payload, {
    headers: PROVIDER_CONFIGS.pollinations.headers(),
    timeout: 30000  // Free tier needs more time
  });

  return {
    content: response.data.choices[0].message.content,
    model: 'pollinations-openai',
    tokens: {
      prompt: response.data.usage?.prompt_tokens || 0,
      completion: response.data.usage?.completion_tokens || 0,
      total: response.data.usage?.total_tokens || 0
    }
  };
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
    model: 'mistral',
    messages: apiMessages,
    temperature,
    max_tokens: maxTokens
  };

  const response = await axios.post(PROVIDER_CONFIGS.pollinations.baseUrl, payload, {
    headers: PROVIDER_CONFIGS.pollinations.headers(),
    timeout: 90000  // Vision may take longer on free tier
  });

  return {
    content: response.data.choices[0].message.content,
    model: 'pollinations-openai',
    tokens: {
      prompt: response.data.usage?.prompt_tokens || 0,
      completion: response.data.usage?.completion_tokens || 0,
      total: response.data.usage?.total_tokens || 0
    }
  };
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
  const url = `${PROVIDER_CONFIGS.google.baseUrl(modelId)}?key=${apiKey}`;
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));
  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature, maxOutputTokens: maxTokens, topP: 0.95 }
  };
  const response = await axios.post(url, payload, {
    headers: PROVIDER_CONFIGS.google.headers(), timeout: 15000
  });
  const candidate = response.data.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.[0]?.text) throw new Error('No response from Gemini');
  return {
    content: candidate.content.parts[0].text,
    model: modelId,
    tokens: { prompt: response.data.usageMetadata?.promptTokenCount, completion: response.data.usageMetadata?.candidatesTokenCount, total: response.data.usageMetadata?.totalTokenCount }
  };
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
  const url = `${PROVIDER_CONFIGS.google.baseUrl(modelId)}?key=${apiKey}`;
  
  // Convert OpenAI-style messages to Gemini format
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95
    }
  };

  const response = await axios.post(url, payload, {
    headers: PROVIDER_CONFIGS.google.headers(),
    timeout: 15000
  });

  const candidate = response.data.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    throw new Error('No response generated by Gemini');
  }

  return {
    content: candidate.content.parts[0].text,
    model: modelId,
    tokens: {
      prompt: response.data.usageMetadata?.promptTokenCount,
      completion: response.data.usageMetadata?.candidatesTokenCount,
      total: response.data.usageMetadata?.totalTokenCount
    }
  };
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
  // Extract actual model path: 'openrouter/google/gemma-2-9b-it:free' -> 'google/gemma-2-9b-it:free'
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
  const url = `${PROVIDER_CONFIGS.google.baseUrl(modelId)}?key=${apiKey}`;
  
  // Build Gemini multimodal content
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
    inline_data: {
      mime_type: imageData.mimeType,
      data: imageData.base64
    }
  });
  
  // Add text prompt
  if (lastMsg?.content) {
    lastParts.push({ text: lastMsg.content });
  }
  
  contents.push({
    role: 'user',
    parts: lastParts
  });

  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature, maxOutputTokens: maxTokens, topP: 0.95 }
  };

  const response = await axios.post(url, payload, {
    headers: PROVIDER_CONFIGS.google.headers(),
    timeout: 15000
  });

  const candidate = response.data.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    throw new Error('No response from Gemini Vision');
  }

  return {
    content: candidate.content.parts[0].text,
    model: modelId,
    tokens: {
      prompt: response.data.usageMetadata?.promptTokenCount,
      completion: response.data.usageMetadata?.candidatesTokenCount,
      total: response.data.usageMetadata?.totalTokenCount
    }
  };
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
