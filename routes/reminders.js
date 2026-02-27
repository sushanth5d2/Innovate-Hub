/**
 * Reminders Routes - Unified reminder system
 * Aggregates: custom reminders, gentle (post) reminders, birthdays, events, community todos
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');

// ==================== GET ALL REMINDERS (aggregated) ====================

/**
 * GET /api/reminders
 * Returns all reminder types merged and sorted by date
 * Query params: ?month=2&year=2026 (optional, for calendar view)
 */
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { month, year } = req.query;

  const allReminders = [];
  let completedQueries = 0;
  const totalQueries = 5;

  const finish = () => {
    completedQueries++;
    if (completedQueries === totalQueries) {
      // Sort all by date
      allReminders.sort((a, b) => new Date(a.reminder_date) - new Date(b.reminder_date));
      res.json({ success: true, reminders: allReminders });
    }
  };

  // 1. Custom user reminders
  db.all(
    `SELECT id, title, description, reminder_date, reminder_time, type, source_type, source_id,
            is_recurring, recurrence_pattern, is_notified, is_dismissed, color, priority, created_at
     FROM user_reminders
     WHERE user_id = ? AND is_dismissed = 0
     ORDER BY reminder_date ASC`,
    [userId],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          allReminders.push({
            id: r.id,
            title: r.title,
            description: r.description,
            reminder_date: r.reminder_date,
            reminder_time: r.reminder_time,
            type: r.type,
            source: 'custom',
            source_type: r.source_type,
            source_id: r.source_id,
            is_recurring: r.is_recurring,
            recurrence_pattern: r.recurrence_pattern,
            is_notified: r.is_notified,
            color: r.color,
            priority: r.priority || 'low',
            created_at: r.created_at
          });
        });
      }
      finish();
    }
  );

  // 2. Gentle reminders (from post 3-dot menu)
  db.all(
    `SELECT gr.id, gr.reminder_date, gr.message, gr.is_sent, gr.created_at,
            p.content as post_content, p.id as post_id, p.images as post_images
     FROM gentle_reminders gr
     JOIN posts p ON gr.post_id = p.id
     WHERE gr.user_id = ?
     ORDER BY gr.reminder_date ASC`,
    [userId],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          // Extract time from reminder_date if it contains T (datetime format)
          let reminderTime = null;
          let reminderDateOnly = r.reminder_date;
          if (r.reminder_date && r.reminder_date.includes('T')) {
            const parts = r.reminder_date.split('T');
            reminderDateOnly = parts[0];
            reminderTime = parts[1] ? parts[1].substring(0, 5) : null;
          }
          const postSnippet = r.post_content ? r.post_content.substring(0, 100) : '';
          allReminders.push({
            id: r.id,
            title: r.message || 'Remind me',
            description: postSnippet || 'Post reminder',
            reminder_date: reminderDateOnly,
            reminder_time: reminderTime,
            type: 'post_reminder',
            source: 'gentle_reminder',
            source_type: 'post',
            source_id: r.post_id,
            post_images: r.post_images,
            is_notified: r.is_sent,
            color: '#ff6b6b',
            created_at: r.created_at
          });
        });
      }
      finish();
    }
  );

  // 3. Birthdays of followed users
  db.all(
    `SELECT u.id as user_id, u.username, u.profile_picture, u.date_of_birth
     FROM followers f
     JOIN users u ON f.following_id = u.id
     WHERE f.follower_id = ? AND u.date_of_birth IS NOT NULL AND u.date_of_birth != ''`,
    [userId],
    (err, rows) => {
      if (!err && rows) {
        const currentYear = new Date().getFullYear();
        rows.forEach(r => {
          if (!r.date_of_birth) return;
          // Parse the date_of_birth and create this year's birthday
          const dob = new Date(r.date_of_birth);
          if (isNaN(dob.getTime())) return;
          const birthdayThisYear = new Date(currentYear, dob.getMonth(), dob.getDate());
          // If birthday already passed this year, show next year's
          const now = new Date();
          if (birthdayThisYear < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
            birthdayThisYear.setFullYear(currentYear + 1);
          }
          allReminders.push({
            id: `bday-${r.user_id}`,
            title: `🎂 ${r.username}'s Birthday`,
            description: `${r.username}'s birthday is on ${dob.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
            reminder_date: birthdayThisYear.toISOString().split('T')[0],
            reminder_time: '00:00',
            type: 'birthday',
            source: 'birthday',
            source_type: 'user',
            source_id: r.user_id,
            profile_picture: r.profile_picture,
            username: r.username,
            is_notified: false,
            color: '#e91e63',
            created_at: null
          });
        });
      }
      finish();
    }
  );

  // 4. Events the user joined (attendee)
  db.all(
    `SELECT e.id, e.title, e.description, e.event_date, e.location, e.cover_image, e.category,
            u.username as organizer
     FROM event_attendees ea
     JOIN events e ON ea.event_id = e.id
     JOIN users u ON e.creator_id = u.id
     WHERE ea.user_id = ? AND ea.status = 'confirmed'
     ORDER BY e.event_date ASC`,
    [userId],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          allReminders.push({
            id: `event-${r.id}`,
            title: `📅 ${r.title}`,
            description: r.description ? r.description.substring(0, 100) : `Event by ${r.organizer}`,
            reminder_date: r.event_date,
            reminder_time: null,
            type: 'event',
            source: 'event',
            source_type: 'event',
            source_id: r.id,
            location: r.location,
            cover_image: r.cover_image,
            category: r.category,
            is_notified: false,
            color: '#4caf50',
            created_at: null
          });
        });
      }
      finish();
    }
  );

  // 5. Shared tasks with due dates (personal + group)
  const totalQueries5 = 2;
  let completed5 = 0;
  const finish5 = () => {
    completed5++;
    if (completed5 === totalQueries5) finish();
  };

  // 5a. Personal shared tasks (with AND without due dates)
  db.all(
    `SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, t.assignees,
            t.context_type, t.context_id
     FROM shared_tasks t
     WHERE t.context_type = 'user' AND t.context_id = ? AND t.status != 'done'
     ORDER BY CASE WHEN t.due_date IS NOT NULL THEN 0 ELSE 1 END, t.due_date ASC`,
    [userId],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          allReminders.push({
            id: `todo-user-${r.id}`,
            title: `📋 ${r.title}`,
            description: r.description || 'Personal task',
            reminder_date: r.due_date || null,
            reminder_time: null,
            type: 'todo',
            source: 'personal_todo',
            source_type: 'user_task',
            source_id: r.id,
            group_name: null,
            group_id: null,
            priority: r.priority,
            task_status: r.status,
            assignees: r.assignees,
            has_due_date: !!r.due_date,
            is_notified: false,
            color: r.priority === 'high' ? '#f44336' : r.priority === 'medium' ? '#ff9800' : '#2196f3',
            created_at: null
          });
        });
      }
      finish5();
    }
  );

  // 5b. Group shared tasks with due dates + legacy community_group_tasks
  db.all(
    `SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, t.assignees,
            t.context_type, t.context_id,
            cg.name as group_name
     FROM shared_tasks t
     LEFT JOIN community_groups cg ON t.context_type = 'group' AND t.context_id = cg.id
     WHERE t.context_type = 'group' AND t.due_date IS NOT NULL AND t.status != 'done'
       AND t.context_id IN (SELECT group_id FROM community_group_members WHERE user_id = ?)
     UNION ALL
     SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, NULL as assignees,
            'group' as context_type, t.group_id as context_id,
            cg.name as group_name
     FROM community_group_tasks t
     JOIN community_groups cg ON t.group_id = cg.id
     JOIN community_group_members m ON cg.id = m.group_id AND m.user_id = ?
     WHERE t.due_date IS NOT NULL AND t.status != 'done'
       AND t.id NOT IN (SELECT id FROM shared_tasks WHERE context_type = 'group')
     ORDER BY due_date ASC`,
    [userId, userId],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          allReminders.push({
            id: `todo-grp-${r.id}`,
            title: `📋 ${r.title}`,
            description: r.description || `From group: ${r.group_name || 'Unknown'}`,
            reminder_date: r.due_date,
            reminder_time: null,
            type: 'todo',
            source: 'community_todo',
            source_type: 'group_task',
            source_id: r.id,
            group_name: r.group_name,
            group_id: r.context_id,
            priority: r.priority,
            task_status: r.status,
            assignees: r.assignees,
            is_notified: false,
            color: r.priority === 'high' ? '#f44336' : r.priority === 'medium' ? '#ff9800' : '#2196f3',
            created_at: null
          });
        });
      }
      finish5();
    }
  );
});

// ==================== GET CALENDAR DATA ====================

/**
 * GET /api/reminders/calendar
 * Returns dates that have reminders (for calendar dot indicators)
 * Query: ?month=2&year=2026
 */
router.get('/calendar', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const dateMap = {};
  let completedQueries = 0;
  const totalQueries = 4;

  const addDate = (date, type, color) => {
    const d = date ? date.split('T')[0].split(' ')[0] : null;
    if (!d) return;
    if (!dateMap[d]) dateMap[d] = [];
    if (!dateMap[d].find(e => e.type === type)) {
      dateMap[d].push({ type, color });
    }
  };

  const finish = () => {
    completedQueries++;
    if (completedQueries === totalQueries) {
      res.json({ success: true, dates: dateMap });
    }
  };

  // Custom reminders
  db.all(
    `SELECT reminder_date, type, color FROM user_reminders
     WHERE user_id = ? AND is_dismissed = 0 AND reminder_date >= ? AND reminder_date < ?`,
    [userId, startDate, endDate],
    (err, rows) => {
      if (!err && rows) rows.forEach(r => addDate(r.reminder_date, r.type, r.color));
      finish();
    }
  );

  // Gentle reminders
  db.all(
    `SELECT reminder_date FROM gentle_reminders
     WHERE user_id = ? AND reminder_date >= ? AND reminder_date < ?`,
    [userId, startDate, endDate],
    (err, rows) => {
      if (!err && rows) rows.forEach(r => addDate(r.reminder_date, 'post_reminder', '#ff6b6b'));
      finish();
    }
  );

  // Events
  db.all(
    `SELECT e.event_date FROM event_attendees ea
     JOIN events e ON ea.event_id = e.id
     WHERE ea.user_id = ? AND ea.status = 'confirmed' AND e.event_date >= ? AND e.event_date < ?`,
    [userId, startDate, endDate],
    (err, rows) => {
      if (!err && rows) rows.forEach(r => addDate(r.event_date, 'event', '#4caf50'));
      finish();
    }
  );

  // Shared tasks (personal + group) with due dates
  const totalCal5 = 2;
  let completedCal5 = 0;
  const finishCal5 = () => { completedCal5++; if (completedCal5 === totalCal5) finish(); };

  db.all(
    `SELECT due_date FROM shared_tasks
     WHERE context_type = 'user' AND context_id = ? AND due_date IS NOT NULL AND status != 'done'
       AND due_date >= ? AND due_date < ?`,
    [userId, startDate, endDate],
    (err, rows) => {
      if (!err && rows) rows.forEach(r => addDate(r.due_date, 'todo', '#ff9800'));
      finishCal5();
    }
  );
  db.all(
    `SELECT t.due_date FROM shared_tasks t
     WHERE t.context_type = 'group' AND t.due_date IS NOT NULL AND t.status != 'done'
       AND t.due_date >= ? AND t.due_date < ?
       AND t.context_id IN (SELECT group_id FROM community_group_members WHERE user_id = ?)
     UNION ALL
     SELECT t.due_date FROM community_group_tasks t
     JOIN community_group_members m ON t.group_id = m.group_id AND m.user_id = ?
     WHERE t.due_date IS NOT NULL AND t.status != 'done' AND t.due_date >= ? AND t.due_date < ?
       AND t.id NOT IN (SELECT id FROM shared_tasks WHERE context_type = 'group')`,
    [startDate, endDate, userId, userId, startDate, endDate],
    (err, rows) => {
      if (!err && rows) rows.forEach(r => addDate(r.due_date, 'todo', '#ff9800'));
      finishCal5();
    }
  );
});

// ==================== CREATE CUSTOM REMINDER ====================

/**
 * POST /api/reminders
 * Create a new custom reminder
 */
router.post('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { title, description, reminder_date, reminder_time, type, source_type, source_id,
          is_recurring, recurrence_pattern, color, priority } = req.body;

  if (!title || !reminder_date) {
    return res.status(400).json({ error: 'Title and reminder_date are required' });
  }

  db.run(
    `INSERT INTO user_reminders (user_id, title, description, reminder_date, reminder_time, type,
      source_type, source_id, is_recurring, recurrence_pattern, color, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, title, description || '', reminder_date, reminder_time || '09:00',
     type || 'custom', source_type || null, source_id || null,
     is_recurring ? 1 : 0, recurrence_pattern || null, color || '#0095f6', priority || 'low'],
    function(err) {
      if (err) {
        console.error('Error creating reminder:', err);
        return res.status(500).json({ error: 'Error creating reminder' });
      }
      res.json({
        success: true,
        reminder: {
          id: this.lastID,
          title,
          description,
          reminder_date,
          reminder_time: reminder_time || '09:00',
          type: type || 'custom',
          color: color || '#0095f6',
          priority: priority || 'low'
        }
      });
    }
  );
});

// ==================== UPDATE REMINDER ====================

/**
 * PUT /api/reminders/:id
 * Update an existing custom reminder
 */
router.put('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { id } = req.params;
  const { title, description, reminder_date, reminder_time, color, is_recurring, recurrence_pattern, priority } = req.body;

  db.run(
    `UPDATE user_reminders
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         reminder_date = COALESCE(?, reminder_date),
         reminder_time = COALESCE(?, reminder_time),
         color = COALESCE(?, color),
         is_recurring = COALESCE(?, is_recurring),
         recurrence_pattern = COALESCE(?, recurrence_pattern),
         priority = COALESCE(?, priority),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [title, description, reminder_date, reminder_time, color, is_recurring === undefined ? null : (is_recurring ? 1 : 0), recurrence_pattern, priority || null, id, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating reminder' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Reminder not found' });
      }
      res.json({ success: true });
    }
  );
});

// ==================== DELETE REMINDER ====================

/**
 * DELETE /api/reminders/:id
 * Delete a custom reminder
 */
router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { id } = req.params;

  db.run(
    'DELETE FROM user_reminders WHERE id = ? AND user_id = ?',
    [id, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting reminder' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Reminder not found' });
      }
      res.json({ success: true });
    }
  );
});

// ==================== DISMISS REMINDER ====================

/**
 * PUT /api/reminders/:id/dismiss
 */
router.put('/:id/dismiss', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { id } = req.params;

  db.run(
    'UPDATE user_reminders SET is_dismissed = 1 WHERE id = ? AND user_id = ?',
    [id, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error dismissing reminder' });
      }
      res.json({ success: true });
    }
  );
});

// ==================== CHECK DUE REMINDERS ====================

/**
 * GET /api/reminders/due
 * Returns reminders due now or overdue (for notification polling)
 */
router.get('/due', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const now = new Date().toISOString();

  db.all(
    `SELECT * FROM user_reminders
     WHERE user_id = ? AND is_dismissed = 0 AND is_notified = 0
     AND datetime(reminder_date || ' ' || COALESCE(reminder_time, '09:00')) <= datetime(?)
     ORDER BY reminder_date ASC`,
    [userId, now],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Error checking due reminders' });
      }
      res.json({ success: true, reminders: rows || [] });
    }
  );
});

// ==================== MARK REMINDER AS NOTIFIED ====================

/**
 * PUT /api/reminders/:id/notified
 */
router.put('/:id/notified', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { id } = req.params;

  db.run(
    'UPDATE user_reminders SET is_notified = 1 WHERE id = ? AND user_id = ?',
    [id, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating reminder' });
      }
      res.json({ success: true });
    }
  );
});

// ==================== AI PREVIEW (smart parse + conflict check) ====================

/**
 * POST /api/reminders/ai-preview
 * Smart parse: detect completeness, conflicts, priority, delete intent.
 * Returns action: 'create_ready' (auto-create), 'needs_info', 'conflict', 'delete'
 */
router.post('/ai-preview', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  try {
    let aiProvider;
    try { aiProvider = require('../services/ai-provider'); } catch (e) {}

    const now = new Date();
    let parsed = null;

    if (aiProvider) {
      try {
        let modelId = 'innovate-ai';
        try {
          const models = aiProvider.getAllModels();
          // Prefer free flash models first (pro models have 0 free tier quota)
          const freeFlash = models.find(m => m.available && m.free && /flash/i.test(m.id));
          const anyFree = models.find(m => m.available && m.free);
          const anyAvailable = models.find(m => m.available);
          if (freeFlash) modelId = freeFlash.id;
          else if (anyFree) modelId = anyFree.id;
          else if (anyAvailable) modelId = anyAvailable.id;
        } catch (e) {}

        const systemMsg = {
          role: 'system',
          content: `You are a smart reminder assistant. Analyze user's voice input and return ONLY valid JSON.

IMPORTANT RULES:
1. If the user clearly states WHAT + WHEN (date/time), it's COMPLETE. Set "complete": true
2. If missing date OR title, set "complete": false and "missing_fields": ["date"] or ["title"] etc.
3. If user says "delete", "remove", "cancel" a reminder, set "intent": "delete" with "search_query" being the EXACT item names the user mentioned (keep "and" between multiple items, e.g. "outing and meeting with friends"). If user mentions priority for deletion (e.g. "delete any low priority meeting"), include "priority_filter": "low" (or "medium"/"high")
4. If the user says to delete AND create in one sentence (e.g. "delete outing and create lunch"), split them: set "intent": "delete" with search_query for the delete part
4. If user mentions priority (high/medium/low/urgent/important), extract it. Default: "low"
5. Generate a natural, friendly spoken_message (as if a human assistant is talking)

Return JSON format:
{
  "intent": "create" or "delete",
  "complete": true/false,
  "title": "short title",
  "description": "details or empty string",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "priority": "low" or "medium" or "high",
  "color": "#hex",
  "missing_fields": [],
  "spoken_message": "natural human-like response",
  "search_query": "for delete intent only",
  "priority_filter": "low/medium/high or empty — only for delete when user specifies priority"
}

Today is ${now.toISOString().split('T')[0]} (${now.toLocaleDateString('en-US',{weekday:'long'})}).
"tomorrow" = ${new Date(now.getTime() + 86400000).toISOString().split('T')[0]}
"next week" = +7 days. "tonight" = today at 20:00. "this evening" = today at 18:00.
"morning" = 09:00, "afternoon" = 14:00, "evening" = 18:00, "night" = 21:00.
Default time if not mentioned: 09:00. Default color: #0095f6.
For urgent/high priority use color #f44336, medium #ff9800, low #0095f6.

spoken_message examples for COMPLETE reminders:
- "Got it! Setting a reminder to call mom tomorrow at 5 PM."
- "Done! I've noted your dinner reservation for Friday at 7 PM."

spoken_message examples for INCOMPLETE:
- "I'd love to help! When would you like me to remind you about the meeting?"
- "Sure, I'll remind you about groceries. What date and time works for you?"

spoken_message for DELETE:
- "I'll look for that reminder to delete it for you."`
        };

        const response = await aiProvider.chat(modelId, [
          systemMsg,
          { role: 'user', content: prompt }
        ]);

        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch (aiErr) {
        console.error('AI preview error:', aiErr.message);
      }
    }

    // Fallback basic parsing if AI fails
    if (!parsed) {
      const lower = prompt.toLowerCase();
      // Detect delete intent
      if (/\b(delete|remove|cancel|get rid of|erase|clear|trash)\b/.test(lower)) {
        const searchQuery = lower.replace(/\b(delete|remove|cancel|get rid of|erase|clear|trash|the|my|reminder|reminders|for|about|please|all|every|everything)\b/g, '').trim();
        return res.json({
          success: true,
          action: 'delete',
          search_query: searchQuery,
          spoken_message: "I'll look for that reminder to delete it."
        });
      }

      const title = prompt.replace(/\b(tomorrow|today|next week|next month|at \d{1,2}(:\d{2})?\s*(am|pm)?|after \d+\s*(hours?|minutes?|days?)|high priority|medium priority|low priority|urgent|important)\b/gi, '').replace(/remind me to\s*/i, '').trim().substring(0, 60) || prompt.substring(0, 60);
      let reminderDate = now.toISOString().split('T')[0];
      let reminderTime = '09:00';
      let priority = 'low';

      if (lower.includes('tomorrow')) {
        const tm = new Date(now); tm.setDate(tm.getDate() + 1);
        reminderDate = tm.toISOString().split('T')[0];
      } else if (lower.includes('next week')) {
        const nw = new Date(now); nw.setDate(nw.getDate() + 7);
        reminderDate = nw.toISOString().split('T')[0];
      }

      const timeMatch = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (timeMatch) {
        let h = parseInt(timeMatch[1]); const m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        if (timeMatch[3] === 'pm' && h < 12) h += 12;
        if (timeMatch[3] === 'am' && h === 12) h = 0;
        reminderTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      }

      if (/\b(high|urgent|critical)\b/i.test(lower)) priority = 'high';
      else if (/\b(medium|moderate|mid)\b/i.test(lower)) priority = 'medium';

      const hasDate = /\b(tomorrow|today|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i.test(lower);
      const hasTime = /\b(at \d|morning|afternoon|evening|tonight|night|\d{1,2}\s*(am|pm))\b/i.test(lower);
      const complete = title.length > 2 && hasDate;

      parsed = {
        intent: 'create',
        complete,
        title,
        description: prompt,
        date: reminderDate,
        time: reminderTime,
        priority,
        color: priority === 'high' ? '#f44336' : priority === 'medium' ? '#ff9800' : '#0095f6',
        missing_fields: (!title || title.length <= 2) ? ['title'] : (!hasDate ? ['date'] : []),
        spoken_message: complete
          ? `Got it! Setting a reminder for ${title} on ${reminderDate} at ${reminderTime}.`
          : `Sure, I'll remind you about ${title}. ${!hasDate ? 'When would you like to be reminded?' : 'What time works for you?'}`
      };
    }

    // Handle delete intent
    if (parsed.intent === 'delete') {
      const searchQuery = parsed.search_query || parsed.title || '';
      const lower = (prompt || '').toLowerCase();

      // Check if user wants to delete ALL reminders (e.g., "delete all reminders", "remove everything")
      const isDeleteAll = /\b(delete all|remove all|clear all|delete every|remove every|delete all reminders|remove all reminders|delete everything|remove everything|clear everything)\b/i.test(lower);

      // SMART: Parse multi-item references from ORIGINAL user prompt (not just AI's search_query)
      // This catches "delete outing and a meeting with friends" correctly
      const cleanedPrompt = lower
        .replace(/\b(please|can you|could you|i want to|i'd like to|i want you to|go ahead and)\b/gi, '')
        .replace(/\b(delete|remove|erase|clear|trash|get rid of|cancel)\b/gi, '')
        .replace(/\b(the|my|a|an|those|these|that|this|some|old|new)\b/gi, '')
        .replace(/\b(reminder|reminders|one|ones|item|items|thing|things)\b/gi, '')
        .replace(/\b(for me|for|about|named|called)\b/gi, '')
        .replace(/\b(low|medium|high|urgent)\s*priority\b/gi, '')
        .replace(/\b(any|every|first|last|random)\b/gi, '')
        .trim();
      const promptParts = cleanedPrompt.split(/\s*(?:,|\band\b|&|\+)\s*/).map(s => s.trim()).filter(s => s.length > 0);
      // Also keep AI's search_query split
      const aiParts = searchQuery.split(/\s*(?:,|\band\b|&|\+)\s*/).map(s => s.trim()).filter(s => s.length > 0);
      // Use whichever has more items (better split)
      const multiItems = promptParts.length >= aiParts.length ? promptParts : aiParts;

      // Priority filter: if user said "delete low priority meeting", filter results by priority
      let priorityFilter = (parsed.priority_filter || '').toLowerCase().trim();
      // Also detect priority from the original prompt if AI didn't extract it
      if (!priorityFilter) {
        const prioMatch = lower.match(/\b(low|medium|high)\s*priority\b/i);
        if (prioMatch) priorityFilter = prioMatch[1].toLowerCase();
      }

      // Helper: apply priority filter to matches array
      const applyPriorityFilter = (matches) => {
        if (!priorityFilter || !matches || matches.length === 0) return matches;
        const filtered = matches.filter(m => (m.priority || 'low').toLowerCase() === priorityFilter);
        return filtered.length > 0 ? filtered : matches; // fallback to all if no priority match
      };

      return new Promise((resolve) => {
        if (isDeleteAll) {
          // Delete ALL: return all undismissed reminders
          db.all(
            `SELECT id, title, reminder_date, reminder_time, priority FROM user_reminders
             WHERE user_id = ? AND is_dismissed = 0
             ORDER BY reminder_date DESC LIMIT 50`,
            [userId],
            (err, rows) => {
              if (!err && rows && rows.length > 0) {
                res.json({
                  success: true,
                  action: 'delete',
                  matches: rows,
                  spoken_message: `I found ${rows.length} reminders. Deleting all of them now.`
                });
              } else {
                res.json({
                  success: true,
                  action: 'delete_not_found',
                  spoken_message: "You don't have any reminders to delete."
                });
              }
              resolve();
            }
          );
        } else if (multiItems.length > 1) {
          // Multiple search terms — find matches for each
          db.all(
            `SELECT id, title, reminder_date, reminder_time, priority FROM user_reminders
             WHERE user_id = ? AND is_dismissed = 0
             ORDER BY reminder_date DESC`,
            [userId],
            (err, rows) => {
              if (!err && rows && rows.length > 0) {
                const allMatches = [];
                const matchedIds = new Set();

                // Helper: try to match a term against all rows
                const tryMatchTerm = (term) => {
                  const termLower = term.toLowerCase();
                  let found = false;
                  rows.forEach(r => {
                    if (!matchedIds.has(r.id) && r.title.toLowerCase().includes(termLower)) {
                      allMatches.push(r);
                      matchedIds.add(r.id);
                      found = true;
                    }
                  });
                  return found;
                };

                multiItems.forEach(term => {
                  // Try full term first (e.g. "team meeting")
                  if (tryMatchTerm(term)) return;
                  // If multi-word term didn't match, split by spaces and try each word
                  // e.g. "outing meeting" -> try "outing" then "meeting" separately
                  const subTerms = term.split(/\s+/).filter(s => s.length > 0);
                  if (subTerms.length > 1) {
                    subTerms.forEach(sub => tryMatchTerm(sub));
                  }
                });
                if (allMatches.length > 0) {
                  const filtered = applyPriorityFilter(allMatches);
                  res.json({
                    success: true,
                    action: 'delete',
                    matches: filtered,
                    priority_filter: priorityFilter || undefined,
                    spoken_message: filtered.length === 1
                      ? `I found "${filtered[0].title}"${priorityFilter ? ' (' + priorityFilter + ' priority)' : ''}. Deleting it now.`
                      : `I found ${filtered.length} matching reminders${priorityFilter ? ' with ' + priorityFilter + ' priority' : ''}. Deleting them now.`
                  });
                } else {
                  // Fallback: try as single search
                  const fallback = rows.filter(r => r.title.toLowerCase().includes(searchQuery.toLowerCase()));
                  if (fallback.length > 0) {
                    res.json({ success: true, action: 'delete', matches: fallback,
                      spoken_message: fallback.length === 1 ? `I found "${fallback[0].title}".` : `I found ${fallback.length} matching reminders.` });
                  } else {
                    res.json({ success: true, action: 'delete_not_found', spoken_message: "I couldn't find matching reminders. Could you be more specific?" });
                  }
                }
              } else {
                res.json({ success: true, action: 'delete_not_found', spoken_message: "I couldn't find a matching reminder. Could you be more specific?" });
              }
              resolve();
            }
          );
        } else {
          // Single search term — try exact match first, then split by spaces
          db.all(
            `SELECT id, title, reminder_date, reminder_time, priority FROM user_reminders
             WHERE user_id = ? AND is_dismissed = 0
             ORDER BY reminder_date DESC`,
            [userId],
            (err, rows) => {
              if (!err && rows && rows.length > 0) {
                // Try full-phrase LIKE match first
                const sqLower = searchQuery.toLowerCase();
                let matches = rows.filter(r => r.title.toLowerCase().includes(sqLower));

                // If no full-phrase match and query has multiple words, try each word
                if (matches.length === 0 && searchQuery.includes(' ')) {
                  const words = searchQuery.split(/\s+/).filter(w => w.length > 1);
                  const matchedIds = new Set();
                  words.forEach(word => {
                    const wLower = word.toLowerCase();
                    rows.forEach(r => {
                      if (!matchedIds.has(r.id) && r.title.toLowerCase().includes(wLower)) {
                        matches.push(r);
                        matchedIds.add(r.id);
                      }
                    });
                  });
                }

                if (matches.length > 0) {
                  // Limit to 10, then apply priority filter
                  matches = matches.slice(0, 10);
                  matches = applyPriorityFilter(matches);
                  res.json({
                    success: true,
                    action: 'delete',
                    matches: matches,
                    priority_filter: priorityFilter || undefined,
                    spoken_message: matches.length === 1
                      ? `Deleting "${matches[0].title}"${priorityFilter ? ' (' + priorityFilter + ' priority)' : ''} now.`
                      : `Found ${matches.length} matching reminders${priorityFilter ? ' with ' + priorityFilter + ' priority' : ''}.`
                  });
                } else {
                  res.json({
                    success: true,
                    action: 'delete_not_found',
                    spoken_message: "I couldn't find a matching reminder. Could you be more specific?"
                  });
                }
              } else {
                res.json({
                  success: true,
                  action: 'delete_not_found',
                  spoken_message: "I couldn't find a matching reminder. Could you be more specific?"
                });
              }
              resolve();
            }
          );
        }
      });
    }

    // Handle create intent — check for conflicts
    const reminderDate = parsed.date;
    const reminderTime = parsed.time || '09:00';

    return new Promise((resolve) => {
      // Check for conflicting reminders on same date/time
      db.all(
        `SELECT id, title, reminder_time, priority FROM user_reminders
         WHERE user_id = ? AND is_dismissed = 0 AND DATE(reminder_date) = ?
         ORDER BY reminder_time ASC`,
        [userId, reminderDate],
        (err, existing) => {
          let conflicts = [];
          let conflictMessage = '';

          if (!err && existing && existing.length > 0) {
            // Check for time conflicts (within 1 hour window)
            const newTimeMinutes = parseInt(reminderTime.split(':')[0]) * 60 + parseInt(reminderTime.split(':')[1] || 0);
            conflicts = existing.filter(e => {
              if (!e.reminder_time) return false;
              const existingMinutes = parseInt(e.reminder_time.split(':')[0]) * 60 + parseInt(e.reminder_time.split(':')[1] || 0);
              return Math.abs(newTimeMinutes - existingMinutes) < 60;
            });

            if (conflicts.length > 0) {
              const conflictTitles = conflicts.map(c => `"${c.title}" at ${c.reminder_time}`).join(', ');
              conflictMessage = ` Heads up, you already have ${conflictTitles} around the same time.`;
            } else if (existing.length > 0) {
              conflictMessage = ` By the way, you have ${existing.length} other reminder${existing.length > 1 ? 's' : ''} on this day.`;
            }
          }

          const preview = {
            title: parsed.title,
            description: parsed.description || '',
            reminder_date: reminderDate,
            reminder_time: reminderTime,
            color: parsed.color || '#0095f6',
            priority: parsed.priority || 'low'
          };

          if (parsed.complete) {
            // Complete — auto-create, just inform
            res.json({
              success: true,
              action: 'create_ready',
              preview,
              conflicts: conflicts.length > 0 ? conflicts : null,
              all_day_reminders: existing || [],
              spoken_message: (parsed.spoken_message || `Creating reminder for ${parsed.title}.`) + conflictMessage
            });
          } else {
            // Incomplete — ask for missing info
            res.json({
              success: true,
              action: 'needs_info',
              preview,
              missing_fields: parsed.missing_fields || [],
              spoken_message: parsed.spoken_message || "I need a bit more information. What date and time?"
            });
          }
          resolve();
        }
      );
    });

  } catch (error) {
    console.error('AI preview error:', error);
    res.status(500).json({ error: 'Error parsing reminder' });
  }
});

// ==================== AI CREATE REMINDER ====================

/**
 * POST /api/reminders/ai-create
 * AI-assisted reminder creation - parse natural language into a reminder
 */
router.post('/ai-create', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    // Try to use the AI provider
    let aiProvider;
    try {
      aiProvider = require('../services/ai-provider');
    } catch (e) {
      // AI not available, do basic parsing
    }

    let title, description, reminderDate, reminderTime, color, priority;
    const now = new Date();

    if (aiProvider) {
      try {
        // Find a working model dynamically
        let modelId = 'innovate-ai';
        try {
          const models = aiProvider.getAllModels();
          const freeFlash = models.find(m => m.available && m.free && /flash/i.test(m.id));
          const anyFree = models.find(m => m.available && m.free);
          const anyAvailable = models.find(m => m.available);
          if (freeFlash) modelId = freeFlash.id;
          else if (anyFree) modelId = anyFree.id;
          else if (anyAvailable) modelId = anyAvailable.id;
        } catch (e) { /* use default */ }

        const systemMsg = {
          role: 'system',
          content: `You are a reminder parser. Extract reminder info from user text. Return ONLY valid JSON:
{"title":"short title","description":"details","date":"YYYY-MM-DD","time":"HH:MM","color":"#hex","priority":"low or medium or high"}
Today is ${now.toISOString().split('T')[0]}. Day of week: ${now.toLocaleDateString('en-US',{weekday:'long'})}. If user says "tomorrow", calculate the date. "next week" = +7 days. "after X" means X hours from now. Default time: 09:00. Default color: #0095f6.
For birthdays use color #e91e63, for work #ff9800, for personal #2196f3, for events #4caf50.
For priority: "urgent"/"important"/"critical" = high, "kind of"/"maybe" = medium, default = low.`
        };

        const response = await aiProvider.chat(modelId, [
          systemMsg,
          { role: 'user', content: prompt }
        ]);

        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          title = parsed.title;
          description = parsed.description;
          reminderDate = parsed.date;
          reminderTime = parsed.time || '09:00';
          color = parsed.color || '#0095f6';
          priority = parsed.priority || 'low';
        }
      } catch (aiErr) {
        console.error('AI parse/chat error, falling back to basic parsing:', aiErr.message);
        // Fall through to basic parsing below
      }
    }

    // Fallback basic parsing if AI fails
    if (!title) {
      const lower = prompt.toLowerCase();
      // Clean up the title - remove time/date words
      title = prompt.replace(/\b(tomorrow|today|next week|next month|at \d{1,2}(:\d{2})?\s*(am|pm)?|after \d+\s*(hours?|minutes?|days?))\b/gi, '').replace(/remind me to\s*/i, '').trim().substring(0, 60) || prompt.substring(0, 60);
      description = prompt;

      // Date parsing
      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(now); nextWeek.setDate(nextWeek.getDate() + 7);
      if (lower.includes('tomorrow')) {
        reminderDate = tomorrow.toISOString().split('T')[0];
      } else if (lower.includes('next week')) {
        reminderDate = nextWeek.toISOString().split('T')[0];
      } else if (lower.includes('next month')) {
        const nm = new Date(now); nm.setMonth(nm.getMonth() + 1);
        reminderDate = nm.toISOString().split('T')[0];
      } else {
        // Check for "after X hours/days"
        const afterMatch = lower.match(/after\s+(\d+)\s*(hours?|days?|minutes?)/);
        if (afterMatch) {
          const amt = parseInt(afterMatch[1]);
          const unit = afterMatch[2];
          const future = new Date(now);
          if (unit.startsWith('hour')) future.setHours(future.getHours() + amt);
          else if (unit.startsWith('day')) future.setDate(future.getDate() + amt);
          else if (unit.startsWith('minute')) future.setMinutes(future.getMinutes() + amt);
          reminderDate = future.toISOString().split('T')[0];
          reminderTime = `${String(future.getHours()).padStart(2,'0')}:${String(future.getMinutes()).padStart(2,'0')}`;
        } else {
          reminderDate = now.toISOString().split('T')[0];
        }
      }

      // Time parsing
      if (!reminderTime) {
        const timeMatch = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
          let h = parseInt(timeMatch[1]);
          const m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          const ampm = timeMatch[3];
          if (ampm === 'pm' && h < 12) h += 12;
          if (ampm === 'am' && h === 12) h = 0;
          reminderTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        } else {
          reminderTime = '09:00';
        }
      }
      color = '#0095f6';
    }

    // Create the reminder
    db.run(
      `INSERT INTO user_reminders (user_id, title, description, reminder_date, reminder_time, type, color, priority)
       VALUES (?, ?, ?, ?, ?, 'custom', ?, ?)`,
      [userId, title, description || '', reminderDate, reminderTime, color, priority || 'low'],
      function(err) {
        if (err) {
          console.error('Error creating AI reminder:', err);
          return res.status(500).json({ error: 'Error creating reminder' });
        }
        res.json({
          success: true,
          reminder: {
            id: this.lastID, title, description,
            reminder_date: reminderDate,
            reminder_time: reminderTime,
            color
          }
        });
      }
    );
  } catch (error) {
    console.error('AI reminder creation error:', error);
    res.status(500).json({ error: 'Error creating reminder via AI' });
  }
});

