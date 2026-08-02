import * as Battery from 'expo-battery';
import * as Cellular from 'expo-cellular';
import * as Network from 'expo-network';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TestScaffold } from '../../components/TestScaffold';
import { Button } from '../../components/ui';
import { colors, font, radius, spacing } from '../../theme';
import type { TestScreenProps } from '../../types';

function InfoRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, good !== undefined && { color: good ? colors.pass : colors.fail }]}>
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Wi-Fi — AUTO-DETECT connection state.
 * ------------------------------------------------------------------ */
export function WifiTest({ test, onResult }: TestScreenProps) {
  const [state, setState] = useState<Network.NetworkState | null>(null);

  const refresh = async () => setState(await Network.getNetworkStateAsync());
  useEffect(() => {
    refresh();
  }, []);

  const onWifi = state?.type === Network.NetworkStateType.WIFI && !!state?.isConnected;

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Connect the device to a Wi-Fi network in iOS Settings.',
        'Tap Refresh. Auto-detects when the device reports an active Wi-Fi connection with internet reachability.',
      ]}
      passDisabled={!onWifi}
      passLabel={onWifi ? '✓ On Wi-Fi — Pass' : 'Pass'}
    >
      <View style={styles.card}>
        <InfoRow label="Connection type" value={state?.type ?? '—'} good={onWifi} />
        <InfoRow label="Connected" value={state?.isConnected ? 'yes' : 'no'} good={!!state?.isConnected} />
        <InfoRow
          label="Internet reachable"
          value={state?.isInternetReachable === undefined ? '—' : state.isInternetReachable ? 'yes' : 'no'}
        />
        <Button label="Refresh" variant="neutral" onPress={refresh} style={{ marginTop: spacing.md }} />
      </View>
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * Bluetooth pairing — MANUAL (iOS restriction)
 * Managed Expo has no Bluetooth scanning API; pairing is done in Settings.
 * ------------------------------------------------------------------ */
export function BluetoothTest({ test, onResult }: TestScreenProps) {
  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Open iOS Settings ▸ Bluetooth and confirm it turns on and scans for devices.',
        'Pair a known accessory (earbuds/speaker/watch) and confirm it connects.',
        'Pass if pairing succeeds and audio/data flows. Fail if Bluetooth won’t enable or never finds devices.',
      ]}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Cellular signal / SIM detection — reads what iOS still exposes.
 * NOTE: Apple deprecated carrier name on iOS 16+, so it may be null — SIM
 * presence is inferred from the mobile country/network codes when available.
 * ------------------------------------------------------------------ */
export function CellularTest({ test, onResult }: TestScreenProps) {
  const [gen, setGen] = useState<string>('—');
  const [allowsVoip, setAllowsVoip] = useState<string>('—');

  useEffect(() => {
    (async () => {
      try {
        const g = await Cellular.getCellularGenerationAsync();
        setGen(Cellular.CellularGeneration[g] ?? String(g));
      } catch {
        setGen('unknown');
      }
      setAllowsVoip(Cellular.allowsVoip === null ? '—' : Cellular.allowsVoip ? 'yes' : 'no');
    })();
  }, []);

  const mcc = Cellular.mobileCountryCode;
  const mnc = Cellular.mobileNetworkCode;
  const carrier = Cellular.carrier;
  const simLikely = !!(mcc || mnc || (carrier && carrier !== '--'));

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Insert a SIM (or eSIM) and confirm signal bars appear in the status bar.',
        'The values below are what iOS still exposes — carrier name is often hidden on iOS 16+, so confirm the physical SIM tray reads and signal is present.',
        'Skip on Wi-Fi-only devices.',
      ]}
    >
      <View style={styles.card}>
        <InfoRow label="Network generation" value={gen} />
        <InfoRow label="Carrier" value={carrier && carrier !== '--' ? carrier : 'hidden by iOS'} />
        <InfoRow label="Mobile country code" value={mcc ?? '—'} />
        <InfoRow label="Mobile network code" value={mnc ?? '—'} />
        <InfoRow label="Allows VoIP" value={allowsVoip} />
        <InfoRow label="SIM detected" value={simLikely ? 'likely' : 'not detected'} good={simLikely} />
      </View>
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * Charging port — AUTO-DETECT when the device starts charging.
 * ------------------------------------------------------------------ */
