/**
 * AI Provider Service - Unified interface for multiple AI models
 * Supports: OpenAI, Google Gemini, xAI Grok, Anthropic Claude, DeepSeek,
 *           Groq (FREE), HuggingFace (FREE), Ollama (LOCAL/FREE),
 *           Cohere (FREE tier), Mistral (FREE tier), OpenRouter (FREE models)
 */

const axios = require('axios');

// Available AI models configuration
const AI_MODELS = {
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
  }
};

const SYSTEM_PROMPT = `You are Innovate AI, a helpful and intelligent assistant integrated into the Innovate Hub social platform. You are friendly, concise, and knowledgeable. You help users with questions, creative tasks, coding, analysis, and general conversation. Keep responses well-formatted and clear. Use markdown formatting when helpful. Be conversational but accurate.`;

/**
 * Get list of available models (that have API keys configured)
 */
function getAvailableModels() {
  const models = [];
  for (const [id, config] of Object.entries(AI_MODELS)) {
    const isAvailable = config.provider === 'ollama' 
      ? (process.env.OLLAMA_ENABLED === 'true')
      : !!process.env[config.envKey];
    models.push({
      id,
      name: config.name,
      provider: config.provider,
      description: config.description,
      available: isAvailable,
      free: config.free || false,
      local: config.local || false
    });
  }
  return models;
}

/**
 * Get all models including unavailable ones
 */
function getAllModels() {
  return Object.entries(AI_MODELS).map(([id, config]) => {
    const isAvailable = config.provider === 'ollama'
      ? (process.env.OLLAMA_ENABLED === 'true')
      : !!process.env[config.envKey];
    return {
      id,
      name: config.name,
      provider: config.provider,
      description: config.description,
      available: isAvailable,
      free: config.free || false,
      local: config.local || false
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

  // Ollama uses a different availability check
  if (modelConfig.provider === 'ollama') {
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

// ===================== Provider-specific implementations =====================

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
    timeout: 60000
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
    timeout: 60000
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
    timeout: 60000
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
    timeout: 60000
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
    timeout: 60000
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
    timeout: 60000
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
    timeout: 60000
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
    timeout: 60000
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
    timeout: 60000
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

module.exports = {
  AI_MODELS,
  getAvailableModels,
  getAllModels,
  chat
};
