# 📁 Files Organization - Visual Guide

## Before vs After

### Old Layout
```
┌─────────────────────────────────────────────┐
│  Feed | Links | Images | Documents | Videos │
│                | Files | Members             │
└─────────────────────────────────────────────┘

Problems:
❌ Images and Videos separated
❌ Too many tabs (7 total)
❌ "Files" tab name confusing
❌ No clear categorization
```

### New Layout
```
┌─────────────────────────────────────────────┐
│ 💬Feed | 🔗Links | 🎬Media | 📄Documents    │
│                  | 📎Other | 👥Members       │
└─────────────────────────────────────────────┘

Benefits:
✅ Media combines Images + Videos
✅ Cleaner with 6 tabs
✅ Clear emoji labels
✅ Logical grouping
```

## Media Tab Structure

```
┌──────────────────────────────────────────────┐
│           🎬 MEDIA TAB                       │
├──────────────────────────────────────────────┤
│                                              │
│  📷 Images                                   │
│  ────────────────────────────────────────    │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐              │
│  │img1│ │img2│ │img3│ │img4│              │
│  └────┘ └────┘ └────┘ └────┘              │
│                                              │
│  🎥 Videos                                   │
│  ────────────────────────────────────────    │
│  ┌─────────┐ ┌─────────┐                   │
│  │ video1  │ │ video2  │                   │
│  │  ▶️     │ │  ▶️     │                   │
│  └─────────┘ └─────────┘                   │
│                                              │
└──────────────────────────────────────────────┘
```

## Documents Tab Structure

```
┌──────────────────────────────────────────────┐
│     📄 DOCUMENTS (PDF, DOC, XLS, etc.)       │
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ 📄 Project_Plan.pdf                  │   │
│  │ 2.5 MB · Uploaded by John · 2m ago  │   │
│  │                        [Download] ──►│   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ 📊 Budget_2024.xlsx                  │   │
│  │ 1.8 MB · Uploaded by Jane · 1h ago  │   │
│  │                        [Download] ──►│   │
│  └──────────────────────────────────────┘   │
│                                              │
└──────────────────────────────────────────────┘
```

## File Upload Flow

```
User uploads files in chat
         │
         ▼
┌────────────────────┐
│  Backend analyzes  │
│    file types      │
└────────┬───────────┘
         │
         ├──► Image files → /images/ folder
         │                  → Media Tab (Images section)
         │
         ├──► Video files → /videos/ folder
         │                  → Media Tab (Videos section)
         │
         ├──► Documents → /documents/ folder
         │                → Documents Tab
         │
         └──► Other → /files/ folder
                      → Other Files Tab
```

## File Type Categories

### 🎬 Media (Images + Videos)
```
Images:
├── jpg, jpeg
├── png
├── gif
├── webp
└── bmp

Videos:
├── mp4
├── mov
├── avi
├── webm
└── mkv
```

### 📄 Documents
```
Documents:
├── pdf
├── doc, docx
├── xls, xlsx
└── txt
```

### 📎 Other Files
```
Archives & Others:
├── zip
├── rar
├── tar
└── any other file types
```

## User Interface Comparison

### Chat Upload (When selecting files)

**Before:**
```
Attachment Preview:
📷 photo.jpg [×]
```

**After:**
```
Attachment Preview:
┌──────────────────────────┐
│ 3 files selected         │
├──────────────────────────┤
│ 📷 photo1.jpg      [×]   │
│ 📷 photo2.png      [×]   │
│ 🎥 video.mp4       [×]   │
└──────────────────────────┘
```

### Files Display in Folders

**Images (Grid Layout):**
```
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│     │ │     │ │     │ │     │
│ IMG │ │ IMG │ │ IMG │ │ IMG │
│     │ │     │ │     │ │     │
└─────┘ └─────┘ └─────┘ └─────┘
  200px   200px   200px   200px
```

**Videos (Wider Grid):**
```
┌──────────┐ ┌──────────┐ ┌──────────┐
│          │ │          │ │          │
│  VIDEO   │ │  VIDEO   │ │  VIDEO   │
│    ▶️    │ │    ▶️    │ │    ▶️    │
│          │ │          │ │          │
└──────────┘ └──────────┘ └──────────┘
   300px        300px        300px
```

**Documents (List Layout):**
```
╔════════════════════════════════════════╗
║ 📄 filename.pdf                        ║
║ Size · Uploader · Time   [Download] ══╣
╚════════════════════════════════════════╝

╔════════════════════════════════════════╗
║ 📊 spreadsheet.xlsx                    ║
║ Size · Uploader · Time   [Download] ══╣
╚════════════════════════════════════════╝
```

## Mobile View

```
┌─────────────────────────────┐
│  Tabs (Scrollable)          │
│  ◄ 💬 🔗 🎬 📄 📎 👥 ►     │
├─────────────────────────────┤
│                             │
│    Media Content            │
│                             │
│    📷 Images                │
│    ┌──────┐ ┌──────┐       │
│    │      │ │      │       │
│    │ IMG  │ │ IMG  │       │
│    └──────┘ └──────┘       │
│                             │
│    🎥 Videos               │
│    ┌──────────────┐        │
│    │    VIDEO     │        │
│    │      ▶️      │        │
│    └──────────────┘        │
│                             │
└─────────────────────────────┘
```

## API Endpoints

```javascript
// Get all files of specific type
GET /api/community-groups/:groupId/files?type=image
GET /api/community-groups/:groupId/files?type=video
GET /api/community-groups/:groupId/files?type=document
GET /api/community-groups/:groupId/files?type=other

// Response format:
{
  "success": true,
  "files": [
    {
      "id": 1,
      "group_id": 5,
      "user_id": 10,
      "filename": "photo.jpg",
      "filepath": "/uploads/communities/1/groups/5/images/photo.jpg",
      "file_type": "image",
      "filesize": 1048576,
      "username": "john_doe",
      "profile_picture": "/uploads/profiles/john.jpg",
      "created_at": "2026-01-17 10:30:00"
    }
  ]
}
```

## Database Schema

```sql
CREATE TABLE community_group_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  file_type TEXT NOT NULL,  -- 'image', 'video', 'document', 'other'
  filesize INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## Folder Structure

```
uploads/
└── communities/
    └── {communityId}/
        └── groups/
            └── {groupId}/
                ├── images/        ← 📷 Photos, screenshots
                │   ├── photo1.jpg
                │   └── photo2.png
                ├── videos/        ← 🎥 Video clips
                │   ├── video1.mp4
                │   └── video2.mov
                ├── documents/     ← 📄 PDFs, Word, Excel
                │   ├── report.pdf
                │   └── data.xlsx
                └── files/         ← 📎 Archives, other
                    └── backup.zip
```

## Summary

This organization system provides:
1. **Intuitive categorization** - Files automatically sorted by type
2. **Easy navigation** - Related content grouped together
3. **Professional appearance** - Clean, modern UI with emoji labels
4. **Efficient storage** - Organized folder structure
5. **Quick access** - Find files by category quickly

Users can now:
- ✅ Upload multiple files at once
- ✅ Find all media (images + videos) in one place
- ✅ Access documents separately
- ✅ View file details (size, uploader, date)
- ✅ Download files easily
