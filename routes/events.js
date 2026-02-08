const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');
const crypto = require('crypto');
const upload = require('../middleware/upload');

function generateTicketCode() {
  // 32 hex chars (~128 bits) is enough for unguessable codes.
  return crypto.randomBytes(16).toString('hex');
}

function requireEventCreator(db, eventId, userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, creator_id FROM events WHERE id = ?', [eventId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve({ ok: false, reason: 'not_found' });
      if (row.creator_id !== userId) return resolve({ ok: false, reason: 'forbidden' });
      return resolve({ ok: true });
    });
  });
}

function sendDirectMessage(req, db, senderId, receiverId, content) {
  return new Promise((resolve) => {
    const io = req.app.get('io');
    const createdAtIso = new Date().toISOString();

    db.run(
      `INSERT INTO messages (sender_id, receiver_id, content, type, created_at)
       VALUES (?, ?, ?, 'text', datetime('now'))`,
      [senderId, receiverId, content],
      function(err) {
        if (err) {
          return resolve({ ok: false });
        }

        const messageId = this.lastID;
        db.get('SELECT username, profile_picture FROM users WHERE id = ?', [senderId], (err2, sender) => {
          const messageData = {
            id: messageId,
            sender_id: senderId,
            receiver_id: receiverId,
            content,
            type: 'text',
            sender_username: sender?.username,
            sender_picture: sender?.profile_picture,
            created_at: createdAtIso
          };

          try {
            io.to(`user_${receiverId}`).emit('new_message', messageData);
            io.to(`user_${receiverId}`).emit('new_notification', {
              type: 'message',
              content: sender?.username ? `New message from ${sender.username}` : 'New message',
              created_at: createdAtIso
            });
          } catch {
            // ignore socket failures
          }

          // Best-effort notification
          db.run(
            `INSERT INTO notifications (user_id, type, content, related_id, created_by, created_at)
             VALUES (?, 'message', ?, ?, ?, datetime('now'))`,
            [receiverId, sender?.username ? `New message from ${sender.username}` : 'New message', messageId, senderId]
          );

          resolve({ ok: true, messageId });
        });
      }
    );
  });
}

// =========================
// Check-in Staff Management
// =========================

// Check-in staff login (separate from user authentication)
router.post('/checkin-staff/login', async (req, res) => {
  const db = getDb();
  const { event_id, username, password } = req.body || {};

  if (!event_id || !username || !password) {
    return res.status(400).json({ error: 'Event ID, username, and password required' });
  }

  try {
    // Verify staff credentials
    db.get(
      `SELECT s.*, e.title, e.event_date, e.location
       FROM event_checkin_staff s
       JOIN events e ON e.id = s.event_id
       WHERE s.event_id = ? AND s.username = ? AND s.password = ? AND s.is_active = 1`,
      [event_id, username, password],
      (err, staff) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!staff) return res.status(401).json({ error: 'Invalid credentials' });

        // Update last login
        db.run(
          'UPDATE event_checkin_staff SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
          [staff.id]
        );

        // Generate JWT token for staff
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
          { staffId: staff.id, eventId: staff.event_id, type: 'checkin_staff' },
          process.env.JWT_SECRET || 'your-secret-key',
          { expiresIn: '12h' }
        );

        res.json({
          success: true,
          token,
          event: {
            id: staff.event_id,
            title: staff.title,
            event_date: staff.event_date,
            location: staff.location
          },
          staff: {
            username: staff.username,
            full_name: staff.full_name
          }
        });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Create check-in staff account (event creator only)
router.post('/:eventId/checkin-staff', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;
  const { username, password, full_name } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Username min 3 chars, password min 6 chars' });
  }

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    db.run(
      `INSERT INTO event_checkin_staff (event_id, username, password, full_name, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [eventId, username, password, full_name || username, userId],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists for this event' });
          }
          return res.status(500).json({ error: 'Error creating staff account' });
        }

        res.json({
          success: true,
          staff: {
            id: this.lastID,
            username,
            full_name: full_name || username
          }
        });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error creating staff account' });
  }
});

// List check-in staff (event creator only)
router.get('/:eventId/checkin-staff', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    db.all(
      `SELECT id, username, full_name, is_active, last_login, created_at
       FROM event_checkin_staff
       WHERE event_id = ?
       ORDER BY created_at DESC`,
      [eventId],
      (err, staff) => {
        if (err) return res.status(500).json({ error: 'Error fetching staff' });
        res.json({ success: true, staff: staff || [] });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error fetching staff' });
  }
});

// Delete check-in staff (event creator only)
router.delete('/:eventId/checkin-staff/:staffId', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId, staffId } = req.params;
  const userId = req.user.userId;

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    db.run(
      'DELETE FROM event_checkin_staff WHERE id = ? AND event_id = ?',
      [staffId, eventId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Error deleting staff' });
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Staff not found' });
        }
        res.json({ success: true });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error deleting staff' });
  }
});

// =========================
// Crosspath (keep before /:eventId)
// =========================

// Get crosspath requests (frontend expects /crosspath/pending)
router.get('/crosspath/pending', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT ce.*,
           e.title as event_title,
           u.username as user_username,
           u.profile_picture as user_profile_picture
    FROM crosspath_events ce
    JOIN events e ON ce.event_id = e.id
    JOIN users u ON ce.user1_id = u.id
    WHERE ce.user2_id = ? AND ce.status = 'pending'
    ORDER BY ce.created_at DESC
  `;

  db.all(query, [userId], (err, requests) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching crosspath requests' });
    }
    res.json({ success: true, requests });
  });
});

