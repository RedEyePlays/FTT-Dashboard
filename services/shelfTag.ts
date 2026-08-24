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

export function printShelfTag(item: InventoryItem, opts: { storeName?: string } = {}): boolean {
  const store = opts.storeName || 'FlipThatTech';
  const name = getDeviceDisplayName(item);
  // Compact spec chips — only those present, in a sensible order.
  const specs: string[] = [];
  if (item.storage) specs.push(`${esc(item.storage)}`);
  if (item.color) specs.push(`${esc(item.color)}`);
  if (item.carrier) specs.push(`${esc(item.carrier)}`);
  if (item.batteryHealth) specs.push(`Battery ${esc(item.batteryHealth)}`);
  if (item.condition) specs.push(`${esc(item.condition)}`);
  const specLine = specs.join(' · ');

  const win = window.open('', '_blank', 'width=420,height=360');
  if (!win) return false;
  win.document.write(`<html><head><title>Shelf Tag ${esc(item.sku || name)}</title>
    <style>
      *{box-sizing:border-box;}
      body{font-family:'Inter',system-ui,Arial,sans-serif;width:300px;margin:0 auto;padding:14px;color:#000;}
      .store{text-align:center;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#666;}
      .name{text-align:center;font-size:16px;font-weight:800;line-height:1.15;margin:4px 0 2px;}
      .specs{text-align:center;font-size:11px;color:#333;margin-bottom:8px;}
      .price{text-align:center;font-size:40px;font-weight:900;letter-spacing:-1px;border-top:2px solid #000;border-bottom:2px solid #000;padding:6px 0;margin:6px 0;}
      .sku{text-align:center;font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:13px;letter-spacing:1px;margin-top:6px;}
      .batt{text-align:center;font-size:11px;color:#333;}
    </style></head>
    <body>
      <div class="store">${esc(store)}</div>
      <div class="name">${esc(name)}</div>
      ${specLine ? `<div class="specs">${specLine}</div>` : ''}
      <div class="price">${money(shelfPrice(item))}</div>
      ${item.batteryHealth ? `<div class="batt">Battery Health: ${esc(item.batteryHealth)}</div>` : ''}
      ${item.sku ? `<div class="sku">${esc(item.sku)}</div>` : ''}
      <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
    </body></html>`);
  win.document.close();
  return true;
}
