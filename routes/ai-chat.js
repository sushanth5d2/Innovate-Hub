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
  if (req.files?.file) {
    const file = req.files.file[0];
    originalFilename = file.originalname;
    console.log('AI Chat - File uploaded:', originalFilename, 'MIME:', file.mimetype);
    attachmentUrl = file.mimetype.startsWith('image/')
      ? `/uploads/images/${file.filename}`
      : file.mimetype.startsWith('video/')
        ? `/uploads/files/${file.filename}`
        : `/uploads/files/${file.filename}`;
    attachmentType = file.mimetype.startsWith('image/') ? 'image'
      : file.mimetype.startsWith('video/') ? 'video' : 'file';
  }

  // Allow sending with just a file (no text message required)
  if ((!message || !message.trim()) && !attachmentUrl) {
    return res.status(400).json({ error: 'Message or attachment is required' });
  }

  try {
    // Determine which model to use
    let selectedModel = model_id;
    if (!selectedModel) {
      // Get user preference
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
      // Create new conversation with first few words as title
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

    // Build the user message content (include attachment description for AI context)
    let userContent = message || '';
    let attachmentContext = '';
    if (attachmentUrl) {
      const typeLabel = attachmentType === 'image' ? 'image' : attachmentType === 'video' ? 'video' : 'file';
      attachmentContext = `[User attached a ${typeLabel}: ${originalFilename}]`;
      if (!userContent) {
        userContent = attachmentContext;
      }
    }

    // Save user message to DB (with attachment info)
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

    // Enrich history with attachment context for the AI
    const enrichedHistory = history.map(msg => {
      let content = msg.content;
      if (msg.attachment_url && msg.role === 'user') {
        const typeLabel = msg.attachment_type === 'image' ? 'image' : msg.attachment_type === 'video' ? 'video' : 'file';
        content = `${content}\n[Attached ${typeLabel}: ${msg.original_filename}]`;
      }
      return { role: msg.role, content };
    });

    // Emit typing indicator via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${userId}`).emit('ai:typing', { conversation_id: convId, model: selectedModel });

    // Call AI provider
    const aiResponse = await aiProvider.chat(selectedModel, enrichedHistory);

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

    // Emit response via Socket.IO for real-time feel
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
    
    // Emit error via socket
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
