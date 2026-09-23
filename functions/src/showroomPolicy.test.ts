import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_ORDER, FORBIDDEN_ITEM_FIELDS, SHOWROOM_ITEM_KEYS, SHOWROOM_PHOTO_KEYS,
  SHOWROOM_REPAIR_KEYS, SHOWROOM_TRADEIN_KEYS, ShowroomItem, conditionWords,
  groupByCategory, isShowroomEligible, sortItems, toShowroomBuild, toShowroomDevice,
  toShowroomRepair, toShowroomTradeIn,
} from "./showroomPolicy";

// The tablet is PUBLIC and UNATTENDED. Assume it is picked up by somebody who
// would rather like to know what the shop paid.

/** A device as it is actually stored, with everything private on it. */
const stored = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "inv-1",
  kind: "device",
  sku: "PHN-000123",
  deviceType: "Phone",
  brand: "Apple",
  model: "iPhone 13 Pro",
  item: "iPhone 13 Pro",
  storage: "256GB",
  color: "Graphite",
  condition: "Good",
  batteryHealth: "91%",
  deviceStatus: "ready",
  targetSalePrice: 849,
  // Everything below must never leave.
  purchaseCost: 520,
  repairCost: 60,
  imei: "356789012345678",
  boughtFrom: "Kijiji",
  purchaseSource: "Marketplace",
  customerName: "Dana Wu",
  customerPhone: "416-555-0100",
  soldTo: "",
  soldDate: "",
  notes: "screen has a hairline crack top-left",
  photos: [
    { id: "p1", url: "https://x/real.jpg", thumbUrl: "https://x/real_t.jpg", kind: "real", addedBy: "u1", addedAt: 1 },
  ],
  ...over,
});

// --- The allow-list ----------------------------------------------------------

function assertOnlyAllowedKeys(item: ShowroomItem): void {
  for (const key of Object.keys(item)) {
    assert.ok(
      (SHOWROOM_ITEM_KEYS as readonly string[]).includes(key),
      `showroom item carries an un-allow-listed key: ${key}`,
    );
  }
  if (item.photo) {
    for (const key of Object.keys(item.photo)) {
      assert.ok(
        (SHOWROOM_PHOTO_KEYS as readonly string[]).includes(key),
        `showroom photo carries an un-allow-listed key: ${key}`,
      );
    }
  }
}

test("a device carries ONLY allow-listed keys", () => {
  assertOnlyAllowedKeys(toShowroomDevice(stored(), 90)!);
});

test("NOT ONE forbidden field survives", () => {
  const item = toShowroomDevice(stored(), 90)!;
  for (const field of FORBIDDEN_ITEM_FIELDS) {
    assert.ok(!(field in item), `leaked ${field}`);
  }
  // And nothing private is hiding in a string either.
  const json = JSON.stringify(item);
  for (const secret of ["520", "356789012345678", "Kijiji", "Dana Wu", "hairline"]) {
    assert.ok(!json.includes(secret), `leaked "${secret}"`);
  }
});

test("a field added to InventoryItem next year does NOT ship", () => {
  // The additive build is what makes this true: nothing is spread.
  const item = toShowroomDevice(stored({ somethingAddedLater: "leak me", supplierCode: "XYZ" }), 90)!;
  assert.ok(!JSON.stringify(item).includes("leak me"));
  assertOnlyAllowedKeys(item);
});

test("a repair row and a trade-in row carry only their own keys", () => {
  const repair = toShowroomRepair({ deviceModel: "iPhone 13", repairType: "Screen", price: 189, turnaround: "Same day", internalNote: "leak me" })!;
  for (const key of Object.keys(repair)) {
    assert.ok((SHOWROOM_REPAIR_KEYS as readonly string[]).includes(key), key);
  }
  const trade = toShowroomTradeIn({ deviceModel: "iPhone 12", condition: "Good", lowPrice: 180, highPrice: 220, ourMax: 260 })!;
  for (const key of Object.keys(trade)) {
    assert.ok((SHOWROOM_TRADEIN_KEYS as readonly string[]).includes(key), key);
  }
  assert.ok(!JSON.stringify(trade).includes("260"));
});

