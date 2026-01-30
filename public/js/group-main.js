/**
 * Main Group Page Controller
 * Integrates Chat, Calls, To-Do, Notes, and File Management
 */

// Global instances
let groupCallManager = null;
let todoBoard = null;
let notesEditor = null;
let socket = null;
let currentGroupId = null;
let currentCommunityId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  if (!InnovateAPI.requireAuth()) return;

  // Get group ID from URL or window global
  const urlParams = new URLSearchParams(window.location.search);
  currentGroupId = window.currentGroupId || urlParams.get('id');
  currentCommunityId = urlParams.get('communityId');

  if (!currentGroupId) {
    InnovateAPI.showAlert('Group ID not provided', 'error');
    window.location.href = '/communities';
    return;
  }
  
  // Update window global for inline scripts
  window.currentGroupId = currentGroupId;

  // Initialize Socket.IO
  socket = InnovateAPI.getSocket();
  
  // Initialize managers
  groupCallManager = new GroupCallManager(currentGroupId, socket);
  todoBoard = new TodoBoard(currentGroupId);
  notesEditor = new NotesEditor(currentGroupId, socket);

  // Load group data
  await loadGroupData();
  
  // Setup event listeners
  setupEventListeners();
  
  // Setup tab switching
  setupTabs();
  
  // Load initial content
  await loadGroupChat();
  await loadGroupMembers();
});

