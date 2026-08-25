import { describe, it, expect } from 'vitest';
import { viewPath, parseViewPath, isRoutableView } from './appNav';
import { ViewState } from '../types';

describe('viewPath', () => {
  it('maps dashboard to root and pages to flat slugs', () => {
    expect(viewPath('dashboard')).toBe('/');
    expect(viewPath('settings')).toBe('/settings');
    expect(viewPath('repairs')).toBe('/repairs');
    expect(viewPath('customers')).toBe('/customers');
    expect(viewPath('pos')).toBe('/checkout');
    expect(viewPath('quickpurchase')).toBe('/quick-purchase');
    expect(viewPath('dropoff')).toBe('/drop-offs');
    expect(viewPath('timeclock')).toBe('/time-clock');
    expect(viewPath('closeout')).toBe('/close-out');
    expect(viewPath('audit')).toBe('/audit');
  });

  it('delegates inventory to its section path', () => {
    expect(viewPath('grid')).toBe('/inventory/devices');
    expect(viewPath('grid', 'sold')).toBe('/inventory/sold');
  });

  it('routeless (transient) views resolve to root', () => {
    expect(viewPath('entry')).toBe('/');
    expect(viewPath('edit')).toBe('/');
  });
});

describe('parseViewPath', () => {
  it('parses root and known slugs', () => {
    expect(parseViewPath('/')).toBe('dashboard');
    expect(parseViewPath('')).toBe('dashboard');
    expect(parseViewPath('/settings')).toBe('settings');
    expect(parseViewPath('/checkout')).toBe('pos');
    expect(parseViewPath('/drop-offs')).toBe('dropoff');
    expect(parseViewPath('/time-clock')).toBe('timeclock');
    expect(parseViewPath('/close-out')).toBe('closeout');
  });

  it('maps any inventory path to grid', () => {
    expect(parseViewPath('/inventory')).toBe('grid');
    expect(parseViewPath('/inventory/sold')).toBe('grid');
    expect(parseViewPath('/inventory/low-stock')).toBe('grid');
  });

  it('tolerates a trailing slash', () => {
    expect(parseViewPath('/settings/')).toBe('settings');
  });

  it('returns null for unknown paths (caller falls back)', () => {
    expect(parseViewPath('/nope')).toBeNull();
    expect(parseViewPath('/settings/extra')).toBeNull();
  });

  it('round-trips every routable view through its path', () => {
    const views: ViewState[] = ['dashboard', 'analytics', 'pos', 'quickpurchase', 'repairs', 'customers', 'dropoff', 'notes', 'ai', 'audit', 'users', 'settings', 'timeclock', 'closeout', 'grid'];
    for (const v of views) {
      expect(parseViewPath(viewPath(v))).toBe(v);
    }
  });
});

describe('isRoutableView', () => {
  it('flags entry/edit as non-routable, everything else routable', () => {
    expect(isRoutableView('entry')).toBe(false);
    expect(isRoutableView('edit')).toBe(false);
    expect(isRoutableView('dashboard')).toBe(true);
    expect(isRoutableView('settings')).toBe(true);
    expect(isRoutableView('grid')).toBe(true);
  });
});
