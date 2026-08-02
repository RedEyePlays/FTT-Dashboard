import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TestScaffold } from '../../components/TestScaffold';
import { Button } from '../../components/ui';
import { colors, font, radius, spacing } from '../../theme';
import type { TestScreenProps } from '../../types';

/**
 * Shared camera runner used by the front, back and focus tests. Shows a live
 * preview, captures a still, and lets the tech confirm the image looks right.
 */
function CameraRunner({
  test,
  onResult,
  facing,
  instructions,
}: TestScreenProps & { facing: 'front' | 'back'; instructions: string[] }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!permission) {
    return (
      <TestScaffold test={test} onResult={onResult} instructions="Requesting camera permission…" passDisabled />
    );
  }

  if (!permission.granted) {
    return (
      <TestScaffold
        test={test}
        onResult={onResult}
        instructions="Camera access is required to run this test. Grant permission, or mark Skip/Fail."
        passDisabled
      >
        <Button label="Grant camera access" variant="primary" onPress={requestPermission} />
      </TestScaffold>
    );
  }

  const capture = async () => {
    try {
      setBusy(true);
      const pic = await cameraRef.current?.takePictureAsync({ quality: 0.6 });
      if (pic?.uri) setPhotoUri(pic.uri);
    } catch {
      /* leave photoUri null; tech can retry or Fail */
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.previewWrap}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
        ) : (
          <CameraView ref={cameraRef} style={styles.preview} facing={facing} />
        )}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{facing === 'front' ? 'FRONT' : 'BACK'} CAMERA</Text>
        </View>
      </View>

      <View style={styles.controls}>
        {instructions.map((s, i) => (
          <Text key={i} style={styles.instruction}>
            • {s}
          </Text>
        ))}

        <View style={styles.captureRow}>
          {photoUri ? (
            <Button label="Retake" variant="neutral" onPress={() => setPhotoUri(null)} style={styles.flexBtn} />
          ) : (
            <Button
              label={busy ? 'Capturing…' : '● Capture photo'}
              variant="primary"
              loading={busy}
              onPress={capture}
              style={styles.flexBtn}
            />
          )}
        </View>

        <View style={styles.resultRow}>
          <Button label="Fail" variant="fail" onPress={() => onResult('fail')} style={styles.flexBtn} />
          <Button label="Skip" variant="skip" onPress={() => onResult('skip')} style={styles.flexBtn} />
          <Button
            label="Pass"
            variant="pass"
            disabled={!photoUri}
            onPress={() => onResult('pass')}
            style={styles.flexBtn}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

export function FrontCameraTest(props: TestScreenProps) {
  return (
    <CameraRunner
      {...props}
      facing="front"
      instructions={[
        'Confirm the live selfie preview is clear, correctly coloured and not cracked/blurry.',
        'Tap Capture, then check the still image looks right before passing.',
      ]}
    />
  );
}

export function BackCameraTest(props: TestScreenProps) {
  return (
    <CameraRunner
      {...props}
      facing="back"
      instructions={[
        'Point at a detailed scene. Confirm the preview is sharp with accurate colour.',
        'Tap Capture and review the still for spots, haze or lens damage before passing.',
      ]}
    />
  );
}

export function FocusTest(props: TestScreenProps) {
  return (
    <CameraRunner
      {...props}
      facing="back"
      instructions={[
        'Aim at something with fine text/detail up close, then far away.',
        'The camera should quickly snap into focus. Capture and confirm the still is sharp — Fail if it stays soft or hunts.',
      ]}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Flash / flashlight (torch) toggle — semi-auto
 * Drives the torch via the back camera and lets the tech confirm light.
 * ------------------------------------------------------------------ */
export function FlashlightTest({ test, onResult }: TestScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [toggled, setToggled] = useState(false);

  if (!permission?.granted) {
    return (
      <TestScaffold
        test={test}
        onResult={onResult}
        instructions="Camera access is required to drive the flashlight/torch. Grant permission, or mark Skip/Fail."
        passDisabled
      >
        <Button label="Grant camera access" variant="primary" onPress={requestPermission} />
      </TestScaffold>
    );
  }

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Tap Toggle to turn the rear LED flash on and off.',
        'Confirm the flashlight physically lights up brightly and evenly, then choose Pass or Fail.',
      ]}
      passDisabled={!toggled}
    >
      {/* Off-screen camera view is what actually controls the torch. */}
      <CameraView style={styles.hiddenCamera} facing="back" enableTorch={torch} />
      <View style={styles.torchBox}>
        <Text style={[styles.torchState, { color: torch ? colors.skip : colors.textDim }]}>
          {torch ? '🔦 Torch ON' : 'Torch OFF'}
        </Text>
        <Button
          label={torch ? 'Turn OFF' : 'Turn ON'}
          variant={torch ? 'neutral' : 'primary'}
          onPress={() => {
            setTorch((t) => !t);
            setToggled(true);
          }}
        />
      </View>
    </TestScaffold>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  previewWrap: { flex: 1, backgroundColor: '#000' },
  preview: { flex: 1 },
  badge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    backgroundColor: '#000000AA',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: { color: '#fff', fontSize: font.small, fontWeight: '800', letterSpacing: 1 },
  controls: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  instruction: { color: colors.textDim, fontSize: font.small, lineHeight: 18 },
  captureRow: { marginTop: spacing.xs },
  resultRow: { flexDirection: 'row', gap: spacing.sm },
  flexBtn: { flex: 1 },
  hiddenCamera: { width: 1, height: 1, opacity: 0 },
  torchBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  torchState: { fontSize: font.h2, fontWeight: '800' },
});