// Backward-compatible alias
router.get('/crosspath/requests', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT ce.*,
           e.title as event_title,
           u.username as user_username,
           u.profile_picture as user_profile_picture
    FROM crosspath_events ce
    JOIN events e ON ce.event_id = e.id
    JOIN users u ON ce.user1_id = u.id
    WHERE ce.user2_id = ? AND ce.status = 'pending'
    ORDER BY ce.created_at DESC
  `;

  db.all(query, [userId], (err, requests) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching crosspath requests' });
    }
    res.json({ success: true, requests });
  });
});

// Accept/decline crosspath (frontend expects /accept or /reject)
router.post('/crosspath/:crosspathId/accept', authMiddleware, (req, res) => {
  req.body.status = 'accepted';
  return respondToCrosspath(req, res);
});

router.post('/crosspath/:crosspathId/reject', authMiddleware, (req, res) => {
  req.body.status = 'declined';
  return respondToCrosspath(req, res);
});

// Backward-compatible handler
router.post('/crosspath/:crosspathId/respond', authMiddleware, respondToCrosspath);

function respondToCrosspath(req, res) {
  const db = getDb();
  const { crosspathId } = req.params;
  const userId = req.user.userId;
  const { status } = req.body; // 'accepted' or 'declined'

  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.run(
    'UPDATE crosspath_events SET status = ? WHERE id = ? AND user2_id = ?',
    [status, crosspathId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error responding to crosspath' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Crosspath request not found' });
      }

      if (status === 'accepted') {
        db.get('SELECT user1_id FROM crosspath_events WHERE id = ?', [crosspathId], (err, crosspath) => {
          if (crosspath) {
            db.run(
              'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
              [crosspath.user1_id, 'crosspath_accepted', 'accepted your crosspath request. You can now chat!', userId]
            );
          }
        });
      }

      res.json({ success: true });
    }
  );
}

// Enable crosspath for an event with location
router.post('/:eventId/crosspath/enable', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Latitude and longitude required' });
  }

  // Check if user is attending/creating this event
  const checkQuery = `
    SELECT 1 FROM events WHERE id = ? AND creator_id = ?
    UNION
    SELECT 1 FROM event_attendees WHERE event_id = ? AND user_id = ? AND status = 'accepted'
  `;

  db.get(checkQuery, [eventId, userId, eventId, userId], (err, attending) => {
    if (err) {
      return res.status(500).json({ error: 'Error checking event participation' });
    }

    if (!attending) {
      return res.status(403).json({ error: 'You must be attending this event to enable crosspath' });
    }

    // Insert or update location
    db.run(
      `INSERT INTO crosspath_locations (user_id, event_id, latitude, longitude, is_active, last_updated)
       VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, event_id) 
       DO UPDATE SET latitude = ?, longitude = ?, is_active = 1, last_updated = CURRENT_TIMESTAMP`,
      [userId, eventId, latitude, longitude, latitude, longitude],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error enabling crosspath' });
        }

        // Check for nearby users and create matches
        checkProximityAndNotify(req, db, userId, eventId, latitude, longitude);

        res.json({ success: true, message: 'Crosspath enabled' });
      }
    );
  });
});

// Disable crosspath for an event
router.post('/:eventId/crosspath/disable', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  db.run(
    'UPDATE crosspath_locations SET is_active = 0 WHERE user_id = ? AND event_id = ?',
    [userId, eventId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error disabling crosspath' });
      }

      res.json({ success: true, message: 'Crosspath disabled' });
    }
  );
});

// Update live location for crosspath
router.post('/:eventId/crosspath/update-location', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Latitude and longitude required' });
  }

  db.run(
    `UPDATE crosspath_locations 
     SET latitude = ?, longitude = ?, last_updated = CURRENT_TIMESTAMP 
     WHERE user_id = ? AND event_id = ? AND is_active = 1`,
    [latitude, longitude, userId, eventId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating location' });
      }

      if (this.changes > 0) {
        // Check for nearby users and create matches
        checkProximityAndNotify(req, db, userId, eventId, latitude, longitude);
      }

      res.json({ success: true });
    }
  );
});

// Get crosspath enabled states for user's events
router.get('/crosspath/enabled-states', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT event_id, is_active
    FROM crosspath_locations
    WHERE user_id = ? AND is_active = 1
  `;

  db.all(query, [userId], (err, states) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching enabled states' });
    }

    const enabledEvents = states.reduce((acc, s) => {
      acc[s.event_id] = true;
      return acc;
    }, {});

    res.json({ success: true, enabledEvents });
  });
});

// Get crosspath matches for an event
router.get('/:eventId/crosspath/matches', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  const query = `
    SELECT DISTINCT
      u.id,
      u.username,
      u.profile_picture,
      u.bio,
      cm.distance_meters,
      cm.matched_at,
      cl.latitude,
      cl.longitude,
      cl.last_updated
    FROM crosspath_matches cm
    JOIN users u ON (cm.user1_id = u.id OR cm.user2_id = u.id)
    LEFT JOIN crosspath_locations cl ON cl.user_id = u.id AND cl.event_id = cm.event_id AND cl.is_active = 1
    WHERE cm.event_id = ?
      AND (cm.user1_id = ? OR cm.user2_id = ?)
      AND u.id != ?
    ORDER BY cm.matched_at DESC
  `;

  db.all(query, [eventId, userId, userId, userId], (err, matches) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching matches' });
    }

    res.json({ success: true, matches });
  });
});

