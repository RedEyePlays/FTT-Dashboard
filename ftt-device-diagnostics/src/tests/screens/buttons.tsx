import React from 'react';

import { TestScaffold } from '../../components/TestScaffold';
import type { TestScreenProps } from '../../types';

/**
 * All four physical-button tests are manual on iOS.
 *
 * iOS does NOT deliver hardware volume/side/Home button events or the mute
 * switch state to sandboxed Expo apps (these are reserved by the OS), so full
 * automation is impossible. Each test is a guided physical check with a manual
 * Pass/Fail — the `iosRestriction` note in the registry explains why.
 */

export function VolumeButtonTest({ test, onResult }: TestScreenProps) {
  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Open Control Center or any volume slider so you can see the level on screen.',
        'Press Volume Up several times — the level should rise. Press Volume Down — it should fall.',
        'Confirm both buttons have positive tactile clicks and change the volume. Fail if either is stuck or unresponsive.',
      ]}
    />
  );
}

export function PowerButtonTest({ test, onResult }: TestScreenProps) {
  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Press the Side/Power button once — the display should sleep. Press again — it should wake.',
        'Press and hold to confirm the power-off / Siri prompt appears, then cancel.',
        'Confirm the button clicks firmly and responds every time. Fail if mushy, stuck or unresponsive.',
      ]}
    />
  );
}

export function MuteSwitchTest({ test, onResult }: TestScreenProps) {
  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Flip the Ring/Silent switch (or press the Action button) toward the back — an orange marker shows and a "Silent mode" banner appears.',
        'Flip it back — the banner shows ringer on.',
        'Confirm the switch moves cleanly and toggles state both ways. Fail if loose or non-responsive.',
      ]}
    />
  );
}

export function HomeButtonTest({ test, onResult }: TestScreenProps) {
  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Applies to Touch ID models only — Skip on Face ID (all-screen) devices.',
        'Press the Home button to return to the home screen; double-press for the app switcher.',
        'Confirm a firm click and reliable response every press. Fail if it needs hard presses or misses.',
      ]}
    />
  );
}
