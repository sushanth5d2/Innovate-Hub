const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');
const upload = require('../middleware/upload');
const { encrypt: encryptMsg, decrypt: decryptMsg, decryptRows } = require('../services/message-encryption');
const disappearing = require('../services/disappearing-messages');

router.use(authMiddleware);

// Ensure schema columns exist (run once at module load, not per-request)
let schemaReady = false;
let schemaPromise = null;
function ensureSchema() {
  if (schemaReady) return Promise.resolve();
  if (schemaPromise) return schemaPromise;
  schemaPromise = new Promise((resolve) => {
    try {
      const db = getDb();
      const isPostgres = process.env.DB_TYPE === 'postgresql';
      let pending = 0;
      const done = () => { if (--pending <= 0) { schemaReady = true; resolve(); } };

      if (isPostgres) {
        pending = 9;
        db.run(`ALTER TABLE group_conversations ADD COLUMN IF NOT EXISTS profile_picture TEXT DEFAULT ''`, () => done());
        db.run(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE`, () => done());
        db.run(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP`, () => done());
        db.run(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS pinned_by INTEGER`, () => done());
        db.run(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER`, () => done());
        // Table for "delete for me" tracking (per-user message hiding)
        db.run(`CREATE TABLE IF NOT EXISTS deleted_group_messages (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          message_id INTEGER NOT NULL,
          deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, message_id)
        )`, () => done());
        // Drop FK constraint on starred_messages so group message IDs can be starred too
        db.run(`ALTER TABLE starred_messages DROP CONSTRAINT IF EXISTS starred_messages_message_id_fkey`, () => done());
        // Add message_type column to starred_messages to distinguish DM vs group
        db.run(`ALTER TABLE starred_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'dm'`, () => done());
        // Group disappearing messages settings
        db.run(`CREATE TABLE IF NOT EXISTS group_disappearing_settings (
          id SERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL UNIQUE,
          set_by INTEGER NOT NULL,
          mode TEXT DEFAULT 'off',
          duration INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, () => done());
      } else {
        // SQLite: check columns first via PRAGMA
        pending = 2;
        db.all(`PRAGMA table_info(group_conversations)`, (err, columns) => {
          if (err || !columns) { done(); return; }
          const hasProfilePicture = columns.some(c => c.name === 'profile_picture');
          if (!hasProfilePicture) {
            db.run(`ALTER TABLE group_conversations ADD COLUMN profile_picture TEXT DEFAULT ''`, () => done());
          } else { done(); }
        });
        db.all(`PRAGMA table_info(group_messages)`, (err, columns) => {
          if (err || !columns) { done(); return; }
          let alterPending = 0;
          const cols = (columns || []).map(c => c.name);
          if (!cols.includes('is_pinned')) alterPending++;
          if (!cols.includes('pinned_at')) alterPending++;
          if (!cols.includes('pinned_by')) alterPending++;
          if (!cols.includes('reply_to_id')) alterPending++;
          if (alterPending === 0) { done(); return; }
          const alterDone = () => { if (--alterPending <= 0) done(); };
          if (!cols.includes('is_pinned')) db.run(`ALTER TABLE group_messages ADD COLUMN is_pinned BOOLEAN DEFAULT 0`, () => alterDone());
          if (!cols.includes('pinned_at')) db.run(`ALTER TABLE group_messages ADD COLUMN pinned_at DATETIME`, () => alterDone());
          if (!cols.includes('pinned_by')) db.run(`ALTER TABLE group_messages ADD COLUMN pinned_by INTEGER`, () => alterDone());
          if (!cols.includes('reply_to_id')) db.run(`ALTER TABLE group_messages ADD COLUMN reply_to_id INTEGER`, () => alterDone());
        });
      }
    } catch (e) { schemaReady = true; resolve(); }
  });
  return schemaPromise;
}

// Create a group (supports multipart with profile_picture or JSON body)
router.post('/', upload.single('profile_picture'), async (req, res) => {
  const db = getDb();
  await ensureSchema();
  const creatorId = req.user.userId || req.user.id;
  
  let name, member_ids, usernames;
  if (req.is('multipart/form-data')) {
    name = req.body.name;
    member_ids = [];
    try { usernames = JSON.parse(req.body.usernames || '[]'); } catch(e) { usernames = []; }
  } else {
    ({ name, member_ids = [], usernames = [] } = req.body || {});
  }

  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  {
    const profilePic = req.file ? req.file.path.replace(/\\/g, '/').replace(/^\.?\/?/, '/') : '';
    
    db.run(
      `INSERT INTO group_conversations (creator_id, name, profile_picture) VALUES (?, ?, ?)`,
      [creatorId, name, profilePic],
      function(err) {
        if (err) return res.status(500).json({ error: 'Failed to create group' });
        const groupId = this.lastID;

        // Resolve usernames to user IDs if provided
        const resolveUsernames = () => new Promise((resolve) => {
          if (!usernames || usernames.length === 0) return resolve([]);
          const placeholders = usernames.map(() => '?').join(',');
          db.all(`SELECT id FROM users WHERE username IN (${placeholders})`, usernames, (e, rows) => {
            if (e) return resolve([]);
            resolve(rows.map(r => r.id));
          });
        });

        resolveUsernames().then((resolvedIds) => {
          const allMembers = Array.from(new Set([creatorId, ...member_ids, ...resolvedIds]));
          const stmt = db.prepare(`INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)`);
          allMembers.forEach(uid => {
            const role = uid === creatorId ? 'admin' : 'member';
            stmt.run(groupId, uid, role);
          });
          stmt.finalize((finalErr) => {
            if (finalErr) return res.status(500).json({ error: 'Failed to add members' });
            res.json({ success: true, group: { id: groupId, name, profile_picture: profilePic } });
          });
        });
      }
    );
  }
});

// List groups for current user with previews and unread counts
router.get('/', async (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  await ensureSchema();
  db.all(
    `SELECT g.id, g.name, g.created_at, g.profile_picture,
            (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
            (SELECT content FROM group_messages gm2 WHERE gm2.group_id = g.id AND NOT EXISTS (SELECT 1 FROM deleted_group_messages dgm WHERE dgm.message_id = gm2.id AND dgm.user_id = ?) ORDER BY gm2.created_at DESC LIMIT 1) as last_message,
            (SELECT type FROM group_messages gm2 WHERE gm2.group_id = g.id AND NOT EXISTS (SELECT 1 FROM deleted_group_messages dgm WHERE dgm.message_id = gm2.id AND dgm.user_id = ?) ORDER BY gm2.created_at DESC LIMIT 1) as last_message_type,
            (SELECT created_at FROM group_messages gm2 WHERE gm2.group_id = g.id AND NOT EXISTS (SELECT 1 FROM deleted_group_messages dgm WHERE dgm.message_id = gm2.id AND dgm.user_id = ?) ORDER BY gm2.created_at DESC LIMIT 1) as last_message_time,
            (SELECT COUNT(*) FROM group_messages gm2 WHERE gm2.group_id = g.id AND gm2.is_read = 0 AND gm2.sender_id != ? AND NOT EXISTS (SELECT 1 FROM deleted_group_messages dgm WHERE dgm.message_id = gm2.id AND dgm.user_id = ?)) as unread_count
     FROM group_conversations g
     INNER JOIN group_members m ON (m.group_id = g.id AND m.user_id = ?)
     ORDER BY COALESCE((SELECT created_at FROM group_messages gm2 WHERE gm2.group_id = g.id AND NOT EXISTS (SELECT 1 FROM deleted_group_messages dgm WHERE dgm.message_id = gm2.id AND dgm.user_id = ?) ORDER BY gm2.created_at DESC LIMIT 1), g.created_at) DESC`,
    [userId, userId, userId, userId, userId, userId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch groups' });
      const groups = (rows || []).map(g => ({ ...g, last_message: decryptMsg(g.last_message) }));
      res.json({ success: true, groups });
    }
  );
});

// Make/revoke admin for a group member
router.put('/:groupId/members/:userId/role', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const targetUserId = parseInt(req.params.userId, 10);
  const requesterId = req.user.userId || req.user.id;
  const { role } = req.body || {};
  
  if (!role || !['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be admin or member' });
  }
  
  // Check if requester is admin
  db.get(
    `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, requesterId],
    (err, requester) => {
      if (err || !requester || requester.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can change member roles' });
      }
      
      db.run(
        `UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?`,
        [role, groupId, targetUserId],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Failed to update role' });
          res.json({ success: true });
        }
      );
    }
  );
});

// Get group messages (membership check)
router.get('/:groupId/messages', async (req, res) => {
  await ensureSchema();
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);

  // Verify user is a member of this group
  db.get(
    `SELECT id FROM group_members WHERE group_id = ? AND user_id = ?
     UNION SELECT id FROM community_group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId, groupId, userId],
    (err, member) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!member) return res.status(403).json({ error: 'Not a member of this group' });

  db.all(
    `SELECT gm.id, gm.group_id, gm.sender_id, u.username as sender_username, u.profile_picture as sender_profile_picture,
            gm.content, gm.type, gm.attachments, gm.timer, gm.expires_at, gm.is_read, gm.is_pinned, gm.created_at,
            gm.reply_to_id, r.content as reply_content, ru.username as reply_username,
            (SELECT COUNT(*) FROM starred_messages WHERE message_id = gm.id AND user_id = ? AND message_type = 'group') as user_has_starred
     FROM group_messages gm
     INNER JOIN users u ON (u.id = gm.sender_id)
     LEFT JOIN group_messages r ON (r.id = gm.reply_to_id)
     LEFT JOIN users ru ON (ru.id = r.sender_id)
     LEFT JOIN deleted_group_messages dgm ON (dgm.message_id = gm.id AND dgm.user_id = ?)
     WHERE gm.group_id = ? AND dgm.id IS NULL
       AND (gm.expires_at IS NULL OR gm.expires_at > CURRENT_TIMESTAMP)
     ORDER BY gm.created_at ASC`,
    [userId, userId, groupId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch messages' });

      // Clean up expired group messages
      db.run(
        `DELETE FROM group_messages WHERE group_id = ? AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
        [groupId]
      );

      // Count unread messages BEFORE marking as read
      const unreadCount = (rows || []).filter(m => m.sender_id != userId && !m.is_read).length;
      const firstUnread = (rows || []).find(m => m.sender_id != userId && !m.is_read);
      const firstUnreadId = firstUnread ? firstUnread.id : null;

      // Mark messages as read
      db.run(
        `UPDATE group_messages SET is_read = 1 WHERE group_id = ? AND sender_id != ? AND is_read = 0`,
        [groupId, userId]
      );

      const decrypted = decryptRows(rows || []);
      decrypted.forEach(r => { if (r.reply_content) r.reply_content = decryptMsg(r.reply_content); });
      res.json({ success: true, messages: decrypted, unread_count: unreadCount, first_unread_id: firstUnreadId });
    }
  );
    });
});

