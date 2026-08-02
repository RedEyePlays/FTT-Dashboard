import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, StatusIcon } from '../components/ui';
import { useResults } from '../context/ResultsContext';
import type { HomeProps } from '../navigation/types';
import { TOTAL_TESTS, testsByCategory } from '../tests/registry';
import { colors, font, radius, spacing } from '../theme';
import type { TestStatus } from '../types';

export function HomeScreen({ navigation }: HomeProps) {
  const { results, resetAll, deviceLabel, setDeviceLabel } = useResults();
  const [editingLabel, setEditingLabel] = useState(false);
  const grouped = useMemo(() => testsByCategory(), []);

  const counts = useMemo(() => {
    let pass = 0;
    let fail = 0;
    let answered = 0;
    for (const r of Object.values(results)) {
      if (r.status === 'pass') pass += 1;
      else if (r.status === 'fail') fail += 1;
      if (r.status !== 'untested') answered += 1;
    }
    return { pass, fail, answered };
  }, [results]);

  const progress = TOTAL_TESTS === 0 ? 0 : counts.answered / TOTAL_TESTS;

  const confirmNewTest = () => {
    if (counts.answered === 0) {
      resetAll();
      return;
    }
    Alert.alert(
      'Start new device test?',
      'This clears all current results. Save the report first if you need it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: resetAll },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.appTitle}>FTT Diagnostics</Text>
          <Pressable onPress={() => navigation.navigate('Reports')} hitSlop={8}>
            <Text style={styles.reportsLink}>Saved reports ›</Text>
          </Pressable>
        </View>

        {editingLabel ? (
          <TextInput
            style={styles.labelInput}
            value={deviceLabel}
            onChangeText={setDeviceLabel}
            onBlur={() => setEditingLabel(false)}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => setEditingLabel(false)}
          />
        ) : (
          <Pressable onPress={() => setEditingLabel(true)}>
            <Text style={styles.deviceLabel} numberOfLines={1}>
              {deviceLabel} ✎
            </Text>
          </Pressable>
        )}

        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {counts.answered}/{TOTAL_TESTS}
          </Text>
        </View>
        <View style={styles.statRow}>
          <Text style={[styles.statChip, { color: colors.pass }]}>✓ {counts.pass} pass</Text>
          <Text style={[styles.statChip, { color: colors.fail }]}>✕ {counts.fail} fail</Text>
          <Text style={[styles.statChip, { color: colors.textDim }]}>
            ○ {TOTAL_TESTS - counts.answered} left
          </Text>
        </View>

        <View style={styles.headerBtns}>
          <Button label="New Device Test" variant="neutral" onPress={confirmNewTest} style={styles.headerBtn} />
          <Button label="View Report" variant="primary" onPress={() => navigation.navigate('Summary')} style={styles.headerBtn} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {grouped.map(({ category, tests }) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{category}</Text>
            {tests.map((t) => {
              const status: TestStatus = results[t.id]?.status ?? 'untested';
              return (
                <Pressable
                  key={t.id}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => navigation.navigate('Test', { testId: t.id })}
                >
                  <StatusIcon status={status} />
                  <View style={styles.rowText}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowTitle}>{t.title}</Text>
                      {t.autoDetect && <Text style={styles.autoTag}>AUTO</Text>}
                      {t.iosRestriction && <Text style={styles.manualTag}>MANUAL</Text>}
                    </View>
                    <Text style={styles.rowDesc} numberOfLines={1}>
                      {t.description}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  appTitle: { color: colors.text, fontSize: font.h1, fontWeight: '900' },
  reportsLink: { color: colors.primary, fontSize: font.body, fontWeight: '600' },
  deviceLabel: { color: colors.textDim, fontSize: font.body, fontWeight: '600' },
  labelInput: {
    color: colors.text,
    fontSize: font.body,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  progressTrack: { flex: 1, height: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary },
  progressText: { color: colors.textDim, fontSize: font.small, fontWeight: '700', minWidth: 44, textAlign: 'right' },
  statRow: { flexDirection: 'row', gap: spacing.lg },
  statChip: { fontSize: font.small, fontWeight: '700' },
  headerBtns: { flexDirection: 'row', gap: spacing.sm },
  headerBtn: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  section: { gap: spacing.sm },
  sectionTitle: {
    color: colors.primary,
    fontSize: font.small,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rowText: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  autoTag: {
    color: colors.pass,
    fontSize: 10,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: colors.pass,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  manualTag: {
    color: colors.skip,
    fontSize: 10,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: colors.skip,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  rowDesc: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  chevron: { color: colors.textDim, fontSize: 24, fontWeight: '300' },
});