// Load group data
async function loadGroupData() {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}`);
    const group = response.group;

    document.getElementById('group-name').textContent = group.name;
    document.getElementById('group-description').textContent = group.description || 'No description';
    document.getElementById('member-count').textContent = group.member_count || 0;
    document.getElementById('creator-name').textContent = group.creator_username || 'Unknown';

    // Setup back button
    const backBtn = document.getElementById('back-to-community');
    if (backBtn && currentCommunityId) {
      backBtn.href = `/community.html?id=${currentCommunityId}`;
    }
  } catch (error) {
    console.error('Error loading group:', error);
    InnovateAPI.showAlert('Failed to load group data', 'error');
  }
}

// Setup event listeners
function setupEventListeners() {
  // Voice/Video call buttons
  const videoCallBtn = document.getElementById('start-video-call');
  const audioCallBtn = document.getElementById('start-audio-call');

  if (videoCallBtn) {
    videoCallBtn.addEventListener('click', () => {
      groupCallManager.startCall(false); // video call
    });
  }

  if (audioCallBtn) {
    audioCallBtn.addEventListener('click', () => {
      groupCallManager.startCall(true); // audio-only call
    });
  }

  // Call controls
  const toggleMic = document.getElementById('toggle-mic');
  const toggleCamera = document.getElementById('toggle-camera');
  const shareScreen = document.getElementById('share-screen');
  const endCall = document.getElementById('end-call');

  if (toggleMic) {
    toggleMic.addEventListener('click', () => groupCallManager.toggleMic());
  }

  if (toggleCamera) {
    toggleCamera.addEventListener('click', () => groupCallManager.toggleCamera());
  }

  if (shareScreen) {
    shareScreen.addEventListener('click', () => groupCallManager.shareScreen());
  }

  if (endCall) {
    endCall.addEventListener('click', () => groupCallManager.endCall());
  }

  // To-Do create button
  const createTaskBtn = document.getElementById('create-task-btn');
  if (createTaskBtn) {
    createTaskBtn.addEventListener('click', () => {
      todoBoard.showCreateTaskModal();
    });
  }

  // Notes buttons
  const createNoteBtn = document.getElementById('create-note-btn');
  if (createNoteBtn) {
    createNoteBtn.addEventListener('click', () => {
      notesEditor.createNote();
    });
  }

  const saveNoteBtn = document.getElementById('save-note-btn');
  if (saveNoteBtn) {
    saveNoteBtn.addEventListener('click', () => {
      notesEditor.saveNote();
    });
  }

  const cancelNoteBtn = document.getElementById('cancel-note-btn');
  if (cancelNoteBtn) {
    cancelNoteBtn.addEventListener('click', () => {
      notesEditor.cancelEdit();
    });
  }

  // Chat send button
  const sendBtn = document.getElementById('send-chat-message-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendChatMessage);
  }

  // Enter key to send
  const chatInput = document.getElementById('chat-message-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // File attachments
  setupFileAttachments();
}

// Setup tab switching
function setupTabs() {
  const tabs = {
    'feed-tab': 'feed-content',
    'todo-tab': 'todo-content',
    'notes-tab': 'notes-content',
    'links-tab': 'links-content',
    'images-tab': 'images-content',
    'documents-tab': 'documents-content',
    'videos-tab': 'videos-content',
    'files-tab': 'files-content',
    'members-tab': 'members-content'
  };

  Object.keys(tabs).forEach(tabId => {
    const tabBtn = document.getElementById(tabId);
    if (tabBtn) {
      tabBtn.addEventListener('click', async () => {
        // Remove active class from all tabs
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        
        // Hide all content
        Object.values(tabs).forEach(contentId => {
          const content = document.getElementById(contentId);
          if (content) content.style.display = 'none';
        });

        // Activate clicked tab
        tabBtn.classList.add('active');
        const contentId = tabs[tabId];
        const content = document.getElementById(contentId);
        if (content) content.style.display = 'block';

        // Load content for specific tabs
        if (tabId === 'todo-tab') {
          await todoBoard.loadTasks(true); // true = show board view by default
        } else if (tabId === 'notes-tab') {
          await notesEditor.loadNotes();
        } else if (tabId === 'links-tab') {
          await loadLinks();
        } else if (tabId === 'images-tab') {
          await loadFiles('image');
        } else if (tabId === 'documents-tab') {
          await loadFiles('document');
        } else if (tabId === 'videos-tab') {
          await loadFiles('video');
        } else if (tabId === 'files-tab') {
          await loadFiles('other');
        } else if (tabId === 'members-tab') {
          await loadGroupMembers();
        }
      });
    }
  });
}

// Load group chat messages
async function loadGroupChat() {
  console.log('🔵 GROUP-MAIN.JS loadGroupChat() called');
  try {
    // Use window.currentGroupId if currentGroupId is not set yet
    const groupId = currentGroupId || window.currentGroupId;
    
    if (!groupId) {
      console.error('Group ID not available');
      return;
    }
    
    const response = await InnovateAPI.apiRequest(`/community-groups/${groupId}/posts`);
    const messages = response.posts || [];

    const chatContainer = document.getElementById('group-chat-messages');
    if (!chatContainer) return;

    if (messages.length === 0) {
      chatContainer.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--ig-secondary-text);">
          <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
          <p>No messages yet. Start the conversation!</p>
        </div>
      `;
      return;
    }

    chatContainer.innerHTML = messages.map(msg => renderChatMessage(msg)).join('');
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Add event listeners to messages
    setupMessageEventListeners(chatContainer);

    // Initialize socket if not already done
    if (!socket) {
      socket = InnovateAPI.getSocket();
    }

    // Join group chat room
    if (socket) {
      socket.emit('group:join', groupId);
      
      // Listen for new messages
      socket.on('group:message:receive', (message) => {
        const newMsg = renderChatMessage(message);
        chatContainer.insertAdjacentHTML('beforeend', newMsg);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        // Add event listeners to new message
        setupMessageEventListeners(chatContainer);
      });
    }
  } catch (error) {
    console.error('Error loading chat:', error);
  }
}

// Setup event listeners for message interactions
function setupMessageEventListeners(container) {
  const messages = container.querySelectorAll('.ig-message');
  
  console.log(`Setting up listeners for ${messages.length} messages`);
  
  messages.forEach(messageEl => {
    // Remove existing listeners to prevent duplicates
    const newMessageEl = messageEl.cloneNode(true);
    messageEl.parentNode.replaceChild(newMessageEl, messageEl);
    
    const messageId = parseInt(newMessageEl.dataset.messageId);
    const userId = parseInt(newMessageEl.dataset.userId);
    const username = newMessageEl.dataset.username;
    const content = newMessageEl.dataset.content || '';
    const isOwn = newMessageEl.dataset.isOwn === 'true';
    
    console.log('Setting up message:', { messageId, username, isOwn });
    
    // Right-click context menu (desktop)
    newMessageEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Context menu triggered for message:', messageId);
      showMessageMenu(e, messageId, username, content, userId, isOwn);
    });
    
    // Double-tap for mobile
    let lastTap = 0;
    newMessageEl.addEventListener('click', (e) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;
      
      if (tapLength < 300 && tapLength > 0) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Double-tap triggered for message:', messageId);
        showMessageMenu(e, messageId, username, content, userId, isOwn);
      }
      
      lastTap = currentTime;
    });
  });
  
  console.log('Message listeners setup complete');
}