// --- Eligibility -------------------------------------------------------------

test("shows phones, laptops, tablets and gaming PCs", () => {
  for (const [deviceType, category] of [["Phone", "Phones"], ["Laptop", "Laptops"], ["Tablet", "Tablets"], ["Desktop PC", "Gaming PCs"]]) {
    const item = toShowroomDevice(stored({ deviceType }), 90);
    assert.equal(item?.category, category);
  }
});

test("ACCESSORIES ARE DELIBERATELY ABSENT", () => {
  assert.equal(isShowroomEligible(stored({ kind: "accessory" })), false);
  // And anything that is not one of the four shown types.
  assert.equal(isShowroomEligible(stored({ deviceType: "Watch" })), false);
  assert.equal(isShowroomEligible(stored({ deviceType: "Console" })), false);
});

test("AN UNPRICED ITEM NEVER APPEARS", () => {
  // A price of 0 on a public screen is not a bargain, it is a mistake somebody
  // will try to hold the shop to.
  assert.equal(isShowroomEligible(stored({ targetSalePrice: 0 })), false);
  assert.equal(isShowroomEligible(stored({ targetSalePrice: undefined })), false);
  assert.equal(toShowroomDevice(stored({ targetSalePrice: 0 }), 90), null);
});

test("sold and reserved devices are off the floor", () => {
  assert.equal(isShowroomEligible(stored({ deviceStatus: "sold" })), false);
  assert.equal(isShowroomEligible(stored({ deviceStatus: "reserved" })), false);
  assert.equal(isShowroomEligible(stored({ soldDate: "2026-09-01" })), false);
  assert.equal(isShowroomEligible(stored()), true);
});

// --- Photos ------------------------------------------------------------------

test("a REAL photo wins, and is labelled nothing", () => {
  const item = toShowroomDevice(stored({
    photos: [
      { id: "s1", url: "https://x/stock.jpg", kind: "stock", credit: "Someone / CC BY-SA 4.0" },
      { id: "r1", url: "https://x/real.jpg", kind: "real" },
    ],
  }), 90)!;
  assert.equal(item.photo?.url, "https://x/real.jpg");
  assert.equal(item.photo?.stock, undefined);
  assert.equal(item.photo?.credit, undefined);
});

test("a STOCK photo is flagged and carries its credit — CC-BY requires it", () => {
  const item = toShowroomDevice(stored({
    photos: [{ id: "s1", url: "https://x/stock.jpg", kind: "stock", credit: "Someone / CC BY-SA 4.0" }],
  }), 90)!;
  assert.equal(item.photo?.stock, true);
  assert.equal(item.photo?.credit, "Someone / CC BY-SA 4.0");
});

test("AN ITEM WITH NO PHOTO STILL APPEARS", () => {
  const item = toShowroomDevice(stored({ photos: undefined }), 90)!;
  assert.equal(item.photo, undefined);
  assert.equal(item.title, "Apple iPhone 13 Pro");    // the listing still works
});

// --- Condition ---------------------------------------------------------------

test("condition is PLAIN WORDS, never a grade code", () => {
  assert.equal(conditionWords("Like New"), "Like new — no marks");
  assert.equal(conditionWords("Good"), "Good — light scratches");
  assert.equal(conditionWords("For Parts"), "Sold as-is, for parts");
  // An unrecognised grade says nothing rather than showing the raw value.
  assert.equal(conditionWords("Mint-ish"), undefined);
  assert.equal(toShowroomDevice(stored({ condition: "Mint-ish" }), 90)!.condition, undefined);
});

// --- Builds ------------------------------------------------------------------

const build = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "b1", name: "Starter Gaming PC", status: "ready", sku: "FTT-000777",
  inventoryId: "inv-9", comparisonStore: "Canada Computers", targetPrice: 1200,
  parts: [
    { id: "p1", name: "Ryzen 7 7800X3D", cost: 407, retailPrice: 480, altStorePrice: 510, serial: "SECRET-1" },
    { id: "p2", name: "RTX 4070", cost: 503, retailPrice: 900, altStorePrice: 740, serial: "SECRET-2" },
  ],
  ...over,
});

