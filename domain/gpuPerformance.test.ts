import { describe, it, expect } from 'vitest';
import { PcBuild } from '../types';
import {
  GPU_GAMES, GPU_RESOLUTIONS, PERFORMANCE_CAVEAT, GpuPerformanceRow,
  buildGpu, fpsLabel, gpuMatches, gpusInTable, normalizeGpu, performanceFor,
  replaceGpuRows, rowsForGpu,
} from './gpuPerformance';

const row = (over: Partial<GpuPerformanceRow> = {}): GpuPerformanceRow => ({
  id: 'r1', gpuModel: 'RTX 5060 Ti', game: 'Fortnite', resolution: '1080p',
  preset: 'High', fpsLow: 120, fpsHigh: 160, source: 'ai', ...over,
});

const build = (over: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'REAPER', kind: 'shelf', status: 'testing', labour: [],
  parts: [
    { id: 'p1', category: 'GPU', name: 'Gigabyte RTX 5060 Ti Windforce OC 16GB', cost: 0, condition: 'new', source: 'retail' },
    { id: 'p2', category: 'CPU', name: 'Ryzen 9 5900X', cost: 0, condition: 'new', source: 'retail' },
  ],
  createdBy: 'u1', createdByEmail: 'u@shop.test', createdAt: 1, updatedAt: 1, ...over,
});

describe('the fixed game list', () => {
  it('is six games, with Minecraft qualified as shaders', () => {
    expect(GPU_GAMES).toHaveLength(6);
    expect(GPU_GAMES).toContain('Minecraft (with shaders)');
    expect(GPU_RESOLUTIONS).toEqual(['1080p', '1440p']);
  });
});

describe('matching a card', () => {
  it('sees through the board partner, the cooler and the memory size', () => {
    expect(gpuMatches('RTX 5060 Ti', 'Gigabyte RTX 5060 Ti Windforce OC 16GB')).toBe(true);
    expect(gpuMatches('RTX 4070', 'ASUS TUF Gaming GeForce RTX 4070 12GB')).toBe(true);
  });

  it('does not match a different card', () => {
    expect(gpuMatches('RTX 5060 Ti', 'RTX 4070 Windforce')).toBe(false);
    expect(gpuMatches('RTX 5060 Ti', '')).toBe(false);
  });

  it('normalises to the part of the name that decides performance', () => {
    expect(normalizeGpu('Gigabyte RTX 5060 Ti Windforce OC 16GB')).toBe('rtx 5060 ti');
  });
});

describe('buildGpu', () => {
  it('finds the GPU part', () => {
    expect(buildGpu(build())).toBe('Gigabyte RTX 5060 Ti Windforce OC 16GB');
  });

  it('is null when there is no GPU yet', () => {
    expect(buildGpu(build({ parts: [] }))).toBeNull();
    expect(buildGpu(build({ parts: [{ id: 'p', category: 'GPU', name: '  ', cost: 0, condition: 'new', source: 'retail' }] }))).toBeNull();
  });
});

