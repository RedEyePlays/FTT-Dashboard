import type { ComponentType } from 'react';

/** Result state for a single test. */
export type TestStatus = 'untested' | 'pass' | 'fail' | 'skip';

/** Top-level groupings shown on the Home screen. */
export type TestCategory =
  | 'Display & Touch'
  | 'Camera'
  | 'Audio'
  | 'Buttons & Inputs'
  | 'Sensors'
  | 'Connectivity';

/**
 * Props every test screen receives. A test screen renders its own interactive
 * UI, then calls `onResult` (which records the result and pops back to Home).
 * `notes` is optional free text the tech can attach (e.g. a battery %).
 */
export interface TestScreenProps {
  test: TestDefinition;
  onResult: (status: Exclude<TestStatus, 'untested'>, notes?: string) => void;
}

export interface TestDefinition {
  id: string;
  title: string;
  category: TestCategory;
  /** One-line description shown on the Home list. */
  description: string;
  /**
   * True when the test can programmatically detect pass/fail (e.g. touch grid,
   * sensor movement). False when iOS restricts automation and the tech must
   * confirm manually.
   */
  autoDetect: boolean;
  /**
   * Populated when iOS prevents full automation. Surfaced in the UI so the tech
   * understands *why* they are being asked to confirm manually.
   */
  iosRestriction?: string;
  /** The screen component that runs this test. */
  component: ComponentType<TestScreenProps>;
}

/** A single test's outcome inside a saved report. */
export interface TestResult {
  status: TestStatus;
  notes?: string;
  /** ISO timestamp of when the result was recorded. */
  at?: string;
}

/** Map of test id -> result for the device currently under test. */
export type ResultMap = Record<string, TestResult>;

/** A saved, immutable snapshot of one device's full test run. */
export interface DeviceReport {
  id: string;
  deviceLabel: string;
  createdAt: string;
  results: ResultMap;
  summary: {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    untested: number;
  };
}
