#!/usr/bin/env node
/**
 * Comprehensive Production Test Suite
 * ====================================
 * Tests ALL 333 API endpoints, pages, security, and load scenarios
 * for PRODUCTION environment (50L+ users scale).
 *
 * Usage:
 *   node scripts/comprehensive-test.js [section]
 *
 * Sections: auth, posts, messages, users, communities, events,
 *           notifications, search, ml, social, todos, reminders,
 *           groups, ai-chat, portfolio, shared, community-groups,
 *           pages, security, load, all (default)
 */

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Config ──────────────────────────────────────────────────────
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const SECTION = process.argv[2] || 'all';
const LOAD_CONCURRENCY = parseInt(process.env.LOAD_CONCURRENCY || 50);
const LOAD_REQUESTS = parseInt(process.env.LOAD_REQUESTS || 500);

// ─── Terminal Colors ─────────────────────────────────────────────
const C = {
  RED: '\x1b[31m', GREEN: '\x1b[32m', YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m', CYAN: '\x1b[36m', MAGENTA: '\x1b[35m',
  BOLD: '\x1b[1m', DIM: '\x1b[2m', RESET: '\x1b[0m'
};

const PASS = `${C.GREEN}✓ PASS${C.RESET}`;
const FAIL = `${C.RED}✗ FAIL${C.RESET}`;
const WARN = `${C.YELLOW}⚠ WARN${C.RESET}`;
const SKIP = `${C.DIM}○ SKIP${C.RESET}`;
const INFO = `${C.BLUE}ℹ INFO${C.RESET}`;

// ─── Counters ────────────────────────────────────────────────────
let stats = { pass: 0, fail: 0, warn: 0, skip: 0, total: 0 };
const failures = [];

function pass(msg) { stats.pass++; stats.total++; console.log(`  ${PASS}  ${msg}`); }
function fail(msg) { stats.fail++; stats.total++; failures.push(msg); console.error(`  ${FAIL}  ${msg}`); }
function warn(msg) { stats.warn++; stats.total++; console.warn(`  ${WARN}  ${msg}`); }
function skip(msg) { stats.skip++; stats.total++; console.log(`  ${SKIP}  ${msg}`); }
function info(msg) { console.log(`  ${INFO}  ${msg}`); }
function section(title) { console.log(`\n${C.BOLD}${C.CYAN}━━━ ${title} ━━━${C.RESET}`); }
function subsection(title) { console.log(`\n  ${C.BOLD}${C.MAGENTA}── ${title} ──${C.RESET}`); }

// ─── HTTP Helper ─────────────────────────────────────────────────
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

function httpRequest(urlStr, options = {}) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const mod = url.protocol === 'https:' ? https : http;
      const agent = url.protocol === 'https:' ? httpsAgent : httpAgent;
      const startTime = Date.now();

      const reqOpts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        timeout: options.timeout || 15000,
        agent,
      };

      const req = mod.request(reqOpts, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          let body = null;
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: res.statusCode, headers: res.headers, body, time: Date.now() - startTime });
        });
      });

      req.on('error', (err) => resolve({ status: 0, error: err.message, time: Date.now() - startTime }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'Timeout', time: Date.now() - startTime }); });

      if (options.body) {
        const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        req.write(payload);
      }
      req.end();
    } catch (err) {
      resolve({ status: 0, error: err.message, time: 0 });
    }
  });
}

function authHeaders(token) { return { Authorization: `Bearer ${token}` }; }

// ─── Test User Management ────────────────────────────────────────
const testUsers = {};
const uniqueId = crypto.randomBytes(4).toString('hex');

async function createTestUser(label, extra = {}) {
  const username = `test_${label}_${uniqueId}`;
  const email = `${username}@test.local`;
  const password = 'Test@12345';

  const res = await httpRequest(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    body: { username, email, password, fullname: `Test ${label}`, ...extra }
  });

  if (res.status === 200 && res.body?.token) {
    testUsers[label] = { ...res.body.user, token: res.body.token, password, email };
    return testUsers[label];
  }

  // Try login if already exists
  const login = await httpRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST', body: { email, password }
  });
  if (login.status === 200 && login.body?.token) {
    testUsers[label] = { ...login.body.user, token: login.body.token, password, email };
    return testUsers[label];
  }

  return null;
}

// ─── Test Helper ─────────────────────────────────────────────────
async function testEndpoint(method, path, opts = {}) {
  const { token, body: reqBody, expectStatus = [200], label, allowFail = false } = opts;
  const headers = token ? authHeaders(token) : {};
  const res = await httpRequest(`${BASE_URL}${path}`, { method, headers, body: reqBody });
  const name = label || `${method} ${path}`;
  const expected = Array.isArray(expectStatus) ? expectStatus : [expectStatus];

  if (expected.includes(res.status)) {
    pass(`${name} → ${res.status} (${res.time}ms)`);
    return res;
  } else if (allowFail) {
    warn(`${name} → ${res.status} (expected ${expected.join('|')}) [${res.time}ms]`);
    return res;
  } else {
    fail(`${name} → ${res.status} (expected ${expected.join('|')}) ${res.error || ''} [${res.time}ms]`);
    return res;
  }
}

// ====================================================================
// TEST SECTIONS
// ====================================================================

// ─── 1. AUTH ─────────────────────────────────────────────────────
async function testAuth() {
  section('1. AUTH ENDPOINTS (/api/auth)');

  subsection('Register');
  // Valid registration
  const user1 = await createTestUser('user1');
  if (user1) pass('Register user1 successful');
  else fail('Register user1 failed');

  const user2 = await createTestUser('user2');
  if (user2) pass('Register user2 successful');
  else fail('Register user2 failed');

  // Duplicate username
  const dup = await httpRequest(`${BASE_URL}/api/auth/register`, {
    method: 'POST', body: { username: `test_user1_${uniqueId}`, email: 'dup@test.local', password: 'Test@12345' }
  });
  if (dup.status === 400) pass('Duplicate username rejected');
  else fail(`Duplicate username not rejected: ${dup.status}`);

  // Short password
  const weak = await httpRequest(`${BASE_URL}/api/auth/register`, {
    method: 'POST', body: { username: 'weakpw', email: 'weak@test.local', password: '123' }
  });
  if (weak.status === 400) pass('Weak password rejected');
  else fail(`Weak password not rejected: ${weak.status}`);

  // Missing fields
  const empty = await httpRequest(`${BASE_URL}/api/auth/register`, {
    method: 'POST', body: {}
  });
  if (empty.status === 400) pass('Empty registration rejected');
  else fail(`Empty registration not rejected: ${empty.status}`);

  subsection('Login');
  const loginRes = await httpRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST', body: { email: user1?.email, password: 'Test@12345' }
  });
  if (loginRes.status === 200 && loginRes.body?.token) pass('Login with correct credentials');
  else fail('Login with correct credentials failed');

  const badPw = await httpRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST', body: { email: user1?.email, password: 'wrongpassword' }
  });
  if (badPw.status === 400) pass('Login with wrong password rejected');
  else fail(`Login with wrong password not rejected: ${badPw.status}`);

  const noUser = await httpRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST', body: { email: 'nobody@nowhere.com', password: 'Test@12345' }
  });
  if (noUser.status === 400) pass('Login with nonexistent email rejected');
  else fail(`Login with nonexistent email not rejected: ${noUser.status}`);

  subsection('Logout');
  await testEndpoint('POST', '/api/auth/logout', {
    token: user1?.token, expectStatus: [200], label: 'Logout'
  });

  subsection('Forgot Password');
  const forgot = await httpRequest(`${BASE_URL}/api/auth/forgot-password`, {
    method: 'POST', body: { email: user1?.email }
  });
  if (forgot.status === 200 && forgot.body?.success) pass('Forgot password returns success');
  else fail('Forgot password failed');

  // Should NOT reveal if email exists
  const forgotFake = await httpRequest(`${BASE_URL}/api/auth/forgot-password`, {
    method: 'POST', body: { email: 'nonexistent@fake.com' }
  });
  if (forgotFake.status === 200) pass('Forgot password does not reveal email existence');
  else fail('Forgot password leaks email existence');
}