// Linkify URLs in text
function linkifyText(text, isOwnMessage = false) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const linkColor = isOwnMessage ? '#ffffff' : '#00d4ff'; // Pure white for sent messages, cyan for received
  return text.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: ${linkColor}; text-decoration: underline; font-weight: 700; word-break: break-all; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">${url}</a>`;
  });
}

// Render a chat message
function renderChatMessage(msg) {
  const currentUser = InnovateAPI.getCurrentUser();
  const isOwn = msg.user_id === currentUser.id;
  const alignClass = isOwn ? 'sent' : 'received';
  
  let attachmentsHTML = '';
  if (msg.attachments) {
    try {
      const attachments = JSON.parse(msg.attachments);
      attachmentsHTML = attachments.map(att => {
        if (att.type === 'image') {
          return `<img src="${att.url}" style="max-width: 200px; border-radius: 8px; margin-top: 8px;">`;
        } else if (att.type === 'location') {
          return `<div style="margin-top: 8px;"><a href="https://www.google.com/maps?q=${att.lat},${att.lng}" target="_blank" style="color: var(--ig-blue);">📍 View Location</a></div>`;
        } else {
          return `<div style="margin-top: 8px;"><a href="${att.url}" target="_blank" style="color: var(--ig-blue);">📎 ${att.name}</a></div>`;
        }
      }).join('');
    } catch (e) {}
  }

  // Reply preview HTML
  let replyHTML = '';
  if (msg.reply_to) {
    const replyBgColor = isOwn ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)';
    const replyTextColor = isOwn ? 'rgba(255, 255, 255, 0.8)' : 'var(--ig-secondary-text)';
    replyHTML = `
      <div style="border-left: 3px solid var(--ig-blue); padding-left: 8px; margin-bottom: 8px; background: ${replyBgColor}; border-radius: 4px; padding: 6px 8px;">
        <div style="font-size: 11px; color: var(--ig-blue); font-weight: 600; margin-bottom: 2px;">Replying to ${msg.reply_to_username || 'a message'}</div>
        <div style="font-size: 12px; color: ${replyTextColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${msg.reply_to_content || '...'}</div>
      </div>
    `;
  }

  return `
    <div class="ig-message ig-message-${alignClass}" 
         data-message-id="${msg.id}" 
         data-user-id="${msg.user_id}" 
         data-username="${msg.username}" 
         data-content="${(msg.content || '').replace(/"/g, '&quot;')}" 
         data-is-own="${isOwn}"
         style="max-width: 70%; margin-bottom: 12px; ${isOwn ? 'margin-left: auto;' : ''} cursor: pointer; position: relative;">
      ${!isOwn ? `<div style="font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--ig-secondary-text);">${msg.username}</div>` : ''}
      ${replyHTML}
      ${msg.content ? `<div style="word-wrap: break-word;">${linkifyText(msg.content, isOwn)}</div>` : ''}
      ${attachmentsHTML}
      <div class="ig-message-time" style="font-size: 11px; margin-top: 4px; opacity: 0.7;">
        ${InnovateAPI.formatDate(msg.created_at)}
      </div>
    </div>
  `;
}

// Send chat message
async function sendChatMessage() {
  const input = document.getElementById('chat-message-input');
  const content = input.value.trim();
  
  // Get attachments
  const attachmentPreview = document.getElementById('chat-attachment-preview');
  const attachments = [];
  
  attachmentPreview.querySelectorAll('[data-attachment]').forEach(el => {
    attachments.push(JSON.parse(el.dataset.attachment));
  });

  if (!content && attachments.length === 0) return;

  try {
    const formData = new FormData();
    formData.append('content', content);
    if (attachments.length > 0) {
      formData.append('attachments', JSON.stringify(attachments));
    }

    const response = await fetch(`/api/community-groups/${currentGroupId}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${InnovateAPI.getToken()}`
      },
      body: formData
    });

    if (response.ok) {
      input.value = '';
      attachmentPreview.innerHTML = '';
      
      // Emit to socket for real-time
      if (socket) {
        const result = await response.json();
        socket.emit('group:message', {
          groupId: currentGroupId,
          message: result.post
        });
      }
    }
  } catch (error) {
    console.error('Error sending message:', error);
    InnovateAPI.showAlert('Failed to send message', 'error');
  }
}

