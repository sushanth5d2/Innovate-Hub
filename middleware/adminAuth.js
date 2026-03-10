const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');

const adminMiddleware = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '') || req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'No authentication token, access denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // Verify admin status from database (not just token)
    const db = getDb();
    db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.userId], (err, user) => {
      if (err || !user) {
        return res.status(500).json({ error: 'Server error' });
      }
      if (!user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      req.user.isAdmin = true;
      next();
    });
  } catch (error) {
    res.status(401).json({ error: 'Token is not valid' });
  }
};

module.exports = adminMiddleware;
