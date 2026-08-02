import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, StatusPill } from '../components/ui';
import { useResults } from '../context/ResultsContext';
import type { SummaryProps } from '../navigation/types';
import { TESTS, TOTAL_TESTS, testsByCategory } from '../tests/registry';
import { buildReport, saveReport } from '../storage/reports';
import { colors, font, radius, spacing } from '../theme';
import type { TestStatus } from '../types';
import { printReport, shareReportJson, shareReportPdf } from '../utils/exportReport';

export function SummaryScreen({ navigation }: SummaryProps) {
  const { results, deviceLabel } = useResults();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const grouped = useMemo(() => testsByCategory(), []);

  const summary = useMemo(() => {
    let pass = 0;
    let fail = 0;
    let skip = 0;
    for (const t of TESTS) {
      const s = results[t.id]?.status ?? 'untested';
      if (s === 'pass') pass += 1;
      else if (s === 'fail') fail += 1;
      else if (s === 'skip') skip += 1;
    }
    return { pass, fail, skip, untested: TOTAL_TESTS - pass - fail - skip };
  }, [results]);

  const report = useMemo(
    () => buildReport(deviceLabel, results, TOTAL_TESTS),
    [deviceLabel, results],
  );

  const runAction = async (key: string, fn: () => Promise<void>) => {
    try {
      setBusy(key);
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const onSave = () =>
    runAction('save', async () => {
      await saveReport(report);
      setSaved(true);
      Alert.alert('Report saved', 'This report is stored on the device under Saved reports.');
    });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Test Report</Text>
        <Text style={styles.subtitle}>{deviceLabel}</Text>
        <Text style={styles.timestamp}>{new Date(report.createdAt).toLocaleString()}</Text>

        <View style={styles.cards}>
          <SummaryCard n={summary.pass} label="Pass" color={colors.pass} />
          <SummaryCard n={summary.fail} label="Fail" color={colors.fail} />
          <SummaryCard n={summary.skip} label="Skip" color={colors.skip} />
          <SummaryCard n={summary.untested} label="Left" color={colors.untested} />
        </View>
        <Text style={styles.overall}>
          {summary.pass}/{TOTAL_TESTS} tests passed
        </Text>

        {grouped.map(({ category, tests }) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{category}</Text>
            {tests.map((t) => {
              const r = results[t.id];
              const status: TestStatus = r?.status ?? 'untested';
              return (
                <Pressable
                  key={t.id}
                  style={styles.row}
                  onPress={() => navigation.navigate('Test', { testId: t.id })}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{t.title}</Text>
                    {r?.notes ? <Text style={styles.rowNotes}>{r.notes}</Text> : null}
                  </View>
                  <StatusPill status={status} />
                </Pressable>
              );
            })}
          </View>
        ))}

        <View style={styles.actions}>
          <Button
            label={saved ? '✓ Saved' : 'Save Report'}
            variant={saved ? 'pass' : 'primary'}
            loading={busy === 'save'}
            onPress={onSave}
          />
          <View style={styles.actionRow}>
            <Button
              label="Share PDF"
              variant="neutral"
              loading={busy === 'pdf'}
              onPress={() => runAction('pdf', () => shareReportPdf(report))}
              style={styles.actionBtn}
            />
            <Button
              label="Print"
              variant="neutral"
              loading={busy === 'print'}
              onPress={() => runAction('print', () => printReport(report))}
              style={styles.actionBtn}
            />
          </View>
          <Button
            label="Export JSON"
            variant="neutral"
            loading={busy === 'json'}
            onPress={() => runAction('json', () => shareReportJson(report))}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryCard({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.cardNum, { color }]}>{n}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  title: { color: colors.text, fontSize: font.h1, fontWeight: '900' },
  subtitle: { color: colors.text, fontSize: font.h3, fontWeight: '700' },
  timestamp: { color: colors.textDim, fontSize: font.small },
  cards: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cardNum: { fontSize: 30, fontWeight: '900' },
  cardLabel: { color: colors.textDim, fontSize: font.small, textTransform: 'uppercase', letterSpacing: 1 },
  overall: { color: colors.text, fontSize: font.h3, fontWeight: '700', textAlign: 'center' },
  section: { gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: {
    color: colors.primary,
    fontSize: font.small,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  rowNotes: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1 },
});
