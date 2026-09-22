import { describe, it, expect } from 'vitest';
import { Customer, InventoryItem, DropOff } from '../types';
import {
  sellerLinkDecision, customersNamed, candidateLabel, askPrompt,
  sellerBackfillGroups, backfillLabel, dropOffSellerDecision,
} from './sellerLink';
import { sellerPurchasesFor } from './customers';

const cust = (p: Partial<Customer> = {}): Customer => ({
  id: 'c1', name: 'Ali', phone: '', kind: 'retail', ...p,
} as Customer);

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'PHN-000001', date: '2026-03-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 200, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', ...p,
});

describe('what should happen to a typed seller on save', () => {
  it('creates a new customer for a name nobody has', () => {
    const d = sellerLinkDecision([cust({ id: 'c1', name: 'Jane' })], { name: 'Marcus', phone: '416-555-0100' });
    expect(d.action).toBe('create');
    expect(d).toMatchObject({ draft: { name: 'Marcus', phone: '416-555-0100' } });
  });

  it('LINKS by phone instead of duplicating', () => {
    const existing = cust({ id: 'c1', name: 'Ali', phone: '(416) 555-0100' });
    const d = sellerLinkDecision([existing], { name: 'Ali B', phone: '4165550100' });
    expect(d).toMatchObject({ action: 'link', matchedOn: 'phone' });
    expect(d.action === 'link' && d.customer.id).toBe('c1');
  });

  it('links by email too', () => {
    const existing = cust({ id: 'c2', name: 'Sam', email: 'sam@x.test' });
    const d = sellerLinkDecision([existing], { name: 'Samuel', email: 'sam@x.test' });
    expect(d).toMatchObject({ action: 'link', matchedOn: 'email' });
  });

  it('ASKS rather than guessing when the name exists and nothing tells them apart', () => {
    const d = sellerLinkDecision([cust({ id: 'c1', name: 'Ali', phone: '416-555-0100' })], { name: 'Ali' });
    expect(d.action).toBe('ask');
    expect(d.action === 'ask' && d.candidates.map(c => c.id)).toEqual(['c1']);
  });

  it('asks when there are SEVERAL people by that name', () => {
    const d = sellerLinkDecision(
      [cust({ id: 'c1', name: 'Ali', phone: '1' }), cust({ id: 'c2', name: 'ali', phone: '2' })],
      { name: 'Ali' },
    );
    expect(d.action).toBe('ask');
    expect(d.action === 'ask' && d.candidates).toHaveLength(2);
  });

  it('a phone that matches WINS over a name that also matches — no question asked', () => {
    const d = sellerLinkDecision(
      [cust({ id: 'other', name: 'Ali' }), cust({ id: 'right', name: 'Ali', phone: '416-555-0100' })],
      { name: 'Ali', phone: '4165550100' },
    );
    expect(d).toMatchObject({ action: 'link' });
    expect(d.action === 'link' && d.customer.id).toBe('right');
  });

  it('does nothing when there is no name, or when one was already picked', () => {
    expect(sellerLinkDecision([], { name: '' }).action).toBe('none');
    expect(sellerLinkDecision([], { name: '   ' }).action).toBe('none');
    // An explicit choice is never second-guessed.
    expect(sellerLinkDecision([cust()], { name: 'Ali', customerId: 'c1' }).action).toBe('none');
  });

  it('matches a company name as well as a person name', () => {
    expect(customersNamed([cust({ id: 'b1', name: '', company: 'Acme Wholesale' })], 'acme wholesale').map(c => c.id))
      .toEqual(['b1']);
  });
});

describe('what the question says', () => {
  it('names the existing person and their contact', () => {
    const c = cust({ name: 'Ali', phone: '416-555-0100' });
    expect(candidateLabel(c)).toBe('Ali (416-555-0100)');
    expect(candidateLabel(cust({ name: 'Ali', phone: '' }))).toBe('Ali');
    expect(askPrompt('Ali', [c])).toContain('Ali (416-555-0100)');
    expect(askPrompt('Ali', [c])).toContain('create a new customer');
  });

  it('counts them when there are several', () => {
    expect(askPrompt('Ali', [cust({ id: 'a' }), cust({ id: 'b' })])).toContain('2 customers called Ali');
  });
});

