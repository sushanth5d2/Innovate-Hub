let currentTab = 'donations';
let donations = [];
let imagesToUpload = [];
let imagePreviewUrls = []; // Store blob URLs
let completionPhotosToUpload = [];
let filterState = {
  city: '',
  category: '',
  searchQuery: ''
};
let donationMap = null;
let mapMarkers = [];
let userLocationMarker = null;
let userLocation = null;
let mapSettings = {
  showOnMap: true,
  proximityNotifications: false,
  proximityDistance: 500
};

document.addEventListener('DOMContentLoaded', () => {
  InnovateAPI.requireAuth();
  updateStats();
  loadDonations();
  
  // Initialize Socket.IO and listen for nearby donation notifications
  const socket = InnovateAPI.getSocket();
  if (socket) {
    socket.on('notification:received', (notification) => {
      if (notification.type === 'nearby_donation') {
        // Show visual notification
        showNearbyNotification(notification);
        
        // Refresh nearby donations list if on map tab and proximity enabled
        if (currentTab === 'map' && mapSettings.proximityNotifications) {
          setTimeout(() => {
            loadNearbyDonations();
          }, 1000);
        }
      }
    });
  }
  
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
        filterState.searchQuery = e.target.value;
        applyAllFilters();
      });
    }
  });

  // Filter buttons
  const filtersBtn = document.getElementById('filtersBtn');
  const filtersOverlay = document.getElementById('filtersOverlay');
  const closeFiltersBtn = document.getElementById('closeFilters');
  const applyFiltersBtn = document.getElementById('applyFilters');
  const clearFiltersBtn = document.getElementById('clearFilters');
  const cityBtn = document.getElementById('cityBtn');

  if (filtersBtn) filtersBtn.addEventListener('click', openFilters);
  if (filtersOverlay) {
    filtersOverlay.addEventListener('click', (e) => {
      if (e.target.id === 'filtersOverlay') closeFilters();
    });
  }
  if (closeFiltersBtn) closeFiltersBtn.addEventListener('click', closeFilters);
  if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', applyFilters);
  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);
  
  // City button - opens filters and focuses on city dropdown
  if (cityBtn) {
    cityBtn.addEventListener('click', () => {
      openFilters();
      const filterCity = document.getElementById('filterCity');
      if (filterCity) filterCity.focus();
    });
  }
});

function switchTab(tab) {
  // Update active tab
  currentTab = tab;
  
  // Update tab buttons - updated to use exp-tab class
  document.querySelectorAll('.exp-tab').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`${tab}-tab`).classList.add('active');
  
  // Hide all content
  document.getElementById('overview-content').style.display = 'none';
  document.getElementById('donations-content').style.display = 'none';
  document.getElementById('mine-content').style.display = 'none';
  document.getElementById('picked-content').style.display = 'none';
  document.getElementById('map-content').style.display = 'none';
  
  // Show active content
  document.getElementById(`${tab}-content`).style.display = 'block';
  
  // Load data
  if (tab === 'overview') {
    updateStats();
  } else if (tab === 'donations') {
    loadDonations();
  } else if (tab === 'mine') {
    loadMyDonations();
  } else if (tab === 'picked') {
    loadPickedDonations();
  } else if (tab === 'map') {
    loadMapView();
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

// Filter functions
function openFilters() {
  const filtersDrawer = document.getElementById('filtersDrawer');
  const filtersOverlay = document.getElementById('filtersOverlay');
  if (filtersDrawer) filtersDrawer.classList.add('open');
  if (filtersOverlay) filtersOverlay.classList.add('open');
}

function closeFilters() {
  const filtersDrawer = document.getElementById('filtersDrawer');
  const filtersOverlay = document.getElementById('filtersOverlay');
  if (filtersDrawer) filtersDrawer.classList.remove('open');
  if (filtersOverlay) filtersOverlay.classList.remove('open');
}

function applyFilters() {
  const city = document.getElementById('filterCity').value;
  const category = document.getElementById('filterCategory').value;
  
  filterState.city = city;
  filterState.category = category;
  
  // Update city button label
  const cityLabel = document.getElementById('cityLabel');
  if (cityLabel) {
    cityLabel.textContent = city || 'All Cities';
  }
  
  // Update page title and subtitle based on city
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');
  if (pageTitle) {
    if (city) {
      pageTitle.textContent = `Social Service in ${city}`;
    } else {
      pageTitle.textContent = 'Social Service';
    }
  }
  if (pageSubtitle) {
    pageSubtitle.textContent = 'Donate items you don\'t need or help pick up donations';
  }
  
  closeFilters();
  applyAllFilters();
}

function clearFilters() {
  document.getElementById('filterCity').value = '';
  document.getElementById('filterCategory').value = '';
  filterState.city = '';
  filterState.category = '';
  filterState.searchQuery = '';
  
  document.getElementById('searchInput').value = '';
  const mobileSearch = document.getElementById('searchInputMobile');
  if (mobileSearch) mobileSearch.value = '';
  
  // Reset city button label
  const cityLabel = document.getElementById('cityLabel');
  if (cityLabel) {
    cityLabel.textContent = 'All Cities';
  }
  
  // Reset page title
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) {
    pageTitle.textContent = 'Social Service';
  }
  
  closeFilters();
  applyAllFilters();
}

