const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');
const fs = require('fs');
const path = require('path');
const mlClient = require('../services/ml-client');

// Create folder structure for a group
function createGroupFolders(communityId, groupId) {
  const basePath = path.join(__dirname, '../uploads/communities', communityId.toString(), 'groups', groupId.toString());
  
  // Create folders
  const folders = [
    basePath,
    path.join(basePath, 'images'),
    path.join(basePath, 'documents'),
    path.join(basePath, 'videos'),
    path.join(basePath, 'files')
  ];

  folders.forEach(folder => {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
  });

  // Create links.json file
  const linksFile = path.join(basePath, 'links.json');
  if (!fs.existsSync(linksFile)) {
    fs.writeFileSync(linksFile, JSON.stringify({ links: [] }));
  }

  return basePath;
}

// Get file type from extension
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
  const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  const docExts = ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx'];

  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (docExts.includes(ext)) return 'document';
  return 'other';
}

// Create group in a community
router.post('/communities/:communityId/groups', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const communityId = req.params.communityId;
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  // Check if user is a community member
  db.get(
    'SELECT * FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a community member to create a group' });
      }

      // Create group
      db.run(
        `INSERT INTO community_groups (community_id, name, description, creator_id) 
         VALUES (?, ?, ?, ?)`,
        [communityId, name, description, userId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error creating group' });
          }

          const groupId = this.lastID;

          // Add creator as admin
          db.run(
            'INSERT INTO community_group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            [groupId, userId, 'admin'],
            (err) => {
              if (err) {
                return res.status(500).json({ error: 'Error adding admin to group' });
              }

              // Create folder structure
              try {
                createGroupFolders(communityId, groupId);
              } catch (error) {
                console.error('Error creating folders:', error);
              }

              res.json({
                success: true,
                message: 'Group created successfully',
                group: {
                  id: groupId,
                  community_id: communityId,
                  name,
                  description
                }
              });
            }
          );
        }
      );
    }
  );
});

// Get all groups in a community
router.get('/communities/:communityId/groups', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const communityId = req.params.communityId;

  const query = `
    SELECT 
      cg.*,
      u.username as creator_username,
      (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id) as member_count,
      (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id AND user_id = ?) as is_member
    FROM community_groups cg
    JOIN users u ON cg.creator_id = u.id
    WHERE cg.community_id = ?
    ORDER BY cg.created_at DESC
  `;

  db.all(query, [userId, communityId], (err, groups) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching groups' });
    }
    res.json({ success: true, groups });
  });
});

