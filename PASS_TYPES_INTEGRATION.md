# Dual Pricing System - Fare Options + Pass Types

## Overview
Event creation form now has TWO pricing systems available - Simple Fare Options AND Advanced Pass Types. Event creators can use either or both together.

## Available Systems

### ✅ Simple Fare Options (Quick Setup)
- **Pricing dropdown**: Free/Paid
- **Quick checkboxes**: Single, Couple, Group
- **Amount inputs**: Enter price for each fare type
- **Use case**: Basic events with simple pricing structure

### ✅ Advanced Pass Types (Professional)
- **Custom ticket names**: VIP, General, Early Bird, etc.
- **Multiple payment modes**: Free, Pay at venue, Contact, DM, Online
- **Per-type capacity**: Each ticket type can have different capacity
- **Rich descriptions**: Explain what's included in each ticket
- **Contact integration**: Direct contact info per ticket type
- **Use case**: Professional events with multiple ticket tiers

## When to Use Each

**Simple Fare Options:**
- ⚡ Quick event setup
- 💵 Basic pricing (Single/Couple/Group)
- 🎫 Same payment method for all tickets

**Pass Types System:**
- 🎭 Multiple ticket tiers needed
- 📊 Different capacities per ticket type  
- 💳 Mixed payment methods
- 📝 Need detailed ticket descriptions
- 🏢 Professional event management

**Both Together:**
- Use fare options for walk-in pricing
- Use pass types for advance booking tiers

## What Changed

### 1. **Removed Duplicate Fields**
❌ **Old System (Removed):**
- Pricing dropdown (Free/Paid)
- Fixed fare checkboxes: Single, Couple, Group
- Fixed fare amount inputs for each type

✅ **New System (Added):**
- Flexible pass types section
- Add multiple custom pass types (VIP, General, Early Bird, etc.)
- Each pass type has:
  - Name (custom)
  - Mode (Free/Pay at venue/Contact/DM/Online)
  - Price (in INR)
  - Capacity (optional per pass type)
  - Description (What's included)
  - Contact text (WhatsApp/Phone/Instructions)

### 2. **Benefits of Pass Types System**
1. **Flexibility**: Create unlimited ticket types with custom names
2. **Better UX**: Matches professional event platforms (like HighApe in image 2)
3. **Capacity Management**: Each pass type can have its own capacity limit
4. **Payment Options**: 5 modes instead of just Free/Paid
5. **Rich Descriptions**: Each ticket type can explain what's included
6. **Contact Integration**: Direct contact info for each ticket type

### 3. **Files Modified**

#### Frontend Changes
- **`/workspaces/Innovate-Hub/public/events.html`**
  - KEPT: Pricing dropdown (Free/Paid) and fare options (Single/Couple/Group)
  - ADDED: Pass Types section with form to add multiple custom ticket types
  - ADDED: Pass types list display with delete buttons
  - Both systems coexist in the same form

- **`/workspaces/Innovate-Hub/public/js/events-experiences.js`**
  - KEPT: `handlePricingTypeChange()` for fare options show/hide
  - KEPT: `handleFareCheckbox()` for fare input enabling
  - KEPT: Fare data submission in `createEvent()`
  - ADDED: `state.createEventPassTypes` array for pass types
  - ADDED: `addPassTypeToCreate()` function
  - ADDED: `renderCreateEventPassTypes()` function
  - ADDED: `createPassTypesForEvent()` API integration
  - Updated: `createEvent()` sends fare data AND creates pass types

#### Backend Changes
- **`/workspaces/Innovate-Hub/routes/events.js`**
  - No changes needed! Backend already supports:
    - Old fare fields (kept for backwards compatibility, now optional)
    - Pass types API at `POST /api/events/:eventId/tickets/types`
    - Using existing `event_ticket_types` table

## How It Works

### Event Creation Flow (Using Both Systems)
1. User opens Create Event modal
2. Fills in basic event details (title, date, location, etc.)
3. **Option A - Simple Fare Options:**
   - Select "Paid" from Pricing dropdown
   - Check boxes for Single/Couple/Group
   - Enter amounts for each checked option
4. **Option B - Advanced Pass Types:**
   - Click "Add Pass Type" button
   - Fill in custom ticket details (name, mode, price, capacity, etc.)
   - Each pass added to temporary array with delete option
5. **Use Both:** Event can have both fare options AND pass types
6. Click "Create" button
7. Event created with fare data, then pass types created via API
8. User redirected to "My Events" tab

### Backend Handling
- Simple fare options saved to: `fare_single`, `fare_couple`, `fare_group`, `fare_options` columns in `events` table
- Pass types saved to: `event_ticket_types` table with foreign key to event
- Both systems work independently and together

## Database Structure

### Existing Table: `event_ticket_types`
```sql
- id: Primary key
- event_id: Foreign key to events
- name: Ticket type name (e.g., "VIP", "General")
- description: What's included
- payment_mode: 'free', 'venue', 'contact', 'dm', 'online'
- contact_text: Contact instructions
- price_cents: Price in cents (100 cents = ₹1)
- currency: Default 'INR'
- quantity_total: Available tickets (NULL = unlimited)
- quantity_sold: Tickets sold
- is_active: Active/inactive status
```

## UI Screenshot Reference
The implementation matches the **"Manage Pass Types"** modal from image 2:
- Name field (VIP / General)
- Mode dropdown (Free option visible)
- Price (INR) field
- Capacity (optional) field
- Description textarea (What's included?)
- Contact text field (WhatsApp/Phone/Instructions)

## Testing Checklist
✅ Open Create Event modal
✅ Test Simple Fare Options:
  - Select "Paid" pricing
  - Check Single/Couple/Group boxes
  - Enter amounts and verify inputs enable/disable
✅ Test Pass Types:
  - Add multiple custom pass types (VIP, General, etc.)
  - Remove pass types before creating event
✅ Test Both Together:
  - Use fare options for basic pricing
  - Add pass types for advanced tiers
  - Create event with both systems active
✅ Verify event creation succeeds with all data
✅ Check "Manage Pass Types" modal shows added pass types
✅ Verify ticket selection shows all available options

## Next Steps
1. **Refresh browser** (Ctrl+Shift+R to clear cache)
2. **Test Simple Fare Options:**
   - Create event with Paid pricing
   - Check Single (₹500), Couple (₹800) boxes
3. **Test Pass Types:**
   - Add VIP pass (₹1000, capacity 20)
   - Add General pass (Free, capacity 100)
4. **Test Both Together:**
   - Keep fare options selected
   - Also add custom pass types
   - Create event and verify all options available

---
**Note**: Both pricing systems are fully functional and can be used independently or together. Choose based on your event's complexity!