// Send a group message (text or simple content)
router.post('/:groupId/messages', (req, res) => {
  const db = getDb();
  const senderId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  const { content = '', type = 'text', timer = null, reply_to_id = null } = req.body || {};

  if (!content) return res.status(400).json({ error: 'Content is required' });

  // Check if user is a member of this group (check both regular and community groups)
  db.get(
    `SELECT id FROM group_members WHERE group_id = ? AND user_id = ?
     UNION
     SELECT id FROM community_group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, senderId, groupId, senderId],
    (err, member) => {
      if (err) {
        console.error('Error checking group membership:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!member) {
        // User is not a member of this group
        return res.status(403).json({ error: 'You are not a member of this group' });
      }
      
      // User is a member, proceed with message
      // Compute expires_at in JS to avoid PG parameter type inference issues
      let expiresAt = null;
      if (timer !== null && timer !== undefined && !isNaN(parseInt(timer))) {
        expiresAt = new Date(Date.now() + parseInt(timer) * 1000).toISOString();
      }

      // Auto-apply group disappearing settings if no per-message timer
      const proceedWithInsert = () => {
      db.run(
        `INSERT INTO group_messages (group_id, sender_id, content, type, timer, expires_at, reply_to_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [groupId, senderId, encryptMsg(content), type, timer, expiresAt, reply_to_id ? parseInt(reply_to_id) : null],
        function(err) {
          if (err) {
            console.error('Error inserting group message:', err);
            console.error('groupId:', groupId, 'senderId:', senderId, 'type:', type);
            return res.status(500).json({ error: 'Failed to send message', details: err.message });
          }
      
      const messageId = this.lastID;
      
      // Fetch the complete message with sender info
      db.get(
        `SELECT gm.id, gm.group_id, gm.sender_id, u.username as sender_username, u.profile_picture as sender_profile_picture,
                gm.content, gm.type, gm.attachments, gm.timer, gm.expires_at, gm.is_read, gm.created_at,
                gm.reply_to_id, r.content as reply_content, ru.username as reply_username
         FROM group_messages gm
         INNER JOIN users u ON (u.id = gm.sender_id)
         LEFT JOIN group_messages r ON (r.id = gm.reply_to_id)
         LEFT JOIN users ru ON (ru.id = r.sender_id)
         WHERE gm.id = ?`,
        [messageId],
        (err2, message) => {
          if (err2) {
            console.error('Error fetching sent message:', err2);
            return res.status(500).json({ error: 'Message sent but failed to retrieve' });
          }
          if (message) {
            message.content = decryptMsg(message.content);
            if (message.reply_content) message.reply_content = decryptMsg(message.reply_content);
          }

          // Emit to all group members via their personal user rooms
          const io = req.app.get('io');
          if (io && message) {
            db.all(
              `SELECT user_id FROM group_members WHERE group_id = ?`,
              [groupId],
              (err3, members) => {
                if (!err3 && members) {
                  members.forEach(m => {
                    if (m.user_id !== senderId) {
                      io.to(`user_${m.user_id}`).emit('group:message:receive', message);
                    }
                  });
                }
              }
            );
          }

          res.json({ success: true, message: message });
        }
      );
    }
  );
      }; // end proceedWithInsert

      // Look up group disappearing settings and auto-apply timer
      if (!expiresAt) {
        disappearing.getGroupSetting(groupId, (dsErr, dsSetting) => {
          const expiry = disappearing.computeTimerExpiry(dsSetting);
          if (expiry) expiresAt = expiry;
          proceedWithInsert();
        });
      } else {
        proceedWithInsert();
      }
    }
  );
});