describe('performanceFor', () => {
  const table = [
    row(),
    row({ id: 'r2', resolution: '1440p', fpsLow: 80, fpsHigh: 110 }),
    row({ id: 'r3', gpuModel: 'RTX 4070', game: 'Warzone' }),
  ];

  it('shows the table’s rows for this build’s card, and no other card’s', () => {
    const lines = performanceFor(build(), table);
    expect(lines).toHaveLength(2);
    expect(lines.every(l => l.game === 'Fortnite')).toBe(true);
    expect(lines[0]).toMatchObject({ resolution: '1080p', fpsLow: 120, fpsHigh: 160, measured: false });
  });

  it('is EMPTY for a card with no rows — the section is omitted, never improvised', () => {
    expect(performanceFor(build({ parts: [
      { id: 'p1', category: 'GPU', name: 'RX 9070 XT', cost: 0, condition: 'new', source: 'retail' },
    ] }), table)).toEqual([]);
  });

  it('is empty for a build with no GPU', () => {
    expect(performanceFor(build({ parts: [] }), table)).toEqual([]);
  });

  it('is empty when the table itself is', () => {
    expect(performanceFor(build(), [])).toEqual([]);
  });

  it('lets a MEASURED figure replace the estimate for that game and resolution', () => {
    const lines = performanceFor(build({
      measuredFps: [{ id: 'm1', game: 'Fortnite', resolution: '1080p', preset: 'High', fps: 142, measuredBy: 'u1', measuredByEmail: 'sam@shop.test', measuredAt: 1 }],
    }), table);
    expect(lines).toHaveLength(2);
    const measured = lines.find(l => l.resolution === '1080p')!;
    expect(measured).toMatchObject({ fpsLow: 142, fpsHigh: 142, measured: true, measuredBy: 'sam@shop.test' });
    // The 1440p estimate is untouched.
    expect(lines.find(l => l.resolution === '1440p')).toMatchObject({ fpsLow: 80, measured: false });
  });

  it('shows a measurement for a game the table has nothing for', () => {
    const lines = performanceFor(build({
      measuredFps: [{ id: 'm1', game: 'CS2', resolution: '1080p', preset: 'Competitive', fps: 300, measuredBy: 'u1', measuredAt: 1 }],
    }), table);
    expect(lines.some(l => l.game === 'CS2' && l.measured)).toBe(true);
  });

  it('NEVER writes a measurement back into the table', () => {
    const before = JSON.parse(JSON.stringify(table));
    performanceFor(build({
      measuredFps: [{ id: 'm1', game: 'Fortnite', resolution: '1080p', preset: 'High', fps: 142, measuredBy: 'u1', measuredAt: 1 }],
    }), table);
    expect(table).toEqual(before);
  });

  it('a measurement on ONE build does not change another build with the same card', () => {
    const other = performanceFor(build({ id: 'b2' }), table);
    expect(other.find(l => l.resolution === '1080p')).toMatchObject({ fpsLow: 120, fpsHigh: 160, measured: false });
  });

  it('puts a reversed range the right way round rather than showing "160–120"', () => {
    const lines = performanceFor(build(), [row({ fpsLow: 160, fpsHigh: 120 })]);
    expect(lines[0]).toMatchObject({ fpsLow: 120, fpsHigh: 160 });
  });

  it('drops a row with no usable figures', () => {
    expect(performanceFor(build(), [row({ fpsLow: 0, fpsHigh: 0 })])).toEqual([]);
  });

  it('ignores a measurement of zero', () => {
    const lines = performanceFor(build({
      measuredFps: [{ id: 'm1', game: 'Fortnite', resolution: '1080p', preset: 'High', fps: 0, measuredBy: 'u1', measuredAt: 1 }],
    }), table);
    expect(lines.every(l => !l.measured)).toBe(true);
  });
});

describe('fpsLabel', () => {
  it('reads as a range, and a measurement reads as one number', () => {
    expect(fpsLabel({ fpsLow: 120, fpsHigh: 160 })).toBe('120–160 fps');
    expect(fpsLabel({ fpsLow: 142, fpsHigh: 142 })).toBe('142 fps');
  });
});

describe('the caveat', () => {
  it('says the figures are estimates and that settings and updates move them', () => {
    expect(PERFORMANCE_CAVEAT).toMatch(/estimates/i);
    expect(PERFORMANCE_CAVEAT).toMatch(/published benchmarks/i);
    expect(PERFORMANCE_CAVEAT).toMatch(/varies/i);
  });
});

describe('editing the table', () => {
  const table = [row(), row({ id: 'r2', gpuModel: 'RTX 4070' })];

  it('lists each card once', () => {
    expect(gpusInTable(table)).toEqual(['RTX 5060 Ti', 'RTX 4070']);
    expect(gpusInTable([])).toEqual([]);
  });

  it('reads back one card’s rows', () => {
    expect(rowsForGpu(table, 'RTX 5060 Ti').map(r => r.id)).toEqual(['r1']);
    // The same card written differently is still the same card.
    expect(rowsForGpu(table, 'Gigabyte RTX 5060 Ti OC').map(r => r.id)).toEqual(['r1']);
  });

  it('replaces ONE card’s rows wholesale, leaving the others alone', () => {
    const next = replaceGpuRows(table, 'RTX 5060 Ti', [row({ id: 'new', fpsLow: 130, fpsHigh: 170 })]);
    expect(next.map(r => r.id)).toEqual(['r2', 'new']);
  });

  it('adds a card that was not in the table', () => {
    const next = replaceGpuRows(table, 'RX 9070 XT', [row({ id: 'x', gpuModel: 'RX 9070 XT' })]);
    expect(next).toHaveLength(3);
  });
});
