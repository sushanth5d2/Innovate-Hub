#!/bin/bash

echo "Starting Innovate Hub ML Service..."

# Navigate to ml-service directory
cd "$(dirname "$0")/ml-service"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Start the Flask application
echo "Starting ML service on port 5000..."
python app.py