// Helper function to check proximity and send notifications
function checkProximityAndNotify(req, db, userId, eventId, latitude, longitude) {
  const io = req.app.get('io');
  
  // Find other users with crosspath enabled for the same event
  const query = `
    SELECT cl.*, u.username
    FROM crosspath_locations cl
    JOIN users u ON cl.user_id = u.id
    WHERE cl.event_id = ? 
      AND cl.user_id != ? 
      AND cl.is_active = 1
      AND datetime(cl.last_updated) > datetime('now', '-10 minutes')
  `;

  db.all(query, [eventId, userId], (err, nearbyUsers) => {
    if (err || !nearbyUsers) return;

    nearbyUsers.forEach(other => {
      const distance = calculateDistance(
        latitude, 
        longitude, 
        other.latitude, 
        other.longitude
      );

      // If within 500 meters
      if (distance <= 500) {
        // Check if match already exists
        db.get(
          `SELECT id FROM crosspath_matches 
           WHERE event_id = ? 
             AND ((user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?))`,
          [eventId, userId, other.user_id, other.user_id, userId],
          (err, existingMatch) => {
            if (!existingMatch) {
              // Create new match
              db.run(
                `INSERT INTO crosspath_matches (event_id, user1_id, user2_id, distance_meters, notification_sent)
                 VALUES (?, ?, ?, ?, 0)`,
                [eventId, userId, other.user_id, Math.round(distance)],
                function(err) {
                  if (!err) {
                    const matchId = this.lastID;
                    
                    // Send notifications to both users
                    db.get('SELECT title FROM events WHERE id = ?', [eventId], (err, event) => {
                      const eventTitle = event ? event.title : 'an event';
                      
                      // Notify user1 (current user)
                      const notification1 = {
                        type: 'crosspath_match',
                        content: `${other.username} is also attending ${eventTitle}`,
                        related_id: eventId,
                        created_by: other.user_id
                      };
                      
                      db.run(
                        `INSERT INTO notifications (user_id, type, content, related_id, created_by)
                         VALUES (?, ?, ?, ?, ?)`,
                        [userId, notification1.type, notification1.content, notification1.related_id, notification1.created_by],
                        function() {
                          // Emit real-time notification via Socket.IO
                          const io = req.app.get('io');
                          if (io) {
                            io.to(`user_${userId}`).emit('notification:receive', {
                              id: this.lastID,
                              ...notification1,
                              created_at: new Date().toISOString()
                            });
                          }
                        }
                      );

                      // Notify user2 (other user)
                      db.get('SELECT username FROM users WHERE id = ?', [userId], (err, currentUser) => {
                        if (currentUser) {
                          const notification2 = {
                            type: 'crosspath_match',
                            content: `${currentUser.username} is also attending ${eventTitle}`,
                            related_id: eventId,
                            created_by: userId
                          };
                          
                          db.run(
                            `INSERT INTO notifications (user_id, type, content, related_id, created_by)
                             VALUES (?, ?, ?, ?, ?)`,
                            [other.user_id, notification2.type, notification2.content, notification2.related_id, notification2.created_by],
                            function() {
                              // Emit real-time notification via Socket.IO
                              const io = req.app.get('io');
                              if (io) {
                                io.to(`user_${other.user_id}`).emit('notification:receive', {
                                  id: this.lastID,
                                  ...notification2,
                                  created_at: new Date().toISOString()
                                });
                              }
                            }
                          );
                        }
                      });

                      // Mark notification as sent
                      db.run(
                        'UPDATE crosspath_matches SET notification_sent = 1 WHERE id = ?',
                        [matchId]
                      );
                    });
                  }
                }
              );
            }
          }
        );
      }
    });
  });
}

// Calculate distance between two coordinates using Haversine formula (returns meters)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Get all events for user
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
        SELECT e.*,
          u.username as creator_username,
          CASE
            WHEN ea.status = 'accepted' THEN 'attending'
            WHEN ea.status IS NULL THEN NULL
            ELSE ea.status
          END as user_status,
          (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status = 'accepted') as attendee_count,
          (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status = 'accepted') as accepted_count,
          (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id) as total_invited,
          (SELECT COUNT(*) FROM event_ticket_types WHERE event_id = e.id AND is_active = 1) as ticket_type_count,
          (SELECT MIN(price_cents) FROM event_ticket_types WHERE event_id = e.id AND is_active = 1) as min_price_cents,
          (SELECT MAX(price_cents) FROM event_ticket_types WHERE event_id = e.id AND is_active = 1) as max_price_cents,
          (SELECT currency FROM event_ticket_types WHERE event_id = e.id AND is_active = 1 ORDER BY price_cents ASC, id ASC LIMIT 1) as ticket_currency
    FROM events e
    JOIN users u ON e.creator_id = u.id
    LEFT JOIN event_attendees ea ON e.id = ea.event_id AND ea.user_id = ?
    WHERE e.creator_id = ? OR ea.user_id = ?
    ORDER BY e.event_date ASC
  `;

  db.all(query, [userId, userId, userId], (err, events) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching events' });
    }
    res.json({ success: true, events });
  });
});

// Get available cities and categories for filters
router.get('/filters/options', authMiddleware, (req, res) => {
  const db = getDb();

  // Get distinct cities and categories from public upcoming events
  db.all(
    `SELECT DISTINCT 
       CASE WHEN city IS NOT NULL AND city != '' THEN city END as city
     FROM events 
     WHERE is_public = 1 AND datetime(event_date) >= datetime('now') AND city IS NOT NULL AND city != ''
     ORDER BY city ASC`,
    [],
    (err, cities) => {
      if (err) {
        return res.status(500).json({ error: 'Error fetching cities' });
      }

      db.all(
        `SELECT DISTINCT 
           CASE WHEN category IS NOT NULL AND category != '' THEN category END as category
         FROM events 
         WHERE is_public = 1 AND datetime(event_date) >= datetime('now') AND category IS NOT NULL AND category != ''
         ORDER BY category ASC`,
        [],
        (err2, categories) => {
          if (err2) {
            return res.status(500).json({ error: 'Error fetching categories' });
          }

          res.json({
            success: true,
            cities: cities.map(c => c.city).filter(Boolean),
            categories: categories.map(c => c.category).filter(Boolean)
          });
        }
      );
    }
  );
});

// Discover public events (experiences-style listing)
router.get('/discover', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { city, category, q } = req.query || {};

  const params = [userId];
  let where = `WHERE e.is_public = 1 AND datetime(e.event_date) >= datetime('now')`;

  if (city && String(city).trim()) {
    where += ` AND (LOWER(COALESCE(e.city,'')) = LOWER(?) OR LOWER(COALESCE(e.location,'')) LIKE LOWER(?))`;
    params.push(String(city).trim(), `%${String(city).trim()}%`);
  }

  if (category && String(category).trim()) {
    where += ` AND LOWER(COALESCE(e.category,'')) = LOWER(?)`;
    params.push(String(category).trim());
  }

  if (q && String(q).trim()) {
    where += ` AND (LOWER(e.title) LIKE LOWER(?) OR LOWER(COALESCE(e.description,'')) LIKE LOWER(?) OR LOWER(COALESCE(e.location,'')) LIKE LOWER(?))`;
    const term = `%${String(q).trim()}%`;
    params.push(term, term, term);
  }

  const query = `
    SELECT e.*,
           u.username as creator_username,
           u.profile_picture as creator_picture,
           ea.status as user_rsvp_status,
           (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status = 'accepted') as interested_count,
           (SELECT MIN(price_cents) FROM event_ticket_types WHERE event_id = e.id AND is_active = 1) as min_price_cents,
           (SELECT MAX(price_cents) FROM event_ticket_types WHERE event_id = e.id AND is_active = 1) as max_price_cents,
           (SELECT currency FROM event_ticket_types WHERE event_id = e.id AND is_active = 1 ORDER BY price_cents ASC, id ASC LIMIT 1) as ticket_currency
    FROM events e
    JOIN users u ON e.creator_id = u.id
    LEFT JOIN event_attendees ea ON e.id = ea.event_id AND ea.user_id = ?
    ${where}
    ORDER BY datetime(e.event_date) ASC, e.id DESC
  `;

  db.all(query, params, (err, events) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching discover events' });
    }
    res.json({ success: true, events });
  });
});

// Get gentle reminders
router.get('/reminders', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT gr.*, p.content as post_content
    FROM gentle_reminders gr
    JOIN posts p ON gr.post_id = p.id
    WHERE gr.user_id = ?
    ORDER BY gr.reminder_date ASC
  `;

  db.all(query, [userId], (err, reminders) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching reminders' });
    }
    res.json({ success: true, reminders });
  });
});

