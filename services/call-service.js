/**
 * Shared Call Service
 * Handles call history logging and system message creation for both DM and group calls.
 * Used by routes/calls.js and server.js socket handlers.
 */

const { getDb } = require('../config/database');

/**
 * Log a new call to call_history.
 * @param {Object} params
 * @param {number} params.callerId - User who initiated the call
 * @param {string} params.callType - 'dm' or 'group'
 * @param {number} params.targetId - contact_id (for dm) or group_id (for group)
 * @param {boolean} params.isVideo - Whether it's a video call
 * @returns {Promise<number>} The new call_history row id
 */
function createCall({ callerId, callType, targetId, isVideo }) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO call_history (caller_id, call_type, target_id, is_video, status, started_at)
       VALUES (?, ?, ?, ?, 'initiated', CURRENT_TIMESTAMP)`,
      [callerId, callType, targetId, isVideo ? 1 : 0],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

/**
 * Mark a call as answered (connected).
 */
function answerCall(callId) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE call_history SET status = 'connected', answered_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [callId],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

/**
 * End a call - set ended_at, duration, and final status.
 * @param {number} callId
 * @param {string} status - 'completed', 'missed', 'declined', 'no_answer'
 */
function endCall(callId, status = 'completed') {
  const db = getDb();
  return new Promise((resolve, reject) => {
    // First update the status and ended_at
    db.run(
      `UPDATE call_history SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, callId],
      (err) => {
        if (err) return reject(err);
        // Then calculate duration from the updated row
        db.run(
          `UPDATE call_history SET duration = CASE
             WHEN answered_at IS NOT NULL
             THEN CAST(EXTRACT(EPOCH FROM (ended_at - answered_at)) AS INTEGER)
             ELSE 0
           END WHERE id = ?`,
          [callId],
          (err2) => (err2 ? reject(err2) : resolve())
        );
      }
    );
  });
}

/**
 * Add a participant to a group call.
 */
function addParticipant(callId, userId) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO call_participants (call_id, user_id, joined_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [callId, userId],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

/**
 * Mark a participant as having left.
 */
function removeParticipant(callId, userId) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE call_participants SET left_at = CURRENT_TIMESTAMP WHERE call_id = ? AND user_id = ? AND left_at IS NULL`,
      [callId, userId],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

/**
 * Get a call by ID.
 */
function getCall(callId) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM call_history WHERE id = ?`, [callId], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

/**
 * Get call history for a DM conversation (between two users).
 */
function getDMCallHistory(userId, contactId, limit = 50) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT ch.*, u.username as caller_username, u.profile_picture as caller_picture
       FROM call_history ch
       JOIN users u ON u.id = ch.caller_id
       WHERE ch.call_type = 'dm'
         AND ((ch.caller_id = ? AND ch.target_id = ?) OR (ch.caller_id = ? AND ch.target_id = ?))
       ORDER BY ch.started_at DESC
       LIMIT ?`,
      [userId, contactId, contactId, userId, limit],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

/**
 * Get call history for a group.
 */
function getGroupCallHistory(groupId, limit = 50) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT ch.*, u.username as caller_username, u.profile_picture as caller_picture
       FROM call_history ch
       JOIN users u ON u.id = ch.caller_id
       WHERE ch.call_type = 'group' AND ch.target_id = ?
       ORDER BY ch.started_at DESC
       LIMIT ?`,
      [groupId, limit],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

/**
 * Insert a system message into DM messages for call events.
 * Stored as type='call' with JSON content describing the call.
 */
function insertDMCallMessage(senderId, receiverId, callData) {
  const db = getDb();
  const content = JSON.stringify(callData);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO messages (sender_id, receiver_id, content, type, created_at) VALUES (?, ?, ?, 'call', CURRENT_TIMESTAMP)`,
      [senderId, receiverId, content],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

/**
 * Insert a system message into group_messages for call events.
 */
function insertGroupCallMessage(groupId, senderId, callData) {
  const db = getDb();
  const content = JSON.stringify(callData);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO group_messages (group_id, sender_id, content, type, created_at) VALUES (?, ?, ?, 'call', CURRENT_TIMESTAMP)`,
      [groupId, senderId, content],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

module.exports = {
  createCall,
  answerCall,
  endCall,
  addParticipant,
  removeParticipant,
  getCall,
  getDMCallHistory,
  getGroupCallHistory,
  insertDMCallMessage,
  insertGroupCallMessage,
};
