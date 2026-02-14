/**
 * Community Enhancements: Reactions, Comments, Message Actions, Polls
 * This file contains all the UI functions for enhanced community features
 */

// ==================== REACTION SYSTEM ====================

const REACTIONS = [
  { type: 'like', emoji: '👍', label: 'Like' },
  { type: 'love', emoji: '❤️', label: 'Love' },
  { type: 'care', emoji: '🤗', label: 'Care' },
  { type: 'haha', emoji: '😂', label: 'Haha' },
  { type: 'wow', emoji: '😮', label: 'Wow' },
  { type: 'sad', emoji: '😢', label: 'Sad' },
  { type: 'angry', emoji: '😡', label: 'Angry' }
];

function showReactionPicker(targetId, targetType, event) {
  event.stopPropagation();
  
  // Remove any existing picker
  const existing = document.getElementById('reactionPicker');
  if (existing) existing.remove();
  
  const picker = document.createElement('div');
  picker.id = 'reactionPicker';
  picker.style.cssText = `
    position: fixed;
    bottom: ${window.innerHeight - event.clientY + 10}px;
    left: ${event.clientX - 180}px;
    background: var(--ig-primary-background);
    border: 1px solid var(--ig-border);
    border-radius: 30px;
    padding: 8px 12px;
    display: flex;
    gap: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    z-index: 10000;
    animation: slideUpFade 0.2s ease-out;
  `;
  
  REACTIONS.forEach(reaction => {
    const btn = document.createElement('button');
    btn.textContent = reaction.emoji;
    btn.title = reaction.label;
    btn.style.cssText = `
      background: none;
      border: none;
      font-size: 32px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 50%;
      transition: all 0.2s;
    `;
    btn.onmouseover = () => {
      btn.style.transform = 'scale(1.3)';
      btn.style.background = 'var(--ig-hover)';
    };
    btn.onmouseout = () => {
      btn.style.transform = 'scale(1)';
      btn.style.background = 'none';
    };
    btn.onclick = () => {
      addReaction(targetId, targetType, reaction.type);
      picker.remove();
    };
    picker.appendChild(btn);
  });
  
  document.body.appendChild(picker);
  
  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closePicker(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', closePicker);
      }
    });
  }, 10);
}

async function addReaction(targetId, targetType, reactionType) {
  try {
    const state = window.state || {};
    if (targetType === 'announcement') {
      if (!state.communityId) {
        InnovateAPI.showAlert('Community not loaded', 'error');
        return;
      }
      const res = await InnovateAPI.apiRequest(`/communities/${state.communityId}/announcements/${targetId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ reaction_type: reactionType })
      });
      if (res && res.success) {
        loadAnnouncementReactions(targetId);
      } else {
        throw new Error(res?.error || 'Failed to add reaction');
      }
    } else if (targetType === 'message') {
      if (!state.currentGroupId) {
        InnovateAPI.showAlert('Group not loaded', 'error');
        return;
      }
      const res = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/posts/${targetId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ reaction_type: reactionType })
      });
      if (res && res.success) {
        loadMessageReactions(targetId);
      } else {
        throw new Error(res?.error || 'Failed to add reaction');
      }
    }
  } catch (error) {
    console.error('Error adding reaction:', error);
    InnovateAPI.showAlert(error.message || 'Failed to add reaction', 'error');
  }
}

async function removeReaction(targetId, targetType, reactionType) {
  try {
    const state = window.state || {};
    if (targetType === 'announcement') {
      await InnovateAPI.apiRequest(`/communities/${state.communityId}/announcements/${targetId}/reactions/${reactionType}`, {
        method: 'DELETE'
      });
      loadAnnouncementReactions(targetId);
    } else if (targetType === 'message') {
      await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/posts/${targetId}/reactions/${reactionType}`, {
        method: 'DELETE'
      });
      loadMessageReactions(targetId);
    }
  } catch (error) {
    console.error('Error removing reaction:', error);
  }
}

async function loadAnnouncementReactions(announcementId) {
  try {
    const state = window.state || {};
    const res = await InnovateAPI.apiRequest(`/communities/${state.communityId}/announcements/${announcementId}/reactions`);
    displayReactions(announcementId, 'announcement', res.reactions, res.userReaction);
  } catch (error) {
    console.error('Error loading reactions:', error);
  }
}