// Get single group details
router.get('/community-groups/:groupId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  const query = `
    SELECT 
      cg.*,
      u.username as creator_username,
      (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id) as member_count,
      (SELECT COUNT(*) FROM community_group_members WHERE group_id = cg.id AND user_id = ?) as is_member
    FROM community_groups cg
    JOIN users u ON cg.creator_id = u.id
    WHERE cg.id = ?
  `;

  db.get(query, [userId, groupId], (err, group) => {
    if (err || !group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json({ success: true, group });
  });
});

// Join group
router.post('/community-groups/:groupId/join', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  // Check if user is already a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (member) {
        return res.status(400).json({ error: 'Already a member' });
      }

      db.run(
        'INSERT INTO community_group_members (group_id, user_id, role) VALUES (?, ?, ?)',
        [groupId, userId, 'member'],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error joining group' });
          }
          res.json({ success: true, message: 'Joined group successfully' });
        }
      );
    }
  );
});

// Leave group
router.post('/community-groups/:groupId/leave', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  db.run(
    'DELETE FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error leaving group' });
      }
      res.json({ success: true, message: 'Left group successfully' });
    }
  );
});

// Post in group
router.post('/community-groups/:groupId/posts', authMiddleware, (req, res, next) => {
  // Log all fields before multer processing
  console.log('POST /community-groups/:groupId/posts - Starting request');
  console.log('Headers:', req.headers['content-type']);
  next();
}, upload.fields([
  { name: 'attachments', maxCount: 10 }
]), (req, res) => {
  console.log('Multer processed. req.files:', req.files);
  console.log('req.body:', req.body);
  
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { content, location } = req.body;

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to post' });
      }

      // Get group and community info
      db.get(
        'SELECT community_id FROM community_groups WHERE id = ?',
        [groupId],
        (err, group) => {
          if (err || !group) {
            return res.status(404).json({ error: 'Group not found' });
          }

          const communityId = group.community_id;
          let attachments = [];

          // Process uploaded files
          if (req.files && req.files.attachments) {
            const basePath = path.join(__dirname, '../uploads/communities', communityId.toString(), 'groups', groupId.toString());
            
            // Ensure base folders exist
            ['images', 'videos', 'documents', 'files'].forEach(folder => {
              const folderPath = path.join(basePath, folder);
              if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
              }
            });
            
            req.files.attachments.forEach(file => {
              const fileType = getFileType(file.filename);
              const targetFolder = fileType === 'image' ? 'images' : 
                                 fileType === 'video' ? 'videos' :
                                 fileType === 'document' ? 'documents' : 'files';
              
              const targetPath = path.join(basePath, targetFolder, file.filename);
              const publicUrl = `/uploads/communities/${communityId}/groups/${groupId}/${targetFolder}/${file.filename}`;
              
              // Move file to organized folder
              try {
                if (fs.existsSync(file.path)) {
                  fs.renameSync(file.path, targetPath);
                  attachments.push(publicUrl);
                  
                  // Save file record
                  db.run(
                    `INSERT INTO community_group_files (group_id, user_id, filename, filepath, file_type, filesize)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    // Store public URL in DB so the client can open it directly.
                    [groupId, userId, file.originalname, publicUrl, fileType, file.size]
                  );
                }
              } catch (error) {
                console.error('Error moving file:', error);
              }
            });
          }

          // Add location if provided
          let postContent = content || '';
          if (location) {
            try {
              const loc = JSON.parse(location);
              const lat = loc?.latitude ?? loc?.lat;
              const lng = loc?.longitude ?? loc?.lng;
              if (typeof lat === 'number' && typeof lng === 'number') {
                postContent += `\n📍 Location: https://maps.google.com/?q=${lat},${lng}`;
              }
            } catch (e) {
              console.error('Error parsing location:', e);
            }
          }

          // Create post
          db.run(
            `INSERT INTO community_group_posts (group_id, user_id, content, attachments)
             VALUES (?, ?, ?, ?)`,
            [groupId, userId, postContent, JSON.stringify(attachments)],
            function(err) {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error creating post' });
              }

              const postId = this.lastID;
              const io = req.app.get('io');

              // Hydrate with username/created_at for client rendering and realtime broadcast.
              db.get(
                `SELECT cgp.*, u.username, u.profile_picture
                 FROM community_group_posts cgp
                 JOIN users u ON cgp.user_id = u.id
                 WHERE cgp.id = ?`,
                [postId],
                (err2, postRow) => {
                  if (err2 || !postRow) {
                    const fallback = {
                      id: postId,
                      group_id: groupId,
                      user_id: userId,
                      content: postContent,
                      attachments
                    };
                    if (io) {
                      io.to(`community_group_${groupId}`).emit('community-group:post:new', fallback);
                    }
                    return res.json({ success: true, message: 'Post created successfully', post: fallback });
                  }

                  const hydrated = {
                    ...postRow,
                    attachments: postRow.attachments ? JSON.parse(postRow.attachments) : []
                  };

                  if (io) {
                    io.to(`community_group_${groupId}`).emit('community-group:post:new', hydrated);
                  }

                  return res.json({ success: true, message: 'Post created successfully', post: hydrated });
                }
              );
            }
          );
        }
      );
    }
  );
});

// Get group posts
router.get('/community-groups/:groupId/posts', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to view posts' });
      }

      const query = `
        SELECT 
          cgp.*,
          u.username,
          u.profile_picture
        FROM community_group_posts cgp
        JOIN users u ON cgp.user_id = u.id
        WHERE cgp.group_id = ?
        ORDER BY cgp.created_at DESC
      `;

      db.all(query, [groupId], (err, posts) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching posts' });
        }

        // Parse attachments
        posts = posts.map(post => ({
          ...post,
          attachments: post.attachments ? JSON.parse(post.attachments) : []
        }));

        res.json({ success: true, posts });
      });
    }
  );
});

