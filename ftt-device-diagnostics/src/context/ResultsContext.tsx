import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { ResultMap, TestResult, TestStatus } from '../types';

interface ResultsContextValue {
  /** Label for the device currently under test (editable on Home). */
  deviceLabel: string;
  setDeviceLabel: (label: string) => void;
  /** Results for the device currently under test. */
  results: ResultMap;
  /** Record (or overwrite) the result for a single test. */
  setResult: (testId: string, status: TestStatus, notes?: string) => void;
  /** Clear all results and start a fresh device test. */
  resetAll: () => void;
  /** Convenience: the result for a single test (may be undefined). */
  getResult: (testId: string) => TestResult | undefined;
}

const ResultsContext = createContext<ResultsContextValue | undefined>(undefined);

function defaultLabel(): string {
  const d = new Date();
  return `Device ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function ResultsProvider({ children }: { children: React.ReactNode }) {
  const [deviceLabel, setDeviceLabel] = useState<string>(defaultLabel);
  const [results, setResults] = useState<ResultMap>({});

  const setResult = useCallback((testId: string, status: TestStatus, notes?: string) => {
    setResults((prev) => ({
      ...prev,
      [testId]: { status, notes, at: new Date().toISOString() },
    }));
  }, []);

  const resetAll = useCallback(() => {
    setResults({});
    setDeviceLabel(defaultLabel());
  }, []);

  const getResult = useCallback((testId: string) => results[testId], [results]);

  const value = useMemo(
    () => ({ deviceLabel, setDeviceLabel, results, setResult, resetAll, getResult }),
    [deviceLabel, results, setResult, resetAll, getResult],
  );

  return <ResultsContext.Provider value={value}>{children}</ResultsContext.Provider>;
}

export function useResults(): ResultsContextValue {
  const ctx = useContext(ResultsContext);
  if (!ctx) throw new Error('useResults must be used within a ResultsProvider');
  return ctx;
}
