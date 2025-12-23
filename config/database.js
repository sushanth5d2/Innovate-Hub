const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

let db;

// Initialize database based on environment
const initDatabase = () => {
  const dbType = process.env.DB_TYPE || 'sqlite';
  
  if (dbType === 'sqlite') {
    const dbPath = path.resolve(__dirname, '../database/innovate.db');
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening SQLite database:', err);
      } else {
        console.log('Connected to SQLite database');
        enableForeignKeys();
        createTables();
        migrateDatabase();
      }
    });
  } else if (dbType === 'postgresql') {
    db = new Pool({
      host: process.env.PG_HOST,
      port: process.env.PG_PORT,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
    });
    console.log('Connected to PostgreSQL database');
    createTablesPostgres();
  }
  
  return db;
};

// Enable foreign keys for SQLite
const enableForeignKeys = () => {
  if (process.env.DB_TYPE === 'sqlite') {
    db.run('PRAGMA foreign_keys = ON');
  }
};

// Create tables for SQLite
const createTables = () => {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        bio TEXT,
        skills TEXT,
        interests TEXT,
        favorite_teams TEXT,
        profile_picture TEXT,
        is_online BOOLEAN DEFAULT 0,
        last_seen DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Posts table
    db.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT,
        images TEXT,
        files TEXT,
        video_url TEXT,
        is_story BOOLEAN DEFAULT 0,
        is_archived BOOLEAN DEFAULT 0,
        scheduled_at DATETIME,
        expires_at DATETIME,
        likes_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Polls table
    db.run(`
      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        votes TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);

    // Post likes table
    db.run(`
      CREATE TABLE IF NOT EXISTS post_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(post_id, user_id)
      )
    `);

    // Post comments table
    db.run(`
      CREATE TABLE IF NOT EXISTS post_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Post interactions table (interested, contact me, etc.)
    db.run(`
      CREATE TABLE IF NOT EXISTS post_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Saved posts table
    db.run(`
      CREATE TABLE IF NOT EXISTS saved_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        UNIQUE(user_id, post_id)
      )
    `);

    // Messages table
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        content TEXT,
        attachments TEXT,
        is_read BOOLEAN DEFAULT 0,
        is_deleted_by_sender BOOLEAN DEFAULT 0,
        is_deleted_by_receiver BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Communities table
    db.run(`
      CREATE TABLE IF NOT EXISTS communities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        team_name TEXT,
        banner_image TEXT,
        is_public BOOLEAN DEFAULT 1,
        admin_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Community members table
    db.run(`
      CREATE TABLE IF NOT EXISTS community_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(community_id, user_id)
      )
    `);

    // Community posts table
    db.run(`
      CREATE TABLE IF NOT EXISTS community_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT,
        images TEXT,
        files TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Community chat table
    db.run(`
      CREATE TABLE IF NOT EXISTS community_chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        message TEXT,
        attachments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Community files table
    db.run(`
      CREATE TABLE IF NOT EXISTS community_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        filesize INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Events table
    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        event_date DATETIME NOT NULL,
        location TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Event attendees table
    db.run(`
      CREATE TABLE IF NOT EXISTS event_attendees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(event_id, user_id)
      )
    `);

    // Crosspath events table
    db.run(`
      CREATE TABLE IF NOT EXISTS crosspath_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user1_id INTEGER NOT NULL,
        user2_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Notifications table
    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        related_id INTEGER,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Followers table
    db.run(`
      CREATE TABLE IF NOT EXISTS followers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id INTEGER NOT NULL,
        following_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(follower_id, following_id)
      )
    `);

    // Blocked users table
    db.run(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blocker_id INTEGER NOT NULL,
        blocked_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(blocker_id, blocked_id)
      )
    `);

    // Gentle reminders table
    db.run(`
      CREATE TABLE IF NOT EXISTS gentle_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        reminder_date DATETIME NOT NULL,
        message TEXT,
        is_sent BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);

    // Instant meetings table
    db.run(`
      CREATE TABLE IF NOT EXISTS instant_meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        creator_id INTEGER NOT NULL,
        platform TEXT NOT NULL,
        meeting_url TEXT,
        meeting_date DATETIME NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Migrations for existing databases
    db.serialize(() => {
      // Add video_url column if it doesn't exist
      db.run(`ALTER TABLE posts ADD COLUMN video_url TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Note: video_url column migration - ', err.message);
        }
      });

      // Add likes_count column if it doesn't exist
      db.run(`ALTER TABLE posts ADD COLUMN likes_count INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Note: likes_count column migration - ', err.message);
        }
      });

      // Add comments_count column if it doesn't exist
      db.run(`ALTER TABLE posts ADD COLUMN comments_count INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Note: comments_count column migration - ', err.message);
        }
      });

      // Add is_sent column to gentle_reminders if it doesn't exist
      db.run(`ALTER TABLE gentle_reminders ADD COLUMN is_sent BOOLEAN DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Note: is_sent column migration - ', err.message);
        }
      });

      // Add hashtags column to posts
      db.run(`ALTER TABLE posts ADD COLUMN hashtags TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Note: hashtags column migration - ', err.message);
        }
      });

      // Add action buttons columns to posts
      db.run(`ALTER TABLE posts ADD COLUMN enable_contact BOOLEAN DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Note: enable_contact column migration - ', err.message);
        }
      });

      db.run(`ALTER TABLE posts ADD COLUMN enable_interested BOOLEAN DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Note: enable_interested column migration - ', err.message);
        }
      });

      // Add date_of_birth column to users
      db.run(`ALTER TABLE users ADD COLUMN date_of_birth DATE`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Note: date_of_birth column migration - ', err.message);
        }
      });

      // Create hashtags table
      db.run(`
        CREATE TABLE IF NOT EXISTS hashtags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tag TEXT UNIQUE NOT NULL,
          usage_count INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create story_views table
      db.run(`
        CREATE TABLE IF NOT EXISTS story_views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          story_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (story_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(story_id, user_id)
        )
      `);

      // Create post_actions table for Contact Me / I'm Interested
      db.run(`
        CREATE TABLE IF NOT EXISTS post_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          action_type TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(post_id, user_id, action_type)
        )
      `);

      // Create poll_votes table
      db.run(`
        CREATE TABLE IF NOT EXISTS poll_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          option_index INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(poll_id, user_id)
        )
      `);
    });

    console.log('SQLite tables created successfully');
  });
};

// Migrate database schema
const migrateDatabase = () => {
  db.serialize(() => {
    // Add type column to messages if not exists
    db.run(`
      ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding type column:', err);
      }
    });
    
    // Add timer column to messages if not exists
    db.run(`
      ALTER TABLE messages ADD COLUMN timer INTEGER
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding timer column:', err);
      }
    });
    
    // Add expires_at column to messages if not exists
    db.run(`
      ALTER TABLE messages ADD COLUMN expires_at DATETIME
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding expires_at column:', err);
      }
    });
  });
};

// Create tables for PostgreSQL
const createTablesPostgres = async () => {
  // PostgreSQL table creation would go here
  // Similar structure but with PostgreSQL syntax
  console.log('PostgreSQL tables would be created here');
};

module.exports = {
  initDatabase,
  getDb: () => db
};
