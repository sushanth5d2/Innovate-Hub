/**
 * Portfolio Routes - Manage portfolio projects
 * Users can add/edit/delete projects shown on their portfolio page
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getDb } = require('../config/database');

/**
 * GET /api/portfolio/:userId/projects
 * Get all portfolio projects for a user
 */
router.get('/:userId/projects', authMiddleware, (req, res) => {
  const db = getDb();
  const { userId } = req.params;

  db.all(
    `SELECT * FROM portfolio_projects WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching portfolio projects:', err);
        return res.status(500).json({ error: 'Failed to fetch projects' });
      }
      res.json({ projects: rows || [] });
    }
  );
});

/**
 * POST /api/portfolio/projects
 * Add a new portfolio project
 */
router.post('/projects', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { name, description, technologies, url, thumbnail } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  db.run(
    `INSERT INTO portfolio_projects (user_id, name, description, technologies, url, thumbnail, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM portfolio_projects WHERE user_id = ?), CURRENT_TIMESTAMP)`,
    [userId, name.trim(), description || '', technologies || '', url || '', thumbnail || '', userId],
    function(err) {
      if (err) {
        console.error('Error creating portfolio project:', err);
        return res.status(500).json({ error: 'Failed to create project' });
      }
      res.json({
        success: true,
        project: {
          id: this.lastID,
          user_id: userId,
          name: name.trim(),
          description: description || '',
          technologies: technologies || '',
          url: url || '',
          thumbnail: thumbnail || ''
        }
      });
    }
  );
});

/**
 * PUT /api/portfolio/projects/:projectId
 * Update a portfolio project
 */
router.put('/projects/:projectId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { projectId } = req.params;
  const { name, description, technologies, url, thumbnail } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  // Verify ownership
  db.get('SELECT id FROM portfolio_projects WHERE id = ? AND user_id = ?', [projectId, userId], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: 'Project not found or not authorized' });
    }

    db.run(
      `UPDATE portfolio_projects SET name = ?, description = ?, technologies = ?, url = ?, thumbnail = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [name.trim(), description || '', technologies || '', url || '', thumbnail || '', projectId, userId],
      (err) => {
        if (err) {
          console.error('Error updating portfolio project:', err);
          return res.status(500).json({ error: 'Failed to update project' });
        }
        res.json({ success: true });
      }
    );
  });
});

/**
 * DELETE /api/portfolio/projects/:projectId
 * Delete a portfolio project
 */
router.delete('/projects/:projectId', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { projectId } = req.params;

  db.run(
    'DELETE FROM portfolio_projects WHERE id = ? AND user_id = ?',
    [projectId, userId],
    function(err) {
      if (err) {
        console.error('Error deleting portfolio project:', err);
        return res.status(500).json({ error: 'Failed to delete project' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Project not found or not authorized' });
      }
      res.json({ success: true });
    }
  );
});

/**
 * PUT /api/portfolio/projects/reorder
 * Reorder portfolio projects
 */
router.put('/projects/reorder', authMiddleware, (req, res) => {
  const db = getDb();
  const userId = req.user.userId;
  const { projectIds } = req.body;

  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    return res.status(400).json({ error: 'Invalid project order' });
  }

  const stmt = db.prepare('UPDATE portfolio_projects SET sort_order = ? WHERE id = ? AND user_id = ?');
  let errors = 0;

  projectIds.forEach((id, index) => {
    stmt.run(index + 1, id, userId, (err) => {
      if (err) errors++;
    });
  });

  stmt.finalize((err) => {
    if (err || errors > 0) {
      return res.status(500).json({ error: 'Failed to reorder projects' });
    }
    res.json({ success: true });
  });
});

module.exports = router;