// Send a file/image message in a group
router.post('/:groupId/messages/file', upload.single('file'), (req, res) => {
  const db = getDb();
  const senderId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const file = req.file;
  const originalFilename = file.originalname;
  const filePath = file.mimetype.startsWith('image/')
    ? `/uploads/images/${file.filename}`
    : `/uploads/files/${file.filename}`;
  const fileType = file.mimetype.startsWith('image/') ? 'image'
    : file.mimetype.startsWith('video/') ? 'video' : 'file';

  // Check membership
  db.get(
    `SELECT id FROM group_members WHERE group_id = ? AND user_id = ?
     UNION
     SELECT id FROM community_group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, senderId, groupId, senderId],
    (err, member) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!member) return res.status(403).json({ error: 'You are not a member of this group' });

      // Auto-apply group disappearing settings
      const doInsert = (expiresAt) => {
      db.run(
        `INSERT INTO group_messages (group_id, sender_id, content, type, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [groupId, senderId, filePath, fileType, expiresAt],
        function(err) {
          if (err) return res.status(500).json({ error: 'Failed to send file' });
          const messageId = this.lastID;
          db.get(
            `SELECT gm.id, gm.group_id, gm.sender_id, u.username as sender_username, u.profile_picture as sender_profile_picture,
                    gm.content, gm.type, gm.is_read, gm.created_at
             FROM group_messages gm
             INNER JOIN users u ON (u.id = gm.sender_id)
             WHERE gm.id = ?`,
            [messageId],
            (err2, message) => {
              if (err2) return res.status(500).json({ error: 'File sent but failed to retrieve' });
              message.original_filename = originalFilename;

              // Emit to all group members via their personal user rooms
              const io = req.app.get('io');
              if (io && message) {
                db.all(
                  `SELECT user_id FROM group_members WHERE group_id = ?`,
                  [groupId],
                  (err3, members) => {
                    if (!err3 && members) {
                      members.forEach(m => {
                        if (m.user_id !== senderId) {
                          io.to(`user_${m.user_id}`).emit('group:message:receive', message);
                        }
                      });
                    }
                  }
                );
              }

              res.json({ success: true, message });
            }
          );
        }
      );
      }; // end doInsert

      // Look up disappearing settings for this group
      disappearing.getGroupSetting(groupId, (dsErr, dsSetting) => {
        const expiresAt = disappearing.computeTimerExpiry(dsSetting);
        doInsert(expiresAt);
      });
    }
  );
});

