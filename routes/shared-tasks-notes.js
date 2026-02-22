/**
 * Shared Tasks & Notes API
 * 
 * Unified model for tasks and notes that works across contexts:
 * - context_type: 'user' (profile page) or 'group' (community group)
 * - context_id: user ID or group ID
 * 
 * Routes:
 *   GET    /shared/tasks?context_type=user|group&context_id=123
 *   POST   /shared/tasks
 *   PATCH  /shared/tasks/:taskId
 *   DELETE /shared/tasks/:taskId
 *   POST   /shared/tasks/from-text
 *   POST   /shared/tasks/from-image
 *
 *   GET    /shared/notes?context_type=user|group&context_id=123
 *   POST   /shared/notes
 *   GET    /shared/notes/:noteId
 *   PUT    /shared/notes/:noteId
 *   PUT    /shared/notes/:noteId/pin
 *   PUT    /shared/notes/:noteId/lock
 *   PUT    /shared/notes/:noteId/archive
 *   POST   /shared/notes/:noteId/duplicate
 *   DELETE /shared/notes/:noteId
 *   GET    /shared/notes/:noteId/versions
 *   POST   /shared/notes/:noteId/restore/:versionId
 *   GET    /shared/stats?context_type=user|group&context_id=123
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// ===================== HELPERS =====================

function extractTasksFromText(text) {
  const cleaned = (text || '').trim();
  if (!cleaned) return [];
  const lines = cleaned
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^[-*]\s+/, '').replace(/^\d+[\).]\s+/, '').trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  return lines.map(title => ({ title }));
}

/**
 * Validate that the user has access to the given context.
 * - For 'user' context: context_id must match the logged-in userId
 * - For 'group' context: user must be a member of the group
 */
async function validateContextAccess(db, userId, contextType, contextId) {
  if (contextType === 'user') {
    if (String(contextId) !== String(userId)) {
      return { allowed: false, error: 'You can only access your own tasks and notes' };
    }
    return { allowed: true };
  }

  if (contextType === 'group') {
    return new Promise((resolve) => {
      db.get(
        'SELECT id FROM community_group_members WHERE group_id = ? AND user_id = ?',
        [contextId, userId],
        (err, row) => {
          if (err || !row) {
            resolve({ allowed: false, error: 'You must be a group member' });
          } else {
            resolve({ allowed: true });
          }
        }
      );
    });
  }

  return { allowed: false, error: 'Invalid context_type. Use "user" or "group".' };
}

/**
 * Validate that an item belongs to the expected context or the user owns it.
 */
function validateItemOwnership(item, userId, contextType, contextId) {
  if (!item) return false;
  return item.context_type === contextType && String(item.context_id) === String(contextId);
}

// ===================== SHARED TASKS =====================

// List tasks
router.get('/tasks', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { context_type = 'user', context_id } = req.query;
  const resolvedContextId = context_id || userId;

  try {
    const access = await validateContextAccess(db, userId, context_type, resolvedContextId);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    db.all(
      `SELECT t.*, u.username as created_by_username
       FROM shared_tasks t
       JOIN users u ON t.created_by = u.id
       WHERE t.context_type = ? AND t.context_id = ?
       ORDER BY CASE t.status WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
                COALESCE(t.due_date, t.created_at) ASC`,
      [context_type, resolvedContextId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error fetching tasks' });
        const tasks = (rows || []).map(r => ({
          ...r,
          assignees: r.assignees ? JSON.parse(r.assignees) : [],
          tags: r.tags ? JSON.parse(r.tags) : [],
          subtasks: r.subtasks ? JSON.parse(r.subtasks) : []
        }));
        res.json({ success: true, tasks });
      }
    );
  } catch (e) {
    console.error('Shared tasks list error:', e);
    res.status(500).json({ error: 'Error fetching tasks' });
  }
});

