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
    background: var(--ig-primary-background);
    border: 1px solid var(--ig-border);
    border-radius: 12px;
    min-width: 220px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    z-index: 10000;
    overflow: hidden;
    animation: slideUpFade 0.2s ease-out;
  `;
  
  // Check if message is currently pinned
  const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
  const isPinned = messageEl?.dataset.pinned === 'true';
  
  const actions = [];
  
  if (isOwner) {
    actions.push({
      svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
      label: 'Edit Message',
      danger: false,
      onClick: () => editMessage(postId)
    });
  }
  
  actions.push({
    svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 10h10a5 5 0 0 1 5 5v1M3 10l4-4M3 10l4 4" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    label: 'Reply',
    danger: false,
    onClick: () => replyToMessage(postId)
  });
  
  actions.push({
    svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4m-7-7H1m22 0h-4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    label: isPinned ? 'Unpin Message' : 'Pin Message',
    danger: false,
    onClick: () => isPinned ? unpinMessage(postId) : showPinTimerModal(postId)
  });
  
  actions.push({
    svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z" stroke-linecap="round" stroke-linejoin="round" transform="rotate(90 12 12)"></path></svg>',
    label: 'Forward',
    danger: false,
    onClick: () => forwardMessage(postId)
  });

  actions.push({
    svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    label: 'Select',
    danger: false,
    onClick: () => enterMessageSelectMode(postId)
  });

  actions.push({ divider: true });
  
  if (isOwner || isAdmin) {
    actions.push({
      svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
      label: 'Delete Message',
      danger: true,
      onClick: () => showDeleteMessageModal(postId)
    });
  }
  
  if (isOwner) {
    actions.push({
      svg: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
      label: 'Unsend for everyone',
      danger: true,
      onClick: () => showUnsendMessageModal(postId)
    });
  }
  
  actions.forEach(action => {
    if (action.divider) {
      const divider = document.createElement('div');
      divider.style.cssText = 'height: 1px; background: var(--ig-border); margin: 4px 0;';
      menu.appendChild(divider);
      return;
    }
    const btn = document.createElement('button');
    btn.innerHTML = `
      <span style="width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">${action.svg}</span>
      <span>${action.label}</span>
    `;
    btn.style.cssText = `
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 18px;
      background: none;
      border: none;
      color: ${action.danger ? 'var(--ig-error)' : 'var(--ig-primary-text)'};
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
      text-align: left;
      min-height: 48px;
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
  
  // Position the menu near the click, ensuring it stays on screen
  const menuRect = menu.getBoundingClientRect();
  let top = event.clientY;
  let left = event.clientX - menuRect.width;
  if (left < 8) left = 8;
  if (top + menuRect.height > window.innerHeight - 8) top = window.innerHeight - menuRect.height - 8;
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  
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