// Delete gentle reminder
router.delete('/reminders/:reminderId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { reminderId } = req.params;

  db.run(
    'DELETE FROM gentle_reminders WHERE id = ? AND user_id = ?',
    [reminderId, userId],
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

// Create event
router.post('/', authMiddleware, upload.single('cover_photo'), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const {
    title,
    description,
    event_date,
    location,
    notes,
    attendees,
    is_public = 1,
    city,
    category,
    cover_image,
    organizer_name,
    important_note,
    max_persons,
    pricing_type = 'free',
    fare_single,
    fare_couple,
    fare_group,
    fare_options
  } = req.body;

  // Use uploaded file path if available, otherwise use cover_image URL
  const finalCoverImage = req.file ? `/uploads/images/${req.file.filename}` : (cover_image || null);

  const query = `
    INSERT INTO events (
      creator_id, title, description, event_date,
      is_public, city, category,
      location, cover_image, organizer_name, important_note,
      notes, max_persons, pricing_type, fare_single, fare_couple, fare_group, fare_options
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    query,
    [
      userId,
      title,
      description,
      event_date,
      is_public ? 1 : 0,
      city || null,
      category || null,
      location,
      finalCoverImage,
      organizer_name || null,
      important_note || null,
      notes,
      max_persons || null,
      pricing_type || 'free',
      fare_single || null,
      fare_couple || null,
      fare_group || null,
      fare_options || null
    ],
    function(err) {
    if (err) {
      console.error('Error creating event:', err);
      return res.status(500).json({ error: 'Error creating event' });
    }

    const eventId = this.lastID;

    // Add attendees
    if (attendees && attendees.length > 0) {
      const stmt = db.prepare('INSERT INTO event_attendees (event_id, user_id, status) VALUES (?, ?, ?)');
      
      attendees.forEach(attendeeId => {
        stmt.run(eventId, attendeeId, 'pending');
        
        // Create notification
        db.run(
          'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
          [attendeeId, 'event_invite', `invited you to "${title}"`, eventId]
        );
      });
      
      stmt.finalize();
    }

    res.json({
      success: true,
      event: {
        id: eventId,
        title,
        description,
        event_date,
        is_public: is_public ? 1 : 0,
        city,
        category,
        location,
        cover_image,
        organizer_name,
        important_note,
        notes,
        creator_id: userId
      }
    });
  });
});

// RSVP to event (frontend uses POST to attend)
router.post('/:eventId/rsvp', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  const status = (req.body && req.body.status) ? req.body.status : 'accepted';
  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'Invalid RSVP status' });
  }

  db.run(
    `INSERT INTO event_attendees (event_id, user_id, status)
     VALUES (?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status`,
    [eventId, userId, status],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating RSVP' });
      }

      db.get('SELECT creator_id, title FROM events WHERE id = ?', [eventId], (err, event) => {
        if (event) {
          const notificationContent = status === 'accepted'
            ? `accepted your event invite for "${event.title}"`
            : `declined your event invite for "${event.title}"`;

          if (event.creator_id && event.creator_id !== userId) {
            db.run(
              'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
              [event.creator_id, 'event_rsvp', notificationContent, eventId]
            );
          }
        }
      });

      if (status === 'accepted') {
        checkCrosspath(eventId, userId);
      }

      res.json({ success: true });
    }
  );
});

// Cancel RSVP (frontend uses DELETE)
router.delete('/:eventId/rsvp', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  db.run(
    'DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?',
    [eventId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error cancelling RSVP' });
      }
      res.json({ success: true });
    }
  );
});

// Check for crosspath opportunities
function checkCrosspath(eventId, userId) {
  const db = getDb();

  // Find other users who accepted the same event
  const query = `
    SELECT user_id FROM event_attendees
    WHERE event_id = ? AND status = 'accepted' AND user_id != ?
  `;

  db.all(query, [eventId, userId], (err, attendees) => {
    if (err || !attendees.length) return;

    attendees.forEach(attendee => {
      // Create crosspath notification
      db.run(
        'INSERT INTO crosspath_events (event_id, user1_id, user2_id, status) VALUES (?, ?, ?, ?)',
        [eventId, userId, attendee.user_id, 'pending'],
        function(err) {
          if (!err) {
            // Notify the other user
            db.run(
              'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
              [attendee.user_id, 'crosspath', 'is also interested in the same event. Request a talk?', userId]
            );
          }
        }
      );
    });
  });
}

// =========================
// Ticketing / Passes (keep before /:eventId)
// =========================

// List current user's tickets/passes
router.get('/tickets/mine', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT t.*, 
           e.title as event_title,
           e.event_date as event_date,
           e.location as event_location,
           e.city as event_city,
           e.cover_image as event_cover_image,
           e.description as event_description,
           e.important_note as event_important_note,
           e.category as event_category,
           ett.name as ticket_type_name,
           eo.total_cents as ticket_price_cents,
           eo.currency as ticket_currency,
           eo.quantity as order_quantity
    FROM event_tickets t
    JOIN events e ON e.id = t.event_id
    LEFT JOIN event_ticket_types ett ON ett.id = t.ticket_type_id
    LEFT JOIN event_orders eo ON eo.id = t.order_id
    WHERE t.owner_id = ?
    ORDER BY datetime(e.event_date) ASC, t.created_at ASC
  `;

  db.all(query, [userId], (err, tickets) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching tickets' });
    }
    res.json({ success: true, tickets });
  });
});