// Get group files (organized by type)
router.get('/community-groups/:groupId/files', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { type } = req.query; // Filter by type: 'image', 'document', 'video', 'other'

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to view files' });
      }

      let query = `
        SELECT 
          cgf.*,
          u.username,
          u.profile_picture
        FROM community_group_files cgf
        JOIN users u ON cgf.user_id = u.id
        WHERE cgf.group_id = ?
      `;

      const params = [groupId];

      if (type) {
        query += ' AND cgf.file_type = ?';
        params.push(type);
      }

      query += ' ORDER BY cgf.created_at DESC';

      db.all(query, params, (err, files) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching files' });
        }

        res.json({ success: true, files });
      });
    }
  );
});

// Save link in group
router.post('/community-groups/:groupId/links', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { url, title, description } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to save links' });
      }

      db.run(
        `INSERT INTO community_group_links (group_id, user_id, url, title, description)
         VALUES (?, ?, ?, ?, ?)`,
        [groupId, userId, url, title, description],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Error saving link' });
          }

          res.json({
            success: true,
            message: 'Link saved successfully',
            link: {
              id: this.lastID,
              group_id: groupId,
              url,
              title,
              description
            }
          });
        }
      );
    }
  );
});

// Get group links
router.get('/community-groups/:groupId/links', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  // Check if user is a member
  db.get(
    'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'You must be a member to view links' });
      }

      const query = `
        SELECT 
          cgl.*,
          u.username,
          u.profile_picture
        FROM community_group_links cgl
        JOIN users u ON cgl.user_id = u.id
        WHERE cgl.group_id = ?
        ORDER BY cgl.created_at DESC
      `;

      db.all(query, [groupId], (err, links) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching links' });
        }

        res.json({ success: true, links });
      });
    }
  );
});

// Get group members
router.get('/community-groups/:groupId/members', authMiddleware, (req, res) => {
  const db = getDb();
  const groupId = req.params.groupId;

  const query = `
    SELECT 
      u.id,
      u.username,
      u.profile_picture,
      cgm.role,
      cgm.joined_at
    FROM community_group_members cgm
    JOIN users u ON cgm.user_id = u.id
    WHERE cgm.group_id = ?
    ORDER BY cgm.joined_at ASC
  `;

  db.all(query, [groupId], (err, members) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching members' });
    }

    res.json({ success: true, members });
  });
});

function requireGroupMember(db, groupId, userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId],
      (err, member) => {
        if (err) return reject(err);
        if (!member) return resolve(null);
        resolve(member);
      }
    );
  });
}

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

// === Group Tasks (AI To-Do) ===

// List tasks for a group
router.get('/community-groups/:groupId/tasks', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to view tasks' });

    db.all(
      `SELECT t.*, u.username as created_by_username
       FROM community_group_tasks t
       JOIN users u ON t.created_by = u.id
       WHERE t.group_id = ?
       ORDER BY CASE t.status WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
                COALESCE(t.due_date, t.created_at) ASC`,
      [groupId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error fetching tasks' });
        const tasks = rows.map(r => ({
          ...r,
          assignees: r.assignees ? JSON.parse(r.assignees) : []
        }));
        res.json({ success: true, tasks });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error fetching tasks' });
  }
});

// Create tasks from text (simple extraction)
router.post('/community-groups/:groupId/tasks/from-text', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { text, priority = 'medium', due_date = null, assignees = [] } = req.body || {};

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to create tasks' });

    const tasks = extractTasksFromText(text);
    if (tasks.length === 0) return res.status(400).json({ error: 'No tasks found in text' });

    const created = [];
    const stmt = db.prepare(
      `INSERT INTO community_group_tasks (group_id, title, description, priority, status, due_date, assignees, progress, source_type, source_ref, created_by)
       VALUES (?, ?, ?, ?, 'todo', ?, ?, 0, 'text', ?, ?)`
    );

    tasks.forEach(t => {
      stmt.run(
        groupId,
        t.title,
        '',
        priority,
        due_date,
        JSON.stringify(Array.isArray(assignees) ? assignees : []),
        text || '',
        userId,
        function(err) {
          if (!err) created.push({ id: this.lastID, title: t.title });
        }
      );
    });

    stmt.finalize(() => res.json({ success: true, created_count: created.length, tasks: created }));
  } catch (e) {
    res.status(500).json({ error: 'Error creating tasks' });
  }
});