// ==================== GET REMINDERS FOR DATE ====================

/**
 * GET /api/reminders/date/:date
 * Returns all reminders for a specific date
 */
router.get('/date/:date', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { date } = req.params; // YYYY-MM-DD

  const allReminders = [];
  let completedQueries = 0;
  const totalQueries = 4;

  const finish = () => {
    completedQueries++;
    if (completedQueries === totalQueries) {
      allReminders.sort((a, b) => (a.reminder_time || '00:00').localeCompare(b.reminder_time || '00:00'));
      res.json({ success: true, reminders: allReminders });
    }
  };

  // Custom reminders for this date
  db.all(
    `SELECT * FROM user_reminders
     WHERE user_id = ? AND is_dismissed = 0 AND DATE(reminder_date) = ?`,
    [userId, date],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          allReminders.push({
            id: r.id, title: r.title, description: r.description,
            reminder_date: r.reminder_date, reminder_time: r.reminder_time,
            type: r.type, source: 'custom', color: r.color, is_notified: r.is_notified
          });
        });
      }
      finish();
    }
  );

  // Gentle reminders for this date
  db.all(
    `SELECT gr.*, p.content as post_content, p.id as post_id
     FROM gentle_reminders gr
     JOIN posts p ON gr.post_id = p.id
     WHERE gr.user_id = ? AND DATE(gr.reminder_date) = ?`,
    [userId, date],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          allReminders.push({
            id: r.id, title: r.message || 'Post Reminder',
            description: r.post_content ? r.post_content.substring(0, 100) : '',
            reminder_date: r.reminder_date, type: 'post_reminder',
            source: 'gentle_reminder', source_id: r.post_id,
            color: '#ff6b6b', is_notified: r.is_sent
          });
        });
      }
      finish();
    }
  );

  // Events on this date
  db.all(
    `SELECT e.id, e.title, e.description, e.event_date, e.location
     FROM event_attendees ea
     JOIN events e ON ea.event_id = e.id
     WHERE ea.user_id = ? AND ea.status = 'confirmed' AND DATE(e.event_date) = ?`,
    [userId, date],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          allReminders.push({
            id: `event-${r.id}`, title: `📅 ${r.title}`,
            description: r.description || '', reminder_date: r.event_date,
            type: 'event', source: 'event', source_id: r.id,
            location: r.location, color: '#4caf50'
          });
        });
      }
      finish();
    }
  );

  // Community todos due this date
  db.all(
    `SELECT t.id, t.title, t.description, t.due_date, t.priority,
            cg.name as group_name
     FROM community_group_tasks t
     JOIN community_groups cg ON t.group_id = cg.id
     JOIN community_group_members m ON cg.id = m.group_id AND m.user_id = ?
     WHERE t.status != 'done' AND DATE(t.due_date) = ?`,
    [userId, date],
    (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          allReminders.push({
            id: `todo-${r.id}`, title: `📋 ${r.title}`,
            description: r.description || `From: ${r.group_name}`,
            reminder_date: r.due_date, type: 'todo',
            source: 'community_todo', group_name: r.group_name,
            priority: r.priority,
            color: r.priority === 'high' ? '#f44336' : '#ff9800'
          });
        });
      }
      finish();
    }
  );
});

module.exports = router;