// Mark messages as read for current user (simple global is_read flag)
router.post('/:groupId/read', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  db.run(
    `UPDATE group_messages SET is_read = 1 WHERE group_id = ? AND sender_id != ?`,
    [groupId, userId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to mark messages read' });
      res.json({ success: true });
    }
  );
});

// Add a member
router.post('/:groupId/members', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const { user_id, username } = req.body || {};

  const addMember = (uid) => {
    db.run(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`,
      [groupId, uid],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to add member' });
        res.json({ success: true });
      }
    );
  };

  if (user_id) return addMember(user_id);
  if (username) {
    db.get(`SELECT id FROM users WHERE username = ?`, [username], (e, row) => {
      if (e || !row) return res.status(404).json({ error: 'User not found' });
      addMember(row.id);
    });
    return;
  }
  res.status(400).json({ error: 'user_id or username required' });
});

// Remove a member
router.delete('/:groupId/members/:userId', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const userId = parseInt(req.params.userId, 10);
  db.run(
    `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to remove member' });
      res.json({ success: true });
    }
  );
});

// Pin/Unpin a group message
router.post('/:groupId/messages/:messageId/pin', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  const messageId = parseInt(req.params.messageId, 10);

  // Check if user is a member of the group
  db.get(
    `SELECT id FROM group_members WHERE group_id = ? AND user_id = ?
     UNION
     SELECT id FROM community_group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId, groupId, userId],
    (err, member) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!member) {
        return res.status(403).json({ error: 'You are not a member of this group' });
      }

      // Check if message exists in this group
      db.get(
        `SELECT * FROM group_messages WHERE id = ? AND group_id = ?`,
        [messageId, groupId],
        (err, message) => {
          if (err) {
            return res.status(500).json({ error: 'Error checking message' });
          }
          if (!message) {
            return res.status(404).json({ error: 'Message not found' });
          }

          // Toggle pin status (use CURRENT_TIMESTAMP for PostgreSQL compatibility, boolean-safe checks)
          const isPinned = message.is_pinned === true || message.is_pinned === 1;
          const updateQuery = isPinned
            ? `UPDATE group_messages SET is_pinned = FALSE, pinned_at = NULL, pinned_by = NULL WHERE id = ?`
            : `UPDATE group_messages SET is_pinned = TRUE, pinned_at = CURRENT_TIMESTAMP, pinned_by = ? WHERE id = ?`;
          const updateParams = isPinned ? [messageId] : [userId, messageId];

          db.run(updateQuery, updateParams, function(err) {
            if (err) {
              console.error('Pin toggle error:', err);
              return res.status(500).json({ error: 'Error updating pin status' });
            }
            res.json({ success: true, pinned: !isPinned });
          });
        }
      );
    }
  );
});

// Delete group message for self (hide from current user only, any member can do this)
router.delete('/:groupId/messages/:messageId', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  const messageId = parseInt(req.params.messageId, 10);

  db.get(
    `SELECT id FROM group_members WHERE group_id = ? AND user_id = ?
     UNION SELECT id FROM community_group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId, groupId, userId],
    (err, member) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!member) return res.status(403).json({ error: 'Not a member' });

      // Verify message exists in this group
      db.get(
        `SELECT id FROM group_messages WHERE id = ? AND group_id = ?`,
        [messageId, groupId],
        (err2, msg) => {
          if (err2) return res.status(500).json({ error: 'Database error' });
          if (!msg) return res.status(404).json({ error: 'Message not found' });

          // Insert into tracking table to hide from this user (not actually deleting)
          db.run(
            `INSERT INTO deleted_group_messages (user_id, message_id) VALUES (?, ?) ON CONFLICT (user_id, message_id) DO NOTHING`,
            [userId, messageId],
            function(err3) {
              if (err3) return res.status(500).json({ error: 'Failed to delete message' });
              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});

// Unsend group message (delete for everyone — sender only)
router.delete('/:groupId/messages/:messageId/unsend', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  const messageId = parseInt(req.params.messageId, 10);

  db.run(
    `DELETE FROM group_messages WHERE id = ? AND group_id = ? AND sender_id = ?`,
    [messageId, groupId, userId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to unsend' });
      if (this.changes === 0) return res.status(404).json({ error: 'Message not found or not yours' });
      // Clean up any "deleted for me" tracking entries for this message
      db.run(`DELETE FROM deleted_group_messages WHERE message_id = ?`, [messageId]);
      // Notify other group members via socket so their UI updates in real-time
      const io = req.app.get('io');
      if (io) {
        db.all(`SELECT user_id FROM group_members WHERE group_id = ?`, [groupId], (err2, members) => {
          if (!err2 && members) {
            members.forEach(m => {
              if (m.user_id !== userId) {
                io.to(`user_${m.user_id}`).emit('group:message:unsend', { messageId, groupId });
              }
            });
          }
        });
      }
      res.json({ success: true });
    }
  );
});

// Star/unstar group message
router.post('/:groupId/messages/:messageId/star', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const messageId = parseInt(req.params.messageId, 10);
  const groupId = parseInt(req.params.groupId, 10);

  // Verify message exists in this group
  db.get(
    `SELECT id FROM group_messages WHERE id = ? AND group_id = ?`,
    [messageId, groupId],
    (err, msg) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!msg) return res.status(404).json({ error: 'Message not found' });

      db.get(
        `SELECT * FROM starred_messages WHERE user_id = ? AND message_id = ? AND message_type = 'group'`,
        [userId, messageId],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: 'Database error' });
          if (row) {
            db.run(`DELETE FROM starred_messages WHERE user_id = ? AND message_id = ? AND message_type = 'group'`, [userId, messageId], function(err3) {
              if (err3) return res.status(500).json({ error: 'Failed to unstar' });
              res.json({ success: true, starred: false });
            });
          } else {
            db.run(`INSERT INTO starred_messages (user_id, message_id, message_type, starred_at) VALUES (?, ?, 'group', CURRENT_TIMESTAMP)`,
              [userId, messageId],
              function(err3) {
                if (err3) {
                  console.error('Star insert error:', err3);
                  return res.status(500).json({ error: 'Failed to star' });
                }
                res.json({ success: true, starred: true });
              }
            );
          }
        }
      );
    }
  );
});

