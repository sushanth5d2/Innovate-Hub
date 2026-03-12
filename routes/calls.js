const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const callService = require('../services/call-service');

// Get DM call history between current user and a contact
router.get('/dm/:contactId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const contactId = parseInt(req.params.contactId);
    const history = await callService.getDMCallHistory(userId, contactId);
    res.json(history);
  } catch (err) {
    console.error('Error fetching DM call history:', err);
    res.status(500).json({ error: 'Failed to fetch call history' });
  }
});

// Get group call history
router.get('/group/:groupId', authMiddleware, async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId);
    const history = await callService.getGroupCallHistory(groupId);
    res.json(history);
  } catch (err) {
    console.error('Error fetching group call history:', err);
    res.status(500).json({ error: 'Failed to fetch call history' });
  }
});

// Get a specific call by ID
router.get('/:callId', authMiddleware, async (req, res) => {
  try {
    const call = await callService.getCall(parseInt(req.params.callId));
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
  } catch (err) {
    console.error('Error fetching call:', err);
    res.status(500).json({ error: 'Failed to fetch call' });
  }
});

// Log call start — called by frontend when initiating a call
router.post('/log-start', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { callType, targetId, isVideo } = req.body;
    if (!callType || !targetId) return res.status(400).json({ error: 'Missing callType or targetId' });

    const callId = await callService.createCall({
      callerId: userId,
      callType,
      targetId: parseInt(targetId),
      isVideo: !!isVideo
    });

    // Add caller as first participant
    await callService.addParticipant(callId, userId);

    res.json({ callId });
  } catch (err) {
    console.error('Error logging call start:', err);
    res.status(500).json({ error: 'Failed to log call' });
  }
});

// Log call answer
router.post('/answer', authMiddleware, async (req, res) => {
  try {
    const { callId } = req.body;
    if (!callId) return res.status(400).json({ error: 'Missing callId' });
    await callService.answerCall(parseInt(callId));
    await callService.addParticipant(parseInt(callId), req.user.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Error logging call answer:', err);
    res.status(500).json({ error: 'Failed to log call answer' });
  }
});

// Log call end — creates system message in chat
router.post('/log-end', authMiddleware, async (req, res) => {
  try {
    const { callId, status, duration } = req.body;
    if (!callId) return res.status(400).json({ error: 'Missing callId' });

    const call = await callService.getCall(parseInt(callId));
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const finalStatus = status || 'completed';
    await callService.endCall(parseInt(callId), finalStatus, parseInt(duration) || 0);

    // Build call data for system message
    const callMsg = {
      callId: call.id,
      is_video: call.is_video,
      status: finalStatus,
      duration: duration || 0,
      caller_id: call.caller_id
    };

    // Insert system message into chat
    if (call.call_type === 'dm') {
      await callService.insertDMCallMessage(call.caller_id, call.target_id, callMsg);
    } else if (call.call_type === 'group') {
      await callService.insertGroupCallMessage(call.target_id, call.caller_id, callMsg);
    }

    // Emit real-time notification so the chat UI updates
    const io = req.app.get('io');
    if (io) {
      if (call.call_type === 'dm') {
        io.to(`user_${call.target_id}`).emit('call:system-message', callMsg);
        io.to(`user-${call.target_id}`).emit('call:system-message', callMsg);
        io.to(`user_${call.caller_id}`).emit('call:system-message', callMsg);
        io.to(`user-${call.caller_id}`).emit('call:system-message', callMsg);
      } else {
        io.to(`group_${call.target_id}`).emit('call:system-message', callMsg);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error logging call end:', err);
    res.status(500).json({ error: 'Failed to log call end' });
  }
});

module.exports = router;
