const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { getDb } = require('../config/database');
const upload = require('../middleware/upload');

// Register
router.post('/register', upload.single('profile_picture'), async (req, res) => {
  try {
    const { username, email, password, fullname, date_of_birth } = req.body;
    const db = getDb();

    // Validation
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    db.get('SELECT * FROM users WHERE email = ? OR username = ?', [email, username], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }

      if (user) {
        if (user.email === email) {
          return res.status(400).json({ error: 'Email already registered' });
        }
        if (user.username === username) {
          return res.status(400).json({ error: 'Username already taken' });
        }
        return res.status(400).json({ error: 'User already exists' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Handle profile picture
      let profilePicture = null;
      if (req.file) {
        profilePicture = `/uploads/profiles/${req.file.filename}`;
      }

      // Create user with all fields
      const query = `
        INSERT INTO users (username, email, password, fullname, profile_picture, date_of_birth) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        username, 
        email, 
        hashedPassword, 
        fullname || '', 
        profilePicture, 
        date_of_birth || null
      ];

      db.run(query, params, function(err) {
        if (err) {
          console.error('Database error:', err);
          if (err.message.includes('UNIQUE constraint failed: users.email')) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          if (err.message.includes('UNIQUE constraint failed: users.username')) {
            return res.status(400).json({ error: 'Username already taken' });
          }
          return res.status(500).json({ error: 'Error creating user' });
        }

        const userId = this.lastID;

        // Create JWT token
        const token = jwt.sign(
          { userId, username },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );

        res.json({
          success: true,
          token,
          user: {
            id: userId,
            username,
            email,
            profile_picture: profilePicture
          }
        });
        }
      );
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().withMessage('Please enter a valid email'),
  body('password').exists().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const db = getDb();

    // Find user
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }

      if (!user) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      // Check password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      // Block admin account from regular login — must use /admin-login
      if (user.is_admin) {
        return res.status(403).json({ error: 'Admin account must use the admin login portal' });
      }

      // Check if user is banned
      if (user.is_banned) {
        if (user.banned_until) {
          const banEnd = new Date(user.banned_until);
          if (banEnd > new Date()) {
            return res.status(403).json({ 
              error: `Your account is temporarily suspended until ${banEnd.toLocaleDateString()}. Reason: ${user.ban_reason || 'Policy violation'}` 
            });
          }
          // Temp ban expired — unban
          db.run('UPDATE users SET is_banned = 0, banned_until = NULL, ban_reason = NULL WHERE id = ?', [user.id]);
        } else {
          return res.status(403).json({ 
            error: `Your account has been permanently suspended. Reason: ${user.ban_reason || 'Policy violation'}` 
          });
        }
      }

      // If account was deactivated, reactivate on login
      if (user.is_deactivated) {
        db.run('UPDATE users SET is_deactivated = 0, deactivated_at = NULL WHERE id = ?', [user.id]);
      }

      // Update online status
      db.run('UPDATE users SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

      // Create JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username, isAdmin: !!user.is_admin },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          bio: user.bio,
          profile_picture: user.profile_picture,
          is_admin: !!user.is_admin
        }
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin Login - validates against .env credentials, auto-creates system admin user in DB
router.post('/admin-login', [
  body('email').exists().withMessage('Email is required'),
  body('password').exists().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Validate against .env credentials
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminUsername = process.env.ADMIN_USERNAME || 'Admin';

    if (!adminEmail || !adminPassword) {
      return res.status(500).json({ error: 'Admin account not configured on server' });
    }

    if (email !== adminEmail || password !== adminPassword) {
      return res.status(400).json({ error: 'Invalid admin credentials' });
    }

    // Find or create the system admin user in DB (needed for posts, profile, etc.)
    const db = getDb();
    db.get('SELECT * FROM users WHERE email = ? AND is_admin = ?', [adminEmail, 1], async (err, user) => {
      if (err) return res.status(500).json({ error: 'Server error' });

      if (!user) {
        // Auto-create system admin user
        const hash = await bcrypt.hash(adminPassword, 12);
        db.run(
          'INSERT INTO users (username, email, password, is_admin, is_online) VALUES (?, ?, ?, ?, ?)',
          [adminUsername, adminEmail, hash, 1, 1],
          function(insertErr) {
            if (insertErr) {
              // Maybe email exists but not admin — update it
              db.get('SELECT * FROM users WHERE email = ?', [adminEmail], async (e2, existingUser) => {
                if (e2 || !existingUser) return res.status(500).json({ error: 'Failed to initialize admin account' });
                db.run('UPDATE users SET is_admin = ?, username = ? WHERE id = ?', [1, adminUsername, existingUser.id], (e3) => {
                  if (e3) return res.status(500).json({ error: 'Failed to initialize admin account' });
                  issueAdminTokens(existingUser.id, existingUser.username, existingUser.email, existingUser.profile_picture, res);
                });
              });
              return;
            }
            const newId = this.lastID;
            issueAdminTokens(newId, adminUsername, adminEmail, null, res);
          }
        );
      } else {
        db.run('UPDATE users SET is_online = 1 WHERE id = ?', [user.id]);
        issueAdminTokens(user.id, user.username, user.email, user.profile_picture, res);
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

function issueAdminTokens(userId, username, email, profilePic, res) {
  const adminToken = jwt.sign(
    { userId, username, isAdmin: true },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
  const userToken = jwt.sign(
    { userId, username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    success: true,
    token: adminToken,
    userToken,
    user: {
      id: userId,
      username,
      email,
      profile_picture: profilePic || null,
      is_admin: true
    }
  });
}

// Logout
router.post('/logout', (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const db = getDb();
      db.run('UPDATE users SET is_online = 0, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [decoded.userId]);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.json({ success: true, message: 'Logged out' });
  }
});

// Forgot Password (Mock)
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Please enter a valid email')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email } = req.body;
  const db = getDb();

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Server error' });
    }

    // Always return success for security (don't reveal if email exists)
    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    });
  });
});

module.exports = router;
