let currentTab = 'donations';
let donations = [];
let imagesToUpload = [];
let imagePreviewUrls = []; // Store blob URLs
let completionPhotosToUpload = [];

document.addEventListener('DOMContentLoaded', () => {
  InnovateAPI.requireAuth();
  updateStats();
  loadDonations();
  
  // Mobile search toggle
  const mobileSearchBtn = document.getElementById('mobileSearchBtn');
  const mobileSearchOverlay = document.getElementById('mobileSearchOverlay');
  const closeMobileSearch = document.getElementById('closeMobileSearch');
  
  if (mobileSearchBtn) {
    mobileSearchBtn.addEventListener('click', () => {
      mobileSearchOverlay.style.display = 'flex';
      document.getElementById('searchInputMobile').focus();
    });
  }
  
  if (closeMobileSearch) {
    closeMobileSearch.addEventListener('click', () => {
      mobileSearchOverlay.style.display = 'none';
    });
  }
  
  // Search functionality (both desktop and mobile)
  const searchInputs = [document.getElementById('searchInput'), document.getElementById('searchInputMobile')];
  searchInputs.forEach(input => {
    if (input) {
      input.addEventListener('input', (e) => {
        filterDonations(e.target.value);
      });
    }
  });
});

function switchTab(tab) {
  // Update active tab
  currentTab = tab;
  
  // Update tab buttons
  document.querySelectorAll('.ss-tab').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`${tab}-tab`).classList.add('active');
  
  // Hide all content
  document.getElementById('donations-content').style.display = 'none';
  document.getElementById('mine-content').style.display = 'none';
  document.getElementById('picked-content').style.display = 'none';
  
  // Show active content
  document.getElementById(`${tab}-content`).style.display = 'block';
  
  // Load data
  if (tab === 'donations') {
    loadDonations();
  } else if (tab === 'mine') {
    loadMyDonations();
  } else if (tab === 'picked') {
    loadPickedDonations();
  }
}

