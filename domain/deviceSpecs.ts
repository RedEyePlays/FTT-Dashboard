import { DeviceType, InventoryItem, ItemKind, StorageType } from '../types';

/**
 * WHICH FIELDS A DEVICE ACTUALLY HAS, AND WHICH TAB IT LIVES IN.
 *
 * THE PROBLEM. The device record is phone-shaped. A laptop had nowhere to put
 * its CPU, RAM, storage type, screen size or GPU, so all of it went into the
 * `item` name as one string — while the form offered that same laptop a
 * Carrier field and a Battery Health field, which mean nothing on it.
 *
 * `DeviceType` has existed from the start and the form has always had the
 * dropdown. The real failure was never the missing field: it was that the
 * dropdown DEFAULTS to 'Phone' and the shop stopped choosing, so in practice
 * everything in the workspace is typed as a phone — the laptops included. The
 * fix is therefore the tabs: adding from the Laptops tab makes a laptop, with
 * no dropdown to forget.
 *
 * `deviceType` STAYS THE UNDERLYING FIELD. The tabs filter on it, Analytics
 * already categorises by it, and the SKU path already takes it. There is
 * deliberately no second notion of type.
 *
 * Pure: no Firestore, no DOM, no clock.
 */

/* ---------------- The tabs ---------------- */

export type InvTab = 'phones' | 'laptops' | 'accessories' | 'other' | 'sold' | 'lowstock';

/**
 * The device types the "Other" tab covers: everything that is a device but not
 * a phone or a laptop. Named rather than derived by subtraction, so adding a
 * DeviceType later lands in a decision rather than silently in Other.
 */
export const OTHER_DEVICE_TYPES: DeviceType[] = ['Tablet', 'Watch', 'Console', 'Desktop PC', 'Other'];

/**
 * The type of a stored row, for bucketing.
 *
 * AN UNTYPED DEVICE IS TREATED AS A PHONE. Not a guess about the hardware — a
 * statement about this data: the form has defaulted to 'Phone' since the
 * beginning, and the one path that writes no type at all is Quick Purchase
 * (domain/quickPurchase.ts), which collects storage, colour and BATTERY HEALTH
 * — a phone intake. The alternative, dropping untyped rows into "Other", would
 * put the shop's quick-purchased iPhones somewhere nobody looks for them.
 *
 * It is never used to WRITE a type onto an existing record: nothing in this
 * change migrates anybody's data (see the PR — "MacBook" is easy to guess from
 * a name and a Dell model number is not, and a wrong guess puts the wrong
 * fields on a record).
 */
export const effectiveDeviceType = (item: Pick<InventoryItem, 'deviceType'>): DeviceType =>
  item.deviceType || 'Phone';

/** Has this device been sold? The same rule the inventory list has always used. */
export const isSoldDevice = (item: Pick<InventoryItem, 'kind' | 'soldDate' | 'deviceStatus'>): boolean =>
  (item.kind ?? 'device') === 'device' && (!!item.soldDate || item.deviceStatus === 'sold');

/**
 * THE ONE TAB A ROW BELONGS IN — exactly one, for every row, always.
 *
 * SOLD CROSSES THE OTHER TABS. A sold laptop is in Sold and NOT in Laptops,
 * which is the one thing about this layout somebody could lose a device over,
 * so the Laptops tab says so on screen rather than leaving them to wonder.
 *
 * `lowstock` is not returned here: it is a VIEW of the accessories tab (the
 * ones at or below their threshold), not a home of its own, so an accessory
 * that is low appears in both.
 */
export const inventoryTabOf = (item: Pick<InventoryItem, 'kind' | 'deviceType' | 'soldDate' | 'deviceStatus'>): InvTab => {
  if ((item.kind ?? 'device') === 'accessory') return 'accessories';
  if (isSoldDevice(item)) return 'sold';
  const t = effectiveDeviceType(item);
  if (t === 'Laptop') return 'laptops';
  if (t === 'Phone') return 'phones';
  return 'other';
};

/** Does this row belong in the given tab? `lowstock` is handled by the caller. */
export const inTab = (
  item: Pick<InventoryItem, 'kind' | 'deviceType' | 'soldDate' | 'deviceStatus'>,
  tab: InvTab,
): boolean => (tab === 'lowstock' ? (item.kind ?? 'device') === 'accessory' : inventoryTabOf(item) === tab);

/** What kind of record a tab holds, for the column set and the Add button. */
export const tabKind = (tab: InvTab): ItemKind =>
  (tab === 'accessories' || tab === 'lowstock' ? 'accessory' : 'device');

/**
 * The device type an Add from this tab produces.
 *
 * THIS IS THE FIX. Add from the Laptops tab and it is a laptop; there is no
 * dropdown to leave on its default. Undefined for Sold (nothing is added
 * there) and for Other, which covers four kinds and therefore still asks.
 */
