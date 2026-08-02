import type { TestCategory, TestDefinition } from '../types';
import {
  BrightnessTest,
  BurnInTest,
  DeadPixelTest,
  HapticTouchTest,
  TouchGridTest,
} from './screens/display';
import { BackCameraTest, FlashlightTest, FocusTest, FrontCameraTest } from './screens/camera';
import { EarpieceTest, HeadphoneBluetoothTest, MicrophoneTest, SpeakerTest } from './screens/audio';
import { HomeButtonTest, MuteSwitchTest, PowerButtonTest, VolumeButtonTest } from './screens/buttons';
import {
  AccelGyroTest,
  BiometricTest,
  CompassTest,
  ProximityTest,
  TapticTest,
} from './screens/sensors';
import {
  BatteryHealthTest,
  BluetoothTest,
  CellularTest,
  ChargingPortTest,
  WifiTest,
} from './screens/connectivity';

/**
 * The single source of truth for every test. Home, the runner and the report
 * all derive from this list, so adding a test is a one-line change here.
 *
 * `iosRestriction` is set on every test where iOS blocks full automation and a
 * manual confirm is the fallback (Face ID, battery health, cellular, mute
 * switch, proximity, earpiece, etc.).
 */
export const TESTS: TestDefinition[] = [
  // ---------------- Display & Touch ----------------
  {
    id: 'touch-grid',
    title: 'Touchscreen Grid',
    category: 'Display & Touch',
    description: 'Swipe every cell; untouched areas are flagged.',
    autoDetect: true,
    component: TouchGridTest,
  },
  {
    id: 'dead-pixel',
    title: 'Dead Pixel',
    category: 'Display & Touch',
    description: 'Cycle solid R/G/B/white/black for stuck pixels.',
    autoDetect: false,
    component: DeadPixelTest,
  },
  {
    id: 'burn-in',
    title: 'Burn-in / Discoloration',
    category: 'Display & Touch',
    description: 'Grey & colour frames reveal retention or tint.',
    autoDetect: false,
    component: BurnInTest,
  },
  {
    id: 'brightness',
    title: 'Brightness / Auto-Brightness',
    category: 'Display & Touch',
    description: 'Cover the light sensor; watch brightness respond.',
    autoDetect: true,
    component: BrightnessTest,
  },
  {
    id: 'haptic-touch',
    title: '3D / Haptic Touch',
    category: 'Display & Touch',
    description: 'Firm long-press should produce a Taptic pop.',
    autoDetect: false,
    iosRestriction:
      'iOS does not expose touch-force values to third-party apps, so we fire a haptic on long-press and you confirm the response manually.',
    component: HapticTouchTest,
  },

  // ---------------- Camera ----------------
  {
    id: 'front-camera',
    title: 'Front Camera',
    category: 'Camera',
    description: 'Live selfie preview + capture a still.',
    autoDetect: false,
    component: FrontCameraTest,
  },
  {
    id: 'back-camera',
    title: 'Back Camera',
    category: 'Camera',
    description: 'Live rear preview + capture a still.',
    autoDetect: false,
    component: BackCameraTest,
  },
  {
    id: 'flashlight',
    title: 'Flash / Flashlight',
    category: 'Camera',
    description: 'Toggle the rear LED torch on and off.',
    autoDetect: false,
    component: FlashlightTest,
  },
  {
    id: 'focus',
    title: 'Camera Focus',
    category: 'Camera',
    description: 'Confirm the rear camera focuses near and far.',
    autoDetect: false,
    component: FocusTest,
  },

  // ---------------- Audio ----------------
  {
    id: 'speaker',
    title: 'Loudspeaker',
    category: 'Audio',
    description: 'Play a 1 kHz tone through the main speaker.',
    autoDetect: false,
    component: SpeakerTest,
  },
  {
    id: 'earpiece',
    title: 'Earpiece Speaker',
    category: 'Audio',
    description: 'Top receiver, tested during a call.',
    autoDetect: false,
    iosRestriction:
      'iOS only routes audio to the earpiece/receiver during a real call — there is no API to force it — so this is a guided manual check.',
    component: EarpieceTest,
  },
  {
    id: 'microphone',
    title: 'Microphone',
    category: 'Audio',
    description: 'Record a clip and play it back.',
    autoDetect: false,
    component: MicrophoneTest,
  },
  {
    id: 'audio-routing',
    title: 'Headphone / Bluetooth Audio',
    category: 'Audio',
    description: 'Confirm audio routes to wired/BT accessories.',
    autoDetect: false,
    iosRestriction:
      'iOS does not expose the active audio route to Expo, so confirm routing to the connected accessory manually.',
    component: HeadphoneBluetoothTest,
  },

  // ---------------- Buttons & Inputs ----------------
  {
    id: 'volume-buttons',
    title: 'Volume Buttons',
    category: 'Buttons & Inputs',
    description: 'Up/Down should change the on-screen level.',
    autoDetect: false,
    iosRestriction:
      'iOS reserves hardware volume-button events and does not deliver them to sandboxed apps, so this is a manual physical check.',
    component: VolumeButtonTest,
  },
  {
    id: 'power-button',
    title: 'Power / Side Button',
    category: 'Buttons & Inputs',
    description: 'Sleep/wake and power prompt respond.',
    autoDetect: false,
    iosRestriction: 'iOS does not deliver side/power button events to apps — confirm manually.',
    component: PowerButtonTest,
  },
  {
    id: 'mute-switch',
    title: 'Ring / Silent Switch',
    category: 'Buttons & Inputs',
    description: 'Toggle shows the silent-mode banner.',
    autoDetect: false,
    iosRestriction: 'iOS does not expose the mute/Action switch state to Expo apps — confirm manually.',
    component: MuteSwitchTest,
  },
  {
    id: 'home-button',
    title: 'Home Button (Touch ID)',
    category: 'Buttons & Inputs',
    description: 'Older models — click and app switcher.',
    autoDetect: false,
    iosRestriction:
      'The Home button is a hardware control not surfaced to apps; Skip on Face ID devices. Confirm manually on Touch ID models.',
    component: HomeButtonTest,
  },

  // ---------------- Sensors ----------------
  {
    id: 'proximity',
    title: 'Proximity Sensor',
    category: 'Sensors',
    description: 'Screen blanks when covered during a call.',
    autoDetect: false,
    iosRestriction:
      'Proximity monitoring is not exposed to Expo and only engages during a call, so this is a guided manual check.',
    component: ProximityTest,
  },
  {
    id: 'accel-gyro',
    title: 'Accelerometer / Gyroscope',
    category: 'Sensors',
    description: 'Tilt to roll the ball; rotate for the gyro.',
    autoDetect: true,
    component: AccelGyroTest,
  },
  {
    id: 'compass',
    title: 'Compass / Magnetometer',
    category: 'Sensors',
    description: 'Spin around; heading sweeps 0–360°.',
    autoDetect: true,
    component: CompassTest,
  },
  {
    id: 'biometric',
    title: 'Face ID / Touch ID',
    category: 'Sensors',
    description: 'Trigger a real biometric auth prompt.',
    autoDetect: false,
    iosRestriction:
      'iOS never exposes biometric data; we can only trigger an auth prompt and confirm it succeeds for an enrolled user.',
    component: BiometricTest,
  },
  {
    id: 'taptic',
    title: 'Taptic Engine / Vibration',
    category: 'Sensors',
    description: 'Fire each haptic pattern and feel it.',
    autoDetect: false,
    component: TapticTest,
  },

  // ---------------- Connectivity ----------------
  {
    id: 'wifi',
    title: 'Wi-Fi',
    category: 'Connectivity',
    description: 'Detect an active Wi-Fi connection.',
    autoDetect: true,
    component: WifiTest,
  },
  {
    id: 'bluetooth',
    title: 'Bluetooth Pairing',
    category: 'Connectivity',
    description: 'Enable BT and pair an accessory.',
    autoDetect: false,
    iosRestriction:
      'Managed Expo has no Bluetooth scanning API; pairing is verified in iOS Settings and confirmed manually.',
    component: BluetoothTest,
  },
  {
    id: 'cellular',
    title: 'Cellular / SIM',
    category: 'Connectivity',
    description: 'Read network generation & SIM presence.',
    autoDetect: false,
    iosRestriction:
      'Apple hides carrier name on iOS 16+ and restricts SIM data; confirm signal bars and the physical SIM manually. Skip on Wi-Fi-only devices.',
    component: CellularTest,
  },
  {
    id: 'charging-port',
    title: 'Charging Port',
    category: 'Connectivity',
    description: 'Detect charging when plugged in.',
    autoDetect: true,
    component: ChargingPortTest,
  },
  {
    id: 'battery-health',
    title: 'Battery Health',
    category: 'Connectivity',
    description: 'Live level + manual max-capacity entry.',
    autoDetect: false,
    iosRestriction:
      'iOS does not expose maximum capacity / cycle count to apps. Read it from Settings ▸ Battery ▸ Battery Health and enter it manually.',
    component: BatteryHealthTest,
  },
];

export const TOTAL_TESTS = TESTS.length;

export function getTestById(id: string): TestDefinition | undefined {
  return TESTS.find((t) => t.id === id);
}

/** Ordered list of categories as they should appear on Home. */
export const CATEGORY_ORDER: TestCategory[] = [
  'Display & Touch',
  'Camera',
  'Audio',
  'Buttons & Inputs',
  'Sensors',
  'Connectivity',
];

export function testsByCategory(): { category: TestCategory; tests: TestDefinition[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    tests: TESTS.filter((t) => t.category === category),
  }));
}
