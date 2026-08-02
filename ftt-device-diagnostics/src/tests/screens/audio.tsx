import { Audio } from 'expo-av';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TestScaffold } from '../../components/TestScaffold';
import { Button } from '../../components/ui';
import { colors, font, radius, spacing } from '../../theme';
import type { TestScreenProps } from '../../types';
import { writeToneFile } from '../../utils/tone';

/* ------------------------------------------------------------------ *
 * Speaker test — plays a 1 kHz tone through the main (loud) speaker.
 * ------------------------------------------------------------------ */
export function SpeakerTest({ test, onResult }: TestScreenProps) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [played, setPlayed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  const play = async () => {
    try {
      setBusy(true);
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const uri = await writeToneFile(1000, 2);
      await soundRef.current?.unloadAsync();
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 });
      soundRef.current = sound;
      setPlayed(true);
    } catch {
      /* tech can retry or Fail */
    } finally {
      setBusy(false);
    }
  };

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Turn the ringer/volume up. Tap Play tone.',
        'Confirm a clear 1 kHz tone comes from the main speaker with no crackle, rattle or distortion.',
      ]}
      passDisabled={!played}
    >
      <Button label={busy ? 'Playing…' : '▶ Play tone'} loading={busy} onPress={play} variant="primary" />
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * Earpiece speaker test — MANUAL (iOS restriction)
 * expo-av cannot force routing to the receiver/earpiece; that only
 * happens during a real call. So this is a guided manual confirm.
 * ------------------------------------------------------------------ */
export function EarpieceTest({ test, onResult }: TestScreenProps) {
  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'The earpiece (top receiver) is only used by iOS during a phone/FaceTime call.',
        'Place a quick call (or FaceTime) and hold the device to your ear.',
        'Confirm audio is clear from the top earpiece speaker — separate from the bottom loudspeaker — then Pass or Fail.',
      ]}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Microphone test — records a few seconds then plays it back in a loop.
 * ------------------------------------------------------------------ */
export function MicrophoneTest({ test, onResult }: TestScreenProps) {
  const [permission, setPermission] = useState<boolean | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const perm = await Audio.requestPermissionsAsync();
      setPermission(perm.granted);
    })();
    return () => {
      soundRef.current?.unloadAsync();
      recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  const startRecording = async () => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setPhase('recording');
    } catch {
      setPhase('idle');
    }
  };

  const stopRecording = async () => {
    try {
      const rec = recordingRef.current;
      await rec?.stopAndUnloadAsync();
      const recUri = rec?.getURI() ?? null;
      setUri(recUri);
      setPhase('recorded');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    } catch {
      setPhase('idle');
    }
  };

  const playback = async () => {
    if (!uri) return;
    await soundRef.current?.unloadAsync();
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 });
    soundRef.current = sound;
  };

  if (permission === false) {
    return (
      <TestScaffold
        test={test}
        onResult={onResult}
        instructions="Microphone access is required. Grant it in Settings, or mark Skip/Fail."
        passDisabled
      />
    );
  }

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Tap Record and speak normally for a few seconds, then tap Stop.',
        'Tap Play back and confirm your voice is captured clearly with no dropouts. Pass if the mic records and plays back correctly.',
      ]}
      passDisabled={phase !== 'recorded'}
    >
      <View style={styles.micBox}>
        <Text style={styles.micState}>
          {phase === 'recording' ? '● Recording…' : phase === 'recorded' ? 'Recording captured' : 'Ready'}
        </Text>
        {phase !== 'recording' ? (
          <Button label={uri ? 'Re-record' : '● Record'} variant="primary" onPress={startRecording} />
        ) : (
          <Button label="■ Stop" variant="fail" onPress={stopRecording} />
        )}
        {phase === 'recorded' && <Button label="▶ Play back" variant="neutral" onPress={playback} />}
      </View>
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * Headphone jack / Bluetooth audio routing — MANUAL (iOS restriction)
 * ------------------------------------------------------------------ */
export function HeadphoneBluetoothTest({ test, onResult }: TestScreenProps) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => void soundRef.current?.unloadAsync(), []);

  const play = async () => {
    try {
      setBusy(true);
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const uri = await writeToneFile(660, 3);
      await soundRef.current?.unloadAsync();
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 });
      soundRef.current = sound;
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Connect the audio path this model uses: Lightning/USB-C headphones (or adapter), or pair a Bluetooth speaker/earbuds.',
        'Tap Play tone. Confirm audio routes to the connected accessory (not the phone speaker).',
        'Disconnect and confirm audio returns to the speaker. Pass if routing works both ways.',
      ]}
    >
      <Button label={busy ? 'Playing…' : '▶ Play tone'} loading={busy} onPress={play} variant="primary" />
    </TestScaffold>
  );
}

const styles = StyleSheet.create({
  micBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'stretch',
  },
  micState: { color: colors.text, fontSize: font.h3, fontWeight: '700', textAlign: 'center', marginBottom: spacing.xs },
});
