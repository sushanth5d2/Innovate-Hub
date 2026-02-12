/**
 * AI Chat Routes - Multi-model AI chatbot in messages
 * Endpoints for chat, model listing, conversation history, and preferences
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');
const aiProvider = require('../services/ai-provider');

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
        preferred_model: row?.preferred_model || 'llama-3.3-70b-versatile',
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
    [userId, title || 'New Chat', model_id || 'llama-3.3-70b-versatile'],
    function(err) {
      if (err) {
        console.error('Error creating AI conversation:', err);
        return res.status(500).json({ error: 'Failed to create conversation' });
      }
      res.json({ 
        id: this.lastID,
        title: title || 'New Chat',
        model_id: model_id || 'llama-3.3-70b-versatile'
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
        `SELECT id, role, content, model_id, tokens_used, created_at
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
 * Body: { message, model_id?, conversation_id? }
 */
router.post('/send', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { message, model_id, conversation_id } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
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
      selectedModel = pref?.preferred_model || 'llama-3.3-70b-versatile';
    }

    // Get or create conversation
    let convId = conversation_id;
    if (!convId) {
      // Create new conversation with first few words as title
      const title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
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

    // Save user message to DB
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ai_chat_messages (conversation_id, role, content, model_id, created_at)
         VALUES (?, 'user', ?, ?, CURRENT_TIMESTAMP)`,
        [convId, message, selectedModel],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });

    // Load conversation history for context (last 20 messages)
    const history = await new Promise((resolve, reject) => {
      db.all(
        `SELECT role, content FROM ai_chat_messages
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

    // Emit typing indicator via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${userId}`).emit('ai:typing', { conversation_id: convId, model: selectedModel });

    // Call AI provider
    const aiResponse = await aiProvider.chat(selectedModel, history);

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
});

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
    const selectedModel = model_id || 'llama-3.3-70b-versatile';
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

module.exports = router;
