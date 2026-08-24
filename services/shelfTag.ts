import { InventoryItem } from '../types';
import { kindOf, getDeviceDisplayName } from '../domain/inventory';

// A compact thermal SHELF PRICE TAG for retail display — distinct from the
// repair/receipt labels. Same print pattern as services/salesReceipt.ts (open a
// small window, write inline-styled HTML, print), but sized and laid out as a
// small shelf card: big price up top, the item name, a tight spec line, and the
// SKU at the bottom. Only fields already tracked per item are shown; anything
// missing is simply omitted so the tag stays small.

const money = (n: number) => `$${(n || 0).toFixed(2)}`;
const esc = (s?: string | number) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

// Shelf price = the retail ask. Devices: target sale price (fallback to recorded
// sale price); accessories: selling price.
const shelfPrice = (i: InventoryItem): number =>
  kindOf(i) === 'accessory' ? (i.sellingPrice || 0) : (i.targetSalePrice || i.salePrice || 0);

// One tag's inner markup — shared by the single-item print and the batch print
// so the two never drift apart.
const tagBody = (item: InventoryItem, store: string): string => {
  const name = getDeviceDisplayName(item);
  const specs: string[] = [];
  if (item.storage) specs.push(`${esc(item.storage)}`);
  if (item.color) specs.push(`${esc(item.color)}`);
  if (item.carrier) specs.push(`${esc(item.carrier)}`);
  if (item.batteryHealth) specs.push(`Battery ${esc(item.batteryHealth)}`);
  if (item.condition) specs.push(`${esc(item.condition)}`);
  const specLine = specs.join(' · ');
  return `
      <div class="store">${esc(store)}</div>
      <div class="name">${esc(name)}</div>
      ${specLine ? `<div class="specs">${specLine}</div>` : ''}
      <div class="price">${money(shelfPrice(item))}</div>
      ${item.batteryHealth ? `<div class="batt">Battery Health: ${esc(item.batteryHealth)}</div>` : ''}
      ${item.sku ? `<div class="sku">${esc(item.sku)}</div>` : ''}`;
};

const TAG_STYLE = `
      *{box-sizing:border-box;}
      body{font-family:'Inter',system-ui,Arial,sans-serif;color:#000;}
      .store{text-align:center;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#666;}
      .name{text-align:center;font-size:16px;font-weight:800;line-height:1.15;margin:4px 0 2px;}
      .specs{text-align:center;font-size:11px;color:#333;margin-bottom:8px;}
      .price{text-align:center;font-size:40px;font-weight:900;letter-spacing:-1px;border-top:2px solid #000;border-bottom:2px solid #000;padding:6px 0;margin:6px 0;}
      .sku{text-align:center;font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:13px;letter-spacing:1px;margin-top:6px;}
      .batt{text-align:center;font-size:11px;color:#333;}`;

export function printShelfTag(item: InventoryItem, opts: { storeName?: string } = {}): boolean {
  const store = opts.storeName || 'FlipThatTech';
  const win = window.open('', '_blank', 'width=420,height=360');
  if (!win) return false;
  win.document.write(`<html><head><title>Shelf Tag ${esc(item.sku || getDeviceDisplayName(item))}</title>
    <style>${TAG_STYLE}
      body{width:300px;margin:0 auto;padding:14px;}
    </style></head>
    <body>${tagBody(item, store)}
      <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
    </body></html>`);
  win.document.close();
  return true;
}

// Print shelf tags for many items at once — one print window, one tag per page,
// so a bulk selection prints as a single job instead of one popup per item
// (which browsers block after the first anyway).
export function printShelfTagsBatch(items: InventoryItem[], opts: { storeName?: string } = {}): boolean {
  if (items.length === 0) return false;
  const store = opts.storeName || 'FlipThatTech';
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) return false;
  const pages = items.map(i => `<div class="tag">${tagBody(i, store)}</div>`).join('');
  win.document.write(`<html><head><title>Shelf Tags (${items.length})</title>
    <style>${TAG_STYLE}
      body{margin:0;padding:0;}
      .tag{width:300px;margin:0 auto;padding:14px;page-break-after:always;}
      .tag:last-child{page-break-after:auto;}
    </style></head>
    <body>${pages}
      <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
    </body></html>`);
  win.document.close();
  return true;
}