test("a build shows its specs and a COMPLETE comparison", () => {
  const item = toShowroomBuild(build(), undefined, 90)!;
  assert.equal(item.kind, "build");
  assert.equal(item.category, "Gaming PCs");
  assert.equal(item.specs, "Ryzen 7 7800X3D · RTX 4070");
  assert.equal(item.compareTotal, 1250);
  assert.equal(item.compareStore, "Canada Computers");
  assert.equal(item.saving, 50);
  // The allow-list walk is what proves the costs are gone. A substring scan
  // for "407" would fire on the part name "RTX 4070" — which is exactly how a
  // leak check gets loosened until it stops meaning anything.
  assertOnlyAllowedKeys(item);
  // Serials are distinctive enough to scan for safely.
  assert.ok(!JSON.stringify(item).includes("SECRET"));
});

test("a PARTIAL comparison is dropped, not shown as the whole", () => {
  const item = toShowroomBuild(build({
    parts: [{ id: "p1", name: "Ryzen 7", retailPrice: 480 }, { id: "p2", name: "RTX 4070" }],
  }), undefined, 90)!;
  assert.equal(item.compareTotal, undefined);
  assert.equal(item.saving, undefined);
  assert.equal(item.specs, "Ryzen 7 · RTX 4070");   // the specs still show
});

test("an unflattering saving is omitted rather than shown as negative", () => {
  assert.equal(toShowroomBuild(build({ targetPrice: 1400 }), undefined, 90)!.saving, undefined);
});

test("a build with no price at all does not appear", () => {
  assert.equal(toShowroomBuild(build({ targetPrice: undefined }), undefined, 90), null);
});

// --- Sorting and grouping ----------------------------------------------------

const item = (price: number, title = "X", category = "Phones"): ShowroomItem =>
  ({ sku: "S", kind: "device", category, title, price, warrantyDays: 90 });

test("sorts cheapest first by default — the order somebody browsing expects", () => {
  const sorted = sortItems([item(900), item(300), item(600)]);
  assert.deepEqual(sorted.map(i => i.price), [300, 600, 900]);
  assert.deepEqual(sortItems([item(300), item(900)], "price-desc").map(i => i.price), [900, 300]);
});

test("groups into the shop's sections, skipping empty ones", () => {
  assert.deepEqual(CATEGORY_ORDER, ["Phones", "Laptops", "Gaming PCs", "Tablets"]);
  const groups = groupByCategory([item(300, "A", "Phones"), item(1200, "B", "Gaming PCs")]);
  assert.deepEqual(groups.map(g => g.category), ["Phones", "Gaming PCs"]);
});

// --- Repair prices and trade-ins ---------------------------------------------

test("an inactive or incomplete repair row is dropped", () => {
  assert.equal(toShowroomRepair({ deviceModel: "iPhone 13", repairType: "Screen", price: 189, active: false }), null);
  assert.equal(toShowroomRepair({ deviceModel: "iPhone 13", repairType: "Screen", price: 0 }), null);
  assert.equal(toShowroomRepair({ deviceModel: "", repairType: "Screen", price: 189 }), null);
});

test('a "from" price is flagged, so an unusual job is not a broken promise', () => {
  assert.equal(toShowroomRepair({ deviceModel: "M", repairType: "Screen", price: 189, fromPrice: true })!.fromPrice, true);
  assert.equal(toShowroomRepair({ deviceModel: "M", repairType: "Screen", price: 189 })!.fromPrice, undefined);
});

test("a trade-in range the wrong way round is corrected, not shown backwards", () => {
  const t = toShowroomTradeIn({ deviceModel: "iPhone 12", condition: "Good", lowPrice: 220, highPrice: 180 })!;
  assert.equal(t.lowPrice, 180);
  assert.equal(t.highPrice, 220);
});

test("an inactive or incomplete trade-in row is dropped", () => {
  assert.equal(toShowroomTradeIn({ deviceModel: "M", condition: "Good", lowPrice: 1, highPrice: 2, active: false }), null);
  assert.equal(toShowroomTradeIn({ deviceModel: "M", condition: "", lowPrice: 1, highPrice: 2 }), null);
});