async function loadMessageReactions(messageId) {
  try {
    const state = window.state || {};
    const res = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/posts/${messageId}/reactions`);
    displayReactions(messageId, 'message', res.reactions, res.userReaction);
  } catch (error) {
    console.error('Error loading reactions:', error);
  }
}

function displayReactions(targetId, targetType, reactions, userReaction) {
  const container = document.getElementById(`reactions-${targetType}-${targetId}`);
  if (!container) return;
  
  if (!reactions || Object.keys(reactions).length === 0) {
    container.innerHTML = '';
    return;
  }
  
  const reactionBubbles = Object.entries(reactions).map(([type, data]) => {
    const reaction = REACTIONS.find(r => r.type === type);
    const isUserReaction = userReaction === type;
    
    return `
      <button onclick="toggleReaction(${targetId}, '${targetType}', '${type}')" 
        style="
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 12px;
          border: 1px solid ${isUserReaction ? 'var(--ig-blue)' : 'var(--ig-border)'};
          background: ${isUserReaction ? 'rgba(0, 149, 246, 0.1)' : 'var(--ig-secondary-background)'};
          color: ${isUserReaction ? 'var(--ig-blue)' : 'var(--ig-primary-text)'};
          font-size: 14px;
          font-weight: ${isUserReaction ? '600' : '400'};
          cursor: pointer;
          transition: all 0.2s;
        "
        onmouseover="this.style.transform='scale(1.05)'"
        onmouseout="this.style.transform='scale(1)'"
        title="${data.users.map(u => u.username).join(', ')}">
        <span style="font-size: 16px;">${reaction ? reaction.emoji : ''}</span>
        <span>${data.count}</span>
      </button>
    `;
  }).join('');
  
  container.innerHTML = reactionBubbles;
}

function toggleReaction(targetId, targetType, reactionType) {
  const container = document.getElementById(`reactions-${targetType}-${targetId}`);
  if (!container) return;
  
  const btn = container.querySelector(`button[onclick*="'${reactionType}'"]`);
  const isActive = btn && btn.style.borderColor.includes('0, 149, 246');
  
  if (isActive) {
    removeReaction(targetId, targetType, reactionType);
  } else {
    addReaction(targetId, targetType, reactionType);
  }
}

// ==================== COMMENT SYSTEM ====================

async function showCommentSection(announcementId) {
  const container = document.getElementById(`comments-${announcementId}`);
  if (!container) return;
  
  try {
    const state = window.state || {};
    const res = await InnovateAPI.apiRequest(`/communities/${state.communityId}/announcements/${announcementId}/comments`);
    const comments = res.comments || [];
    
    container.innerHTML = `
      <div style="border-top: 1px solid var(--ig-border); padding-top: 16px; margin-top: 16px;">
        <div style="font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <i class="far fa-comment"></i> Comments (${comments.length})
        </div>
        
        ${comments.length > 0 ? `
          <div style="margin-bottom: 16px; max-height: 400px; overflow-y: auto;">
            ${comments.map(comment => `
              <div class="comment-item" style="display: flex; gap: 12px; padding: 12px; background: var(--ig-secondary-background); border-radius: 8px; margin-bottom: 8px;">
                <img src="${InnovateAPI.getUserAvatar(comment.profile_picture)}" 
                  style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;">
                    <div>
                      <span style="font-weight: 600; font-size: 14px;">${comment.username}</span>
                      <span style="color: var(--ig-secondary-text); font-size: 12px; margin-left: 8px;">
                        ${InnovateAPI.formatDate(comment.created_at)}
                      </span>
                    </div>
                    ${canDeleteComment(comment) ? `
                      <button onclick="deleteComment(${announcementId}, ${comment.id})" 
                        style="background: none; border: none; color: var(--ig-error); cursor: pointer; padding: 4px 8px; font-size: 12px;"
                        title="Delete comment">
                        <i class="fas fa-trash"></i>
                      </button>
                    ` : ''}
                  </div>
                  <p style="margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${(comment.content || '').replace(/@(\w[\w.]*)/g, '<a href="/profile/$1" class="mention-link" onclick="event.stopPropagation();" style="color: #00d4ff; font-weight: 600; text-decoration: none; cursor: pointer;">@$1</a>')}</p>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        <div style="display: flex; gap: 12px;">
          <img src="${InnovateAPI.getUserAvatar(InnovateAPI.getCurrentUser()?.profile_picture)}" 
            style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">
          <div style="flex: 1;">
            <textarea id="commentInput-${announcementId}" 
              placeholder="Write a comment..." 
              style="width: 100%; padding: 10px 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text); resize: none; font-family: inherit; font-size: 14px;"
              rows="2"></textarea>
            <button onclick="addComment(${announcementId})" 
              style="margin-top: 8px; padding: 8px 16px; background: var(--ig-blue); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
              Post Comment
            </button>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading comments:', error);
  }
}

function canDeleteComment(comment) {
  const currentUser = InnovateAPI.getCurrentUser();
  if (!currentUser) return false;
  
  // User can delete their own comments
  if (comment.user_id === currentUser.id) return true;
  
  // Admin/moderator can delete any comment
  if (window.state.userRole === 'admin' || window.state.userRole === 'moderator') return true;
  
  return false;
}

async function addComment(announcementId) {
  const input = document.getElementById(`commentInput-${announcementId}`);
  if (!input || !input.value.trim()) return;
  
  try {
    const state = window.state || {};
    await InnovateAPI.apiRequest(`/communities/${state.communityId}/announcements/${announcementId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content: input.value.trim() })
    });
    
    input.value = '';
    showCommentSection(announcementId);
    InnovateAPI.showAlert('Comment added', 'success');
  } catch (error) {
    console.error('Error adding comment:', error);
    InnovateAPI.showAlert('Failed to add comment', 'error');
  }
}

async function deleteComment(announcementId, commentId) {
  if (!confirm('Delete this comment?')) return;
  
  try {
    const state = window.state || {};
    await InnovateAPI.apiRequest(`/communities/${state.communityId}/announcements/${announcementId}/comments/${commentId}`, {
      method: 'DELETE'
    });
    
    showCommentSection(announcementId);
    InnovateAPI.showAlert('Comment deleted', 'success');
  } catch (error) {
    console.error('Error deleting comment:', error);
    InnovateAPI.showAlert('Failed to delete comment', 'error');
  }
}

// ==================== MESSAGE ACTIONS ====================

function showMessageMenu(postId, isOwner, isAdmin, event) {
  event.stopPropagation();
  
  // Remove any existing menu
  const existing = document.getElementById('messageMenu');
  if (existing) existing.remove();
  
  const menu = document.createElement('div');
  menu.id = 'messageMenu';
  menu.style.cssText = `
    position: fixed;
    bottom: ${window.innerHeight - event.clientY}px;
    left: ${event.clientX - 200}px;
    background: var(--ig-primary-background);
    border: 1px solid var(--ig-border);
    border-radius: 12px;
    padding: 8px;
    min-width: 200px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    z-index: 10000;
    animation: slideUpFade 0.2s ease-out;
  `;
  
  const actions = [];
  
  if (isOwner) {
    actions.push({
      icon: 'fa-edit',
      label: 'Edit Message',
      color: 'var(--ig-blue)',
      onClick: () => editMessage(postId)
    });
  }
  
  actions.push({
    icon: 'fa-reply',
    label: 'Reply',
    color: 'var(--ig-primary-text)',
    onClick: () => replyToMessage(postId)
  });
  
  // Check if message is currently pinned
  const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
  const isPinned = messageEl?.dataset.pinned === 'true';
  
  actions.push({
    icon: 'fa-thumbtack',
    label: isPinned ? 'Unpin Message' : 'Pin Message',
    color: 'var(--ig-primary-text)',
    onClick: () => isPinned ? unpinMessage(postId) : showPinTimerModal(postId)
  });
  
  actions.push({
    icon: 'fa-share',
    label: 'Forward',
    color: 'var(--ig-primary-text)',
    onClick: () => forwardMessage(postId)
  });
  
  if (isOwner || isAdmin) {
    actions.push({
      icon: 'fa-trash',
      label: 'Delete Message',
      color: 'var(--ig-error)',
      onClick: () => deleteMessage(postId)
    });
  }
  
  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.innerHTML = `
      <i class="fas ${action.icon}" style="width: 20px; color: ${action.color};"></i>
      <span>${action.label}</span>
    `;
    btn.style.cssText = `
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: none;
      border: none;
      border-radius: 8px;
      color: var(--ig-primary-text);
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
      text-align: left;
    `;
    btn.onmouseover = () => btn.style.background = 'var(--ig-hover)';
    btn.onmouseout = () => btn.style.background = 'none';
    btn.onclick = () => {
      action.onClick();
      menu.remove();
    };
    menu.appendChild(btn);
  });
  
  document.body.appendChild(menu);
  
  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 10);
}

async function editMessage(postId) {
  // Get current message content
  const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
  if (!messageEl) return;
  
  const currentContent = messageEl.querySelector('.message-content')?.textContent || '';
  const hasText = currentContent && currentContent.trim() !== '';
  const hasAttachments = messageEl.querySelector('img[src*="/uploads/"], video, audio, a[href*="/uploads/"]');
  
  // If message has only attachments (no text), show attachment replacement UI
  if (!hasText && hasAttachments) {
    const modal = document.createElement('div');
    modal.className = 'ig-modal-overlay';
    modal.innerHTML = `
      <div class="ig-modal" style="max-width: 600px;">
        <div style="padding: 24px; border-bottom: 1px solid var(--ig-border);">
          <h3 style="margin: 0; font-size: 20px;">Replace Attachment</h3>
        </div>
        <div style="padding: 24px;">
          <p style="margin: 0 0 16px 0; color: var(--ig-secondary-text); font-size: 14px;">
            Select a new file to replace the current attachment. The old attachment will be removed.
          </p>
          <input type="file" id="editAttachmentFile" 
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.xls,.xlsx"
            style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text); font-family: inherit; font-size: 14px;">
          <div id="attachmentPreview" style="margin-top: 12px;"></div>
          <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
            <button onclick="this.closest('.ig-modal-overlay').remove()" 
              style="padding: 10px 20px; border: 1px solid var(--ig-border); border-radius: 8px; background: transparent; color: var(--ig-primary-text); cursor: pointer;">
              Cancel
            </button>
            <button onclick="saveEditedAttachment(${postId})" 
              style="padding: 10px 20px; border: none; border-radius: 8px; background: var(--ig-blue); color: white; cursor: pointer; font-weight: 600;">
              Replace Attachment
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Add file preview
    document.getElementById('editAttachmentFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      const preview = document.getElementById('attachmentPreview');
      preview.innerHTML = '';
      if (file) {
        if (file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          img.style.maxWidth = '200px';
          img.style.borderRadius = '8px';
          preview.appendChild(img);
        } else {
          preview.innerHTML = `<div style="padding: 10px; background: var(--ig-secondary-background); border-radius: 6px;">📎 ${file.name}</div>`;
        }
      }
    });
    return;
  }
  
  // Otherwise, show text editing UI
  const modal = document.createElement('div');
  modal.className = 'ig-modal-overlay';
  modal.innerHTML = `
    <div class="ig-modal" style="max-width: 600px;">
      <div style="padding: 24px; border-bottom: 1px solid var(--ig-border);">
        <h3 style="margin: 0; font-size: 20px;">Edit Message</h3>
      </div>
      <div style="padding: 24px;">
        <textarea id="editMessageContent" rows="6" 
          style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text); font-family: inherit; font-size: 14px; resize: vertical;">${currentContent}</textarea>
        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
          <button onclick="this.closest('.ig-modal-overlay').remove()" 
            style="padding: 10px 20px; border: 1px solid var(--ig-border); border-radius: 8px; background: transparent; color: var(--ig-primary-text); cursor: pointer;">
            Cancel
          </button>
          <button onclick="saveEditedMessage(${postId})" 
            style="padding: 10px 20px; border: none; border-radius: 8px; background: var(--ig-blue); color: white; cursor: pointer; font-weight: 600;">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveEditedMessage(postId) {
  const content = document.getElementById('editMessageContent')?.value?.trim();
  if (!content) {
    InnovateAPI.showAlert('Content cannot be empty', 'error');
    return;
  }
  
  try {
    const state = window.state || {};
    if (!state.currentGroupId) {
      InnovateAPI.showAlert('Group ID not found', 'error');
      return;
    }
    
    const response = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content })
    });
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to update message');
    }
    
    document.querySelector('.ig-modal-overlay')?.remove();
    InnovateAPI.showAlert('Message updated', 'success');
    
    // Reload chat to show updated message with preserved attachments
    if (window.loadChatView) {
      await window.loadChatView(state.currentGroupId);
    }
  } catch (error) {
    console.error('Error editing message:', error);
    InnovateAPI.showAlert('Failed to update message', 'error');
  }
}

async function saveEditedAttachment(postId) {
  const fileInput = document.getElementById('editAttachmentFile');
  const file = fileInput?.files?.[0];
  
  if (!file) {
    InnovateAPI.showAlert('Please select a file', 'error');
    return;
  }
  
  try {
    const state = window.state || {};
    if (!state.currentGroupId) {
      InnovateAPI.showAlert('Group ID not found', 'error');
      return;
    }
    
    // Create FormData with new attachment
    const formData = new FormData();
    formData.append('attachments', file);
    
    const response = await fetch(`/api/community-groups/${state.currentGroupId}/posts/${postId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${InnovateAPI.getToken()}`
      },
      body: formData
    });
    
    const result = await response.json();
    
    if (!result || !result.success) {
      throw new Error(result?.error || 'Failed to update attachment');
    }
    
    document.querySelector('.ig-modal-overlay')?.remove();
    InnovateAPI.showAlert('Attachment replaced successfully', 'success');
    
    // Reload chat to show updated attachment
    if (window.loadChatView) {
      await window.loadChatView(state.currentGroupId);
    }
  } catch (error) {
    console.error('Error replacing attachment:', error);
    InnovateAPI.showAlert('Failed to replace attachment', 'error');
  }
}

async function deleteMessage(postId) {
  if (!confirm('Delete this message? This cannot be undone.')) return;
  
  try {
    const state = window.state || {};
    if (!state.currentGroupId) {
      InnovateAPI.showAlert('Group ID not found', 'error');
      return;
    }
    
    const response = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/posts/${postId}`, {
      method: 'DELETE'
    });
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to delete message');
    }
    
    // Update message in UI
    const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
    if (messageEl) {
      const contentEl = messageEl.querySelector('.message-content');
      if (contentEl) {
        contentEl.textContent = '[Message deleted]';
        contentEl.style.fontStyle = 'italic';
        contentEl.style.color = 'var(--ig-secondary-text)';
      }
      
      // Remove actions
      const actionsEl = messageEl.querySelector('.message-actions');
      if (actionsEl) {
        actionsEl.remove();
      }
    }
    
    InnovateAPI.showAlert('Message deleted', 'success');
  } catch (error) {
    console.error('Error deleting message:', error);
    InnovateAPI.showAlert('Failed to delete message', 'error');
  }
}