// List ticket types for an event
router.get('/:eventId/tickets/types', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;

  db.all(
    `SELECT id, event_id, name, description, payment_mode, contact_text, price_cents, currency, quantity_total, quantity_sold,
            sales_start, sales_end, is_active, payment_methods
     FROM event_ticket_types
     WHERE event_id = ? AND is_active = 1
     ORDER BY price_cents ASC, id ASC`,
    [eventId],
    (err, types) => {
      if (err) {
        return res.status(500).json({ error: 'Error fetching ticket types' });
      }
      res.json({ success: true, types });
    }
  );
});

// Create ticket type (event creator only)
router.post('/:eventId/tickets/types', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    const {
      name,
      description,
      payment_mode,
      contact_text,
      price_cents = 0,
      currency = 'INR',
      quantity_total = null,
      sales_start = null,
      sales_end = null,
      payment_methods = ''
    } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: 'Ticket type name is required' });
    }

    const normalizedPrice = Number(price_cents) || 0;
    const normalizedQty = (quantity_total === null || quantity_total === undefined || quantity_total === '')
      ? null
      : Number(quantity_total);

    if (normalizedPrice < 0) {
      return res.status(400).json({ error: 'Invalid price' });
    }
    if (normalizedQty !== null && (!Number.isFinite(normalizedQty) || normalizedQty < 1)) {
      return res.status(400).json({ error: 'Invalid quantity_total' });
    }

    const allowedModes = ['free', 'venue', 'contact', 'dm', 'online', 'paid'];
    let mode = payment_mode || (normalizedPrice > 0 ? 'venue' : 'free');
    mode = String(mode).toLowerCase();
    if (!allowedModes.includes(mode)) {
      return res.status(400).json({ error: 'Invalid payment_mode' });
    }

    db.run(
      `INSERT INTO event_ticket_types
        (event_id, name, description, payment_mode, contact_text, price_cents, currency, quantity_total, sales_start, sales_end, payment_methods)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, name, description || '', mode, contact_text || '', normalizedPrice, currency, normalizedQty, sales_start, sales_end, payment_methods || ''],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error creating ticket type' });
        }
        res.json({ success: true, ticket_type_id: this.lastID });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error creating ticket type' });
  }
});

// Creator: list ticket types including inactive (management)
router.get('/:eventId/tickets/types/manage', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    db.all(
      `SELECT id, event_id, name, description, payment_mode, contact_text, price_cents, currency,
              quantity_total, quantity_sold, sales_start, sales_end, is_active, payment_methods, created_at, updated_at
       FROM event_ticket_types
       WHERE event_id = ?
       ORDER BY is_active DESC, price_cents ASC, id ASC`,
      [eventId],
      (err, types) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching ticket types' });
        }
        res.json({ success: true, types });
      }
    );
  } catch {
    res.status(500).json({ error: 'Error fetching ticket types' });
  }
});

// Creator: update ticket type
router.put('/:eventId/tickets/types/:typeId', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId, typeId } = req.params;
  const userId = req.user.userId;

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    const {
      name,
      description,
      payment_mode,
      contact_text,
      price_cents,
      currency,
      quantity_total,
      sales_start,
      sales_end,
      is_active,
      payment_methods
    } = req.body || {};

    const allowedModes = ['free', 'venue', 'contact', 'dm', 'online', 'paid'];
    let mode = payment_mode;
    if (mode !== undefined && mode !== null && mode !== '') {
      mode = String(mode).toLowerCase();
      if (!allowedModes.includes(mode)) {
        return res.status(400).json({ error: 'Invalid payment_mode' });
      }
    }

    const normalizedPrice = (price_cents === undefined || price_cents === null || price_cents === '')
      ? undefined
      : Number(price_cents);
    if (normalizedPrice !== undefined && (!Number.isFinite(normalizedPrice) || normalizedPrice < 0)) {
      return res.status(400).json({ error: 'Invalid price_cents' });
    }

    const normalizedQty = (quantity_total === undefined || quantity_total === null || quantity_total === '')
      ? undefined
      : Number(quantity_total);
    if (normalizedQty !== undefined && (!Number.isFinite(normalizedQty) || normalizedQty < 1)) {
      return res.status(400).json({ error: 'Invalid quantity_total' });
    }

    db.run(
      `UPDATE event_ticket_types
       SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         payment_mode = COALESCE(?, payment_mode),
         contact_text = COALESCE(?, contact_text),
         price_cents = COALESCE(?, price_cents),
         currency = COALESCE(?, currency),
         quantity_total = COALESCE(?, quantity_total),
         sales_start = COALESCE(?, sales_start),
         sales_end = COALESCE(?, sales_end),
         is_active = COALESCE(?, is_active),
         payment_methods = COALESCE(?, payment_methods),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND event_id = ?`,
      [
        name ?? null,
        description ?? null,
        mode ?? null,
        contact_text ?? null,
        normalizedPrice ?? null,
        currency ?? null,
        normalizedQty ?? null,
        sales_start ?? null,
        sales_end ?? null,
        (is_active === undefined || is_active === null) ? null : (is_active ? 1 : 0),
        payment_methods ?? null,
        typeId,
        eventId
      ],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error updating ticket type' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Ticket type not found' });
        }
        res.json({ success: true });
      }
    );
  } catch {
    res.status(500).json({ error: 'Error updating ticket type' });
  }
});

// Creator: deactivate ticket type (soft delete)
router.delete('/:eventId/tickets/types/:typeId', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId, typeId } = req.params;
  const userId = req.user.userId;

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    db.run(
      `UPDATE event_ticket_types
       SET is_active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND event_id = ?`,
      [typeId, eventId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error deactivating ticket type' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Ticket type not found' });
        }
        res.json({ success: true });
      }
    );
  } catch {
    res.status(500).json({ error: 'Error deactivating ticket type' });
  }
});

// Organizer: list orders for an event
router.get('/:eventId/orders', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;
  const { status } = req.query;

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    const where = status ? 'AND o.status = ?' : '';
    const params = status ? [eventId, status] : [eventId];

    db.all(
      `SELECT o.*, 
              u.username as buyer_username,
              u.profile_picture as buyer_picture,
              ett.name as ticket_type_name,
              ett.payment_mode as payment_mode
       FROM event_orders o
       JOIN users u ON u.id = o.buyer_id
       LEFT JOIN event_ticket_types ett ON ett.id = o.ticket_type_id
       WHERE o.event_id = ? ${where}
       ORDER BY datetime(o.created_at) DESC, o.id DESC`,
      params,
      (err, orders) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching orders' });
        }
        res.json({ success: true, orders });
      }
    );
  } catch {
    res.status(500).json({ error: 'Error fetching orders' });
  }
});

// Checkout: reserve/buy passes (free passes issue immediately; paid stays pending for now)
router.post('/:eventId/tickets/checkout', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const buyerId = req.user.userId;
  const { ticket_type_id, quantity = 1 } = req.body || {};

  const qty = Number(quantity);
  if (!ticket_type_id || !Number.isFinite(qty) || qty < 1 || qty > 10) {
    return res.status(400).json({ error: 'Invalid ticket_type_id or quantity' });
  }

  db.get(
    `SELECT ett.*, e.title as event_title
     FROM event_ticket_types ett
     JOIN events e ON e.id = ett.event_id
     WHERE ett.id = ? AND ett.event_id = ? AND ett.is_active = 1`,
    [ticket_type_id, eventId],
    (err, ticketType) => {
      if (err) return res.status(500).json({ error: 'Error preparing checkout' });
      if (!ticketType) return res.status(404).json({ error: 'Ticket type not found' });

      // Sales window check (best-effort; SQLite datetime strings)
      const nowIso = new Date().toISOString();
      if (ticketType.sales_start && String(ticketType.sales_start) > nowIso) {
        return res.status(400).json({ error: 'Ticket sales have not started yet' });
      }
      if (ticketType.sales_end && String(ticketType.sales_end) < nowIso) {
        return res.status(400).json({ error: 'Ticket sales have ended' });
      }

      const unitPrice = Number(ticketType.price_cents) || 0;
      const totalCents = unitPrice * qty;
      const currency = ticketType.currency || 'INR';
      const mode = String(ticketType.payment_mode || (unitPrice > 0 ? 'venue' : 'free')).toLowerCase();
      const isInstantIssue = (mode === 'free' && totalCents === 0);

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(
          `UPDATE event_ticket_types
           SET quantity_sold = quantity_sold + ?
           WHERE id = ?
             AND (quantity_total IS NULL OR quantity_sold + ? <= quantity_total)`,
          [qty, ticket_type_id, qty],
          function(updateErr) {
            if (updateErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Error reserving tickets' });
            }
            if (this.changes === 0) {
              db.run('ROLLBACK');
              return res.status(400).json({ error: 'Sold out' });
            }

            const orderStatus = isInstantIssue ? 'paid' : 'pending';

            db.run(
              `INSERT INTO event_orders (event_id, buyer_id, ticket_type_id, quantity, status, total_cents, currency, payment_provider)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [eventId, buyerId, ticket_type_id, qty, orderStatus, totalCents, currency, isInstantIssue ? 'free' : 'offline'],
              function(orderErr) {
                if (orderErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: 'Error creating order' });
                }

                const orderId = this.lastID;

                // Auto-RSVP user as interested when they place an order
                db.run(
                  `INSERT INTO event_attendees (event_id, user_id, status)
                   VALUES (?, ?, 'accepted')
                   ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'accepted'`,
                  [eventId, buyerId],
                  (rsvpErr) => {
                    if (rsvpErr) {
                      console.error('Auto-RSVP error:', rsvpErr);
                      // Continue anyway
                    }

                    if (!isInstantIssue) {
                      db.run('COMMIT');

                      // Offline payment flow: DM the organizer so they can coordinate payment and then confirm.
                      db.get(
                        'SELECT creator_id FROM events WHERE id = ?',
                        [eventId],
                        async (e2, eventRow) => {
                          const organizerId = eventRow?.creator_id;
                          if (organizerId) {
                            db.get('SELECT username FROM users WHERE id = ?', [buyerId], async (e3, buyerRow) => {
                              const buyerName = buyerRow?.username || `User ${buyerId}`;
                              const how = mode === 'contact' || mode === 'dm' ? 'Contact/DM' : 'Pay at venue';
                              const money = `${currency} ${(totalCents / 100).toFixed(2)}`;
                              const dm = `Pass request for "${ticketType.event_title}"
Type: ${ticketType.name}
Qty: ${qty}
Amount: ${money}
Payment: ${how}
Order ID: ${orderId}
Buyer: @${buyerName}

Reply to confirm payment, then mark order paid to issue QR passes.`;
                              await sendDirectMessage(req, db, buyerId, organizerId, dm);
                            });
                          }
                        }
                      );

                      return res.json({
                        success: true,
                        order: { id: orderId, status: orderStatus, total_cents: totalCents, currency },
                        message: 'Order created. The organizer has been notified via DM for offline payment and will send your pass QR after confirmation.'
                      });
                    }

                    // Issue tickets immediately for free orders
                    const issuedTickets = [];
                    const insertStmt = db.prepare(
                      `INSERT INTO event_tickets (order_id, event_id, ticket_type_id, owner_id, code, status)
                       VALUES (?, ?, ?, ?, ?, 'issued')`
                    );

                    let pending = qty;
                    for (let i = 0; i < qty; i++) {
                      const code = generateTicketCode();
                      issuedTickets.push({ code });
                      insertStmt.run([orderId, eventId, ticket_type_id, buyerId, code], (ticketErr) => {
                        pending--;
                        if (ticketErr) {
                          insertStmt.finalize();
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: 'Error issuing tickets' });
                        }
                        if (pending === 0) {
                          insertStmt.finalize();
                          db.run('COMMIT');
                          
                          // Send DM to buyer with pass details
                          const codes = issuedTickets.map(t => t.code).join('\n');
                          const passMsg = `🎉 Your pass has been issued!

Event: ${ticketType.event_title}
Ticket Type: ${ticketType.name}
Quantity: ${qty}
${qty > 1 ? 'Pass Codes:\n' + codes : 'Pass Code: ' + codes}

✅ View your pass with QR code:
Go to Events → Passes tab

💡 Show the QR code at the venue entry for check-in.`;
                          
                          sendDirectMessage(req, db, buyerId, buyerId, passMsg).catch(err => {
                            console.error('Failed to send pass DM:', err);
                          });
                          
                          return res.json({
                            success: true,
                            order: { id: orderId, status: orderStatus, total_cents: totalCents, currency },
                            tickets: issuedTickets
                          });
                        }
                      });
                    }
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});

