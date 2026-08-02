import * as Brightness from 'expo-brightness';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutRectangle,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TestScaffold } from '../../components/TestScaffold';
import { Button } from '../../components/ui';
import { colors, font, radius, spacing } from '../../theme';
import type { TestScreenProps } from '../../types';

/* ------------------------------------------------------------------ *
 * Touchscreen grid test — AUTO-DETECT
 * Screen is divided into cells. The tech swipes across every cell; any
 * cell never touched is flagged red. Auto-passes once 100% are covered.
 * ------------------------------------------------------------------ */
export function TouchGridTest({ test, onResult }: TestScreenProps) {
  const { width, height } = useWindowDimensions();
  const COLS = 6;
  const ROWS = Math.round((height / width) * COLS); // keep cells roughly square
  const total = COLS * ROWS;

  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [started, setStarted] = useState(false);
  const gridLayout = useRef<LayoutRectangle | null>(null);

  const markFromXY = (x: number, y: number) => {
    const l = gridLayout.current;
    if (!l) return;
    const col = Math.floor((x / l.width) * COLS);
    const row = Math.floor((y / l.height) * ROWS);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    const idx = row * COLS + col;
    setTouched((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };

  const covered = touched.size;
  const complete = covered >= total;

  useEffect(() => {
    if (complete) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [complete]);

  if (!started) {
    return (
      <TestScaffold
        test={test}
        onResult={onResult}
        instructions={[
          'Tap Start, then drag one finger slowly across every part of the screen.',
          'Cells you touch turn green. Any cell that stays dark means the digitizer missed a touch there.',
          'The test auto-passes when all cells are covered. Use Fail if any area never responds.',
        ]}
        passLabel="Start manually as Pass"
      >
        <Button label="Start touch test" variant="primary" onPress={() => setStarted(true)} />
      </TestScaffold>
    );
  }

  return (
    <SafeAreaView style={styles.fsSafe} edges={['top', 'bottom']}>
      <View style={styles.touchHeader}>
        <Text style={styles.touchStat}>
          {covered}/{total} cells
        </Text>
        <View style={styles.touchHeaderBtns}>
          <Button label="Reset" variant="neutral" onPress={() => setTouched(new Set())} style={styles.smallBtn} />
          <Button label="Fail" variant="fail" onPress={() => onResult('fail')} style={styles.smallBtn} />
        </View>
      </View>

      <View
        style={styles.grid}
        onLayout={(e) => (gridLayout.current = e.nativeEvent.layout)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => markFromXY(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        onResponderMove={(e) => markFromXY(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      >
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={{
              width: `${100 / COLS}%`,
              height: `${100 / ROWS}%`,
              backgroundColor: touched.has(i) ? colors.pass : colors.surfaceAlt,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.bg,
            }}
          />
        ))}
      </View>

      <View style={styles.touchFooter}>
        {complete ? (
          <Button label="✓ All cells covered — Pass" variant="pass" onPress={() => onResult('pass')} />
        ) : (
          <Text style={styles.touchHint}>Keep dragging over the dark cells…</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ *
 * Dead pixel test — MANUAL confirm
 * Full-screen solid colours; tap to cycle. Tech looks for stuck pixels.
 * ------------------------------------------------------------------ */
const DEAD_PIXEL_COLORS = [
  { name: 'Red', value: '#FF0000' },
  { name: 'Green', value: '#00FF00' },
  { name: 'Blue', value: '#0000FF' },
  { name: 'White', value: '#FFFFFF' },
  { name: 'Black', value: '#000000' },
];

export function DeadPixelTest({ test, onResult }: TestScreenProps) {
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);

  if (!started) {
    return (
      <TestScaffold
        test={test}
        onResult={onResult}
        instructions={[
          'The screen will fill with solid Red, Green, Blue, White then Black.',
          'Tap anywhere to advance to the next colour.',
          'Watch for any dots that stay the wrong colour (dead / stuck pixels) or uneven patches.',
          'After the last colour, choose Pass or Fail.',
        ]}
        passLabel="Start"
      >
        <Button label="Start colour cycle" variant="primary" onPress={() => setStarted(true)} />
      </TestScaffold>
    );
  }

  const current = DEAD_PIXEL_COLORS[idx];
  const last = idx === DEAD_PIXEL_COLORS.length - 1;
  const dark = current.value === '#FFFFFF';

  return (
    <Pressable
      style={[styles.fullscreen, { backgroundColor: current.value }]}
      onPress={() => !last && setIdx((i) => i + 1)}
    >
      <SafeAreaView style={styles.overlaySafe} pointerEvents="box-none">
        <Text style={[styles.overlayLabel, { color: dark ? '#000' : '#fff' }]}>
          {current.name} ({idx + 1}/{DEAD_PIXEL_COLORS.length})
        </Text>
        {last ? (
          <View style={styles.overlayBtns}>
            <Button label="Fail" variant="fail" onPress={() => onResult('fail')} style={styles.smallBtn} />
            <Button label="Pass" variant="pass" onPress={() => onResult('pass')} style={styles.smallBtn} />
          </View>
        ) : (
          <Text style={[styles.overlayHint, { color: dark ? '#000' : '#fff' }]}>Tap to advance</Text>
        )}
      </SafeAreaView>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * Burn-in / discoloration — MANUAL confirm
 * Grey levels + primaries reveal image retention / tint.
 * ------------------------------------------------------------------ */
const BURN_IN_COLORS = ['#808080', '#C0C0C0', '#404040', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF'];

export function BurnInTest({ test, onResult }: TestScreenProps) {
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);

  if (!started) {
    return (
      <TestScaffold
        test={test}
        onResult={onResult}
        instructions={[
          'The screen will cycle through several grey levels and solid colours.',
          'Tap to advance. Look for faint ghost images (burn-in), pink/green tint, or uneven brightness — most visible on the grey and white frames.',
          'Choose Pass if the panel is uniform, Fail if you see retention or discoloration.',
        ]}
        passLabel="Start"
      >
        <Button label="Start visual check" variant="primary" onPress={() => setStarted(true)} />
      </TestScaffold>
    );
  }

  const color = BURN_IN_COLORS[idx];
  const last = idx === BURN_IN_COLORS.length - 1;
  const darkText = ['#C0C0C0', '#FFFFFF', '#00FF00'].includes(color);

  return (
    <Pressable style={[styles.fullscreen, { backgroundColor: color }]} onPress={() => !last && setIdx((i) => i + 1)}>
      <SafeAreaView style={styles.overlaySafe} pointerEvents="box-none">
        <Text style={[styles.overlayLabel, { color: darkText ? '#000' : '#fff' }]}>
          Frame {idx + 1}/{BURN_IN_COLORS.length}
        </Text>
        {last ? (
          <View style={styles.overlayBtns}>
            <Button label="Fail" variant="fail" onPress={() => onResult('fail')} style={styles.smallBtn} />
            <Button label="Pass" variant="pass" onPress={() => onResult('pass')} style={styles.smallBtn} />
          </View>
        ) : (
          <Text style={[styles.overlayHint, { color: darkText ? '#000' : '#fff' }]}>Tap to advance</Text>
        )}
      </SafeAreaView>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * Brightness / auto-brightness — AUTO-DETECT (with manual fallback)
 * Reads the live system brightness. With auto-brightness enabled, covering
 * the ambient-light sensor should change the value. We detect that swing.
 * ------------------------------------------------------------------ */
export function BrightnessTest({ test, onResult }: TestScreenProps) {
  const [current, setCurrent] = useState<number | null>(null);
  const [min, setMin] = useState<number | null>(null);
  const [max, setMax] = useState<number | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const perm = await Brightness.requestPermissionsAsync();
      if (!mounted) return;
      setPermission(perm.granted);
    })();
    const interval = setInterval(async () => {
      try {
        const b = await Brightness.getSystemBrightnessAsync();
        if (!mounted) return;
        setCurrent(b);
        setMin((m) => (m === null ? b : Math.min(m, b)));
        setMax((m) => (m === null ? b : Math.max(m, b)));
      } catch {
        /* ignore transient read errors */
      }
    }, 300);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const swing = min !== null && max !== null ? max - min : 0;
  const detected = swing >= 0.15; // ~15% change indicates the sensor is driving brightness

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Make sure Auto-Brightness is ON in iOS Settings ▸ Accessibility ▸ Display & Text Size.',
        'Cover the ambient-light sensor (top of the screen) with your hand, then move to a bright light. Watch the live value below change.',
        'A swing of ~15% or more auto-detects a working sensor. If it never moves, use Fail.',
      ]}
      passDisabled={!detected}
      passLabel={detected ? '✓ Auto-detected — Pass' : 'Pass'}
      footerNote={detected ? 'Brightness responded to ambient light.' : 'Waiting for a brightness change…'}
    >
      <View style={styles.metricBox}>
        <Text style={styles.metricLabel}>Live system brightness</Text>
        <Text style={styles.metricValue}>{current === null ? '—' : `${Math.round(current * 100)}%`}</Text>
        <Text style={styles.metricSub}>
          Observed range: {min === null ? '—' : `${Math.round(min * 100)}%`} –{' '}
          {max === null ? '—' : `${Math.round(max * 100)}%`} (swing {Math.round(swing * 100)}%)
        </Text>
        {permission === false && (
          <Text style={styles.metricWarn}>Brightness permission denied — confirm manually.</Text>
        )}
      </View>
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * 3D Touch / Haptic Touch responsiveness — MANUAL confirm
 * iOS does not expose force values to Expo, so we fire a haptic on a
 * long-press and let the tech confirm the device responded.
 * ------------------------------------------------------------------ */
export function HapticTouchTest({ test, onResult }: TestScreenProps) {
  const [pressed, setPressed] = useState(0);

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Press and HOLD the pad below. On a working 3D/Haptic Touch device you should feel a firm tap through the Taptic Engine.',
        'Try it a few times. If the device never produces the pop/haptic on a firm long-press, use Fail.',
      ]}
      passDisabled={pressed === 0}
    >
      <Pressable
        style={({ pressed: p }) => [styles.hapticPad, p && { backgroundColor: colors.primary + '33' }]}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          setPressed((n) => n + 1);
        }}
        delayLongPress={250}
      >
        <Text style={styles.hapticText}>
          {pressed === 0 ? 'Press & hold here' : `Fired ${pressed}× — feel the tap?`}
        </Text>
      </Pressable>
    </TestScaffold>
  );
}

const styles = StyleSheet.create({
  fsSafe: { flex: 1, backgroundColor: colors.bg },
  fullscreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlaySafe: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between', padding: spacing.lg },
  overlayLabel: { fontSize: font.h3, fontWeight: '800', textAlign: 'center' },
  overlayHint: { fontSize: font.body, textAlign: 'center', opacity: 0.8 },
  overlayBtns: { flexDirection: 'row', gap: spacing.md },
  smallBtn: { flex: 1 },
  touchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    gap: spacing.md,
  },
  touchHeaderBtns: { flexDirection: 'row', gap: spacing.sm, flex: 1, justifyContent: 'flex-end' },
  touchStat: { color: colors.text, fontSize: font.h3, fontWeight: '800' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  touchFooter: { padding: spacing.md, minHeight: 70, justifyContent: 'center' },
  touchHint: { color: colors.textDim, textAlign: 'center', fontSize: font.body },
  metricBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
  },
  metricLabel: { color: colors.textDim, fontSize: font.small, textTransform: 'uppercase', letterSpacing: 1 },
  metricValue: { color: colors.text, fontSize: 48, fontWeight: '900', marginVertical: spacing.sm },
  metricSub: { color: colors.textDim, fontSize: font.small, textAlign: 'center' },
  metricWarn: { color: colors.skip, fontSize: font.small, marginTop: spacing.sm, textAlign: 'center' },
  hapticPad: {
    marginTop: spacing.lg,
    height: 160,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hapticText: { color: colors.text, fontSize: font.h3, fontWeight: '700' },
});