function applyAllFilters() {
  const cards = document.querySelectorAll('.ss-card');
  
  cards.forEach(card => {
    const title = card.querySelector('.ss-card-title')?.textContent.toLowerCase() || '';
    const meta = card.querySelector('.ss-card-meta')?.textContent.toLowerCase() || '';
    
    // Check search query match
    const searchMatches = !filterState.searchQuery || 
      title.includes(filterState.searchQuery.toLowerCase()) || 
      meta.includes(filterState.searchQuery.toLowerCase());
    
    // Check city match
    const cityMatches = !filterState.city || meta.includes(filterState.city.toLowerCase());
    
    // Check category match
    const categoryMatches = !filterState.category || meta.includes(filterState.category.toLowerCase());
    
    // Show card only if all filters match
    card.style.display = (searchMatches && cityMatches && categoryMatches) ? '' : 'none';
  });
}

function populateFilters() {
  const cities = new Set();
  const categories = new Set();
  
  donations.forEach(donation => {
    if (donation.city) cities.add(donation.city);
    if (donation.category) categories.add(donation.category);
  });
  
  // Populate city dropdown
  const citySelect = document.getElementById('filterCity');
  if (citySelect) {
    citySelect.innerHTML = '<option value="">All Cities</option>';
    Array.from(cities).sort().forEach(city => {
      const option = document.createElement('option');
      option.value = city;
      option.textContent = city;
      citySelect.appendChild(option);
    });
  }
  
  // Populate category dropdown
  const categorySelect = document.getElementById('filterCategory');
  if (categorySelect) {
    categorySelect.innerHTML = '<option value="">All Categories</option>';
    Array.from(categories).sort().forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categorySelect.appendChild(option);
    });
  }
}

function filterDonations(searchTerm) {
  filterState.searchQuery = searchTerm;
  applyAllFilters();
}

