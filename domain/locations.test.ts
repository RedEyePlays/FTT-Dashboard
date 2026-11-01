import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { COMPANY_LOCATION_ID, Location } from '../types';
import {
  DEFAULT_BACKFILL_COLLECTIONS, LOCATION_TAGGED_COLLECTIONS, activeLocations,
  canDeactivate, canDeleteLocation, checkLocation, deactivateLocation,
  defaultLocation, hasLocations, isLocationTagged, locationName,
  reactivateLocation, renameLocation, seedLocationFrom, setDefaultLocation,
} from './locations';

/**
 * MULTI-STORE, STAGE 1: LOCATIONS EXIST AND EVERY RECORD CARRIES ONE.
 *
 * Same company, one set of books, filterable by store. This stage changes
 * nothing anybody can see — its only job is that every record knows where it
 * belongs, with existing data assigned to Brampton.
 *
 * The two properties worth pinning hardest are that a record with NO location
 * behaves exactly as before (which is what makes the stage reversible), and
 * that a location can never be hard-deleted (which is what stops history
 * being orphaned).
 */

const NOW = 1_790_000_000_000;

const loc = (p: Partial<Location> & { id: string; name: string }): Location => ({
  active: true, createdAt: NOW, ...p,
});

describe('seeding the first store from what the shop already typed', () => {
  it('takes the name and address from settings.general', () => {
    const seeded = seedLocationFrom(
      { storeName: 'FlipThatTech', address: '12 Main St, Brampton' }, NOW, 'l1', 'owner-uid',
    );
    expect(seeded.name).toBe('FlipThatTech');
    expect(seeded.address).toBe('12 Main St, Brampton');
    expect(seeded.active).toBe(true);
    // It is the default, and the one the backfill assigns existing data to.
    expect(seeded.isDefault).toBe(true);
    expect(seeded.createdBy).toBe('owner-uid');
  });

  it('never produces a nameless store, which would be unpickable', () => {
    expect(seedLocationFrom({ storeName: '   ' }, NOW, 'l1').name).toBe('Main store');
    expect(seedLocationFrom({}, NOW, 'l1').name).toBe('Main store');
  });

  it('omits an empty address rather than storing a blank', () => {
    expect('address' in seedLocationFrom({ storeName: 'X', address: '  ' }, NOW, 'l1')).toBe(false);
  });

  it('hasLocations is how the UI knows whether to offer seeding', () => {
    expect(hasLocations([])).toBe(false);
    expect(hasLocations([loc({ id: 'l1', name: 'Brampton' })])).toBe(true);
  });
});

describe('reading the list', () => {
  const brampton = loc({ id: 'l1', name: 'Brampton', isDefault: true });
  const mississauga = loc({ id: 'l2', name: 'Mississauga' });
  const closed = loc({ id: 'l3', name: 'Old Shop', active: false });
  const all = [mississauga, closed, brampton];

  it('offers only active stores, default first', () => {
    expect(activeLocations(all).map(l => l.id)).toEqual(['l1', 'l2']);
  });

  it('finds the default, and falls back sensibly when there is none', () => {
    expect(defaultLocation(all)?.id).toBe('l1');
    expect(defaultLocation([mississauga, closed])?.id).toBe('l2');
    expect(defaultLocation([])).toBeUndefined();
  });

  it('RESOLVES A CLOSED STORE — history must still read', () => {
    // The whole reason closing is not deleting.
    expect(locationName(all, 'l3')).toBe('Old Shop (closed)');
    expect(locationName(all, 'l1')).toBe('Brampton');
  });

  it('names a dangling id rather than rendering a blank', () => {
    // A blank cell looks like missing data; this is a dangling reference.
    expect(locationName(all, 'gone')).toBe('Unknown location');
    // And no id at all is genuinely nothing to show — the stage-1 default.
    expect(locationName(all, undefined)).toBe('');
    expect(locationName(all, '')).toBe('');
  });

  it('names the COMPANY sentinel, which is not a place', () => {
    expect(locationName(all, COMPANY_LOCATION_ID)).toBe('Company (no store)');
  });
});

