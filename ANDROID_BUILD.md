# Android Build Instructions

## Prerequisites
- Android Studio (latest version)
- Java JDK 17 or higher
- Android SDK with API 33+

## Steps to Build APK/AAB

### 1. Open Project in Android Studio
```bash
cd /workspaces/Innovate-Hub
npx cap open android
```

### 2. Generate Signing Key (First Time Only)
```bash
keytool -genkey -v -keystore innovate-release-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias innovate-key
```

Save the keystore file and remember the passwords!

### 3. Configure Signing in build.gradle
Edit `android/app/build.gradle` and add:

```gradle
android {
    ...
    signingConfigs {
        release {
            storeFile file('path/to/innovate-release-key.jks')
            storePassword 'your-store-password'
            keyAlias 'innovate-key'
            keyPassword 'your-key-password'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 4. Build APK (for testing)
```bash
cd android
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

### 5. Build AAB (for Play Store)
```bash
cd android
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

## Publish to Google Play Store

### 1. Create Developer Account
- Go to https://play.google.com/console
- Pay $25 one-time registration fee
- Complete account setup

### 2. Create App Listing
- Click "Create app"
- Fill in app details:
  - App name: Innovate Hub
  - Default language: English
  - App/Game: App
  - Free/Paid: Free

### 3. Complete Store Listing
Required information:
- Short description (80 chars max)
- Full description (4000 chars max)
- App icon: 512x512 PNG
- Feature graphic: 1024x500 PNG
- Screenshots: At least 2 (phone, tablet)
- Privacy policy URL
- Contact email

### 4. Content Rating
- Complete questionnaire
- Get rating (Everyone, Teen, etc.)

### 5. Pricing & Distribution
- Select countries
- Set pricing (Free)
- Accept content guidelines

### 6. Upload App Bundle
- Go to "Production" -> "Create new release"
- Upload AAB file
- Add release notes
- Review and publish

### 7. Review Process
- Google reviews app (1-7 days)
- Fix any issues if rejected
- App goes live once approved

## Version Updates
When releasing updates:

1. Update version in `android/app/build.gradle`:
```gradle
android {
    defaultConfig {
        versionCode 2  // Increment by 1
        versionName "1.1.0"  // Update version
    }
}
```

2. Rebuild AAB and upload to Play Console
3. Add release notes describing changes

## Testing
- Use internal testing track first
- Add testers via email
- Test thoroughly before production release
- Use closed/open testing for beta releases

## Troubleshooting

### Build Fails
```bash
cd android
./gradlew clean
./gradlew assembleDebug
```

### Update Dependencies
```bash
cd /workspaces/Innovate-Hub
npx cap sync android
```

### Clear Cache
```bash
cd android
./gradlew clean build --refresh-dependencies
```