async function loadDonations() {
  try {
    const response = await InnovateAPI.apiRequest('/social-service/donations');
    donations = response.donations || [];
    populateFilters();
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
  document.getElementById('donation-phone').value = donation.phone || '';
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
  const phone = document.getElementById('donation-phone').value.trim();
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
  if (phone) formData.append('phone', phone);
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

async function unassignDonation(donationId) {
  if (!confirm('Are you sure you want to unassign yourself from this donation? It will become available for others to pick up.')) return;
  
  try {
    await InnovateAPI.apiRequest(`/social-service/donations/${donationId}/unassign`, {
      method: 'POST'
    });
    
    updateStats();
    await loadDonations();
    
    alert('You have been unassigned from this donation. It is now available for others to pick up.');
  } catch (err) {
    console.error('Error unassigning donation:', err);
    alert('Failed to unassign donation. Please try again.');
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
    ${donation.phone ? `
      <div style="display: flex; align-items: center; gap: 8px; color: var(--ig-secondary-text); margin-top: 10px;">
        <i class="fas fa-phone" style="color: #0095f6;"></i>
        <span>${donation.phone}</span>
      </div>
    ` : ''}
  `;
  
  // Picker info
  if (donation.status === 'assigned' && donation.picker_username) {
    const pickerAvatar = donation.picker_profile_picture || '/images/default-avatar.svg';
    const pickerUserId = donation.picker_user_id || donation.picked_by;
    
    console.log('Picker info:', { picker_user_id: donation.picker_user_id, picked_by: donation.picked_by, avatar: pickerAvatar });
    
    document.getElementById('detail-picker-info').innerHTML = `
      <div style="margin-top: 16px; padding: 12px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; display: flex; align-items: center; gap: 12px;">
        <div onclick="window.location.href='/profile/${pickerUserId}'" style="cursor: pointer; flex-shrink: 0;" title="View ${donation.picker_username}'s profile">
          <img src="${pickerAvatar}" 
               alt="${donation.picker_username}" 
               style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #f59e0b;"
               onerror="this.src='/images/default-avatar.svg'">
        </div>
        <div style="flex: 1;">
          <div style="color: var(--ig-secondary-text); font-size: 12px; margin-bottom: 2px;">Picked by</div>
          <div onclick="window.location.href='/profile/${pickerUserId}'" 
               style="color: var(--ig-primary-text); font-weight: 700; font-size: 15px; cursor: pointer; display: inline-block;" 
               onmouseover="this.style.color='#f59e0b'" 
               onmouseout="this.style.color='var(--ig-primary-text)'">
            ${donation.picker_username}
          </div>
        </div>
        <i class="fas fa-user-check" style="color: #f59e0b; font-size: 20px;"></i>
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
      <div style="display: flex; gap: 12px;">
        <button onclick="openCompletionModal(${donation.id}); closeDonationDetail();" 
                class="ss-btn ss-btn-success" 
                style="flex: 1;">
          <i class="fas fa-check-double"></i> Mark as Complete
        </button>
        <button onclick="unassignDonation(${donation.id}); closeDonationDetail();" 
                class="ss-btn" 
                style="flex: 1; background: rgba(245,158,11,0.1); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);">
          <i class="fas fa-undo"></i> Unassign
        </button>
      </div>
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
  // SQLite returns timestamps in format 'YYYY-MM-DD HH:MM:SS' which is UTC
  // If the timestamp doesn't end with 'Z', add it to indicate UTC
  const timestampStr = typeof timestamp === 'string' && !timestamp.endsWith('Z') && !timestamp.includes('+') 
    ? timestamp.replace(' ', 'T') + 'Z' 
    : timestamp;
  
  const date = new Date(timestampStr);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Show visual notification for nearby donations
function showNearbyNotification(notification) {
  // Request notification permission if not already granted
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  
  // Show browser notification if permission granted
  if ('Notification' in window && Notification.permission === 'granted') {
    const browserNotif = new Notification('📍 Nearby Donation', {
      body: notification.content,
      icon: '/images/logo.png',
      badge: '/images/logo.png',
      tag: 'nearby-donation-' + notification.related_id,
      requireInteraction: false
    });
    
    browserNotif.onclick = () => {
      window.focus();
      if (notification.related_id) {
        openDonationDetail(notification.related_id);
      }
      browserNotif.close();
    };
  }
  
  // Create notification toast
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    z-index: 10000;
    background: linear-gradient(135deg, #0095f6 0%, #0074cc 100%);
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,149,246,0.3);
    min-width: 320px;
    max-width: 400px;
    animation: slideInRight 0.3s ease-out;
    cursor: pointer;
  `;
  
  toast.innerHTML = `
    <div style="display: flex; align-items: start; gap: 12px;">
      <div style="
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
      ">📍</div>
      <div style="flex: 1;">
        <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">
          Nearby Donation
        </div>
        <div style="font-size: 13px; opacity: 0.95; line-height: 1.4;">
          ${notification.content}
        </div>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" style="
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.8;
      ">×</button>
    </div>
  `;
  
  // Add CSS animation if not already present
  if (!document.getElementById('nearby-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'nearby-notification-styles';
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  // Click to view donation detail
  toast.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') {
      if (notification.related_id) {
        openDonationDetail(notification.related_id);
      }
      toast.remove();
    }
  });
  
  document.body.appendChild(toast);
  
  // Auto-remove after 8 seconds
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => toast.remove(), 300);
  }, 8000);
}

// ===== MAP FUNCTIONS =====

async function loadMapView() {
  // Initialize map if not already done
  if (!donationMap) {
    initializeMap();
  }
  
  // Load user settings
  await loadMapSettings();
  
  // Get user location
  getUserLocation();
  
  // Load donation markers
  await loadDonationMarkers();
  
  // Load nearby donations list if proximity is enabled
  await loadNearbyDonations();
}

function initializeMap() {
  const mapContainer = document.getElementById('donation-map');
  
  // Initialize Leaflet map centered on India
  donationMap = L.map('donation-map').setView([20.5937, 78.9629], 5);
  
  // Add tile layer (OpenStreetMap)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(donationMap);
  
  // Invalidate size after a short delay to ensure proper rendering
  setTimeout(() => {
    if (donationMap) donationMap.invalidateSize();
  }, 200);
}

function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        
        // Update location info in settings
        const locationInfo = document.getElementById('current-location-info');
        if (locationInfo) {
          locationInfo.innerHTML = `Current location: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
        }
        
        // Add/update user location marker
        if (userLocationMarker) {
          userLocationMarker.setLatLng([userLocation.lat, userLocation.lng]);
        } else {
          const blueIcon = L.divIcon({
            className: 'custom-marker',
            html: `
              <div style="position: relative; text-align: center;">
                <div style="
                  background: linear-gradient(135deg, #0095f6 0%, #0074cc 100%); 
                  width: 52px; 
                  height: 52px; 
                  border-radius: 50%; 
                  display: flex; 
                  align-items: center; 
                  justify-content: center;
                  border: 3px solid white;
                  box-shadow: 
                    0 8px 20px rgba(0, 149, 246, 0.4),
                    0 4px 8px rgba(0,0,0,0.2),
                    inset 0 -4px 8px rgba(0,0,0,0.2),
                    inset 0 4px 8px rgba(255,255,255,0.3);
                  transform: perspective(100px) rotateX(5deg);
                  animation: pulse 2s infinite;
                  position: relative;
                  z-index: 2;
                ">
                  <div style="font-size: 36px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                    😊
                  </div>
                </div>
                <div style="
                  position: absolute;
                  bottom: -6px;
                  left: 50%;
                  transform: translateX(-50%);
                  width: 0;
                  height: 0;
                  border-left: 12px solid transparent;
                  border-right: 12px solid transparent;
                  border-top: 14px solid white;
                  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
                  z-index: 1;
                "></div>
                <div style="
                  position: absolute;
                  bottom: -20px;
                  left: 50%;
                  transform: translateX(-50%);
                  width: 36px;
                  height: 10px;
                  background: radial-gradient(ellipse at center, rgba(0,149,246,0.4) 0%, rgba(0,0,0,0) 70%);
                  border-radius: 50%;
                "></div>
              </div>
            `,
            iconSize: [52, 66],
            iconAnchor: [26, 60],
            popupAnchor: [0, -60]
          });
          
          userLocationMarker = L.marker([userLocation.lat, userLocation.lng], { icon: blueIcon })
            .bindPopup('<div class="ss-map-popup"><div class="ss-map-popup-title">📍 Your Location</div></div>')
            .addTo(donationMap);
        }
        
        // Don't auto-center if we have donation markers - let fitBounds handle it
        if (mapMarkers.length === 0) {
          donationMap.setView([userLocation.lat, userLocation.lng], 13);
        }
        
        // Load nearby donations after getting user location
        loadNearbyDonations();
      },
      (error) => {
        console.error('Error getting location:', error);
        const locationInfo = document.getElementById('current-location-info');
        if (locationInfo) {
          locationInfo.innerHTML = 'Location access denied';
        }
      }
    );
  }
}

