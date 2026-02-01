const FormData = require('form-data');
const fetch = require('node-fetch');
const fs = require('fs');

async function testAnnouncementPoll() {
  // First, get a token by logging in
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'demouser',
      password: 'password123'
    })
  });
  
  const loginData = await loginRes.json();
  if (!loginData.token) {
    console.error('Failed to login:', loginData);
    return;
  }
  
  const token = loginData.token;
  console.log('✅ Logged in successfully');
  
  // Create announcement with poll
  const formData = new FormData();
  formData.append('title', 'Test Announcement with Poll');
  formData.append('body', 'This is a test announcement to debug poll creation');
  
  const attachmentsData = {
    links: [],
    location: null,
    poll: {
      question: 'What is your favorite color?',
      options: ['Red', 'Blue', 'Green', 'Yellow']
    },
    files: []
  };
  
  console.log('📎 Sending attachments data:', JSON.stringify(attachmentsData, null, 2));
  formData.append('attachments', JSON.stringify(attachmentsData));
  
  const announcementRes = await fetch('http://localhost:3000/api/communities/1/announcements', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  const announcementData = await announcementRes.json();
  console.log('📥 Server response:', JSON.stringify(announcementData, null, 2));
  
  if (announcementData.success) {
    console.log('✅ Announcement created successfully with ID:', announcementData.announcement.id);
    
    // Check the database
    const sqlite3 = require('sqlite3');
    const db = new sqlite3.Database('./database/innovate.db');
    
    db.get(
      'SELECT attachments FROM community_announcements WHERE id = ?',
      [announcementData.announcement.id],
      (err, row) => {
        if (err) {
          console.error('Error querying database:', err);
        } else {
          console.log('📦 Attachments in database:', row.attachments);
          const parsed = JSON.parse(row.attachments);
          console.log('🔍 Parsed poll:', parsed.poll);
        }
        db.close();
      }
    );
  } else {
    console.error('❌ Failed to create announcement:', announcementData);
  }
}

testAnnouncementPoll().catch(console.error);
