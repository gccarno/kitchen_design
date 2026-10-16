# Android build

The app is a Capacitor shell around the hosted site (`CAP_SERVER_URL`). No JDK is needed to edit; building needs JDK 21 and the Android SDK.

## CI (recommended)
The `android` GitHub Actions workflow builds a debug APK. Set the repository variable `CAP_SERVER_URL` (e.g. `https://app.example.com`), run the workflow (Actions > android > Run workflow) and download the `app-debug-apk` artifact.

## Local build
```
CAP_SERVER_URL=https://app.example.com CAP_REQUIRE_URL=1 npx cap sync android
cd android && ./gradlew assembleDebug
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
For LAN dev use `http://<lan-ip>:3000` (cleartext is enabled automatically for `http://` URLs).

## Errors inside the app
Capacitor's `errorPath` (`offline.html`) also shows for main-frame HTTP errors (404, 500, 401 pages), not only network failures. The page then retries the server root every 5 s, so a deep link that errors bounces to `/`.

## Install
```
adb install -r app-debug.apk
```

## Release signing
Release keystores (`*.jks`, `*.keystore`) and `keystore.properties` live outside the repo and are git-ignored. Never commit them.
