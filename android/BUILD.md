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
Capacitor injects no bridge into this page, so it can't ask for the server url; `cap sync` runs `scripts/inline-server-url.mjs` (the `capacitor:copy:after` npm script), which writes `CAP_SERVER_URL` into the copied page. Always sync with `CAP_SERVER_URL` set.

## Debugging photo uploads
With `NEXT_PUBLIC_SENTRY_DSN` set at build time, failed uploads already reach Sentry on their own: each `PhotoUploadError` (HTTP status, `no response`, `timed out` or `empty file`) carries `photo-upload` breadcrumbs (picker opened, files picked, upload started/finished, with sizes and timings). A `Photo picker result lost` warning means the camera was opened but the app reloaded before the photo came back (Android closed it while the camera was in front).

To watch a failure live:
- **WebView console and network:** turn on USB debugging on the phone, plug it in and open `chrome://inspect/#devices` in desktop Chrome. Debug APKs can be inspected; the Network tab shows whether `/api/upload` was sent, how long it took and its status. Chrome on Android shows up the same way.
- **Native log:** `adb logcat -v time | grep -iE "Capacitor|chromium|ActivityManager|lowmemorykiller"`. A `Killing ... com.homedesign.app` line while the camera is open confirms the app was closed in the background.
- **Server:** every upload writes one `{"event":"upload","status":...,"contentLengthKB":...,"ms":...}` line to the Render logs.
- **Reproduce a lost camera result:** Developer options > *Don't keep activities*, then take a photo; the app reloads and shows "Your last photo didn't come through".

## Install
```
adb install -r app-debug.apk
```

## Release signing
Release keystores (`*.jks`, `*.keystore`) and `keystore.properties` live outside the repo and are git-ignored. Never commit them.