// Get group message info
router.get('/:groupId/messages/:messageId/info', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  const messageId = parseInt(req.params.messageId, 10);

  db.get(
    `SELECT gm.id, gm.group_id, gm.sender_id, u.username as sender_username,
            gm.content, gm.type, gm.created_at, gm.is_pinned, gm.pinned_at, gm.is_read
     FROM group_messages gm
     INNER JOIN users u ON (u.id = gm.sender_id)
     WHERE gm.id = ? AND gm.group_id = ?`,
    [messageId, groupId],
    (err, message) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!message) return res.status(404).json({ error: 'Message not found' });
      message.content = decryptMsg(message.content);
      res.json({ success: true, message });
    }
  );
});

// Edit group message (sender only)
router.put('/:groupId/messages/:messageId', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  const messageId = parseInt(req.params.messageId, 10);
  const { content } = req.body;

  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });

  const encrypted = encryptMsg(content.trim());
  db.run(
    `UPDATE group_messages SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND group_id = ? AND sender_id = ?`,
    [encrypted, messageId, groupId, userId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to edit' });
      if (this.changes === 0) return res.status(404).json({ error: 'Message not found or not yours' });
      res.json({ success: true });
    }
  );
});

module.exports = router;

// Get group info with members
router.get('/:groupId/info', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const userId = req.user.userId || req.user.id;

  // Ensure description column exists
  db.run(`ALTER TABLE group_conversations ADD COLUMN description TEXT DEFAULT ''`, () => {
    // Ensure profile_picture column exists
    db.run(`ALTER TABLE group_conversations ADD COLUMN profile_picture TEXT DEFAULT ''`, () => {
      db.get(
        `SELECT g.id, g.name, g.creator_id, g.created_at, g.description, g.profile_picture,
                (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
         FROM group_conversations g
         WHERE g.id = ?`,
        [groupId],
        (err, group) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          if (!group) return res.status(404).json({ error: 'Group not found' });

          // Get members with user info
          db.all(
            `SELECT gm.user_id, gm.role, gm.joined_at, u.username, u.profile_picture, u.bio
             FROM group_members gm
             INNER JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = ?
             ORDER BY gm.role ASC, gm.joined_at ASC`,
            [groupId],
            (err2, members) => {
              if (err2) members = [];
              group.members = members;
              res.json({ success: true, group });
            }
          );
        }
      );
    });
  });
});