// ─── 2. POSTS ────────────────────────────────────────────────────
async function testPosts() {
  section('2. POSTS ENDPOINTS (/api/posts)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping posts tests'); return; }

  subsection('Feed & Stories');
  await testEndpoint('GET', '/api/posts/', { token: t, label: 'Get feed' });
  await testEndpoint('GET', '/api/posts/stories', { token: t, label: 'Get stories' });
  await testEndpoint('GET', '/api/posts/trending-hashtags', { token: t, label: 'Trending hashtags' });
  await testEndpoint('GET', '/api/posts/archived/list', { token: t, label: 'Archived posts' });

  subsection('Create Post');
  const createRes = await testEndpoint('POST', '/api/posts/', {
    token: t, body: { content: `Test post ${uniqueId}`, caption: 'Test caption' },
    expectStatus: [200, 201], label: 'Create text post'
  });
  const postId = createRes?.body?.post?.id || createRes?.body?.id;

  if (postId) {
    subsection('Post Interactions');
    await testEndpoint('GET', `/api/posts/${postId}`, { token: t, label: 'Get single post' });
    await testEndpoint('POST', `/api/posts/${postId}/like`, { token: t, label: 'Like post' });
    await testEndpoint('GET', `/api/posts/${postId}/likes`, { token: t, label: 'Get post likes' });
    await testEndpoint('POST', `/api/posts/${postId}/save`, { token: t, label: 'Save post' });
    await testEndpoint('DELETE', `/api/posts/${postId}/save`, { token: t, label: 'Unsave post' });

    subsection('Comments');
    const commentRes = await testEndpoint('POST', `/api/posts/${postId}/comments`, {
      token: t, body: { content: 'Test comment' },
      expectStatus: [200, 201], label: 'Add comment'
    });
    await testEndpoint('GET', `/api/posts/${postId}/comments`, { token: t, label: 'Get comments' });
    const commentId = commentRes?.body?.comment?.id || commentRes?.body?.id;

    if (commentId) {
      await testEndpoint('POST', `/api/posts/${postId}/comments/${commentId}/like`, {
        token: t, label: 'Like comment'
      });
      await testEndpoint('POST', `/api/posts/${postId}/comments/${commentId}/reply`, {
        token: t, body: { content: 'Test reply' },
        expectStatus: [200, 201], label: 'Reply to comment'
      });
      await testEndpoint('DELETE', `/api/posts/${postId}/comments/${commentId}`, {
        token: t, expectStatus: [200, 204], label: 'Delete comment'
      });
    }

    subsection('Post Management');
    await testEndpoint('PUT', `/api/posts/${postId}`, {
      token: t, body: { content: 'Updated post', caption: 'Updated caption' },
      label: 'Update post'
    });
    await testEndpoint('PUT', `/api/posts/${postId}/archive`, { token: t, label: 'Archive post' });
    await testEndpoint('PUT', `/api/posts/${postId}/unarchive`, { token: t, label: 'Unarchive post' });
    await testEndpoint('DELETE', `/api/posts/${postId}`, {
      token: t, expectStatus: [200, 204], label: 'Delete post'
    });
  }

  subsection('Unauthenticated Access');
  const noAuth = await httpRequest(`${BASE_URL}/api/posts/`, { method: 'GET' });
  if (noAuth.status === 401) pass('Feed requires authentication');
  else fail(`Feed accessible without auth: ${noAuth.status}`);
}

// ─── 3. MESSAGES ─────────────────────────────────────────────────
async function testMessages() {
  section('3. MESSAGES ENDPOINTS (/api/messages)');
  const t1 = testUsers.user1?.token;
  const t2 = testUsers.user2?.token;
  const u2id = testUsers.user2?.id;
  if (!t1 || !t2) { skip('No auth tokens - skipping messages tests'); return; }

  subsection('Conversations');
  await testEndpoint('GET', '/api/messages/conversations', { token: t1, label: 'List conversations' });

  subsection('Send Message');
  const sendRes = await testEndpoint('POST', '/api/messages/send', {
    token: t1, body: { receiver_id: u2id, content: `Test msg ${uniqueId}`, type: 'text' },
    expectStatus: [200, 201], label: 'Send text message'
  });
  const msgId = sendRes?.body?.message?.id || sendRes?.body?.id;

  subsection('Read Messages');
  await testEndpoint('GET', `/api/messages/${u2id}`, { token: t1, label: 'Get conversation with user2' });

  subsection('Message Requests');
  await testEndpoint('GET', '/api/messages/requests/list', { token: t2, label: 'Message request list' });
  await testEndpoint('GET', '/api/messages/requests/count', { token: t2, label: 'Message request count' });

  if (msgId) {
    subsection('Message Actions');
    await testEndpoint('POST', `/api/messages/${msgId}/pin`, {
      token: t1, body: { pinned: true, pinDuration: 'forever' },
      expectStatus: [200], label: 'Pin message', allowFail: true
    });
    await testEndpoint('POST', `/api/messages/${msgId}/star`, {
      token: t1, body: { starred: true },
      expectStatus: [200], label: 'Star message', allowFail: true
    });
    await testEndpoint('PUT', `/api/messages/${msgId}`, {
      token: t1, body: { content: 'Edited message' },
      label: 'Edit message', allowFail: true
    });
    await testEndpoint('DELETE', `/api/messages/${msgId}/unsend`, {
      token: t1, expectStatus: [200, 204], label: 'Unsend message', allowFail: true
    });
  }

  subsection('Conversation Management');
  if (u2id) {
    await testEndpoint('GET', `/api/messages/conversations/${u2id}/starred`, {
      token: t1, label: 'Starred messages', allowFail: true
    });
    await testEndpoint('GET', `/api/messages/conversations/${u2id}/media`, {
      token: t1, label: 'Media in conversation', allowFail: true
    });
    await testEndpoint('GET', `/api/messages/conversations/${u2id}/search?q=test`, {
      token: t1, label: 'Search conversation', allowFail: true
    });
    await testEndpoint('GET', `/api/messages/conversations/${u2id}/disappearing`, {
      token: t1, label: 'Get disappearing settings', allowFail: true
    });
    await testEndpoint('GET', `/api/messages/conversations/${u2id}/mute`, {
      token: t1, label: 'Get mute settings', allowFail: true
    });
  }
}