function replyToMessage(postId) {
  window.replyingTo = postId;
  const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
  if (!messageEl) return;
  
  let content = messageEl.querySelector('.message-content')?.textContent || '';
  const author = messageEl.getAttribute('data-author') || messageEl.querySelector('.message-author')?.textContent || 'Unknown';
  
  // Decrypt content if it looks encrypted
  const state = window.state || {};
  if (content && state.currentGroupId && typeof E2EEncryption !== 'undefined') {
    const decrypted = E2EEncryption.decrypt(content, state.currentGroupId);
    if (decrypted !== content) {
      content = decrypted;
    }
  }
  
  // Show reply preview
  const footer = document.getElementById('centerFooter');
  if (footer) {
    let replyPreview = document.getElementById('replyPreview');
    if (!replyPreview) {
      replyPreview = document.createElement('div');
      replyPreview.id = 'replyPreview';
      replyPreview.style.cssText = 'width: 100%; order: -1;'; // Place before other elements
      footer.insertBefore(replyPreview, footer.firstChild);
    }
    
    replyPreview.innerHTML = `
      <div style="padding: 12px; background: var(--ig-secondary-background); border-left: 3px solid var(--ig-blue); border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: start;">
        <div style="flex: 1;">
          <div style="font-size: 12px; color: var(--ig-blue); font-weight: 600; margin-bottom: 4px;">
            Replying to ${author}
          </div>
          <div style="font-size: 13px; color: var(--ig-secondary-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}
          </div>
        </div>
        <button onclick="cancelReply()" 
          style="background: none; border: none; color: var(--ig-secondary-text); cursor: pointer; padding: 4px 8px; font-size: 16px;">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
    
    // Focus input
    const input = footer.querySelector('#chatInput');
    if (input) input.focus();
  }
}

function cancelReply() {
  window.replyingTo = null;
  const replyPreview = document.getElementById('replyPreview');
  if (replyPreview) {
    replyPreview.remove();
  }
  // Also handle replyIndicator in community view
  const replyIndicator = document.getElementById('replyIndicator');
  if (replyIndicator) {
    replyIndicator.style.display = 'none';
    replyIndicator.innerHTML = '';
  }
}

async function forwardMessage(postId) {
  const state = window.state || {};
  
  try {
    // Get available groups
    const groupsRes = await InnovateAPI.apiRequest(`/communities/${state.communityId}/groups`);
    const groups = groupsRes.groups || [];
    
    if (groups.length === 0) {
      InnovateAPI.showAlert('No groups available to forward to', 'error');
      return;
    }
    
    // Get message content
    const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
    const content = messageEl?.querySelector('.message-content')?.textContent || '';
    
    // Show forward modal
    const modal = document.createElement('div');
    modal.className = 'ig-modal-overlay';
    modal.innerHTML = `
      <div class="ig-modal" style="max-width: 500px;">
        <div style="padding: 24px; border-bottom: 1px solid var(--ig-border);">
          <h3 style="margin: 0; font-size: 20px;">Forward Message</h3>
        </div>
        <div style="padding: 24px;">
          <p style="margin: 0 0 16px 0; color: var(--ig-secondary-text); font-size: 14px;">
            Select a group to forward this message to:
          </p>
          <div style="max-height: 300px; overflow-y: auto; margin-bottom: 16px;">
            ${groups.map(g => `
              <label style="display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='var(--ig-hover)'" onmouseout="this.style.background='transparent'">
                <input type="radio" name="forwardGroup" value="${g.id}" style="width: 18px; height: 18px; cursor: pointer;">
                <span style="font-weight: 500;">${g.name}</span>
              </label>
            `).join('')}
          </div>
          <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button onclick="this.closest('.ig-modal-overlay').remove()" 
              style="padding: 10px 20px; border: 1px solid var(--ig-border); border-radius: 8px; background: transparent; color: var(--ig-primary-text); cursor: pointer;">
              Cancel
            </button>
            <button onclick="confirmForward(${postId})" 
              style="padding: 10px 20px; border: none; border-radius: 8px; background: var(--ig-blue); color: white; cursor: pointer; font-weight: 600;">
              Forward
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } catch (error) {
    console.error('Error loading groups for forward:', error);
    InnovateAPI.showAlert('Failed to load groups', 'error');
  }
}

