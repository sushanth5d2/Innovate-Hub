const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');
const upload = require('../middleware/upload');

router.use(authMiddleware);

// Create a group (supports multipart with profile_picture or JSON body)
router.post('/', upload.single('profile_picture'), (req, res) => {
  const db = getDb();
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

  // Ensure profile_picture column exists
  db.run(`ALTER TABLE group_conversations ADD COLUMN profile_picture TEXT DEFAULT ''`, () => {
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
  });
});

// List groups for current user with previews and unread counts
router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  // Ensure profile_picture column exists
  db.run(`ALTER TABLE group_conversations ADD COLUMN profile_picture TEXT DEFAULT ''`, () => {
  db.all(
    `SELECT g.id, g.name, g.created_at, g.profile_picture,
            (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
            (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message,
            (SELECT type FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message_type,
            (SELECT created_at FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
            (SELECT COUNT(*) FROM group_messages WHERE group_id = g.id AND is_read = 0 AND sender_id != ?) as unread_count
     FROM group_conversations g
     INNER JOIN group_members m ON (m.group_id = g.id AND m.user_id = ?)
     ORDER BY COALESCE(last_message_time, g.created_at) DESC`,
    [userId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch groups' });
      res.json({ success: true, groups: rows });
    }
  );
  });
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

// Get group messages
router.get('/:groupId/messages', (req, res) => {
  const db = getDb();
  const userId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);

  db.all(
    `SELECT gm.id, gm.group_id, gm.sender_id, u.username as sender_username, gm.content, gm.type, gm.attachments,
            gm.timer, gm.expires_at, gm.is_read, gm.created_at
     FROM group_messages gm
     INNER JOIN users u ON (u.id = gm.sender_id)
     WHERE gm.group_id = ?
     ORDER BY gm.created_at ASC`,
    [groupId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch messages' });
      res.json({ success: true, messages: rows });
    }
  );
});

// Send a group message (text or simple content)
router.post('/:groupId/messages', (req, res) => {
  const db = getDb();
  const senderId = req.user.userId || req.user.id;
  const groupId = parseInt(req.params.groupId, 10);
  const { content = '', type = 'text', timer = null } = req.body || {};

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
        console.log('User', senderId, 'is not a member of group', groupId);
        return res.status(403).json({ error: 'You are not a member of this group' });
      }
      
      // User is a member, proceed with message
      db.run(
        `INSERT INTO group_messages (group_id, sender_id, content, type, timer, expires_at)
         VALUES (?, ?, ?, ?, ?, CASE WHEN ? IS NOT NULL THEN datetime('now', '+' || ? || ' seconds') ELSE NULL END)`,
        [groupId, senderId, content, type, timer, timer, timer],
        function(err) {
          if (err) {
            console.error('Error inserting group message:', err);
            console.error('groupId:', groupId, 'senderId:', senderId, 'type:', type);
            return res.status(500).json({ error: 'Failed to send message', details: err.message });
          }
      
      const messageId = this.lastID;
      
      // Fetch the complete message with sender info
      db.get(
        `SELECT gm.id, gm.group_id, gm.sender_id, u.username as sender_username, gm.content, gm.type, gm.attachments,
                gm.timer, gm.expires_at, gm.is_read, gm.created_at
         FROM group_messages gm
         INNER JOIN users u ON (u.id = gm.sender_id)
         WHERE gm.id = ?`,
        [messageId],
        (err2, message) => {
          if (err2) {
            console.error('Error fetching sent message:', err2);
            return res.status(500).json({ error: 'Message sent but failed to retrieve' });
          }
          res.json({ success: true, message: message });
        }
      );
    }
  );
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

          // Toggle pin status
          const updateQuery = `
            UPDATE group_messages 
            SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END,
                pinned_at = CASE WHEN is_pinned = 0 THEN datetime('now') ELSE NULL END,
                pinned_by = CASE WHEN is_pinned = 0 THEN ? ELSE NULL END
            WHERE id = ?
          `;

          db.run(updateQuery, [userId, messageId], function(err) {
            if (err) {
              return res.status(500).json({ error: 'Error updating pin status' });
            }
            res.json({ success: true, pinned: message.is_pinned ? false : true });
          });
        }
      );
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

  db.all(
    `SELECT gm.id, gm.sender_id, u.username as sender_username, gm.content, gm.type, gm.created_at
     FROM group_messages gm
     INNER JOIN users u ON u.id = gm.sender_id
     WHERE gm.group_id = ? AND gm.content LIKE ?
     ORDER BY gm.created_at DESC
     LIMIT 50`,
    [groupId, `%${q}%`],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Search failed' });
      res.json({ success: true, messages: rows });
    }
  );
});

// Get group media
router.get('/:groupId/media', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.groupId, 10);

  db.all(
    `SELECT id, sender_id, content, type, created_at
     FROM group_messages
     WHERE group_id = ? AND type IN ('image', 'video', 'file', 'document')
     ORDER BY created_at DESC
     LIMIT 100`,
    [groupId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch media' });
      
      // Also get messages containing URLs for links tab
      db.all(
        `SELECT id, sender_id, content, 'link' as type, created_at
         FROM group_messages
         WHERE group_id = ? AND type = 'text' AND content LIKE '%http%'
         ORDER BY created_at DESC
         LIMIT 50`,
        [groupId],
        (err2, linkRows) => {
          const allMedia = [...(rows || []), ...(linkRows || [])];
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
     WHERE gm.group_id = ? AND gm.is_pinned = 1
     ORDER BY gm.created_at DESC`,
    [groupId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch starred messages' });
      res.json({ success: true, messages: rows });
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
      
      db.run(
        `DELETE FROM group_messages WHERE group_id = ?`,
        [groupId],
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
        const isCreator = group.creator_id === userId;
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