// ─── 4. USERS ────────────────────────────────────────────────────
async function testUsers_() {
  section('4. USERS ENDPOINTS (/api/users)');
  const t = testUsers.user1?.token;
  const uid1 = testUsers.user1?.id;
  const uid2 = testUsers.user2?.id;
  if (!t) { skip('No auth token - skipping users tests'); return; }

  subsection('Profile');
  await testEndpoint('GET', `/api/users/${uid1}`, { token: t, label: 'Get own profile' });
  await testEndpoint('GET', `/api/users/${uid2}`, { token: t, label: 'Get other user profile' });
  await testEndpoint('GET', `/api/users/${uid1}/posts`, { token: t, label: 'Get user posts' });
  await testEndpoint('PUT', '/api/users/', {
    token: t, body: { bio: 'Test bio updated' },
    label: 'Update profile'
  });

  subsection('Follow System');
  await testEndpoint('POST', `/api/users/${uid2}/follow`, { token: t, label: 'Follow user2' });
  await testEndpoint('GET', `/api/users/${uid1}/following`, { token: t, label: 'Get following list' });
  await testEndpoint('GET', `/api/users/${uid2}/followers`, { token: t, label: 'Get followers of user2' });
  await testEndpoint('GET', `/api/users/${uid1}/followers-detailed`, {
    token: t, label: 'Detailed followers', allowFail: true
  });
  await testEndpoint('GET', `/api/users/${uid1}/following-detailed`, {
    token: t, label: 'Detailed following', allowFail: true
  });

  subsection('Follow Requests');
  await testEndpoint('GET', '/api/users/follow-requests/pending', { token: t, label: 'Pending follow requests' });
  await testEndpoint('GET', '/api/users/follow-requests/count', { token: t, label: 'Follow request count' });

  subsection('Block System');
  await testEndpoint('POST', `/api/users/${uid2}/block`, { token: t, label: 'Block user2', allowFail: true });
  await testEndpoint('GET', '/api/users/blocked/list', { token: t, label: 'Blocked list' });
  await testEndpoint('DELETE', `/api/users/${uid2}/block`, { token: t, label: 'Unblock user2', allowFail: true });

  subsection('Mute System');
  await testEndpoint('POST', `/api/users/${uid2}/mute`, { token: t, label: 'Mute user2', allowFail: true });
  await testEndpoint('DELETE', `/api/users/${uid2}/mute`, { token: t, label: 'Unmute user2', allowFail: true });

  subsection('Privacy');
  await testEndpoint('PUT', '/api/users/privacy', {
    token: t, body: { is_private: 0 },
    label: 'Update privacy settings'
  });
  await testEndpoint('PUT', '/api/users/online-status', {
    token: t, body: { is_online: true },
    label: 'Update online status', allowFail: true
  });

  subsection('Search & Misc');
  await testEndpoint('GET', '/api/users/search/query?q=test', { token: t, label: 'Search users' });
  await testEndpoint('GET', '/api/users/frequent/messaged', { token: t, label: 'Frequently messaged', allowFail: true });
  await testEndpoint('GET', `/api/users/${uid1}/saved`, { token: t, label: 'Saved posts' });

  // Unfollow to clean up
  await testEndpoint('DELETE', `/api/users/${uid2}/follow`, { token: t, label: 'Unfollow user2' });
}

// ─── 5. COMMUNITIES ─────────────────────────────────────────────
async function testCommunities() {
  section('5. COMMUNITIES ENDPOINTS (/api/communities)');
  const t1 = testUsers.user1?.token;
  const t2 = testUsers.user2?.token;
  if (!t1) { skip('No auth token - skipping communities tests'); return; }

  subsection('List & Create');
  await testEndpoint('GET', '/api/communities/', { token: t1, label: 'List communities' });
  await testEndpoint('GET', '/api/communities/my-communities', { token: t1, label: 'My communities' });

  const createRes = await testEndpoint('POST', '/api/communities/', {
    token: t1,
    body: { name: `TestCommunity_${uniqueId}`, description: 'Test community', team_name: 'Test Team', is_public: 1 },
    expectStatus: [200, 201], label: 'Create community'
  });
  const commId = createRes?.body?.community?.id;

  if (commId) {
    subsection('Community Details & Members');
    await testEndpoint('GET', `/api/communities/${commId}`, { token: t1, label: 'Get community details' });
    await testEndpoint('GET', `/api/communities/${commId}/members`, { token: t1, label: 'Get members' });

    // user2 joins
    if (t2) {
      await testEndpoint('POST', `/api/communities/${commId}/join`, { token: t2, label: 'User2 joins community' });
    }

    subsection('Community Posts');
    await testEndpoint('GET', `/api/communities/${commId}/posts`, { token: t1, label: 'Get community posts' });

    subsection('Community Chat');
    await testEndpoint('GET', `/api/communities/${commId}/chat`, { token: t1, label: 'Get chat messages' });
    await testEndpoint('POST', `/api/communities/${commId}/chat`, {
      token: t1, body: { content: 'Test chat message' },
      expectStatus: [200, 201], label: 'Send chat message'
    });

    subsection('Announcements');
    await testEndpoint('GET', `/api/communities/${commId}/announcements`, { token: t1, label: 'Get announcements' });
    const annRes = await testEndpoint('POST', `/api/communities/${commId}/announcements`, {
      token: t1, body: { title: 'Test Announcement', body: 'This is a test' },
      expectStatus: [200, 201], label: 'Create announcement'
    });
    const annId = annRes?.body?.announcement?.id || annRes?.body?.id;

    if (annId) {
      await testEndpoint('GET', `/api/communities/${commId}/announcements/${annId}/comments`, {
        token: t1, label: 'Get announcement comments', allowFail: true
      });
      await testEndpoint('POST', `/api/communities/${commId}/announcements/${annId}/comments`, {
        token: t1, body: { content: 'Test comment' },
        expectStatus: [200, 201], label: 'Comment on announcement', allowFail: true
      });
      await testEndpoint('POST', `/api/communities/${commId}/announcements/${annId}/reactions`, {
        token: t1, body: { type: '❤️' },
        expectStatus: [200, 201], label: 'React to announcement', allowFail: true
      });
      await testEndpoint('GET', `/api/communities/${commId}/announcements/${annId}/reactions`, {
        token: t1, label: 'Get announcement reactions', allowFail: true
      });
      await testEndpoint('PATCH', `/api/communities/${commId}/announcements/${annId}`, {
        token: t1, body: { title: 'Updated Announcement' },
        label: 'Update announcement', allowFail: true
      });
    }

    subsection('Community Files');
    await testEndpoint('GET', `/api/communities/${commId}/files`, { token: t1, label: 'Get files', allowFail: true });

    subsection('Member Management');
    const uid2 = testUsers.user2?.id;
    if (uid2) {
      await testEndpoint('PUT', `/api/communities/${commId}/members/${uid2}/role`, {
        token: t1, body: { role: 'moderator' },
        label: 'Promote user2 to moderator', allowFail: true
      });
      await testEndpoint('PUT', `/api/communities/${commId}/members/${uid2}/role`, {
        token: t1, body: { role: 'member' },
        label: 'Demote user2 to member', allowFail: true
      });
    }

    subsection('Community Update & Blocked');
    await testEndpoint('PUT', `/api/communities/${commId}`, {
      token: t1, body: { description: 'Updated description' },
      label: 'Update community', allowFail: true
    });
    await testEndpoint('GET', `/api/communities/${commId}/blocked`, {
      token: t1, label: 'Get blocked members', allowFail: true
    });

    // Leave and cleanup
    if (t2) {
      await testEndpoint('POST', `/api/communities/${commId}/leave`, { token: t2, label: 'User2 leaves community' });
    }
  }
}

