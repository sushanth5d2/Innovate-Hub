/**
 * AI Chat Routes - Multi-model AI chatbot in messages
 * Endpoints for chat, model listing, conversation history, and preferences
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');
const aiProvider = require('../services/ai-provider');
const upload = require('../middleware/upload');
const aiMedia = require('../services/ai-media-generator');
const fileAnalyzer = require('../services/file-analyzer');

// ==================== Models & Config ====================

/**
 * GET /api/ai-chat/models
 * List all available AI models with their status
 */
router.get('/models', authMiddleware, (req, res) => {
  try {
    const models = aiProvider.getAllModels();
    res.json({ models });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

/**
 * GET /api/ai-chat/preferences
 * Get user's AI chat preferences (selected model, etc.)
 */
router.get('/preferences', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  db.get(
    'SELECT preferred_model, system_prompt, temperature FROM ai_user_preferences WHERE user_id = ?',
    [userId],
    (err, row) => {
      if (err) {
        console.error('Error fetching AI preferences:', err);
        return res.status(500).json({ error: 'Failed to fetch preferences' });
      }
      
      res.json({
        preferred_model: row?.preferred_model || 'innovate-ai',
        system_prompt: row?.system_prompt || null,
        temperature: row?.temperature ?? 0.7
      });
    }
  );
});

/**
 * PUT /api/ai-chat/preferences
 * Update user's AI chat preferences
 */
router.put('/preferences', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { preferred_model, system_prompt, temperature } = req.body;

  // Validate model exists
  if (preferred_model) {
    const models = aiProvider.getAllModels();
    const modelExists = models.some(m => m.id === preferred_model);
    if (!modelExists) {
      return res.status(400).json({ error: 'Invalid model ID' });
    }
  }

  db.run(
    `INSERT INTO ai_user_preferences (user_id, preferred_model, system_prompt, temperature, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET 
       preferred_model = COALESCE(?, preferred_model),
       system_prompt = COALESCE(?, system_prompt),
       temperature = COALESCE(?, temperature),
       updated_at = CURRENT_TIMESTAMP`,
    [userId, preferred_model, system_prompt, temperature, preferred_model, system_prompt, temperature],
    (err) => {
      if (err) {
        console.error('Error updating AI preferences:', err);
        return res.status(500).json({ error: 'Failed to update preferences' });
      }
      res.json({ success: true, message: 'Preferences updated' });
    }
  );
});

// ==================== Conversations ====================

/**
 * GET /api/ai-chat/conversations
 * List all AI chat conversations for the user
 */
router.get('/conversations', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  db.all(
    `SELECT c.id, c.title, c.model_id, c.created_at, c.updated_at,
     (SELECT content FROM ai_chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
     (SELECT COUNT(*) FROM ai_chat_messages WHERE conversation_id = c.id) as message_count
     FROM ai_conversations c
     WHERE c.user_id = ? AND c.is_deleted = 0
     ORDER BY c.updated_at DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching AI conversations:', err);
        return res.status(500).json({ error: 'Failed to fetch conversations' });
      }
      res.json({ conversations: rows || [] });
    }
  );
});

/**
 * POST /api/ai-chat/conversations
 * Create a new AI conversation
 */
router.post('/conversations', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { title, model_id } = req.body;

  db.run(
    `INSERT INTO ai_conversations (user_id, title, model_id, created_at, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [userId, title || 'New Chat', model_id || 'innovate-ai'],
    function(err) {
      if (err) {
        console.error('Error creating AI conversation:', err);
        return res.status(500).json({ error: 'Failed to create conversation' });
      }
      res.json({ 
        id: this.lastID,
        title: title || 'New Chat',
        model_id: model_id || 'innovate-ai'
      });
    }
  );
});

/**
 * DELETE /api/ai-chat/conversations/:id
 * Soft delete an AI conversation
 */
router.delete('/conversations/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const conversationId = req.params.id;

  db.run(
    'UPDATE ai_conversations SET is_deleted = 1 WHERE id = ? AND user_id = ?',
    [conversationId, userId],
    function(err) {
      if (err) {
        console.error('Error deleting AI conversation:', err);
        return res.status(500).json({ error: 'Failed to delete conversation' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      res.json({ success: true });
    }
  );
});

// ==================== Messages & Chat ====================

/**
 * GET /api/ai-chat/conversations/:id/messages
 * Get messages for a specific conversation
 */
router.get('/conversations/:id/messages', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const conversationId = req.params.id;

  // Verify ownership
  db.get(
    'SELECT id FROM ai_conversations WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [conversationId, userId],
    (err, conv) => {
      if (err || !conv) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      db.all(
        `SELECT id, role, content, model_id, tokens_used, attachment_url, attachment_type, original_filename, created_at
         FROM ai_chat_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC`,
        [conversationId],
        (err, messages) => {
          if (err) {
            console.error('Error fetching AI messages:', err);
            return res.status(500).json({ error: 'Failed to fetch messages' });
          }
          res.json({ messages: messages || [] });
        }
      );
    }
  );
});

/**
 * POST /api/ai-chat/send
 * Send a message to the AI and get a response
 * Supports file uploads (image, video, document) via multipart form data
 * Body: { message, model_id?, conversation_id? } OR FormData with file + message
 */
router.post('/send', authMiddleware, (req, res, next) => {
  // Handle optional file upload
  upload.fields([
    { name: 'file', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      console.error('AI chat upload error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    handleAIChatSend(req, res);
  });
});

async function handleAIChatSend(req, res) {
  const db = getDb();
  const userId = req.user.userId;
  const { message, model_id, conversation_id } = req.body;

  // Check for uploaded file
  let attachmentUrl = null;
  let attachmentType = null;
  let originalFilename = null;
  let fileMimeType = null;
  let fileAnalysis = null;

  if (req.files?.file) {
    const file = req.files.file[0];
    originalFilename = file.originalname;
    fileMimeType = file.mimetype;
    console.log('AI Chat - File uploaded:', originalFilename, 'MIME:', file.mimetype, 'Path:', file.path);
    
    attachmentUrl = file.mimetype.startsWith('image/')
      ? `/uploads/images/${file.filename}`
      : file.mimetype.startsWith('video/')
        ? `/uploads/files/${file.filename}`
        : `/uploads/files/${file.filename}`;
    attachmentType = file.mimetype.startsWith('image/') ? 'image'
      : file.mimetype.startsWith('video/') ? 'video' : 'file';

    // Analyze the file for AI comprehension
    try {
      fileAnalysis = await fileAnalyzer.analyzeFile(file.path, file.mimetype, file.originalname);
      console.log('AI Chat - File analysis:', fileAnalysis.type, 'canAnalyze:', fileAnalysis.canAnalyze, 'requiresVision:', fileAnalysis.requiresVision);
    } catch (err) {
      console.error('AI Chat - File analysis failed:', err.message);
    }
  }

  // Allow sending with just a file (no text message required)
  if ((!message || !message.trim()) && !attachmentUrl) {
    return res.status(400).json({ error: 'Message or attachment is required' });
  }

  try {
    // Determine which model to use
    let selectedModel = model_id;
    if (!selectedModel) {
      const pref = await new Promise((resolve, reject) => {
        db.get('SELECT preferred_model FROM ai_user_preferences WHERE user_id = ?', [userId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      selectedModel = pref?.preferred_model || 'innovate-ai';
    }

    // Get or create conversation
    let convId = conversation_id;
    if (!convId) {
      const titleSource = message || originalFilename || 'New Chat';
      const title = titleSource.substring(0, 50) + (titleSource.length > 50 ? '...' : '');
      convId = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ai_conversations (user_id, title, model_id, created_at, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, title, selectedModel],
          function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      });
    }

    // Build the user message content
    let userContent = message || '';
    if (attachmentUrl && !userContent) {
      userContent = `[Uploaded ${attachmentType}: ${originalFilename}]`;
    }

    // Save user message to DB
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, attachment_url, attachment_type, original_filename, created_at)
         VALUES (?, 'user', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [convId, userContent, selectedModel, attachmentUrl, attachmentType, originalFilename],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });

    // Load conversation history for context (last 20 messages)
    const history = await new Promise((resolve, reject) => {
      db.all(
        `SELECT role, content, attachment_url, attachment_type, original_filename FROM ai_chat_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC
         LIMIT 20`,
        [convId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Build enriched history  
    const enrichedHistory = history.map(msg => {
      let content = msg.content;
      if (msg.attachment_url && msg.role === 'user' && msg !== history[history.length - 1]) {
        const typeLabel = msg.attachment_type === 'image' ? 'image' : msg.attachment_type === 'video' ? 'video' : 'file';
        content = `${content}\n[Previously attached ${typeLabel}: ${msg.original_filename}]`;
      }
      return { role: msg.role, content };
    });

    // Emit typing indicator
    const io = req.app.get('io');
    io.to(`user-${userId}`).emit('ai:typing', { conversation_id: convId, model: selectedModel });

    let aiResponse;

    // ========== VISION: Image analysis via multimodal models ==========
    if (fileAnalysis?.requiresVision && fileAnalysis?.base64) {
      console.log('[AI Chat] Routing to vision model for image analysis...');
      
      // Build the prompt for image analysis
      const lastMsg = enrichedHistory[enrichedHistory.length - 1];
      if (lastMsg) {
        // Remove the [Uploaded image: ...] placeholder, keep user's actual question
        lastMsg.content = (message || 'Describe this image in detail. What do you see?').trim();
      }

      try {
        aiResponse = await aiProvider.chatWithVision(
          selectedModel,
          enrichedHistory,
          { base64: fileAnalysis.base64, mimeType: fileAnalysis.mimeType },
          { temperature: 0.7 }
        );
      } catch (visionErr) {
        console.error('[AI Chat] Vision failed:', visionErr.message);
        // Fallback: send as text-only with description
        const fallbackContent = `${message || 'Describe this image.'}\n\n[User uploaded an image: ${originalFilename}. Vision analysis is not available — please inform the user that image analysis requires a vision-capable AI model like Gemini or GPT-4o.]`;
        enrichedHistory[enrichedHistory.length - 1].content = fallbackContent;
        aiResponse = await aiProvider.chat(selectedModel, enrichedHistory);
      }
    }
    // ========== DOCUMENT: PDF, DOCX, text files ==========
    else if (fileAnalysis?.canAnalyze && fileAnalysis?.extractedText) {
      console.log(`[AI Chat] Injecting extracted ${fileAnalysis.type} content (${fileAnalysis.extractedText.length} chars)...`);
      
      // Inject the extracted document content into the conversation
      const docContext = `--- DOCUMENT CONTENT (${originalFilename}) ---\n${fileAnalysis.extractedText}\n--- END OF DOCUMENT ---`;
      
      const userPrompt = message || `Please analyze this ${fileAnalysis.type === 'pdf' ? 'PDF document' : fileAnalysis.type === 'docx' ? 'Word document' : 'file'} and provide a summary.`;
      
      // Add a system-level instruction so the AI knows it CAN read the document
      enrichedHistory.unshift({
        role: 'system',
        content: `The user has uploaded a file named "${originalFilename}". The full text content of this file has been extracted and is included below in the user's message between "--- DOCUMENT CONTENT ---" markers. You HAVE access to read this document. Analyze and respond based on its actual contents. Do NOT say you cannot read or access the file — the text is right there in the conversation.`
      });
      
      // Replace the last message with document context + user prompt
      enrichedHistory[enrichedHistory.length - 1].content = `${userPrompt}\n\n${docContext}`;
      
      // Add file metadata hint
      if (fileAnalysis.summary) {
        enrichedHistory[enrichedHistory.length - 1].content += `\n\n[${fileAnalysis.summary}]`;
      }
      
      aiResponse = await aiProvider.chat(selectedModel, enrichedHistory);
    }
    // ========== NO FILE or unanalyzable file — standard text chat ==========
    else {
      // Add plain attachment context if file present but not analyzable
      if (attachmentUrl && !fileAnalysis?.canAnalyze) {
        const lastMsg = enrichedHistory[enrichedHistory.length - 1];
        if (lastMsg) {
          lastMsg.content += `\n[User attached a ${attachmentType}: ${originalFilename}]`;
        }
      }
      
      aiResponse = await aiProvider.chat(selectedModel, enrichedHistory);
    }

    // Save AI response to DB
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, tokens_used, created_at)
         VALUES (?, 'assistant', ?, ?, ?, CURRENT_TIMESTAMP)`,
        [convId, aiResponse.content, selectedModel, aiResponse.tokens?.total || 0],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });

    // Update conversation timestamp
    db.run(
      'UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP, model_id = ? WHERE id = ?',
      [selectedModel, convId]
    );

    // Emit response via Socket.IO
    io.to(`user-${userId}`).emit('ai:response', {
      conversation_id: convId,
      content: aiResponse.content,
      model: selectedModel,
      model_name: aiProvider.AI_MODELS[selectedModel]?.name || selectedModel,
      tokens: aiResponse.tokens
    });

    res.json({
      success: true,
      conversation_id: convId,
      attachment: attachmentUrl ? {
        url: attachmentUrl,
        type: attachmentType,
        filename: originalFilename
      } : null,
      response: {
        content: aiResponse.content,
        model: selectedModel,
        model_name: aiProvider.AI_MODELS[selectedModel]?.name || selectedModel,
        tokens: aiResponse.tokens
      }
    });

  } catch (error) {
    console.error('AI chat error:', error.message);
    
    const io = req.app.get('io');
    io.to(`user-${userId}`).emit('ai:error', { 
      error: error.message,
      conversation_id: conversation_id 
    });

    res.status(500).json({ 
      error: error.message || 'Failed to get AI response',
      model: model_id
    });
  }
}

/**
 * POST /api/ai-chat/quick
 * Quick one-off AI query without saving to conversation history
 * Body: { message, model_id? }
 */
router.post('/quick', authMiddleware, async (req, res) => {
  const { message, model_id } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const selectedModel = model_id || 'innovate-ai';
    const aiResponse = await aiProvider.chat(selectedModel, [
      { role: 'user', content: message }
    ]);

    res.json({
      content: aiResponse.content,
      model: selectedModel,
      model_name: aiProvider.AI_MODELS[selectedModel]?.name || selectedModel,
      tokens: aiResponse.tokens
    });
  } catch (error) {
    console.error('AI quick chat error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to get AI response' });
  }
});

// ==================== AI Media Generation ====================

/**
 * GET /api/ai-chat/capabilities
 * Get available AI generation capabilities
 */
router.get('/capabilities', authMiddleware, (req, res) => {
  res.json(aiMedia.getCapabilities());
});

/**
 * POST /api/ai-chat/generate-image
 * Generate an image from a text prompt
 * Body: { prompt, width?, height?, style?, conversation_id? }
 */
router.post('/generate-image', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { prompt, width, height, style, conversation_id } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    // Generate the image
    const result = await aiMedia.generateImage(prompt, { width, height, style });

    // Save to conversation if provided
    let convId = conversation_id;
    if (convId) {
      // Save user prompt message
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, created_at)
           VALUES (?, 'user', ?, 'image-generator', CURRENT_TIMESTAMP)`,
          [convId, `Generate image: ${prompt}`],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      // Save generated image as assistant message
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, attachment_url, attachment_type, original_filename, created_at)
           VALUES (?, 'assistant', ?, 'image-generator', ?, 'image', ?, CURRENT_TIMESTAMP)`,
          [convId, `Here's the generated image for: "${prompt}"`, result.url, `generated-${Date.now()}.png`],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      db.run('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [convId]);
    }

    res.json({
      success: true,
      image: result,
      conversation_id: convId
    });

  } catch (error) {
    console.error('Image generation error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to generate image' });
  }
});

/**
 * POST /api/ai-chat/generate-video
 * Generate a video from a text prompt
 * Body: { prompt, conversation_id? }
 */
router.post('/generate-video', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { prompt, conversation_id } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const result = await aiMedia.generateVideo(prompt);

    let convId = conversation_id;
    if (convId) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, created_at)
           VALUES (?, 'user', ?, 'video-generator', CURRENT_TIMESTAMP)`,
          [convId, `Generate video: ${prompt}`],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, attachment_url, attachment_type, original_filename, created_at)
           VALUES (?, 'assistant', ?, 'video-generator', ?, 'video', ?, CURRENT_TIMESTAMP)`,
          [convId, `Here's the generated video for: "${prompt}"`, result.url, `generated-${Date.now()}.mp4`],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      db.run('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [convId]);
    }

    res.json({ success: true, video: result, conversation_id: convId });

  } catch (error) {
    console.error('Video generation error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to generate video' });
  }
});

