# FTT Device Diagnostics

A React Native (Expo) iOS app for testing used / trade-in iPhones before
resale. Techs run a checklist of hardware tests, mark each Pass / Fail / Skip,
and export a per-device report. Built to be run **dozens of times a day** — dark
UI, big tap targets, minimal taps per test.

## Features

- **Home screen** — every test grouped by category with a live status icon
  (untested ○ / pass ✓ / fail ✕ / skip), a progress bar and pass/fail counts.
- **One screen per test** — clear instructions, live test UI, and Pass / Fail /
  Skip. Some tests **auto-detect** (touch grid, brightness, accelerometer,
  gyroscope, compass, Wi-Fi, charging); the rest are guided manual confirms.
- **New Device Test** — resets all results to start a fresh device.
- **Report screen** — every test + result, pass count, timestamp, and:
  - **Save Report** — stored locally as JSON via AsyncStorage.
  - **Share PDF** / **Print** (AirPrint) via `expo-print`.
  - **Export JSON** via `expo-sharing`.
- **Saved reports** — browse, re-open, re-share, or delete past reports.

## Tests

| Category | Tests |
| --- | --- |
| Display & Touch | Touchscreen grid, dead pixel, burn-in/discoloration, brightness/auto-brightness, 3D/Haptic Touch |
| Camera | Front camera, back camera, flash/flashlight, focus |
| Audio | Loudspeaker, earpiece, microphone (record + playback), headphone/Bluetooth routing |
| Buttons & Inputs | Volume, power/side, ring/silent switch, Home (Touch ID) |
| Sensors | Proximity, accelerometer/gyroscope, compass/magnetometer, Face ID/Touch ID, Taptic engine |
| Connectivity | Wi-Fi, Bluetooth pairing, cellular/SIM, charging port, battery health |

## iOS automation limits (flagged in-app)

iOS sandboxes several things away from third-party apps. Every affected test
carries an **iosRestriction** note in `src/tests/registry.ts` and shows a
"⚠︎ iOS limitation — manual confirm" banner in the UI, so the tech knows *why*
they're confirming by hand:

- **Face ID / Touch ID** — biometric data is never exposed; we can only trigger
  an auth prompt and confirm success.
- **Battery health** — max capacity / cycle count aren't available; live charge
  level is shown and the tech keys in the % from Settings.
- **Cellular / SIM** — carrier name is hidden on iOS 16+; signal & SIM confirmed
  manually.
- **Volume / power / Home buttons & mute switch** — hardware button events and
  switch state aren't delivered to apps.
- **Proximity & earpiece** — only engage during a real call.
- **3D/Haptic Touch** — touch-force values aren't exposed.
- **Bluetooth pairing** — no scanning API in managed Expo; verified in Settings.
- **Headphone/BT routing** — active audio route isn't exposed.

## Expo modules used

`expo-camera`, `expo-av`, `expo-sensors`, `expo-battery`, `expo-brightness`,
`expo-haptics`, `expo-local-authentication`, `expo-network`, `expo-cellular`,
`expo-print`, `expo-sharing`, `expo-file-system`, plus
`@react-native-async-storage/async-storage` and React Navigation.

## Run / build

```bash
cd ftt-device-diagnostics
npm install
npx expo start            # dev (Expo Go covers most; use a dev build for camera/torch/biometrics)
npm run typecheck         # tsc --noEmit
```

### EAS Build (no Mac required)

`eas.json` defines `development`, `preview` and `production` iOS profiles.

```bash
npm i -g eas-cli
eas login
eas build --platform ios --profile preview     # internal-distribution build
eas build --platform ios --profile production   # store build
```

Camera, torch, microphone, sensors and biometrics need a **real device** (or an
EAS dev/preview build) — they don't work in the iOS simulator.

### Local native build on a Mac with a free (personal-team) Apple ID

Bundle id: **`com.flipthattech.devicediagnostics`**.

```bash
cd ftt-device-diagnostics
npm install
npx expo prebuild --platform ios     # generates the native ios/ project (regenerable; gitignored)
npx expo run:ios --device            # builds, installs to a USB iPhone, runs pod install for you
```

Prefer Xcode directly? After `prebuild`, run `pod install` in `ios/`, then open
`ios/FTTDeviceDiagnostics.xcworkspace`, select the target ▸ **Signing &
Capabilities**, tick **Automatically manage signing**, and pick your personal
team. Then Product ▸ Run to your connected iPhone.

**Command-line build check** (does not install, just verifies it compiles):

```bash
cd ios && pod install && cd ..
xcodebuild -workspace ios/FTTDeviceDiagnostics.xcworkspace \
  -scheme FTTDeviceDiagnostics -configuration Debug \
  -sdk iphoneos -destination generic/platform=iOS \
  DEVELOPMENT_TEAM=YOUR_TEAM_ID -allowProvisioningUpdates build
```

#### Free-account signing — verified compatible

The prebuilt project is already set up for a personal team:

- **Automatic signing** (no `CODE_SIGN_STYLE = Manual`, no `ProvisioningStyle`
  override) — you just pick your Apple ID team in Xcode.
- **No `DEVELOPMENT_TEAM` or `PROVISIONING_PROFILE` pinned** — nothing to unset.
- The **`.entitlements` file is empty** (`<dict/>`) — no push, App Groups,
  Associated Domains, iCloud, HealthKit, Apple Pay or other paid-only
  capabilities are referenced anywhere.
- All device access is via **Info.plist privacy strings** (camera, mic, motion,
  Face ID, location) — none require an entitlement or a paid account.

**Every test in this app runs on a free personal team.** Nothing here needs a
paid capability.

#### Free-account limitations to expect (general, not test-specific)

- Provisioning profiles from a free Apple ID **expire after 7 days** — the app
  stops launching and must be rebuilt/reinstalled from Xcode. (A paid account
  gives a 1-year profile.)
- Max **3 sideloaded apps** installed per device, and **10 new App IDs per 7
  days**.
- First launch: trust the developer on the phone at **Settings ▸ General ▸ VPN &
  Device Management ▸ (your Apple ID) ▸ Trust**.
- No TestFlight / OTA distribution on a free account — install over USB from
  Xcode.

## Architecture

- `src/tests/registry.ts` — single source of truth. Each entry has an `id`,
  category, `autoDetect` flag, optional `iosRestriction`, and its screen
  `component`. Add a test by adding one entry.
- `src/context/ResultsContext.tsx` — in-memory results for the device under
  test + `resetAll` for "New Device Test".
- `src/storage/reports.ts` — AsyncStorage persistence of saved reports (JSON).
- `src/screens/` — Home, TestRunner (dispatcher), Summary, Reports, ReportDetail.
- `src/tests/screens/` — the individual test UIs, grouped by category.
- `src/utils/` — runtime tone generator (`tone.ts`) and report HTML/PDF/JSON
  export (`exportReport.ts`).
