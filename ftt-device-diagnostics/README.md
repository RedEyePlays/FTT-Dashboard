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
