import { describe, it, expect } from 'vitest';
import { globalSearch, SearchData } from './search';
import { InventoryItem, Repair, Customer, SalesTransaction, AppUser } from '../types';

const dev = (p: Partial<InventoryItem>): InventoryItem => ({ id: 'i', kind: 'device', sku: '', date: '2026-01-01', item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '', ...p } as InventoryItem);
const rep = (p: Partial<Repair>): Repair => ({ id: 'r', repairNumber: 'RPR-1', type: 'retail', createdAt: 0, date: '2026-07-01', issue: '', repairPrice: 0, status: 'received', ...p });
const cus = (p: Partial<Customer>): Customer => ({ id: 'c', name: '', phone: '', ...p });
const sale = (p: Partial<SalesTransaction>): SalesTransaction => ({ id: 't', date: '2026-07-01', customerName: '', subtotal: 0, tax: 0, platformFee: 0, purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p });
const usr = (p: Partial<AppUser>): AppUser => ({ id: 'u', email: '', role: 'employee', workspaceId: 'w', ...p });

const data = (over: Partial<SearchData> = {}): SearchData => ({
  inventory: [], repairs: [], batches: [], customers: [], sales: [], users: [],
  pages: [{ id: 'grid', label: 'Inventory', keywords: 'stock', view: 'grid' }, { id: 'repairs', label: 'Repairs', view: 'repairs' }],
  ...over,
});
const run = (q: string, over?: Partial<SearchData>, canViewCost = true) => globalSearch(q, data(over), { canViewCost });
const group = (r: ReturnType<typeof run>, t: string) => r.groups.find(g => g.type === t);

describe('globalSearch', () => {
  it('exact SKU beats a partial name match', () => {
    const inv = [dev({ id: 'a', sku: 'FTT-1042', item: 'iPhone 15 Pro' }), dev({ id: 'b', sku: 'X', item: 'iPhone 14' })];
    const r = run('ftt-1042', { inventory: inv });
    const g = group(r, 'inventory')!;
    expect(g.results[0].itemId).toBe('a');
    expect(g.results[0].score).toBe(1030); // exact id + in-stock bonus
  });

  it('finds the same device by the short (prefix-stripped) label form or the full SKU', () => {
    // The printed label shows 'FTT-0000029' as '0000029' (services/labelLayout.ts's
    // shortLabelSku, display-only). Staff reading that off a shelf must be able to
    // type either form into Global Search and land on the same item.
    const inv = [dev({ id: 'a', sku: 'FTT-0000029', item: 'iPhone 14 Pro Max' }), dev({ id: 'b', sku: 'FTT-0000030', item: 'iPhone 13' })];
    const short = group(run('0000029', { inventory: inv }), 'inventory')!;
    const full = group(run('FTT-0000029', { inventory: inv }), 'inventory')!;
    expect(short.results[0].itemId).toBe('a');
    expect(full.results[0].itemId).toBe('a');
    expect(short.results.map(r => r.itemId)).not.toContain('b');
  });

  it('exact IMEI match', () => {
    const inv = [dev({ id: 'a', imei: '356789012345678', item: 'Pixel' })];
    expect(group(run('356789012345678', { inventory: inv }), 'inventory')!.results[0].itemId).toBe('a');
  });

  it('partial device model match', () => {
    const inv = [dev({ id: 'a', item: 'iPhone 15 Pro', brand: 'Apple', model: 'iPhone 15 Pro' })];
    expect(group(run('15 pro', { inventory: inv }), 'inventory')!.results.length).toBe(1);
  });

  it('repair id + open-repair ranking', () => {
    const reps = [rep({ id: 'r1', repairNumber: 'RPR-000824', status: 'waiting_parts' }), rep({ id: 'r2', repairNumber: 'RPR-000824-x', status: 'picked_up' })];
    const g = group(run('rpr-000824', { repairs: reps }), 'repair')!;
    expect(g.results[0].itemId).toBe('r1'); // exact + open bonus
    expect(g.results[0].status).toBe('Waiting for Parts');
  });

  it('customer phone (digits) + name search', () => {
    const cs = [cus({ id: 'c1', name: 'Sarah Khan', phone: '(555) 111-2222' })];
    expect(group(run('5551112222', { customers: cs }), 'customer')!.results[0].itemId).toBe('c1');
    expect(group(run('sarah', { customers: cs }), 'customer')!.results[0].itemId).toBe('c1');
  });

  it('invoice + line SKU search', () => {
    const s = [sale({ id: 'inv1092abc', customerName: 'John Smith', totalPaid: 624.89, paymentMethod: 'card', lines: [{ kind: 'device', name: 'iPhone', sku: 'FTT-9', quantity: 1, unitPrice: 624.89 }] })];
    expect(group(run('inv1092', { sales: s }), 'sale')!.results[0].itemId).toBe('inv1092abc');
    expect(group(run('ftt-9', { sales: s }), 'sale')!.results[0].itemId).toBe('inv1092abc');
    expect(group(run('inv1092', { sales: s }), 'sale')!.results[0].subtitle).toContain('$624.89');
  });

  it('navigation results match pages', () => {
    const g = group(run('invent'), 'page')!;
    expect(g.results[0].view).toBe('grid');
  });

  it('respects permissions by category (empty data = no results)', () => {
    // A technician-style search: only repairs provided, users/customers empty.
    const r = run('a', { repairs: [rep({ repairNumber: 'RPR-A' })], users: [], customers: [] });
    expect(group(r, 'user')).toBeUndefined();
    expect(group(r, 'customer')).toBeUndefined();
  });

  it('users category surfaces email/role', () => {
    const g = group(run('owner', { users: [usr({ id: 'u1', email: 'boss@x.com', role: 'owner' })] }), 'user')!;
    expect(g.results[0].itemId).toBe('u1');
  });

  it('below min query returns nothing', () => {
    expect(run('').total).toBe(0);
  });
});
