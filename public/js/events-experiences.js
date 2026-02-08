(function () {
  const { apiRequest, requireAuth, getCurrentUser, showAlert, formatTimestamp } = window.InnovateAPI || {};

  if (!requireAuth || !apiRequest) {
    // Fallback if app.js not loaded
    if (!localStorage.getItem('token')) {
      window.location.href = '/login';
      return;
    }
  }

  const state = {
    tab: 'discover',
    city: localStorage.getItem('exp-city') || '',
    category: localStorage.getItem('exp-category') || '',
    query: '',
    discoverEvents: [],
    myEvents: [],
    activeEvent: null,
    activeTicketsEventId: null,
    activeOrdersEventId: null,
    activeManageEventId: null,
    createEventPassTypes: [], // Temporary array for pass types being added to new event
    availableCities: [],
    availableCategories: []
  };

  function tokenHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function formatMoney(cents, currency) {
    const amount = (Number(cents) || 0) / 100;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR'
    }).format(amount);
  }

  function formatPriceRange(minCents, maxCents, currency) {
    if (minCents === null || minCents === undefined) return 'Price TBA';
    if (Number(minCents) === 0 && Number(maxCents || 0) === 0) return 'Free';
    if (Number(minCents) === Number(maxCents)) return formatMoney(minCents, currency);
    return `${formatMoney(minCents, currency)} – ${formatMoney(maxCents, currency)}`;
  }

  function shortDateLabel(dateString) {
    if (!dateString) return '';
    const d = new Date(normalizeSqliteDate(dateString));
    return d.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
  }

  function normalizeSqliteDate(dateString) {
    if (!dateString) return dateString;
    let s = String(dateString);
    if (s.includes(' ') && !s.includes('T') && !s.endsWith('Z')) {
      s = s.replace(' ', 'T') + 'Z';
    }
    return s;
  }

  function countdownParts(dateString) {
    const now = Date.now();
    const target = new Date(normalizeSqliteDate(dateString)).getTime();
    const diff = Math.max(0, target - now);
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return { days, hours, mins, diff };
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-exp-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-exp-tab') === tab);
    });
    document.querySelectorAll('[data-exp-panel]').forEach((p) => {
      p.style.display = p.getAttribute('data-exp-panel') === tab ? '' : 'none';
    });

    if (tab === 'discover') loadDiscover();
    if (tab === 'mine') loadMine();
    if (tab === 'passes') loadPasses();
    if (tab === 'crosspath') loadCrosspath();
    if (tab === 'reminders') loadReminders();
  }

  async function loadDiscover() {
    const grid = document.getElementById('expDiscoverGrid');
    if (!grid) {
      console.error('expDiscoverGrid element not found');
      return;
    }
    grid.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const qs = new URLSearchParams();
      if (state.city) qs.set('city', state.city);
      if (state.category) qs.set('category', state.category);
      if (state.query) qs.set('q', state.query);

      console.log('Loading discover events with filters:', { city: state.city, category: state.category, query: state.query });
      const res = await fetch(`/api/events/discover?${qs.toString()}`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load events');

      console.log('Loaded', data.events?.length || 0, 'events');
      state.discoverEvents = data.events || [];
      renderEventGrid(grid, state.discoverEvents, { showCreatorBadge: true });
      updateHeaderCopy();
    } catch (e) {
      console.error('Error loading discover events:', e);
      grid.innerHTML = `<div style="color: var(--ig-primary-text); padding: 40px 20px; text-align: center; min-height: 200px;">
        <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">🎉</div>
        <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">No events yet</div>
        <div style="color: var(--ig-secondary-text); font-size: 14px;">${e.message}</div>
      </div>`;
    }
  }

  async function loadMine() {
    const grid = document.getElementById('expMyGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch('/api/events', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load events');

      state.myEvents = data.events || [];
      renderEventGrid(grid, state.myEvents, { showCreatorBadge: false });
    } catch (e) {
      grid.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 20px;">${e.message}</div>`;
    }
  }

  function placeholderImage(title) {
    const safe = encodeURIComponent(title || 'Event');
    return `https://dummyimage.com/1200x800/111827/ffffff&text=${safe}`;
  }

  function renderEventGrid(container, events, opts) {
    const currentUser = getCurrentUser ? getCurrentUser() : null;

    if (!events.length) {
      container.innerHTML = `<div style="color: var(--ig-primary-text); padding: 60px 20px; text-align: center; min-height: 300px;">
        <div style="font-size: 64px; margin-bottom: 20px; opacity: 0.4;">🎭</div>
        <div style="font-size: 20px; font-weight: 700; margin-bottom: 10px;">No events found</div>
        <div style="color: var(--ig-secondary-text); font-size: 14px; max-width: 400px; margin: 0 auto;">Try changing your filters or be the first to create an event!</div>
      </div>`;
      return;
    }

    container.innerHTML = events
      .map((e) => {
        const minP = e.min_price_cents;
        const maxP = e.max_price_cents;
        const currency = e.ticket_currency || e.currency || 'INR';
        const price = formatPriceRange(minP, maxP, currency);
        const img = e.cover_image || placeholderImage(e.title);
        const city = e.city || '';
        const place = [city, e.location].filter(Boolean).join(' · ');
        const interested = Number(e.interested_count ?? e.attendee_count ?? 0);
        const badge = opts?.showCreatorBadge && e.creator_username ? `<span style="color: var(--ig-secondary-text);">@${e.creator_username}</span>` : '';
        const isMine = currentUser?.id && Number(e.creator_id) === Number(currentUser.id);
        const mineChip = isMine ? `<span style="margin-left:auto; color: rgba(0,149,246,0.9); font-weight:800;">Organizer</span>` : '';

        return `
          <div class="exp-card" data-event-id="${e.id}">
            <div class="exp-card-media">
              <img src="${img}" alt="${(e.title || 'Event').replace(/"/g, '&quot;')}" loading="lazy" onerror="this.onerror=null; this.remove();" />
              <div class="exp-date-chip">${shortDateLabel(e.event_date)}</div>
            </div>
            <div class="exp-card-body">
              <div class="exp-card-title">${e.title || 'Untitled event'}</div>
              <div class="exp-card-meta">
                <span>${place || 'Location TBA'}</span>
                <span>•</span>
                <span>${interested}+ interested</span>
                ${badge ? `<span>•</span>${badge}` : ''}
                ${mineChip}
              </div>
              <div class="exp-card-price">${price}</div>
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('[data-event-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-event-id');
        const ev = events.find((x) => String(x.id) === String(id));
        if (ev) openEventDetail(ev);
      });
    });
  }

  function updateHeaderCopy() {
    const title = document.getElementById('expHeaderTitle');
    const subtitle = document.getElementById('expHeaderSubtitle');
    if (!title || !subtitle) return;

    if (state.city) {
      title.textContent = `All Experiences in ${state.city}`;
    } else {
      title.textContent = 'All Experiences';
    }
    
    // Update subtitle based on filters
    if (state.category) {
      subtitle.textContent = `${state.category} events`;
    } else {
      subtitle.textContent = 'Parties, concerts & trips in one place';
    }
  }

  let countdownInterval = null;

  function startLiveCountdown(eventDate) {
    // Clear existing interval
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }

    const updateCountdown = () => {
      const targetDate = new Date(normalizeSqliteDate(eventDate));
      const now = new Date();
      const diff = targetDate - now;

      if (diff <= 0) {
        document.getElementById('days').textContent = '00';
        document.getElementById('hours').textContent = '00';
        document.getElementById('minutes').textContent = '00';
        document.getElementById('seconds').textContent = '00';
        if (countdownInterval) clearInterval(countdownInterval);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      document.getElementById('days').textContent = String(days).padStart(2, '0');
      document.getElementById('hours').textContent = String(hours).padStart(2, '0');
      document.getElementById('minutes').textContent = String(minutes).padStart(2, '0');
      document.getElementById('seconds').textContent = String(seconds).padStart(2, '0');
    };

    // Update immediately
    updateCountdown();
    // Then update every second
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  function shareEvent(ev) {
    const eventUrl = `${window.location.origin}${window.location.pathname}?event=${ev.id}`;
    const shareText = `Check out this event: ${ev.title}\n${ev.event_date ? new Date(normalizeSqliteDate(ev.event_date)).toLocaleString() : ''}\n${eventUrl}`;

    // Check if Web Share API is supported
    if (navigator.share) {
      navigator.share({
        title: ev.title || 'Event',
        text: shareText,
        url: eventUrl
      }).then(() => {
        showAlert && showAlert('Event shared!', 'success');
      }).catch((err) => {
        console.error('Share failed:', err);
        fallbackShareOptions(ev, eventUrl, shareText);
      });
    } else {
      fallbackShareOptions(ev, eventUrl, shareText);
    }
  }

  function fallbackShareOptions(ev, eventUrl, shareText) {
    // Create share options modal
    const modal = document.createElement('div');
    modal.className = 'ig-modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div style="max-width: 420px; width: 90%; background: var(--ig-secondary-background); border-radius: 16px; padding: 20px;">
        <div style="font-weight: 900; font-size: 18px; margin-bottom: 16px;">Share Event</div>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <button class="exp-btn" id="shareWhatsApp" style="background: rgba(37, 211, 102, 0.15); border-color: rgba(37, 211, 102, 0.4); color: #25d366; justify-content: flex-start; padding-left: 16px;">
            <span style="font-size: 20px; margin-right: 12px;">📱</span> Share on WhatsApp
          </button>
          
          <button class="exp-btn" id="shareFacebook" style="background: rgba(24, 119, 242, 0.15); border-color: rgba(24, 119, 242, 0.4); color: #1877f2; justify-content: flex-start; padding-left: 16px;">
            <span style="font-size: 20px; margin-right: 12px;">👥</span> Share on Facebook
          </button>
          
          <button class="exp-btn" id="shareTwitter" style="background: rgba(29, 161, 242, 0.15); border-color: rgba(29, 161, 242, 0.4); color: #1da1f2; justify-content: flex-start; padding-left: 16px;">
            <span style="font-size: 20px; margin-right: 12px;">🐦</span> Share on Twitter
          </button>
          
          <button class="exp-btn" id="copyLink" style="background: rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.4); color: #a855f7; justify-content: flex-start; padding-left: 16px;">
            <span style="font-size: 20px; margin-right: 12px;">🔗</span> Copy Link
          </button>
        </div>
        
        <button class="exp-btn" id="closeShareModal" style="margin-top: 16px; width: 100%;">Cancel</button>
      </div>
    `;
    
    document.body.appendChild(modal);

    // Share handlers
    document.getElementById('shareWhatsApp').onclick = () => {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
      document.body.removeChild(modal);
    };

    document.getElementById('shareFacebook').onclick = () => {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(eventUrl)}`, '_blank');
      document.body.removeChild(modal);
    };

    document.getElementById('shareTwitter').onclick = () => {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank');
      document.body.removeChild(modal);
    };

    document.getElementById('copyLink').onclick = () => {
      navigator.clipboard.writeText(eventUrl).then(() => {
        showAlert && showAlert('Link copied to clipboard!', 'success');
        document.body.removeChild(modal);
      }).catch(() => {
        showAlert && showAlert('Failed to copy link', 'error');
      });
    };

    document.getElementById('closeShareModal').onclick = () => {
      document.body.removeChild(modal);
    };

    modal.onclick = (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    };
  }

  function openEventDetail(ev) {
    state.activeEvent = ev;

    const overlay = document.getElementById('eventOverlay');
    const img = document.getElementById('eventDetailImg');
    const title = document.getElementById('eventDetailTitle');
    const place = document.getElementById('eventDetailPlace');
    const price = document.getElementById('eventDetailPrice');
    const desc = document.getElementById('eventDetailDesc');

    const kInterested = document.getElementById('kpiInterested');
    const kCountdown = document.getElementById('kpiCountdown');
    const kPopularity = document.getElementById('kpiPopularity');

    const currentUser = getCurrentUser ? getCurrentUser() : null;
    const isOrganizer = currentUser?.id && Number(ev.creator_id) === Number(currentUser.id);

    const minP = ev.min_price_cents;
    const maxP = ev.max_price_cents;
    const currency = ev.ticket_currency || 'INR';
    const priceText = formatPriceRange(minP, maxP, currency);

    const placeText = [ev.location, ev.city].filter(Boolean).join(' · ');
    const interested = Number(ev.interested_count ?? ev.attendee_count ?? 0);

    if (img) img.src = ev.cover_image || placeholderImage(ev.title);
    if (title) title.textContent = ev.title || 'Untitled event';
    if (place) place.textContent = placeText || 'Location TBA';
    if (price) {
      if (priceText === 'Free') {
        price.innerHTML = '<span style=\"color: #00d4aa; display: flex; align-items: center; gap: 4px;\"><span>\ud83c\udf89</span> Free</span>';
      } else if (priceText === 'Price TBA') {
        price.textContent = 'Price TBA';
      } else {
        price.innerHTML = `<span style=\"color: #00d4aa; display: flex; align-items: center; gap: 4px;\"><span>\ud83d\udcb5</span> ${priceText}</span>`;
      }
    }
    if (desc) desc.textContent = ev.description || ev.important_note || '';

    if (kInterested) kInterested.innerHTML = `<span style=\"display: flex; align-items: center; gap: 4px;\"><span>\ud83d\udc65</span>${interested}+</span>`;

    const parts = countdownParts(ev.event_date);
    if (kCountdown) {
      const startsInText = parts.diff ? `${parts.days}d ${String(parts.hours).padStart(2, '0')}h ${String(parts.mins).padStart(2, '0')}m` : 'Now';
      kCountdown.innerHTML = `<span style=\"display: flex; align-items: center; gap: 4px;\"><span>\u23f0</span>${startsInText}</span>`;
    }

    // Popularity: normalize within current list (simple)
    const pool = (state.tab === 'mine' ? state.myEvents : state.discoverEvents) || [];
    const maxInterested = Math.max(1, ...pool.map((x) => Number(x.interested_count ?? x.attendee_count ?? 0)));
    const pct = Math.min(99, Math.round((interested / maxInterested) * 100));
    if (kPopularity) kPopularity.innerHTML = `<span style=\"display: flex; align-items: center; gap: 4px;\"><span>\ud83d\udd25</span>${pct}%</span>`;

    // Quick look rows
    document.getElementById('qlTime').textContent = formatTimestamp ? formatTimestamp(ev.event_date) : new Date(normalizeSqliteDate(ev.event_date)).toLocaleString();
    document.getElementById('qlCategory').textContent = ev.category || 'General';
    document.getElementById('qlOrganizer').textContent = ev.organizer_name || (ev.creator_username ? `@${ev.creator_username}` : 'Organizer');
    document.getElementById('qlNote').textContent = ev.important_note || '—';

    // Organizer-only actions
    document.getElementById('btnEditEvent').style.display = isOrganizer ? '' : 'none';
    document.getElementById('btnDeleteEvent').style.display = isOrganizer ? '' : 'none';
    document.getElementById('btnOrders').style.display = isOrganizer ? '' : 'none';
    document.getElementById('btnCheckin').style.display = isOrganizer ? '' : 'none';
    document.getElementById('btnSecurityStaff').style.display = isOrganizer ? '' : 'none';

    // Start live countdown timer
    startLiveCountdown(ev.event_date);

    overlay.classList.add('open');
  }

  function closeEventDetail() {
    const overlay = document.getElementById('eventOverlay');
    overlay.classList.remove('open');
    state.activeEvent = null;
    
    // Stop countdown timer
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function openFilters() {
    document.getElementById('filtersDrawer').classList.add('open');
    document.getElementById('filtersOverlay').classList.add('open');
  }

  function closeFilters() {
    document.getElementById('filtersDrawer').classList.remove('open');
    document.getElementById('filtersOverlay').classList.remove('open');
  }

  function applyFilters() {
    const city = document.getElementById('filterCity').value;
    const category = document.getElementById('filterCategory').value;
    
    state.city = city;
    state.category = category;
    
    localStorage.setItem('exp-city', city);
    localStorage.setItem('exp-category', category);

    // Update city button label
    const cityLabel = document.getElementById('cityLabel');
    if (cityLabel) {
      cityLabel.textContent = city || 'All Cities';
    }

    const q = document.getElementById('searchInput').value.trim();
    state.query = q;

    closeFilters();
    if (state.tab === 'discover') loadDiscover();
  }

  function clearFilters() {
    document.getElementById('filterCity').value = '';
    document.getElementById('filterCategory').value = '';
    state.city = '';
    state.category = '';
    state.query = '';
    
    localStorage.removeItem('exp-city');
    localStorage.removeItem('exp-category');

    // Update city button label
    const cityLabel = document.getElementById('cityLabel');
    if (cityLabel) {
      cityLabel.textContent = 'All Cities';
    }

    document.getElementById('searchInput').value = '';
    
    closeFilters();
    if (state.tab === 'discover') loadDiscover();
  }

  async function loadFilterOptions() {
    try {
      const res = await fetch('/api/events/filters/options', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load filter options');

      state.availableCities = data.cities || [];
      state.availableCategories = data.categories || [];

      // Populate city filter
      const citySelect = document.getElementById('filterCity');
      if (citySelect) {
        citySelect.innerHTML = '<option value="">All Cities</option>';
        state.availableCities.forEach(city => {
          const option = document.createElement('option');
          option.value = city;
          option.textContent = city;
          citySelect.appendChild(option);
        });
      }

      // Populate category filter
      const categorySelect = document.getElementById('filterCategory');
      if (categorySelect) {
        categorySelect.innerHTML = '<option value="">All Categories</option>';
        state.availableCategories.forEach(category => {
          const option = document.createElement('option');
          option.value = category;
          option.textContent = category;
          categorySelect.appendChild(option);
        });
      }

      // Set saved values
      if (state.city && citySelect) citySelect.value = state.city;
      if (state.category && categorySelect) categorySelect.value = state.category;

      // Update city button label
      const cityLabel = document.getElementById('cityLabel');
      if (cityLabel) {
        cityLabel.textContent = state.city || 'All Cities';
      }
    } catch (e) {
      console.error('Error loading filter options:', e);
      // Don't fail silently - at least show default options
      const citySelect = document.getElementById('filterCity');
      if (citySelect && !citySelect.innerHTML) {
        citySelect.innerHTML = '<option value="">All Cities</option>';
      }
      const categorySelect = document.getElementById('filterCategory');
      if (categorySelect && !categorySelect.innerHTML) {
        categorySelect.innerHTML = '<option value="">All Categories</option>';
      }
    }
  }

  // ===== Passes =====
  async function loadPasses() {
    const list = document.getElementById('passesList');
    if (!list) return;
    list.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch('/api/events/tickets/mine', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load passes');

      const tickets = data.tickets || [];
      if (!tickets.length) {
        list.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center;">
            <div style="font-size: 64px; margin-bottom: 16px; opacity: 0.3;">🎫</div>
            <div style="font-size: 18px; font-weight: 700; color: var(--ig-primary-text); margin-bottom: 8px;">No passes yet</div>
            <div style="color: var(--ig-secondary-text); font-size: 14px;">Book tickets from events to see them here</div>
          </div>
        `;
        return;
      }

      list.innerHTML = tickets
        .map((t, idx) => {
          // Use actual cover image or fallback to placeholder
          const coverImg = t.event_cover_image ? t.event_cover_image : placeholderImage(t.event_title || 'Event');
          const eventDate = formatTimestamp ? formatTimestamp(t.event_date) : new Date(normalizeSqliteDate(t.event_date)).toLocaleString();
          const location = [t.event_location, t.event_city].filter(Boolean).join(' · ');
          
          // Calculate per-ticket price (divide total by quantity if multiple tickets)
          const orderQty = t.order_quantity || 1;
          const perTicketCents = t.ticket_price_cents ? Math.floor(t.ticket_price_cents / orderQty) : 0;
          const money = perTicketCents > 0 ? formatMoney(perTicketCents, t.ticket_currency || 'INR') : 'Free';
          
          const gradients = [
            'linear-gradient(135deg, rgba(102,126,234,0.15) 0%, rgba(118,75,162,0.15) 100%)',
            'linear-gradient(135deg, rgba(236,72,153,0.15) 0%, rgba(239,68,68,0.15) 100%)',
            'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(147,51,234,0.15) 100%)',
            'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(239,68,68,0.15) 100%)'
          ];
          const bgGradient = gradients[idx % gradients.length];
          
          return `
            <div class="pass-card" style="border-radius: 20px; overflow: hidden; background: ${bgGradient}; border: 2px solid rgba(255,255,255,0.1); position: relative; transition: all 0.3s ease;" onmouseenter="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 12px 32px rgba(0,0,0,0.5)';" onmouseleave="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.3)';">
              <!-- Status Badge -->
              <div style="position: absolute; top: 16px; right: 16px; z-index: 10; background: linear-gradient(135deg, rgba(0,212,170,0.95) 0%, rgba(0,168,150,0.95) 100%); padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800; color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid rgba(255,255,255,0.2);">✓ ISSUED</div>
              
              <!-- Main Horizontal Layout -->
              <div style="display: flex; min-height: 320px;">
                <!-- Left: Event Cover Photo -->
                <div style="flex: 0 0 45%; position: relative; overflow: hidden; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);">
                  <img src="${coverImg}" alt="${t.event_title}" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.95;" onerror="this.style.display='none';" />
                  <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.95) 100%); padding: 20px;">
                    <div style="font-weight: 900; font-size: 22px; color: white; margin-bottom: 6px; line-height: 1.2;">${t.event_title || 'Event'}</div>
                    <div style="display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.85); font-size: 13px;">
                      <span>📍</span>
                      <span>${location || 'Location TBA'}</span>
                    </div>
                  </div>
                </div>
                
                <!-- Right: Ticket Details -->
                <div style="flex: 1; padding: 24px; display: flex; flex-direction: column; gap: 20px;">
                  <!-- Ticket Info Cards -->
                  <div style="display: flex; flex-direction: column; gap: 12px;">
                    <div style="background: rgba(0,0,0,0.25); padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                      <div style="color: var(--ig-secondary-text); font-size: 11px; font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">🎫 TICKET TYPE</div>
                      <div style="font-weight: 900; font-size: 17px; color: var(--ig-primary-text);">${t.ticket_type_name || 'Pass'}</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.25); padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                      <div style="color: var(--ig-secondary-text); font-size: 11px; font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">💰 PRICE</div>
                      <div style="font-weight: 900; font-size: 20px; color: #00d4aa;">${money}</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.25); padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                      <div style="color: var(--ig-secondary-text); font-size: 11px; font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">📅 EVENT DATE</div>
                      <div style="font-weight: 700; font-size: 14px; color: var(--ig-primary-text);">${eventDate}</div>
                    </div>
                  </div>
                  
                  <!-- QR Code Section -->
                  <div style="background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%); padding: 18px; border-radius: 14px; border: 2px solid rgba(255,255,255,0.1); margin-top: auto;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                      <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 900; font-size: 15px; color: var(--ig-primary-text); margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                          <span style="font-size: 18px;">🎟️</span>
                          <span>Your Pass</span>
                        </div>
                        <div style="background: rgba(0,0,0,0.35); padding: 8px 12px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 12px; font-weight: 700; color: #00d4aa; margin-bottom: 8px; border: 1px dashed rgba(0,212,170,0.3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.code}</div>
                        <div style="color: var(--ig-secondary-text); font-size: 11px; line-height: 1.4;">
                          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                            <span>✓</span>
                            <span>Show QR code at entry</span>
                          </div>
                          <div style="display: flex; align-items: center; gap: 6px;">
                            <span>✓</span>
                            <span>Keep this pass safe</span>
                          </div>
                        </div>
                      </div>
                      <div style="flex-shrink: 0;">
                        <div style="background: white; padding: 10px; border-radius: 14px; box-shadow: 0 6px 20px rgba(0,0,0,0.3);">
                          <div id="qr-${t.id}"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      // Generate QR codes
      if (window.QRCode) {
        tickets.forEach((t) => {
          const el = document.getElementById(`qr-${t.id}`);
          if (!el) return;
          el.innerHTML = '';
          new window.QRCode(el, {
            text: String(t.code),
            width: 140,
            height: 140,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel.H
          });
        });
      }
    } catch (e) {
      list.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center;">
          <div style="font-size: 64px; margin-bottom: 16px; opacity: 0.3;">⚠️</div>
          <div style="font-size: 18px; font-weight: 700; color: var(--ig-error); margin-bottom: 8px;">Failed to load passes</div>
          <div style="color: var(--ig-secondary-text); font-size: 14px;">${e.message}</div>
        </div>
      `;
    }
  }

  // ===== Crosspath / Reminders (keep basic) =====
  async function loadCrosspath() {
    const list = document.getElementById('crosspathList');
    if (!list) return;
    list.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch('/api/events/crosspath/pending', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load requests');

      const reqs = data.requests || [];
      if (!reqs.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text); padding: 14px;">No crosspath requests.</div>';
        return;
      }

      list.innerHTML = reqs
        .map((r) => {
          return `
            <div class="exp-section">
              <div style="font-weight:900;">@${r.user_username}</div>
              <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">Event: ${r.event_title || ''}</div>
              <div class="exp-cta">
                <button class="exp-btn primary" data-cp="${r.id}" data-act="accept">Accept</button>
                <button class="exp-btn" data-cp="${r.id}" data-act="reject">Reject</button>
              </div>
            </div>
          `;
        })
        .join('');

      list.querySelectorAll('button[data-cp]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-cp');
          const act = btn.getAttribute('data-act');
          try {
            const res2 = await fetch(`/api/events/crosspath/${id}/${act}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...tokenHeaders() }
            });
            const d2 = await res2.json();
            if (!res2.ok) throw new Error(d2.error || 'Failed');
            showAlert && showAlert('Updated', 'success');
            loadCrosspath();
          } catch (e) {
            showAlert && showAlert(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 14px;">${e.message}</div>`;
    }
  }

  async function loadReminders() {
    const list = document.getElementById('remindersList');
    if (!list) return;
    list.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch('/api/events/reminders', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load reminders');

      const reminders = data.reminders || [];
      if (!reminders.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text); padding: 14px;">No reminders.</div>';
        return;
      }

      list.innerHTML = reminders
        .map((r) => {
          return `
            <div class="exp-section">
              <div style="font-weight:900;">${new Date(normalizeSqliteDate(r.reminder_date)).toLocaleString()}</div>
              <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${r.message || r.post_content || ''}</div>
              <div class="exp-cta">
                <button class="exp-btn" data-rem="${r.id}">Delete</button>
              </div>
            </div>
          `;
        })
        .join('');

      list.querySelectorAll('button[data-rem]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-rem');
          try {
            const res2 = await fetch(`/api/events/reminders/${id}`, { method: 'DELETE', headers: tokenHeaders() });
            const d2 = await res2.json();
            if (!res2.ok) throw new Error(d2.error || 'Failed');
            loadReminders();
          } catch (e) {
            showAlert && showAlert(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 14px;">${e.message}</div>`;
    }
  }

  // ===== Tickets modal (reuse endpoints) =====
  async function openTicketsModal() {
    const ev = state.activeEvent;
    if (!ev) return;

    state.activeTicketsEventId = ev.id;

    const modal = document.getElementById('ticketsModal');
    const list = document.getElementById('ticketTypes');
    const title = document.getElementById('ticketsTitle');
    const sub = document.getElementById('ticketsSubtitle');
    const result = document.getElementById('ticketsResult');

    title.textContent = 'Select Tickets';
    sub.textContent = `${ev.title || 'Event'} • ${formatTimestamp ? formatTimestamp(ev.event_date) : ''}`;
    result.innerHTML = '';
    list.innerHTML = '<div class="ig-spinner"></div>';

    modal.style.display = 'flex';

    try {
      const res = await fetch(`/api/events/${ev.id}/tickets/types`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load ticket types');

      const types = data.types || [];
      if (!types.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text);">No ticket types configured yet.</div>';
        return;
      }

      list.innerHTML = types
        .map((t, idx) => {
          const price = t.price_cents ? formatMoney(t.price_cents, t.currency) : 'Free';
          const isFree = !t.price_cents || t.price_cents === 0;
          const how = String(t.payment_mode || '').toUpperCase();
          const contact = t.contact_text ? `<div class="exp-hint" style="margin-top: 8px; padding: 8px 12px; background: rgba(102,126,234,0.1); border-radius: 8px; font-size: 12px;">${t.contact_text}</div>` : '';
          
          // Determine icon based on ticket name
          let icon = '🎫';
          const nameLower = String(t.name || '').toLowerCase();
          if (nameLower.includes('vip') || nameLower.includes('premium')) icon = '👑';
          else if (nameLower.includes('couple') || nameLower.includes('pair')) icon = '💑';
          else if (nameLower.includes('group') || nameLower.includes('family')) icon = '👨‍👩‍👧‍👦';
          else if (nameLower.includes('student') || nameLower.includes('child')) icon = '🎓';
          else if (nameLower.includes('single')) icon = '🙋';
          
          const description = (t.description || '').trim() || how;
          const shortDesc = description.length > 120 ? description.substring(0, 120) + '...' : description;
          const hasLongDesc = description.length > 120;
          
          const gradients = [
            'linear-gradient(135deg, rgba(102,126,234,0.15) 0%, rgba(118,75,162,0.15) 100%)',
            'linear-gradient(135deg, rgba(236,72,153,0.15) 0%, rgba(239,68,68,0.15) 100%)',
            'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(147,51,234,0.15) 100%)',
            'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(239,68,68,0.15) 100%)'
          ];
          const borderColors = [
            'rgba(102,126,234,0.3)',
            'rgba(236,72,153,0.3)',
            'rgba(59,130,246,0.3)',
            'rgba(245,158,11,0.3)'
          ];
          const bgGradient = gradients[idx % gradients.length];
          const borderColor = borderColors[idx % borderColors.length];
          
          return `
            <label class="ticket-card" data-ticket-id="${t.id}" style="display:flex; gap:16px; padding: 18px; border-radius: 16px; border: 2px solid ${borderColor}; background: ${bgGradient}; cursor:pointer; transition: all 0.3s ease; position: relative; overflow: hidden;" onmouseenter="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 24px rgba(0,0,0,0.4)';" onmouseleave="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
              <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%); pointer-events: none;"></div>
              <div style="position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-top: 2px;">
                <input type="radio" name="ticketType" value="${t.id}" data-price="${t.price_cents || 0}" data-currency="${t.currency || 'INR'}" style="position: absolute; opacity: 0; width: 24px; height: 24px; cursor: pointer;" onchange="document.querySelectorAll('.ticket-card').forEach(c => c.style.borderColor = c.querySelector('input').checked ? '#667eea' : '${borderColor}'); this.parentElement.parentElement.style.borderColor='#667eea';" />
                <div class="custom-radio" style="width: 24px; height: 24px; border-radius: 50%; border: 2.5px solid rgba(255,255,255,0.4); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                  <div style="width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transform: scale(0); transition: transform 0.3s ease;"></div>
                </div>
              </div>
              <div style="flex:1; position: relative; z-index: 1;">
                <div style="display:flex; justify-content:space-between; align-items:start; gap: 12px; margin-bottom: 8px;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">${icon}</span>
                    <div style="font-weight:900; font-size: 17px; color: var(--ig-primary-text);">${t.name}</div>
                  </div>
                  <div style="font-weight:900; font-size: 18px; ${isFree ? 'color: #00d4aa;' : 'background: linear-gradient(135deg, #00d4aa 0%, #00a896 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;'}">${price}</div>
                </div>
                <div style="color: var(--ig-secondary-text); font-size: 13px; line-height: 1.5; margin-bottom: 6px;" id="desc-${t.id}">${shortDesc}</div>
                ${hasLongDesc ? `<button type="button" onclick="event.preventDefault(); const desc=document.getElementById('desc-${t.id}'); const full='${description.replace(/'/g, "\\'").replace(/\n/g, ' ')}'; if(desc.textContent.includes('...')){desc.textContent=full; this.textContent='Show less';}else{desc.textContent='${shortDesc.replace(/'/g, "\\'").replace(/\n/g, ' ')}'; this.textContent='Read more';}" style="color: #667eea; font-size: 12px; font-weight: 700; background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline;">Read more</button>` : ''}
                ${contact}
                ${how && how !== 'FREE' ? `<div style="margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: rgba(0,0,0,0.3); border-radius: 6px; font-size: 11px; font-weight: 700; color: var(--ig-secondary-text);"><span>💳</span> ${how}</div>` : ''}
              </div>
            </label>
          `;
        })
        .join('');
      
      // Add CSS for checked state
      const style = document.createElement('style');
      style.textContent = `
        .ticket-card input:checked ~ .custom-radio {
          border-color: #667eea !important;
          background: rgba(102,126,234,0.2) !important;
        }
        .ticket-card input:checked ~ .custom-radio > div {
          transform: scale(1) !important;
        }
      `;
      if (!document.getElementById('ticket-card-styles')) {
        style.id = 'ticket-card-styles';
        document.head.appendChild(style);
      }

      // select first by default
      const first = list.querySelector('input[name="ticketType"]');
      if (first) first.checked = true;
      updateTicketTotal();
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text);">${e.message}</div>`;
    }
  }

  function closeTicketsModal() {
    document.getElementById('ticketsModal').style.display = 'none';
  }

  function selectedTicket() {
    const sel = document.querySelector('input[name="ticketType"]:checked');
    if (!sel) return null;
    return {
      id: sel.value,
      priceCents: Number(sel.getAttribute('data-price') || 0),
      currency: sel.getAttribute('data-currency') || 'INR'
    };
  }

  function updateTicketTotal() {
    const qty = Math.max(1, Number(document.getElementById('ticketQty').value || 1));
    const t = selectedTicket();
    const el = document.getElementById('ticketTotal');
    if (!t) {
      el.innerHTML = '';
      return;
    }
    const total = (t.priceCents || 0) * qty;
    if (total) {
      el.innerHTML = `<div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 14px;">💰</span><span style="color: var(--ig-secondary-text); font-weight: 600; font-size: 13px;">Total:</span><span style="font-size: 18px;">${formatMoney(total, t.currency)}</span></div>`;
    } else {
      el.innerHTML = `<div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 14px;">🎉</span><span style="font-size: 18px; color: #00d4aa;">Free</span></div>`;
    }
  }

  async function checkoutTickets() {
    const ev = state.activeEvent;
    if (!ev) return;

    const qty = Math.max(1, Number(document.getElementById('ticketQty').value || 1));
    const t = selectedTicket();
    const result = document.getElementById('ticketsResult');

    if (!t) {
      result.innerHTML = '<div style="color: var(--ig-error);">Select a ticket type.</div>';
      return;
    }

    result.innerHTML = '<div class="ig-spinner" style="margin: 10px auto;"></div>';

    try {
      const res = await fetch(`/api/events/${ev.id}/tickets/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ ticket_type_id: Number(t.id), quantity: qty })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');

      if (data.tickets?.length) {
        result.innerHTML = `<div style="color: var(--ig-primary-text); font-weight: 800;">Pass issued.</div><div class="exp-hint">Open Passes tab to view QR.</div>`;
      } else {
        result.innerHTML = `<div style="color: var(--ig-primary-text); font-weight: 800;">Order created.</div><div class="exp-hint">Organizer will DM you after confirming payment.</div>`;
      }
      
      // Refresh event data to update Interested count and Popularity
      await refreshEventDetail(ev.id);
    } catch (e) {
      result.innerHTML = `<div style="color: var(--ig-error);">${e.message}</div>`;
    }
  }

  async function refreshEventDetail(eventId) {
    try {
      const res = await fetch(`/api/events/${eventId}`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) return;
      
      const updatedEvent = data.event;
      if (!updatedEvent) return;
      
      // Update state arrays
      if (state.myEvents) {
        const idx = state.myEvents.findIndex(e => e.id === eventId);
        if (idx !== -1) state.myEvents[idx] = { ...state.myEvents[idx], ...updatedEvent };
      }
      if (state.discoverEvents) {
        const idx = state.discoverEvents.findIndex(e => e.id === eventId);
        if (idx !== -1) state.discoverEvents[idx] = { ...state.discoverEvents[idx], ...updatedEvent };
      }
      
      // Update active event and refresh the detail view
      if (state.activeEvent && state.activeEvent.id === eventId) {
        state.activeEvent = { ...state.activeEvent, ...updatedEvent };
        openEventDetail(state.activeEvent); // Refresh the display
      }
    } catch (e) {
      console.error('Error refreshing event:', e);
    }
  }

  // ===== Organizer: Orders / Manage Passes / Check-in =====
  async function openOrders() {
    const ev = state.activeEvent;
    if (!ev) return;

    state.activeOrdersEventId = ev.id;
    state.currentOrderStatus = 'pending'; // Default to pending
    const modal = document.getElementById('ordersModal');

    modal.style.display = 'flex';
    
    // Initialize active tab styling
    const activeTab = document.getElementById('orderTabPending');
    if (activeTab) {
      activeTab.style.color = 'var(--ig-primary-text)';
      activeTab.style.borderBottomColor = '#f59e0b';
      activeTab.style.background = 'rgba(245,158,11,0.08)';
    }
    
    // Set up tab click handlers
    document.querySelectorAll('.order-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const status = tab.getAttribute('data-status');
        state.currentOrderStatus = status;
        
        // Update active tab styling
        document.querySelectorAll('.order-tab').forEach(t => {
          t.classList.remove('active');
          t.style.color = 'var(--ig-secondary-text)';
          t.style.borderBottomColor = 'transparent';
          t.style.background = 'none';
        });
        tab.classList.add('active');
        tab.style.color = 'var(--ig-primary-text)';
        tab.style.borderBottomColor = '#f59e0b';
        tab.style.background = 'rgba(245,158,11,0.08)';
        
        loadOrdersForStatus(ev, status);
      });
    });
    
    // Load initial orders (pending)
    loadOrdersForStatus(ev, 'pending');
  }

  async function loadOrdersForStatus(ev, status) {
    const list = document.getElementById('ordersList');
    const subtitle = document.getElementById('ordersSubtitle');
    
    const statusLabels = {
      pending: 'Pending payments',
      paid: 'Confirmed orders',
      all: 'All orders'
    };
    
    subtitle.textContent = `${ev.title || 'Event'} • ${statusLabels[status] || 'Orders'}`;
    list.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; padding: 60px 20px;"><div class="ig-spinner"></div></div>';

    try {
      const url = status === 'all' 
        ? `/api/events/${ev.id}/orders`
        : `/api/events/${ev.id}/orders?status=${status}`;
        
      const res = await fetch(url, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      const orders = data.orders || [];
      if (!orders.length) {
        const emptyIcons = {
          pending: '⏳',
          paid: '✓',
          all: '📋'
        };
        const emptyMessages = {
          pending: 'No pending orders',
          paid: 'No confirmed orders yet',
          all: 'No orders yet'
        };
        list.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center;">
            <div style="font-size: 64px; margin-bottom: 16px; opacity: 0.3;">${emptyIcons[status] || '📋'}</div>
            <div style="font-size: 18px; font-weight: 700; color: var(--ig-primary-text); margin-bottom: 8px;">${emptyMessages[status] || 'No orders'}</div>
            <div style="color: var(--ig-secondary-text); font-size: 14px;">Orders will appear here once customers book tickets</div>
          </div>
        `;
        return;
      }

      list.innerHTML = orders
        .map((o, idx) => {
          const money = o.total_cents ? formatMoney(o.total_cents, o.currency) : 'Free';
          const date = new Date(o.created_at).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          
          const isPaid = o.status === 'paid';
          const statusBadge = isPaid
            ? '<span style="background: linear-gradient(135deg, rgba(0,212,170,0.2) 0%, rgba(0,168,150,0.2) 100%); color: #00d4aa; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 800; border: 1.5px solid rgba(0,212,170,0.3); display: inline-flex; align-items: center; gap: 6px;"><span style="font-size: 14px;">✓</span> CONFIRMED</span>'
            : '<span style="background: linear-gradient(135deg, rgba(255,193,7,0.2) 0%, rgba(245,158,11,0.2) 100%); color: #ffc107; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 800; border: 1.5px solid rgba(255,193,7,0.3); display: inline-flex; align-items: center; gap: 6px;"><span style="font-size: 14px;">⏳</span> PENDING</span>';
          
          const actionBtn = !isPaid
            ? `<button class="exp-btn primary" data-order="${o.id}" style="font-size: 14px; height: 42px; padding: 0 20px; background: linear-gradient(135deg, #00d4aa 0%, #00a896 100%); border: none; font-weight: 800; white-space: nowrap;"><span style="display: flex; align-items: center; gap: 8px;">✓ Mark Paid & Issue</span></button>`
            : `<div style="display: flex; align-items: center; gap: 8px; color: #00d4aa; font-size: 13px; font-weight: 700; padding: 8px 16px; background: rgba(0,212,170,0.1); border-radius: 12px; border: 1.5px solid rgba(0,212,170,0.2);"><span style="font-size: 16px;">🎫</span> Ticket Issued</div>`;

          // Profile picture with fallback to initial avatar
          const hasProfilePic = o.buyer_picture && o.buyer_picture !== '/default-avatar.png';
          const firstLetter = o.buyer_username?.charAt(0)?.toUpperCase() || 'U';
          const profileUrl = `/profile.html?username=${encodeURIComponent(o.buyer_username)}`;
          
          const profileImage = hasProfilePic 
            ? `<img src="${o.buyer_picture}" alt="${o.buyer_username}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
               <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; color: white;">${firstLetter}</div>`
            : `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; color: white;">${firstLetter}</div>`;

          const gradients = [
            'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(236,72,153,0.12) 100%)',
            'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(147,51,234,0.12) 100%)',
            'linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(236,72,153,0.12) 100%)',
            'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(59,130,246,0.12) 100%)'
          ];
          const bgGradient = gradients[idx % gradients.length];
          
          const borderColors = [
            'rgba(245,158,11,0.3)',
            'rgba(59,130,246,0.3)',
            'rgba(168,85,247,0.3)',
            'rgba(34,197,94,0.3)'
          ];
          const borderColor = borderColors[idx % borderColors.length];

          return `
            <div class="order-card" style="padding: 18px; border-radius: 16px; border: 2px solid ${borderColor}; background: ${bgGradient}; position: relative; overflow: hidden; transition: all 0.3s ease;" onmouseenter="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 24px rgba(0,0,0,0.4)';" onmouseleave="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
              <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%); pointer-events: none;"></div>
              <div style="display:flex; justify-content:space-between; gap: 16px; align-items: start; position: relative; z-index: 1;">
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
                    <a href="${profileUrl}" style="display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--ig-primary-text); transition: all 0.2s ease; padding: 4px; border-radius: 12px;" onmouseenter="this.style.background='rgba(255,255,255,0.08)';" onmouseleave="this.style.background='transparent';">
                      <div style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; border: 2.5px solid rgba(255,255,255,0.2); background: linear-gradient(135deg, rgba(102,126,234,0.3) 0%, rgba(118,75,162,0.3) 100%); flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                        ${profileImage}
                      </div>
                      <div style="font-weight: 900; font-size: 16px;">@${o.buyer_username}</div>
                    </a>
                    ${statusBadge}
                  </div>
                  <div style="display: grid; gap: 8px; color: var(--ig-secondary-text); font-size: 13px; line-height: 1.6;">
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(0,0,0,0.2); border-radius: 8px; width: fit-content;">
                      <span style="font-size: 16px;">🎫</span>
                      <span style="font-weight: 600;">${o.ticket_type_name || 'Pass'}</span>
                      <span style="color: var(--ig-primary-text); font-weight: 800;">× ${o.quantity}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
                      <span style="font-size: 16px;">💰</span>
                      <span style="color: ${o.total_cents ? '#00d4aa' : '#ffc107'}; font-size: 15px;">${money}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-size: 16px;">📅</span>
                      <span>${date}</span>
                    </div>
                    ${o.payment_mode ? `<div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-size: 16px;">💳</span>
                      <span style="text-transform: capitalize; font-weight: 600;">${o.payment_mode}</span>
                    </div>` : ''}
                  </div>
                </div>
                <div style="flex-shrink: 0; display: flex; align-items: center;">
                  ${actionBtn}
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      // Add event listeners to pending order buttons
      if (status === 'pending' || status === 'all') {
        list.querySelectorAll('button[data-order]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const orderId = btn.getAttribute('data-order');
            btn.disabled = true;
            btn.innerHTML = '<span style="display: flex; align-items: center; gap: 8px;"><div class="ig-spinner" style="width: 16px; height: 16px; border-width: 2px;"></div> Processing...</span>';
            btn.style.opacity = '0.7';
            try {
              const res2 = await fetch(`/api/events/${ev.id}/orders/${orderId}/mark-paid`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...tokenHeaders() }
              });
              const d2 = await res2.json();
              if (!res2.ok) throw new Error(d2.error || 'Failed');
              showAlert && showAlert('Order confirmed and ticket issued!', 'success');
              loadOrdersForStatus(ev, state.currentOrderStatus || 'pending');
              loadPasses();
            } catch (e) {
              btn.disabled = false;
              btn.style.opacity = '1';
              btn.innerHTML = '<span style="display: flex; align-items: center; gap: 8px;">✓ Mark Paid & Issue</span>';
              showAlert && showAlert(e.message, 'error');
            }
          });
        });
      }
    } catch (e) {
      list.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center;">
          <div style="font-size: 64px; margin-bottom: 16px; opacity: 0.3;">⚠️</div>
          <div style="font-size: 18px; font-weight: 700; color: var(--ig-error); margin-bottom: 8px;">Failed to load orders</div>
          <div style="color: var(--ig-secondary-text); font-size: 14px;">${e.message}</div>
        </div>
      `;
    }
  }

  function closeOrders() {
    document.getElementById('ordersModal').style.display = 'none';
  }

  async function openManagePasses() {
    const ev = state.activeEvent;
    if (!ev) return;

    state.activeManageEventId = ev.id;

    const modal = document.getElementById('managePassesModal');
    const list = document.getElementById('managePassesList');
    document.getElementById('managePassesTitle').textContent = `Manage Pass Types`; 
    document.getElementById('managePassesSubtitle').textContent = ev.title || '';

    list.innerHTML = '<div class="ig-spinner"></div>';
    modal.style.display = 'flex';

    await refreshManagePassesList();
  }

  async function refreshManagePassesList() {
    const eventId = state.activeManageEventId;
    const list = document.getElementById('managePassesList');
    if (!eventId || !list) return;

    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types/manage`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      const types = data.types || [];
      if (!types.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text);">No pass types yet. Create one below.</div>';
        return;
      }

      list.innerHTML = types
        .map((t) => {
          const money = t.price_cents ? formatMoney(t.price_cents, t.currency) : 'Free';
          const status = t.is_active ? 'Active' : 'Inactive';
          return `
            <div class="exp-section" style="padding: 14px;">
              <div style="display:flex; justify-content:space-between; gap: 10px;">
                <div style="min-width:0;">
                  <div style="font-weight: 900;">${t.name}</div>
                  <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${money} • ${String(t.payment_mode || '').toUpperCase()} • ${status}</div>
                </div>
                <div style="display:flex; gap: 8px;">
                  <button class="exp-btn" data-edit="${t.id}">Edit</button>
                  <button class="exp-btn" data-del="${t.id}" ${t.is_active ? '' : 'disabled'}>Deactivate</button>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      list.querySelectorAll('button[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const typeId = btn.getAttribute('data-del');
          if (!confirm('Deactivate this pass type?')) return;
          try {
            const res2 = await fetch(`/api/events/${eventId}/tickets/types/${typeId}`, {
              method: 'DELETE',
              headers: tokenHeaders()
            });
            const d2 = await res2.json();
            if (!res2.ok) throw new Error(d2.error || 'Failed');
            refreshManagePassesList();
            loadDiscover();
            loadMine();
          } catch (e) {
            showAlert && showAlert(e.message, 'error');
          }
        });
      });

      list.querySelectorAll('button[data-edit]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const typeId = btn.getAttribute('data-edit');
          const t = types.find((x) => String(x.id) === String(typeId));
          if (!t) return;
          openEditPassType(t);
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text);">${e.message}</div>`;
    }
  }

  function openEditPassType(t) {
    document.getElementById('editTypeId').value = t.id;
    document.getElementById('editName').value = t.name || '';
    document.getElementById('editDesc').value = t.description || '';
    document.getElementById('editMode').value = t.payment_mode || 'free';
    document.getElementById('editContact').value = t.contact_text || '';
    document.getElementById('editPrice').value = ((Number(t.price_cents) || 0) / 100).toString();
    document.getElementById('editQty').value = t.quantity_total || '';
    document.getElementById('editActive').checked = !!t.is_active;
    document.getElementById('editPassModal').style.display = 'flex';
  }

  function closeManagePasses() {
    document.getElementById('managePassesModal').style.display = 'none';
  }

  async function createPassType() {
    const eventId = state.activeManageEventId;
    if (!eventId) return;

    const name = document.getElementById('newName').value.trim();
    const description = document.getElementById('newDesc').value.trim();
    const mode = document.getElementById('newMode').value;
    const contact = document.getElementById('newContact').value.trim();
    const price = Math.round(Math.max(0, Number(document.getElementById('newPrice').value || 0)) * 100);
    const qtyRaw = document.getElementById('newQty').value;
    const quantity_total = qtyRaw === '' ? null : Number(qtyRaw);

    if (name.length < 2) {
      showAlert && showAlert('Pass name is required', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({
          name,
          description,
          payment_mode: mode,
          contact_text: contact,
          price_cents: price,
          currency: 'INR',
          quantity_total
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      document.getElementById('newName').value = '';
      document.getElementById('newDesc').value = '';
      document.getElementById('newContact').value = '';
      document.getElementById('newPrice').value = '';
      document.getElementById('newQty').value = '';

      refreshManagePassesList();
      loadDiscover();
      loadMine();
      showAlert && showAlert('Pass type created', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }

  async function saveEditPassType() {
    const eventId = state.activeManageEventId;
    const typeId = document.getElementById('editTypeId').value;

    const payload = {
      name: document.getElementById('editName').value.trim(),
      description: document.getElementById('editDesc').value.trim(),
      payment_mode: document.getElementById('editMode').value,
      contact_text: document.getElementById('editContact').value.trim(),
      price_cents: Math.round(Math.max(0, Number(document.getElementById('editPrice').value || 0)) * 100),
      quantity_total: document.getElementById('editQty').value === '' ? null : Number(document.getElementById('editQty').value),
      is_active: document.getElementById('editActive').checked
    };

    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types/${typeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      document.getElementById('editPassModal').style.display = 'none';
      refreshManagePassesList();
      loadDiscover();
      loadMine();
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }

  function closeEditPass() {
    document.getElementById('editPassModal').style.display = 'none';
  }

  // Check-in function that can be called from button or QR scanner
  async function performCheckin(passCode) {
    const ev = state.activeEvent;
    if (!ev) return;

    const code = passCode || document.getElementById('checkinCode').value.trim();
    const out = document.getElementById('checkinResult');
    out.style.display = 'none';
    out.innerHTML = '';

    if (code.length < 8) {
      showCheckinResult('error', '⚠️ Invalid Code', 'Please enter a valid pass code (at least 8 characters)');
      return;
    }

    // Show loading
    showCheckinResult('loading', '🔍 Verifying...', 'Checking pass authenticity...');

    try {
      const res = await fetch(`/api/events/${ev.id}/tickets/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      
      if (!res.ok) {
        if (data.error === 'Ticket not found or already used') {
          if (data.details?.status === 'already_checked_in') {
            const checkedTime = data.details.checked_in_at ? new Date(data.details.checked_in_at).toLocaleString() : 'earlier';
            showCheckinResult('error', '⚠️ Already Checked In', 
              `This pass was already used.<br/><br/>
              <strong>Attendee:</strong> ${data.details.attendee || 'Unknown'}<br/>
              <strong>Checked in:</strong> ${checkedTime}<br/><br/>
              ⚠️ This could be a duplicate attempt.`);
          } else {
            showCheckinResult('error', '❌ Invalid or Used Pass', 'This pass code is either:<br/>• Not genuine (fake/invalid)<br/>• Already checked in<br/>• For a different event');
          }
        } else {
          showCheckinResult('error', '❌ Verification Failed', data.error || 'Could not verify this pass');
        }
        return;
      }
      
      // Success - pass is genuine and ticket info returned
      const ticket = data.ticket || {};
      showCheckinResult('success', '✅ Pass Verified - Check-in Complete!', 
        `<div style="font-size: 13px; margin-top: 12px; line-height: 1.8;">
          <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 10px; margin-bottom: 8px;">
            <div style="margin-bottom: 6px;"><strong>👤 Attendee:</strong> <span style="color: #00d4aa; font-weight: 700;">${ticket.attendee || 'Guest'}</span></div>
            <div style="margin-bottom: 6px;"><strong>🎫 Ticket Type:</strong> ${ticket.ticket_type || 'Pass'}</div>
            <div><strong>📅 Event:</strong> ${ev.title}</div>
          </div>
          <div style="font-size: 12px; color: var(--ig-secondary-text); text-align: center; margin-top: 12px;">
            ✓ Pass is genuine and has been marked as checked in
          </div>
        </div>`);
      
      // Clear input for next scan
      setTimeout(() => {
        document.getElementById('checkinCode').value = '';
        document.getElementById('checkinCode').focus();
      }, 2000);
      
    } catch (e) {
      showCheckinResult('error', '❌ Verification Error', e.message || 'Network error - please try again');
    }
  }

  // Wrapper for button click
  async function checkInCode() {
    await performCheckin();
  }

  function showCheckinResult(type, title, message) {
    const out = document.getElementById('checkinResult');
    const colors = {
      success: { bg: 'rgba(0, 212, 170, 0.15)', border: 'rgba(0, 212, 170, 0.3)', text: '#00d4aa' },
      error: { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', text: '#ef4444' },
      loading: { bg: 'rgba(102, 126, 234, 0.15)', border: 'rgba(102, 126, 234, 0.3)', text: '#667eea' }
    };
    const style = colors[type] || colors.loading;
    
    out.style.display = 'block';
    out.innerHTML = `
      <div style="background: ${style.bg}; border: 2px solid ${style.border}; border-radius: 14px; padding: 18px;">
        <div style="font-weight: 900; font-size: 16px; color: ${style.text}; margin-bottom: 8px;">${title}</div>
        <div style="color: var(--ig-secondary-text); font-size: 13px; line-height: 1.6;">${message}</div>
      </div>
    `;
  }

let html5QrCode = null;

  function openCheckin() {
    document.getElementById('checkinModal').style.display = 'flex';
    document.getElementById('checkinCode').value = '';
    document.getElementById('checkinResult').style.display = 'none';
    document.getElementById('checkinResult').innerHTML = '';
    
    // Default to manual entry
    document.getElementById('manualEntrySection').style.display = 'block';
    document.getElementById('qrScannerSection').style.display = 'none';
    
    // Focus input
    setTimeout(() => {
      document.getElementById('checkinCode').focus();
    }, 100);
  }

  function closeCheckin() {
    // Stop scanner if running
    if (html5QrCode && html5QrCode.isScanning) {
      html5QrCode.stop().catch(() => {});
    }
    document.getElementById('checkinModal').style.display = 'none';
  }
  
  async function startQRScanner() {
    const readerDiv = document.getElementById('qr-reader');
    const statusDiv = document.getElementById('qr-reader-status');
    
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("qr-reader");
    }
    
    // Don't start if already scanning
    if (html5QrCode.isScanning) {
      statusDiv.style.display = 'block';
      return;
    }
    
    try {
      await html5QrCode.start(
        { facingMode: "environment" }, // Use back camera
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          // Success! Got QR code
          if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(() => {});
          }
          
          // Show manual section and trigger check-in
          toggleScanMethod('manual');
          document.getElementById('checkinCode').value = decodedText;
          performCheckin(decodedText);
        },
        (errorMessage) => {
          // Scanning errors (no QR found) - ignore
        }
      );
      statusDiv.style.display = 'block';
    } catch (err) {
      readerDiv.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; background: rgba(255,87,87,0.1); border-radius: 12px; border: 2px dashed rgba(255,87,87,0.3);">
          <div style="font-size: 36px; margin-bottom: 12px;">❌</div>
          <div style="font-weight: 700; font-size: 14px; color: #ff5757; margin-bottom: 8px;">Camera Access Denied</div>
          <div style="font-size: 12px; color: var(--ig-secondary-text); line-height: 1.5;">
            Please allow camera permissions in your browser settings and try again.
          </div>
        </div>
      `;
    }
  }
  
  function toggleScanMethod(method) {
    const scanBtn = document.getElementById('btnScanMethod');
    const manualBtn = document.getElementById('btnManualMethod');
    const scanSection = document.getElementById('qrScannerSection');
    const manualSection = document.getElementById('manualEntrySection');
    
    if (method === 'scan') {
      scanBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      scanBtn.style.color = 'white';
      manualBtn.style.background = '';
      manualBtn.style.color = '';
      scanSection.style.display = 'block';
      manualSection.style.display = 'none';
      
      // Start scanner
      startQRScanner();
    } else {
      // Stop scanner
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(() => {});
      }
      
      manualBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      manualBtn.style.color = 'white';
      scanBtn.style.background = '';
      scanBtn.style.color = '';
      scanSection.style.display = 'none';
      manualSection.style.display = 'block';
      document.getElementById('checkinCode').focus();
    }
  }

  // ===== Security Staff Management =====
  async function openSecurityStaff() {
    const ev = state.activeEvent;
    if (!ev) return;

    document.getElementById('securityStaffModal').style.display = 'flex';
    document.getElementById('staffFullName').value = '';
    document.getElementById('staffUsername').value = '';
    document.getElementById('staffPassword').value = '';
    document.getElementById('addStaffResult').textContent = '';
    
    // Set scanner URL
    const scannerUrl = `${window.location.origin}/ticket-scanner.html`;
    document.getElementById('scannerUrl').textContent = scannerUrl;
    
    // Load staff list
    await loadSecurityStaff();
  }

  function closeSecurityStaff() {
    document.getElementById('securityStaffModal').style.display = 'none';
  }

  function copyScannerURL() {
    const url = document.getElementById('scannerUrl').textContent;
    navigator.clipboard.writeText(url).then(() => {
      alert('Scanner URL copied to clipboard!');
    });
  }

  async function loadSecurityStaff() {
    const ev = state.activeEvent;
    if (!ev) return;

    const list = document.getElementById('staffList');
    list.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch(`/api/events/${ev.id}/checkin-staff`, {
        headers: tokenHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const staff = data.staff || [];
      document.getElementById('staffCount').textContent = staff.length;

      if (!staff.length) {
        list.innerHTML = `
          <div style="padding: 20px; text-align: center; color: var(--ig-secondary-text); font-size: 14px;">
            No security staff added yet. Add staff members above.
          </div>
        `;
        return;
      }

      list.innerHTML = staff.map(s => {
        const lastLogin = s.last_login ? new Date(s.last_login).toLocaleString() : 'Never';
        const isActive = s.is_active ? '✓ Active' : '✗ Inactive';
        const statusColor = s.is_active ? '#00d4aa' : '#ff5757';

        return `
          <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
              <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 900; font-size: 14px; color: var(--ig-primary-text); margin-bottom: 6px;">${s.full_name || s.username}</div>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; font-size: 11px; color: var(--ig-secondary-text);">
                  <strong>Username:</strong>
                  <span style="font-family: 'Courier New', monospace; color: #00d4aa;">${s.username}</span>
                  
                  <strong>Event ID:</strong>
                  <span>${ev.id}</span>
                  
                  <strong>Last Login:</strong>
                  <span>${lastLogin}</span>
                  
                  <strong>Status:</strong>
                  <span style="color: ${statusColor}; font-weight: 700;">${isActive}</span>
                </div>
              </div>
              <button onclick="deleteStaff(${s.id})" class="exp-icon-btn" style="background: rgba(255,59,48,0.15); border-color: rgba(255,59,48,0.3); color: #ff3b30; flex-shrink: 0;">🗑️</button>
            </div>
          </div>
        `;
      }).join('');

    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-error); padding: 14px; text-align: center;">${e.message}</div>`;
    }
  }

  async function addSecurityStaff() {
    const ev = state.activeEvent;
    if (!ev) return;

    const fullName = document.getElementById('staffFullName').value.trim();
    const username = document.getElementById('staffUsername').value.trim();
    const password = document.getElementById('staffPassword').value.trim();
    const result = document.getElementById('addStaffResult');

    result.textContent = '';

    if (!username || !password) {
      result.textContent = 'Username and password are required';
      result.style.color = 'var(--ig-error)';
      return;
    }

    if (username.length < 3) {
      result.textContent = 'Username must be at least 3 characters';
      result.style.color = 'var(--ig-error)';
      return;
    }

    if (password.length < 6) {
      result.textContent = 'Password must be at least 6 characters';
      result.style.color = 'var(--ig-error)';
      return;
    }

    try {
      const res = await fetch(`/api/events/${ev.id}/checkin-staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ username, password, full_name: fullName })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      result.textContent = '✓ Staff member added successfully!';
      result.style.color = '#00d4aa';

      // Clear form
      document.getElementById('staffFullName').value = '';
      document.getElementById('staffUsername').value = '';
      document.getElementById('staffPassword').value = '';

      // Reload staff list
      await loadSecurityStaff();

    } catch (e) {
      result.textContent = e.message;
      result.style.color = 'var(--ig-error)';
    }
  }

  async function deleteStaff(staffId) {
    const ev = state.activeEvent;
    if (!ev) return;

    if (!confirm('Remove this staff member? They will no longer be able to check-in tickets.')) {
      return;
    }

    try {
      const res = await fetch(`/api/events/${ev.id}/checkin-staff/${staffId}`, {
        method: 'DELETE',
        headers: tokenHeaders()
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      await loadSecurityStaff();

    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  // Expose deleteStaff to global for inline onclick
  window.deleteStaff = deleteStaff;
  window.copyScannerURL = copyScannerURL;

  // ===== Create Event Modal =====
  function openCreateEvent() {
    document.getElementById('createEventModal').style.display = 'flex';
    document.getElementById('ceCity').value = state.city || '';
    document.getElementById('cePublic').checked = true;
    renderCreateEventPassTypes(); // Initialize pass types list
  }

  function closeCreateEvent() {
    document.getElementById('createEventModal').style.display = 'none';
    
    // Reset all form fields
    document.getElementById('ceTitle').value = '';
    document.getElementById('ceDate').value = '';
    document.getElementById('ceCity').value = '';
    document.getElementById('ceCategory').value = '';
    document.getElementById('ceLocation').value = '';
    document.getElementById('ceCoverFile').value = '';
    document.getElementById('ceCover').value = '';
    document.getElementById('ceMaxPersons').value = '';
    document.getElementById('ceOrganizer').value = '';
    document.getElementById('ceNote').value = '';
    document.getElementById('ceDesc').value = '';
    
    // Reset pass types form
    state.createEventPassTypes = [];
    document.getElementById('cePassName').value = '';
    document.getElementById('cePassMode').value = 'free';
    document.getElementById('cePassPrice').value = '';
    document.getElementById('cePassCapacity').value = '';
    document.getElementById('cePassDesc').value = '';
    document.getElementById('cePassContact').value = '';
    renderCreateEventPassTypes();
  }

  async function createEvent() {
    const title = document.getElementById('ceTitle').value.trim();
    const event_date = document.getElementById('ceDate').value;
    const location = document.getElementById('ceLocation').value.trim();
    const description = document.getElementById('ceDesc').value.trim();
    const city = document.getElementById('ceCity').value.trim();
    const category = document.getElementById('ceCategory').value.trim();
    const cover_image = document.getElementById('ceCover').value.trim();
    const cover_file = document.getElementById('ceCoverFile').files[0];
    const organizer_name = document.getElementById('ceOrganizer').value.trim();
    const important_note = document.getElementById('ceNote').value.trim();
    const is_public = document.getElementById('cePublic').checked;
    const max_persons = document.getElementById('ceMaxPersons').value;

    if (!title || !event_date) {
      showAlert && showAlert('Title and date required', 'error');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description || '');
      formData.append('event_date', event_date);
      formData.append('location', location);
      formData.append('city', city);
      formData.append('category', category);
      formData.append('organizer_name', organizer_name);
      formData.append('important_note', important_note);
      formData.append('is_public', is_public ? '1' : '0');
      formData.append('notes', '');
      formData.append('max_persons', max_persons || '');

      // Handle cover image (file or URL)
      if (cover_file) {
        formData.append('cover_photo', cover_file);
      } else if (cover_image) {
        formData.append('cover_image', cover_image);
      }

      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { ...tokenHeaders() }, // No Content-Type for FormData
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      
      // If pass types were added, create them for the new event
      const eventId = data.event?.id;
      if (eventId && state.createEventPassTypes.length > 0) {
        await createPassTypesForEvent(eventId, state.createEventPassTypes);
      }
      
      closeCreateEvent();
      
      // Reload filter options to show new city/category
      await loadFilterOptions();
      
      setTab('mine');
      loadMine();
      showAlert && showAlert('Event created', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }

  // Create multiple pass types for an event
  async function createPassTypesForEvent(eventId, passTypes) {
    try {
      for (const passType of passTypes) {
        await fetch(`/api/events/${eventId}/tickets/types`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
          body: JSON.stringify({
            name: passType.name,
            payment_mode: passType.mode,
            price_cents: Math.floor((parseFloat(passType.price) || 0) * 100),
            quantity_total: passType.capacity ? parseInt(passType.capacity) : null,
            description: passType.description || '',
            contact_text: passType.contact || '',
            payment_methods: passType.paymentMethods || ''
          })
        });
      }
    } catch (e) {
      console.error('Failed to create pass types:', e);
    }
  }

  // ===== EDIT EVENT =====
  
  async function openEditEvent() {
    if (!state.activeEvent) return;
    
    const event = state.activeEvent;
    document.getElementById('editEventModal').style.display = 'flex';
    
    // Populate form with existing event data
    document.getElementById('eeEventId').value = event.id;
    document.getElementById('eeTitle').value = event.title || '';
    document.getElementById('eeCity').value = event.city || '';
    document.getElementById('eeCategory').value = event.category || '';
    document.getElementById('eeLocation').value = event.location || '';
    document.getElementById('eeCover').value = event.cover_image || '';
    document.getElementById('eeMaxPersons').value = event.max_persons || '';
    document.getElementById('eeOrganizer').value = event.organizer_name || '';
    document.getElementById('eeNote').value = event.important_note || '';
    document.getElementById('eeDesc').value = event.description || '';
    document.getElementById('eePublic').checked = event.is_public !== 0;
    
    // Handle datetime-local format
    if (event.event_date) {
      const date = new Date(normalizeSqliteDate(event.event_date));
      const localISOTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById('eeDate').value = localISOTime;
    }
    
    // Load pass types for this event
    await loadEditEventPassTypes(event.id);
  }
  
  // Load pass types for editing
  async function loadEditEventPassTypes(eventId) {
    const list = document.getElementById('eePassTypesList');
    if (!list) return;
    
    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types/manage`, { headers: tokenHeaders() });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to load pass types');
      
      const types = data.types || [];
      
      if (types.length === 0) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text); font-size: 13px; padding: 8px;">No pass types yet. Add one below.</div>';
        return;
      }
      
      list.innerHTML = types.map(pt => {
        const priceStr = pt.payment_mode === 'free' ? 'Free' : `₹${(parseFloat(pt.price_cents || 0) / 100).toFixed(2)}`;
        const capacityStr = pt.quantity_total ? ` • Capacity: ${pt.quantity_sold || 0}/${pt.quantity_total}` : '';
        const statusBadge = pt.is_active ? '<span style="background: rgba(0,212,170,0.15); color: #00d4aa; padding: 2px 8px; border-radius: 4px; font-size: 11px;">Active</span>' : '<span style="background: rgba(255,59,48,0.15); color: #ff3b30; padding: 2px 8px; border-radius: 4px; font-size: 11px;">Inactive</span>';
        
        // Properly escape all string values for onclick handler
        const escapeName = (pt.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ').replace(/\r/g, '');
        const escapeDesc = (pt.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ').replace(/\r/g, '');
        const escapeContact = (pt.contact_text || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ').replace(/\r/g, '');
        const escapePaymentMethods = (pt.payment_methods || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ').replace(/\r/g, '');
        
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--ig-background); border: 1px solid var(--ig-border); border-radius: 8px;">
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                ${pt.name} - ${priceStr}
                ${statusBadge}
              </div>
              <div style="font-size: 12px; color: var(--ig-secondary-text);">
                ${pt.payment_mode.charAt(0).toUpperCase() + pt.payment_mode.slice(1)}${capacityStr}
              </div>
            </div>
            <div style="display: flex; gap: 8px; flex-shrink: 0;">
              <button type="button" onclick="editExistingPassType(${eventId}, ${pt.id}, '${escapeName}', '${pt.payment_mode}', ${pt.price_cents || 0}, ${pt.quantity_total || 'null'}, '${escapeDesc}', '${escapeContact}', ${pt.is_active ? 1 : 0}, '${escapePaymentMethods}')" class="exp-icon-btn" style="width: auto; padding: 6px 12px; font-size: 12px; background: rgba(0,149,246,0.15); border-color: rgba(0,149,246,0.3); color: #0095f6;" title="Edit">
                ✏️
              </button>
              <button type="button" onclick="togglePassTypeStatus(${eventId}, ${pt.id}, ${pt.is_active ? 0 : 1})" class="exp-icon-btn" style="width: auto; padding: 6px 12px; font-size: 12px; background: rgba(168,85,247,0.15); border-color: rgba(168,85,247,0.3); color: #a855f7;" title="${pt.is_active ? 'Deactivate' : 'Activate'}">
                ${pt.is_active ? '👁️' : '🚫'}
              </button>
              <button type="button" onclick="deleteEditPassType(${eventId}, ${pt.id})" class="exp-icon-btn" style="background: rgba(255,59,48,0.15); border-color: rgba(255,59,48,0.3); color: #ff3b30;" title="Delete">✕</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('Error loading pass types:', e);
      list.innerHTML = '<div style="color: var(--ig-secondary-text); font-size: 13px; padding: 8px;">Error loading pass types</div>';
    }
  }
  
  // Add pass type in edit modal
  async function addPassTypeInEdit() {
    const editingTypeId = document.getElementById('eeEditingPassTypeId');
    const eventId = document.getElementById('eeEventId').value;
    if (!eventId) return;
    
    const name = document.getElementById('eeNewPassName').value.trim();
    const mode = document.getElementById('eeNewPassMode').value;
    const price = document.getElementById('eeNewPassPrice').value;
    const capacity = document.getElementById('eeNewPassCapacity').value;
    const description = document.getElementById('eeNewPassDesc').value.trim();
    const contact = document.getElementById('eeNewPassContact').value.trim();

    if (!name) {
      showAlert && showAlert('Pass type name is required', 'error');
      return;
    }

    // Collect payment methods if paid
    let paymentMethods = [];
    if (mode === 'paid') {
      if (document.getElementById('eePaymentDM').checked) paymentMethods.push('dm');
      if (document.getElementById('eePaymentVenue').checked) paymentMethods.push('venue');
      if (document.getElementById('eePaymentOnline').checked) paymentMethods.push('online');
      
      if (paymentMethods.length === 0) {
        showAlert && showAlert('Please select at least one payment method for paid passes', 'error');
        return;
      }
    }

    const isEditing = editingTypeId && editingTypeId.value;

    try {
      const url = isEditing 
        ? `/api/events/${eventId}/tickets/types/${editingTypeId.value}`
        : `/api/events/${eventId}/tickets/types`;
      
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({
          name,
          payment_mode: mode,
          price_cents: Math.floor((parseFloat(price) || 0) * 100),
          quantity_total: capacity ? parseInt(capacity) : null,
          description: description || '',
          contact_text: contact || '',
          payment_methods: paymentMethods.join(',')
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${isEditing ? 'update' : 'add'} pass type`);
      
      // Reset form
      document.getElementById('eeNewPassName').value = '';
      document.getElementById('eeNewPassMode').value = 'free';
      document.getElementById('eeNewPassPrice').value = '';
      document.getElementById('eeNewPassCapacity').value = '';
      document.getElementById('eeNewPassDesc').value = '';
      document.getElementById('eeNewPassContact').value = '';
      document.getElementById('eePaymentDM').checked = false;
      document.getElementById('eePaymentVenue').checked = false;
      document.getElementById('eePaymentOnline').checked = false;
      document.getElementById('eePaymentMethods').style.display = 'none';
      if (editingTypeId) editingTypeId.value = '';
      
      // Reset form title and button
      const detailsElement = document.querySelector('#editEventModal details');
      const summaryText = detailsElement.querySelector('summary');
      if (summaryText) {
        summaryText.innerHTML = '<span style="color: #a855f7;">+</span> <strong>Add New Pass Type</strong>';
      }
      const btnAdd = document.getElementById('btnAddPassTypeInEdit');
      if (btnAdd) btnAdd.textContent = 'Add Pass Type';
      
      // Hide cancel button
      const btnCancel = document.getElementById('btnCancelPassTypeEdit');
      if (btnCancel) btnCancel.style.display = 'none';
      
      // Reload pass types
      await loadEditEventPassTypes(eventId);
      showAlert && showAlert(`Pass type ${isEditing ? 'updated' : 'added'}`, 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }
  
  // Edit existing pass type (populate form for editing)
  window.editExistingPassType = function(eventId, typeId, name, paymentMode, priceCents, quantityTotal, description, contactText, isActive, paymentMethods) {
    // Populate the form with existing data
    document.getElementById('eeNewPassName').value = name;
    document.getElementById('eeNewPassMode').value = paymentMode;
    document.getElementById('eeNewPassPrice').value = priceCents ? (parseFloat(priceCents) / 100).toFixed(2) : '';
    document.getElementById('eeNewPassCapacity').value = quantityTotal || '';
    document.getElementById('eeNewPassDesc').value = description || '';
    document.getElementById('eeNewPassContact').value = contactText || '';
    
    // Handle payment methods
    if (paymentMode === 'paid' && paymentMethods) {
      const methods = paymentMethods.split(',');
      document.getElementById('eePaymentDM').checked = methods.includes('dm');
      document.getElementById('eePaymentVenue').checked = methods.includes('venue');
      document.getElementById('eePaymentOnline').checked = methods.includes('online');
      document.getElementById('eePaymentMethods').style.display = 'block';
    } else {
      document.getElementById('eePaymentDM').checked = false;
      document.getElementById('eePaymentVenue').checked = false;
      document.getElementById('eePaymentOnline').checked = false;
      document.getElementById('eePaymentMethods').style.display = 'none';
    }
    
    // Store the editing type ID in a hidden field
    let editingTypeIdInput = document.getElementById('eeEditingPassTypeId');
    if (!editingTypeIdInput) {
      editingTypeIdInput = document.createElement('input');
      editingTypeIdInput.type = 'hidden';
      editingTypeIdInput.id = 'eeEditingPassTypeId';
      document.getElementById('editEventModal').appendChild(editingTypeIdInput);
    }
    editingTypeIdInput.value = typeId;
    
    // Change form title and button text
    const detailsElement = document.querySelector('#editEventModal details');
    const detailsSummary = detailsElement.querySelector('summary strong');
    if (detailsSummary) detailsSummary.textContent = 'Edit Pass Type';
    
    // Update summary text (the whole summary)
    const summaryText = detailsElement.querySelector('summary');
    if (summaryText) {
      summaryText.innerHTML = '<span style="color: #a855f7;">✏️</span> <strong>Edit Pass Type</strong>';
    }
    
    const btnAdd = document.getElementById('btnAddPassTypeInEdit');
    if (btnAdd) btnAdd.textContent = 'Update Pass Type';
    
    // Show cancel button
    const btnCancel = document.getElementById('btnCancelPassTypeEdit');
    if (btnCancel) btnCancel.style.display = 'block';
    
    // Open the details element if closed
    detailsElement.open = true;
    
    // Scroll to the form
    detailsElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // Cancel editing pass type
  function cancelPassTypeEdit() {
    // Reset form
    document.getElementById('eeNewPassName').value = '';
    document.getElementById('eeNewPassMode').value = 'free';
    document.getElementById('eeNewPassPrice').value = '';
    document.getElementById('eeNewPassCapacity').value = '';
    document.getElementById('eeNewPassDesc').value = '';
    document.getElementById('eeNewPassContact').value = '';
    
    // Clear editing type ID
    const editingTypeId = document.getElementById('eeEditingPassTypeId');
    if (editingTypeId) editingTypeId.value = '';
    
    // Reset summary text
    const detailsElement = document.querySelector('#editEventModal details');
    const summaryText = detailsElement.querySelector('summary');
    if (summaryText) {
      summaryText.innerHTML = '<span style="color: #a855f7;">+</span> <strong>Add New Pass Type</strong>';
    }
    
    // Reset button text
    const btnAdd = document.getElementById('btnAddPassTypeInEdit');
    if (btnAdd) btnAdd.textContent = 'Add Pass Type';
    
    // Hide cancel button
    const btnCancel = document.getElementById('btnCancelPassTypeEdit');
    if (btnCancel) btnCancel.style.display = 'none';
    
    // Close the details element
    detailsElement.open = false;
  }

  // Delete pass type from edit modal
  async function deleteEditPassType(eventId, typeId) {
    if (!confirm('Delete this pass type? This cannot be undone.')) return;
    
    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types/${typeId}`, {
        method: 'DELETE',
        headers: tokenHeaders()
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete pass type');
      
      await loadEditEventPassTypes(eventId);
      showAlert && showAlert('Pass type deleted', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }
  
  // Toggle pass type active status
  async function togglePassTypeStatus(eventId, typeId, newStatus) {
    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types/${typeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ is_active: newStatus })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      
      await loadEditEventPassTypes(eventId);
      showAlert && showAlert(newStatus ? 'Pass type activated' : 'Pass type deactivated', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }
  
  // Expose functions to window for inline onclick handlers
  window.deleteEditPassType = deleteEditPassType;
  window.togglePassTypeStatus = togglePassTypeStatus;
  
  function closeEditEvent() {
    document.getElementById('editEventModal').style.display = 'none';
    
    // Reset form
    document.getElementById('eeTitle').value = '';
    document.getElementById('eeDate').value = '';
    document.getElementById('eeCity').value = '';
    document.getElementById('eeCategory').value = '';
    document.getElementById('eeLocation').value = '';
    document.getElementById('eeCoverFile').value = '';
    document.getElementById('eeCover').value = '';
    document.getElementById('eeMaxPersons').value = '';
    document.getElementById('eeOrganizer').value = '';
    document.getElementById('eeNote').value = '';
    document.getElementById('eeDesc').value = '';
    
    // Reset pass types fields
    document.getElementById('eeNewPassName').value = '';
    document.getElementById('eeNewPassMode').value = 'free';
    document.getElementById('eeNewPassPrice').value = '';
    document.getElementById('eeNewPassCapacity').value = '';
    document.getElementById('eeNewPassDesc').value = '';
    document.getElementById('eeNewPassContact').value = '';
    document.getElementById('eePassTypesList').innerHTML = '';
    
    // Reset editing mode
    const editingTypeId = document.getElementById('eeEditingPassTypeId');
    if (editingTypeId) editingTypeId.value = '';
    
    const detailsElement = document.querySelector('#editEventModal details');
    const summaryText = detailsElement ? detailsElement.querySelector('summary') : null;
    if (summaryText) {
      summaryText.innerHTML = '<span style="color: #a855f7;">+</span> <strong>Add New Pass Type</strong>';
    }
    
    const btnAdd = document.getElementById('btnAddPassTypeInEdit');
    if (btnAdd) btnAdd.textContent = 'Add Pass Type';
    
    const btnCancel = document.getElementById('btnCancelPassTypeEdit');
    if (btnCancel) btnCancel.style.display = 'none';
  }
  
  async function deleteEvent() {
    const ev = state.activeEvent;
    if (!ev) return;

    if (!confirm(`Delete "${ev.title}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/events/${ev.id}`, {
        method: 'DELETE',
        headers: tokenHeaders()
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete event');

      closeEventDetail();
      await loadFilterOptions(); // Refresh filter options since event was deleted
      setTab('mine'); // Switch to my events tab
      loadMine();
      showAlert && showAlert('Event deleted successfully', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }

  async function updateEvent() {
    const eventId = document.getElementById('eeEventId').value;
    const title = document.getElementById('eeTitle').value.trim();
    const event_date = document.getElementById('eeDate').value;
    const location = document.getElementById('eeLocation').value.trim();
    const description = document.getElementById('eeDesc').value.trim();
    const city = document.getElementById('eeCity').value.trim();
    const category = document.getElementById('eeCategory').value.trim();
    const cover_image = document.getElementById('eeCover').value.trim();
    const cover_file = document.getElementById('eeCoverFile').files[0];
    const organizer_name = document.getElementById('eeOrganizer').value.trim();
    const important_note = document.getElementById('eeNote').value.trim();
    const is_public = document.getElementById('eePublic').checked;
    const max_persons = document.getElementById('eeMaxPersons').value;

    if (!title || !event_date) {
      showAlert && showAlert('Title and date required', 'error');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description || '');
      formData.append('event_date', event_date);
      formData.append('location', location);
      formData.append('city', city);
      formData.append('category', category);
      formData.append('organizer_name', organizer_name);
      formData.append('important_note', important_note);
      formData.append('is_public', is_public ? '1' : '0');
      formData.append('notes', '');
      formData.append('max_persons', max_persons || '');

      // Handle cover image (file or URL)
      if (cover_file) {
        formData.append('cover_photo', cover_file);
      } else if (cover_image) {
        formData.append('cover_image', cover_image);
      }

      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: { ...tokenHeaders() },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update event');
      
      closeEditEvent();
      closeEventDetail(); // Close detail view
      await loadFilterOptions(); // Refresh filter options in case city/category changed
      setTab('mine'); // Refresh my events
      loadMine();
      showAlert && showAlert('Event updated successfully', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }

  // Handle pass mode change for create event
  function handlePassModeChange() {
    const mode = document.getElementById('cePassMode').value;
    const paymentMethods = document.getElementById('cePaymentMethods');
    
    if (mode === 'paid') {
      paymentMethods.style.display = 'block';
    } else {
      paymentMethods.style.display = 'none';
      // Uncheck all payment methods
      document.getElementById('cePaymentDM').checked = false;
      document.getElementById('cePaymentVenue').checked = false;
      document.getElementById('cePaymentOnline').checked = false;
    }
  }

  // Handle pass mode change for edit event
  function handleEditPassModeChange() {
    const mode = document.getElementById('eeNewPassMode').value;
    const paymentMethods = document.getElementById('eePaymentMethods');
    
    if (mode === 'paid') {
      paymentMethods.style.display = 'block';
    } else {
      paymentMethods.style.display = 'none';
      // Uncheck all payment methods
      document.getElementById('eePaymentDM').checked = false;
      document.getElementById('eePaymentVenue').checked = false;
      document.getElementById('eePaymentOnline').checked = false;
    }
  }

  // Add pass type to create event form
  function addPassTypeToCreate() {
    const name = document.getElementById('cePassName').value.trim();
    const mode = document.getElementById('cePassMode').value;
    const price = document.getElementById('cePassPrice').value;
    const capacity = document.getElementById('cePassCapacity').value;
    const description = document.getElementById('cePassDesc').value.trim();
    const contact = document.getElementById('cePassContact').value.trim();

    if (!name) {
      showAlert && showAlert('Pass type name is required', 'error');
      return;
    }

    // Collect payment methods if paid
    let paymentMethods = [];
    if (mode === 'paid') {
      if (document.getElementById('cePaymentDM').checked) paymentMethods.push('dm');
      if (document.getElementById('cePaymentVenue').checked) paymentMethods.push('venue');
      if (document.getElementById('cePaymentOnline').checked) paymentMethods.push('online');
      
      if (paymentMethods.length === 0) {
        showAlert && showAlert('Please select at least one payment method for paid passes', 'error');
        return;
      }
    }

    state.createEventPassTypes.push({
      id: Date.now(), // Temporary ID for UI
      name,
      mode,
      price: price || '0',
      capacity: capacity || '',
      description,
      contact,
      paymentMethods: paymentMethods.join(',')
    });

    // Reset form
    document.getElementById('cePassName').value = '';
    document.getElementById('cePassMode').value = 'free';
    document.getElementById('cePassPrice').value = '';
    document.getElementById('cePassCapacity').value = '';
    document.getElementById('cePassDesc').value = '';
    document.getElementById('cePassContact').value = '';
    document.getElementById('cePaymentDM').checked = false;
    document.getElementById('cePaymentVenue').checked = false;
    document.getElementById('cePaymentOnline').checked = false;
    document.getElementById('cePaymentMethods').style.display = 'none';

    renderCreateEventPassTypes();
  }

  // Render pass types list in create event form
  function renderCreateEventPassTypes() {
    const list = document.getElementById('cePassTypesList');
    if (!list) return;

    if (state.createEventPassTypes.length === 0) {
      list.innerHTML = '<div style="color: var(--ig-secondary-text); font-size: 13px; padding: 8px;">No pass types added yet. Add at least one below.</div>';
      return;
    }

    list.innerHTML = state.createEventPassTypes.map((pt, index) => {
      const priceStr = pt.mode === 'free' ? 'Free' : `₹${parseFloat(pt.price || 0).toFixed(2)}`;
      const capacityStr = pt.capacity ? ` • Capacity: ${pt.capacity}` : '';
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--ig-background); border: 1px solid var(--ig-border); border-radius: 8px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600;">${pt.name} - ${priceStr}</div>
            <div style="font-size: 12px; color: var(--ig-secondary-text);">
              ${pt.mode.charAt(0).toUpperCase() + pt.mode.slice(1)}${capacityStr}
            </div>
          </div>
          <button type="button" onclick="((i) => { window.state.createEventPassTypes.splice(i, 1); window.renderCreateEventPassTypes(); })(${index})" class="exp-icon-btn" style="background: rgba(255,59,48,0.15); border-color: rgba(255,59,48,0.3); color: #ff3b30;">✕</button>
        </div>
      `;
    }).join('');
  }

  // Expose functions to global scope for inline onclick handlers
  window.state = state;
  window.renderCreateEventPassTypes = renderCreateEventPassTypes;

  // ===== Wire up =====
  function wire() {
    try {
      const cityBtn = document.getElementById('cityBtn');
      const cityLabel = document.getElementById('cityLabel');
      if (cityLabel) cityLabel.textContent = state.city || 'All Cities';

      const filtersBtn = document.getElementById('filtersBtn');
      const filtersOverlay = document.getElementById('filtersOverlay');
      const closeFiltersBtn = document.getElementById('closeFilters');
      const applyFiltersBtn = document.getElementById('applyFilters');
      const clearFiltersBtn = document.getElementById('clearFilters');

      if (filtersBtn) filtersBtn.addEventListener('click', openFilters);
      if (filtersOverlay) {
        filtersOverlay.addEventListener('click', (e) => {
          // Only close if clicking the overlay itself, not the drawer
          if (e.target.id === 'filtersOverlay') closeFilters();
        });
      }
      if (closeFiltersBtn) closeFiltersBtn.addEventListener('click', closeFilters);
      if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', applyFilters);
      if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);

      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            state.query = e.target.value.trim();
            loadDiscover();
          }
        });
      }

      if (cityBtn) {
        cityBtn.addEventListener('click', () => {
          openFilters();
          const filterCity = document.getElementById('filterCity');
          if (filterCity) filterCity.focus();
        });
      }

      const closeEventOverlay = document.getElementById('closeEventOverlay');
      if (closeEventOverlay) closeEventOverlay.addEventListener('click', closeEventDetail);
      
      const eventOverlay = document.getElementById('eventOverlay');
      if (eventOverlay) {
        eventOverlay.addEventListener('click', (e) => {
          if (e.target.id === 'eventOverlay') closeEventDetail();
        });
      }

      const btnShareEvent = document.getElementById('btnShareEvent');
      if (btnShareEvent) {
        btnShareEvent.addEventListener('click', () => {
          if (state.activeEvent) {
            shareEvent(state.activeEvent);
          }
        });
      }

      const btnSelectTickets = document.getElementById('btnSelectTickets');
      if (btnSelectTickets) btnSelectTickets.addEventListener('click', openTicketsModal);
      
      const btnEditEvent = document.getElementById('btnEditEvent');
      if (btnEditEvent) btnEditEvent.addEventListener('click', openEditEvent);
      
      const btnDeleteEvent = document.getElementById('btnDeleteEvent');
      if (btnDeleteEvent) btnDeleteEvent.addEventListener('click', deleteEvent);
      
      const btnOrders = document.getElementById('btnOrders');
      if (btnOrders) btnOrders.addEventListener('click', openOrders);
      
      const btnCheckin = document.getElementById('btnCheckin');
      if (btnCheckin) btnCheckin.addEventListener('click', openCheckin);
      
      const btnSecurityStaff = document.getElementById('btnSecurityStaff');
      if (btnSecurityStaff) btnSecurityStaff.addEventListener('click', openSecurityStaff);

      const closeTickets = document.getElementById('closeTickets');
      if (closeTickets) closeTickets.addEventListener('click', closeTicketsModal);
      
      const ticketQty = document.getElementById('ticketQty');
      if (ticketQty) ticketQty.addEventListener('input', updateTicketTotal);
      
      const ticketsModal = document.getElementById('ticketsModal');
      if (ticketsModal) {
        ticketsModal.addEventListener('change', (e) => {
          if (e.target && e.target.name === 'ticketType') updateTicketTotal();
        });
      }
      
      const btnCheckout = document.getElementById('btnCheckout');
      if (btnCheckout) btnCheckout.addEventListener('click', checkoutTickets);

      const closeOrdersBtn = document.getElementById('closeOrders');
      if (closeOrdersBtn) closeOrdersBtn.addEventListener('click', closeOrders);

      const closeManagePassesBtn = document.getElementById('closeManagePasses');
      if (closeManagePassesBtn) closeManagePassesBtn.addEventListener('click', closeManagePasses);
      
      const btnCreatePassType = document.getElementById('btnCreatePassType');
      if (btnCreatePassType) btnCreatePassType.addEventListener('click', createPassType);

      const closeEditPassBtn = document.getElementById('closeEditPass');
      if (closeEditPassBtn) closeEditPassBtn.addEventListener('click', closeEditPass);
      
      const saveEditPass = document.getElementById('saveEditPass');
      if (saveEditPass) saveEditPass.addEventListener('click', saveEditPassType);

      const closeCreateEventBtn = document.getElementById('closeCreateEvent');
      if (closeCreateEventBtn) closeCreateEventBtn.addEventListener('click', closeCreateEvent);
      
      const openCreateEventBtn = document.getElementById('openCreateEvent');
      if (openCreateEventBtn) openCreateEventBtn.addEventListener('click', openCreateEvent);
      
      const createEventSubmit = document.getElementById('createEventSubmit');
      if (createEventSubmit) createEventSubmit.addEventListener('click', createEvent);
      
      const btnAddPassType = document.getElementById('btnAddPassType');
      if (btnAddPassType) btnAddPassType.addEventListener('click', addPassTypeToCreate);
      
      const cePassMode = document.getElementById('cePassMode');
      if (cePassMode) cePassMode.addEventListener('change', handlePassModeChange);

      // Edit event modal
      const closeEditEventBtn = document.getElementById('closeEditEvent');
      if (closeEditEventBtn) closeEditEventBtn.addEventListener('click', closeEditEvent);
      
      const editEventSubmit = document.getElementById('editEventSubmit');
      if (editEventSubmit) editEventSubmit.addEventListener('click', updateEvent);
      
      const btnAddPassTypeInEdit = document.getElementById('btnAddPassTypeInEdit');
      if (btnAddPassTypeInEdit) btnAddPassTypeInEdit.addEventListener('click', addPassTypeInEdit);
      
      const btnCancelPassTypeEdit = document.getElementById('btnCancelPassTypeEdit');
      if (btnCancelPassTypeEdit) btnCancelPassTypeEdit.addEventListener('click', cancelPassTypeEdit);
      
      const eeNewPassMode = document.getElementById('eeNewPassMode');
      if (eeNewPassMode) eeNewPassMode.addEventListener('change', handleEditPassModeChange);

      const closeCheckinBtn = document.getElementById('closeCheckin');
      if (closeCheckinBtn) closeCheckinBtn.addEventListener('click', closeCheckin);
      
      const btnCheckinGo = document.getElementById('btnCheckinGo');
      if (btnCheckinGo) btnCheckinGo.addEventListener('click', checkInCode);
      
      const btnScanMethod = document.getElementById('btnScanMethod');
      if (btnScanMethod) btnScanMethod.addEventListener('click', () => toggleScanMethod('scan'));
      
      const btnManualMethod = document.getElementById('btnManualMethod');
      if (btnManualMethod) btnManualMethod.addEventListener('click', () => toggleScanMethod('manual'));

      const closeSecurityStaffBtn = document.getElementById('closeSecurityStaff');
      if (closeSecurityStaffBtn) closeSecurityStaffBtn.addEventListener('click', closeSecurityStaff);
      
      const btnAddStaff = document.getElementById('btnAddStaff');
      if (btnAddStaff) btnAddStaff.addEventListener('click', addSecurityStaff);

      // Tabs
      document.querySelectorAll('[data-exp-tab]').forEach((btn) => {
        btn.addEventListener('click', () => setTab(btn.getAttribute('data-exp-tab')));
      });

      // Load filter options first, then load content
      loadFilterOptions().then(() => {
        updateHeaderCopy();
        setTab('discover');
      }).catch(err => {
        console.error('Error initializing filters:', err);
        // Even if filters fail, still show content
        updateHeaderCopy();
        setTab('discover');
      });
    } catch (error) {
      console.error('Error in wire() function:', error);
      // Still try to load the page even if there are errors
      try {
        updateHeaderCopy();
        setTab('discover');
      } catch (e) {
        console.error('Failed to initialize page:', e);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', wire);
})();
