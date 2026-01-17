const axios = require('axios');

async function run() {
  const base = 'http://localhost:3000';
  const u = `smoke_${Date.now()}`;
  const email = `${u}@example.com`;
  const password = 'Passw0rd!';

  const log = (...args) => console.log('[SMOKE]', ...args);

  try {
    // Register
    try {
      const reg = await axios.post(`${base}/api/auth/register`, {
        username: u,
        email,
        password
      }, { validateStatus: () => true });
      log('Register status:', reg.status);
      log('Register response:', reg.data);
      if (reg.status !== 200) {
        throw new Error('Register failed');
      }
    } catch (e) {
      log('Register error:', e.message, e.response?.data);
    }

    // Login
    const login = await axios.post(`${base}/api/auth/login`, { email, password });
    const token = login.data.token;
    log('Token length:', token.length);
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    // Create community
    const community = await axios.post(`${base}/api/communities`, {
      name: `SmokeTest Community ${u}`,
      description: 'Test community',
      team_name: 'SmokeTeam',
      is_public: 1
    }, auth);
    const communityId = community.data.community.id;
    log('Community ID:', communityId);

    // Create group in community
    const group = await axios.post(`${base}/api/communities/${communityId}/groups`, {
      name: 'Smoke Group',
      description: 'Group for smoke tests'
    }, auth);
    const groupId = group.data.group.id;
    log('Group ID:', groupId);

    // Create a note
    const noteCreate = await axios.post(`${base}/api/community-groups/${groupId}/notes`, {
      title: 'Smoke Note',
      content_md: 'Initial content'
    }, auth);
    log('Note created:', noteCreate.data.success === true);

    // List notes
    const notesList = await axios.get(`${base}/api/community-groups/${groupId}/notes`, auth);
    log('Notes count:', notesList.data.notes.length);
    if (notesList.data.notes.length) {
      log('First note title:', notesList.data.notes[0].title);
    }

    // Create tasks from text
    const tasksCreate = await axios.post(`${base}/api/community-groups/${groupId}/tasks/from-text`, {
      text: '- Task A\n- Task B\n- Task C',
      priority: 'high'
    }, auth);
    log('Tasks created count:', tasksCreate.data.created_count);

    // List tasks
    const tasksList = await axios.get(`${base}/api/community-groups/${groupId}/tasks`, auth);
    log('Tasks count:', tasksList.data.tasks.length);
    log('Task titles:', tasksList.data.tasks.map(t => t.title));

    log('Smoke test complete ✅');
  } catch (err) {
    console.error('[SMOKE] Failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

run();