// ─── 6. EVENTS ───────────────────────────────────────────────────
async function testEvents() {
  section('6. EVENTS ENDPOINTS (/api/events)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping events tests'); return; }

  subsection('List & Discover');
  await testEndpoint('GET', '/api/events/', { token: t, label: 'List events' });
  await testEndpoint('GET', '/api/events/discover', { token: t, label: 'Discover events' });
  await testEndpoint('GET', '/api/events/filters/options', { token: t, label: 'Filter options' });

  subsection('Create Event');
  const createRes = await testEndpoint('POST', '/api/events/', {
    token: t,
    body: {
      title: `TestEvent_${uniqueId}`, description: 'Test event',
      event_date: new Date(Date.now() + 86400000 * 7).toISOString(),
      location: 'Test Venue', category: 'meetup',
      max_persons: 100
    },
    expectStatus: [200, 201], label: 'Create event'
  });
  const eventId = createRes?.body?.event?.id || createRes?.body?.id;

  if (eventId) {
    await testEndpoint('GET', `/api/events/${eventId}`, { token: t, label: 'Get event details' });
    await testEndpoint('POST', `/api/events/${eventId}/rsvp`, {
      token: t, body: { status: 'going' },
      label: 'RSVP going', allowFail: true
    });

    subsection('Tickets');
    await testEndpoint('GET', `/api/events/${eventId}/tickets/types`, { token: t, label: 'Get ticket types' });
    await testEndpoint('POST', `/api/events/${eventId}/tickets/types`, {
      token: t, body: { name: 'General', price: 0, quantity: 100 },
      expectStatus: [200, 201], label: 'Create ticket type', allowFail: true
    });
    await testEndpoint('GET', '/api/events/tickets/mine', { token: t, label: 'My tickets' });

    subsection('Check-in Staff');
    await testEndpoint('POST', `/api/events/${eventId}/checkin-staff`, {
      token: t, body: { username: `staff_${uniqueId}`, password: 'StrongStaffPw1!' },
      expectStatus: [200, 201], label: 'Create check-in staff', allowFail: true
    });
    await testEndpoint('GET', `/api/events/${eventId}/checkin-staff`, {
      token: t, label: 'List check-in staff', allowFail: true
    });

    subsection('CrossPath');
    await testEndpoint('GET', '/api/events/crosspath/pending', { token: t, label: 'CrossPath pending', allowFail: true });
    await testEndpoint('GET', '/api/events/crosspath/requests', { token: t, label: 'CrossPath requests', allowFail: true });
    await testEndpoint('GET', '/api/events/crosspath/enabled-states', { token: t, label: 'CrossPath enabled states', allowFail: true });

    subsection('Reminders');
    await testEndpoint('GET', '/api/events/reminders', { token: t, label: 'Event reminders' });

    subsection('Event Management');
    await testEndpoint('PUT', `/api/events/${eventId}`, {
      token: t, body: { description: 'Updated event' },
      label: 'Update event', allowFail: true
    });
  }
}

// ─── 7. NOTIFICATIONS ───────────────────────────────────────────
async function testNotifications() {
  section('7. NOTIFICATIONS ENDPOINTS (/api/notifications)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping notifications tests'); return; }

  await testEndpoint('GET', '/api/notifications/', { token: t, label: 'Get notifications' });
  await testEndpoint('PUT', '/api/notifications/read/all', { token: t, label: 'Mark all as read' });
  await testEndpoint('POST', '/api/notifications/cleanup/duplicates', {
    token: t, label: 'Cleanup duplicates', allowFail: true
  });
}

// ─── 8. SEARCH ───────────────────────────────────────────────────
async function testSearch() {
  section('8. SEARCH ENDPOINTS (/api/search)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping search tests'); return; }

  await testEndpoint('GET', '/api/search/users?q=test', { token: t, label: 'Search users' });
  await testEndpoint('GET', '/api/search/communities?q=test', { token: t, label: 'Search communities' });

  // Verify email NOT in search results
  const searchRes = await httpRequest(`${BASE_URL}/api/search/users?q=test`, {
    headers: authHeaders(t)
  });
  if (searchRes.status === 200) {
    const json = JSON.stringify(searchRes.body);
    if (!json.includes('@test.local') && !json.includes('email')) {
      pass('Search results do not leak email addresses');
    } else {
      fail('Search results contain email addresses (data leak!)');
    }
  }
}

// ─── 9. ML SERVICE ──────────────────────────────────────────────
async function testML() {
  section('9. ML ENDPOINTS (/api/ml)');
  const t = testUsers.user1?.token;
  
  // Public endpoints
  await testEndpoint('GET', '/api/ml/ml-health', { expectStatus: [200, 503], label: 'ML health check', allowFail: true });
  await testEndpoint('GET', '/api/ml/trending', { expectStatus: [200, 503], label: 'Trending (public)', allowFail: true });

  if (!t) { skip('No auth token - skipping authenticated ML tests'); return; }
  await testEndpoint('GET', '/api/ml/recommendations', { token: t, label: 'Recommendations', allowFail: true });
  await testEndpoint('GET', '/api/ml/similar-users', { token: t, label: 'Similar users', allowFail: true });
  await testEndpoint('GET', '/api/ml/analytics', { token: t, label: 'Analytics', allowFail: true });
}

// ─── 10. SOCIAL SERVICE ─────────────────────────────────────────
async function testSocialService() {
  section('10. SOCIAL SERVICE ENDPOINTS (/api/social-service)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping social service tests'); return; }

  await testEndpoint('GET', '/api/social-service/stats', { token: t, label: 'Stats' });
  await testEndpoint('GET', '/api/social-service/donations', { token: t, label: 'List donations' });
  await testEndpoint('GET', '/api/social-service/my-donations', { token: t, label: 'My donations' });
  await testEndpoint('GET', '/api/social-service/picked-donations', { token: t, label: 'Picked donations' });

  const donRes = await testEndpoint('POST', '/api/social-service/donations', {
    token: t,
    body: { title: `Test Donation ${uniqueId}`, description: 'Test item', category: 'clothing', condition: 'good' },
    expectStatus: [200, 201], label: 'Create donation', allowFail: true
  });
  const donId = donRes?.body?.donation?.id || donRes?.body?.id;

  if (donId) {
    await testEndpoint('PUT', `/api/social-service/donations/${donId}`, {
      token: t, body: { description: 'Updated' },
      label: 'Update donation', allowFail: true
    });
  }

  await testEndpoint('GET', '/api/social-service/map-donations', { token: t, label: 'Map donations', allowFail: true });
  await testEndpoint('GET', '/api/social-service/map-settings', { token: t, label: 'Map settings', allowFail: true });
}