export function ChargingPortTest({ test, onResult }: TestScreenProps) {
  const [chargeState, setChargeState] = useState<Battery.BatteryState | null>(null);
  const [sawCharging, setSawCharging] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const s = await Battery.getBatteryStateAsync();
      if (mounted) setChargeState(s);
    })();
    const sub = Battery.addBatteryStateListener(({ batteryState }) => {
      setChargeState(batteryState);
      if (
        batteryState === Battery.BatteryState.CHARGING ||
        batteryState === Battery.BatteryState.FULL
      ) {
        setSawCharging(true);
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const stateLabel =
    chargeState === Battery.BatteryState.CHARGING
      ? 'Charging'
      : chargeState === Battery.BatteryState.FULL
        ? 'Full (charging)'
        : chargeState === Battery.BatteryState.UNPLUGGED
          ? 'Unplugged'
          : 'Unknown';

  return (
    <TestScaffold
      test={test}
      onResult={onResult}
      instructions={[
        'Plug the device into a charger using the port under test.',
        'The state below should switch to “Charging”. Wiggle the cable gently to check for a loose/intermittent port.',
        'Auto-detects once charging is seen. Fail if it never registers or drops out when moved.',
      ]}
      passDisabled={!sawCharging}
      passLabel={sawCharging ? '✓ Charging detected — Pass' : 'Pass'}
    >
      <View style={styles.card}>
        <InfoRow
          label="Charge state"
          value={stateLabel}
          good={chargeState === Battery.BatteryState.CHARGING || chargeState === Battery.BatteryState.FULL}
        />
      </View>
    </TestScaffold>
  );
}

/* ------------------------------------------------------------------ *
 * Battery health — MANUAL entry (iOS restriction)
 * iOS does not expose maximum-capacity / cycle count to third-party apps.
 * We show the live charge level and let the tech key in the health % read
 * from Settings ▸ Battery ▸ Battery Health. That value is saved as notes.
 * ------------------------------------------------------------------ */
export function BatteryHealthTest({ test, onResult }: TestScreenProps) {
  const [level, setLevel] = useState<number | null>(null);
  const [health, setHealth] = useState('');

  useEffect(() => {
    (async () => setLevel(await Battery.getBatteryLevelAsync()))();
  }, []);

  const healthNote = health.trim() ? `Battery health: ${health.trim()}%` : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.bhContent}>
        <Text style={styles.category}>{test.category}</Text>
        <Text style={styles.bhTitle}>{test.title}</Text>

        <View style={styles.restriction}>
          <Text style={styles.restrictionTitle}>⚠︎ iOS limitation — manual entry</Text>
          <Text style={styles.restrictionText}>{test.iosRestriction}</Text>
        </View>

        <View style={styles.card}>
          <InfoRow
            label="Live charge level"
            value={level === null ? '—' : `${Math.round(level * 100)}%`}
          />
          <Text style={styles.bhHint}>
            Open iOS Settings ▸ Battery ▸ Battery Health &amp; Charging and read “Maximum Capacity”.
          </Text>
          <Text style={styles.bhInputLabel}>Maximum capacity (%)</Text>
          <TextInput
            style={styles.input}
            value={health}
            onChangeText={setHealth}
            keyboardType="number-pad"
            placeholder="e.g. 87"
            placeholderTextColor={colors.textDim}
            maxLength={3}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <Button label="Fail" variant="fail" onPress={() => onResult('fail', healthNote)} style={styles.flexBtn} />
          <Button label="Skip" variant="skip" onPress={() => onResult('skip', healthNote)} style={styles.flexBtn} />
          <Button
            label="Pass"
            variant="pass"
            disabled={!health.trim()}
            onPress={() => onResult('pass', healthNote)}
            style={styles.flexBtn}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  infoLabel: { color: colors.textDim, fontSize: font.body },
  infoValue: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  bhContent: { flex: 1, padding: spacing.lg },
  category: {
    color: colors.primary,
    fontSize: font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  bhTitle: { color: colors.text, fontSize: font.h1, fontWeight: '800', marginTop: spacing.xs, marginBottom: spacing.lg },
  restriction: {
    backgroundColor: colors.skip + '18',
    borderColor: colors.skip,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  restrictionTitle: { color: colors.skip, fontWeight: '800', fontSize: font.small, marginBottom: 4 },
  restrictionText: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  bhHint: { color: colors.textDim, fontSize: font.small, marginTop: spacing.md, lineHeight: 18 },
  bhInputLabel: { color: colors.textDim, fontSize: font.small, marginTop: spacing.md, marginBottom: 4 },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: font.h3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  flexBtn: { flex: 1 },
});