// Update group description
router.put('/:groupId/description', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const userId = req.user.userId || req.user.id;
  const { description } = req.body || {};

  // Check if description column exists, add it if not
  db.run(`ALTER TABLE group_conversations ADD COLUMN description TEXT DEFAULT ''`, (alterErr) => {
    // Ignore error if column already exists
    db.run(
      `UPDATE group_conversations SET description = ? WHERE id = ?`,
      [description || '', groupId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update description' });
        res.json({ success: true });
      }
    );
  });
});

// Update group profile picture
router.post('/:groupId/profile-picture', upload.single('profile_picture'), (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const filePath = req.file.path.replace(/\\/g, '/').replace(/^\.?\/?/, '/');
  
  // Ensure column exists
  db.run(`ALTER TABLE group_conversations ADD COLUMN profile_picture TEXT DEFAULT ''`, () => {
    db.run(
      `UPDATE group_conversations SET profile_picture = ? WHERE id = ?`,
      [filePath, groupId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update profile picture' });
        res.json({ success: true, profile_picture: filePath });
      }
    );
  });
});

// Update group name
router.put('/:groupId/name', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  
  db.run(
    `UPDATE group_conversations SET name = ? WHERE id = ?`,
    [name, groupId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update name' });
      res.json({ success: true });
    }
  );
});

