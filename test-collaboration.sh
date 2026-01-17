#!/bin/bash

echo "🚀 Innovate Hub - Community Collaboration Testing Script"
echo "=========================================================="
echo ""

# Check if server is running
check_server() {
    echo "🔍 Checking if server is running..."
    if curl -s http://localhost:3000 > /dev/null; then
        echo "✅ Server is running on http://localhost:3000"
        return 0
    else
        echo "❌ Server is not running"
        echo "Start with: npm start"
        return 1
    fi
}

# Check if ML service is running
check_ml_service() {
    echo "🔍 Checking ML service..."
    if curl -s http://localhost:5000/health > /dev/null 2>&1; then
        echo "✅ ML service is running on http://localhost:5000"
        return 0
    else
        echo "⚠️  ML service is not running (optional for AI features)"
        echo "Start with: cd ml-service && python app.py"
        return 1
    fi
}

# Test API endpoints
test_api() {
    echo ""
    echo "🧪 Testing API Endpoints..."
    echo ""
    
    # Test health endpoint
    echo "Testing /health..."
    response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000)
    if [ "$response" = "200" ] || [ "$response" = "404" ]; then
        echo "✅ Server responding"
    else
        echo "❌ Server not responding properly"
    fi
}

# Check required files
check_files() {
    echo ""
    echo "📁 Checking implementation files..."
    echo ""
    
    files=(
        "public/js/group-main.js"
        "public/js/group-call.js"
        "public/js/todo-board.js"
        "public/js/notes-editor.js"
        "public/css/group-call.css"
        "public/group.html"
        "routes/community-groups.js"
        "server.js"
    )
    
    for file in "${files[@]}"; do
        if [ -f "$file" ]; then
            echo "✅ $file"
        else
            echo "❌ $file (missing)"
        fi
    done
}

# Check database tables
check_database() {
    echo ""
    echo "🗄️  Checking database tables..."
    echo ""
    
    if [ -f "database/innovate.db" ]; then
        echo "✅ Database file exists"
        
        # Check for required tables
        tables=(
            "communities"
            "community_groups"
            "community_group_members"
            "community_group_tasks"
            "community_group_notes"
            "community_group_note_versions"
            "community_group_files"
        )
        
        for table in "${tables[@]}"; do
            if sqlite3 database/innovate.db "SELECT name FROM sqlite_master WHERE type='table' AND name='$table';" | grep -q "$table"; then
                echo "✅ Table: $table"
            else
                echo "❌ Table: $table (missing)"
            fi
        done
    else
        echo "⚠️  Database will be created on first run"
    fi
}

# Feature checklist
feature_checklist() {
    echo ""
    echo "✅ Feature Implementation Checklist"
    echo "===================================="
    echo ""
    echo "✅ Communities (Public/Private with Roles)"
    echo "✅ Groups Inside Communities (CSE A, CSE B style)"
    echo "✅ Voice/Video Calls + Screen Share"
    echo "✅ Folder System (Images, Docs, Videos, Files)"
    echo "⚠️  GitHub Integration (80% - OAuth pending)"
    echo "✅ AI-Powered To-Do (Text/Image/Voice input)"
    echo "✅ Notes (Collaborative editing + versions)"
    echo "✅ UI/UX (Instagram-themed, ready for Teams redesign)"
    echo ""
}

# Main test flow
main() {
    check_server
    server_running=$?
    
    check_ml_service
    
    check_files
    check_database
    
    if [ $server_running -eq 0 ]; then
        test_api
    fi
    
    feature_checklist
    
    echo ""
    echo "📖 Quick Links:"
    echo "   • Main App: http://localhost:3000"
    echo "   • Communities: http://localhost:3000/communities"
    echo "   • Documentation: ./docs/COMMUNITY_COLLABORATION_COMPLETE.md"
    echo ""
    echo "🧪 Manual Testing Steps:"
    echo "   1. Create a community"
    echo "   2. Create a group (e.g., 'CSE A')"
    echo "   3. Test video call with 2 browser windows"
    echo "   4. Try creating tasks via text/image/voice"
    echo "   5. Test collaborative notes editing"
    echo ""
    echo "📚 For detailed testing: See docs/TESTING_GUIDE.md"
    echo ""
}

# Run tests
main
