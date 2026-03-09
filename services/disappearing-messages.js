/**
 * Shared Disappearing Messages Service
 * Handles disappearing message logic for both DM and group conversations.
 * WhatsApp-style: only messages sent AFTER the setting is enabled are affected.
 */

const { getDb } = require('../config/database');

/**
 * Save disappearing setting for a DM conversation (shared between both users).
 */
function saveDMSetting(userId, contactId, mode, duration, io, callback) {
  const db = getDb();
  const dur = duration || 0;

  db.run(
    `INSERT INTO disappearing_settings (user_id, contact_id, mode, duration, updated_at) 
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, contact_id) DO UPDATE SET mode=?, duration=?, updated_at=CURRENT_TIMESTAMP`,
    [userId, contactId, mode, dur, mode, dur],
    function(err) {
      if (err) return callback(err);
      // Mirror to other user so setting is shared
      db.run(
        `INSERT INTO disappearing_settings (user_id, contact_id, mode, duration, updated_at) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, contact_id) DO UPDATE SET mode=?, duration=?, updated_at=CURRENT_TIMESTAMP`,
        [contactId, userId, mode, dur, mode, dur],
        function(err2) {
          if (err2) console.error('Error syncing disappearing setting for other user:', err2);
          // Notify the other user via socket
          if (io) {
            io.to(`user-${contactId}`).emit('disappearing:updated', { contactId: userId, mode, duration: dur });
          }
          callback(null);
        }
      );
    }
  );
}

/**
 * Get disappearing setting for a DM conversation (shared).
 */
function getDMSetting(userId, contactId, callback) {
  const db = getDb();
  db.get(
    `SELECT mode, duration, updated_at FROM disappearing_settings 
     WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?) 
     ORDER BY updated_at DESC LIMIT 1`,
    [userId, contactId, contactId, userId],
    (err, row) => {
      if (err) return callback(err);
      callback(null, row || { mode: 'off', duration: 0, updated_at: null });
    }
  );
}

/**
 * Save disappearing setting for a group (shared for all members).
 */
function saveGroupSetting(groupId, userId, mode, duration, callback) {
  const db = getDb();
  const dur = duration || 0;

  db.run(
    `INSERT INTO group_disappearing_settings (group_id, set_by, mode, duration, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(group_id) DO UPDATE SET mode=?, duration=?, set_by=?, updated_at=CURRENT_TIMESTAMP`,
    [groupId, userId, mode, dur, mode, dur, userId],
    function(err) {
      if (err) return callback(err);
      callback(null);
    }
  );
}

/**
 * Get disappearing setting for a group.
 */
function getGroupSetting(groupId, callback) {
  const db = getDb();
  db.get(
    'SELECT mode, duration, updated_at FROM group_disappearing_settings WHERE group_id = ?',
    [groupId],
    (err, row) => {
      if (err) return callback(err);
      callback(null, row || { mode: 'off', duration: 0, updated_at: null });
    }
  );
}

/**
 * Compute expires_at for a new message based on active timer setting.
 * Only applies if the setting mode is 'timer' and duration > 0.
 * @returns {string|null} ISO timestamp or null
 */
function computeTimerExpiry(setting) {
  if (setting && setting.mode === 'timer' && setting.duration > 0) {
    return new Date(Date.now() + setting.duration * 1000).toISOString();
  }
  return null;
}

/**
 * Handle DM leave-chat (disappear-on-exit).
 * Only soft-deletes messages sent AFTER the setting was enabled.
 */
function handleDMLeave(userId, contactId, callback) {
  const db = getDb();

  getDMSetting(userId, contactId, (err, setting) => {
    if (err || !setting || setting.mode !== 'on_read') {
      return callback(null, 0);
    }

    const enabledAt = setting.updated_at;

    // Messages sent BY this user after setting was enabled: mark is_deleted_by_sender
    db.run(
      `UPDATE messages SET is_deleted_by_sender = 1 
       WHERE sender_id = ? AND receiver_id = ? AND is_read = 1 
       AND created_at >= ?`,
      [userId, contactId, enabledAt],
      function(err1) {
        if (err1) console.error('Error soft-deleting sent messages:', err1);
        const sentDeleted = this.changes || 0;
        // Messages received BY this user after setting was enabled: mark is_deleted_by_receiver
        db.run(
          `UPDATE messages SET is_deleted_by_receiver = 1 
           WHERE sender_id = ? AND receiver_id = ? AND is_read = 1 
           AND created_at >= ?`,
          [contactId, userId, enabledAt],
          function(err2) {
            if (err2) console.error('Error soft-deleting received messages:', err2);
            callback(null, sentDeleted + (this.changes || 0));
          }
        );
      }
    );
  });
}

/**
 * Handle group leave-chat (disappear-on-exit).
 * Only soft-deletes messages sent AFTER the setting was enabled.
 */
function handleGroupLeave(userId, groupId, callback) {
  const db = getDb();

  getGroupSetting(groupId, (err, setting) => {
    if (err || !setting || setting.mode !== 'on_read') {
      return callback(null, 0);
    }

    const enabledAt = setting.updated_at;

    // Soft-delete by inserting into deleted_group_messages for this user only
    // Only messages created after the setting was enabled
    db.run(
      `INSERT INTO deleted_group_messages (user_id, message_id, deleted_at)
       SELECT ?, id, CURRENT_TIMESTAMP FROM group_messages 
       WHERE group_id = ? AND is_read = 1 AND created_at >= ?
       AND id NOT IN (SELECT message_id FROM deleted_group_messages WHERE user_id = ?)`,
      [userId, groupId, enabledAt, userId],
      function(err2) {
        if (err2) console.error('Error soft-deleting group messages:', err2);
        callback(null, this.changes || 0);
      }
    );
  });
}

module.exports = {
  saveDMSetting,
  getDMSetting,
  saveGroupSetting,
  getGroupSetting,
  computeTimerExpiry,
  handleDMLeave,
  handleGroupLeave
};
