const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');

// Get all events for user
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT e.*,
           u.username as creator_username,
           ea.status as user_status,
           (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status = 'accepted') as accepted_count,
           (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id) as total_invited
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

// Create event
router.post('/', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { title, description, event_date, location, notes, attendees } = req.body;

  const query = `
    INSERT INTO events (creator_id, title, description, event_date, location, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [userId, title, description, event_date, location, notes], function(err) {
    if (err) {
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
        location,
        notes,
        creator_id: userId
      }
    });
  });
});

// Get event details
router.get('/:eventId', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;

  const query = `
    SELECT e.*,
           u.username as creator_username,
           u.profile_picture as creator_picture
    FROM events e
    JOIN users u ON e.creator_id = u.id
    WHERE e.id = ?
  `;

  db.get(query, [eventId], (err, event) => {
    if (err || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get attendees
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

// RSVP to event
router.post('/:eventId/rsvp', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;
  const { status } = req.body; // 'accepted' or 'declined'

  db.run(
    'UPDATE event_attendees SET status = ? WHERE event_id = ? AND user_id = ?',
    [status, eventId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating RSVP' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Invitation not found' });
      }

      // Notify event creator
      db.get('SELECT creator_id, title FROM events WHERE id = ?', [eventId], (err, event) => {
        if (event) {
          const notificationContent = status === 'accepted' 
            ? `accepted your event invite for "${event.title}"`
            : `declined your event invite for "${event.title}"`;

          db.run(
            'INSERT INTO notifications (user_id, type, content, related_id) VALUES (?, ?, ?, ?)',
            [event.creator_id, 'event_rsvp', notificationContent, eventId]
          );
        }
      });

      // Check for crosspath opportunities if accepted
      if (status === 'accepted') {
        checkCrosspath(eventId, userId);
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

// Get crosspath requests
router.get('/crosspath/requests', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT ce.*,
           e.title as event_title,
           u.username, u.profile_picture
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

// Accept/decline crosspath
router.post('/crosspath/:crosspathId/respond', authMiddleware, (req, res) => {
  const db = getDb();
  const { crosspathId } = req.params;
  const userId = req.user.userId;
  const { status } = req.body; // 'accepted' or 'declined'

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

      // If accepted, notify the requester
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
});

// Update event
router.put('/:eventId', authMiddleware, (req, res) => {
  const db = getDb();
  const { eventId } = req.params;
  const userId = req.user.userId;
  const { title, description, event_date, location, notes } = req.body;

  db.run(
    `UPDATE events 
     SET title = ?, description = ?, event_date = ?, location = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND creator_id = ?`,
    [title, description, event_date, location, notes, eventId, userId],
    function(err) {
      if (err) {
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
