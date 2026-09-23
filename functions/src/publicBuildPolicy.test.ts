import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORBIDDEN_FIELDS,
  PUBLIC_BUILD_KEYS,
  PUBLIC_PART_KEYS,
  PUBLIC_PHOTO_KEYS,
  PUBLIC_PERFORMANCE_KEYS,
  PublicBuild,
  shareVisible,
  toPublicBuild,
  warrantyWords,
} from "./publicBuildPolicy";

// Everything that decides what leaves the building lives in this pure module,
// so it can be exercised without a live Firebase project — the same shape as
// staffPasswordPolicy.test.ts. buildLookup.ts does nothing but find the
// document and hand it here.

const NOW = Date.UTC(2026, 8, 24);           // 2026-09-24
const DAY = 86400000;

/** A build document as it is actually stored, with everything private on it. */
const stored = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "b1",
  name: "Starter Gaming PC",
  kind: "shelf",
  status: "ready",
  shareToken: "b7k2m9qrstvwxyz34567bcdfgh",
  comparisonStore: "Canada Computers",
  targetPrice: 1200,
  notes: "picked up cheap from a guy in Scarborough",
  customerName: "Dana Wu",
  customerPhone: "416-555-0100",
  createdBy: "tech-uid",
  createdByEmail: "tech@shop.test",
  inventoryId: "inv-1",
  sku: "FTT-0000777",
  labour: [{ id: "l1", userEmail: "sam@shop.test", hours: 4, rate: 17 }],
  parts: [
    {
      id: "p1", category: "CPU", name: "Ryzen 7 7800X3D", cost: 407,
      condition: "new", source: "facebook",
      sourceUrl: "https://facebook.com/marketplace/item/123",
      serial: "CPU-SECRET-9911", retailPrice: 480, retailSource: "Newegg",
      retailCheckedAt: "2026-09-01", altStorePrice: 510,
      pcpartpickerUrl: "https://ca.pcpartpicker.com/product/abc",
      mfrWarrantyUntil: "2029-01-01",
    },
    {
      id: "p2", category: "GPU", name: "RTX 4070 Windforce", cost: 503,
      condition: "used", source: "kijiji", serial: "GPU-SECRET-2211",
      retailPrice: 900, altStorePrice: 740,
    },
  ],
  ...over,
});

const SHOP = {
  name: "FlipThatTech",
  phone: "416-555-0100",
  address: "12 Main St, Toronto",
  email: "hello@flipthat.tech",
  warrantyDays: 90,
};

/**
 * The finished machine's inventory device. Photos live here, not on the build,
 * and this document is FULL of things the public must never see — which is
 * exactly why the photo is built field by field rather than passed through.
 */
const device = (photos: unknown[]): Record<string, unknown> => ({
  id: "inv-1",
  sku: "FTT-0000777",
  purchaseCost: 880,
  targetSalePrice: 1200,
  imei: "SECRET-IMEI-0001",
  serial: "SECRET-SERIAL-0001",
  boughtFrom: "Dana Wu",
  photos,
});

const realPhoto = {
  id: "ph1", url: "https://cdn.test/real.jpg", thumbUrl: "https://cdn.test/real_thumb.jpg",
  kind: "real", addedBy: "tech-uid", addedAt: 1,
};
const stockPhoto = {
  id: "ph0", url: "https://cdn.test/stock.jpg", thumbUrl: "https://cdn.test/stock_thumb.jpg",
  kind: "stock", credit: "Jane Doe, CC BY-SA 4.0", sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
  addedBy: "system", addedAt: 1,
};

const build = (
  over: Record<string, unknown> = {},
  shop = SHOP,
  dev?: Record<string, unknown>,
): PublicBuild => toPublicBuild(stored(over), shop, NOW, dev);

// --- The allow-list ----------------------------------------------------------

/**
 * Walk the produced object and assert every key is on the allow-list.
 *
 * STRUCTURAL, not a string scan: scanning the JSON for "407" would also fire on
 * the part name "RTX 4070", which teaches you to loosen the check until it
 * stops meaning anything. Walking keys cannot be fooled that way.
 */
