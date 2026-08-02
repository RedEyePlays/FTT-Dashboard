import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/ui';
import type { ReportsProps } from '../navigation/types';
import { clearAllReports, getReports } from '../storage/reports';
import { colors, font, radius, spacing } from '../theme';
import type { DeviceReport } from '../types';

export function ReportsScreen({ navigation }: ReportsProps) {
  const [reports, setReports] = useState<DeviceReport[]>([]);

  const load = useCallback(() => {
    getReports().then(setReports);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const confirmClear = () => {
    Alert.alert('Delete all saved reports?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: async () => {
          await clearAllReports();
          load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {reports.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No saved reports yet.</Text>
            <Text style={styles.emptySub}>Finish a device test and tap “Save Report”.</Text>
          </View>
        ) : (
          reports.map((r) => {
            const pass = r.summary.pass;
            const failed = r.summary.fail > 0;
            return (
              <Pressable
                key={r.id}
                style={styles.row}
                onPress={() => navigation.navigate('ReportDetail', { reportId: r.id })}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {r.deviceLabel}
                  </Text>
                  <Text style={styles.rowMeta}>{new Date(r.createdAt).toLocaleString()}</Text>
                </View>
                <View style={styles.rowResult}>
                  <Text style={[styles.rowScore, { color: failed ? colors.fail : colors.pass }]}>
                    {pass}/{r.summary.total}
                  </Text>
                  <Text style={styles.rowScoreLabel}>{failed ? `${r.summary.fail} fail` : 'passed'}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })
        )}

        {reports.length > 0 && (
          <Button label="Delete all reports" variant="danger" onPress={confirmClear} style={{ marginTop: spacing.lg }} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  empty: { alignItems: 'center', marginTop: spacing.xxl, gap: spacing.sm },
  emptyText: { color: colors.text, fontSize: font.h3, fontWeight: '700' },
  emptySub: { color: colors.textDim, fontSize: font.body },
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
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  rowMeta: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  rowResult: { alignItems: 'flex-end' },
  rowScore: { fontSize: font.h3, fontWeight: '900' },
  rowScoreLabel: { color: colors.textDim, fontSize: 11 },
  chevron: { color: colors.textDim, fontSize: 24, fontWeight: '300' },
});
