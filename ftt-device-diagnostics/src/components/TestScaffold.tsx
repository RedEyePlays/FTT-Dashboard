import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, font, radius, spacing } from '../theme';
import type { TestScreenProps } from '../types';
import { Button } from './ui';

/**
 * Standard layout for the majority of tests: a scrollable body (instructions +
 * whatever live UI the test renders) and a fixed footer with the three result
 * actions. Fullscreen tests (dead pixel, touch grid) skip this and render their
 * own chrome, but they still call `onResult` the same way.
 */
export function TestScaffold({
  test,
  onResult,
  children,
  instructions,
  /** Hide Pass until the tech has actually run the interaction. */
  passDisabled,
  /** Override the Pass button label (e.g. auto-detected tests). */
  passLabel = 'Pass',
  footerNote,
}: TestScreenProps & {
  children?: React.ReactNode;
  instructions: string | string[];
  passDisabled?: boolean;
  passLabel?: string;
  footerNote?: string;
}) {
  const steps = Array.isArray(instructions) ? instructions : [instructions];
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.category}>{test.category}</Text>
        <Text style={styles.title}>{test.title}</Text>

        <View style={styles.instructionBox}>
          {steps.map((s, i) => (
            <View key={i} style={styles.step}>
              {steps.length > 1 && <Text style={styles.stepNum}>{i + 1}</Text>}
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>

        {test.iosRestriction && (
          <View style={styles.restriction}>
            <Text style={styles.restrictionTitle}>⚠︎ iOS limitation — manual confirm</Text>
            <Text style={styles.restrictionText}>{test.iosRestriction}</Text>
          </View>
        )}

        {children}
      </ScrollView>

      <View style={styles.footer}>
        {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
        <View style={styles.footerRow}>
          <Button
            label="Fail"
            variant="fail"
            onPress={() => onResult('fail')}
            style={styles.footerBtn}
          />
          <Button
            label="Skip"
            variant="skip"
            onPress={() => onResult('skip')}
            style={styles.footerBtn}
          />
          <Button
            label={passLabel}
            variant="pass"
            disabled={passDisabled}
            onPress={() => onResult('pass')}
            style={styles.footerBtn}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  category: {
    color: colors.primary,
    fontSize: font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    color: colors.text,
    fontSize: font.h1,
    fontWeight: '800',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  instructionBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNum: {
    color: colors.primaryText,
    backgroundColor: colors.primary,
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '800',
    fontSize: font.small,
    overflow: 'hidden',
  },
  stepText: { color: colors.text, fontSize: font.body, flex: 1, lineHeight: 21 },
  restriction: {
    marginTop: spacing.lg,
    backgroundColor: colors.skip + '18',
    borderColor: colors.skip,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  restrictionTitle: { color: colors.skip, fontWeight: '800', fontSize: font.small, marginBottom: 4 },
  restrictionText: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  footerNote: { color: colors.textDim, fontSize: font.small, textAlign: 'center' },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  footerBtn: { flex: 1 },
});