// Setup file attachments
function setupFileAttachments() {
  const photoInput = document.getElementById('chat-photo');
  const videoInput = document.getElementById('chat-video');
  const fileInput = document.getElementById('chat-file');
  const audioInput = document.getElementById('chat-audio');
  const locationBtn = document.getElementById('share-location-btn');

  if (photoInput) {
    photoInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0], 'image'));
  }

  if (videoInput) {
    videoInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0], 'video'));
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0], 'file'));
  }

  if (audioInput) {
    audioInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0], 'audio'));
  }

  if (locationBtn) {
    locationBtn.addEventListener('click', shareLocation);
  }
}

// Handle file selection
async function handleFileSelect(file, type) {
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(`/api/community-groups/${currentGroupId}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${InnovateAPI.getToken()}`
      },
      body: formData
    });

    const result = await response.json();
    
    if (result.success) {
      addAttachmentPreview({
        type,
        url: result.file.filepath,
        name: result.file.filename
      });
    }
  } catch (error) {
    console.error('Error uploading file:', error);
    InnovateAPI.showAlert('Failed to upload file', 'error');
  }
}

// Add attachment preview
function addAttachmentPreview(attachment) {
  const preview = document.getElementById('chat-attachment-preview');
  
  const el = document.createElement('div');
  el.dataset.attachment = JSON.stringify(attachment);
  
  if (attachment.type === 'image') {
    el.innerHTML = `
      <img src="${attachment.url}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px;">
      <button onclick="this.parentElement.remove()">×</button>
    `;
  } else {
    el.innerHTML = `
      <div style="padding: 12px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 4px;">📎</div>
        <div style="font-size: 11px; word-break: break-all;">${attachment.name}</div>
      </div>
      <button onclick="this.parentElement.remove()">×</button>
    `;
  }
  
  preview.appendChild(el);
}

// Share location
function shareLocation() {
  if (!navigator.geolocation) {
    InnovateAPI.showAlert('Geolocation not supported', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      addAttachmentPreview({
        type: 'location',
        lat: position.coords.latitude,
        lng: position.coords.longitude
      });
      InnovateAPI.showAlert('Location added!', 'success');
    },
    (error) => {
      InnovateAPI.showAlert('Failed to get location', 'error');
    }
  );
}

// Load links
async function loadLinks() {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/links`);
    const links = response.links || [];

    const linksList = document.getElementById('links-list');
    if (!linksList) return;

    if (links.length === 0) {
      linksList.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--ig-secondary-text);">
          <div style="font-size: 48px; margin-bottom: 16px;">🔗</div>
          <p>No links saved yet</p>
        </div>
      `;
      return;
    }

    linksList.innerHTML = links.map(link => `
      <div style="background: var(--ig-primary-background); border: 1px solid var(--ig-border); border-radius: 8px; padding: 16px; margin-bottom: 12px;">
        <h4 style="margin: 0 0 8px 0;">
          <a href="${link.url}" target="_blank" style="color: var(--ig-blue); text-decoration: none;">${link.title || link.url}</a>
        </h4>
        ${link.description ? `<p style="margin: 0; color: var(--ig-secondary-text); font-size: 14px;">${link.description}</p>` : ''}
        <div style="margin-top: 8px; font-size: 12px; color: var(--ig-secondary-text);">
          Added by ${link.username} · ${InnovateAPI.formatDate(link.created_at)}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading links:', error);
  }
}

// Load files by type
async function loadFiles(fileType) {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/files?type=${fileType}`);
    const files = response.files || [];

    const containerId = fileType === 'image' ? 'images-grid' : 
                        fileType === 'video' ? 'videos-grid' : 
                        fileType === 'document' ? 'documents-list' : 'files-list';
    
    const container = document.getElementById(containerId);
    if (!container) return;

    if (files.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--ig-secondary-text); grid-column: 1/-1;">
          <div style="font-size: 48px; margin-bottom: 16px;">📁</div>
          <p>No ${fileType}s yet</p>
        </div>
      `;
      return;
    }

    if (fileType === 'image') {
      container.innerHTML = files.map(file => `
        <div style="position: relative; border-radius: 8px; overflow: hidden;">
          <img src="${file.filepath}" style="width: 100%; height: 200px; object-fit: cover; cursor: pointer;" onclick="window.open('${file.filepath}', '_blank')">
        </div>
      `).join('');
    } else if (fileType === 'video') {
      container.innerHTML = files.map(file => `
        <video controls style="width: 100%; border-radius: 8px;">
          <source src="${file.filepath}">
        </video>
      `).join('');
    } else {
      container.innerHTML = files.map(file => `
        <div style="background: var(--ig-primary-background); border: 1px solid var(--ig-border); border-radius: 8px; padding: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
          <div style="font-size: 32px;">📄</div>
          <div style="flex: 1;">
            <a href="${file.filepath}" target="_blank" style="color: var(--ig-blue); font-weight: 600; text-decoration: none;">${file.filename}</a>
            <div style="font-size: 12px; color: var(--ig-secondary-text); margin-top: 4px;">
              ${(file.filesize / 1024 / 1024).toFixed(2)} MB · ${InnovateAPI.formatDate(file.created_at)}
            </div>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading files:', error);
  }
}