describe('a location can never be hard-deleted', () => {
  it('canDeleteLocation is false, permanently', () => {
    // Stated as a function so the rule is testable and lives somewhere, rather
    // than the absence of a delete button being the only thing enforcing it.
    expect(canDeleteLocation()).toBe(false);
  });

  it('closing one keeps everything about it, so records still resolve', () => {
    const open = loc({ id: 'l1', name: 'Brampton' });
    const shut = deactivateLocation(open, NOW + 1);
    expect(shut.active).toBe(false);
    expect(shut.id).toBe(open.id);
    expect(shut.name).toBe(open.name);
    expect(shut.createdAt).toBe(open.createdAt);
    expect(shut.updatedAt).toBe(NOW + 1);
    // A record pointing at it still reads.
    expect(locationName([shut], 'l1')).toBe('Brampton (closed)');
  });

  it('closing drops the default flag, so there is never a closed default', () => {
    const shut = deactivateLocation(loc({ id: 'l1', name: 'Brampton', isDefault: true }), NOW);
    expect(shut.isDefault).toBe(false);
  });

  it('reopening restores it', () => {
    const shut = deactivateLocation(loc({ id: 'l1', name: 'Brampton' }), NOW);
    expect(reactivateLocation(shut, NOW + 1).active).toBe(true);
  });

  it('refuses to close the only store, or the default with no successor', () => {
    const only = loc({ id: 'l1', name: 'Brampton', isDefault: true });
    expect(canDeactivate(only, [only])).toBe(false);

    const second = loc({ id: 'l2', name: 'Mississauga' });
    expect(canDeactivate(only, [only, second])).toBe(true);
    // A non-default store closes freely.
    expect(canDeactivate(second, [only, second])).toBe(true);
    // An already-closed one is not closable again.
    expect(canDeactivate(deactivateLocation(second, NOW), [only, second])).toBe(false);
  });
});

describe('naming and renaming', () => {
  const existing = [loc({ id: 'l1', name: 'Brampton' }), loc({ id: 'l2', name: 'Mississauga' })];

  it('requires a name', () => {
    expect(checkLocation({ id: 'new', name: '' }, existing)).toBe('no-name');
    expect(checkLocation({ id: 'new', name: '   ' }, existing)).toBe('no-name');
  });

  it('refuses a duplicate name, case- and space-insensitively', () => {
    // Two "Mississauga" entries in a picker is unusable, and the id is not
    // what anybody reads.
    expect(checkLocation({ id: 'new', name: 'Mississauga' }, existing)).toBe('duplicate-name');
    expect(checkLocation({ id: 'new', name: '  mississauga  ' }, existing)).toBe('duplicate-name');
    // Renaming a store to its own name is fine.
    expect(checkLocation({ id: 'l2', name: 'Mississauga' }, existing)).toBeNull();
  });

  it('refuses to collide with the COMPANY sentinel', () => {
    expect(checkLocation({ id: COMPANY_LOCATION_ID, name: 'Anything' }, existing)).toBe('reserved-id');
    expect(checkLocation({ id: 'new', name: 'Company' }, existing)).toBe('reserved-id');
  });

  it('a rename keeps the id, so records never orphan', () => {
    // The entire reason locations are data and not a settings string.
    const renamed = renameLocation(existing[0], '  Brampton North  ', NOW);
    expect(renamed.id).toBe('l1');
    expect(renamed.name).toBe('Brampton North');
    expect(locationName([renamed], 'l1')).toBe('Brampton North');
  });
});