async function confirmForward(postId) {
  const selectedGroup = document.querySelector('input[name="forwardGroup"]:checked');
  if (!selectedGroup) {
    InnovateAPI.showAlert('Please select a group', 'error');
    return;
  }
  
  const targetGroupId = selectedGroup.value;
  const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
  const content = messageEl?.querySelector('.message-content')?.textContent || '';
  
  try {
    // Send message to target group
    const response = await InnovateAPI.apiRequest(`/community-groups/${targetGroupId}/posts`, {
      method: 'POST',
      body: JSON.stringify({ content: `[Forwarded] ${content}` })
    });
    
    if (response.success) {
      document.querySelector('.ig-modal-overlay')?.remove();
      InnovateAPI.showAlert('Message forwarded successfully', 'success');
    } else {
      throw new Error('Forward failed');
    }
  } catch (error) {
    console.error('Error forwarding message:', error);
    InnovateAPI.showAlert('Failed to forward message', 'error');
  }
}

// ==================== PIN MESSAGE WITH TIMER ====================

function showPinTimerModal(postId, isPoll = false) {
  const itemType = isPoll ? 'Poll' : 'Message';
  const modal = document.createElement('div');
  modal.className = 'ig-modal-overlay';
  modal.innerHTML = `
    <div class="ig-modal" style="max-width: 400px;">
      <div style="padding: 24px; border-bottom: 1px solid var(--ig-border);">
        <h3 style="margin: 0; font-size: 20px; display: flex; align-items: center; gap: 8px;">
          <i class="fas fa-thumbtack"></i> Pin ${itemType}
        </h3>
      </div>
      <div style="padding: 24px;">
        <p style="margin: 0 0 20px 0; color: var(--ig-secondary-text); font-size: 14px;">
          How long do you want to pin this ${itemType.toLowerCase()}?
        </p>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <button onclick="pinMessageWithDuration(${postId}, 1, ${isPoll})" 
            style="padding: 16px; border: 1px solid var(--ig-border); border-radius: 12px; background: var(--ig-secondary-background); color: var(--ig-primary-text); cursor: pointer; font-size: 15px; font-weight: 500; transition: all 0.2s; text-align: left; display: flex; justify-content: space-between; align-items: center;"
            onmouseover="this.style.background='var(--ig-hover)'; this.style.borderColor='var(--ig-blue)'"
            onmouseout="this.style.background='var(--ig-secondary-background)'; this.style.borderColor='var(--ig-border)'">
            <span>📅 1 Day</span>
            <i class="fas fa-chevron-right" style="font-size: 12px; opacity: 0.5;"></i>
          </button>
          
          <button onclick="pinMessageWithDuration(${postId}, 7, ${isPoll})" 
            style="padding: 16px; border: 1px solid var(--ig-border); border-radius: 12px; background: var(--ig-secondary-background); color: var(--ig-primary-text); cursor: pointer; font-size: 15px; font-weight: 500; transition: all 0.2s; text-align: left; display: flex; justify-content: space-between; align-items: center;"
            onmouseover="this.style.background='var(--ig-hover)'; this.style.borderColor='var(--ig-blue)'"
            onmouseout="this.style.background='var(--ig-secondary-background)'; this.style.borderColor='var(--ig-border)'">
            <span>📅 7 Days</span>
            <i class="fas fa-chevron-right" style="font-size: 12px; opacity: 0.5;"></i>
          </button>
          
          <button onclick="pinMessageWithDuration(${postId}, 30, ${isPoll})" 
            style="padding: 16px; border: 1px solid var(--ig-border); border-radius: 12px; background: var(--ig-secondary-background); color: var(--ig-primary-text); cursor: pointer; font-size: 15px; font-weight: 500; transition: all 0.2s; text-align: left; display: flex; justify-content: space-between; align-items: center;"
            onmouseover="this.style.background='var(--ig-hover)'; this.style.borderColor='var(--ig-blue)'"
            onmouseout="this.style.background='var(--ig-secondary-background)'; this.style.borderColor='var(--ig-border)'">
            <span>📅 30 Days</span>
            <i class="fas fa-chevron-right" style="font-size: 12px; opacity: 0.5;"></i>
          </button>
          
          <button onclick="pinMessageWithDuration(${postId}, null, ${isPoll})" 
            style="padding: 16px; border: 1px solid var(--ig-border); border-radius: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; cursor: pointer; font-size: 15px; font-weight: 600; transition: all 0.2s; text-align: left; display: flex; justify-content: space-between; align-items: center;"
            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.4)'"
            onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
            <span>📌 Until I unpin</span>
            <i class="fas fa-infinity" style="font-size: 16px;"></i>
          </button>
        </div>
      </div>
      <div style="padding: 16px 24px; border-top: 1px solid var(--ig-border); text-align: right;">
        <button onclick="this.closest('.ig-modal-overlay').remove()" 
          style="padding: 10px 20px; border: 1px solid var(--ig-border); border-radius: 8px; background: transparent; color: var(--ig-primary-text); cursor: pointer; font-weight: 500;">
          Cancel
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

async function pinMessageWithDuration(postId, days, isPoll = false) {
  const state = window.state || {};
  const groupId = state.currentGroupId;
  const itemType = isPoll ? 'poll' : 'message';
  const endpoint = isPoll ? `/community-groups/${groupId}/polls/${postId}/pin` : `/community-groups/${groupId}/posts/${postId}/pin`;
  
  // Close the modal
  document.querySelector('.ig-modal-overlay')?.remove();
  
  try {
    const response = await InnovateAPI.apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify({ pinDuration: days })
    });
    
    if (response.success) {
      const durationText = days ? `for ${days} day${days > 1 ? 's' : ''}` : 'until unpinned';
      InnovateAPI.showAlert(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} pinned ${durationText}!`, 'success');
      
      // Reload chat or polls to show pinned item
      if (isPoll && typeof loadGroupPolls === 'function') {
        await loadGroupPolls(groupId);
      } else if (typeof loadChatView === 'function') {
        await loadChatView(groupId);
      } else if (typeof loadGroupChat === 'function') {
        await loadGroupChat();
      }
    } else {
      throw new Error(response.error || `Failed to pin ${itemType}`);
    }
  } catch (error) {
    console.error(`Error pinning ${itemType}:`, error);
    InnovateAPI.showAlert(`Failed to pin ${itemType}`, 'error');
  }
}

