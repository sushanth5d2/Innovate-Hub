#!/bin/bash

# Create app icons directory
mkdir -p /workspaces/Innovate-Hub/public/images

# Icon sizes needed for Android and iOS
declare -a sizes=("72" "96" "128" "144" "152" "192" "384" "512")

# Create SVG base icon
cat > /tmp/icon.svg << 'EOF'
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#833AB4;stop-opacity:1" />
      <stop offset="50%" style="stop-color:#FD1D1D;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#F77737;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="115" fill="url(#grad)"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="280" font-weight="bold" 
        fill="white" text-anchor="middle" dominant-baseline="central">i</text>
</svg>
EOF

# Check if ImageMagick is available
if command -v convert &> /dev/null; then
    # Generate PNG icons using ImageMagick
    for size in "${sizes[@]}"; do
        convert -background none -resize ${size}x${size} /tmp/icon.svg \
                /workspaces/Innovate-Hub/public/images/icon-${size}x${size}.png
        echo "✓ Generated icon-${size}x${size}.png"
    done
else
    echo "ImageMagick not found. Creating placeholder icons..."
    # Create simple placeholder PNGs
    for size in "${sizes[@]}"; do
        cat > /tmp/icon-${size}.svg << EOF
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#833AB4;stop-opacity:1" />
      <stop offset="50%" style="stop-color:#FD1D1D;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#F77737;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="$((size/5))" fill="url(#grad)"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="$((size/2))" font-weight="bold" 
        fill="white" text-anchor="middle" dominant-baseline="central">i</text>
</svg>
EOF
        cp /tmp/icon-${size}.svg /workspaces/Innovate-Hub/public/images/icon-${size}x${size}.png
        echo "✓ Created placeholder icon-${size}x${size}.png (SVG)"
    done
fi

echo ""
echo "✓ All app icons generated successfully!"
echo "  Location: /workspaces/Innovate-Hub/public/images/"