// Search group messages
router.get('/:groupId/search', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const q = req.query.q || '';

  if (!q) return res.json({ messages: [] });

  const userId = req.user.userId || req.user.id;
  db.all(
    `SELECT gm.id, gm.sender_id, u.username as sender_username, gm.content, gm.type, gm.created_at
     FROM group_messages gm
     INNER JOIN users u ON u.id = gm.sender_id
     LEFT JOIN deleted_group_messages dgm ON (dgm.message_id = gm.id AND dgm.user_id = ?)
     WHERE gm.group_id = ? AND dgm.id IS NULL
     ORDER BY gm.created_at DESC`,
    [userId, groupId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Search failed' });
      const decrypted = decryptRows(rows || []);
      const searchLower = q.toLowerCase();
      const filtered = decrypted.filter(m => m.content && m.content.toLowerCase().includes(searchLower)).slice(0, 50);
      res.json({ success: true, messages: filtered });
    }
  );
});

// Get group media
router.get('/:groupId/media', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);

  const userId = req.user.userId || req.user.id;
  db.all(
    `SELECT gm.id, gm.sender_id, gm.content, gm.type, gm.created_at
     FROM group_messages gm
     LEFT JOIN deleted_group_messages dgm ON (dgm.message_id = gm.id AND dgm.user_id = ?)
     WHERE gm.group_id = ? AND gm.type IN ('image', 'video', 'file', 'document') AND dgm.id IS NULL
     ORDER BY gm.created_at DESC
     LIMIT 100`,
    [userId, groupId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch media' });
      
      // Also get messages containing URLs for links tab
      db.all(
        `SELECT gm.id, gm.sender_id, gm.content, 'link' as type, gm.created_at
         FROM group_messages gm
         LEFT JOIN deleted_group_messages dgm ON (dgm.message_id = gm.id AND dgm.user_id = ?)
         WHERE gm.group_id = ? AND gm.type = 'text' AND gm.content LIKE '%http%' AND dgm.id IS NULL
         ORDER BY gm.created_at DESC
         LIMIT 50`,
        [userId, groupId],
        (err2, linkRows) => {
          const allMedia = [...decryptRows(rows || []), ...decryptRows(linkRows || [])];
          res.json({ success: true, media: allMedia });
        }
      );
    }
  );
});

