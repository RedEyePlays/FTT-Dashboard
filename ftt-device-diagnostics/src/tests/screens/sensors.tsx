import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { TestScaffold } from '../../components/TestScaffold';
import { Button } from '../../components/ui';
import { colors, font, radius, spacing } from '../../theme';
import type { TestScreenProps } from '../../types';

/* ------------------------------------------------------------------ *
 * Proximity sensor — MANUAL (iOS restriction)
 * UIDevice proximity monitoring is not exposed to Expo apps, so we can't
 * read the sensor. It only actually engages during a call.
 * ------------------------------------------------------------------ */
export function ProximityTest({ test, onResult }: TestScreenProps) {
  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'The proximity sensor only activates during a phone/FaceTime call in iOS.',
        'Start a quick call, then cover the top of the screen near the earpiece with your hand.',
        'Confirm the screen blanks when covered and lights back up when uncovered. Fail if it never dims.',
      ]}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Accelerometer / Gyroscope — AUTO-DETECT via live motion.
 * A ball rolls with tilt; rotating/tilting produces motion we detect.
 * ------------------------------------------------------------------ */
export function AccelGyroTest({ test, onResult }: TestScreenProps) {
  const { width } = useWindowDimensions();
  const boxSize = Math.min(width - spacing.lg * 2, 320);
  const ball = 36;

  const [accel, setAccel] = useState({ x: 0, y: 0, z: 0 });
  const [gyro, setGyro] = useState({ x: 0, y: 0, z: 0 });
  const [movedAccel, setMovedAccel] = useState(false);
  const [movedGyro, setMovedGyro] = useState(false);

  useEffect(() => {
    Accelerometer.setUpdateInterval(60);
    Gyroscope.setUpdateInterval(60);
    const a = Accelerometer.addListener((d) => {
      setAccel(d);
      if (Math.abs(d.x) > 0.35 || Math.abs(d.y) > 0.35) setMovedAccel(true);
    });
    const g = Gyroscope.addListener((d) => {
      setGyro(d);
      if (Math.abs(d.x) > 0.8 || Math.abs(d.y) > 0.8 || Math.abs(d.z) > 0.8) setMovedGyro(true);
    });
    return () => {
      a.remove();
      g.remove();
    };
  }, []);

  // Map tilt (accel x/y) to ball position inside the box.
  const range = (boxSize - ball) / 2;
  const bx = range + Math.max(-1, Math.min(1, accel.x)) * range;
  const by = range + Math.max(-1, Math.min(1, -accel.y)) * range;

  const detected = movedAccel && movedGyro;

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Tilt the phone in every direction — the ball should roll toward the low edge.',
        'Then rotate the phone to exercise the gyroscope.',
        'Both auto-detect once they register motion. Fail if the ball never moves or values stay flat.',
      ]}
      passDisabled={!detected}
      passLabel={detected ? '✓ Auto-detected — Pass' : 'Pass'}
      footerNote={
        detected
          ? 'Accelerometer and gyroscope both responded.'
          : `Accel ${movedAccel ? '✓' : '…'}   Gyro ${movedGyro ? '✓' : '…'}`
      }
    >
      <View style={[styles.tiltBox, { width: boxSize, height: boxSize }]}>
        <View
          style={[
            styles.ball,
            { width: ball, height: ball, borderRadius: ball / 2, transform: [{ translateX: bx }, { translateY: by }] },
          ]}
        />
      </View>
      <View style={styles.readouts}>
        <Text style={styles.readout}>
          accel  x {accel.x.toFixed(2)}  y {accel.y.toFixed(2)}  z {accel.z.toFixed(2)}
        </Text>
        <Text style={styles.readout}>
          gyro   x {gyro.x.toFixed(2)}  y {gyro.y.toFixed(2)}  z {gyro.z.toFixed(2)}
        </Text>
      </View>
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * Compass / Magnetometer — AUTO-DETECT via heading change.
 * ------------------------------------------------------------------ */
