import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, StatusPill } from '../components/ui';
import type { ReportDetailProps } from '../navigation/types';
import { deleteReport, getReports } from '../storage/reports';
import { testsByCategory } from '../tests/registry';
import { colors, font, radius, spacing } from '../theme';
import type { DeviceReport, TestStatus } from '../types';
import { printReport, shareReportJson, shareReportPdf } from '../utils/exportReport';

export function ReportDetailScreen({ route, navigation }: ReportDetailProps) {
  const { reportId } = route.params;
  const [report, setReport] = useState<DeviceReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const grouped = useMemo(() => testsByCategory(), []);

  useEffect(() => {
    getReports().then((all) => setReport(all.find((r) => r.id === reportId) ?? null));
  }, [reportId]);

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

  const confirmDelete = () => {
    if (!report) return;
    Alert.alert('Delete this report?', report.deviceLabel, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteReport(report.id);
          navigation.goBack();
        },
      },
    ]);
  };

  if (!report) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.missing}>Report not found.</Text>
      </SafeAreaView>
    );
  }

  const { summary } = report;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{report.deviceLabel}</Text>
        <Text style={styles.timestamp}>{new Date(report.createdAt).toLocaleString()}</Text>

        <View style={styles.cards}>
          <Card n={summary.pass} label="Pass" color={colors.pass} />
          <Card n={summary.fail} label="Fail" color={colors.fail} />
          <Card n={summary.skip} label="Skip" color={colors.skip} />
          <Card n={summary.untested} label="Left" color={colors.untested} />
        </View>
        <Text style={styles.overall}>
          {summary.pass}/{summary.total} tests passed
        </Text>

        {grouped.map(({ category, tests }) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{category}</Text>
            {tests.map((t) => {
              const r = report.results[t.id];
              const status: TestStatus = r?.status ?? 'untested';
              return (
                <View key={t.id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{t.title}</Text>
                    {r?.notes ? <Text style={styles.rowNotes}>{r.notes}</Text> : null}
                  </View>
                  <StatusPill status={status} />
                </View>
              );
            })}
          </View>
        ))}

        <View style={styles.actions}>
          <View style={styles.actionRow}>
            <Button
              label="Share PDF"
              variant="primary"
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
          <Button label="Delete report" variant="danger" onPress={confirmDelete} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.cardNum, { color }]}>{n}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  missing: { color: colors.textDim, textAlign: 'center', marginTop: spacing.xxl, fontSize: font.body },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  title: { color: colors.text, fontSize: font.h1, fontWeight: '900' },
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