// Show delete confirmation modal (soft delete - shows as "message deleted")
function showDeleteMessageModal(postId) {
  const modal = document.createElement('div');
  modal.className = 'ig-modal-overlay';
  modal.innerHTML = `
    <div class="ig-modal" style="max-width: 400px; border-radius: 16px; overflow: hidden;">
      <div style="padding: 24px 24px 16px; text-align: center;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: #fef2f2; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
          <svg fill="none" viewBox="0 0 24 24" stroke="#ef4444" stroke-width="2" width="24" height="24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </div>
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--ig-primary-text);">Delete Message</h3>
        <p style="margin: 0; font-size: 14px; color: var(--ig-secondary-text); line-height: 1.5;">This message will be replaced with "Message deleted" and can't be undone.</p>
      </div>
      <div style="padding: 0 24px 24px; display: flex; gap: 12px;">
        <button onclick="this.closest('.ig-modal-overlay').remove()" 
          style="flex: 1; padding: 12px; border: 2px solid var(--ig-border); border-radius: 10px; background: transparent; color: var(--ig-primary-text); cursor: pointer; font-weight: 600; font-size: 14px;">Cancel</button>
        <button onclick="confirmDeleteMessage(${postId})" 
          style="flex: 1; padding: 12px; border: none; border-radius: 10px; background: var(--ig-error); color: white; cursor: pointer; font-weight: 600; font-size: 14px;">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function confirmDeleteMessage(postId) {
  document.querySelector('.ig-modal-overlay')?.remove();
  
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
    
    // Remove message from DOM immediately
    const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
    if (messageEl) {
      messageEl.style.transition = 'opacity 0.3s, max-height 0.3s';
      messageEl.style.opacity = '0';
      messageEl.style.maxHeight = '0';
      messageEl.style.overflow = 'hidden';
      setTimeout(() => messageEl.remove(), 300);
    }
    
    InnovateAPI.showAlert('Message deleted', 'success');
    
    if (window.loadChatView) {
      setTimeout(() => window.loadChatView(state.currentGroupId), 400);
    }
  } catch (error) {
    console.error('Error deleting message:', error);
    InnovateAPI.showAlert('Failed to delete message', 'error');
  }
}

// Show unsend confirmation modal (hard delete - removes for everyone)
function showUnsendMessageModal(postId) {
  const modal = document.createElement('div');
  modal.className = 'ig-modal-overlay';
  modal.innerHTML = `
    <div class="ig-modal" style="max-width: 400px; border-radius: 16px; overflow: hidden;">
      <div style="padding: 24px 24px 16px; text-align: center;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: #fef2f2; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
          <svg fill="none" viewBox="0 0 24 24" stroke="#ef4444" stroke-width="2" width="24" height="24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </div>
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--ig-primary-text);">Unsend Message</h3>
        <p style="margin: 0; font-size: 14px; color: var(--ig-secondary-text); line-height: 1.5;">This will permanently remove the message for <strong>everyone</strong> in this group. This cannot be undone.</p>
      </div>
      <div style="padding: 0 24px 24px; display: flex; gap: 12px;">
        <button onclick="this.closest('.ig-modal-overlay').remove()" 
          style="flex: 1; padding: 12px; border: 2px solid var(--ig-border); border-radius: 10px; background: transparent; color: var(--ig-primary-text); cursor: pointer; font-weight: 600; font-size: 14px;">Cancel</button>
        <button onclick="confirmUnsendMessage(${postId})" 
          style="flex: 1; padding: 12px; border: none; border-radius: 10px; background: var(--ig-error); color: white; cursor: pointer; font-weight: 600; font-size: 14px;">Unsend</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function confirmUnsendMessage(postId) {
  document.querySelector('.ig-modal-overlay')?.remove();
  
  try {
    const state = window.state || {};
    if (!state.currentGroupId) {
      InnovateAPI.showAlert('Group ID not found', 'error');
      return;
    }
    
    const response = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/posts/${postId}/unsend`, {
      method: 'DELETE'
    });
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to unsend message');
    }
    
    // Remove message from DOM immediately
    const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
    if (messageEl) {
      messageEl.style.transition = 'opacity 0.3s, max-height 0.3s';
      messageEl.style.opacity = '0';
      messageEl.style.maxHeight = '0';
      messageEl.style.overflow = 'hidden';
      setTimeout(() => messageEl.remove(), 300);
    }
    
    InnovateAPI.showAlert('Message unsent for everyone', 'success');
    
    if (window.loadChatView) {
      setTimeout(() => window.loadChatView(state.currentGroupId), 400);
    }
  } catch (error) {
    console.error('Error unsending message:', error);
    InnovateAPI.showAlert('Failed to unsend message', 'error');
  }
}

async function deleteMessage(postId) {
  showDeleteMessageModal(postId);
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

let forwardGroupsCache = [];

async function forwardMessage(postId) {
  const state = window.state || {};
  
  try {
    const groupsRes = await InnovateAPI.apiRequest(`/communities/${state.communityId}/groups`);
    const groups = groupsRes.groups || [];
    
    if (groups.length === 0) {
      InnovateAPI.showAlert('No groups available to forward to', 'error');
      return;
    }
    
    forwardGroupsCache = groups;
    
    const messageEl = document.querySelector(`[data-post-id="${postId}"]`);
    let content = messageEl?.querySelector('.message-content')?.textContent || '';
    
    let existing = document.getElementById('communityForwardModal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'communityForwardModal';
    modal.style.cssText = 'position: fixed; inset: 0; z-index: 99999; display: flex; align-items: flex-end; justify-content: center;';
    modal.innerHTML = `
      <div onclick="closeCommunityForwardModal()" style="position: absolute; inset: 0; background: rgba(0,0,0,0.6);"></div>
      <div style="position: relative; width: 100%; max-width: 420px; max-height: 75vh; background: var(--ig-secondary-background, #262626); border-radius: 16px 16px 0 0; display: flex; flex-direction: column; overflow: hidden;">
        <div style="padding: 16px; border-bottom: 1px solid var(--ig-border, #363636); display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 17px; font-weight: 600; color: var(--ig-primary-text, #fff);">Forward to</span>
          <button onclick="closeCommunityForwardModal()" style="background: none; border: none; color: var(--ig-secondary-text, #a8a8a8); font-size: 22px; cursor: pointer; padding: 4px;">&times;</button>
        </div>
        <div style="padding: 8px 16px;">
          <div style="display: flex; align-items: center; background: var(--ig-tertiary-background, #363636); border-radius: 10px; padding: 8px 12px; gap: 8px;">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="18" height="18" style="color: var(--ig-secondary-text, #a8a8a8); flex-shrink: 0;"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg>
            <input type="text" placeholder="Search..." oninput="filterForwardGroups(this.value)" style="background: none; border: none; outline: none; color: var(--ig-primary-text, #fff); font-size: 14px; width: 100%;" />
          </div>
        </div>
        <div id="forwardGroupsList" style="flex: 1; overflow-y: auto; padding: 4px 0;">
          <div style="text-align: center; padding: 30px; color: var(--ig-secondary-text, #a8a8a8);">Loading...</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    renderForwardGroups(groups, postId);
  } catch (error) {
    console.error('Error loading groups for forward:', error);
    InnovateAPI.showAlert('Failed to load groups', 'error');
  }
}