async function loadDonationMarkers() {
  try {
    const response = await InnovateAPI.apiRequest('/social-service/map-donations');
    const mapDonations = response.donations || [];
    
    console.log('Loading map donations:', mapDonations); // Debug log
    
    // Clear existing markers except user location
    mapMarkers.forEach(marker => marker.remove());
    mapMarkers = [];
    
    // Track locations to offset overlapping markers
    const locationCounts = {};
    
    // Add markers for each donation
    mapDonations.forEach((donation, index) => {
      if (donation.latitude && donation.longitude) {
        let lat = parseFloat(donation.latitude);
        let lng = parseFloat(donation.longitude);
        
        // Create a key for this location
        const locationKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        
        // If this location already has markers, offset the new one slightly
        if (locationCounts[locationKey]) {
          const offset = locationCounts[locationKey] * 0.0003; // Small offset
          lng += offset;
          lat += offset * 0.5;
          locationCounts[locationKey]++;
        } else {
          locationCounts[locationKey] = 1;
        }
        
        const isAvailable = donation.status === 'available';
        const avatarEmoji = isAvailable ? '🧍' : '🚶';
        const color = isAvailable ? '#10b981' : '#f59e0b';
        const bgGradient = isAvailable 
          ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
          : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        
        // Create 3D standing avatar icon
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `
            <div style="position: relative; text-align: center; cursor: pointer;">
              <div style="
                background: ${bgGradient}; 
                width: 48px; 
                height: 48px; 
                border-radius: 50%; 
                display: flex; 
                align-items: center; 
                justify-content: center;
                border: 3px solid white;
                box-shadow: 
                  0 8px 16px rgba(0,0,0,0.3),
                  0 4px 8px rgba(0,0,0,0.2),
                  inset 0 -4px 8px rgba(0,0,0,0.2),
                  inset 0 4px 8px rgba(255,255,255,0.3);
                transform: perspective(100px) rotateX(5deg);
                position: relative;
                z-index: 2;
              ">
                <div style="font-size: 32px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                  ${avatarEmoji}
                </div>
              </div>
              <div style="
                position: absolute;
                bottom: -6px;
                left: 50%;
                transform: translateX(-50%);
                width: 0;
                height: 0;
                border-left: 10px solid transparent;
                border-right: 10px solid transparent;
                border-top: 12px solid white;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
                z-index: 1;
              "></div>
              <div style="
                position: absolute;
                bottom: -18px;
                left: 50%;
                transform: translateX(-50%);
                width: 32px;
                height: 8px;
                background: radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 70%);
                border-radius: 50%;
              "></div>
            </div>
          `,
          iconSize: [48, 60],
          iconAnchor: [24, 54],
          popupAnchor: [0, -54]
        });
        
        const marker = L.marker([lat, lng], { icon })
          .bindPopup(`
            <div class="ss-map-popup">
              <div class="ss-map-popup-title">${donation.title}</div>
              <div class="ss-map-popup-address">
                <i class="fas fa-map-marker-alt" style="color: #ed4956; margin-top: 2px;"></i>
                <span>${donation.address}</span>
              </div>
              ${donation.category ? `<div style="font-size: 11px; color: var(--ig-secondary-text); margin-bottom: 4px;"><i class="fas fa-tag"></i> ${donation.category}</div>` : ''}
              ${donation.city ? `<div style="font-size: 11px; color: var(--ig-secondary-text); margin-bottom: 6px;"><i class="fas fa-map-pin"></i> ${donation.city}</div>` : ''}
              <button class="ss-map-popup-btn" onclick="openDonationDetail(${donation.id})">View Details</button>
            </div>
          `)
          .addTo(donationMap);
        
        mapMarkers.push(marker);
      }
    });
    
    // Zoom to fit all markers if there are any
    if (mapMarkers.length > 0) {
      const allMarkers = userLocationMarker ? [...mapMarkers, userLocationMarker] : mapMarkers;
      const group = L.featureGroup(allMarkers);
      donationMap.fitBounds(group.getBounds().pad(0.1));
    }
    
    document.getElementById('map-status').textContent = `Showing ${mapMarkers.length} available donations on map`;
  } catch (err) {
    console.error('Error loading map donations:', err);
    document.getElementById('map-status').textContent = 'Error loading donations';
  }
}