// Create task(s) from text
router.post('/tasks/from-text', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const {
    context_type = 'user',
    context_id,
    text,
    priority = 'medium',
    due_date = null,
    assignees = [],
    description = '',
    subtasks = '[]',
    tags = '[]',
    progress = 0
  } = req.body || {};

  const resolvedContextId = context_id || userId;

  try {
    const access = await validateContextAccess(db, userId, context_type, resolvedContextId);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    const tasks = extractTasksFromText(text);
    if (tasks.length === 0) return res.status(400).json({ error: 'No tasks found in text' });

    const created = [];
    const stmt = db.prepare(
      `INSERT INTO shared_tasks (context_type, context_id, title, description, priority, status, due_date, assignees, progress, subtasks, tags, source_type, source_ref, created_by)
       VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, 'text', ?, ?)`
    );

    tasks.forEach(t => {
      stmt.run(
        context_type,
        resolvedContextId,
        t.title,
        description,
        priority,
        due_date,
        JSON.stringify(Array.isArray(assignees) ? assignees : []),
        progress,
        typeof subtasks === 'string' ? subtasks : JSON.stringify(subtasks),
        typeof tags === 'string' ? tags : JSON.stringify(tags),
        text || '',
        userId,
        function(err) {
          if (!err) created.push({ id: this.lastID, title: t.title });
        }
      );
    });

    stmt.finalize(() => res.json({ success: true, created_count: created.length, tasks: created }));
  } catch (e) {
    console.error('Shared tasks from-text error:', e);
    res.status(500).json({ error: 'Error creating tasks' });
  }
});

// Create task(s) from image
router.post('/tasks/from-image', authMiddleware, upload.single('image'), async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { context_type = 'user', context_id } = req.body || {};
  const resolvedContextId = context_id || userId;

  if (!req.file) return res.status(400).json({ error: 'Image file is required' });

  try {
    const access = await validateContextAccess(db, userId, context_type, resolvedContextId);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    let analysis;
    try {
      const mlClient = require('../services/ml-client');
      analysis = await mlClient.analyzeImageForTasks(req.file.path);
    } catch (mlErr) {
      return res.status(503).json({ error: 'ML service unavailable for OCR task extraction' });
    }

    if (!analysis || !analysis.success || !Array.isArray(analysis.tasks) || analysis.tasks.length === 0) {
      return res.status(400).json({ error: analysis?.error || 'No tasks found in image' });
    }

    const created = [];
    const stmt = db.prepare(
      `INSERT INTO shared_tasks (context_type, context_id, title, description, priority, status, due_date, assignees, progress, source_type, source_ref, created_by)
       VALUES (?, ?, ?, '', 'medium', 'todo', NULL, '[]', 0, 'image', ?, ?)`
    );

    analysis.tasks.forEach(title => {
      stmt.run(
        context_type,
        resolvedContextId,
        String(title).trim(),
        analysis.extracted_text || '',
        userId,
        function(err) {
          if (!err) created.push({ id: this.lastID, title: String(title).trim() });
        }
      );
    });

    stmt.finalize(() => {
      res.json({
        success: true,
        source: {
          type: 'image',
          file: `/uploads/${req.file.filename}`,
          extracted_text: analysis.extracted_text || ''
        },
        created_count: created.length,
        tasks: created
      });
    });
  } catch (e) {
    console.error('Shared tasks from-image error:', e);
    res.status(500).json({ error: 'Error creating tasks from image' });
  }
});

// Create single task directly
router.post('/tasks', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const {
    context_type = 'user',
    context_id,
    title,
    description = '',
    priority = 'medium',
    due_date = null,
    assignees = [],
    subtasks = [],
    tags = [],
    progress = 0
  } = req.body || {};

  if (!title) return res.status(400).json({ error: 'Title is required' });

  const resolvedContextId = context_id || userId;

  try {
    const access = await validateContextAccess(db, userId, context_type, resolvedContextId);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    db.run(
      `INSERT INTO shared_tasks (context_type, context_id, title, description, priority, status, due_date, assignees, progress, subtasks, tags, created_by)
       VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
      [
        context_type,
        resolvedContextId,
        title,
        description,
        priority,
        due_date,
        JSON.stringify(Array.isArray(assignees) ? assignees : []),
        progress,
        JSON.stringify(Array.isArray(subtasks) ? subtasks : []),
        JSON.stringify(Array.isArray(tags) ? tags : []),
        userId
      ],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error creating task' });
        res.json({
          success: true,
          task: {
            id: this.lastID,
            context_type,
            context_id: resolvedContextId,
            title,
            description,
            priority,
            status: 'todo',
            due_date,
            assignees,
            subtasks,
            tags,
            progress,
            created_by: userId
          }
        });
      }
    );
  } catch (e) {
    console.error('Shared task create error:', e);
    res.status(500).json({ error: 'Error creating task' });
  }
});

// Update task
router.patch('/tasks/:taskId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { taskId } = req.params;
  const { title, description, priority, status, due_date, assignees, progress, subtasks, tags } = req.body || {};

  try {
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_tasks WHERE id = ?', [taskId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const access = await validateContextAccess(db, userId, existing.context_type, existing.context_id);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    const next = {
      title: typeof title === 'string' ? title : existing.title,
      description: typeof description === 'string' ? description : existing.description,
      priority: typeof priority === 'string' ? priority : existing.priority,
      status: typeof status === 'string' ? status : existing.status,
      due_date: typeof due_date === 'undefined' ? existing.due_date : due_date,
      assignees: typeof assignees === 'undefined' ? existing.assignees : JSON.stringify(Array.isArray(assignees) ? assignees : []),
      progress: typeof progress === 'number' ? progress : existing.progress,
      subtasks: typeof subtasks !== 'undefined' ? (typeof subtasks === 'string' ? subtasks : JSON.stringify(subtasks)) : existing.subtasks,
      tags: typeof tags !== 'undefined' ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : existing.tags
    };

    db.run(
      `UPDATE shared_tasks
       SET title = ?, description = ?, priority = ?, status = ?, due_date = ?, assignees = ?, progress = ?, subtasks = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [next.title, next.description, next.priority, next.status, next.due_date, next.assignees, next.progress, next.subtasks, next.tags, taskId],
      (uErr) => {
        if (uErr) return res.status(500).json({ error: 'Error updating task' });
        res.json({ success: true });
      }
    );
  } catch (e) {
    console.error('Shared task update error:', e);
    res.status(500).json({ error: 'Error updating task' });
  }
});

