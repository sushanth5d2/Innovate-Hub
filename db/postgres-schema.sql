-- Innovate Hub - PostgreSQL Schema (auto-generated from SQLite)
-- Generated: 2026-03-04T06:48:30.593Z
-- Tables: 70
-- NOTE: No transaction block so tables with missing FK deps still create.
-- Run this file TWICE if you get FK errors on first run.

-- Table: ai_chat_messages
CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model_id TEXT,
        tokens_used INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, attachment_url TEXT, attachment_type TEXT, original_filename TEXT,
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
      );

-- Table: ai_conversations
CREATE TABLE IF NOT EXISTS ai_conversations (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT DEFAULT 'New Chat',
        model_id TEXT DEFAULT 'gpt-4o-mini',
        is_deleted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: ai_user_preferences
CREATE TABLE IF NOT EXISTS ai_user_preferences (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        preferred_model TEXT DEFAULT 'gpt-4o-mini',
        system_prompt TEXT,
        temperature DOUBLE PRECISION DEFAULT 0.7,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: announcement_comments
CREATE TABLE IF NOT EXISTS announcement_comments (
          id BIGSERIAL PRIMARY KEY,
          announcement_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (announcement_id) REFERENCES community_announcements(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

-- Table: announcement_reactions
CREATE TABLE IF NOT EXISTS announcement_reactions (
          id BIGSERIAL PRIMARY KEY,
          announcement_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          reaction_type TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (announcement_id) REFERENCES community_announcements(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(announcement_id, user_id, reaction_type)
        );

-- Table: blocked_users
CREATE TABLE IF NOT EXISTS blocked_users (
        id BIGSERIAL PRIMARY KEY,
        blocker_id INTEGER NOT NULL,
        blocked_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(blocker_id, blocked_id)
      );

-- Table: comment_likes
CREATE TABLE IF NOT EXISTS comment_likes (
        id BIGSERIAL PRIMARY KEY,
        comment_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(comment_id, user_id),
        FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: communities
CREATE TABLE IF NOT EXISTS communities (
        id BIGSERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        team_name TEXT,
        banner_image TEXT,
        is_public BOOLEAN DEFAULT TRUE,
        admin_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_announcements
CREATE TABLE IF NOT EXISTS community_announcements (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        author_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        is_pinned BOOLEAN DEFAULT FALSE,
        attachments TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_blocked_users
CREATE TABLE IF NOT EXISTS community_blocked_users (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        blocked_by INTEGER NOT NULL,
        reason TEXT,
        blocked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (blocked_by) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(community_id, user_id)
      );

-- Table: community_chat
CREATE TABLE IF NOT EXISTS community_chat (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        message TEXT,
        attachments TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_files
CREATE TABLE IF NOT EXISTS community_files (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        filesize INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_github_integrations
CREATE TABLE IF NOT EXISTS community_github_integrations (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        created_by INTEGER NOT NULL,
        github_org TEXT,
        github_repo_full_name TEXT,
        github_access_token TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(community_id)
      );

-- Table: community_group_blocked
CREATE TABLE IF NOT EXISTS community_group_blocked (
          id BIGSERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          blocked_by INTEGER NOT NULL,
          blocked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (blocked_by) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(group_id, user_id)
        );

-- Table: community_group_files
CREATE TABLE IF NOT EXISTS community_group_files (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        file_type TEXT NOT NULL,
        filesize INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_group_join_requests
CREATE TABLE IF NOT EXISTS community_group_join_requests (
          id BIGSERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          status TEXT DEFAULT 'pending',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(group_id, user_id)
        );

-- Table: community_group_links
CREATE TABLE IF NOT EXISTS community_group_links (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_group_members
CREATE TABLE IF NOT EXISTS community_group_members (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(group_id, user_id)
      );

-- Table: community_group_note_versions
CREATE TABLE IF NOT EXISTS community_group_note_versions (
        id BIGSERIAL PRIMARY KEY,
        note_id INTEGER NOT NULL,
        content_md TEXT,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (note_id) REFERENCES community_group_notes(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_group_notes
CREATE TABLE IF NOT EXISTS community_group_notes (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content_md TEXT,
        created_by INTEGER NOT NULL,
        updated_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, is_pinned BOOLEAN DEFAULT FALSE, is_locked BOOLEAN DEFAULT FALSE, is_archived BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_group_posts
CREATE TABLE IF NOT EXISTS community_group_posts (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT,
        attachments TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, edited_at TIMESTAMPTZ, is_edited BOOLEAN DEFAULT FALSE, reply_to INTEGER, is_deleted BOOLEAN DEFAULT FALSE, pinned_at TIMESTAMPTZ, pinned_by INTEGER, pin_expires_at TIMESTAMPTZ,
        FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_group_tasks
CREATE TABLE IF NOT EXISTS community_group_tasks (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'todo',
        due_date TIMESTAMPTZ,
        assignees TEXT,
        progress INTEGER DEFAULT 0,
        source_type TEXT,
        source_ref TEXT,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, subtasks TEXT,
        FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_groups
CREATE TABLE IF NOT EXISTS community_groups (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        creator_id INTEGER NOT NULL,
        encryption_key TEXT,
        profile_picture TEXT,
        is_public BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: community_join_requests
CREATE TABLE IF NOT EXISTS community_join_requests (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(community_id, user_id)
      );

-- Table: community_members
CREATE TABLE IF NOT EXISTS community_members (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(community_id, user_id)
      );

-- Table: community_posts
CREATE TABLE IF NOT EXISTS community_posts (
        id BIGSERIAL PRIMARY KEY,
        community_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT,
        images TEXT,
        files TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: crosspath_events
CREATE TABLE IF NOT EXISTS crosspath_events (
        id BIGSERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        user1_id INTEGER NOT NULL,
        user2_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: crosspath_locations
CREATE TABLE IF NOT EXISTS crosspath_locations (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        UNIQUE(user_id, event_id)
      );

-- Table: crosspath_matches
CREATE TABLE IF NOT EXISTS crosspath_matches (
        id BIGSERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        user1_id INTEGER NOT NULL,
        user2_id INTEGER NOT NULL,
        distance_meters DOUBLE PRECISION,
        matched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        notification_sent BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: donation_assigns
CREATE TABLE IF NOT EXISTS donation_assigns (
        id BIGSERIAL PRIMARY KEY,
        donation_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        completed BOOLEAN DEFAULT FALSE,
        completion_photos TEXT,
        FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(donation_id, user_id)
      );

-- Table: donations
CREATE TABLE IF NOT EXISTS donations (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        images TEXT,
        address TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        status TEXT DEFAULT 'available',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, completion_photos TEXT, category TEXT, city TEXT, phone TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: event_attendees
CREATE TABLE IF NOT EXISTS event_attendees (
        id BIGSERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(event_id, user_id)
      );

-- Table: event_checkin_staff
CREATE TABLE IF NOT EXISTS event_checkin_staff (
        id BIGSERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMPTZ,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(event_id, username)
      );

-- Table: event_orders
CREATE TABLE IF NOT EXISTS event_orders (
        id BIGSERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL,
        ticket_type_id INTEGER,
        quantity INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        total_cents INTEGER DEFAULT 0,
        currency TEXT DEFAULT 'INR',
        payment_provider TEXT,
        payment_ref TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (ticket_type_id) REFERENCES event_ticket_types(id) ON DELETE SET NULL
      );

-- Table: event_ticket_types
CREATE TABLE IF NOT EXISTS event_ticket_types (
        id BIGSERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        payment_mode TEXT DEFAULT 'free',
        contact_text TEXT,
        price_cents INTEGER DEFAULT 0,
        currency TEXT DEFAULT 'INR',
        quantity_total INTEGER,
        quantity_sold INTEGER DEFAULT 0,
        sales_start TIMESTAMPTZ,
        sales_end TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, payment_methods TEXT,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

-- Table: event_tickets
CREATE TABLE IF NOT EXISTS event_tickets (
        id BIGSERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        ticket_type_id INTEGER,
        owner_id INTEGER NOT NULL,
        code TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'issued',
        checked_in_at TIMESTAMPTZ,
        checked_in_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES event_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (ticket_type_id) REFERENCES event_ticket_types(id) ON DELETE SET NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (checked_in_by) REFERENCES users(id) ON DELETE SET NULL
      );

-- Table: events
CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        creator_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        event_date TIMESTAMPTZ NOT NULL,
        is_public BOOLEAN DEFAULT TRUE,
        city TEXT,
        category TEXT,
        location TEXT,
        cover_image TEXT,
        organizer_name TEXT,
        important_note TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, max_persons INTEGER, pricing_type TEXT DEFAULT 'free', fare_single INTEGER, fare_couple INTEGER, fare_group INTEGER, fare_options TEXT, is_online BOOLEAN DEFAULT FALSE, online_url TEXT,
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: follow_requests
CREATE TABLE IF NOT EXISTS follow_requests (
        id BIGSERIAL PRIMARY KEY,
        requester_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(requester_id, target_id),
        FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: followers
CREATE TABLE IF NOT EXISTS followers (
        id BIGSERIAL PRIMARY KEY,
        follower_id INTEGER NOT NULL,
        following_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(follower_id, following_id)
      );

-- Table: gentle_reminders
CREATE TABLE IF NOT EXISTS gentle_reminders (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        reminder_date TIMESTAMPTZ NOT NULL,
        message TEXT,
        is_sent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      );

-- Table: group_conversations
CREATE TABLE IF NOT EXISTS group_conversations (
        id BIGSERIAL PRIMARY KEY,
        creator_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, profile_picture TEXT DEFAULT '', description TEXT DEFAULT '',
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: group_members
CREATE TABLE IF NOT EXISTS group_members (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES group_conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(group_id, user_id)
      );

-- Table: group_message_reactions
CREATE TABLE IF NOT EXISTS group_message_reactions (
          id BIGSERIAL PRIMARY KEY,
          message_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          reaction_type TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (message_id) REFERENCES community_group_posts(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(message_id, user_id, reaction_type)
        );

-- Table: group_message_reads
CREATE TABLE IF NOT EXISTS group_message_reads (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        last_read_message_id INTEGER,
        last_read_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(group_id, user_id)
      );

-- Table: group_messages
CREATE TABLE IF NOT EXISTS group_messages (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        content TEXT,
        type TEXT DEFAULT 'text',
        attachments TEXT,
        timer INTEGER,
        expires_at TIMESTAMPTZ,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, is_pinned BOOLEAN DEFAULT FALSE, pinned_at TIMESTAMPTZ, pinned_by INTEGER, reply_to_id INTEGER,
        FOREIGN KEY (group_id) REFERENCES group_conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: group_poll_votes
CREATE TABLE IF NOT EXISTS group_poll_votes (
          id BIGSERIAL PRIMARY KEY,
          poll_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          option_index INTEGER NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (poll_id) REFERENCES group_polls(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(poll_id, user_id)
        );

-- Table: group_polls
CREATE TABLE IF NOT EXISTS group_polls (
          id BIGSERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          question TEXT NOT NULL,
          options TEXT NOT NULL,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, pinned_at TIMESTAMPTZ, pinned_by INTEGER, pin_expires_at TIMESTAMPTZ,
          FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

-- Table: hashtags
CREATE TABLE IF NOT EXISTS hashtags (
          id BIGSERIAL PRIMARY KEY,
          tag TEXT UNIQUE NOT NULL,
          usage_count INTEGER DEFAULT 1,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

-- Table: instant_meetings
CREATE TABLE IF NOT EXISTS instant_meetings (
        id BIGSERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL,
        creator_id INTEGER NOT NULL,
        platform TEXT NOT NULL,
        meeting_url TEXT,
        meeting_date TIMESTAMPTZ NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: messages
CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        content TEXT,
        attachments TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        is_deleted_by_sender BOOLEAN DEFAULT FALSE,
        is_deleted_by_receiver BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, is_pinned BOOLEAN DEFAULT FALSE, pinned_at TIMESTAMPTZ, pinned_by INTEGER, pin_expires_at TIMESTAMPTZ, reply_to_id INTEGER, timer INTEGER, expires_at TIMESTAMPTZ, type TEXT DEFAULT 'text', original_filename TEXT, is_message_request BOOLEAN DEFAULT FALSE, message_request_status TEXT DEFAULT NULL, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: notifications
CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        related_id INTEGER,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, created_by INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: pinned_groups
CREATE TABLE IF NOT EXISTS pinned_groups (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        pinned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(group_id, user_id)
      );

-- Table: poll_votes
CREATE TABLE IF NOT EXISTS poll_votes (
          id BIGSERIAL PRIMARY KEY,
          poll_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          option_index INTEGER NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(poll_id, user_id)
        );

-- Table: polls
CREATE TABLE IF NOT EXISTS polls (
        id BIGSERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        votes TEXT,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      );

-- Table: portfolio_projects
CREATE TABLE IF NOT EXISTS portfolio_projects (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        technologies TEXT DEFAULT '',
        url TEXT DEFAULT '',
        thumbnail TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: post_actions
CREATE TABLE IF NOT EXISTS post_actions (
          id BIGSERIAL PRIMARY KEY,
          post_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          action_type TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(post_id, user_id, action_type)
        );

-- Table: post_comments
CREATE TABLE IF NOT EXISTS post_comments (
        id BIGSERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, parent_id BIGINT REFERENCES post_comments(id),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: post_interactions
CREATE TABLE IF NOT EXISTS post_interactions (
        id BIGSERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: post_likes
CREATE TABLE IF NOT EXISTS post_likes (
        id BIGSERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(post_id, user_id)
      );

-- Table: posts
CREATE TABLE IF NOT EXISTS posts (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        content TEXT,
        images TEXT,
        files TEXT,
        video_url TEXT,
        is_story BOOLEAN DEFAULT FALSE,
        is_archived BOOLEAN DEFAULT FALSE,
        scheduled_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        likes_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, hashtags TEXT, enable_contact BOOLEAN DEFAULT FALSE, enable_interested BOOLEAN DEFAULT FALSE, custom_button TEXT, comment_to_dm TEXT, is_creator_series BOOLEAN DEFAULT FALSE, is_public_post BOOLEAN DEFAULT FALSE, is_admin_post BOOLEAN DEFAULT FALSE, admin_frequency TEXT DEFAULT 'once', admin_feed_position INTEGER DEFAULT 3,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: saved_posts
CREATE TABLE IF NOT EXISTS saved_posts (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        UNIQUE(user_id, post_id)
      );

-- Table: shared_note_versions
CREATE TABLE IF NOT EXISTS shared_note_versions (
        id BIGSERIAL PRIMARY KEY,
        note_id INTEGER NOT NULL,
        content_md TEXT,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (note_id) REFERENCES shared_notes(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: shared_notes
CREATE TABLE IF NOT EXISTS shared_notes (
        id BIGSERIAL PRIMARY KEY,
        context_type TEXT NOT NULL DEFAULT 'user',
        context_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content_md TEXT,
        is_pinned BOOLEAN DEFAULT FALSE,
        is_locked BOOLEAN DEFAULT FALSE,
        is_archived BOOLEAN DEFAULT FALSE,
        color TEXT DEFAULT '#ffffff',
        created_by INTEGER NOT NULL,
        updated_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: shared_tasks
CREATE TABLE IF NOT EXISTS shared_tasks (
        id BIGSERIAL PRIMARY KEY,
        context_type TEXT NOT NULL DEFAULT 'user',
        context_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'todo',
        due_date TIMESTAMPTZ,
        assignees TEXT,
        progress INTEGER DEFAULT 0,
        subtasks TEXT,
        tags TEXT,
        source_type TEXT,
        source_ref TEXT,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: starred_messages
CREATE TABLE IF NOT EXISTS starred_messages (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        starred_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, message_type TEXT DEFAULT 'dm',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        UNIQUE(user_id, message_id)
      );

-- Table: story_views
CREATE TABLE IF NOT EXISTS story_views (
          id BIGSERIAL PRIMARY KEY,
          story_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          viewed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (story_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(story_id, user_id)
        );

-- Table: todos
CREATE TABLE IF NOT EXISTS todos (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        items TEXT NOT NULL,
        tags TEXT,
        priority TEXT DEFAULT 'medium',
        due_date TIMESTAMPTZ,
        completed BOOLEAN DEFAULT FALSE,
        image_source TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: user_map_settings
CREATE TABLE IF NOT EXISTS user_map_settings (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        show_on_map BOOLEAN DEFAULT TRUE,
        proximity_notifications BOOLEAN DEFAULT FALSE,
        proximity_distance INTEGER DEFAULT 500,
        user_latitude DOUBLE PRECISION,
        user_longitude DOUBLE PRECISION,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: user_reminders
CREATE TABLE IF NOT EXISTS user_reminders (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        reminder_date TIMESTAMPTZ NOT NULL,
        reminder_time TEXT DEFAULT '09:00',
        type TEXT DEFAULT 'custom',
        source_type TEXT,
        source_id INTEGER,
        is_recurring BOOLEAN DEFAULT FALSE,
        recurrence_pattern TEXT,
        is_notified BOOLEAN DEFAULT FALSE,
        is_dismissed BOOLEAN DEFAULT FALSE,
        color TEXT DEFAULT '#0095f6',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, priority TEXT DEFAULT 'low',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: users
CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        bio TEXT,
        skills TEXT,
        interests TEXT,
        favorite_teams TEXT,
        profile_picture TEXT,
        is_online BOOLEAN DEFAULT FALSE,
        last_seen TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      , date_of_birth DATE, fullname TEXT, is_private BOOLEAN DEFAULT TRUE, break_until TIMESTAMPTZ, is_deactivated BOOLEAN DEFAULT FALSE, deactivated_at TIMESTAMPTZ, is_admin BOOLEAN DEFAULT FALSE, is_banned BOOLEAN DEFAULT FALSE, banned_until TIMESTAMPTZ, ban_reason TEXT);

-- Table: call_history
CREATE TABLE IF NOT EXISTS call_history (
        id BIGSERIAL PRIMARY KEY,
        caller_id INTEGER NOT NULL,
        call_type TEXT NOT NULL DEFAULT 'dm',
        target_id INTEGER NOT NULL,
        is_video BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'initiated',
        started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        answered_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        duration INTEGER DEFAULT 0,
        FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: call_participants
CREATE TABLE IF NOT EXISTS call_participants (
        id BIGSERIAL PRIMARY KEY,
        call_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        left_at TIMESTAMPTZ,
        FOREIGN KEY (call_id) REFERENCES call_history(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: user_conversations
CREATE TABLE IF NOT EXISTS user_conversations (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        contact_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, contact_id)
      );

-- Table: device_tokens
CREATE TABLE IF NOT EXISTS device_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_token TEXT NOT NULL,
        device_type TEXT DEFAULT 'android',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, device_token)
      );

-- Table: post_reports
CREATE TABLE IF NOT EXISTS post_reports (
        id BIGSERIAL PRIMARY KEY,
        reporter_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        details TEXT,
        status TEXT DEFAULT 'pending',
        reviewed_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      );

-- Table: admin_actions
CREATE TABLE IF NOT EXISTS admin_actions (
        id BIGSERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        target_user_id INTEGER,
        target_post_id INTEGER,
        details TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
      );

-- Table: deleted_group_messages
CREATE TABLE IF NOT EXISTS deleted_group_messages (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        deleted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, message_id)
      );

-- Table: group_disappearing_settings
CREATE TABLE IF NOT EXISTS group_disappearing_settings (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL UNIQUE,
        set_by INTEGER NOT NULL,
        mode TEXT DEFAULT 'off',
        duration INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

-- Table: disappearing_settings
CREATE TABLE IF NOT EXISTS disappearing_settings (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        contact_id INTEGER NOT NULL,
        mode TEXT DEFAULT 'off',
        duration INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, contact_id)
      );

-- Table: chat_mute_settings
CREATE TABLE IF NOT EXISTS chat_mute_settings (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        contact_id INTEGER NOT NULL,
        muted BOOLEAN DEFAULT FALSE,
        UNIQUE(user_id, contact_id)
      );

-- Table: user_reports
CREATE TABLE IF NOT EXISTS user_reports (
        id BIGSERIAL PRIMARY KEY,
        reporter_id INTEGER NOT NULL,
        reported_user_id INTEGER NOT NULL,
        reason TEXT,
        details TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

-- Table: muted_users
CREATE TABLE IF NOT EXISTS muted_users (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        muted_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, muted_id)
      );

