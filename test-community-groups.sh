#!/bin/bash

# Community Groups Messages Test Script
# Tests the fixes for message display and persistence

echo "======================================"
echo "Community Groups Messages Test"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Server Status:${NC}"
if lsof -i :3000 | grep -q LISTEN; then
    echo -e "${GREEN}✓${NC} Server is running on port 3000"
else
    echo "✗ Server is NOT running"
    echo "  Start server with: npm start"
    exit 1
fi

echo ""
echo -e "${BLUE}Test Instructions:${NC}"
echo ""
echo "Test 1: Fresh Group Selection"
echo "  1. Open: http://localhost:3000/community.html?id=1"
echo "  2. Click 'Groups' tab in left sidebar"
echo "  3. Click on any group"
echo "  4. Verify messages load in center panel"
echo "  5. Check console for: 'Posts length: X'"
echo ""

echo "Test 2: Page Refresh Persistence"
echo "  1. Select a group (messages visible)"
echo "  2. Press F5 to refresh"
echo "  3. Verify messages still display"
echo "  4. Check console for: 'AUTO-SELECTING GROUP'"
echo ""

echo "Test 3: Send New Message"
echo "  1. Type message in input field"
echo "  2. Press Enter or click Send"
echo "  3. Verify new message appears"
echo "  4. Check console for: 'Message sent successfully'"
echo ""

echo "Test 4: Multiple Refreshes"
echo "  1. Refresh page 3 times (F5 x3)"
echo "  2. Verify messages persist all times"
echo "  3. Verify no 'Select a group' appears"
echo ""

echo -e "${BLUE}Console Debug Commands:${NC}"
echo ""
echo "Check current state:"
echo "  state.currentGroupId"
echo "  state.groups.length"
echo ""

echo "Manual group selection:"
echo "  selectGroup(1)"
echo ""

echo "Check messages list:"
echo "  document.getElementById('messagesList')"
echo ""

echo -e "${BLUE}Expected Console Output:${NC}"
echo ""
echo "On successful load:"
echo "  ✓ === AUTO-SELECTING GROUP ==="
echo "  ✓ Step 1: Switching to groups tab"
echo "  ✓ Step 2: Tab switch complete"
echo "  ✓ Step 3: Group selection complete"
echo "  ✓ Posts length: X"
echo "  ✓ Rendering X messages"
echo "  ✓ Group is selected (ID: X), NOT clearing center content"
echo ""

echo -e "${GREEN}Ready to test!${NC}"
echo ""
echo "Open browser console (F12) and navigate to:"
echo "http://localhost:3000/community.html?id=1"
echo ""