describe('exactly one store is the default', () => {
  const a = loc({ id: 'l1', name: 'Brampton', isDefault: true });
  const b = loc({ id: 'l2', name: 'Mississauga' });

  it('moving it returns only what CHANGED, so a half-applied move leaves one default at most', () => {
    const changed = setDefaultLocation([a, b], 'l2', NOW);
    expect(changed.map(l => ({ id: l.id, isDefault: !!l.isDefault })))
      .toEqual([{ id: 'l1', isDefault: false }, { id: 'l2', isDefault: true }]);
  });

  it('is a no-op when it is already the default', () => {
    expect(setDefaultLocation([a, b], 'l1', NOW)).toEqual([]);
  });

  it('refuses to make a closed or unknown store the default', () => {
    const shut = deactivateLocation(b, NOW);
    expect(setDefaultLocation([a, shut], 'l2', NOW)).toEqual([]);
    expect(setDefaultLocation([a, b], 'nope', NOW)).toEqual([]);
  });
});

describe('which collections carry a location — and the omissions', () => {
  it('tags exactly the nine records where a location is meaningful', () => {
    expect([...LOCATION_TAGGED_COLLECTIONS]).toEqual([
      'inventory', 'accessories', 'salesTransactions', 'repairs',
      'dropOffs', 'settlements', 'timeEntries', 'expenses', 'cashReconciliations',
    ]);
  });

  it('and tags NONE of the deliberate omissions', () => {
    // Each of these is a decision, not an oversight — see domain/locations.ts.
    // pcBuilds in particular: a build happens somewhere, but the owner has not
    // raised it, finishing one creates a located inventory device anyway, and
    // guessing wrong costs a migration.
    for (const c of [
      'customers', 'pcBuilds', 'payPeriods', 'payPeriodApprovals', 'staffBonuses',
      'users', 'activityLog', 'auditLogs', 'meta', 'receipts', 'recurringExpenses',
    ]) {
      expect({ c, tagged: isLocationTagged(c) }).toEqual({ c, tagged: false });
    }
  });

  it('EXPENSES ARE NOT BACKFILLED BY DEFAULT', () => {
    // Everything else predating the second store genuinely happened at
    // Brampton. An expense did not necessarily BELONG to it: parts orders, the
    // app's own costs and the owner's pay are company costs, and nothing in a
    // stored expense says which is which. Defaulting them all to Brampton
    // would make Brampton bear company costs in stage 5's per-store P&L — a
    // wrong number presented as a fact.
    expect(isLocationTagged('expenses')).toBe(true);
    expect(DEFAULT_BACKFILL_COLLECTIONS).not.toContain('expenses');
    // Everything else is in.
    expect(DEFAULT_BACKFILL_COLLECTIONS.length).toBe(LOCATION_TAGGED_COLLECTIONS.length - 1);
  });
});

/* ---------------- The stage's own guarantee ---------------- */

