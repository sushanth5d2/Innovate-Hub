const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getDb } = require('../config/database');

// Helper function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
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

// Check for users with proximity notifications enabled
function checkProximityNotifications(db, io, donationId, donationLat, donationLon, donationTitle) {
  const query = `
    SELECT ums.user_id, ums.proximity_distance, ums.user_latitude, ums.user_longitude, u.username
    FROM user_map_settings ums
    JOIN users u ON ums.user_id = u.id
    WHERE ums.proximity_notifications = 1
      AND ums.user_latitude IS NOT NULL
      AND ums.user_longitude IS NOT NULL
  `;

  db.all(query, [], (err, users) => {
    if (err || !users || users.length === 0) return;

    users.forEach(user => {
      const distance = calculateDistance(
        user.user_latitude,
        user.user_longitude,
        donationLat,
        donationLon
      );

      // If donation is within user's proximity distance, send notification
      if (distance <= user.proximity_distance) {
        const distanceKm = (distance / 1000).toFixed(1);
        const notificationContent = `New donation "${donationTitle}" is ${distanceKm}km away from you`;
        
        db.run(
          `INSERT INTO notifications (user_id, type, content, related_id)
           VALUES (?, ?, ?, ?)`,
          [user.user_id, 'nearby_donation', notificationContent, donationId],
          (err, result) => {
            if (err) {
              console.error('Error creating proximity notification:', err);
            } else if (io) {
              // Send real-time Socket.IO notification
              io.to(`user-${user.user_id}`).emit('notification:received', {
                id: this.lastID,
                type: 'nearby_donation',
                content: notificationContent,
                related_id: donationId,
                created_at: new Date().toISOString(),
                is_read: 0
              });
            }
          }
        );
      }
    });
  });
}

// Get stats
router.get('/stats', authMiddleware, (req, res) => {
  const db = getDb();
  
  db.get(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'available' OR status = 'assigned' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM donations
  `, [], (err, stats) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching stats' });
    }
    res.json({ success: true, stats });
  });
});

// Get all donations (donation tab)
router.get('/donations', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT d.*,
           u.username, u.profile_picture,
           da.user_id as picked_by,
           picker.username as picker_username,
           picker.id as picker_user_id,
           picker.profile_picture as picker_profile_picture
    FROM donations d
    JOIN users u ON d.user_id = u.id
    LEFT JOIN donation_assigns da ON d.id = da.donation_id
    LEFT JOIN users picker ON da.user_id = picker.id
    ORDER BY d.created_at DESC
  `;

  db.all(query, [], (err, donations) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching donations' });
    }
    res.json({ success: true, donations });
  });
});