// Organizer: mark a pending order as paid and issue tickets
router.post('/:eventId/orders/:orderId/mark-paid', authMiddleware, async (req, res) => {
  const db = getDb();
  const { eventId, orderId } = req.params;
  const userId = req.user.userId;

  try {
    const authz = await requireEventCreator(db, eventId, userId);
    if (!authz.ok) {
      return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
    }

    db.get(
      `SELECT * FROM event_orders WHERE id = ? AND event_id = ?`,
      [orderId, eventId],
      (err, order) => {
        if (err) return res.status(500).json({ error: 'Error fetching order' });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.status === 'paid') return res.json({ success: true, message: 'Already paid' });

        const issueQty = Math.max(1, Number(order.quantity) || 1);
        const typeId = order.ticket_type_id;
        if (!typeId) {
          return res.status(400).json({ error: 'Order missing ticket_type_id' });
        }

        db.get(
          `SELECT COUNT(*) as cnt FROM event_tickets WHERE order_id = ?`,
          [orderId],
          (err, row) => {
            if (err) return res.status(500).json({ error: 'Error issuing tickets' });
            if (row && row.cnt > 0) {
              db.run(
                `UPDATE event_orders SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [orderId],
                (e) => {
                  if (e) return res.status(500).json({ error: 'Error updating order' });
                  return res.json({ success: true });
                }
              );
              return;
            }

              db.serialize(() => {
              db.run('BEGIN TRANSACTION');

              const issued = [];
              const stmt = db.prepare(
                `INSERT INTO event_tickets (order_id, event_id, ticket_type_id, owner_id, code, status)
                 VALUES (?, ?, ?, ?, ?, 'issued')`
              );

              let pending = issueQty;
              for (let i = 0; i < issueQty; i++) {
                const code = generateTicketCode();
                issued.push({ code });
                stmt.run([orderId, eventId, typeId, order.buyer_id, code], (ticketErr) => {
                  pending--;
                  if (ticketErr) {
                    stmt.finalize();
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Error issuing tickets' });
                  }
                  if (pending === 0) {
                    stmt.finalize();
                    db.run(
                      `UPDATE event_orders SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                      [orderId],
                      async (orderErr) => {
                        if (orderErr) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: 'Error updating order' });
                        }
                        db.run('COMMIT');

                        // Get event and ticket type details for better DM
                        db.get(
                          `SELECT e.title as event_title, ett.name as ticket_type_name
                           FROM events e
                           LEFT JOIN event_ticket_types ett ON ett.id = ?
                           WHERE e.id = ?`,
                          [typeId, eventId],
                          async (detailErr, details) => {
                            const eventTitle = details?.event_title || `Event #${eventId}`;
                            const ticketName = details?.ticket_type_name || 'Pass';
                            const codes = issued.map(t => t.code).join('\n');
                            const passMsg = `🎉 Payment confirmed! Your pass has been issued.

Event: ${eventTitle}
Ticket Type: ${ticketName}
Quantity: ${issueQty}
${issueQty > 1 ? 'Pass Codes:\n' + codes : 'Pass Code: ' + codes}

✅ View your pass with QR code:
Go to Events → Passes tab

💡 Show the QR code at the venue entry for check-in.`;
                            await sendDirectMessage(req, db, userId, order.buyer_id, passMsg);
                          }
                        );

                        return res.json({ success: true, tickets: issued });
                      }
                    );
                  }
                });
              }
            });
          }
        );
      }
    );
  } catch {
    res.status(500).json({ error: 'Error marking paid' });
  }
});