// Create tasks from image (OCR via ML service)
router.post('/community-groups/:groupId/tasks/from-image', authMiddleware, upload.single('image'), async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  if (!req.file) return res.status(400).json({ error: 'image file is required' });

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to create tasks' });

    let analysis;
    try {
      analysis = await mlClient.analyzeImageForTasks(req.file.path);
    } catch (mlErr) {
      return res.status(503).json({ error: 'ML service unavailable for OCR task extraction' });
    }

    if (!analysis || !analysis.success || !Array.isArray(analysis.tasks) || analysis.tasks.length === 0) {
      return res.status(400).json({ error: analysis?.error || 'No tasks found in image' });
    }

    const created = [];
    const stmt = db.prepare(
      `INSERT INTO community_group_tasks (group_id, title, description, priority, status, due_date, assignees, progress, source_type, source_ref, created_by)
       VALUES (?, ?, ?, 'medium', 'todo', NULL, ?, 0, 'image', ?, ?)`
    );

    analysis.tasks.forEach(title => {
      stmt.run(
        groupId,
        String(title).trim(),
        '',
        JSON.stringify([]),
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
          file: `/uploads/community/${req.file.filename}`,
          extracted_text: analysis.extracted_text || ''
        },
        created_count: created.length,
        tasks: created
      });
    });
  } catch (e) {
    res.status(500).json({ error: 'Error creating tasks from image' });
  }
});

// Update a task
router.patch('/community-groups/:groupId/tasks/:taskId', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { groupId, taskId } = req.params;
  const { title, description, priority, status, due_date, assignees, progress } = req.body || {};

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to update tasks' });

    db.get(
      'SELECT * FROM community_group_tasks WHERE id = ? AND group_id = ?',
      [taskId, groupId],
      (err, existing) => {
        if (err || !existing) return res.status(404).json({ error: 'Task not found' });

        const next = {
          title: typeof title === 'string' ? title : existing.title,
          description: typeof description === 'string' ? description : existing.description,
          priority: typeof priority === 'string' ? priority : existing.priority,
          status: typeof status === 'string' ? status : existing.status,
          due_date: typeof due_date === 'undefined' ? existing.due_date : due_date,
          assignees: typeof assignees === 'undefined' ? existing.assignees : JSON.stringify(Array.isArray(assignees) ? assignees : []),
          progress: typeof progress === 'number' ? progress : existing.progress
        };

        db.run(
          `UPDATE community_group_tasks
           SET title = ?, description = ?, priority = ?, status = ?, due_date = ?, assignees = ?, progress = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND group_id = ?`,
          [
            next.title,
            next.description,
            next.priority,
            next.status,
            next.due_date,
            next.assignees,
            next.progress,
            taskId,
            groupId
          ],
          (uErr) => {
            if (uErr) return res.status(500).json({ error: 'Error updating task' });
            res.json({ success: true });
          }
        );
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error updating task' });
  }
});

// === Group Notes (Markdown + versions) ===

router.get('/community-groups/:groupId/notes', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to view notes' });

    db.all(
      `SELECT n.id, n.group_id, n.title, n.created_at, n.updated_at,
              cu.username as created_by_username,
              uu.username as updated_by_username
       FROM community_group_notes n
       JOIN users cu ON n.created_by = cu.id
       LEFT JOIN users uu ON n.updated_by = uu.id
       WHERE n.group_id = ?
       ORDER BY n.updated_at DESC`,
      [groupId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error fetching notes' });
        res.json({ success: true, notes: rows });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error fetching notes' });
  }
});