export const tabAddsType = (tab: InvTab): DeviceType | undefined => {
  if (tab === 'phones') return 'Phone';
  if (tab === 'laptops') return 'Laptop';
  return undefined;
};

/** Does an Add from this tab still need to ask which kind of device it is? */
export const tabNeedsTypePicker = (tab: InvTab): boolean => tab === 'other';

/* ---------------- Which fields a type has ---------------- */

/**
 * A LAPTOP IS NOT A PHONE WITH EXTRA FIELDS, and a phone is not a laptop with
 * missing ones. Each predicate is stated once, here, so the form, the grid and
 * the tests cannot disagree about it.
 */

/** Carrier and battery health: a phone and a tablet have them, a laptop does not. */
export const hasPhoneFields = (t: DeviceType): boolean => t === 'Phone' || t === 'Tablet' || t === 'Watch';

export const hasLaptopFields = (t: DeviceType): boolean => t === 'Laptop';

/**
 * Brand and Model are dropped for a laptop by the owner's decision — the whole
 * name goes in `item` ("Dell XPS 15"). Not required, not validated for, and
 * nothing downstream needs them: every display path is item-first
 * (domain/inventory.ts's getDeviceDisplayName), and the AI count key falls
 * back to `item` when `model` is empty (domain/modelKey.ts).
 */
export const hasBrandModel = (t: DeviceType): boolean => t !== 'Laptop';

/**
 * The Condition dropdown is explicitly NOT on a laptop, also by the owner's
 * decision. It is not an oversight to be corrected because the phone form has
 * one.
 */
export const hasCondition = (t: DeviceType): boolean => t !== 'Laptop';

/**
 * With no brand or model, `item` is the ONLY identity a laptop has — so it is
 * the one thing the form insists on. A phone can still be saved on an IMEI
 * alone, exactly as before.
 */
export const requiresItemName = (t: DeviceType): boolean => t === 'Laptop';

export const STORAGE_TYPES: StorageType[] = ['SSD', 'HDD'];

/** The spec fields, in the order the form and the summary line use. */
export const LAPTOP_SPEC_FIELDS: { key: keyof InventoryItem; label: string; placeholder: string }[] = [
  { key: 'cpu', label: 'CPU', placeholder: 'i7-1165G7' },
  { key: 'ram', label: 'RAM', placeholder: '16GB' },
  { key: 'storage', label: 'Storage', placeholder: '512GB' },
  { key: 'screenSize', label: 'Screen Size', placeholder: '15.6"' },
  { key: 'gpu', label: 'GPU', placeholder: 'RTX 3060' },
];

/**
 * "i7-1165G7 · 16GB · 512GB SSD · 15.6" · RTX 3060" — the specs on one line,
 * for a list row or a picker, so they are readable without opening the record.
 *
 * Says nothing at all when nothing is filled in: a blank line of separators
 * reads as missing data, where an absent line reads as "not a laptop".
 */
export const laptopSpecLine = (item: Pick<InventoryItem, 'cpu' | 'ram' | 'storage' | 'storageType' | 'screenSize' | 'gpu'>): string => {
  const drive = [item.storage, item.storageType].map(v => (v || '').trim()).filter(Boolean).join(' ');
  return [item.cpu, item.ram, drive, item.screenSize, item.gpu]
    .map(v => (v || '').toString().trim())
    .filter(Boolean)
    .join(' · ');
};

/**
 * The spec fields a row carries that its TYPE has no use for.
 *
 * Nothing clears them — a record keeps whatever was typed into it, and a
 * retyped phone that once had a battery-health reading has not lost it. This
 * exists so the form can SAY so where it matters, rather than hiding a value
 * somebody entered with no sign it is still there.
 */
export const strandedFields = (item: Pick<InventoryItem, 'deviceType' | 'carrier' | 'batteryHealth' | 'condition' | 'cpu' | 'ram' | 'storageType' | 'screenSize' | 'gpu'>): string[] => {
  const t = effectiveDeviceType(item);
  const out: string[] = [];
  if (!hasPhoneFields(t)) {
    if ((item.carrier || '').trim()) out.push('Carrier');
    if ((item.batteryHealth || '').trim()) out.push('Battery Health');
  }
  if (!hasCondition(t) && (item.condition || '').trim()) out.push('Condition');
  if (!hasLaptopFields(t)) {
    for (const [k, label] of [['cpu', 'CPU'], ['ram', 'RAM'], ['storageType', 'Storage type'], ['screenSize', 'Screen size'], ['gpu', 'GPU']] as const) {
      if (((item as Record<string, unknown>)[k] as string | undefined || '').trim()) out.push(label);
    }
  }
  return out;
};