async function unpinMessage(postId) {
  const state = window.state || {};
  const groupId = state.currentGroupId;
  
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${groupId}/posts/${postId}/pin`, {
      method: 'POST',
      body: JSON.stringify({})  // Empty body to unpin
    });
    
    if (response.success) {
      InnovateAPI.showAlert('Message unpinned!', 'success');
      
      // Reload chat to update UI
      if (typeof loadChatView === 'function') {
        await loadChatView(groupId);
      } else if (typeof loadGroupChat === 'function') {
        await loadGroupChat();
      }
    } else {
      throw new Error(response.error || 'Failed to unpin message');
    }
  } catch (error) {
    console.error('Error unpinning message:', error);
    InnovateAPI.showAlert('Failed to unpin message', 'error');
  }
}

// ==================== POLL SYSTEM ====================

function showPollCreator() {
  const modal = document.createElement('div');
  modal.className = 'ig-modal-overlay';
  modal.innerHTML = `
    <div class="ig-modal" style="max-width: 600px;">
      <div style="padding: 24px; border-bottom: 1px solid var(--ig-border);">
        <h3 style="margin: 0; font-size: 20px;">Create Poll</h3>
      </div>
      <div style="padding: 24px;">
        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: 600; margin-bottom: 8px;">Question</label>
          <input type="text" id="pollQuestion" placeholder="Ask a question..." 
            style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text); font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: 600; margin-bottom: 8px;">Options</label>
          <div id="pollOptions">
            <input type="text" class="poll-option" placeholder="Option 1" 
              style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text); margin-bottom: 8px; font-size: 14px;">
            <input type="text" class="poll-option" placeholder="Option 2" 
              style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text); margin-bottom: 8px; font-size: 14px;">
          </div>
          <button onclick="addPollOption()" 
            style="padding: 8px 16px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-blue); cursor: pointer; font-size: 13px; font-weight: 600;">
            + Add Option
          </button>
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: 600; margin-bottom: 8px;">Poll Duration</label>
          <select id="pollDuration" 
            style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text); font-size: 14px;">
            <option value="60">1 Hour</option>
            <option value="360">6 Hours</option>
            <option value="1440">1 Day</option>
            <option value="10080">7 Days</option>
            <option value="">Never (No expiration)</option>
          </select>
        </div>
        
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button onclick="this.closest('.ig-modal-overlay').remove()" 
            style="padding: 10px 20px; border: 1px solid var(--ig-border); border-radius: 8px; background: transparent; color: var(--ig-primary-text); cursor: pointer;">
            Cancel
          </button>
          <button onclick="createPoll()" 
            style="padding: 10px 20px; border: none; border-radius: 8px; background: var(--ig-blue); color: white; cursor: pointer; font-weight: 600;">
            Create Poll
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function addPollOption() {
  const container = document.getElementById('pollOptions');
  const count = container.querySelectorAll('.poll-option').length;
  
  if (count >= 10) {
    InnovateAPI.showAlert('Maximum 10 options allowed', 'error');
    return;
  }
  
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'poll-option';
  input.placeholder = `Option ${count + 1}`;
  input.style.cssText = 'width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text); margin-bottom: 8px; font-size: 14px;';
  container.appendChild(input);
}

