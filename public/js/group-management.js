// Group Management Functions

// Switch tabs in group settings modal
function switchGroupSettingsTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.group-settings-tab').forEach(tab => {
    tab.classList.remove('active');
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    }
  });
  
  // Update content
  document.querySelectorAll('.group-settings-content').forEach(content => {
    content.style.display = 'none';
  });
  document.getElementById(`${tabName}Tab`).style.display = 'block';
}

// Preview group picture in settings
function previewSettingsGroupPicture(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('settingsGroupPicture').src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
}

// Save group settings
async function saveGroupSettings(event, groupId) {
  event.preventDefault();
  
  const formData = new FormData();
  const name = document.getElementById('settingsGroupName').value;
  const description = document.getElementById('settingsGroupDescription').value;
  const isPublic = document.getElementById('settingsPrivacyToggle').classList.contains('active') ? 1 : 0;
  
  formData.append('name', name);
  formData.append('description', description);
  formData.append('is_public', isPublic);
  
  const profilePicture = document.getElementById('settingsProfilePicture').files[0];
  if (profilePicture) {
    formData.append('profile_picture', profilePicture);
  }
  
  try {
    const response = await fetch(`/api/community-groups/${groupId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${InnovateAPI.getToken()}`
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Failed to update group settings');
    }
    
    InnovateAPI.showAlert('Group settings updated successfully', 'success');
    
    // Close modal and reload
    document.querySelector('.ig-modal-overlay').remove();
    window.location.reload();
  } catch (error) {
    console.error('Error saving group settings:', error);
    InnovateAPI.showAlert(error.message, 'error');
  }
}

// Load group members
async function loadGroupMembers(groupId) {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${groupId}/members`);
    const membersList = document.getElementById('membersList');
    const currentUser = InnovateAPI.getCurrentUser();
    
    if (!response.members || response.members.length === 0) {
      membersList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--ig-secondary-text);">No members yet</div>';
      return;
    }
    
    let html = '';
    response.members.forEach(member => {
      const isCreator = member.role === 'creator';
      const isAdmin = member.role === 'admin' || member.role === 'creator';
      const canManage = response.userRole === 'creator' || response.userRole === 'admin';
      const isCurrentUser = member.user_id === currentUser.id;
      
      html += `
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid var(--ig-border);">
          <img src="${member.profile_picture || '/images/default-avatar.svg'}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">
          <div style="flex: 1;">
            <div style="font-weight: 600;">${member.username}</div>
            <div style="font-size: 13px; color: var(--ig-secondary-text);">
              ${isCreator ? '<i class="fas fa-crown" style="color: #FFD700;"></i> Creator' : isAdmin ? '<i class="fas fa-shield-alt" style="color: var(--ig-blue);"></i> Admin' : '<i class="fas fa-user"></i> Member'}
            </div>
          </div>
          ${canManage && !isCurrentUser ? `
            <div style="display: flex; gap: 8px;">
              ${!isCreator && response.userRole === 'creator' ? `
                <button onclick="makeAdmin(${groupId}, ${member.user_id})" style="padding: 6px 12px; background: var(--ig-blue); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;" title="Make Admin">
                  <i class="fas fa-shield-alt"></i>
                </button>
              ` : ''}
              ${!isCreator ? `
                <button onclick="removeMember(${groupId}, ${member.user_id})" style="padding: 6px 12px; background: var(--ig-error); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;" title="Remove">
                  <i class="fas fa-user-minus"></i>
                </button>
                <button onclick="blockMember(${groupId}, ${member.user_id})" style="padding: 6px 12px; background: #666; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;" title="Block">
                  <i class="fas fa-ban"></i>
                </button>
              ` : ''}
            </div>
          ` : ''}
        </div>
      `;
    });
    
    membersList.innerHTML = html;
  } catch (error) {
    console.error('Error loading members:', error);
    document.getElementById('membersList').innerHTML = '<div style="text-align: center; padding: 40px; color: var(--ig-error);">Failed to load members</div>';
  }
}

// Load join requests
async function loadJoinRequests(groupId) {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${groupId}/join-requests`);
    const requestsList = document.getElementById('requestsList');
    const badge = document.getElementById('requestsBadge');
    
    if (!response.requests || response.requests.length === 0) {
      requestsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--ig-secondary-text);"><i class="fas fa-user-clock" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px; display: block;"></i>No pending requests</div>';
      badge.style.display = 'none';
      return;
    }
    
    badge.style.display = 'inline';
    badge.textContent = response.requests.length;
    
    let html = '';
    response.requests.forEach(request => {
      html += `
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid var(--ig-border);">
          <img src="${request.profile_picture || '/images/default-avatar.svg'}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">
          <div style="flex: 1;">
            <div style="font-weight: 600;">${request.username}</div>
            <div style="font-size: 12px; color: var(--ig-secondary-text);">
              <i class="fas fa-clock"></i> ${InnovateAPI.formatDate(request.created_at)}
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button onclick="approveJoinRequest(${groupId}, ${request.user_id})" style="padding: 8px 16px; background: #38ef7d; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;">
              <i class="fas fa-check"></i> Approve
            </button>
            <button onclick="rejectJoinRequest(${groupId}, ${request.user_id})" style="padding: 8px 16px; background: var(--ig-error); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;">
              <i class="fas fa-times"></i> Reject
            </button>
          </div>
        </div>
      `;
    });
    
    requestsList.innerHTML = html;
  } catch (error) {
    console.error('Error loading requests:', error);
    document.getElementById('requestsList').innerHTML = '<div style="text-align: center; padding: 40px; color: var(--ig-error);">Failed to load requests</div>';
  }
}