function assertOnlyAllowedKeys(value: PublicBuild): void {
  for (const key of Object.keys(value)) {
    assert.ok(
      (PUBLIC_BUILD_KEYS as readonly string[]).includes(key),
      `public build carries an un-allow-listed key: ${key}`,
    );
  }
  for (const row of value.performance || []) {
    for (const key of Object.keys(row)) {
      assert.ok(
        (PUBLIC_PERFORMANCE_KEYS as readonly string[]).includes(key),
        `public performance row carries an un-allow-listed key: ${key}`,
      );
    }
  }
  if (value.photo) {
    for (const key of Object.keys(value.photo)) {
      assert.ok(
        (PUBLIC_PHOTO_KEYS as readonly string[]).includes(key),
        `public photo carries an un-allow-listed key: ${key}`,
      );
    }
  }
  for (const part of value.parts) {
    for (const key of Object.keys(part)) {
      assert.ok(
        (PUBLIC_PART_KEYS as readonly string[]).includes(key),
        `public part carries an un-allow-listed key: ${key}`,
      );
    }
  }
}

test("the public object carries ONLY allow-listed keys", () => {
  assertOnlyAllowedKeys(build());
});

test("NOT ONE forbidden field survives, at either level", () => {
  const b = build();
  for (const field of FORBIDDEN_FIELDS) {
    assert.ok(!(field in b), `build leaked ${field}`);
    for (const part of b.parts) {
      assert.ok(!(field in part), `part leaked ${field}`);
    }
  }
});

test("part SERIALS are excluded — a public serial invites warranty fraud", () => {
  const b = build();
  // Named separately from the loop above because this one is a decision, not
  // an oversight: the serial is on the document and is deliberately dropped.
  for (const part of b.parts) {
    assert.ok(!("serial" in part));
  }
  assert.ok(!JSON.stringify(b).includes("SECRET"));
});

test("an un-allow-listed field added to a part next year does NOT ship", () => {
  // The additive build is what makes this true: nothing is spread.
  const b = toPublicBuild(
    stored({
      parts: [{
        id: "p1", category: "CPU", name: "Ryzen 7", condition: "new",
        somethingAddedLater: "leak me", internalCostCode: "XYZ-9",
      }],
    }),
    SHOP,
    NOW,
  );
  assert.deepEqual(Object.keys(b.parts[0]).sort(), ["category", "condition", "name"]);
  assert.ok(!JSON.stringify(b).includes("leak me"));
});

// --- What it does show -------------------------------------------------------

test("shows the name, a customer-facing status, and the specs", () => {
  const b = build();
  assert.equal(b.name, "Starter Gaming PC");
  assert.equal(b.status, "Available");
  assert.equal(b.parts.length, 2);
  assert.equal(b.parts[0].name, "Ryzen 7 7800X3D");
  assert.equal(b.parts[0].condition, "New");
  assert.equal(b.parts[1].condition, "Used — tested");
});

test("the internal pipeline NEVER leaves the shop", () => {
  // A buyer reading "assembling" learns only that it is not ready.
  for (const status of ["planning", "parts_ordered", "assembling", "testing", "ready"]) {
    assert.equal(build({ status }).status, "Available");
  }
  for (const status of ["sold", "picked_up"]) {
    assert.equal(build({ status }).status, "Sold");
  }
});

test("shows the price, the totals and the saving", () => {
  const b = build();
  assert.equal(b.price, 1200);
  assert.equal(b.retailTotal, 1380);        // 480 + 900
  assert.equal(b.retailComplete, true);
  assert.equal(b.storeTotal, 1250);         // 510 + 740
  assert.equal(b.storeName, "Canada Computers");
  assert.equal(b.saving, 50);               // 1250 − 1200
});

test("a PARTIAL comparison is flagged, and no saving is claimed from it", () => {
  // A total from one part of two is a different number wearing the same label.
  const b = build({
    parts: [
      { id: "p1", category: "CPU", name: "Ryzen 7", cost: 407, condition: "new", retailPrice: 480 },
      { id: "p2", category: "GPU", name: "RTX 4070", cost: 503, condition: "new" },
    ],
  });
  assert.equal(b.retailComplete, false);
  assert.equal(b.storeTotal, undefined);
  assert.equal(b.saving, undefined);
  // The partial figure is still returned so the page can label it as partial.
  assert.equal(b.retailTotal, 480);
});

test("an UNFLATTERING saving is omitted rather than printed as a negative", () => {
  assert.equal(build({ targetPrice: 1400 }).saving, undefined);
});

test("a part's store price falls back to its new price for the store total", () => {
  const b = build({
    parts: [
      { id: "p1", category: "CPU", name: "Ryzen 7", condition: "new", retailPrice: 480, altStorePrice: 510 },
      { id: "p2", category: "GPU", name: "RTX 4070", condition: "new", retailPrice: 900 },
    ],
  });
  assert.equal(b.storeTotal, 1410);         // 510 + 900
});