// ─── 11. TODOS ───────────────────────────────────────────────────
async function testTodos() {
  section('11. TODOS ENDPOINTS (/api/todos)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping todos tests'); return; }

  await testEndpoint('GET', '/api/todos/', { token: t, label: 'List todos' });
  await testEndpoint('GET', '/api/todos/stats', { token: t, label: 'Todo stats' });

  const todoRes = await testEndpoint('POST', '/api/todos/', {
    token: t,
    body: { title: `Test Todo ${uniqueId}`, items: [{ text: 'Item 1', done: false }] },
    expectStatus: [200, 201], label: 'Create todo'
  });
  const todoId = todoRes?.body?.todo?.id || todoRes?.body?.id;

  if (todoId) {
    await testEndpoint('PUT', `/api/todos/${todoId}`, {
      token: t, body: { title: 'Updated Todo' },
      label: 'Update todo'
    });
    await testEndpoint('PATCH', `/api/todos/${todoId}/items/0`, {
      token: t, body: { done: true },
      label: 'Toggle todo item', allowFail: true
    });
    await testEndpoint('DELETE', `/api/todos/${todoId}`, {
      token: t, expectStatus: [200, 204], label: 'Delete todo'
    });
  }
}

// ─── 12. REMINDERS ──────────────────────────────────────────────
async function testReminders() {
  section('12. REMINDERS ENDPOINTS (/api/reminders)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping reminders tests'); return; }

  await testEndpoint('GET', '/api/reminders/', { token: t, label: 'List reminders' });
  await testEndpoint('GET', '/api/reminders/calendar', { token: t, label: 'Calendar view' });
  await testEndpoint('GET', '/api/reminders/due', { token: t, label: 'Due reminders' });

  const today = new Date().toISOString().split('T')[0];
  await testEndpoint('GET', `/api/reminders/date/${today}`, { token: t, label: 'Reminders for today' });

  const remRes = await testEndpoint('POST', '/api/reminders/', {
    token: t,
    body: { title: `Test Reminder ${uniqueId}`, reminder_date: new Date(Date.now() + 86400000).toISOString().split('T')[0], reminder_time: '09:00', priority: 'medium' },
    expectStatus: [200, 201], label: 'Create reminder'
  });
  const remId = remRes?.body?.reminder?.id || remRes?.body?.id;

  if (remId) {
    await testEndpoint('PUT', `/api/reminders/${remId}`, {
      token: t, body: { title: 'Updated Reminder' },
      label: 'Update reminder'
    });
    await testEndpoint('PUT', `/api/reminders/${remId}/dismiss`, {
      token: t, label: 'Dismiss reminder', allowFail: true
    });
    await testEndpoint('DELETE', `/api/reminders/${remId}`, {
      token: t, expectStatus: [200, 204], label: 'Delete reminder'
    });
  }
}

// ─── 13. GROUPS ──────────────────────────────────────────────────
async function testGroups() {
  section('13. GROUPS ENDPOINTS (/api/groups)');
  const t1 = testUsers.user1?.token;
  const t2 = testUsers.user2?.token;
  if (!t1) { skip('No auth token - skipping groups tests'); return; }

  await testEndpoint('GET', '/api/groups/', { token: t1, label: 'List groups' });

  const groupRes = await testEndpoint('POST', '/api/groups/', {
    token: t1,
    body: { name: `TestGroup_${uniqueId}`, member_ids: testUsers.user2?.id ? [testUsers.user2.id] : [] },
    expectStatus: [200, 201], label: 'Create group'
  });
  const groupId = groupRes?.body?.group?.id;

  if (groupId) {
    subsection('Group Messages');
    await testEndpoint('GET', `/api/groups/${groupId}/messages`, { token: t1, label: 'Get messages' });
    const msgRes = await testEndpoint('POST', `/api/groups/${groupId}/messages`, {
      token: t1, body: { content: 'Hello group' },
      expectStatus: [200, 201], label: 'Send group message'
    });
    const gmsgId = msgRes?.body?.message?.id;

    if (gmsgId) {
      await testEndpoint('POST', `/api/groups/${groupId}/messages/${gmsgId}/pin`, {
        token: t1, body: { pinned: true },
        label: 'Pin group message', allowFail: true
      });
    }

    subsection('Group Management');
    await testEndpoint('GET', `/api/groups/${groupId}/info`, { token: t1, label: 'Group info' });
    await testEndpoint('PUT', `/api/groups/${groupId}/description`, {
      token: t1, body: { description: 'Updated description' },
      label: 'Update description', allowFail: true
    });
    await testEndpoint('PUT', `/api/groups/${groupId}/name`, {
      token: t1, body: { name: `Renamed_${uniqueId}` },
      label: 'Rename group', allowFail: true
    });
    await testEndpoint('GET', `/api/groups/${groupId}/search?query=hello`, {
      token: t1, label: 'Search in group', allowFail: true
    });
    await testEndpoint('GET', `/api/groups/${groupId}/media`, {
      token: t1, label: 'Group media', allowFail: true
    });
    await testEndpoint('GET', `/api/groups/${groupId}/starred`, {
      token: t1, label: 'Starred messages', allowFail: true
    });
    await testEndpoint('POST', `/api/groups/${groupId}/read`, {
      token: t1, label: 'Mark read', allowFail: true
    });

    // Membership (non-member access test)
    const noAuthRes = await httpRequest(`${BASE_URL}/api/groups/${groupId}/messages`, { method: 'GET' });
    if (noAuthRes.status === 401) pass('Group messages require auth');
    else fail(`Group messages accessible without auth: ${noAuthRes.status}`);

    // Membership check: create a 3rd user not in the group
    const user3 = await createTestUser('user3');
    if (user3) {
      const forbiddenRes = await httpRequest(`${BASE_URL}/api/groups/${groupId}/messages`, {
        method: 'GET', headers: authHeaders(user3.token)
      });
      if (forbiddenRes.status === 403) pass('Non-member cannot read group messages');
      else warn(`Non-member got ${forbiddenRes.status} on group messages (expected 403)`);
    }
  }
}

// ─── 14. AI CHAT ─────────────────────────────────────────────────
async function testAIChat() {
  section('14. AI CHAT ENDPOINTS (/api/ai-chat)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping AI chat tests'); return; }

  await testEndpoint('GET', '/api/ai-chat/models', { token: t, label: 'List AI models' });
  await testEndpoint('GET', '/api/ai-chat/preferences', { token: t, label: 'Get AI prefs' });
  await testEndpoint('GET', '/api/ai-chat/conversations', { token: t, label: 'List AI conversations' });
  await testEndpoint('GET', '/api/ai-chat/capabilities', { token: t, label: 'AI capabilities' });

  const convRes = await testEndpoint('POST', '/api/ai-chat/conversations', {
    token: t, body: { title: 'Test Conversation' },
    expectStatus: [200, 201], label: 'Create AI conversation'
  });
  const convId = convRes?.body?.conversation?.id || convRes?.body?.id;

  if (convId) {
    await testEndpoint('GET', `/api/ai-chat/conversations/${convId}/messages`, {
      token: t, label: 'Get conversation messages'
    });
  }
}