// Get user's own donations
router.get('/my-donations', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT d.*,
           u.username, u.profile_picture,
           da.user_id as picked_by,
           picker.username as picker_username,
           picker.id as picker_user_id,
           picker.profile_picture as picker_profile_picture
    FROM donations d
    JOIN users u ON d.user_id = u.id
    LEFT JOIN donation_assigns da ON d.id = da.donation_id
    LEFT JOIN users picker ON da.user_id = picker.id
    WHERE d.user_id = ?
    ORDER BY d.created_at DESC
  `;

  db.all(query, [userId], (err, donations) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching your donations' });
    }
    res.json({ success: true, donations });
  });
});

// Get user's picked donations (picked tab)
router.get('/picked-donations', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  const query = `
    SELECT d.*,
           u.username, u.profile_picture,
           da.assigned_at, da.completed, da.completion_photos,
           da.user_id as picked_by
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
  const { title, description, address, latitude, longitude, category, city, phone } = req.body;

  // Process uploaded images
  const images = req.files.images ? req.files.images.map(file => file.path) : [];

  const query = `
    INSERT INTO donations (user_id, title, description, images, address, latitude, longitude, category, city, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [userId, title, description, JSON.stringify(images), address, latitude, longitude, category, city, phone], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error creating donation' });
    }

    const donationId = this.lastID;

    // Create notification for followers
    const notificationQuery = `
      INSERT INTO notifications (user_id, type, content, related_id)
      SELECT follower_id, 'donation', 'posted a new donation', ?
      FROM followers
      WHERE following_id = ?
    `;

    db.run(notificationQuery, [donationId, userId]);

    // Check for users with proximity notifications enabled
    if (latitude && longitude) {
      const io = req.app.get('io');
      checkProximityNotifications(db, io, donationId, parseFloat(latitude), parseFloat(longitude), title);
    }

    res.json({ success: true, donation_id: donationId });
  });
});

// Update donation
router.put('/donations/:id', authMiddleware, upload.fields([
  { name: 'images', maxCount: 5 }
]), (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const donationId = req.params.id;
  const { title, description, address, latitude, longitude, category, city, phone } = req.body;

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

    let query = 'UPDATE donations SET title = ?, description = ?, address = ?, latitude = ?, longitude = ?, category = ?, city = ?, phone = ?';
    let params = [title, description, address, latitude, longitude, category, city, phone];

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

// Assign donation to user (pick it up)
router.post('/donations/:id/pickup', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const donationId = req.params.id;

  // Check if donation exists and is available
  db.get('SELECT * FROM donations WHERE id = ?', [donationId], (err, donation) => {
    if (err || !donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    if (donation.user_id === userId) {
      return res.status(400).json({ error: 'You cannot pick up your own donation' });
    }

    if (donation.status !== 'available') {
      return res.status(400).json({ error: 'Donation already assigned' });
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
        db.run('UPDATE donations SET status = ? WHERE id = ?', ['assigned', donationId], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error updating donation status' });
          }

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
});

// Unassign from a donation
router.post('/donations/:id/unassign', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const donationId = req.params.id;

  // Check if donation exists and is assigned to the user
  db.get('SELECT * FROM donations WHERE id = ?', [donationId], (err, donation) => {
    if (err || !donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    if (donation.status !== 'assigned') {
      return res.status(400).json({ error: 'Donation is not currently assigned' });
    }

    // Check if user is assigned to this donation
    db.get('SELECT * FROM donation_assigns WHERE donation_id = ? AND user_id = ?', [donationId, userId], (err, assignment) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!assignment) {
        return res.status(400).json({ error: 'You are not assigned to this donation' });
      }

      // Delete the assignment
      db.run('DELETE FROM donation_assigns WHERE donation_id = ? AND user_id = ?', [donationId, userId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error removing assignment' });
        }

        // Update donation status back to available
        db.run('UPDATE donations SET status = ? WHERE id = ?', ['available', donationId], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error updating donation status' });
          }

          // Notify donation owner
          db.run(
            'INSERT INTO notifications (user_id, type, content, related_id, created_by) VALUES (?, ?, ?, ?, ?)',
            [donation.user_id, 'donation_unassigned', 'has unassigned from your donation', donationId, userId]
          );

          res.json({ success: true, message: 'Successfully unassigned from donation' });
        });
      });
    });
  });
});

// Old assign endpoint (kept for backwards compatibility)
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

  if (photos.length === 0) {
    return res.status(400).json({ error: 'At least one completion photo is required' });
  }

  // Check assignment exists
  db.get('SELECT * FROM donation_assigns WHERE donation_id = ? AND user_id = ?', [donationId, userId], (err, assignment) => {
    if (err || !assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Update assignment with photos
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
      db.run('UPDATE donations SET status = ?, completion_photos = ? WHERE id = ?', ['completed', JSON.stringify(photos), donationId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error updating donation' });
        }

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
  });
});

// Get donations for map view (only with location data)
router.get('/map-donations', authMiddleware, (req, res) => {
  const db = getDb();

  const query = `
    SELECT d.id, d.title, d.address, d.category, d.city, d.status, 
           d.latitude, d.longitude, d.user_id,
           u.username
    FROM donations d
    JOIN users u ON d.user_id = u.id
    LEFT JOIN user_map_settings ums ON d.user_id = ums.user_id
    WHERE d.latitude IS NOT NULL 
      AND d.longitude IS NOT NULL
      AND d.status IN ('available', 'assigned')
      AND (ums.show_on_map IS NULL OR ums.show_on_map = 1)
    ORDER BY d.created_at DESC
  `;

  db.all(query, [], (err, donations) => {
    if (err) {
      console.error('Map donations error:', err);
      return res.status(500).json({ error: 'Error fetching map donations' });
    }
    res.json({ success: true, donations });
  });
});

// Get user's map settings
router.get('/map-settings', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;

  db.get('SELECT * FROM user_map_settings WHERE user_id = ?', [userId], (err, settings) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching settings' });
    }
    
    // Return default settings if none exist
    if (!settings) {
      return res.json({ 
        success: true, 
        settings: {
          show_on_map: 1,
          proximity_notifications: 0,
          proximity_distance: 500
        }
      });
    }
    
    res.json({ success: true, settings });
  });
});

// Save user's map settings
router.post('/map-settings', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { show_on_map, proximity_notifications, proximity_distance, user_latitude, user_longitude } = req.body;

  // Check if settings exist
  db.get('SELECT * FROM user_map_settings WHERE user_id = ?', [userId], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: 'Error checking settings' });
    }

    if (existing) {
      // Update existing settings
      db.run(
        `UPDATE user_map_settings 
         SET show_on_map = ?, proximity_notifications = ?, proximity_distance = ?, 
             user_latitude = ?, user_longitude = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = ?`,
        [show_on_map ? 1 : 0, proximity_notifications ? 1 : 0, proximity_distance, user_latitude, user_longitude, userId],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error updating settings' });
          }
          res.json({ success: true });
        }
      );
    } else {
      // Insert new settings
      db.run(
        `INSERT INTO user_map_settings (user_id, show_on_map, proximity_notifications, proximity_distance, user_latitude, user_longitude) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, show_on_map ? 1 : 0, proximity_notifications ? 1 : 0, proximity_distance, user_latitude, user_longitude],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error creating settings' });
          }
          res.json({ success: true });
        }
      );
    }
  });
});

module.exports = router;