router.post('/community-groups/:groupId/notes', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const groupId = req.params.groupId;
  const { title, content_md = '' } = req.body || {};

  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const member = await requireGroupMember(db, groupId, userId);
    if (!member) return res.status(403).json({ error: 'You must be a member to create notes' });

    db.run(
      `INSERT INTO community_group_notes (group_id, title, content_md, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [groupId, title, content_md, userId, userId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error creating note' });
        res.json({ success: true, note: { id: this.lastID, group_id: Number(groupId), title } });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error creating note' });
  }
});

router.get('/community-groups/notes/:noteId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;

  db.get(
    `SELECT n.*, cu.username as created_by_username, uu.username as updated_by_username
     FROM community_group_notes n
     JOIN users cu ON n.created_by = cu.id
     LEFT JOIN users uu ON n.updated_by = uu.id
     WHERE n.id = ?`,
    [noteId],
    async (err, note) => {
      if (err || !note) return res.status(404).json({ error: 'Note not found' });
      try {
        const member = await requireGroupMember(db, note.group_id, userId);
        if (!member) return res.status(403).json({ error: 'You must be a member to view this note' });
        res.json({ success: true, note });
      } catch (e) {
        res.status(500).json({ error: 'Error fetching note' });
      }
    }
  );
});

router.put('/community-groups/notes/:noteId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;
  const { title, content_md } = req.body || {};

  db.get('SELECT * FROM community_group_notes WHERE id = ?', [noteId], async (err, existing) => {
    if (err || !existing) return res.status(404).json({ error: 'Note not found' });
    try {
      const member = await requireGroupMember(db, existing.group_id, userId);
      if (!member) return res.status(403).json({ error: 'You must be a member to update notes' });

      // Save version before update
      db.run(
        `INSERT INTO community_group_note_versions (note_id, content_md, created_by)
         VALUES (?, ?, ?)`,
        [noteId, existing.content_md || '', userId]
      );

      const nextTitle = typeof title === 'string' ? title : existing.title;
      const nextContent = typeof content_md === 'string' ? content_md : existing.content_md;

      db.run(
        `UPDATE community_group_notes
         SET title = ?, content_md = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextTitle, nextContent, userId, noteId],
        (uErr) => {
          if (uErr) return res.status(500).json({ error: 'Error updating note' });
          res.json({ success: true });
        }
      );
    } catch (e) {
      res.status(500).json({ error: 'Error updating note' });
    }
  });
});

router.get('/community-groups/notes/:noteId/versions', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const noteId = req.params.noteId;

  db.get('SELECT group_id FROM community_group_notes WHERE id = ?', [noteId], async (err, note) => {
    if (err || !note) return res.status(404).json({ error: 'Note not found' });
    try {
      const member = await requireGroupMember(db, note.group_id, userId);
      if (!member) return res.status(403).json({ error: 'You must be a member to view versions' });

      db.all(
        `SELECT v.id, v.note_id, v.created_at, u.username as created_by_username
         FROM community_group_note_versions v
         JOIN users u ON v.created_by = u.id
         WHERE v.note_id = ?
         ORDER BY v.created_at DESC`,
        [noteId],
        (e2, rows) => {
          if (e2) return res.status(500).json({ error: 'Error fetching versions' });
          res.json({ success: true, versions: rows });
        }
      );
    } catch (e) {
      res.status(500).json({ error: 'Error fetching versions' });
    }
  });
});

router.post('/community-groups/notes/:noteId/restore/:versionId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { noteId, versionId } = req.params;

  db.get('SELECT group_id FROM community_group_notes WHERE id = ?', [noteId], async (err, note) => {
    if (err || !note) return res.status(404).json({ error: 'Note not found' });
    try {
      const member = await requireGroupMember(db, note.group_id, userId);
      if (!member) return res.status(403).json({ error: 'You must be a member to restore versions' });

      db.get(
        'SELECT content_md FROM community_group_note_versions WHERE id = ? AND note_id = ?',
        [versionId, noteId],
        (e2, version) => {
          if (e2 || !version) return res.status(404).json({ error: 'Version not found' });

          db.run(
            `UPDATE community_group_notes
             SET content_md = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [version.content_md || '', userId, noteId],
            (uErr) => {
              if (uErr) return res.status(500).json({ error: 'Error restoring version' });
              res.json({ success: true });
            }
          );
        }
      );
    } catch (e) {
      res.status(500).json({ error: 'Error restoring version' });
    }
  });
});

module.exports = router;