test("shows the shop's warranty and contact details from settings", () => {
  const b = build();
  assert.equal(b.warrantyDays, 90);
  assert.equal(b.shopName, "FlipThatTech");
  assert.equal(b.shopPhone, "416-555-0100");
  assert.equal(b.shopAddress, "12 Main St, Toronto");
});

test("a missing shop profile degrades rather than breaking the listing", () => {
  const b = build({}, {} as typeof SHOP);
  assert.equal(b.shopName, "Our shop");
  assert.equal(b.warrantyDays, 0);
  assert.ok(!("shopPhone" in b));
  assert.equal(b.name, "Starter Gaming PC");   // the listing still works
});

// --- Manufacturer warranty in words -----------------------------------------

test("remaining maker warranty reads as a person would say it", () => {
  assert.equal(warrantyWords("2026-09-24", NOW), "maker warranty ends today");
  assert.equal(warrantyWords("2026-10-04", NOW), "10 days of maker warranty left");
  assert.equal(warrantyWords("2027-03-24", NOW), "6 months of maker warranty left");
  assert.equal(warrantyWords("2029-09-24", NOW), "3 years of maker warranty left");
});

test("an EXPIRED maker warranty says nothing rather than something negative", () => {
  assert.equal(warrantyWords("2026-09-23", NOW), undefined);
  assert.equal(warrantyWords("", NOW), undefined);
  assert.equal(warrantyWords(undefined, NOW), undefined);
  assert.equal(warrantyWords("not a date", NOW), undefined);
});

// --- Which tokens resolve ----------------------------------------------------

test("a cleared token stops resolving immediately", () => {
  assert.equal(shareVisible(stored({ shareToken: "" }), NOW), false);
  assert.equal(shareVisible(stored({ shareToken: undefined }), NOW), false);
});

test("a live build resolves", () => {
  assert.equal(shareVisible(stored(), NOW), true);
});

test("a SOLD build keeps working for the grace period, then stops", () => {
  // A Marketplace post outlives the sale: somebody clicking last week's link
  // should be told it is gone, not shown a dead page.
  const soldRecently = stored({ status: "sold", finishedAt: NOW - 29 * DAY });
  const soldLongAgo = stored({ status: "sold", finishedAt: NOW - 31 * DAY });
  assert.equal(shareVisible(soldRecently, NOW), true);
  assert.equal(shareVisible(soldLongAgo, NOW), false);
});

test("a CANCELLED build stops at once — there is nothing to sell", () => {
  assert.equal(shareVisible(stored({ status: "cancelled", finishedAt: NOW }), NOW), false);
});

test("a sold build with no timestamp keeps working rather than 404ing a posted link", () => {
  assert.equal(shareVisible(stored({ status: "sold" }), NOW), true);
});


/* ---------------- The listing's photo ---------------- */

test("a build with no device has no photo, and that is not an error", () => {
  const b = build();
  assert.equal(b.photo, undefined);
  assertOnlyAllowedKeys(b);
});

test("a REAL photo is carried, and is labelled nothing", () => {
  const b = build({}, SHOP, device([stockPhoto, realPhoto]));
  // The real photo WINS over the stock one wherever both exist: a Marketplace
  // buyer should be looking at the machine they would be buying.
  assert.equal(b.photo?.url, "https://cdn.test/real.jpg");
  assert.equal(b.photo?.thumbUrl, "https://cdn.test/real_thumb.jpg");
  assert.equal(b.photo?.stock, undefined);
  assert.equal(b.photo?.credit, undefined);
  assertOnlyAllowedKeys(b);
});

test("a STOCK photo is flagged and keeps its credit — dropping it is a licence breach", () => {
  const b = build({}, SHOP, device([stockPhoto]));
  assert.equal(b.photo?.url, "https://cdn.test/stock.jpg");
  assert.equal(b.photo?.stock, true);
  assert.equal(b.photo?.credit, "Jane Doe, CC BY-SA 4.0");
});

test("the photo carries NOTHING about who took it, or where it came from", () => {
  const b = build({}, SHOP, device([realPhoto, stockPhoto]));
  const photo = b.photo as unknown as Record<string, unknown>;
  for (const key of ["id", "addedBy", "addedAt", "sourceUrl", "kind"]) {
    assert.ok(!(key in photo), `photo leaked ${key}`);
  }
});

test("the DEVICE document does not leak through the photo it supplied", () => {
  // The whole inventory document is read (Firestore has no field projection
  // here) and it is full of cost, IMEI, serial and the seller's name. Only the
  // photo's four keys may cross — asserted structurally, because a substring
  // scan for a price would fire on a part name like "RTX 4070".
  const b = build({}, SHOP, device([realPhoto]));
  assertOnlyAllowedKeys(b);
  for (const field of ["purchaseCost", "imei", "serial", "boughtFrom", "photos"]) {
    assert.ok(!(field in b), `public build leaked ${field}`);
  }
});