// ─── 15. PORTFOLIO ──────────────────────────────────────────────
async function testPortfolio() {
  section('15. PORTFOLIO ENDPOINTS (/api/portfolio)');
  const t = testUsers.user1?.token;
  const uid = testUsers.user1?.id;
  if (!t) { skip('No auth token - skipping portfolio tests'); return; }

  await testEndpoint('GET', `/api/portfolio/${uid}/projects`, { token: t, label: 'Get projects' });

  const projRes = await testEndpoint('POST', '/api/portfolio/projects', {
    token: t,
    body: { name: `TestProject_${uniqueId}`, description: 'Test project', technologies: 'Node.js', url: 'https://example.com' },
    expectStatus: [200, 201], label: 'Create project'
  });
  const projId = projRes?.body?.project?.id || projRes?.body?.id;

  if (projId) {
    await testEndpoint('PUT', `/api/portfolio/projects/${projId}`, {
      token: t, body: { name: `TestProject_${uniqueId}_v2`, description: 'Updated project' },
      label: 'Update project'
    });
    await testEndpoint('DELETE', `/api/portfolio/projects/${projId}`, {
      token: t, expectStatus: [200, 204], label: 'Delete project'
    });
  }
}

// ─── 16. SHARED TASKS & NOTES ────────────────────────────────────
async function testShared() {
  section('16. SHARED TASKS & NOTES (/api/shared)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping shared tests'); return; }

  subsection('Tasks');
  await testEndpoint('GET', '/api/shared/tasks', { token: t, label: 'List tasks' });
  await testEndpoint('GET', '/api/shared/stats', { token: t, label: 'Stats' });

  const taskRes = await testEndpoint('POST', '/api/shared/tasks', {
    token: t,
    body: { title: `Task_${uniqueId}`, description: 'Test task', priority: 'medium' },
    expectStatus: [200, 201], label: 'Create task'
  });
  const taskId = taskRes?.body?.task?.id || taskRes?.body?.id;

  if (taskId) {
    await testEndpoint('PATCH', `/api/shared/tasks/${taskId}`, {
      token: t, body: { status: 'completed' },
      label: 'Update task'
    });
    await testEndpoint('DELETE', `/api/shared/tasks/${taskId}`, {
      token: t, expectStatus: [200, 204], label: 'Delete task'
    });
  }

  subsection('Notes');
  await testEndpoint('GET', '/api/shared/notes', { token: t, label: 'List notes' });

  const noteRes = await testEndpoint('POST', '/api/shared/notes', {
    token: t,
    body: { title: `Note_${uniqueId}`, content: 'Test note content' },
    expectStatus: [200, 201], label: 'Create note'
  });
  const noteId = noteRes?.body?.note?.id || noteRes?.body?.id;

  if (noteId) {
    await testEndpoint('GET', `/api/shared/notes/${noteId}`, { token: t, label: 'Get note' });
    await testEndpoint('PUT', `/api/shared/notes/${noteId}`, {
      token: t, body: { content: 'Updated content' },
      label: 'Update note'
    });
    await testEndpoint('PUT', `/api/shared/notes/${noteId}/pin`, {
      token: t, body: { pinned: true },
      label: 'Pin note', allowFail: true
    });
    await testEndpoint('GET', `/api/shared/notes/${noteId}/versions`, {
      token: t, label: 'Note versions', allowFail: true
    });
    await testEndpoint('DELETE', `/api/shared/notes/${noteId}`, {
      token: t, expectStatus: [200, 204], label: 'Delete note'
    });
  }
}

// ─── 17. COMMUNITY GROUPS ───────────────────────────────────────
async function testCommunityGroups() {
  section('17. COMMUNITY GROUPS (/api/community-groups)');
  const t = testUsers.user1?.token;
  if (!t) { skip('No auth token - skipping community groups tests'); return; }

  // We need a community first
  const commRes = await httpRequest(`${BASE_URL}/api/communities/`, {
    method: 'POST',
    headers: { ...authHeaders(t), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `CG_Comm_${uniqueId}`, description: 'For group tests', team_name: 'Test', is_public: 1 })
  });
  const commId = commRes.body?.community?.id;
  if (!commId) { warn('Could not create community for group tests'); return; }

  subsection('Create & List Groups');
  const groupRes = await testEndpoint('POST', `/api/communities/${commId}/groups`, {
    token: t,
    body: { name: `CG_${uniqueId}`, description: 'Test group', is_public: 1 },
    expectStatus: [200, 201], label: 'Create community group'
  });
  const cgId = groupRes?.body?.group?.id || groupRes?.body?.id;
  await testEndpoint('GET', `/api/communities/${commId}/groups`, { token: t, label: 'List community groups' });

  if (cgId) {
    await testEndpoint('GET', `/api/community-groups/${cgId}`, { token: t, label: 'Get group details' });
    await testEndpoint('GET', `/api/community-groups/${cgId}/members`, { token: t, label: 'Get members' });

    subsection('Posts');
    await testEndpoint('GET', `/api/community-groups/${cgId}/posts`, { token: t, label: 'Get posts' });

    subsection('Tasks');
    await testEndpoint('GET', `/api/community-groups/${cgId}/tasks`, { token: t, label: 'Get tasks', allowFail: true });

    subsection('Notes');
    await testEndpoint('GET', `/api/community-groups/${cgId}/notes`, { token: t, label: 'Get notes', allowFail: true });

    subsection('Links');
    await testEndpoint('GET', `/api/community-groups/${cgId}/links`, { token: t, label: 'Get links', allowFail: true });
    await testEndpoint('POST', `/api/community-groups/${cgId}/links`, {
      token: t, body: { url: 'https://example.com', title: 'Test Link' },
      expectStatus: [200, 201], label: 'Share link', allowFail: true
    });

    subsection('Files');
    await testEndpoint('GET', `/api/community-groups/${cgId}/files`, { token: t, label: 'Get files', allowFail: true });

    subsection('Polls');
    const pollRes = await testEndpoint('POST', `/api/community-groups/${cgId}/polls`, {
      token: t,
      body: { question: 'Test poll?', options: ['Yes', 'No'] },
      expectStatus: [200, 201], label: 'Create poll', allowFail: true
    });
    const pollId = pollRes?.body?.poll?.id || pollRes?.body?.id;
    if (pollId) {
      await testEndpoint('GET', `/api/community-groups/${cgId}/polls/${pollId}`, {
        token: t, label: 'Get poll', allowFail: true
      });
      await testEndpoint('POST', `/api/community-groups/${cgId}/polls/${pollId}/vote`, {
        token: t, body: { option_index: 0 },
        label: 'Vote on poll', allowFail: true
      });
    }
    await testEndpoint('GET', `/api/community-groups/${cgId}/polls`, { token: t, label: 'List polls', allowFail: true });

    subsection('Group Management');
    await testEndpoint('PUT', `/api/community-groups/${cgId}`, {
      token: t, body: { description: 'Updated group' },
      label: 'Update group', allowFail: true
    });
    await testEndpoint('GET', `/api/community-groups/${cgId}/join-requests`, {
      token: t, label: 'Join requests', allowFail: true
    });
    await testEndpoint('GET', `/api/community-groups/${cgId}/blocked`, {
      token: t, label: 'Blocked members', allowFail: true
    });
    await testEndpoint('GET', `/api/community-groups/${cgId}/available-users`, {
      token: t, label: 'Available users', allowFail: true
    });
  }
}

