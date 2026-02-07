(function () {
  const { apiRequest, requireAuth, getCurrentUser, showAlert, formatTimestamp } = window.InnovateAPI || {};

  if (!requireAuth || !apiRequest) {
    // Fallback if app.js not loaded
    if (!localStorage.getItem('token')) {
      window.location.href = '/login';
    }
  }

  const state = {
    tab: 'discover',
    city: localStorage.getItem('exp-city') || 'Hyderabad',
    query: '',
    discoverEvents: [],
    myEvents: [],
    activeEvent: null,
    activeTicketsEventId: null,
    activeOrdersEventId: null,
    activeManageEventId: null,
    createEventPassTypes: [] // Temporary array for pass types being added to new event
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
    if (!grid) return;
    grid.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const qs = new URLSearchParams();
      if (state.city) qs.set('city', state.city);
      if (state.query) qs.set('q', state.query);

      const res = await fetch(`/api/events/discover?${qs.toString()}`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load events');

      state.discoverEvents = data.events || [];
      renderEventGrid(grid, state.discoverEvents, { showCreatorBadge: true });
      updateHeaderCopy();
    } catch (e) {
      grid.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 20px;">${e.message}</div>`;
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
      container.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 20px;">No events found.</div>`;
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

    title.textContent = `All Experiences in ${state.city || 'your city'}`;
    subtitle.textContent = 'Parties, concerts & trips in one place';
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
    document.getElementById('btnOrders').style.display = isOrganizer ? '' : 'none';
    document.getElementById('btnCheckin').style.display = isOrganizer ? '' : 'none';

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
    state.city = city;
    localStorage.setItem('exp-city', city);

    const q = document.getElementById('searchInput').value.trim();
    state.query = q;

    closeFilters();
    if (state.tab === 'discover') loadDiscover();
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
        list.innerHTML = '<div style="color: var(--ig-secondary-text); padding: 14px;">No passes yet. Open an event and select tickets.</div>';
        return;
      }

      list.innerHTML = tickets
        .map((t) => {
          return `
            <div class="exp-section" style="padding: 14px;">
              <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
                <div>
                  <div style="font-weight:900;">${t.event_title || 'Event'}</div>
                  <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${t.ticket_type_name || 'Pass'} • ${formatTimestamp ? formatTimestamp(t.event_date) : ''}</div>
                  <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 2px;">${t.event_location || ''}</div>
                </div>
                <div style="color: var(--ig-secondary-text); font-size: 12px;">${t.status || 'issued'}</div>
              </div>
              <div style="margin-top: 12px; display:flex; gap: 14px; align-items:center; flex-wrap:wrap;">
                <div id="qr-${t.id}" style="background:#fff; padding: 8px; border-radius: 12px;"></div>
                <div style="color: var(--ig-secondary-text); font-size: 12px;">
                  <div><strong style="color: var(--ig-primary-text);">Code</strong>: ${t.code}</div>
                  <div class="exp-hint">Show this QR/code at entry for check-in.</div>
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
          // payload can be expanded later
          new window.QRCode(el, {
            text: String(t.code),
            width: 128,
            height: 128
          });
        });
      }
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 14px;">${e.message}</div>`;
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
        .map((t) => {
          const price = t.price_cents ? formatMoney(t.price_cents, t.currency) : 'Free';
          const how = String(t.payment_mode || '').toUpperCase();
          const contact = t.contact_text ? `<div class="exp-hint">${t.contact_text}</div>` : '';
          return `
            <label style="display:flex; gap:10px; padding: 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.03); cursor:pointer;">
              <input type="radio" name="ticketType" value="${t.id}" data-price="${t.price_cents || 0}" data-currency="${t.currency || 'INR'}" style="margin-top: 4px;" />
              <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; gap: 10px;">
                  <div style="font-weight:900;">${t.name}</div>
                  <div style="font-weight:900;">${price}</div>
                </div>
                <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${(t.description || '').trim() || how}</div>
                ${contact}
              </div>
            </label>
          `;
        })
        .join('');

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
      el.textContent = '';
      return;
    }
    const total = (t.priceCents || 0) * qty;
    el.textContent = total ? `Total: ${formatMoney(total, t.currency)}` : 'Total: Free';
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
    } catch (e) {
      result.innerHTML = `<div style="color: var(--ig-error);">${e.message}</div>`;
    }
  }

  // ===== Organizer: Orders / Manage Passes / Check-in =====
  async function openOrders() {
    const ev = state.activeEvent;
    if (!ev) return;

    state.activeOrdersEventId = ev.id;
    const modal = document.getElementById('ordersModal');
    const list = document.getElementById('ordersList');
    const title = document.getElementById('ordersTitle');
    const subtitle = document.getElementById('ordersSubtitle');

    title.textContent = 'Manage Orders';
    subtitle.textContent = `${ev.title || 'Event'} • Pending payments`;
    list.innerHTML = '<div class="ig-spinner"></div>';

    modal.style.display = 'flex';

    try {
      const res = await fetch(`/api/events/${ev.id}/orders?status=pending`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      const orders = data.orders || [];
      if (!orders.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text);">No pending orders.</div>';
        return;
      }

      list.innerHTML = orders
        .map((o) => {
          const money = o.total_cents ? formatMoney(o.total_cents, o.currency) : 'Free';
          return `
            <div class="exp-section" style="padding: 14px;">
              <div style="display:flex; justify-content:space-between; gap: 10px;">
                <div>
                  <div style="font-weight: 900;">@${o.buyer_username}</div>
                  <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${o.ticket_type_name || 'Pass'} • Qty ${o.quantity} • ${money}</div>
                </div>
                <button class="exp-btn primary" data-order="${o.id}">Mark paid & issue</button>
              </div>
            </div>
          `;
        })
        .join('');

      list.querySelectorAll('button[data-order]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const orderId = btn.getAttribute('data-order');
          btn.disabled = true;
          btn.textContent = 'Issuing...';
          try {
            const res2 = await fetch(`/api/events/${ev.id}/orders/${orderId}/mark-paid`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...tokenHeaders() }
            });
            const d2 = await res2.json();
            if (!res2.ok) throw new Error(d2.error || 'Failed');
            btn.textContent = 'Issued';
            loadPasses();
          } catch (e) {
            btn.disabled = false;
            btn.textContent = 'Mark paid & issue';
            showAlert && showAlert(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text);">${e.message}</div>`;
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

  async function checkInCode() {
    const ev = state.activeEvent;
    if (!ev) return;

    const code = document.getElementById('checkinCode').value.trim();
    const out = document.getElementById('checkinResult');
    out.textContent = '';

    if (code.length < 8) {
      out.textContent = 'Enter a valid code';
      return;
    }

    try {
      const res = await fetch(`/api/events/${ev.id}/tickets/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      out.textContent = 'Checked in';
      out.style.color = 'var(--ig-blue)';
    } catch (e) {
      out.textContent = e.message;
      out.style.color = 'var(--ig-error)';
    }
  }

  function openCheckin() {
    document.getElementById('checkinModal').style.display = 'flex';
    document.getElementById('checkinCode').value = '';
    document.getElementById('checkinResult').textContent = '';
  }

  function closeCheckin() {
    document.getElementById('checkinModal').style.display = 'none';
  }

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
    document.getElementById('cePricingType').value = 'free';
    document.getElementById('ceOrganizer').value = '';
    document.getElementById('ceNote').value = '';
    document.getElementById('ceDesc').value = '';
    document.getElementById('fareOptionsContainer').style.display = 'none';
    
    // Reset fare checkboxes and inputs
    ['fareSingleCheck', 'fareCoupleCheck', 'fareGroupCheck'].forEach(id => {
      document.getElementById(id).checked = false;
    });
    ['fareSingle', 'fareCouple', 'fareGroup'].forEach(id => {
      const input = document.getElementById(id);
      input.value = '';
      input.disabled = true;
    });
    
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
    const pricing_type = document.getElementById('cePricingType').value;

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
      formData.append('pricing_type', pricing_type);

      // Handle cover image (file or URL)
      if (cover_file) {
        formData.append('cover_photo', cover_file);
      } else if (cover_image) {
        formData.append('cover_image', cover_image);
      }

      // Handle fare options if paid
      if (pricing_type === 'paid') {
        const fareOptions = [];
        
        if (document.getElementById('fareSingleCheck').checked) {
          fareOptions.push('single');
          formData.append('fare_single', document.getElementById('fareSingle').value || '0');
        }
        if (document.getElementById('fareCoupleCheck').checked) {
          fareOptions.push('couple');
          formData.append('fare_couple', document.getElementById('fareCouple').value || '0');
        }
        if (document.getElementById('fareGroupCheck').checked) {
          fareOptions.push('group');
          formData.append('fare_group', document.getElementById('fareGroup').value || '0');
        }
        
        formData.append('fare_options', JSON.stringify(fareOptions));
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
            contact_text: passType.contact || ''
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
    document.getElementById('eePricingType').value = event.pricing_type || 'free';
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
    
    // Handle pricing type and fare options
    handleEditPricingTypeChange();
    
    // Parse and populate fare options if they exist
    if (event.fare_options) {
      try {
        const fareOpts = JSON.parse(event.fare_options);
        
        if (fareOpts.includes('single')) {
          document.getElementById('eeFareSingleCheck').checked = true;
          document.getElementById('eeFareSingle').disabled = false;
          document.getElementById('eeFareSingle').value = event.fare_single || '';
        }
        if (fareOpts.includes('couple')) {
          document.getElementById('eeFareCoupleCheck').checked = true;
          document.getElementById('eeFareCouple').disabled = false;
          document.getElementById('eeFareCouple').value = event.fare_couple || '';
        }
        if (fareOpts.includes('group')) {
          document.getElementById('eeFareGroupCheck').checked = true;
          document.getElementById('eeFareGroup').disabled = false;
          document.getElementById('eeFareGroup').value = event.fare_group || '';
        }
      } catch (e) {
        console.error('Error parsing fare options:', e);
      }
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
              <button type="button" onclick="editExistingPassType(${eventId}, ${pt.id}, '${pt.name.replace(/'/g, "\\'")}', '${pt.payment_mode}', ${pt.price_cents || 0}, ${pt.quantity_total || 'null'}, '${(pt.description || '').replace(/'/g, "\\'")}', '${(pt.contact_text || '').replace(/'/g, "\\'")}', ${pt.is_active ? 1 : 0})" class="exp-icon-btn" style="width: auto; padding: 6px 12px; font-size: 12px; background: rgba(0,149,246,0.15); border-color: rgba(0,149,246,0.3); color: #0095f6;" title="Edit">
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
          contact_text: contact || ''
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
  window.editExistingPassType = function(eventId, typeId, name, paymentMode, priceCents, quantityTotal, description, contactText, isActive) {
    // Populate the form with existing data
    document.getElementById('eeNewPassName').value = name;
    document.getElementById('eeNewPassMode').value = paymentMode;
    document.getElementById('eeNewPassPrice').value = priceCents ? (parseFloat(priceCents) / 100).toFixed(2) : '';
    document.getElementById('eeNewPassCapacity').value = quantityTotal || '';
    document.getElementById('eeNewPassDesc').value = description || '';
    document.getElementById('eeNewPassContact').value = contactText || '';
    
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
    document.getElementById('eePricingType').value = 'free';
    document.getElementById('eeOrganizer').value = '';
    document.getElementById('eeNote').value = '';
    document.getElementById('eeDesc').value = '';
    document.getElementById('eeFareOptionsContainer').style.display = 'none';
    
    // Reset fare checkboxes
    ['eeFareSingleCheck', 'eeFareCoupleCheck', 'eeFareGroupCheck'].forEach(id => {
      document.getElementById(id).checked = false;
    });
    ['eeFareSingle', 'eeFareCouple', 'eeFareGroup'].forEach(id => {
      const input = document.getElementById(id);
      input.value = '';
      input.disabled = true;
    });
    
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
    const pricing_type = document.getElementById('eePricingType').value;

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
      formData.append('pricing_type', pricing_type);

      // Handle cover image (file or URL)
      if (cover_file) {
        formData.append('cover_photo', cover_file);
      } else if (cover_image) {
        formData.append('cover_image', cover_image);
      }

      // Handle fare options if paid
      if (pricing_type === 'paid') {
        const fareOptions = [];
        
        if (document.getElementById('eeFareSingleCheck').checked) {
          fareOptions.push('single');
          formData.append('fare_single', document.getElementById('eeFareSingle').value || '0');
        }
        if (document.getElementById('eeFareCoupleCheck').checked) {
          fareOptions.push('couple');
          formData.append('fare_couple', document.getElementById('eeFareCouple').value || '0');
        }
        if (document.getElementById('eeFareGroupCheck').checked) {
          fareOptions.push('group');
          formData.append('fare_group', document.getElementById('eeFareGroup').value || '0');
        }
        
        formData.append('fare_options', JSON.stringify(fareOptions));
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
      setTab('mine'); // Refresh my events
      loadMine();
      showAlert && showAlert('Event updated successfully', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }
  
  // Handle edit pricing type change
  function handleEditPricingTypeChange() {
    const pricingType = document.getElementById('eePricingType').value;
    const fareContainer = document.getElementById('eeFareOptionsContainer');
    
    if (pricingType === 'paid') {
      fareContainer.style.display = 'block';
    } else {
      fareContainer.style.display = 'none';
    }
  }

  // Handle edit fare checkbox changes
  function handleEditFareCheckbox(checkboxId, inputId) {
    const checkbox = document.getElementById(checkboxId);
    const input = document.getElementById(inputId);
    
    checkbox.addEventListener('change', () => {
      input.disabled = !checkbox.checked;
      if (checkbox.checked) {
        input.focus();
      } else {
        input.value = '';
      }
    });
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

    state.createEventPassTypes.push({
      id: Date.now(), // Temporary ID for UI
      name,
      mode,
      price: price || '0',
      capacity: capacity || '',
      description,
      contact
    });

    // Reset form
    document.getElementById('cePassName').value = '';
    document.getElementById('cePassMode').value = 'free';
    document.getElementById('cePassPrice').value = '';
    document.getElementById('cePassCapacity').value = '';
    document.getElementById('cePassDesc').value = '';
    document.getElementById('cePassContact').value = '';

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

  // Handle pricing type change
  function handlePricingTypeChange() {
    const pricingType = document.getElementById('cePricingType').value;
    const fareContainer = document.getElementById('fareOptionsContainer');
    
    if (pricingType === 'paid') {
      fareContainer.style.display = 'block';
    } else {
      fareContainer.style.display = 'none';
    }
  }

  // Handle fare checkbox changes
  function handleFareCheckbox(checkboxId, inputId) {
    const checkbox = document.getElementById(checkboxId);
    const input = document.getElementById(inputId);
    
    checkbox.addEventListener('change', () => {
      input.disabled = !checkbox.checked;
      if (checkbox.checked) {
        input.focus();
      } else {
        input.value = '';
      }
    });
  }

  // Expose functions to global scope for inline onclick handlers
  window.state = state;
  window.renderCreateEventPassTypes = renderCreateEventPassTypes;

  // ===== Wire up =====
  function wire() {
    const cityBtn = document.getElementById('cityBtn');
    const cityLabel = document.getElementById('cityLabel');
    if (cityLabel) cityLabel.textContent = state.city;

    document.getElementById('filtersBtn').addEventListener('click', openFilters);
    document.getElementById('filtersOverlay').addEventListener('click', closeFilters);
    document.getElementById('closeFilters').addEventListener('click', closeFilters);
    document.getElementById('applyFilters').addEventListener('click', applyFilters);

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.query = e.target.value.trim();
        loadDiscover();
      }
    });

    document.getElementById('cityBtn').addEventListener('click', () => {
      openFilters();
      document.getElementById('filterCity').focus();
    });

    document.getElementById('closeEventOverlay').addEventListener('click', closeEventDetail);
    document.getElementById('eventOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'eventOverlay') closeEventDetail();
    });

    document.getElementById('btnShareEvent').addEventListener('click', () => {
      if (state.activeEvent) {
        shareEvent(state.activeEvent);
      }
    });

    document.getElementById('btnSelectTickets').addEventListener('click', openTicketsModal);
    document.getElementById('btnEditEvent').addEventListener('click', openEditEvent);
    document.getElementById('btnOrders').addEventListener('click', openOrders);
    document.getElementById('btnCheckin').addEventListener('click', openCheckin);

    document.getElementById('closeTickets').addEventListener('click', closeTicketsModal);
    document.getElementById('ticketQty').addEventListener('input', updateTicketTotal);
    document.getElementById('ticketsModal').addEventListener('change', (e) => {
      if (e.target && e.target.name === 'ticketType') updateTicketTotal();
    });
    document.getElementById('btnCheckout').addEventListener('click', checkoutTickets);

    document.getElementById('closeOrders').addEventListener('click', closeOrders);

    document.getElementById('closeManagePasses').addEventListener('click', closeManagePasses);
    document.getElementById('btnCreatePassType').addEventListener('click', createPassType);

    document.getElementById('closeEditPass').addEventListener('click', closeEditPass);
    document.getElementById('saveEditPass').addEventListener('click', saveEditPassType);

    document.getElementById('closeCreateEvent').addEventListener('click', closeCreateEvent);
    document.getElementById('openCreateEvent').addEventListener('click', openCreateEvent);
    document.getElementById('createEventSubmit').addEventListener('click', createEvent);
    document.getElementById('cePricingType').addEventListener('change', handlePricingTypeChange);
    document.getElementById('btnAddPassType').addEventListener('click', addPassTypeToCreate);
    
    // Wire up fare checkboxes for create form
    handleFareCheckbox('fareSingleCheck', 'fareSingle');
    handleFareCheckbox('fareCoupleCheck', 'fareCouple');
    handleFareCheckbox('fareGroupCheck', 'fareGroup');

    // Edit event modal
    document.getElementById('closeEditEvent').addEventListener('click', closeEditEvent);
    document.getElementById('editEventSubmit').addEventListener('click', updateEvent);
    document.getElementById('eePricingType').addEventListener('change', handleEditPricingTypeChange);
    document.getElementById('btnAddPassTypeInEdit').addEventListener('click', addPassTypeInEdit);
    document.getElementById('btnCancelPassTypeEdit').addEventListener('click', cancelPassTypeEdit);
    
    // Wire up fare checkboxes for edit form
    handleEditFareCheckbox('eeFareSingleCheck', 'eeFareSingle');
    handleEditFareCheckbox('eeFareCoupleCheck', 'eeFareCouple');
    handleEditFareCheckbox('eeFareGroupCheck', 'eeFareGroup');

    document.getElementById('closeCheckin').addEventListener('click', closeCheckin);
    document.getElementById('btnCheckinGo').addEventListener('click', checkInCode);

    // Default filter values
    document.getElementById('filterCity').value = state.city;
    updateHeaderCopy();

    // Tabs
    document.querySelectorAll('[data-exp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.getAttribute('data-exp-tab')));
    });

    setTab('discover');
  }

  document.addEventListener('DOMContentLoaded', wire);
})();