async function loadMapSettings() {
  try {
    const response = await InnovateAPI.apiRequest('/social-service/map-settings');
    if (response.success && response.settings) {
      mapSettings = {
        showOnMap: response.settings.show_on_map === 1,
        proximityNotifications: response.settings.proximity_notifications === 1,
        proximityDistance: response.settings.proximity_distance || 500
      };
      
      // Update UI with loaded settings
      if (document.getElementById('show-on-map-toggle')) {
        document.getElementById('show-on-map-toggle').checked = mapSettings.showOnMap;
      }
      if (document.getElementById('proximity-notifications-toggle')) {
        document.getElementById('proximity-notifications-toggle').checked = mapSettings.proximityNotifications;
      }
      if (document.getElementById('proximity-distance')) {
        document.getElementById('proximity-distance').value = mapSettings.proximityDistance;
        document.getElementById('distance-value').textContent = mapSettings.proximityDistance;
      }
      if (mapSettings.proximityNotifications) {
        document.getElementById('distance-setting').style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Error loading map settings:', err);
  }
}

function toggleMapSettings() {
  const content = document.getElementById('map-settings-content');
  const chevron = document.getElementById('settings-chevron');
  
  if (content.style.display === 'none') {
    content.style.display = 'block';
    chevron.style.transform = 'rotate(180deg)';
  } else {
    content.style.display = 'none';
    chevron.style.transform = 'rotate(0deg)';
  }
}

function toggleProximityDistance() {
  const proximityEnabled = document.getElementById('proximity-notifications-toggle').checked;
  document.getElementById('distance-setting').style.display = proximityEnabled ? 'block' : 'none';
}

function updateDistanceValue() {
  const distance = document.getElementById('proximity-distance').value;
  document.getElementById('distance-value').textContent = distance;
}

async function autoSaveSettings() {
  const showOnMap = document.getElementById('show-on-map-toggle').checked;
  const proximityNotifications = document.getElementById('proximity-notifications-toggle').checked;
  const proximityDistance = parseInt(document.getElementById('proximity-distance').value);
  
  // Request notification permission when enabling proximity notifications
  if (proximityNotifications && 'Notification' in window) {
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        // Show message that notifications won't work without permission
        const statusEl = document.getElementById('map-status');
        statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i> Grant notification permission for proximity alerts';
        setTimeout(() => {
          statusEl.textContent = 'Showing available donations on map';
        }, 4000);
      }
    }
  }
  
  try {
    const response = await InnovateAPI.apiRequest('/social-service/map-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        show_on_map: showOnMap,
        proximity_notifications: proximityNotifications,
        proximity_distance: proximityDistance,
        user_latitude: userLocation ? userLocation.lat : null,
        user_longitude: userLocation ? userLocation.lng : null
      })
    });
    
    if (response.success) {
      mapSettings = { showOnMap, proximityNotifications, proximityDistance };
      
      // Show brief success indicator
      const statusEl = document.getElementById('map-status');
      const originalText = statusEl.textContent;
      statusEl.innerHTML = '<i class="fas fa-check" style="color: #10b981;"></i> Settings saved';
      setTimeout(() => {
        statusEl.textContent = originalText;
      }, 2000);
      
      // Reload map markers if needed
      if (currentTab === 'map') {
        await loadDonationMarkers();
        // Update nearby donations list
        await loadNearbyDonations();
      }
    }
  } catch (err) {
    console.error('Error saving map settings:', err);
  }
}