describe('WHAT EACH STAGE DID, AND DID NOT, CHANGE', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  /** Source with comments stripped: the prose explains the field everywhere. */
  const code = (p: string) => read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('ONLY THE CASH DRAWER BRANCHES ON locationId — stages 4 and 5 have not started', () => {
    // Stage 1's promise was that NOTHING read the field. Stage 2 deliberately
    // ends that for one thing only: which store's cash drawer a record
    // belongs to. Per-store inventory filtering (stage 4) and a per-store P&L
    // (stage 5) have NOT started, and this list is what keeps them from
    // starting by accident — a new file reading the field trips it.
    const allowed = [
      // The field, the store list, and the drawer key built on them.
      'types.ts', 'domain/locations.ts', 'domain/drawerKey.ts',
      // The drawer's own arithmetic and its write path.
      'domain/reports.ts', 'services/firestoreDb.ts',
      // The two owner-only screens: the store list, and who works where.
      'components/LocationsPanel.tsx', 'components/UsersView.tsx',
      // App.tsx resolves the active store and stamps it on a new sale.
      'App.tsx',
      // Tests.
      'domain/locations.test.ts', 'domain/drawerKey.test.ts', 'domain/drawerPerStore.test.ts',
      'services/locationBackfill.test.ts',
      'rules-tests/locations.rules.test.ts', 'rules-tests/cashDrawerStore.rules.test.ts',
      'rules-tests/firestore.rules.test.ts',
    ];
    const hits = execSync(
      "grep -rln 'locationId' --include=*.ts --include=*.tsx . | grep -v node_modules || true",
      { cwd: join(__dirname, '..'), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));

    expect(hits.filter(f => !allowed.includes(f))).toEqual([]);
  });

  it('A RECORD WITH NO LOCATION STILL BEHAVES, everywhere that reads one', () => {
    // The backfill is run by the owner, after a backup, and may be part-done
    // for as long as they like. Nothing may require the field.
    const t = read('types.ts');
    expect(t).not.toMatch(/^\s*locationId:\s/m);
    // And the drawer's own resolution falls back rather than failing: a
    // bare-date record is the default store's (domain/drawerKey.ts).
    expect(code('domain/drawerKey.ts')).toMatch(/defaultLocationId \|\| ''/);
  });

  it('RECEIPTS STILL PRINT WHAT THEY PRINTED — settings.general drives them, unchanged', () => {
    // Deliberately not rewired in this stage.
    for (const f of ['services/salesReceipt.ts', 'services/repairPrint.ts']) {
      expect(code(f)).not.toMatch(/locationId|locationName|from '\.\.\/domain\/locations'/);
    }
    expect(code('services/salesReceipt.ts')).toMatch(/opts\.storeName \|\| 'FlipThatTech'/);
  });

  it('there is no deleteLocation, anywhere', () => {
    // The absence of a delete button is not the only thing enforcing it: there
    // is no function, and firestore.rules refuses it outright.
    expect(code('services/firestoreDb.ts')).not.toMatch(/deleteLocation/);
    const rules = read('firestore.rules');
    const block = /match \/locations\/\{id\} \{[\s\S]*?\n      \}/.exec(rules)?.[0] || '';
    expect(block).toBeTruthy();
    expect(block).toMatch(/allow delete: if false;/);
  });

  it('THE RULES GATE BY LOCATION FOR THE CASH DRAWER AND NOTHING ELSE', () => {
    // Stage 2 tightens one collection. Tightening any other by location
    // mid-migration would lock staff out of every record not yet backfilled,
    // which is why the list of blocks allowed to mention the field is checked
    // rather than assumed.
    //
    // Comments are stripped first: the prose here quotes the very field name
    // being counted.
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Every per-collection block, by its match path.
    const blocks = [...rules.matchAll(/match \/([A-Za-z_]+)\/\{[^}]*\} \{([\s\S]*?)\n      \}/g)];
    expect(blocks.length).toBeGreaterThan(10);
    const gated = blocks.filter(b => /locationId/.test(b[2])).map(b => b[1]);
    expect(gated).toEqual(['cashReconciliations']);
    // Outside that block, the ONLY mentions are its own two helpers — the key
    // agreement check and the "may this person run this till" check. Strip
    // those as well and the field does not appear in these rules at all.
    const outside = rules
      .replace(/match \/cashReconciliations\/\{[^}]*\} \{[\s\S]*?\n      \}/, '')
      .replace(/function drawerKeyAgrees\(id\) \{[\s\S]*?\n      \}/, '')
      .replace(/function tillAllowed\(prof, loc\) \{[\s\S]*?\n      \}/, '')
      .match(/locationId/g) || [];
    expect(outside).toEqual([]);
  });

  it('locations read to every member and write to the owner only', () => {
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8');
    const block = /match \/locations\/\{id\} \{[\s\S]*?\n      \}/.exec(rules)![0];
    expect(block).toMatch(/allow read: if activeMemberOf\(ws\);/);
    expect(block).toMatch(/allow create, update: if isOwnerOf\(ws\);/);
  });
});