// Load group members
async function loadGroupMembers() {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/members`);
    const members = response.members || [];

    const membersList = document.getElementById('members-list');
    if (!membersList) return;

    membersList.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px;">
        ${members.map(member => `
          <div style="background: var(--ig-primary-background); border: 1px solid var(--ig-border); border-radius: 8px; padding: 16px; display: flex; align-items: center; gap: 12px;">
            <img src="${InnovateAPI.getUserAvatar(member.profile_picture)}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">
            <div style="flex: 1;">
              <div style="font-weight: 600;">${member.username}</div>
              <div style="font-size: 12px; color: var(--ig-secondary-text);">${member.role}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (error) {
    console.error('Error loading members:', error);
  }
}

// Global variables for reply functionality (accessible from group.html)
window.replyingToMessageId = null;
window.replyingToUsername = null;
window.replyingToContent = null;

// Show message context menu (desktop)
function showMessageMenu(event, messageId, username, content, userId, isOwn) {
  console.log('showMessageMenu called:', { messageId, username, content, userId, isOwn });
  
  event.preventDefault();
  event.stopPropagation();
  
  // Remove existing menu
  const existingMenu = document.getElementById('message-context-menu');
  if (existingMenu) existingMenu.remove();
  
  // Create menu
  const menu = document.createElement('div');
  menu.id = 'message-context-menu';
  menu.style.cssText = `
    position: fixed;
    background: var(--ig-primary-background);
    border: 1px solid var(--ig-border);
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    min-width: 200px;
    overflow: hidden;
  `;
  
  const currentUser = InnovateAPI.getCurrentUser();
  
  let menuHTML = `
    <button data-action="reply" style="width: 100%; padding: 12px 16px; border: none; background: none; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--ig-primary-text); font-size: 14px; transition: background 0.2s;">
      <span style="font-size: 18px;">💬</span> Reply
    </button>
    <button data-action="forward" style="width: 100%; padding: 12px 16px; border: none; background: none; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--ig-primary-text); font-size: 14px; border-top: 1px solid var(--ig-border); transition: background 0.2s;">
      <span style="font-size: 18px;">➡️</span> Forward
    </button>
  `;
  
  // Add edit/delete only for own messages
  if (isOwn) {
    menuHTML += `
      <button data-action="edit" style="width: 100%; padding: 12px 16px; border: none; background: none; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--ig-primary-text); font-size: 14px; border-top: 1px solid var(--ig-border); transition: background 0.2s;">
        <span style="font-size: 18px;">✏️</span> Edit Message
      </button>
      <button data-action="delete" style="width: 100%; padding: 12px 16px; border: none; background: none; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--ig-error); font-size: 14px; border-top: 1px solid var(--ig-border); transition: background 0.2s;">
        <span style="font-size: 18px;">🗑️</span> Delete Message
      </button>
    `;
  }
  
  menu.innerHTML = menuHTML;
  
  // Add click handlers to menu buttons
  menu.querySelectorAll('button').forEach(btn => {
    const action = btn.dataset.action;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('Menu action clicked:', action);
      
      if (action === 'reply') {
        replyToMessage(messageId, username, content);
      } else if (action === 'forward') {
        forwardMessage(messageId);
      } else if (action === 'edit') {
        editMessage(messageId, content);
      } else if (action === 'delete') {
        deleteMessage(messageId);
      }
      
      menu.remove();
    });
    
    // Add hover effects
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'var(--ig-hover)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
    });
  });
  
  // Position menu
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  
  document.body.appendChild(menu);
  
  console.log('Context menu created and positioned');
  
  // Close menu when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closeMenu() {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    });
  }, 100);
}