// Get starred messages in group
router.get('/:groupId/starred', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const userId = req.user.userId || req.user.id;

  db.all(
    `SELECT gm.id, gm.sender_id, u.username as sender_username, gm.content, gm.type, gm.created_at
     FROM group_messages gm
     INNER JOIN users u ON u.id = gm.sender_id
     LEFT JOIN deleted_group_messages dgm ON (dgm.message_id = gm.id AND dgm.user_id = ?)
     WHERE gm.group_id = ? AND gm.is_pinned = 1 AND dgm.id IS NULL
     ORDER BY gm.created_at DESC`,
    [userId, groupId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch starred messages' });
      res.json({ success: true, messages: decryptRows(rows || []) });
    }
  );
});

// Clear group chat
router.post('/:groupId/clear', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const userId = req.user.userId || req.user.id;

  // Check membership
  db.get(
    `SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId],
    (err, member) => {
      if (!member) return res.status(403).json({ error: 'Not a group member' });
      
      // Soft-delete: insert all group messages into deleted_group_messages for this user
      db.run(
        `INSERT INTO deleted_group_messages (user_id, message_id, deleted_at)
         SELECT ?, id, CURRENT_TIMESTAMP FROM group_messages
         WHERE group_id = ?
         AND id NOT IN (SELECT message_id FROM deleted_group_messages WHERE user_id = ?)`,
        [userId, groupId, userId],
        (err) => {
          if (err) return res.status(500).json({ error: 'Failed to clear chat' });
          res.json({ success: true });
        }
      );
    }
  );
});

// Leave group
router.post('/:groupId/leave', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);
  const userId = req.user.userId || req.user.id;

  db.run(
    `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to leave group' });
      
      // Check if group is now empty, delete if so
      db.get(
        `SELECT COUNT(*) as count FROM group_members WHERE group_id = ?`,
        [groupId],
        (err2, row) => {
          if (row && row.count === 0) {
            db.run(`DELETE FROM group_conversations WHERE id = ?`, [groupId]);
          }
        }
      );
      
      res.json({ success: true });
    }
  );
});

// Delete a group (creator or admin only)
router.delete('/:groupId', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);

  // Check group exists and get creator
  db.get(`SELECT id, creator_id FROM group_conversations WHERE id = ?`, [groupId], (err, group) => {
    if (err) return res.status(500).json({ error: 'Failed to check group' });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Check if requester is creator or admin member
    db.get(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, userId],
      (roleErr, member) => {
        if (roleErr) return res.status(500).json({ error: 'Failed to authorize' });
        const isCreator = group.creator_id == userId;
        const isAdmin = !!member && member.role === 'admin';
        if (!isCreator && !isAdmin) {
          return res.status(403).json({ error: 'Only the creator or an admin can delete this group' });
        }

        // Delete the group (cascades will remove members/messages)
        db.run(`DELETE FROM group_conversations WHERE id = ?`, [groupId], (delErr) => {
          if (delErr) return res.status(500).json({ error: 'Failed to delete group' });
          res.json({ success: true });
        });
      }
    );
  });
});

// ===== GROUP DISAPPEARING MESSAGES =====

// Set disappearing messages for a group
router.post('/:groupId/disappearing', (req, res) => {
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  const { mode, duration } = req.body;

  disappearing.saveGroupSetting(groupId, userId, mode, duration, (err) => {
    if (err) {
      console.error('Error saving group disappearing settings:', err);
      return res.status(500).json({ error: 'Error saving settings' });
    }
    res.json({ success: true, mode, duration });
  });
});

// Get disappearing messages setting for a group
router.get('/:groupId/disappearing', (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);

  disappearing.getGroupSetting(groupId, (err, setting) => {
    if (err) {
      console.error('Error fetching group disappearing settings:', err);
      return res.json({ mode: 'off', duration: 0 });
    }
    res.json({ mode: setting.mode, duration: setting.duration });
  });
});

// Leave group chat - handle disappear-on-exit mode
router.post('/:groupId/leave-chat', (req, res) => {
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);

  disappearing.handleGroupLeave(userId, groupId, (err, deleted) => {
    if (err) console.error('Error in group leave:', err);
    res.json({ success: true, deleted: deleted || 0 });
  });
});