// Organizer/Staff: check-in a ticket by code (supports both event creator and check-in staff auth)
router.post('/:eventId/tickets/check-in', async (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const { code } = req.body || {};

  if (!code || String(code).length < 8) {
    return res.status(400).json({ error: 'Invalid code' });
  }

  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Not authorized' });
    }

    const token = authHeader.substring(7);
    const jwt = require('jsonwebtoken');
    
    let userId = null;
    let staffId = null;
    let authType = null;
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      
      // Check if it's staff or user auth
      if (decoded.type === 'checkin_staff') {
        staffId = decoded.staffId;
        authType = 'staff';
        
        // Verify staff is for this event
        if (decoded.eventId !== Number(eventId)) {
          return res.status(403).json({ error: 'Not authorized for this event' });
        }
      } else if (decoded.userId) {
        userId = decoded.userId;
        authType = 'creator';
        
        // Verify user is event creator
        const authz = await requireEventCreator(db, eventId, userId);
        if (!authz.ok) {
          return res.status(authz.reason === 'not_found' ? 404 : 403).json({ error: 'Not authorized' });
        }
      } else {
        return res.status(401).json({ error: 'Invalid token' });
      }
    } catch (jwtErr) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // First, get ticket details before updating
    db.get(
      `SELECT t.*, u.username as attendee_name, ett.name as ticket_type_name
       FROM event_tickets t
       LEFT JOIN users u ON u.id = t.owner_id
       LEFT JOIN event_ticket_types ett ON ett.id = t.ticket_type_id
       WHERE t.event_id = ? AND t.code = ?`,
      [eventId, code],
      (err, ticket) => {
        if (err) return res.status(500).json({ error: 'Error checking in ticket' });
        
        if (!ticket) {
          return res.status(400).json({ error: 'Ticket not found or already used' });
        }
        
        if (ticket.status === 'checked_in') {
          return res.status(400).json({ 
            error: 'Ticket not found or already used',
            details: {
              status: 'already_checked_in',
              checked_in_at: ticket.checked_in_at,
              attendee: ticket.attendee_name
            }
          });
        }

        // Now update the ticket (use staffId or userId as checked_in_by)
        const checkedInBy = staffId || userId;
        db.run(
          `UPDATE event_tickets
           SET status = 'checked_in', checked_in_at = CURRENT_TIMESTAMP, checked_in_by = ?
           WHERE event_id = ? AND code = ? AND status = 'issued'`,
          [checkedInBy, eventId, code],
          function(updateErr) {
            if (updateErr) return res.status(500).json({ error: 'Error checking in ticket' });
            if (this.changes === 0) {
              return res.status(400).json({ error: 'Ticket not found or already used' });
            }
            
            res.json({ 
              success: true,
              ticket: {
                code: ticket.code,
                attendee: ticket.attendee_name || 'Guest',
                ticket_type: ticket.ticket_type_name || 'Pass',
                checked_in_at: new Date().toISOString()
              }
            });
          }
        );
      }
    );
  } catch {
    res.status(500).json({ error: 'Error checking in ticket' });
  }
});