/**
 * POST /api/ai-chat/image-to-video
 * Animate an image into a video
 * Body (FormData): file (image), prompt?, conversation_id?
 */
router.post('/image-to-video', authMiddleware, (req, res, next) => {
  upload.fields([{ name: 'file', maxCount: 1 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    handleImageToVideo(req, res);
  });
});

async function handleImageToVideo(req, res) {
  const db = getDb();
  const userId = req.user.userId;
  const { prompt, conversation_id } = req.body;

  if (!req.files?.file) {
    return res.status(400).json({ error: 'Image file is required' });
  }

  const file = req.files.file[0];
  const imagePath = file.mimetype.startsWith('image/')
    ? `/uploads/images/${file.filename}`
    : `/uploads/files/${file.filename}`;

  try {
    const result = await aiMedia.imageToVideo(imagePath, prompt);

    let convId = conversation_id;
    if (convId) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, attachment_url, attachment_type, original_filename, created_at)
           VALUES (?, 'user', ?, 'video-generator', ?, 'image', ?, CURRENT_TIMESTAMP)`,
          [convId, prompt || 'Animate this image into a video', imagePath, file.originalname],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, attachment_url, attachment_type, original_filename, created_at)
           VALUES (?, 'assistant', ?, 'video-generator', ?, 'video', ?, CURRENT_TIMESTAMP)`,
          [convId, 'Here\'s the animated video from your image!', result.url, `animated-${Date.now()}.mp4`],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });

      db.run('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [convId]);
    }

    res.json({ success: true, video: result, conversation_id: convId });

  } catch (error) {
    console.error('Image-to-video error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to convert image to video' });
  }
}

module.exports = router;
