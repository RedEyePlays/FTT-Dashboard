import { DeviceType, InventoryItem, ItemKind, StorageType } from '../types';
import { isInTransit } from './transfers';

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

export type InvTab = 'phones' | 'laptops' | 'accessories' | 'other' | 'intransit' | 'sold' | 'lowstock';

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
 * SOLD AND IN TRANSIT CROSS THE TYPE TABS. A sold laptop is in Sold and not in
 * Laptops; a laptop in a car is in In Transit and not in Laptops. Both are the
 * kind of thing somebody could lose a device over, so the type tabs say so on
 * screen rather than leaving them to wonder.
 *
 * WHY IN TRANSIT IS ITS OWN TAB (multi-store stage 4). A device in transit is
 * on neither store's shelf. Left in Phones with a marker beside it, it would
 * sit in the list a staff member scans to answer "what can I sell" — markers
 * get missed, and the failure is somebody promising a customer a phone that is
 * in a car on the 410. It cannot simply disappear either: a device findable
 * only through the transfers screen is a device nobody looks at. So the type
 * tabs mean SELLABLE STOCK HERE, and transit is a state of its own, visible to
 * both stores and the owner.
 *
 * SOLD IS CHECKED FIRST. A device with a sale recorded against it belongs in
 * Sold even if a transfer was never received — the money is real, and the
 * unreceived transfer is surfaced by the stale-transfer flag rather than by
 * hiding the sale.
 *
 * `lowstock` is not returned here: it is a VIEW of the accessories tab (the
 * ones at or below their threshold), not a home of its own, so an accessory
 * that is low appears in both.
 */
export const inventoryTabOf = (item: Pick<InventoryItem, 'kind' | 'deviceType' | 'soldDate' | 'deviceStatus' | 'inTransferId'>): InvTab => {
  if ((item.kind ?? 'device') === 'accessory') return 'accessories';
  if (isSoldDevice(item)) return 'sold';
  if (isInTransit(item)) return 'intransit';
  const t = effectiveDeviceType(item);
  if (t === 'Laptop') return 'laptops';
  if (t === 'Phone') return 'phones';
  return 'other';
};

/** Does this row belong in the given tab? `lowstock` is handled by the caller. */
export const inTab = (
  item: Pick<InventoryItem, 'kind' | 'deviceType' | 'soldDate' | 'deviceStatus' | 'inTransferId'>,
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

/**
 * Tabs that hold SELLABLE STOCK AT A STORE — the ones an Add belongs on, and
 * the ones whose counts answer "what can we sell". Sold and In Transit are
 * states, not shelves: nothing is added to either.
 */
export const isStockTab = (tab: InvTab): boolean =>
  tab === 'phones' || tab === 'laptops' || tab === 'other';

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
 * A LAPTOP'S SPECS, SPLIT FOR PRINT.
 *
 * `laptopSpecLine` above puts all five on one line, which is right for a list
 * row on a screen that can scroll sideways and wrong for a printed label,
 * where the width is fixed in millimetres and anything too long is silently
 * ellipsised. Measured on the real 89 × 36 mm Dymo stock (see the PR
 * description for the numbers): CPU · RAM · Storage uses about 50 of the shelf
 * tag's 65 mm of text column, and adding the GPU to that line needs 94 mm. It
 * cannot share a line at any legible size, so it does not.
 *
 * So the print surfaces get the specs as THREE SLOTS and place each where
 * their own geometry allows:
 *
 *   main   — CPU · RAM · Storage. The identity of the machine, and what
 *            somebody comparing two otherwise-identical laptops reads first.
 *   gpu    — its own line, and ONLY when one is recorded. Most laptops are
 *            integrated graphics and the field is blank; an empty slot or a
 *            dash reads as missing data, where an absent line reads as "no
 *            discrete GPU".
 *   screen — a corner badge, not part of the spec line. It is the one spec
 *            that is a single short token, so it fits where nothing else
 *            would, and it is the lowest-priority of the four: the format
 *            that has no corner drops it rather than squeezing it in.
 *
 * ONE function for both printouts, so the shelf tag and the device label can
 * never disagree about what a laptop's printed specs are.
 *
 * `storageType` rides with the capacity ("1TB SSD") exactly as it does in
 * `laptopSpecLine` — SSD vs HDD is a selling point on a used laptop and costs
 * no separator of its own.
 */
export interface LaptopPrintSpecs {
  /** "i7-12700H · 32GB · 1TB SSD" — '' when none of the three is filled in. */
  main: string;
  /** "RTX 3050 Ti" — '' when no discrete GPU is recorded. */
  gpu: string;
  /** '15.6"' — '' when not recorded. */
  screen: string;
}

/**
 * The fields this needs, as PLAIN STRINGS rather than Pick<InventoryItem>.
 * An `InventoryItem` satisfies it (its `storageType` union widens to string),
 * and so does the label renderer's own content shape — which is what lets
 * services/labelLayout.ts share this one definition without taking on a
 * dependency on ../types that it has deliberately never had.
 */
export interface LaptopSpecFields {
  cpu?: string; ram?: string; storage?: string;
  storageType?: string; screenSize?: string; gpu?: string;
}

export const laptopPrintSpecs = (item: LaptopSpecFields): LaptopPrintSpecs => {
  const t = (v?: string) => (v || '').toString().trim();
  const drive = [t(item.storage), t(item.storageType)].filter(Boolean).join(' ');
  return {
    main: [t(item.cpu), t(item.ram), drive].filter(Boolean).join(' · '),
    gpu: t(item.gpu),
    screen: t(item.screenSize),
  };
};

/**
 * Does this row print the LAPTOP layout?
 *
 * An accessory is excluded explicitly rather than left to `deviceType`: an
 * accessory has none, so `effectiveDeviceType` would read it as a phone, and
 * a future accessory row carrying a stray `deviceType` must not take a device
 * layout. Every other device type (Tablet, Watch, Desktop PC, …) still prints
 * the phone layout — see the PR description: that is a known gap, not a
 * forgotten one, and each of them needs its own answer.
 */
export const printsLaptopLayout = (
  // Plain strings rather than Pick<InventoryItem>, for the same reason
  // LaptopSpecFields is: services/labelLayout.ts shares this one predicate
  // without taking on a dependency on ../types.
  item: { kind?: string; deviceType?: string },
): boolean => (item.kind ?? 'device') === 'device'
  && effectiveDeviceType({ deviceType: item.deviceType as InventoryItem['deviceType'] }) === 'Laptop';

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