test("a photo row with no url is ignored rather than rendering a broken image", () => {
  const b = build({}, SHOP, device([{ id: "x", kind: "real", url: "" }]));
  assert.equal(b.photo, undefined);
});


/* ---------------- Expected performance ---------------- */

const GPU_TABLE = [
  { gpuModel: "RTX 4070", game: "Fortnite", resolution: "1080p", preset: "High", fpsLow: 120, fpsHigh: 160 },
  { gpuModel: "RTX 4070", game: "Fortnite", resolution: "1440p", preset: "High", fpsLow: 90, fpsHigh: 120 },
  { gpuModel: "RTX 5090", game: "Warzone", resolution: "1080p", preset: "Ultra", fpsLow: 200, fpsHigh: 260 },
];

const withTable = (over: Record<string, unknown> = {}): PublicBuild =>
  toPublicBuild(stored(over), { ...SHOP, gpuPerformance: GPU_TABLE }, NOW);

test("the page shows the shop's REVIEWED figures for this build's card", () => {
  const b = withTable();
  assert.equal(b.performance.length, 2);
  assert.ok(b.performance.every(p => p.game === "Fortnite"));
  assert.deepEqual(b.performance[0], { game: "Fortnite", resolution: "1080p", preset: "High", fpsLow: 120, fpsHigh: 160 });
  assertOnlyAllowedKeys(b);
});

test("a card with no rows shows NOTHING rather than an improvised figure", () => {
  const b = toPublicBuild(
    stored({ parts: [{ id: "p1", category: "GPU", name: "RX 9070 XT", condition: "new" }] }),
    { ...SHOP, gpuPerformance: GPU_TABLE }, NOW,
  );
  assert.deepEqual(b.performance, []);
});

test("a shop with no table at all shows nothing, and does not break the listing", () => {
  const b = build();
  assert.deepEqual(b.performance, []);
  assert.equal(b.name, "Starter Gaming PC");
});

test("a MEASURED figure replaces the estimate and is flagged", () => {
  const b = withTable({
    measuredFps: [{
      id: "m1", game: "Fortnite", resolution: "1080p", preset: "High", fps: 142,
      measuredBy: "u1", measuredByEmail: "sam@shop.test", measuredAt: 1,
    }],
  });
  const row = b.performance.find(p => p.resolution === "1080p")!;
  assert.equal(row.fpsLow, 142);
  assert.equal(row.fpsHigh, 142);
  assert.equal(row.measured, true);
  // The 1440p estimate is untouched.
  assert.equal(b.performance.find(p => p.resolution === "1440p")!.measured, undefined);
});

test("WHO measured it never leaves the building", () => {
  const b = withTable({
    measuredFps: [{
      id: "m1", game: "CS2", resolution: "1080p", preset: "Competitive", fps: 300,
      measuredBy: "tech-uid", measuredByEmail: "sam@shop.test", measuredAt: 1,
    }],
  });
  assertOnlyAllowedKeys(b);
  const json = JSON.stringify(b);
  assert.ok(!json.includes("sam@shop.test"));
  assert.ok(!json.includes("tech-uid"));
});

test("a reversed or unusable row is put right or dropped, never rendered as-is", () => {
  const b = toPublicBuild(stored(), {
    ...SHOP,
    gpuPerformance: [
      { gpuModel: "RTX 4070", game: "Fortnite", resolution: "1080p", preset: "High", fpsLow: 160, fpsHigh: 120 },
      { gpuModel: "RTX 4070", game: "CS2", resolution: "1080p", preset: "High", fpsLow: 0, fpsHigh: 0 },
      { gpuModel: "RTX 4070", game: "Warzone", resolution: "1080p", fpsLow: 90, fpsHigh: 120 },
    ],
  }, NOW);
  assert.equal(b.performance.length, 1);
  assert.deepEqual(b.performance[0], { game: "Fortnite", resolution: "1080p", preset: "High", fpsLow: 120, fpsHigh: 160 });
});

test("the card is matched through the board partner and the memory size", () => {
  const b = toPublicBuild(
    stored({ parts: [{ id: "p1", category: "GPU", name: "ASUS TUF Gaming GeForce RTX 4070 12GB", condition: "new" }] }),
    { ...SHOP, gpuPerformance: GPU_TABLE }, NOW,
  );
  assert.equal(b.performance.length, 2);
});
