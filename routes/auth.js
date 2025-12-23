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
        profilePicture = `/uploads/images/${req.file.filename}`;
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

      // Update online status
      db.run('UPDATE users SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

      // Create JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username },
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
          profile_picture: user.profile_picture
        }
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

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