// Load blocked members
async function loadBlockedMembers(groupId) {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${groupId}/blocked`);
    const blockedList = document.getElementById('blockedList');
    
    if (!response.blocked || response.blocked.length === 0) {
      blockedList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--ig-secondary-text);"><i class="fas fa-shield-alt" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px; display: block;"></i><div style="font-weight: 600; margin-bottom: 8px;">No blocked members</div><div style="font-size: 13px;">Members you block will appear here</div></div>';
      return;
    }
    
    let html = '';
    response.blocked.forEach(member => {
      html += `
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid var(--ig-border);">
          <img src="${member.profile_picture || '/images/default-avatar.svg'}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; filter: grayscale(100%);">
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--ig-secondary-text);">${member.username}</div>
            <div style="font-size: 12px; color: var(--ig-tertiary-text);">
              <i class="fas fa-ban"></i> Blocked ${InnovateAPI.formatDate(member.blocked_at)}
            </div>
          </div>
          <button onclick="unblockMember(${groupId}, ${member.user_id})" style="padding: 8px 16px; background: var(--ig-secondary-background); color: var(--ig-primary-text); border: 1px solid var(--ig-border); border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;">
            <i class="fas fa-unlock"></i> Unblock
          </button>
        </div>
      `;
    });
    
    blockedList.innerHTML = html;
  } catch (error) {
    console.error('Error loading blocked members:', error);
    document.getElementById('blockedList').innerHTML = '<div style="text-align: center; padding: 40px; color: var(--ig-error);">Failed to load blocked members</div>';
  }
}

// Make member admin
async function makeAdmin(groupId, userId) {
  if (!confirm('Make this member an admin?')) return;
  
  try {
    await InnovateAPI.apiRequest(`/community-groups/${groupId}/members/${userId}/promote`, {
      method: 'POST'
    });
    InnovateAPI.showAlert('Member promoted to admin', 'success');
    loadGroupMembers(groupId);
  } catch (error) {
    console.error('Error promoting member:', error);
    InnovateAPI.showAlert(error.message, 'error');
  }
}

// Remove member
async function removeMember(groupId, userId) {
  if (!confirm('Remove this member from the group?')) return;
  
  try {
    await InnovateAPI.apiRequest(`/community-groups/${groupId}/members/${userId}`, {
      method: 'DELETE'
    });
    InnovateAPI.showAlert('Member removed', 'success');
    loadGroupMembers(groupId);
  } catch (error) {
    console.error('Error removing member:', error);
    InnovateAPI.showAlert(error.message, 'error');
  }
}

// Block member
async function blockMember(groupId, userId) {
  if (!confirm('Block this member? They will be removed from the group and cannot rejoin.')) return;
  
  try {
    await InnovateAPI.apiRequest(`/community-groups/${groupId}/members/${userId}/block`, {
      method: 'POST'
    });
    InnovateAPI.showAlert('Member blocked', 'success');
    loadGroupMembers(groupId);
    loadBlockedMembers(groupId);
  } catch (error) {
    console.error('Error blocking member:', error);
    InnovateAPI.showAlert(error.message, 'error');
  }
}

// Unblock member
async function unblockMember(groupId, userId) {
  if (!confirm('Unblock this member?')) return;
  
  try {
    await InnovateAPI.apiRequest(`/community-groups/${groupId}/members/${userId}/unblock`, {
      method: 'POST'
    });
    InnovateAPI.showAlert('Member unblocked', 'success');
    loadBlockedMembers(groupId);
  } catch (error) {
    console.error('Error unblocking member:', error);
    InnovateAPI.showAlert(error.message, 'error');
  }
}

// Approve join request
async function approveJoinRequest(groupId, userId) {
  try {
    await InnovateAPI.apiRequest(`/community-groups/${groupId}/join-requests/${userId}/approve`, {
      method: 'POST'
    });
    InnovateAPI.showAlert('Request approved', 'success');
    loadJoinRequests(groupId);
    loadGroupMembers(groupId);
  } catch (error) {
    console.error('Error approving request:', error);
    InnovateAPI.showAlert(error.message, 'error');
  }
}

// Reject join request
async function rejectJoinRequest(groupId, userId) {
  try {
    await InnovateAPI.apiRequest(`/community-groups/${groupId}/join-requests/${userId}/reject`, {
      method: 'POST'
    });
    InnovateAPI.showAlert('Request rejected', 'success');
    loadJoinRequests(groupId);
  } catch (error) {
    console.error('Error rejecting request:', error);
    InnovateAPI.showAlert(error.message, 'error');
  }
}

// Show private group join request
function showPrivateGroupJoinRequest(groupId, group) {
  const modal = document.createElement('div');
  modal.className = 'ig-modal-overlay';
  modal.innerHTML = `
    <div class="ig-modal" style="max-width: 450px;">
      <div style="text-align: center; padding: 32px;">
        <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
          <i class="fas fa-lock" style="font-size: 36px; color: white;"></i>
        </div>
        <h2 style="margin-bottom: 12px; font-size: 22px;">Private Group</h2>
        <div style="color: var(--ig-secondary-text); margin-bottom: 24px; line-height: 1.6;">
          <strong>${group.name}</strong> is a private group. Request to join and an admin will review your request.
        </div>
        ${group.description ? `
          <div style="background: var(--ig-secondary-background); border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: left;">
            <div style="font-size: 12px; font-weight: 600; color: var(--ig-secondary-text); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Description</div>
            <div style="font-size: 14px; color: var(--ig-primary-text);">${group.description}</div>
          </div>
        ` : ''}
        <div style="display: flex; gap: 12px;">
          <button onclick="requestToJoinGroup(${groupId})" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 15px;">
            <i class="fas fa-paper-plane"></i> Send Request
          </button>
          <button onclick="this.closest('.ig-modal-overlay').remove()" style="flex: 1; padding: 14px; background: var(--ig-secondary-background); color: var(--ig-primary-text); border: 1px solid var(--ig-border); border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 15px;">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Request to join group
async function requestToJoinGroup(groupId) {
  try {
    await InnovateAPI.apiRequest(`/community-groups/${groupId}/request-join`, {
      method: 'POST'
    });
    document.querySelector('.ig-modal-overlay').remove();
    InnovateAPI.showAlert('Join request sent! An admin will review it.', 'success');
  } catch (error) {
    console.error('Error requesting to join:', error);
    InnovateAPI.showAlert(error.message, 'error');
  }
}