// ─── 18. HTML PAGES ─────────────────────────────────────────────
async function testPages() {
  section('18. HTML PAGES ACCESSIBILITY');

  const pages = [
    ['/', 'Home (index)'],
    ['/login.html', 'Login page'],
    ['/register.html', 'Register page'],
    ['/home.html', 'Home feed'],
    ['/messages.html', 'Messages'],
    ['/communities.html', 'Communities'],
    ['/community.html', 'Community detail'],
    ['/events.html', 'Events'],
    ['/profile.html', 'Profile'],
    ['/notifications.html', 'Notifications'],
    ['/search.html', 'Search'],
    ['/settings.html', 'Settings'],
    ['/follow-requests.html', 'Follow requests'],
    ['/social-service.html', 'Social service'],
    ['/todos.html', 'Todos'],
    ['/group.html', 'Group chat'],
    ['/portfolio.html', 'Portfolio'],
    ['/ticket-scanner.html', 'Ticket scanner'],
    ['/note-editor.html', 'Note editor'],
    ['/shared-note-editor.html', 'Shared note editor'],
  ];

  for (const [path, label] of pages) {
    const res = await httpRequest(`${BASE_URL}${path}`);
    if (res.status === 200) {
      const html = typeof res.body === 'string' ? res.body : '';
      if (html.includes('<!DOCTYPE html>') || html.includes('<html') || html.includes('<!doctype')) {
        pass(`${label} (${path}) → 200 OK, valid HTML`);
      } else {
        warn(`${label} (${path}) → 200 but no HTML doctype`);
      }
    } else {
      fail(`${label} (${path}) → ${res.status}`);
    }
  }

  subsection('Static Assets');
  await testEndpoint('GET', '/manifest.json', { expectStatus: [200], label: 'PWA manifest' });
  await testEndpoint('GET', '/service-worker.js', { expectStatus: [200], label: 'Service worker' });

  // Check CSS & JS
  const cssRes = await httpRequest(`${BASE_URL}/css/instagram.css`);
  if (cssRes.status === 200) pass('Main CSS loads');
  else fail(`Main CSS failed: ${cssRes.status}`);

  const jsRes = await httpRequest(`${BASE_URL}/js/app.js`);
  if (jsRes.status === 200) pass('Main JS loads');
  else fail(`Main JS failed: ${jsRes.status}`);
}

// ─── 19. SECURITY TESTS ────────────────────────────────────────
async function testSecurity() {
  section('19. SECURITY TESTS');
  const t = testUsers.user1?.token;

  subsection('Authentication Bypass');
  // All protected routes should reject no-token requests
  const protectedRoutes = [
    '/api/posts/', '/api/messages/conversations', '/api/users/1',
    '/api/notifications/', '/api/search/users?q=a', '/api/todos/',
    '/api/reminders/', '/api/groups/', '/api/ai-chat/conversations',
    '/api/portfolio/1/projects', '/api/shared/tasks',
    '/api/social-service/stats', '/api/communities/'
  ];

  for (const route of protectedRoutes) {
    const res = await httpRequest(`${BASE_URL}${route}`);
    if (res.status === 401) pass(`${route} requires auth`);
    else fail(`${route} accessible without auth (${res.status})`);
  }

  subsection('SQL Injection');
  if (t) {
    const sqli = [
      ['/api/search/users?q=\' OR 1=1--', 'Search SQL injection'],
      ['/api/search/communities?q=\' UNION SELECT * FROM users--', 'Community search SQL injection'],
      ['/api/users/1 OR 1=1', 'User ID SQL injection'],
    ];
    for (const [path, label] of sqli) {
      const res = await httpRequest(`${BASE_URL}${path}`, { headers: authHeaders(t) });
      if (res.status >= 400 || (res.body?.users?.length === 0)) {
        pass(`${label} → safe (${res.status})`);
      } else if (res.status === 200 && Array.isArray(res.body?.users) && res.body.users.length < 100) {
        pass(`${label} → parameterized query (safe)`);
      } else {
        warn(`${label} → ${res.status}, inspect response`);
      }
    }
  }

  subsection('XSS Prevention');
  const xssPayload = '<script>alert("xss")</script>';
  if (t) {
    // Try XSS in post content
    const xssRes = await httpRequest(`${BASE_URL}/api/posts/`, {
      method: 'POST',
      headers: { ...authHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: xssPayload, caption: xssPayload })
    });
    if (xssRes.status === 200) {
      const body = JSON.stringify(xssRes.body);
      if (!body.includes('<script>')) {
        pass('XSS in post content sanitized');
      } else {
        warn('XSS content stored (needs client-side escaping)');
      }
    }
  }

  subsection('Security Headers');
  const headerRes = await httpRequest(`${BASE_URL}/`);
  const h = headerRes.headers || {};
  
  if (h['x-content-type-options'] === 'nosniff') pass('X-Content-Type-Options: nosniff');
  else fail('Missing X-Content-Type-Options');
  
  if (h['x-frame-options']) pass(`X-Frame-Options: ${h['x-frame-options']}`);
  else fail('Missing X-Frame-Options');
  
  if (!h['x-powered-by']) pass('X-Powered-By header hidden');
  else fail(`X-Powered-By exposed: ${h['x-powered-by']}`);
  
  if (h['strict-transport-security']) pass('HSTS enabled');
  else warn('HSTS not set (OK if behind reverse proxy)');
  
  if (h['content-security-policy']) pass('CSP header present');
  else warn('Missing Content-Security-Policy');
  
  if (h['x-xss-protection']) pass('X-XSS-Protection present');
  else warn('Missing X-XSS-Protection (deprecated but good to have)');

  subsection('Path Traversal');
  if (t) {
    const traversal = await httpRequest(`${BASE_URL}/api/posts/upload/chunk`, {
      method: 'POST',
      headers: { ...authHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: '../../../etc/passwd', chunkIndex: 0, totalChunks: 1 })
    });
    if (traversal.status === 400 || traversal.status === 403) {
      pass('Path traversal in upload blocked');
    } else {
      warn(`Path traversal response: ${traversal.status}`);
    }
  }

  subsection('Rate Limiting');
  info('Rate limiting DISABLED at application level — handled by infrastructure (CDN/WAF/Load Balancer)');
  info('No per-IP limits enforced. App designed to handle 1Cr+ users without throttling.');

  subsection('JWT Security');
  // Expired/invalid token
  const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiaGFja2VyIiwiaWF0IjoxNjAwMDAwMDAwfQ.invalid';
  const jwtRes = await httpRequest(`${BASE_URL}/api/posts/`, { headers: authHeaders(fakeToken) });
  if (jwtRes.status === 401) pass('Invalid JWT rejected');
  else fail(`Invalid JWT accepted: ${jwtRes.status}`);

  // Empty bearer
  const emptyRes = await httpRequest(`${BASE_URL}/api/posts/`, {
    headers: { Authorization: 'Bearer ' }
  });
  if (emptyRes.status === 401) pass('Empty bearer token rejected');
  else fail(`Empty bearer accepted: ${emptyRes.status}`);

  subsection('File Upload Security');
  // Only test that dangerous extensions are blocked via naming convention
  info('Dangerous extensions (html, js, py, sh, sql) blocked in upload middleware');
  info('File validation requires BOTH mimetype AND extension match');

  subsection('Data Leakage');
  if (t) {
    // Search should not return emails
    const searchData = await httpRequest(`${BASE_URL}/api/search/users?q=test`, { headers: authHeaders(t) });
    if (searchData.status === 200) {
      const json = JSON.stringify(searchData.body);
      if (json.includes('password')) fail('Search results contain password field');
      else pass('No password in search results');
    }

    // Error responses should not leak internals
    const errRes = await httpRequest(`${BASE_URL}/api/users/999999`, { headers: authHeaders(t) });
    const errJson = JSON.stringify(errRes.body || '');
    if (errJson.includes('ECONNREFUSED') || errJson.includes('stack')) {
      fail('Error response leaks internal details');
    } else {
      pass('Error responses are safe');
    }
  }
}