function closeCommunityForwardModal() {
  const modal = document.getElementById('communityForwardModal');
  if (modal) modal.remove();
}

function filterForwardGroups(query) {
  const q = query.toLowerCase().trim();
  const postId = window._forwardPostId;
  if (!q) return renderForwardGroups(forwardGroupsCache, postId);
  const filtered = forwardGroupsCache.filter(g => g.name.toLowerCase().includes(q));
  renderForwardGroups(filtered, postId);
}

function renderForwardGroups(groups, postId) {
  window._forwardPostId = postId;
  const container = document.getElementById('forwardGroupsList');
  if (!container) return;
  if (!groups || groups.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#a8a8a8;">No groups found</div>';
    return;
  }
  container.innerHTML = groups.map(g => {
    const pic = g.avatar_url || g.profile_picture;
    const initial = g.name.charAt(0).toUpperCase();
    const avatarHtml = pic
      ? `<img src="${pic}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: #333;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div style="display:none;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);align-items:center;justify-content:center;color:white;font-weight:600;font-size:16px;">${initial}</div>`
      : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:white;font-weight:600;font-size:16px;">${initial}</div>`;
    const memberCount = g.member_count ? `${g.member_count} members` : '';
    return `
      <div onclick="doForwardToGroup(${g.id}, '${g.name.replace(/'/g, "\\'")}'${postId ? ', ' + postId : ''})" style="display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer; transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='none'">
        ${avatarHtml}
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 15px; font-weight: 500; color: var(--ig-primary-text, #fff);">${g.name}</div>
          <div style="font-size: 13px; color: var(--ig-secondary-text, #a8a8a8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${memberCount}</div>
        </div>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="20" height="20" style="color: var(--ig-secondary-text, #a8a8a8); flex-shrink: 0;"><path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    `;
  }).join('');
}

