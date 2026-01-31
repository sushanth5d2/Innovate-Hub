# Group Settings - User Guide 📋

## How to Access Group Settings

### Step 1: Navigate to Your Group
1. Go to a community you're in
2. Click on a group you created (you must be the admin/creator)
3. The group page will open

### Step 2: Locate Settings Button
- Look for the **⚙️ Group Settings** button in the group header
- This button only appears if you're the group admin
- It's located next to the "Start Video Call" and "Start Audio Call" buttons

### Step 3: Open Settings
- Click the **⚙️ Group Settings** button
- A modal dialog will open with all settings options

## Settings Options

### 1. Profile Picture
**What it does**: Sets the group's display picture shown in group list and group page

**How to change**:
- Click **"Change Picture"** button
- Select an image file (JPEG, PNG, or GIF)
- Preview updates immediately
- Click **"Save Changes"** to apply

**Tips**:
- Use square images for best results
- Recommended size: 512x512 pixels or larger
- Max file size: 50MB

### 2. Group Name
**What it does**: Updates the name displayed for your group

**How to change**:
- Type new name in the text field
- Name is required (cannot be empty)
- Click **"Save Changes"** to apply

**Tips**:
- Keep it short and descriptive
- Use clear, meaningful names
- Avoid special characters

### 3. Description
**What it does**: Sets the group bio/description shown under the group name

**How to change**:
- Type or edit text in the textarea
- Description is optional
- Supports multiple lines
- Click **"Save Changes"** to apply

**Tips**:
- Explain the group's purpose
- Include rules or guidelines
- Mention topics discussed

### 4. Privacy Settings
**What it does**: Controls who can see and join your group

**Options**:
- **🌐 Public**: Anyone in the community can see and join
- **🔒 Private**: Only members can see, join by invitation only

**How to change**:
- Click the toggle switch to change between Public/Private
- Toggle shows current state (blue = active)
- Click **"Save Changes"** to apply

**Privacy Behavior**:

#### Public Groups
- ✅ Visible in community group list
- ✅ Anyone in community can join
- ✅ Posts visible to community members
- ✅ Searchable within community

#### Private Groups
- 🔒 Hidden from group list (members only)
- 🔒 Invite-only membership
- 🔒 Posts only visible to members
- 🔒 Not searchable

### 5. Saving Changes
- Click **"Save Changes"** button at bottom right
- Wait for confirmation message
- Settings modal closes automatically
- Group page refreshes with new settings

### 6. Canceling
- Click **"Cancel"** button at bottom left
- Or click outside the modal (on dark overlay)
- No changes will be saved

## Visual Elements

### Group Header Display
Once settings are saved, you'll see:
- **Profile Picture**: Large circular image (64x64px)
- **Group Name**: Bold text next to profile picture
- **Description**: Gray text under name
- **Privacy Badge**: Small badge showing 🌐 Public or 🔒 Private
- **Member Count**: Number of members

### Settings Modal Layout
```
┌─────────────────────────────────────────┐
│         Group Settings                   │
├─────────────────────────────────────────┤
│  Profile Picture                         │
│  [Avatar Image]  [Change Picture]        │
├─────────────────────────────────────────┤
│  Group Name                              │
│  [_____________________________]         │
├─────────────────────────────────────────┤
│  Description                             │
│  [_____________________________]         │
│  [_____________________________]         │
├─────────────────────────────────────────┤
│  Public Group              [Toggle]      │
│  Allow anyone in community to see        │
├─────────────────────────────────────────┤
│              [Cancel]  [Save Changes]    │
└─────────────────────────────────────────┘
```

## Common Use Cases

### Use Case 1: Creating a Private Study Group
1. Open group settings
2. Set name: "CS 101 Study Group"
3. Add description: "Private study group for Computer Science students. Share notes and discuss assignments."
4. Toggle **OFF** for Privacy (make it private)
5. Upload group profile picture (optional)
6. Click Save Changes

### Use Case 2: Converting Private to Public
1. Open group settings
2. Toggle **ON** for Privacy (make it public)
3. Update description if needed
4. Click Save Changes
5. Group now visible to all community members

### Use Case 3: Rebranding Your Group
1. Open group settings
2. Change name to new identity
3. Update description with new focus
4. Upload new profile picture
5. Click Save Changes

## Permissions

### Who Can Access Settings?
- ✅ Group creator/admin only
- ❌ Regular members cannot access
- ❌ Community admins cannot access (unless also group admin)

### Who Can See Settings Button?
- Only the user who created the group
- Button is hidden for all other users

## Tips & Best Practices

### Profile Pictures
- Use high-quality images
- Avoid text-heavy images
- Keep it simple and recognizable
- Test how it looks when small (thumbnails)

### Group Names
- Be descriptive
- Include topic or purpose
- Keep under 50 characters
- Use proper capitalization

### Descriptions
- Explain group purpose
- Set expectations
- Include any rules
- Mention typical topics
- Keep it concise (2-3 sentences)

### Privacy Settings
- Start private for sensitive groups
- Go public to attract more members
- Change as group evolves
- Communicate privacy to members

## Troubleshooting

### Settings Button Not Showing
- **Problem**: Can't find settings button
- **Solution**: Only group creators see this button. Check if you're the admin.

### Can't Upload Profile Picture
- **Problem**: Image upload fails
- **Solutions**:
  - Check file size (max 50MB)
  - Use supported formats (JPEG, PNG, GIF)
  - Try a different browser
  - Check internet connection

### Changes Not Saving
- **Problem**: Clicked save but nothing changed
- **Solutions**:
  - Check for error messages
  - Ensure name field is not empty
  - Refresh page and try again
  - Check console for errors (F12)

### Profile Picture Not Updating
- **Problem**: New picture not showing
- **Solutions**:
  - Hard refresh page (Ctrl+F5)
  - Clear browser cache
  - Wait a few seconds and refresh
  - Try uploading again

## Technical Notes

### File Storage
- Profile pictures saved to: `uploads/community/`
- Filename format: `timestamp-randomnumber.extension`
- Original filename not preserved

### Database Fields
- `name`: TEXT, required
- `description`: TEXT, optional
- `profile_picture`: TEXT (path)
- `is_public`: INTEGER (0 or 1)

### API Endpoint
- URL: `/api/community-groups/:groupId`
- Method: PUT
- Authentication: Required (Bearer token)
- Content-Type: multipart/form-data

---

**Questions or Issues?**
Contact support or refer to [GROUP_SETTINGS_COMPLETE.md](./GROUP_SETTINGS_COMPLETE.md) for technical details.
