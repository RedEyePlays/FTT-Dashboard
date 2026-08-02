/**
 * Central design tokens. Kept intentionally small — techs run this app dozens
 * of times a day, so the UI leans on high contrast, large tap targets and a
 * consistent status colour language (grey = untested, green = pass, red = fail).
 */
export const colors = {
  bg: '#0B0F14',
  surface: '#151B23',
  surfaceAlt: '#1E2732',
  border: '#2A343F',
  text: '#F5F7FA',
  textDim: '#9AA7B4',

  // Status language, reused everywhere a result is shown.
  untested: '#5A6673',
  pass: '#2ECC71',
  fail: '#E74C3C',
  skip: '#F1C40F',

  primary: '#3B9EFF',
  primaryText: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  h1: 28,
  h2: 22,
  h3: 18,
  body: 15,
  small: 13,
} as const;