async function doForwardToGroup(targetGroupId, groupName, postId) {
  closeCommunityForwardModal();
  
  try {
    const postIds = window.selectedMessages && window.selectedMessages.size > 0
      ? [...window.selectedMessages]
      : (postId ? [postId] : []);
    
    let forwarded = 0;
    for (const pid of postIds) {
      const messageEl = document.querySelector(`[data-post-id="${pid}"]`);
      const content = messageEl?.querySelector('.message-content')?.textContent || '';
      await InnovateAPI.apiRequest(`/community-groups/${targetGroupId}/posts`, {
        method: 'POST',
        body: JSON.stringify({ content: `[Forwarded] ${content}` })
      });
      forwarded++;
    }
    
    if (window.selectMode) exitSelectMode();
    InnovateAPI.showAlert(`${forwarded > 1 ? forwarded + ' messages' : 'Message'} forwarded to ${groupName}`, 'success');
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

// ==================== MESSAGE SELECT MODE ====================
window.selectedMessages = new Set();

function enterMessageSelectMode(initialPostId) {
  const state = window.state || {};
  window.selectedMessages = new Set();
  if (initialPostId) window.selectedMessages.add(initialPostId);
  
  // Add selection checkboxes to all messages
  const messages = document.querySelectorAll('[data-post-id]');
  messages.forEach(msg => {
    if (msg.querySelector('.msg-select-checkbox')) return;
    const postId = parseInt(msg.dataset.postId);
    const checkbox = document.createElement('div');
    checkbox.className = 'msg-select-checkbox';
    checkbox.style.cssText = `
      position: absolute; left: -8px; top: 50%; transform: translateY(-50%);
      width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--ig-border);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      background: ${window.selectedMessages.has(postId) ? 'var(--ig-blue)' : 'var(--ig-secondary-background)'};
      transition: all 0.2s; z-index: 5;
    `;
    checkbox.innerHTML = window.selectedMessages.has(postId) ? '<svg fill="white" viewBox="0 0 24 24" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : '';
    checkbox.onclick = (e) => {
      e.stopPropagation();
      if (window.selectedMessages.has(postId)) {
        window.selectedMessages.delete(postId);
        checkbox.style.background = 'var(--ig-secondary-background)';
        checkbox.innerHTML = '';
      } else {
        window.selectedMessages.add(postId);
        checkbox.style.background = 'var(--ig-blue)';
        checkbox.innerHTML = '<svg fill="white" viewBox="0 0 24 24" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
      }
      updateSelectToolbar();
    };
    msg.style.position = 'relative';
    msg.style.paddingLeft = '28px';
    msg.insertBefore(checkbox, msg.firstChild);
  });
  
  // Show selection toolbar
  showSelectToolbar();
  updateSelectToolbar();
}

function showSelectToolbar() {
  let toolbar = document.getElementById('selectModeToolbar');
  if (toolbar) toolbar.remove();
  
  toolbar = document.createElement('div');
  toolbar.id = 'selectModeToolbar';
  toolbar.style.cssText = `
    position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: var(--ig-primary-background); border: 1px solid var(--ig-border);
    border-radius: 16px; padding: 10px 16px; display: flex; align-items: center; gap: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 9999; min-width: 280px;
  `;
  toolbar.innerHTML = `
    <span id="selectCount" style="font-size: 13px; color: var(--ig-secondary-text); font-weight: 600; min-width: 90px;">0 selected</span>
    <div style="flex: 1; display: flex; justify-content: center; gap: 8px;">
      <button onclick="forwardSelectedMessages()" title="Forward" style="background: none; border: none; color: var(--ig-primary-text); cursor: pointer; padding: 8px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='var(--ig-hover)'" onmouseout="this.style.background='none'">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z" stroke-linecap="round" stroke-linejoin="round" transform="rotate(90 12 12)"></path></svg>
      </button>
      <button onclick="deleteSelectedMessages()" title="Delete" style="background: none; border: none; color: var(--ig-error); cursor: pointer; padding: 8px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='var(--ig-hover)'" onmouseout="this.style.background='none'">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      </button>
    </div>
    <button onclick="exitSelectMode()" style="background: none; border: none; color: var(--ig-secondary-text); cursor: pointer; padding: 8px; font-size: 18px; border-radius: 8px;" title="Cancel">&times;</button>
  `;
  document.body.appendChild(toolbar);
}

function updateSelectToolbar() {
  const count = window.selectedMessages.size;
  const el = document.getElementById('selectCount');
  if (el) el.textContent = `${count} selected`;
}

function exitSelectMode() {
  window.selectedMessages = new Set();
  document.getElementById('selectModeToolbar')?.remove();
  document.querySelectorAll('.msg-select-checkbox').forEach(cb => {
    const parent = cb.parentElement;
    if (parent) parent.style.paddingLeft = '';
    cb.remove();
  });
}

async function forwardSelectedMessages() {
  if (window.selectedMessages.size === 0) {
    InnovateAPI.showAlert('No messages selected', 'error');
    return;
  }
  // Reuse the same forward modal — doForwardToGroup handles bulk via window.selectedMessages
  forwardMessage(null);
}

async function deleteSelectedMessages() {
  if (window.selectedMessages.size === 0) {
    InnovateAPI.showAlert('No messages selected', 'error');
    return;
  }
  
  const count = window.selectedMessages.size;
  const modal = document.createElement('div');
  modal.className = 'ig-modal-overlay';
  modal.innerHTML = `
    <div class="ig-modal" style="max-width: 400px; border-radius: 16px; overflow: hidden;">
      <div style="padding: 24px 24px 16px; text-align: center;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: #fef2f2; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
          <svg fill="none" viewBox="0 0 24 24" stroke="#ef4444" stroke-width="2" width="24" height="24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </div>
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700;">Delete ${count} Message${count > 1 ? 's' : ''}?</h3>
        <p style="margin: 0; font-size: 14px; color: var(--ig-secondary-text);">This cannot be undone.</p>
      </div>
      <div style="padding: 0 24px 24px; display: flex; gap: 12px;">
        <button onclick="this.closest('.ig-modal-overlay').remove()" style="flex: 1; padding: 12px; border: 2px solid var(--ig-border); border-radius: 10px; background: transparent; color: var(--ig-primary-text); cursor: pointer; font-weight: 600;">Cancel</button>
        <button onclick="confirmBulkDelete()" style="flex: 1; padding: 12px; border: none; border-radius: 10px; background: var(--ig-error); color: white; cursor: pointer; font-weight: 600;">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function confirmBulkDelete() {
  document.querySelector('.ig-modal-overlay')?.remove();
  const state = window.state || {};
  let deleted = 0;
  
  for (const postId of window.selectedMessages) {
    try {
      await InnovateAPI.apiRequest(`/community-groups/${state.currentGroupId}/posts/${postId}`, { method: 'DELETE' });
      const el = document.querySelector(`[data-post-id="${postId}"]`);
      if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }
      deleted++;
    } catch (e) { /* skip */ }
  }
  
  exitSelectMode();
  InnovateAPI.showAlert(`${deleted} message${deleted > 1 ? 's' : ''} deleted`, 'success');
  if (window.loadChatView) setTimeout(() => window.loadChatView(state.currentGroupId), 400);
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
window.showDeleteMessageModal = showDeleteMessageModal;
window.confirmDeleteMessage = confirmDeleteMessage;
window.showUnsendMessageModal = showUnsendMessageModal;
window.confirmUnsendMessage = confirmUnsendMessage;
window.replyToMessage = replyToMessage;
window.cancelReply = cancelReply;
window.forwardMessage = forwardMessage;
window.closeCommunityForwardModal = closeCommunityForwardModal;
window.filterForwardGroups = filterForwardGroups;
window.doForwardToGroup = doForwardToGroup;
window.enterMessageSelectMode = enterMessageSelectMode;
window.exitSelectMode = exitSelectMode;
window.forwardSelectedMessages = forwardSelectedMessages;
window.deleteSelectedMessages = deleteSelectedMessages;
window.confirmBulkDelete = confirmBulkDelete;
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