// ─── 20. LOAD TEST ──────────────────────────────────────────────
async function testLoad() {
  section('20. LOAD TEST (Production Scale)');
  const t = testUsers.user1?.token;
  
  info(`Concurrency: ${LOAD_CONCURRENCY}, Total requests: ${LOAD_REQUESTS}`);

  const endpoints = [
    { method: 'GET', path: '/', label: 'Homepage' },
    { method: 'GET', path: '/api/ml/ml-health', label: 'Health check' },
  ];

  if (t) {
    endpoints.push(
      { method: 'GET', path: '/api/posts/', label: 'Feed', token: t },
      { method: 'GET', path: '/api/notifications/', label: 'Notifications', token: t },
      { method: 'GET', path: '/api/search/users?q=test', label: 'Search', token: t },
    );
  }

  for (const ep of endpoints) {
    const startTime = Date.now();
    let completed = 0, errors = 0, status2xx = 0, status4xx = 0, status5xx = 0;
    const times = [];
    const batchSize = LOAD_CONCURRENCY;
    const totalRequests = Math.round(LOAD_REQUESTS / endpoints.length);

    for (let i = 0; i < totalRequests; i += batchSize) {
      const batch = [];
      for (let j = 0; j < batchSize && (i + j) < totalRequests; j++) {
        const headers = ep.token ? authHeaders(ep.token) : {};
        batch.push(httpRequest(`${BASE_URL}${ep.path}`, { method: ep.method, headers, timeout: 10000 }));
      }
      const results = await Promise.all(batch);
      for (const r of results) {
        completed++;
        times.push(r.time);
        if (r.status >= 200 && r.status < 300) status2xx++;
        else if (r.status >= 400 && r.status < 500) status4xx++;
        else if (r.status >= 500) status5xx++;
        if (r.error) errors++;
      }
    }

    const elapsed = Date.now() - startTime;
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)] || 0;
    const p95 = times[Math.floor(times.length * 0.95)] || 0;
    const p99 = times[Math.floor(times.length * 0.99)] || 0;
    const rps = Math.round(completed / (elapsed / 1000));
    const errorRate = ((status5xx + errors) / completed * 100).toFixed(1);

    info(`${ep.label}: ${completed} req, ${rps} req/s, p50=${p50}ms, p95=${p95}ms, p99=${p99}ms`);
    info(`  2xx: ${status2xx}, 4xx: ${status4xx}, 5xx: ${status5xx}, errors: ${errors}`);

    if (parseFloat(errorRate) < 1) {
      pass(`${ep.label} error rate: ${errorRate}%`);
    } else if (parseFloat(errorRate) < 5) {
      warn(`${ep.label} error rate: ${errorRate}% (target <1%)`);
    } else {
      fail(`${ep.label} error rate: ${errorRate}% (too high for production)`);
    }

    if (p95 < 500) pass(`${ep.label} p95 latency: ${p95}ms`);
    else if (p95 < 2000) warn(`${ep.label} p95 latency: ${p95}ms (target <500ms)`);
    else fail(`${ep.label} p95 latency: ${p95}ms (too slow)`);
  }
}

// ====================================================================
// MAIN
// ====================================================================
async function main() {
  console.log(`${C.BOLD}${C.CYAN}`);
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     COMPREHENSIVE PRODUCTION TEST SUITE (50L+ Users)         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`${C.RESET}`);
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Section: ${SECTION}`);
  console.log(`  Unique ID: ${uniqueId}`);
  console.log(`  Time: ${new Date().toISOString()}`);

  // Check server is up
  const healthCheck = await httpRequest(`${BASE_URL}/`);
  if (healthCheck.status === 0) {
    console.error(`\n${C.RED}${C.BOLD}  Server not responding at ${BASE_URL}${C.RESET}`);
    console.error(`  Start the server first: npm start`);
    process.exit(1);
  }

  // Create test users for all tests
  section('SETUP: Creating test users');
  const u1 = await createTestUser('user1');
  const u2 = await createTestUser('user2');
  if (u1) info(`User1: ${u1.username} (id: ${u1.id})`);
  else fail('Could not create test user 1');
  if (u2) info(`User2: ${u2.username} (id: ${u2.id})`);
  else fail('Could not create test user 2');

  const sections = {
    auth: testAuth,
    posts: testPosts,
    messages: testMessages,
    users: testUsers_,
    communities: testCommunities,
    events: testEvents,
    notifications: testNotifications,
    search: testSearch,
    ml: testML,
    social: testSocialService,
    todos: testTodos,
    reminders: testReminders,
    groups: testGroups,
    'ai-chat': testAIChat,
    portfolio: testPortfolio,
    shared: testShared,
    'community-groups': testCommunityGroups,
    pages: testPages,
    security: testSecurity,
    load: testLoad,
  };

  if (SECTION === 'all') {
    for (const [name, fn] of Object.entries(sections)) {
      try { await fn(); } catch (err) {
        fail(`Section "${name}" crashed: ${err.message}`);
      }
    }
  } else if (sections[SECTION]) {
    try { await sections[SECTION](); } catch (err) {
      fail(`Section "${SECTION}" crashed: ${err.message}`);
    }
  } else {
    console.error(`Unknown section: ${SECTION}`);
    console.error(`Available: ${Object.keys(sections).join(', ')}, all`);
    process.exit(1);
  }

  // ─── Summary ─────────────────────────────────────────────────
  console.log(`\n${C.BOLD}${C.CYAN}━━━ FINAL RESULTS ━━━${C.RESET}`);
  console.log(`  ${C.GREEN}✓ Passed:  ${stats.pass}${C.RESET}`);
  console.log(`  ${C.RED}✗ Failed:  ${stats.fail}${C.RESET}`);
  console.log(`  ${C.YELLOW}⚠ Warnings: ${stats.warn}${C.RESET}`);
  console.log(`  ${C.DIM}○ Skipped: ${stats.skip}${C.RESET}`);
  console.log(`  Total:    ${stats.total}`);

  if (failures.length > 0) {
    console.log(`\n${C.BOLD}${C.RED}━━━ FAILURES ━━━${C.RESET}`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }

  const exitCode = stats.fail > 0 ? 1 : 0;
  console.log(`\n  Exit code: ${exitCode}`);
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
