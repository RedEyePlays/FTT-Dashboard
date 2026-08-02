import React, { useCallback, useLayoutEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useResults } from '../context/ResultsContext';
import type { TestProps } from '../navigation/types';
import { getTestById } from '../tests/registry';
import { colors, font, spacing } from '../theme';
import type { TestStatus } from '../types';

/**
 * Thin dispatcher: looks up the test by id and renders its screen component,
 * wiring `onResult` to record the result and pop back to Home. Keeping this
 * indirection means individual tests never import navigation.
 */
export function TestRunnerScreen({ route, navigation }: TestProps) {
  const { testId } = route.params;
  const test = getTestById(testId);
  const { setResult } = useResults();

  useLayoutEffect(() => {
    navigation.setOptions({ title: test?.title ?? 'Test' });
  }, [navigation, test]);

  const onResult = useCallback(
    (status: Exclude<TestStatus, 'untested'>, notes?: string) => {
      setResult(testId, status, notes);
      navigation.goBack();
    },
    [navigation, setResult, testId],
  );

  if (!test) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>Unknown test: {testId}</Text>
      </View>
    );
  }

  const TestComponent = test.component;
  return <TestComponent test={test} onResult={onResult} />;
}

const styles = StyleSheet.create({
  missing: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  missingText: { color: colors.textDim, fontSize: font.body },
});
