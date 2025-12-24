const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// Get all todos for user
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT * FROM todos
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  db.all(query, [userId], (err, todos) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching todos' });
    }

    // Parse JSON fields
    const parsedTodos = todos.map(todo => ({
      ...todo,
      items: JSON.parse(todo.items || '[]'),
      tags: JSON.parse(todo.tags || '[]')
    }));

    res.json({ success: true, todos: parsedTodos });
  });
});

// Create todo list
router.post('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { title, items, tags, priority, due_date } = req.body;

  const query = `
    INSERT INTO todos (user_id, title, items, tags, priority, due_date, completed)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `;

  db.run(
    query,
    [userId, title, JSON.stringify(items || []), JSON.stringify(tags || []), priority || 'medium', due_date || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error creating todo' });
      }

      res.json({
        success: true,
        todo: {
          id: this.lastID,
          user_id: userId,
          title,
          items,
          tags,
          priority: priority || 'medium',
          due_date,
          completed: 0,
          created_at: new Date().toISOString()
        }
      });
    }
  );
});

// Create todo from image (AI analysis)
router.post('/from-image', authMiddleware, upload.single('image'), async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  if (!req.file) {
    return res.status(400).json({ error: 'No image provided' });
  }

  try {
    // Call ML service for image analysis
    const mlClient = require('../services/ml-client');
    const imagePath = req.file.path;

    // Analyze image text content
    const analysis = await mlClient.analyzeImageForTasks(imagePath);

    if (!analysis.success || !analysis.tasks || analysis.tasks.length === 0) {
      return res.status(400).json({ 
        error: 'Could not extract tasks from image',
        suggestion: 'Please ensure the image contains clear, readable text'
      });
    }

    // Create todo from extracted tasks
    const title = analysis.title || 'Tasks from Image';
    const items = analysis.tasks.map(task => ({
      text: task.text,
      completed: false,
      priority: task.priority || 'medium'
    }));

    const query = `
      INSERT INTO todos (user_id, title, items, tags, priority, due_date, completed, image_source)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `;

    db.run(
      query,
      [
        userId, 
        title, 
        JSON.stringify(items),
        JSON.stringify(analysis.tags || []),
        analysis.priority || 'medium',
        analysis.due_date || null,
        `/uploads/${req.file.filename}`
      ],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error creating todo from image' });
        }

        res.json({
          success: true,
          message: `Extracted ${items.length} tasks from image`,
          todo: {
            id: this.lastID,
            user_id: userId,
            title,
            items,
            tags: analysis.tags || [],
            priority: analysis.priority || 'medium',
            due_date: analysis.due_date,
            completed: 0,
            image_source: `/uploads/${req.file.filename}`,
            created_at: new Date().toISOString()
          }
        });
      }
    );

  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).json({ 
      error: 'Error analyzing image',
      message: error.message 
    });
  }
});

// Update todo
router.put('/:todoId', authMiddleware, (req, res) => {
  const db = getDb();
  const { todoId } = req.params;
  const userId = req.user.userId;
  const { title, items, tags, priority, due_date, completed } = req.body;

  const query = `
    UPDATE todos 
    SET title = ?, items = ?, tags = ?, priority = ?, due_date = ?, completed = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `;

  db.run(
    query,
    [
      title, 
      JSON.stringify(items || []), 
      JSON.stringify(tags || []), 
      priority, 
      due_date || null, 
      completed ? 1 : 0,
      todoId, 
      userId
    ],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating todo' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Todo not found or unauthorized' });
      }

      res.json({ success: true });
    }
  );
});

// Toggle todo item completion
router.patch('/:todoId/items/:itemIndex', authMiddleware, (req, res) => {
  const db = getDb();
  const { todoId, itemIndex } = req.params;
  const userId = req.user.userId;

  // Get current todo
  db.get('SELECT * FROM todos WHERE id = ? AND user_id = ?', [todoId, userId], (err, todo) => {
    if (err || !todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    const items = JSON.parse(todo.items || '[]');
    const index = parseInt(itemIndex);

    if (index < 0 || index >= items.length) {
      return res.status(400).json({ error: 'Invalid item index' });
    }

    // Toggle completion
    items[index].completed = !items[index].completed;

    // Check if all items are completed
    const allCompleted = items.every(item => item.completed);

    // Update todo
    db.run(
      'UPDATE todos SET items = ?, completed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(items), allCompleted ? 1 : 0, todoId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error updating todo item' });
        }

        res.json({ 
          success: true,
          items,
          allCompleted
        });
      }
    );
  });
});

// Delete todo
router.delete('/:todoId', authMiddleware, (req, res) => {
  const db = getDb();
  const { todoId } = req.params;
  const userId = req.user.userId;

  db.run(
    'DELETE FROM todos WHERE id = ? AND user_id = ?',
    [todoId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting todo' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Todo not found or unauthorized' });
      }

      res.json({ success: true });
    }
  );
});

// Get todo statistics
router.get('/stats', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const queries = {
    total: 'SELECT COUNT(*) as count FROM todos WHERE user_id = ?',
    completed: 'SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 1',
    pending: 'SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 0',
    overdue: `SELECT COUNT(*) as count FROM todos 
              WHERE user_id = ? AND completed = 0 AND due_date < datetime('now')`
  };

  const stats = {};
  let completed = 0;

  Object.keys(queries).forEach(key => {
    db.get(queries[key], [userId], (err, result) => {
      if (!err) {
        stats[key] = result.count;
      }
      completed++;

      if (completed === Object.keys(queries).length) {
        res.json({ success: true, stats });
      }
    });
  });
});

module.exports = router;
