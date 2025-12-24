const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// Get all donations (donation tab)
router.get('/donations', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT d.*,
           u.username, u.profile_picture,
           (SELECT COUNT(*) FROM donation_assigns WHERE donation_id = d.id) as assign_count
    FROM donations d
    JOIN users u ON d.user_id = u.id
    WHERE d.status = 'available'
    ORDER BY d.created_at DESC
  `;

  db.all(query, [], (err, donations) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching donations' });
    }
    res.json({ success: true, donations });
  });
});

// Get user's picked donations (picked tab)
router.get('/picked', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT d.*,
           u.username as donor_username, u.profile_picture as donor_picture,
           da.assigned_at, da.completed, da.completion_photos
    FROM donations d
    JOIN users u ON d.user_id = u.id
    JOIN donation_assigns da ON d.id = da.donation_id
    WHERE da.user_id = ?
    ORDER BY da.assigned_at DESC
  `;

  db.all(query, [userId], (err, donations) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching picked donations' });
    }
    res.json({ success: true, donations });
  });
});

// Create donation
router.post('/donations', authMiddleware, upload.fields([
  { name: 'images', maxCount: 5 }
]), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { title, description, address, latitude, longitude } = req.body;

  // Process uploaded images
  const images = req.files.images ? req.files.images.map(file => file.path) : [];

  const query = `
    INSERT INTO donations (user_id, title, description, images, address, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [userId, title, description, JSON.stringify(images), address, latitude, longitude], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error creating donation' });
    }

    // Create notification for followers
    const notificationQuery = `
      INSERT INTO notifications (user_id, type, content, related_id)
      SELECT follower_id, 'donation', 'posted a new donation', ?
      FROM followers
      WHERE following_id = ?
    `;

    db.run(notificationQuery, [this.lastID, userId]);

    res.json({ success: true, donation_id: this.lastID });
  });
});

// Update donation
router.put('/donations/:id', authMiddleware, upload.fields([
  { name: 'images', maxCount: 5 }
]), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const donationId = req.params.id;
  const { title, description, address, latitude, longitude } = req.body;

  // Check if user owns this donation
  db.get('SELECT user_id FROM donations WHERE id = ?', [donationId], (err, donation) => {
    if (err || !donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    if (donation.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Process uploaded images if any
    let images = null;
    if (req.files && req.files.images) {
      images = JSON.stringify(req.files.images.map(file => file.path));
    }

    let query = 'UPDATE donations SET title = ?, description = ?, address = ?, latitude = ?, longitude = ?';
    let params = [title, description, address, latitude, longitude];

    if (images) {
      query += ', images = ?';
      params.push(images);
    }

    query += ' WHERE id = ?';
    params.push(donationId);

    db.run(query, params, function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error updating donation' });
      }
      res.json({ success: true });
    });
  });
});

// Delete donation
router.delete('/donations/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const donationId = req.params.id;

  // Check if user owns this donation
  db.get('SELECT user_id FROM donations WHERE id = ?', [donationId], (err, donation) => {
    if (err || !donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    if (donation.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    db.run('DELETE FROM donations WHERE id = ?', [donationId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting donation' });
      }
      res.json({ success: true });
    });
  });
});

// Assign donation to user (pick it)
router.post('/donations/:id/assign', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const donationId = req.params.id;

  // Check if donation exists and is available
  db.get('SELECT * FROM donations WHERE id = ? AND status = ?', [donationId, 'available'], (err, donation) => {
    if (err || !donation) {
      return res.status(404).json({ error: 'Donation not found or already assigned' });
    }

    // Check if user already assigned to this donation
    db.get('SELECT * FROM donation_assigns WHERE donation_id = ? AND user_id = ?', [donationId, userId], (err, existing) => {
      if (existing) {
        return res.status(400).json({ error: 'Already assigned to this donation' });
      }

      // Create assignment
      db.run('INSERT INTO donation_assigns (donation_id, user_id) VALUES (?, ?)', [donationId, userId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error assigning donation' });
        }

        // Update donation status to assigned
        db.run('UPDATE donations SET status = ? WHERE id = ?', ['assigned', donationId]);

        // Notify donation owner
        db.run(
          'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
          [donation.user_id, 'donation_assigned', 'has been assigned to pick up your donation', donationId, userId]
        );

        res.json({ success: true, assignment_id: this.lastID });
      });
    });
  });
});

// Unassign donation
router.delete('/donations/:id/assign', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const donationId = req.params.id;

  db.run('DELETE FROM donation_assigns WHERE donation_id = ? AND user_id = ?', [donationId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error unassigning donation' });
    }

    // Update donation status back to available
    db.run('UPDATE donations SET status = ? WHERE id = ?', ['available', donationId]);

    res.json({ success: true });
  });
});

// Upload completion photos
router.post('/donations/:id/complete', authMiddleware, upload.fields([
  { name: 'completion_photos', maxCount: 5 }
]), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const donationId = req.params.id;

  // Process uploaded photos
  const photos = req.files.completion_photos ? req.files.completion_photos.map(file => file.path) : [];

  const query = `
    UPDATE donation_assigns
    SET completed = 1, completion_photos = ?
    WHERE donation_id = ? AND user_id = ?
  `;

  db.run(query, [JSON.stringify(photos), donationId, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error uploading completion photos' });
    }

    // Update donation status to completed
    db.run('UPDATE donations SET status = ? WHERE id = ?', ['completed', donationId]);

    // Notify donation owner
    db.get('SELECT user_id FROM donations WHERE id = ?', [donationId], (err, donation) => {
      if (donation) {
        db.run(
          'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
          [donation.user_id, 'donation_completed', 'has completed the donation pickup and uploaded photos', donationId, userId]
        );
      }
    });

    res.json({ success: true });
  });
});

module.exports = router;