export function CompassTest({ test, onResult }: TestScreenProps) {
  const [heading, setHeading] = useState(0);
  const seen = useRef<Set<number>>(new Set());
  const [covered, setCovered] = useState(0);

  useEffect(() => {
    Magnetometer.setUpdateInterval(100);
    const sub = Magnetometer.addListener((d) => {
      let angle = Math.atan2(d.y, d.x) * (180 / Math.PI);
      if (angle < 0) angle += 360;
      setHeading(angle);
      const bucket = Math.floor(angle / 45); // 8 buckets
      if (!seen.current.has(bucket)) {
        seen.current.add(bucket);
        setCovered(seen.current.size);
      }
    });
    return () => sub.remove();
  }, []);

  const detected = covered >= 4; // rotated through at least half the compass

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Hold the phone flat and slowly spin around in a full circle.',
        'The heading below should sweep through 0–360°.',
        'Auto-detects once the reading passes through several directions. Fail if it stays frozen or jumps randomly.',
      ]}
      passDisabled={!detected}
      passLabel={detected ? '✓ Auto-detected — Pass' : 'Pass'}
      footerNote={`Directions covered: ${covered}/8`}
    >
      <View style={styles.compassBox}>
        <Text style={styles.compassValue}>{Math.round(heading)}°</Text>
        <Text style={styles.compassLabel}>live heading</Text>
      </View>
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * Face ID / Touch ID — functional check (manual confirm)
 * iOS never reveals biometric templates; we can only trigger an auth
 * prompt and confirm the hardware/enrollment path works.
 * ------------------------------------------------------------------ */
export function BiometricTest({ test, onResult }: TestScreenProps) {
  const [info, setInfo] = useState<string>('Checking hardware…');
  const [authState, setAuthState] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    (async () => {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const names = types.map((t) =>
        t === LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
          ? 'Face ID'
          : t === LocalAuthentication.AuthenticationType.FINGERPRINT
            ? 'Touch ID'
            : 'Iris',
      );
      setInfo(
        `Hardware: ${hasHw ? 'present' : 'none'}\n` +
          `Supports: ${names.join(', ') || 'unknown'}\n` +
          `Enrolled: ${enrolled ? 'yes' : 'no (enroll a face/finger to fully test)'}`,
      );
    })();
  }, []);

  const authenticate = async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Verify Face ID / Touch ID',
      disableDeviceFallback: false,
    });
    setAuthState(res.success ? 'ok' : 'fail');
  };

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'A face/finger must be enrolled in iOS Settings for a full test.',
        'Tap Run biometric prompt and complete Face ID / Touch ID.',
        'Pass if it authenticates successfully; Fail if the sensor never recognizes an enrolled user.',
      ]}
      passDisabled={authState !== 'ok'}
      footerNote={
        authState === 'ok'
          ? 'Biometric authentication succeeded.'
          : authState === 'fail'
            ? 'Authentication did not succeed — retry or Fail.'
            : undefined
      }
    >
      <View style={styles.bioBox}>
        <Text style={styles.bioInfo}>{info}</Text>
        <Button label="Run biometric prompt" variant="primary" onPress={authenticate} />
      </View>
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * Taptic engine / vibration — fires each haptic pattern for confirm.
 * ------------------------------------------------------------------ */
export function TapticTest({ test, onResult }: TestScreenProps) {
  const [fired, setFired] = useState(false);

  const fire = (fn: () => Promise<void>) => {
    fn();
    setFired(true);
  };

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Tap each button and confirm you feel a distinct vibration from the Taptic Engine.',
        'Pass if all patterns are felt clearly. Fail if there is no vibration or only a weak buzz/rattle.',
      ]}
      passDisabled={!fired}
    >
      <View style={styles.tapticGrid}>
        <Button label="Light" variant="neutral" onPress={() => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light))} style={styles.tapticBtn} />
        <Button label="Medium" variant="neutral" onPress={() => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium))} style={styles.tapticBtn} />
        <Button label="Heavy" variant="neutral" onPress={() => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy))} style={styles.tapticBtn} />
        <Button label="Success" variant="neutral" onPress={() => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))} style={styles.tapticBtn} />
        <Button label="Warning" variant="neutral" onPress={() => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning))} style={styles.tapticBtn} />
        <Button label="Error" variant="neutral" onPress={() => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error))} style={styles.tapticBtn} />
      </View>
    </TestScaffold>
  );
}

const styles = StyleSheet.create({
  tiltBox: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  ball: { backgroundColor: colors.primary, position: 'absolute', top: 0, left: 0 },
  readouts: { marginTop: spacing.md, gap: 4 },
  readout: { color: colors.textDim, fontSize: font.small, fontFamily: 'Courier', textAlign: 'center' },
  compassBox: {
    marginTop: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  compassValue: { color: colors.text, fontSize: 64, fontWeight: '900' },
  compassLabel: { color: colors.textDim, fontSize: font.small, textTransform: 'uppercase', letterSpacing: 1 },
  bioBox: { marginTop: spacing.lg, gap: spacing.lg },
  bioInfo: {
    color: colors.text,
    fontSize: font.body,
    lineHeight: 22,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  tapticGrid: { marginTop: spacing.lg, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tapticBtn: { width: '48%' },
});