async function updateStats() {
  try {
    const response = await InnovateAPI.apiRequest('/social-service/stats');
    const stats = response.stats || { total: 0, active: 0, completed: 0 };
    
    document.getElementById('stat-total').textContent = stats.total || 0;
    document.getElementById('stat-active').textContent = stats.active || 0;
    document.getElementById('stat-completed').textContent = stats.completed || 0;
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

function filterDonations(searchTerm) {
  const term = searchTerm.toLowerCase().trim();
  const cards = document.querySelectorAll('.ss-card');
  
  cards.forEach(card => {
    const title = card.querySelector('.ss-card-title')?.textContent.toLowerCase() || '';
    const category = card.querySelector('.ss-card-category')?.textContent.toLowerCase() || '';
    const description = card.querySelector('.ss-card-description')?.textContent.toLowerCase() || '';
    
    const matches = !term || title.includes(term) || category.includes(term) || description.includes(term);
    card.style.display = matches ? '' : 'none';
  });
}

async function loadDonations() {
  try {
    const response = await InnovateAPI.apiRequest('/social-service/donations');
    donations = response.donations || [];
    renderDonations('donations-list', donations);
  } catch (err) {
    console.error('Error loading donations:', err);
    document.getElementById('donations-list').innerHTML = renderErrorState('Error loading donations');
  }
}

async function loadMyDonations() {
  try {
    const response = await InnovateAPI.apiRequest('/social-service/my-donations');
    const myDonations = response.donations || [];
    renderDonations('mine-list', myDonations, true);
  } catch (err) {
    console.error('Error loading my donations:', err);
    document.getElementById('mine-list').innerHTML = renderErrorState('Error loading your donations');
  }
}

async function loadPickedDonations() {
  try {
    const response = await InnovateAPI.apiRequest('/social-service/picked-donations');
    const pickedDonations = response.donations || [];
    renderDonations('picked-list', pickedDonations, false, true);
  } catch (err) {
    console.error('Error loading picked donations:', err);
    document.getElementById('picked-list').innerHTML = renderErrorState('Error loading picked donations');
  }
}

function renderDonations(containerId, items, isOwner = false, isPicked = false) {
  const container = document.getElementById(containerId);
  const currentUser = InnovateAPI.getCurrentUser();
  
  if (!items || items.length === 0) {
    container.innerHTML = renderEmptyState(currentTab);
    return;
  }
  
  const html = items.map(donation => {
    let images = [];
    if (donation.images) {
      try {
        images = JSON.parse(donation.images);
      } catch (e) {
        images = [];
      }
    }
    
    const hasImages = images.length > 0;
    const firstImage = hasImages ? images[0] : '';
    const imageCount = images.length;
    
    // Status label for chip
    let statusLabel = 'Available';
    if (donation.status === 'assigned') {
      statusLabel = 'Assigned';
    } else if (donation.status === 'completed') {
      statusLabel = 'Completed';
    }
    
    // Location display
    const location = donation.city ? `${donation.city} · ${donation.address || 'Address not specified'}` : (donation.address || 'Location not specified');
    
    // Check if it's my donation
    const isMyDonation = currentUser && donation.user_id === currentUser.id;
    const mineChip = isMyDonation ? `<span style="margin-left:auto; color: rgba(0,149,246,0.9); font-weight:700;">You</span>` : '';
    
    return `
      <div class="ss-card" onclick="openDonationDetail(${donation.id})">
        <div class="ss-card-media">
          ${hasImages ? 
            `<img src="${firstImage}" alt="${donation.title}" loading="lazy" onerror="this.style.display='none'; this.parentElement.classList.add('ss-no-image');">` :
            `<div class="ss-placeholder-image">
              <i class="fas fa-hands-helping" style="font-size: 48px; color: rgba(255,255,255,0.3);"></i>
            </div>`
          }
          <div class="ss-status-chip ss-status-${donation.status}">${statusLabel}</div>
          ${imageCount > 1 ? `
            <div class="ss-image-count-chip">
              <i class="fas fa-images"></i> ${imageCount}
            </div>
          ` : ''}
        </div>
        <div class="ss-card-body">
          <div class="ss-card-title">${donation.title}</div>
          <div class="ss-card-meta">
            <span>${location}</span>
            ${donation.category ? `<span>•</span><span>${donation.category}</span>` : ''}
            <span>•</span>
            <span>@${donation.username}</span>
            ${mineChip}
          </div>
          <div class="ss-card-time">${formatTime(donation.created_at)}</div>
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

function renderEmptyState(tab) {
  const messages = {
    'donations': {
      icon: 'fa-hand-holding-heart',
      title: 'No donations yet',
      message: 'Be the first to donate and make a difference!'
    },
    'mine': {
      icon: 'fa-box-open',
      title: 'No donations',
      message: 'Create your first donation to help others.'
    },
    'picked': {
      icon: 'fa-check-circle',
      title: 'No pickups yet',
      message: 'Pick up donations to help your community!'
    }
  };
  
  const state = messages[tab] || messages['donations'];
  
  return `
    <div class="ss-empty-state">
      <i class="fas ${state.icon}"></i>
      <h3>${state.title}</h3>
      <p>${state.message}</p>
    </div>
  `;
}

function renderErrorState(message) {
  return `
    <div class="ss-empty-state">
      <i class="fas fa-exclamation-circle" style="color: var(--ig-error-color);"></i>
      <h3>Oops!</h3>
      <p>${message}</p>
      <button onclick="location.reload()" class="ss-btn ss-btn-secondary" style="margin-top: 16px;">
        <i class="fas fa-redo"></i> Retry
      </button>
    </div>
  `;
}

function openCreateModal() {
  document.getElementById('modal-title').textContent = 'Create Donation';
  document.getElementById('donation-form').reset();
  document.getElementById('donation-id').value = '';
  document.getElementById('image-preview').innerHTML = '';
  
  // Clean up old blob URLs
  imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
  imagesToUpload = [];
  imagePreviewUrls = [];
  
  document.getElementById('create-modal').style.display = 'flex';
}

function closeCreateModal() {
  // Clean up blob URLs when closing
  imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
  imagesToUpload = [];
  imagePreviewUrls = [];
  
  document.getElementById('create-modal').style.display = 'none';
}

function editDonation(donationId) {
  const donation = donations.find(d => d.id === donationId);
  if (!donation) return;
  
  document.getElementById('modal-title').textContent = 'Edit Donation';
  document.getElementById('donation-id').value = donation.id;
  document.getElementById('donation-title').value = donation.title;
  document.getElementById('donation-category').value = donation.category || '';
  document.getElementById('donation-city').value = donation.city || '';
  document.getElementById('donation-description').value = donation.description || '';
  document.getElementById('donation-address').value = donation.address;
  document.getElementById('donation-latitude').value = donation.latitude || '';
  document.getElementById('donation-longitude').value = donation.longitude || '';
  
  // Show existing images
  let images = [];
  try {
    images = JSON.parse(donation.images || '[]');
  } catch (e) {
    images = [];
  }
  
  if (images.length > 0) {
    const previewHtml = images.map(img => `
      <div class="ss-image-preview-item">
        <img src="${img}" alt="Existing">
        <div style="text-align: center; margin-top: 4px; font-size: 11px; color: var(--ig-secondary-text);">Existing</div>
      </div>
    `).join('');
    document.getElementById('image-preview').innerHTML = previewHtml;
  }
  
  // Clean up old blob URLs
  imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
  imagesToUpload = [];
  imagePreviewUrls = [];
  
  document.getElementById('create-modal').style.display = 'flex';
}

function previewImages() {
  const input = document.getElementById('donation-images');
  const preview = document.getElementById('image-preview');
  
  // Append new files to existing ones instead of replacing
  if (input.files.length > 0) {
    const newFiles = Array.from(input.files);
    newFiles.forEach(file => {
      if (imagesToUpload.length < 5 && !imagesToUpload.find(f => f.name === file.name && f.size === file.size)) {
        imagesToUpload.push(file);
        imagePreviewUrls.push(URL.createObjectURL(file)); // Create URL once
      }
    });
    
    // Limit to 5 photos
    if (imagesToUpload.length > 5) {
      // Revoke excess URLs
      for (let i = 5; i < imagePreviewUrls.length; i++) {
        URL.revokeObjectURL(imagePreviewUrls[i]);
      }
      imagesToUpload = imagesToUpload.slice(0, 5);
      imagePreviewUrls = imagePreviewUrls.slice(0, 5);
    }
    
    // Clear the file input so the same file can be selected again if needed
    input.value = '';
  }
  
  // Render preview using stored URLs
  if (imagesToUpload.length === 0) {
    preview.innerHTML = '';
    return;
  }
  
  preview.innerHTML = imagesToUpload.map((file, index) => `
    <div class="ss-image-preview-item" data-index="${index}">
      <img src="${imagePreviewUrls[index]}" alt="Preview ${index + 1}">
      <button type="button" class="ss-image-remove" data-index="${index}">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
  
  // Attach event listeners to remove buttons
  setTimeout(() => {
    document.querySelectorAll('.ss-image-remove').forEach(btn => {
      btn.addEventListener('click', function() {
        const idx = parseInt(this.getAttribute('data-index'));
        removeImageAtIndex(idx);
      });
    });
  }, 0);
}

// Function for removing images
function removeImageAtIndex(index) {
  if (index >= 0 && index < imagesToUpload.length) {
    // Revoke the blob URL for the image being removed
    URL.revokeObjectURL(imagePreviewUrls[index]);
    
    // Remove from both arrays
    imagesToUpload.splice(index, 1);
    imagePreviewUrls.splice(index, 1);
    
    // Re-render preview
    previewImages();
  }
}

function getAddress() {
  const btn = event.target.closest('button');
  const originalText = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting address...';
  
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser');
    btn.disabled = false;
    btn.innerHTML = originalText;
    return;
  }
  
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      
      document.getElementById('donation-latitude').value = lat;
      document.getElementById('donation-longitude').value = lon;
      
      // Reverse geocode to get address
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
        .then(res => res.json())
        .then(data => {
          if (data.display_name) {
            document.getElementById('donation-address').value = data.display_name;
          }
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-check"></i> Address filled!';
          setTimeout(() => {
            btn.innerHTML = originalText;
          }, 2000);
        })
        .catch(() => {
          btn.disabled = false;
          btn.innerHTML = originalText;
        });
    },
    (error) => {
      alert('Unable to get your location: ' + error.message);
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  );
}

function shareLocation() {
  const btn = event.target.closest('button');
  const originalText = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting location...';
  
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser');
    btn.disabled = false;
    btn.innerHTML = originalText;
    return;
  }
  
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      
      document.getElementById('donation-latitude').value = lat;
      document.getElementById('donation-longitude').value = lon;
      
      // Create shareable Google Maps link
      const mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
      
      // Copy to clipboard
      navigator.clipboard.writeText(mapsLink).then(() => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Link copied!';
        alert(`Location link copied to clipboard!\n\nPickup helpers will receive this link to navigate to your location.\n\n${mapsLink}`);
        setTimeout(() => {
          btn.innerHTML = originalText;
        }, 2000);
      }).catch(() => {
        // Fallback: show link in alert
        alert(`Share this location link with pickup helpers:\n\n${mapsLink}`);
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    },
    (error) => {
      alert('Unable to get your location: ' + error.message);
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  );
}

async function submitDonation() {
  const donationId = document.getElementById('donation-id').value;
  const title = document.getElementById('donation-title').value.trim();
  const description = document.getElementById('donation-description').value.trim();
  const address = document.getElementById('donation-address').value.trim();
  const category = document.getElementById('donation-category').value.trim();
  const city = document.getElementById('donation-city').value.trim();
  const latitude = document.getElementById('donation-latitude').value;
  const longitude = document.getElementById('donation-longitude').value;
  
  if (!title || !address) {
    alert('Please fill in all required fields');
    return;
  }
  
  const formData = new FormData();
  formData.append('title', title);
  formData.append('description', description);
  formData.append('address', address);
  if (category) formData.append('category', category);
  if (city) formData.append('city', city);
  if (latitude) formData.append('latitude', latitude);
  if (longitude) formData.append('longitude', longitude);
  
  imagesToUpload.forEach(file => {
    formData.append('images', file);
  });
  
  try {
    const url = donationId 
      ? `/api/social-service/donations/${donationId}`
      : '/api/social-service/donations';
    
    const method = donationId ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${InnovateAPI.getToken()}`
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Failed to save donation');
    }
    
    closeCreateModal();
    updateStats();
    
    if (currentTab === 'donations') {
      await loadDonations();
    } else if (currentTab === 'mine') {
      await loadMyDonations();
    }
    
    alert(donationId ? 'Donation updated successfully!' : 'Donation created successfully!');
  } catch (err) {
    console.error('Error saving donation:', err);
    alert('Failed to save donation. Please try again.');
  }
}

async function deleteDonation(donationId) {
  if (!confirm('Are you sure you want to delete this donation?')) return;
  
  try {
    await InnovateAPI.apiRequest(`/social-service/donations/${donationId}`, {
      method: 'DELETE'
    });
    
    updateStats();
    
    if (currentTab === 'donations') {
      await loadDonations();
    } else if (currentTab === 'mine') {
      await loadMyDonations();
    }
    
    alert('Donation deleted successfully!');
  } catch (err) {
    console.error('Error deleting donation:', err);
    alert('Failed to delete donation. Please try again.');
  }
}

async function pickupDonation(donationId) {
  if (!confirm('Do you want to pick up this donation?')) return;
  
  try {
    await InnovateAPI.apiRequest(`/social-service/donations/${donationId}/pickup`, {
      method: 'POST'
    });
    
    updateStats();
    await loadDonations();
    
    alert('Great! You have been assigned this donation. Please contact the donor to arrange pickup.');
  } catch (err) {
    console.error('Error picking up donation:', err);
    alert('Failed to pick up donation. Please try again.');
  }
}

function openCompletionModal(donationId) {
  document.getElementById('completion-donation-id').value = donationId;
  document.getElementById('completion-preview').innerHTML = '';
  completionPhotosToUpload = [];
  document.getElementById('completion-modal').style.display = 'flex';
}

function closeCompletionModal() {
  document.getElementById('completion-modal').style.display = 'none';
}

function previewCompletionPhotos() {
  const input = document.getElementById('completion-photos');
  const preview = document.getElementById('completion-preview');
  
  if (input.files.length === 0) return;
  
  completionPhotosToUpload = Array.from(input.files).slice(0, 5);
  
  preview.innerHTML = completionPhotosToUpload.map((file, index) => `
    <div class="ss-image-preview-item">
      <img src="${URL.createObjectURL(file)}" alt="Preview ${index + 1}">
      <button type="button" onclick="removeCompletionPhoto(${index})" class="ss-image-remove">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
}

function removeCompletionPhoto(index) {
  completionPhotosToUpload.splice(index, 1);
  
  const dt = new DataTransfer();
  completionPhotosToUpload.forEach(file => dt.items.add(file));
  document.getElementById('completion-photos').files = dt.files;
  
  previewCompletionPhotos();
}

async function uploadCompletionPhotos() {
  const donationId = document.getElementById('completion-donation-id').value;
  
  if (completionPhotosToUpload.length === 0) {
    alert('Please upload at least one completion photo');
    return;
  }
  
  const formData = new FormData();
  completionPhotosToUpload.forEach(file => {
    formData.append('completion_photos', file);
  });
  
  try {
    const response = await fetch(`/api/social-service/donations/${donationId}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${InnovateAPI.getToken()}`
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Failed to complete donation');
    }
    
    closeCompletionModal();
    updateStats();
    
    if (currentTab === 'picked') {
      await loadPickedDonations();
    } else {
      await loadDonations();
    }
    
    alert('Donation marked as complete. Thank you for your service!');
  } catch (err) {
    console.error('Error completing donation:', err);
    alert('Failed to complete donation. Please try again.');
  }
}

function openDonationDetail(donationId) {
  const donation = donations.find(d => d.id === donationId);
  if (!donation) return;
  
  const user = InnovateAPI.getCurrentUser();
  const isMyDonation = user && donation.user_id === user.id;
  const canPickup = !isMyDonation && donation.status === 'available' && !donation.picked_by;
  const canComplete = donation.status === 'assigned' && donation.picked_by === user?.id;
  
  // Parse images
  let images = [];
  try {
    images = JSON.parse(donation.images || '[]');
  } catch (e) {
    images = [];
  }
  
  // Parse completion photos
  let completionPhotos = [];
  try {
    completionPhotos = JSON.parse(donation.completion_photos || '[]');
  } catch (e) {
    completionPhotos = [];
  }
  
  // Render images
  const imagesContainer = document.getElementById('detail-images-container');
  if (images.length > 0) {
    window.currentDonationImages = images;
    window.currentImageIndex = 0;
    
    const renderDonationImages = () => {
      const idx = window.currentImageIndex;
      imagesContainer.innerHTML = `
        <img src="${images[idx]}" 
             alt="Donation" 
             style="max-width: 100%; max-height: 100%; object-fit: contain;"
             onerror="this.style.display='none'">
        ${images.length > 1 ? `
          <button onclick="event.stopPropagation(); window.prevDonationImage()" 
                  class="ss-image-nav ss-image-nav-prev"
                  style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); border: none; color: white; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; display: ${idx > 0 ? 'flex' : 'none'}; align-items:center; justify-content:center;">
            <i class="fas fa-chevron-left"></i>
          </button>
          <button onclick="event.stopPropagation(); window.nextDonationImage()" 
                  class="ss-image-nav ss-image-nav-next"
                  style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); border: none; color: white; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; display: ${idx < images.length - 1 ? 'flex' : 'none'}; align-items:center; justify-content:center;">
            <i class="fas fa-chevron-right"></i>
          </button>
          <div style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); padding: 6px 12px; border-radius: 20px; color: white; font-size: 12px;">
            ${idx + 1} / ${images.length}
          </div>
        ` : ''}
      `;
    };
    
    window.renderDonationImages = renderDonationImages;
    window.prevDonationImage = () => {
      if (window.currentImageIndex > 0) {
        window.currentImageIndex--;
        window.renderDonationImages();
      }
    };
    window.nextDonationImage = () => {
      if (window.currentImageIndex < images.length - 1) {
        window.currentImageIndex++;
        window.renderDonationImages();
      }
    };
    
    renderDonationImages();
  } else {
    imagesContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--ig-secondary-text);">
        <div style="text-align: center;">
          <i class="fas fa-image" style="font-size: 64px; opacity: 0.3; margin-bottom: 16px;"></i>
          <div>No images</div>
        </div>
      </div>
    `;
  }
  
  // User info
  document.getElementById('detail-user-info').innerHTML = `
    <a href="/profile/${donation.user_id}" style="display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--ig-primary-text);">
      <img src="${donation.profile_picture || '/images/default-avatar.svg'}" 
           alt="${donation.username}" 
           style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid var(--ig-border);"
           onerror="this.src='/images/default-avatar.svg'">
      <div>
        <div style="font-weight: 700; font-size: 16px;">${donation.username}</div>
        <div style="font-size: 12px; color: var(--ig-secondary-text);">${formatTime(donation.created_at)}</div>
      </div>
    </a>
  `;
  
  // Title and status
  document.getElementById('detail-title').textContent = donation.title;
  let statusBadge = '';
  if (donation.status === 'available') {
    statusBadge = '<span class=\"ss-badge-available\">Available</span>';
  } else if (donation.status === 'assigned') {
    statusBadge = '<span class=\"ss-badge-assigned\">Assigned</span>';
  } else if (donation.status === 'completed') {
    statusBadge = '<span class=\"ss-badge-completed\">Completed</span>';
  }
  document.getElementById('detail-status-badge').innerHTML = statusBadge;
  
  // Meta
  let metaHtml = '';
  if (donation.category || donation.city) {
    metaHtml = `
      ${donation.category ? `<span class=\"ss-card-category\"><i class=\"fas fa-tag\"></i> ${donation.category}</span>` : ''}
      ${donation.city ? `<span class=\"ss-card-city\"><i class=\"fas fa-map-pin\"></i> ${donation.city}</span>` : ''}
    `;
  }
  document.getElementById('detail-meta').innerHTML = metaHtml;
  
  // Description
  document.getElementById('detail-description').innerHTML = donation.description ? 
    `<p style="margin: 0;">${donation.description}</p>` : 
    '<p style="margin: 0; color: var(--ig-secondary-text); font-style: italic;">No description provided</p>';
  
  // Location
  document.getElementById('detail-location').innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; color: var(--ig-secondary-text);">
      <i class="fas fa-map-marker-alt" style="color: #ed4956;"></i>
      <span>${donation.address}</span>
    </div>
  `;
  
  // Picker info
  if (donation.status === 'assigned' && donation.picker_username) {
    document.getElementById('detail-picker-info').innerHTML = `
      <div style="margin-top: 16px; padding: 12px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); border-radius: 8px;">
        <i class="fas fa-user-check" style="color: #f59e0b;"></i>
        <span style="color: var(--ig-primary-text); margin-left: 8px;">Picked by <strong>${donation.picker_username}</strong></span>
      </div>
    `;
  } else {
    document.getElementById('detail-picker-info').innerHTML = '';
  }
  
  // Completion photos
  if (completionPhotos.length > 0) {
    document.getElementById('detail-completion-photos').innerHTML = `
      <div style="margin-top: 16px;">
        <div style="font-weight: 700; margin-bottom: 12px; color: #10b981;">
          <i class="fas fa-check-circle"></i> Completion Photos
        </div>
        <div class="ss-completion-grid">
          ${completionPhotos.map(photo => `
            <img src="${photo}" alt="Completion" onclick="viewImage('${photo}')" 
                 style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px; cursor: pointer;">
          `).join('')}
        </div>
      </div>
    `;
  } else {
    document.getElementById('detail-completion-photos').innerHTML = '';
  }
  
  // Share location link
  if (donation.latitude && donation.longitude) {
    const mapsLink = `https://www.google.com/maps?q=${donation.latitude},${donation.longitude}`;
    document.getElementById('detail-share-link').innerHTML = `
      <a href="${mapsLink}" target="_blank" 
         style="display: flex; align-items: center; gap: 8px; padding: 12px; background: rgba(0,149,246,0.1); border: 1px solid rgba(0,149,246,0.3); border-radius: 8px; text-decoration: none; color: #0095f6; font-weight: 600;">
        <i class="fas fa-map-marked-alt"></i>
        <span>View on Google Maps</span>
      </a>
    `;
  } else {
    document.getElementById('detail-share-link').innerHTML = '';
  }
  
  // Action buttons
  let actionsHtml = '';
  if (isMyDonation) {
    actionsHtml = `
      <div style="display: flex; gap: 12px;">
        <button onclick="editDonation(${donation.id}); closeDonationDetail();" 
                class="ss-btn ss-btn-secondary" 
                style="flex: 1;">
          <i class="fas fa-edit"></i> Edit Donation
        </button>
        <button onclick="if(confirm('Are you sure you want to delete this donation?')) { deleteDonation(${donation.id}); closeDonationDetail(); }" 
                class="ss-btn" 
                style="flex: 1; background: rgba(237,73,86,0.1); color: #ed4956; border: 1px solid rgba(237,73,86,0.3);">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    `;
  } else if (canPickup) {
    actionsHtml = `
      <button onclick="pickupDonation(${donation.id}); closeDonationDetail();" 
              class="ss-btn ss-btn-primary" 
              style="width: 100%;">
        <i class="fas fa-hands-helping"></i> Pick Up This Donation
      </button>
    `;
  } else if (canComplete) {
    actionsHtml = `
      <button onclick="openCompletionModal(${donation.id}); closeDonationDetail();" 
              class="ss-btn ss-btn-success" 
              style="width: 100%;">
        <i class="fas fa-check-double"></i> Mark as Complete
      </button>
    `;
  }
  document.getElementById('detail-actions').innerHTML = actionsHtml;
  
  // Show modal
  document.getElementById('donation-detail-modal').style.display = 'flex';
}

function closeDonationDetail() {
  document.getElementById('donation-detail-modal').style.display = 'none';
}

function viewImage(url) {
  window.open(url, '_blank');
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
