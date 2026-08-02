import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { colors, font, radius, spacing } from '../theme';
import type { TestStatus } from '../types';

export const STATUS_META: Record<TestStatus, { label: string; color: string; icon: string }> = {
  untested: { label: 'Untested', color: colors.untested, icon: '○' },
  pass: { label: 'Pass', color: colors.pass, icon: '✓' },
  fail: { label: 'Fail', color: colors.fail, icon: '✕' },
  skip: { label: 'Skip', color: colors.skip, icon: '⤼' },
};

/** Small circular status indicator used in the Home list and reports. */
export function StatusIcon({ status, size = 28 }: { status: TestStatus; size?: number }) {
  const meta = STATUS_META[status];
  return (
    <View
      style={[
        styles.statusIcon,
        { width: size, height: size, borderRadius: size / 2, borderColor: meta.color },
        status !== 'untested' && { backgroundColor: meta.color },
      ]}
    >
      <Text style={[styles.statusIconText, { color: status === 'untested' ? meta.color : '#08110A' }]}>
        {meta.icon}
      </Text>
    </View>
  );
}

/** Text + colour pill, used in the summary and report detail. */
export function StatusPill({ status }: { status: TestStatus }) {
  const meta = STATUS_META[status];
  return (
    <View style={[styles.pill, { backgroundColor: meta.color + '22', borderColor: meta.color }]}>
      <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

type ButtonVariant = 'primary' | 'pass' | 'fail' | 'skip' | 'neutral' | 'danger';

const VARIANT_COLOR: Record<ButtonVariant, string> = {
  primary: colors.primary,
  pass: colors.pass,
  fail: colors.fail,
  skip: colors.skip,
  neutral: colors.surfaceAlt,
  danger: colors.fail,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const base = VARIANT_COLOR[variant];
  const outlined = variant === 'neutral';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: outlined ? 'transparent' : base, borderColor: base },
        outlined && styles.buttonOutlined,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={outlined ? colors.text : colors.primaryText} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            { color: variant === 'skip' ? '#20180A' : outlined ? colors.text : colors.primaryText },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** A titled card container. */
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  statusIcon: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconText: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 18,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: font.small,
    fontWeight: '700',
  },
  button: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonOutlined: {
    borderColor: colors.border,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonLabel: {
    fontSize: font.h3,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});