async function createPoll() {
  const question = document.getElementById('pollQuestion')?.value?.trim();
  const optionInputs = document.querySelectorAll('.poll-option');
  const options = Array.from(optionInputs).map(input => input.value.trim()).filter(Boolean);
  const expiresIn = document.getElementById('pollDuration')?.value;
  
  if (!question) {
    InnovateAPI.showAlert('Please enter a question', 'error');
    return;
  }
  
  if (options.length < 2) {
    InnovateAPI.showAlert('Please enter at least 2 options', 'error');
    return;
  }
  
  try {
    const state = window.state || {};
    const res = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/polls`, {
      method: 'POST',
      body: JSON.stringify({
        question,
        options,
        expiresIn: expiresIn ? parseInt(expiresIn) : null
      })
    });
    
    document.querySelector('.ig-modal-overlay')?.remove();
    InnovateAPI.showAlert('Poll created', 'success');
    
    // Reload chat to show new poll
    if (window.loadGroupChat) {
      window.loadGroupChat(window.state.currentGroupId);
    }
  } catch (error) {
    console.error('Error creating poll:', error);
    InnovateAPI.showAlert('Failed to create poll', 'error');
  }
}

async function voteOnPoll(pollId, optionIndex) {
  try {
    const state = window.state || {};
    if (!state.currentGroupId) {
      InnovateAPI.showAlert('Group ID not found', 'error');
      return;
    }
    
    console.log('Voting on poll:', pollId, 'option:', optionIndex, 'type:', typeof optionIndex);
    
    const response = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/polls/${pollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIndex: Number(optionIndex) })
    });
    
    console.log('Vote response:', response);
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to vote on poll');
    }
    
    InnovateAPI.showAlert('Vote recorded!', 'success');
    
    // Reload polls to show updated results
    if (typeof loadGroupPolls === 'function') {
      await loadGroupPolls(state.currentGroupId);
    } else {
      // Alternative: reload the page section
      location.reload();
    }
  } catch (error) {
    console.error('Error voting on poll:', error);
    InnovateAPI.showAlert(error.message || 'Failed to vote', 'error');
  }
}

function displayPollResults(pollId, results) {
  const pollEl = document.querySelector(`[data-poll-id="${pollId}"]`);
  if (!pollEl) return;
  
  const optionsHTML = results.options.map((option, index) => {
    const count = results.voteCounts[index] || 0;
    const percentage = results.percentages[index] || 0;
    const isUserVote = results.userVote === index;
    
    return `
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="font-size: 14px; font-weight: ${isUserVote ? '600' : '400'}; color: ${isUserVote ? 'var(--ig-blue)' : 'var(--ig-primary-text)'};">
            ${isUserVote ? '✓ ' : ''}${option}
          </span>
          <span style="font-size: 13px; color: var(--ig-secondary-text);">${count} votes</span>
        </div>
        <div style="height: 32px; background: var(--ig-secondary-background); border-radius: 16px; overflow: hidden; position: relative;">
          <div style="height: 100%; background: ${isUserVote ? 'var(--ig-blue)' : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'}; width: ${percentage}%; transition: width 0.3s ease; display: flex; align-items: center; justify-content: flex-end; padding-right: 12px; color: white; font-size: 13px; font-weight: 600;">
            ${percentage > 10 ? `${percentage}%` : ''}
          </div>
          ${percentage <= 10 && percentage > 0 ? `<span style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 13px; color: var(--ig-secondary-text);">${percentage}%</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  pollEl.innerHTML = `
    <div style="padding: 20px; background: var(--ig-secondary-background); border: 1px solid var(--ig-border); border-radius: 12px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
        <i class="fas fa-poll" style="color: var(--ig-blue); font-size: 20px;"></i>
        <h4 style="margin: 0; font-size: 16px; font-weight: 600;">${results.question}</h4>
      </div>
      
      ${optionsHTML}
      
      <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--ig-border); font-size: 12px; color: var(--ig-secondary-text); display: flex; justify-content: space-between; align-items: center;">
        <span>${results.totalVotes} total votes</span>
        ${results.isExpired ? '<span style="color: var(--ig-error);">Poll ended</span>' : ''}
      </div>
    </div>
  `;
}

// ==================== SOCKET.IO EVENT LISTENERS ====================

function setupEnhancedSocketListeners(socket) {
  socket.on('announcement:reaction', (data) => {
    const state = window.state || {};
    if (data.announcementId && data.announcementId == state.currentAnnouncementId) {
      loadAnnouncementReactions(data.announcementId);
    }
  });
  
  socket.on('announcement:comment', (data) => {
    const state = window.state || {};
    if (data.announcementId && data.announcementId == state.currentAnnouncementId) {
      showCommentSection(data.announcementId);
    }
  });
  
  socket.on('message:edited', (data) => {
    const messageEl = document.querySelector(`[data-post-id="${data.postId}"]`);
    if (messageEl) {
      const contentEl = messageEl.querySelector('.message-content');
      if (contentEl) {
        contentEl.textContent = data.content;
      }
      
      let editedBadge = messageEl.querySelector('.edited-badge');
      if (!editedBadge) {
        editedBadge = document.createElement('span');
        editedBadge.className = 'edited-badge';
        editedBadge.style.cssText = 'color: var(--ig-secondary-text); font-size: 12px; margin-left: 8px; font-style: italic;';
        editedBadge.textContent = '(edited)';
        const timeEl = messageEl.querySelector('.message-time');
        if (timeEl) {
          timeEl.appendChild(editedBadge);
        }
      }
    }
  });
  
  socket.on('message:deleted', (data) => {
    const messageEl = document.querySelector(`[data-post-id="${data.postId}"]`);
    if (messageEl) {
      const contentEl = messageEl.querySelector('.message-content');
      if (contentEl) {
        contentEl.textContent = '[Message deleted]';
        contentEl.style.fontStyle = 'italic';
        contentEl.style.color = 'var(--ig-secondary-text)';
      }
      
      const actionsEl = messageEl.querySelector('.message-actions');
      if (actionsEl) {
        actionsEl.remove();
      }
    }
  });
  
  socket.on('message:reaction', (data) => {
    loadMessageReactions(data.postId);
  });
  
  socket.on('poll:created', (data) => {
    if (window.loadGroupChat) {
      window.loadGroupChat(data.groupId);
    }
  });
  
  socket.on('poll:voted', (data) => {
    displayPollResults(data.pollId, data.results);
  });
}

// Make functions globally accessible
window.showReactionPicker = showReactionPicker;
window.addReaction = addReaction;
window.removeReaction = removeReaction;
window.toggleReaction = toggleReaction;
window.loadAnnouncementReactions = loadAnnouncementReactions;
window.loadMessageReactions = loadMessageReactions;
window.showCommentSection = showCommentSection;
window.addComment = addComment;
window.deleteComment = deleteComment;
window.showMessageMenu = showMessageMenu;
window.editMessage = editMessage;
window.saveEditedMessage = saveEditedMessage;
window.saveEditedAttachment = saveEditedAttachment;
window.deleteMessage = deleteMessage;
window.replyToMessage = replyToMessage;
window.cancelReply = cancelReply;
window.forwardMessage = forwardMessage;
window.confirmForward = confirmForward;
window.showPinTimerModal = showPinTimerModal;
window.pinMessageWithDuration = pinMessageWithDuration;
window.unpinMessage = unpinMessage;
window.showPollCreator = showPollCreator;
window.addPollOption = addPollOption;
window.createPoll = createPoll;
window.voteOnPoll = voteOnPoll;
window.displayPollResults = displayPollResults;
window.setupEnhancedSocketListeners = setupEnhancedSocketListeners;

console.log('Community enhancements loaded');
