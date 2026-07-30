# Venn Android TWA

This directory contains Venn's Android Trusted Web Activity wrapper. It opens
the production web app and adds a native **Search Venn** Quick Settings tile
that launches `https://venn-roan.vercel.app/search`.

The initial project was generated with Bubblewrap, but it is maintained as a
normal Android project now. Do not run `bubblewrap update`: it can overwrite
the custom tile and launcher code.

## Prerequisites

- JDK 17
- Android SDK Platform 37.0 and SDK Build Tools 36.0.0 or newer
- The release key and password, stored outside this repository

The build looks for these defaults:

```text
~/.config/venn/android-release.jks
~/.config/venn/android-release.password
```

They can be overridden with:

```text
VENN_ANDROID_SIGNING_DIR
VENN_ANDROID_KEYSTORE_PATH
VENN_ANDROID_KEYSTORE_PASSWORD_FILE
VENN_ANDROID_KEYSTORE_PASSWORD
VENN_ANDROID_KEY_ALIAS
VENN_ANDROID_KEY_PASSWORD
```

Back up the keystore and password securely. Every update must use this same
key; losing it means existing installations cannot be upgraded.

## Build

From this directory:

```bash
./gradlew lintRelease assembleRelease
```

The signed APK is written to:

```text
app/build/outputs/apk/release/app-release.apk
```

The production site must deploy `/.well-known/assetlinks.json` before the APK
is installed. Without that association, Android opens the site as a Custom
Tab instead of a verified full-screen TWA.

## Install and add the tile

Share the signed APK privately. On first install, each friend may need to
allow their browser or file manager to install unknown apps.

- Android 13 and newer: launch Venn once. Android shows a one-time system
  prompt to add **Search Venn**. Accepting or declining continues into Venn.
- Android 7 through 12: open Quick Settings, choose Edit, and drag **Search
  Venn** into the active tiles.
- If the Android 13+ prompt was declined, open Venn Settings and choose
  **Add Quick Settings tile** under Quick access. That option remains
  available if the tile is removed later.
- If the setup button cannot open the native prompt, update to Venn Android
  v1.0.1 or newer and use the manual Edit flow as a fallback.

The tile opens the existing `/search` experience, so authentication, search,
and adding a title to the personal list remain web features.

For a connected device, install or upgrade from a workstation with:

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

## Updates

Web-only changes are deployed through Vercel and appear inside the installed
TWA without rebuilding the APK.

For changes under `android/`:

1. Increase `versionCode` and `versionName` in `app/build.gradle`.
2. Keep `applicationId` and the signing key unchanged.
3. Build and share the new signed APK.
4. Friends open the APK to update in place, or use `adb install -r`.

If the signing certificate changes intentionally, update both
`public/.well-known/assetlinks.json` and `twa-manifest.json`, deploy the site,
and understand that the differently signed APK cannot update existing
installations.