// Calculate distance between two coordinates in meters using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

// Format distance for display
function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  } else {
    return `${(meters / 1000).toFixed(1)}km`;
  }
}

async function loadNearbyDonations() {
  const section = document.getElementById('nearby-donations-section');
  const listContainer = document.getElementById('nearby-donations-list');
  const countEl = document.getElementById('nearby-count');
  
  // Only show if proximity notifications are enabled
  if (!mapSettings.proximityNotifications || !userLocation) {
    section.style.display = 'none';
    return;
  }
  
  try {
    const response = await InnovateAPI.apiRequest('/social-service/map-donations');
    const allDonations = response.donations || [];
    
    // Calculate distances and filter by proximity
    const nearbyDonations = allDonations
      .map(donation => {
        if (!donation.latitude || !donation.longitude) return null;
        
        const distance = calculateDistance(
          userLocation.lat,
          userLocation.lng,
          parseFloat(donation.latitude),
          parseFloat(donation.longitude)
        );
        
        return { ...donation, distance };
      })
      .filter(donation => donation && donation.distance <= mapSettings.proximityDistance)
      .sort((a, b) => a.distance - b.distance); // Sort by distance (closest first)
    
    // Show/hide section
    if (nearbyDonations.length === 0) {
      listContainer.innerHTML = '<div class="nearby-empty">No donations found within your set radius</div>';
      countEl.textContent = '0 found';
      section.style.display = 'block';
      return;
    }
    
    // Update count
    countEl.textContent = `${nearbyDonations.length} found`;
    
    // Generate HTML for each donation
    listContainer.innerHTML = nearbyDonations.map(donation => {
      const avatarGradient = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      
      return `
        <div class="nearby-donation-item" onclick="openDonationDetail(${donation.id})">
          <div class="nearby-donation-avatar" style="background: ${avatarGradient};">
            <div style="font-size: 24px;">🧍</div>
          </div>
          <div class="nearby-donation-content">
            <div class="nearby-donation-title">${donation.title}</div>
            <div class="nearby-donation-meta">
              ${donation.category ? `<span><i class="fas fa-tag"></i> ${donation.category}</span>` : ''}
              ${donation.city ? `<span><i class="fas fa-map-pin"></i> ${donation.city}</span>` : ''}
            </div>
            <div class="nearby-donation-distance">
              <i class="fas fa-location-arrow"></i>
              ${formatDistance(donation.distance)} away
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    section.style.display = 'block';
  } catch (err) {
    console.error('Error loading nearby donations:', err);
    section.style.display = 'none';
  }
}

function openMapSettings() {
  // Deprecated - now using inline panel with toggleMapSettings()
  toggleMapSettings();
}

function closeMapSettings() {
  // Deprecated - now using inline panel with toggleMapSettings()
  const content = document.getElementById('map-settings-content');
  const chevron = document.getElementById('settings-chevron');
  content.style.display = 'none';
  chevron.style.transform = 'rotate(0deg)';
}

async function saveMapSettings() {
  // Deprecated - now using autoSaveSettings()
  await autoSaveSettings();
}