// Delete task
router.delete('/tasks/:taskId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { taskId } = req.params;

  try {
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_tasks WHERE id = ?', [taskId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const access = await validateContextAccess(db, userId, existing.context_type, existing.context_id);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    db.run('DELETE FROM shared_tasks WHERE id = ?', [taskId], (err) => {
      if (err) return res.status(500).json({ error: 'Error deleting task' });
      res.json({ success: true, message: 'Task deleted' });
    });
  } catch (e) {
    console.error('Shared task delete error:', e);
    res.status(500).json({ error: 'Error deleting task' });
  }
});

// ===================== SHARED NOTES =====================

// List notes
router.get('/notes', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { context_type = 'user', context_id } = req.query;
  const resolvedContextId = context_id || userId;

  try {
    const access = await validateContextAccess(db, userId, context_type, resolvedContextId);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    db.all(
      `SELECT n.*,
              cu.username as created_by_username,
              uu.username as updated_by_username
       FROM shared_notes n
       JOIN users cu ON n.created_by = cu.id
       LEFT JOIN users uu ON n.updated_by = uu.id
       WHERE n.context_type = ? AND n.context_id = ?
       ORDER BY n.is_pinned DESC, n.updated_at DESC`,
      [context_type, resolvedContextId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error fetching notes' });
        res.json({ success: true, notes: rows || [] });
      }
    );
  } catch (e) {
    console.error('Shared notes list error:', e);
    res.status(500).json({ error: 'Error fetching notes' });
  }
});

// Create note
router.post('/notes', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { context_type = 'user', context_id, title, content_md = '', color = '#ffffff' } = req.body || {};
  const resolvedContextId = context_id || userId;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    const access = await validateContextAccess(db, userId, context_type, resolvedContextId);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    db.run(
      `INSERT INTO shared_notes (context_type, context_id, title, content_md, color, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+5 hours', '+30 minutes'), datetime('now', '+5 hours', '+30 minutes'))`,
      [context_type, resolvedContextId, title, content_md, color, userId, userId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error creating note' });
        res.json({
          success: true,
          note: {
            id: this.lastID,
            context_type,
            context_id: Number(resolvedContextId),
            title,
            content_md,
            color
          }
        });
      }
    );
  } catch (e) {
    console.error('Shared note create error:', e);
    res.status(500).json({ error: 'Error creating note' });
  }
});

// Get single note
router.get('/notes/:noteId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId } = req.params;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get(
        `SELECT n.*, cu.username as created_by_username, uu.username as updated_by_username
         FROM shared_notes n
         JOIN users cu ON n.created_by = cu.id
         LEFT JOIN users uu ON n.updated_by = uu.id
         WHERE n.id = ?`,
        [noteId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, note.context_type, note.context_id);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    res.json({ success: true, note });
  } catch (e) {
    console.error('Shared note get error:', e);
    res.status(500).json({ error: 'Error fetching note' });
  }
});

