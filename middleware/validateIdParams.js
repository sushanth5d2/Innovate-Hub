// Middleware to validate that URL params expected to be integer IDs are actually numeric.
// Usage: require and call attachTo(router) to auto-validate all ID-like params.

const ID_PARAMS = [
  'id', 'contactId', 'messageId', 'postId', 'commentId', 'userId',
  'communityId', 'groupId', 'eventId', 'noteId', 'todoId', 'taskId',
  'storyId', 'pollId', 'announcementId', 'reactionType', 'reminderId',
  'orderId', 'typeId', 'staffId', 'crosspathId', 'reportId',
  'notificationId', 'projectId', 'senderId', 'targetUserId', 'callId'
];

function attachTo(router) {
  for (const paramName of ID_PARAMS) {
    router.param(paramName, (req, res, next, value) => {
      if (!/^\d+$/.test(value)) {
        return res.status(400).json({ error: `Invalid ${paramName}` });
      }
      next();
    });
  }
}

module.exports = { attachTo };