// Reply to message
function replyToMessage(messageId, username, content) {
  console.log('=== REPLY TO MESSAGE ===');
  console.log('Message ID:', messageId);
  console.log('Username:', username);
  console.log('Content:', content);
  
  window.replyingToMessageId = messageId;
  window.replyingToUsername = username;
  window.replyingToContent = content;
  
  // Find the reply preview container
  const replyContainer = document.getElementById('reply-preview-container');
  console.log('Reply container found:', !!replyContainer);
  
  if (!replyContainer) {
    console.error('Reply preview container not found in DOM!');
    alert('Reply container missing! Check HTML structure.');
    return;
  }
  
  // Create reply preview
  const replyPreview = document.createElement('div');
  replyPreview.id = 'reply-preview';
  replyPreview.style.cssText = `
    display: block !important;
    visibility: visible !important;
    padding: 12px;
    background: var(--ig-secondary-background);
    border-left: 3px solid var(--ig-blue);
    border-radius: 8px;
    margin-bottom: 12px;
    opacity: 1 !important;
  `;
  
  console.log('Reply preview element created, styles:', replyPreview.style.cssText);
  
  // Safely escape HTML in content
  const safeContent = (content || 'Message').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeUsername = username.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  replyPreview.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 12px; color: var(--ig-blue); font-weight: 600; margin-bottom: 4px;">Replying to ${safeUsername}</div>
        <div style="font-size: 13px; color: var(--ig-secondary-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${safeContent}</div>
      </div>
      <button id="cancel-reply-btn" style="background: none; border: none; color: var(--ig-secondary-text); cursor: pointer; font-size: 20px; padding: 4px; flex-shrink: 0;">✕</button>
    </div>
  `;
  
  console.log('Reply preview innerHTML set');
  
  // Clear previous preview and add new one
  replyContainer.innerHTML = '';
  replyContainer.appendChild(replyPreview);
  console.log('Reply preview HTML set');
  console.log('Container display:', window.getComputedStyle(replyContainer).display);
  console.log('Container visibility:', window.getComputedStyle(replyContainer).visibility);
  
  // Add click handler to cancel button
  const cancelBtn = document.getElementById('cancel-reply-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelReply);
    console.log('Cancel button listener added');
  }
  
  // Focus the input
  const chatInput = document.getElementById('chat-message-input');
  if (chatInput) {
    chatInput.focus();
    console.log('Input focused');
  }
  
  console.log('=== REPLY SETUP COMPLETE ===');
  InnovateAPI.showAlert('Replying to message', 'success');
}

// Cancel reply
function cancelReply() {
  console.log('Cancel reply called');
  
  window.replyingToMessageId = null;
  window.replyingToUsername = null;
  window.replyingToContent = null;
  
  const replyContainer = document.getElementById('reply-preview-container');
  if (replyContainer) {
    replyContainer.innerHTML = '';
  }
  
  console.log('Reply cancelled');
}

// Forward message
function forwardMessage(messageId) {
  InnovateAPI.showAlert('Forward functionality coming soon!', 'info');
  // TODO: Implement forward to other groups/users
}

// Edit message
function editMessage(messageId, currentContent) {
  const newContent = prompt('Edit message:', currentContent);
  if (!newContent || newContent === currentContent) return;
  
  InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/posts/${messageId}`, {
    method: 'PUT',
    body: JSON.stringify({ content: newContent })
  })
  .then(() => {
    InnovateAPI.showAlert('Message updated!', 'success');
    loadGroupChat();
  })
  .catch(error => {
    InnovateAPI.showAlert(error.message, 'error');
  });
}

// Delete message
function deleteMessage(messageId) {
  if (!confirm('Are you sure you want to delete this message?')) return;
  
  InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/posts/${messageId}`, {
    method: 'DELETE'
  })
  .then(() => {
    InnovateAPI.showAlert('Message deleted!', 'success');
    loadGroupChat();
  })
  .catch(error => {
    InnovateAPI.showAlert(error.message, 'error');
  });
}

// Make functions global
window.loadGroupChat = loadGroupChat;
window.showMessageMenu = showMessageMenu;
window.replyToMessage = replyToMessage;
window.cancelReply = cancelReply;
window.forwardMessage = forwardMessage;
window.editMessage = editMessage;
window.deleteMessage = deleteMessage;