describe('a drop-off seller goes through the same decision', () => {
  const d = (p: Partial<DropOff> = {}): DropOff => ({
    id: 'do1', buyerId: 'b1', item: 'iPhone', imei: '', sellerName: '', sellerContact: '',
    purchasePrice: 100, paidBy: 'store', dropOffFee: 20, dateDropped: '2026-03-01',
    status: 'pending', notes: '', ...p,
  });

  it('reads sellerContact as a phone, or as an email when it has an @', () => {
    const byPhone = dropOffSellerDecision(
      [cust({ id: 'c1', phone: '416-555-0100' })],
      d({ sellerName: 'Ali', sellerContact: '4165550100' }),
    );
    expect(byPhone).toMatchObject({ action: 'link', matchedOn: 'phone' });

    const byEmail = dropOffSellerDecision(
      [cust({ id: 'c2', name: 'Sam', email: 'sam@x.test' })],
      d({ sellerName: 'Sam', sellerContact: 'sam@x.test' }),
    );
    expect(byEmail).toMatchObject({ action: 'link', matchedOn: 'email' });
  });

  it('creates for an unknown seller, and does nothing without a name', () => {
    expect(dropOffSellerDecision([], d({ sellerName: 'New Guy' })).action).toBe('create');
    expect(dropOffSellerDecision([], d({ sellerName: '' })).action).toBe('none');
  });
});

describe('the backfill list', () => {
  const inventory = [
    device({ id: 'a', boughtFrom: 'Marcus', boughtFromPhone: '416-555-0100' }),
    device({ id: 'b', boughtFrom: 'marcus' }),                       // same person, different case
    device({ id: 'c', boughtFrom: 'Marcus' }),
    device({ id: 'd', boughtFrom: 'Jane' }),
    device({ id: 'e', boughtFrom: 'Linked', boughtFromCustomerId: 'c9' }), // already linked
    device({ id: 'f', boughtFrom: '' }),                            // no seller at all
  ];

  it('groups unlinked sellers by name, most purchases first', () => {
    const groups = sellerBackfillGroups(inventory, []);
    expect(groups.map(g => [g.name, g.count])).toEqual([['Marcus', 3], ['Jane', 1]]);
  });

  it('shows the spelling that appears most often, and any phone that was recorded', () => {
    const groups = sellerBackfillGroups(inventory, []);
    expect(groups[0].name).toBe('Marcus');   // 2 of 3 rows
    expect(groups[0].phone).toBe('416-555-0100');
  });

  it('never includes a purchase that is already linked, or one with no seller', () => {
    const ids = sellerBackfillGroups(inventory, []).flatMap(g => g.items.map(i => i.id));
    expect(ids).not.toContain('e');
    expect(ids).not.toContain('f');
  });

  it('flags a customer who already has that name, so linking beats creating', () => {
    const groups = sellerBackfillGroups(inventory, [cust({ id: 'c1', name: 'Jane' })]);
    expect(groups.find(g => g.name === 'Jane')!.existing.map(c => c.id)).toEqual(['c1']);
    expect(groups.find(g => g.name === 'Marcus')!.existing).toEqual([]);
  });

  it('labels the total, and says nothing when there is nothing to do', () => {
    expect(backfillLabel(sellerBackfillGroups(inventory, [])))
      .toBe('4 purchases from 2 sellers not linked to a customer');
    expect(backfillLabel([])).toBeNull();
  });
});

describe('the purchase then shows on that customer\'s record', () => {
  it('sellerPurchasesFor finds it once boughtFromCustomerId is set', () => {
    const c = cust({ id: 'c1', name: 'Marcus' });
    const before = [device({ id: 'a', boughtFrom: 'Marcus' })];
    const after = [device({ id: 'a', boughtFrom: 'Marcus', boughtFromCustomerId: 'c1' })];
    expect(sellerPurchasesFor(c, before)).toHaveLength(0);
    expect(sellerPurchasesFor(c, after).map(i => i.id)).toEqual(['a']);
  });
});
