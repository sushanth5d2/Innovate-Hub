# iOS Build Instructions

## Prerequisites
- Mac computer (required for iOS builds)
- Xcode 14 or later
- Apple Developer Account ($99/year)
- CocoaPods installed

## Steps to Build IPA

### 1. Install CocoaPods (if not installed)
```bash
sudo gem install cocoapods
```

### 2. Add iOS Platform
```bash
cd /workspaces/Innovate-Hub
npx cap add ios
npx cap sync ios
```

### 3. Open Project in Xcode
```bash
npx cap open ios
```

### 4. Configure Signing & Capabilities

In Xcode:
1. Select project in navigator
2. Select "App" target
3. Go to "Signing & Capabilities"
4. Select your Team (Apple Developer Account)
5. Xcode will auto-create provisioning profile
6. Change Bundle Identifier if needed: `com.innovatehub.app`

### 5. Configure App Info

Edit `ios/App/App/Info.plist`:
- Add privacy descriptions for camera, photos, location, etc.
- Configure URL schemes
- Set supported orientations

### 6. Build for Testing

In Xcode:
1. Select "Any iOS Device" as destination
2. Product -> Archive
3. Wait for build to complete
4. Distribute App -> Development
5. Export IPA for testing

### 7. Build for App Store

1. Product -> Archive
2. Distribute App -> App Store Connect
3. Upload to App Store Connect

## Publish to Apple App Store

### 1. App Store Connect Setup
- Go to https://appstoreconnect.apple.com
- Click "+" to create new app
- Fill in app information:
  - Platform: iOS
  - Name: Innovate Hub
  - Primary Language: English
  - Bundle ID: com.innovatehub.app
  - SKU: innovatehub001

### 2. App Information
Required details:
- Privacy Policy URL
- Category: Social Networking
- Content Rights
- Age Rating

### 3. Prepare Assets

Screenshots (required for each device type):
- iPhone 6.7": 1290 x 2796 px (3 required)
- iPhone 6.5": 1242 x 2688 px (3 required)
- iPhone 5.5": 1242 x 2208 px (optional)
- iPad Pro 12.9": 2048 x 2732 px (2 required)

App Icon:
- 1024 x 1024 px PNG (no transparency)

Preview Videos (optional):
- Up to 3 per device type
- 15-30 seconds each

### 4. App Store Listing

- App name: Innovate Hub
- Subtitle: Connect, Share, Innovate
- Description: Full description of features
- Keywords: social, networking, community, events
- Support URL: Your support website
- Marketing URL: Your marketing site (optional)
- Promotional text: Highlight new features

### 5. Pricing & Availability
- Price: Free
- Availability: All countries
- Pre-order: Optional

### 6. App Privacy
Fill out privacy questionnaire:
- Data collection practices
- Data usage
- Data linking
- Tracking status

### 7. Upload Build
1. Go to "TestFlight" tab
2. Upload build via Xcode
3. Wait for processing (10-30 minutes)
4. Add build to version
5. Complete export compliance questions

### 8. Submit for Review
1. Add release notes
2. Add screenshots for all sizes
3. Complete all required fields
4. Submit for review

### 9. Review Process
- Apple reviews app (1-7 days typically)
- May request additional info
- App goes live once approved
- Can enable "Auto-release" or manual release

## TestFlight (Beta Testing)

### Internal Testing
- Add up to 100 internal testers
- No review required
- Instant access to builds

### External Testing
- Add up to 10,000 external testers
- Requires beta app review
- Share public link or invite by email

## Version Updates

When releasing updates:

1. Update version in Xcode:
   - Select project -> General
   - Increment Version (e.g., 1.1.0)
   - Increment Build number (e.g., 2)

2. Archive and upload new build
3. Create new version in App Store Connect
4. Add "What's New" notes
5. Submit for review

## Code Signing

### Development Certificate
```bash
# In Xcode
# Xcode -> Preferences -> Accounts
# Select team -> Manage Certificates
# Click "+" -> Apple Development
```

### Distribution Certificate
```bash
# In Xcode
# Xcode -> Preferences -> Accounts
# Select team -> Manage Certificates
# Click "+" -> Apple Distribution
```

## Troubleshooting

### Pod Install Fails
```bash
cd ios/App
pod deintegrate
pod install
```

### Build Fails
```bash
cd ios/App
pod update
```

### Certificate Issues
1. Go to developer.apple.com
2. Certificates, Identifiers & Profiles
3. Revoke problematic certificates
4. Let Xcode auto-create new ones

### Update Capacitor
```bash
npm install @capacitor/ios@latest
npx cap sync ios
```

## Important Notes

1. **Apple Developer Account Required**
   - $99/year subscription
   - Required for App Store submission
   - Required for TestFlight distribution

2. **Mac Required**
   - iOS apps can only be built on macOS
   - Windows/Linux users need:
     - Mac computer
     - Mac in Cloud (MacStadium, AWS EC2 Mac)
     - Cross-platform CI/CD (GitHub Actions, Bitrise)

3. **App Review Guidelines**
   - Follow Apple's guidelines strictly
   - Common rejection reasons:
     - Broken links
     - Missing features
     - Privacy issues
     - Inappropriate content

4. **Build Configuration**
   - Use Release scheme for App Store
   - Use Debug scheme for development
   - Test on real devices before submitting

## Continuous Integration (Optional)

### GitHub Actions for iOS
```yaml
name: iOS Build
on: [push]
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node
        uses: actions/setup-node@v2
      - name: Install dependencies
        run: npm install
      - name: Build iOS
        run: |
          npx cap sync ios
          xcodebuild -workspace ios/App/App.xcworkspace \
                     -scheme App \
                     -destination 'generic/platform=iOS' \
                     -archivePath App.xcarchive \
                     archive
```