// Update note
router.put('/notes/:noteId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId } = req.params;
  const { title, content_md } = req.body || {};

  try {
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!existing) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, existing.context_type, existing.context_id);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    if (existing.is_locked) {
      return res.status(403).json({ error: 'This note is locked and cannot be edited' });
    }

    // Save version before update
    db.run(
      `INSERT INTO shared_note_versions (note_id, content_md, created_by)
       VALUES (?, ?, ?)`,
      [noteId, existing.content_md || '', userId]
    );

    const nextTitle = typeof title === 'string' ? title : existing.title;
    const nextContent = typeof content_md === 'string' ? content_md : existing.content_md;

    db.run(
      `UPDATE shared_notes
       SET title = ?, content_md = ?, updated_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes')
       WHERE id = ?`,
      [nextTitle, nextContent, userId, noteId],
      (uErr) => {
        if (uErr) return res.status(500).json({ error: 'Error updating note' });
        res.json({ success: true });
      }
    );
  } catch (e) {
    console.error('Shared note update error:', e);
    res.status(500).json({ error: 'Error updating note' });
  }
});

// Pin/Unpin note
router.put('/notes/:noteId/pin', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId } = req.params;
  const { is_pinned } = req.body;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, note.context_type, note.context_id);
    if (!access.allowed) return res.status(403).json({ error: 'Permission denied' });

    db.run('UPDATE shared_notes SET is_pinned = ? WHERE id = ?', [is_pinned ? 1 : 0, noteId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update note' });
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Lock/Unlock note
router.put('/notes/:noteId/lock', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId } = req.params;
  const { is_locked } = req.body;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, note.context_type, note.context_id);
    if (!access.allowed) return res.status(403).json({ error: 'Permission denied' });

    db.run('UPDATE shared_notes SET is_locked = ? WHERE id = ?', [is_locked ? 1 : 0, noteId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update note' });
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Archive/Unarchive note
router.put('/notes/:noteId/archive', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId } = req.params;
  const { is_archived } = req.body;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, note.context_type, note.context_id);
    if (!access.allowed) return res.status(403).json({ error: 'Permission denied' });

    db.run('UPDATE shared_notes SET is_archived = ? WHERE id = ?', [is_archived ? 1 : 0, noteId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update note' });
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Duplicate note
router.post('/notes/:noteId/duplicate', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId } = req.params;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, note.context_type, note.context_id);
    if (!access.allowed) return res.status(403).json({ error: 'Permission denied' });

    db.run(
      `INSERT INTO shared_notes (context_type, context_id, title, content_md, color, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+5 hours', '+30 minutes'), datetime('now', '+5 hours', '+30 minutes'))`,
      [note.context_type, note.context_id, note.title + ' (Copy)', note.content_md, note.color || '#ffffff', userId, userId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Failed to duplicate note' });
        res.json({ success: true, noteId: this.lastID });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete note
router.delete('/notes/:noteId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId } = req.params;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, note.context_type, note.context_id);
    if (!access.allowed) return res.status(403).json({ error: 'Permission denied' });

    db.run('DELETE FROM shared_note_versions WHERE note_id = ?', [noteId]);
    db.run('DELETE FROM shared_notes WHERE id = ?', [noteId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to delete note' });
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Note version history
router.get('/notes/:noteId/versions', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId } = req.params;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, note.context_type, note.context_id);
    if (!access.allowed) return res.status(403).json({ error: 'Permission denied' });

    db.all(
      `SELECT v.id, v.note_id, v.created_at, u.username as created_by_username
       FROM shared_note_versions v
       JOIN users u ON v.created_by = u.id
       WHERE v.note_id = ?
       ORDER BY v.created_at DESC`,
      [noteId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error fetching versions' });
        res.json({ success: true, versions: rows || [] });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error fetching versions' });
  }
});

// Restore note version
router.post('/notes/:noteId/restore/:versionId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId, versionId } = req.params;

  try {
    const note = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shared_notes WHERE id = ?', [noteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!note) return res.status(404).json({ error: 'Note not found' });

    const access = await validateContextAccess(db, userId, note.context_type, note.context_id);
    if (!access.allowed) return res.status(403).json({ error: 'Permission denied' });

    const version = await new Promise((resolve, reject) => {
      db.get(
        'SELECT content_md FROM shared_note_versions WHERE id = ? AND note_id = ?',
        [versionId, noteId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!version) return res.status(404).json({ error: 'Version not found' });

    db.run(
      `UPDATE shared_notes SET content_md = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [version.content_md || '', userId, noteId],
      (uErr) => {
        if (uErr) return res.status(500).json({ error: 'Error restoring version' });
        res.json({ success: true });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error restoring version' });
  }
});

// Upload image for notes (shared endpoint)
router.post('/notes/upload-image', authMiddleware, upload.single('images'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    const imageUrl = `/uploads/${req.file.path.replace(/\\/g, '/').split('uploads/')[1]}`;
    res.json({ success: true, url: imageUrl, imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Upload file for notes (shared endpoint)
router.post('/notes/upload-file', authMiddleware, upload.single('files'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.path.replace(/\\/g, '/').split('uploads/')[1]}`;
    res.json({ success: true, url: fileUrl, fileUrl, filename: req.file.originalname });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// ===================== STATS =====================

router.get('/stats', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { context_type = 'user', context_id } = req.query;
  const resolvedContextId = context_id || userId;

  try {
    const access = await validateContextAccess(db, userId, context_type, resolvedContextId);
    if (!access.allowed) return res.status(403).json({ error: access.error });

    const stats = await new Promise((resolve, reject) => {
      db.get(
        `SELECT 
           COUNT(*) as total_tasks,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed_tasks,
           SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) as pending_tasks,
           SUM(CASE WHEN status != 'done' AND due_date < datetime('now') THEN 1 ELSE 0 END) as overdue_tasks
         FROM shared_tasks
         WHERE context_type = ? AND context_id = ?`,
        [context_type, resolvedContextId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    const noteStats = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total_notes
         FROM shared_notes
         WHERE context_type = ? AND context_id = ? AND is_archived = 0`,
        [context_type, resolvedContextId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    res.json({
      success: true,
      stats: {
        ...stats,
        total_notes: noteStats?.total_notes || 0
      }
    });
  } catch (e) {
    console.error('Shared stats error:', e);
    res.status(500).json({ error: 'Error fetching stats' });
  }
});

// ===================== DATA MIGRATION ENDPOINT =====================
// One-time migration to copy existing community_group_tasks / community_group_notes / todos into shared tables
router.post('/migrate', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  try {
    let tasksMigrated = 0;
    let notesMigrated = 0;
    let todosMigrated = 0;

    // Migrate community_group_tasks -> shared_tasks (context_type='group')
    await new Promise((resolve, reject) => {
      db.all('SELECT * FROM community_group_tasks', [], (err, rows) => {
        if (err || !rows || rows.length === 0) return resolve();
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO shared_tasks (context_type, context_id, title, description, priority, status, due_date, assignees, progress, subtasks, source_type, source_ref, created_by, created_at, updated_at)
           VALUES ('group', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        rows.forEach(r => {
          stmt.run(r.group_id, r.title, r.description, r.priority, r.status, r.due_date, r.assignees, r.progress, r.subtasks, r.source_type, r.source_ref, r.created_by, r.created_at, r.updated_at, function(err) {
            if (!err) tasksMigrated++;
          });
        });
        stmt.finalize(() => resolve());
      });
    });

    // Migrate community_group_notes -> shared_notes (context_type='group')
    await new Promise((resolve, reject) => {
      db.all('SELECT * FROM community_group_notes', [], (err, rows) => {
        if (err || !rows || rows.length === 0) return resolve();
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO shared_notes (context_type, context_id, title, content_md, is_pinned, is_locked, is_archived, created_by, updated_by, created_at, updated_at)
           VALUES ('group', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        rows.forEach(r => {
          stmt.run(r.group_id, r.title, r.content_md, r.is_pinned || 0, r.is_locked || 0, r.is_archived || 0, r.created_by, r.updated_by, r.created_at, r.updated_at, function(err) {
            if (!err) notesMigrated++;
          });
        });
        stmt.finalize(() => resolve());
      });
    });

    // Migrate todos -> shared_tasks (context_type='user')
    await new Promise((resolve, reject) => {
      db.all('SELECT * FROM todos', [], (err, rows) => {
        if (err || !rows || rows.length === 0) return resolve();
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO shared_tasks (context_type, context_id, title, description, priority, status, due_date, tags, source_type, created_by, created_at, updated_at)
           VALUES ('user', ?, ?, '', ?, ?, ?, ?, 'migrated', ?, ?, ?)`
        );
        rows.forEach(r => {
          const status = r.completed ? 'done' : 'todo';
          stmt.run(r.user_id, r.title, r.priority, status, r.due_date, r.tags, r.user_id, r.created_at, r.updated_at, function(err) {
            if (!err) todosMigrated++;
          });
        });
        stmt.finalize(() => resolve());
      });
    });

    res.json({
      success: true,
      migrated: {
        tasks: tasksMigrated,
        notes: notesMigrated,
        todos: todosMigrated
      }
    });
  } catch (e) {
    console.error('Migration error:', e);
    res.status(500).json({ error: 'Migration failed' });
  }
});

// ===================== AI NOTES ASSISTANT =====================

/**
 * POST /shared/notes/ai
 * AI assistant for note writing
 * Body: { action, text, customPrompt?, language? }
 * Actions: summarize, expand, rewrite, grammar, formal, casual, translate,
 *          outline, continue, explain, bullet_points, key_takeaways, title_suggest, action_items
 */
router.post('/notes/ai', authMiddleware, async (req, res) => {
  const { action, text, customPrompt, language } = req.body;

  if (!action && !customPrompt) {
    return res.status(400).json({ error: 'Action or customPrompt required' });
  }

  let aiProvider;
  try {
    aiProvider = require('../services/ai-provider');
  } catch (e) {
    return res.status(500).json({ error: 'AI service not available' });
  }

  const systemPrompt = `You are a helpful AI writing assistant integrated into a note-taking app. 
Your job is to help users write, edit, and improve their notes. 
Always respond with just the resulting text - no explanations, no markdown code fences, no preamble.
Keep the same formatting style as the input when possible.
When asked to continue or expand, provide thorough, detailed, and comprehensive content - aim for 3-5 substantial paragraphs with facts, examples, and explanations.
Never give short 1-2 sentence responses. Be generous with detail and information.`;

  const actionPrompts = {
    summarize: `Summarize the following text concisely, keeping the key points:\n\n${text}`,
    expand: `Expand extensively on the following text. Provide thorough, detailed, and comprehensive information with multiple paragraphs. Include facts, examples, key details, statistics, and explanations. Write at least 4-5 detailed paragraphs covering all important aspects of this topic:\n\n${text}`,
    rewrite: `Rewrite the following text to be clearer and better structured while keeping the same meaning:\n\n${text}`,
    grammar: `Fix all grammar, spelling, and punctuation errors in the following text. Keep the original meaning and style. Only output the corrected text:\n\n${text}`,
    formal: `Rewrite the following text in a formal, professional tone:\n\n${text}`,
    casual: `Rewrite the following text in a casual, friendly tone:\n\n${text}`,
    translate: `Translate the following text to ${language || 'English'}. Only output the translation:\n\n${text}`,
    outline: `Create a structured outline with headings and subpoints for the following topic or text:\n\n${text}`,
    continue: `Continue writing the following text naturally. Write comprehensive, detailed content with 3-5 more paragraphs covering all important aspects of the topic. Include facts, examples, explanations, and key details. Be thorough and informative:\n\n${text}`,
    explain: `Explain the following text in simpler terms that anyone can understand:\n\n${text}`,
    bullet_points: `Convert the following text into clear, organized bullet points:\n\n${text}`,
    key_takeaways: `Extract the key takeaways from the following text as a numbered list:\n\n${text}`,
    title_suggest: `Suggest 5 good titles for a note containing the following text. Output them as a numbered list:\n\n${text}`,
    action_items: `Extract all action items and to-dos from the following text as a checklist:\n\n${text}`,
    brainstorm: `Brainstorm 10 related ideas based on the following text or topic:\n\n${text}`,
    pros_cons: `Create a pros and cons list for the following topic or text:\n\n${text}`,
    eli5: `Explain the following like I'm 5 years old:\n\n${text}`,
    poem: `Transform the following text into a creative poem:\n\n${text}`,
    email_draft: `Draft a professional email based on the following notes:\n\n${text}`,
    meeting_notes: `Format the following as structured meeting notes with sections for attendees, discussion, decisions, and action items:\n\n${text}`,
    study_notes: `Convert the following into organized study notes with key concepts, definitions, and memory aids:\n\n${text}`
  };

  const prompt = customPrompt
    ? `${customPrompt}\n\nText:\n${text || ''}`
    : actionPrompts[action];

  if (!prompt) {
    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  try {
    const aiResponse = await aiProvider.chat('innovate-ai', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]);

    res.json({
      success: true,
      result: aiResponse.content,
      action,
      tokens: aiResponse.tokens
    });
  } catch (error) {
    console.error('AI notes error:', error.message);
    res.status(500).json({ error: error.message || 'AI processing failed' });
  }
});

module.exports = router;