// Get event details
router.get('/:eventId', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  const query = `
    SELECT e.*,
           u.username as creator_username,
           u.profile_picture as creator_picture,
           ea.status as user_rsvp_status,
           (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status = 'accepted') as interested_count,
           (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status = 'accepted') as attendee_count,
           (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id) as total_invited,
           (SELECT MIN(price_cents) FROM event_ticket_types WHERE event_id = e.id AND is_active = 1) as min_price_cents,
           (SELECT MAX(price_cents) FROM event_ticket_types WHERE event_id = e.id AND is_active = 1) as max_price_cents,
           (SELECT currency FROM event_ticket_types WHERE event_id = e.id AND is_active = 1 ORDER BY price_cents ASC, id ASC LIMIT 1) as ticket_currency
    FROM events e
    JOIN users u ON e.creator_id = u.id
    LEFT JOIN event_attendees ea ON e.id = ea.event_id AND ea.user_id = ?
    WHERE e.id = ?
  `;

  db.get(query, [userId, eventId], (err, event) => {
    if (err || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const attendeesQuery = `
      SELECT ea.*, u.username, u.profile_picture
      FROM event_attendees ea
      JOIN users u ON ea.user_id = u.id
      WHERE ea.event_id = ?
    `;

    db.all(attendeesQuery, [eventId], (err, attendees) => {
      if (err) {
        return res.status(500).json({ error: 'Error fetching attendees' });
      }

      res.json({
        success: true,
        event: {
          ...event,
          attendees
        }
      });
    });
  });
});

// Update event
router.put('/:eventId', authMiddleware, upload.single('cover_photo'), (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;
  const {
    title,
    description,
    event_date,
    location,
    notes,
    is_public,
    city,
    category,
    cover_image,
    organizer_name,
    important_note,
    max_persons,
    pricing_type,
    fare_single,
    fare_couple,
    fare_group,
    fare_options
  } = req.body;

  // Use uploaded file path if available, otherwise use cover_image URL or keep existing
  const finalCoverImage = req.file ? `/uploads/images/${req.file.filename}` : (cover_image || null);

  db.run(
    `UPDATE events 
     SET title = ?,
         description = ?,
         event_date = ?,
         is_public = COALESCE(?, is_public),
         city = COALESCE(?, city),
         category = COALESCE(?, category),
         location = ?,
         cover_image = COALESCE(?, cover_image),
         organizer_name = COALESCE(?, organizer_name),
         important_note = COALESCE(?, important_note),
         notes = ?,
         max_persons = ?,
         pricing_type = COALESCE(?, pricing_type),
         fare_single = ?,
         fare_couple = ?,
         fare_group = ?,
         fare_options = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND creator_id = ?`,
    [
      title,
      description,
      event_date,
      (is_public === undefined || is_public === null) ? null : (is_public ? 1 : 0),
      city ?? null,
      category ?? null,
      location,
      finalCoverImage,
      organizer_name ?? null,
      important_note ?? null,
      notes,
      max_persons || null,
      pricing_type ?? null,
      fare_single || null,
      fare_couple || null,
      fare_group || null,
      fare_options || null,
      eventId,
      userId
    ],
    function(err) {
      if (err) {
        console.error('Error updating event:', err);
        return res.status(500).json({ error: 'Error updating event' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Event not found or unauthorized' });
      }

      res.json({ success: true });
    }
  );
});

// Delete event
router.delete('/:eventId', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  db.run(
    'DELETE FROM events WHERE id = ? AND creator_id = ?',
    [eventId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting event' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Event not found or unauthorized' });
      }

      res.json({ success: true });
    }
  );
});

module.exports = router;
