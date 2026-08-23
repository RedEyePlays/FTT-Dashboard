import { useState, useMemo, useRef, useEffect } from 'react';
import { InventoryItem, ItemKind, DeviceType, SalesTransaction, Customer, Repair } from '../types';
import { getPOSSettings, getStoreProfile } from '../components/SettingsModal';
import { newId } from '../domain/ids';
import { kindOf, getDeviceDisplayName } from '../domain/inventory';
import { isZeroPricedDevice as isZeroPricedLine, cartHasZeroPricedDevice, searchCheckoutInventory, salesBalanceOwing } from '../domain/pos';
import { RepairSalePrefill, repairSalePrefill, isRepairOpen, matchesRepair } from '../domain/repairs';
import { printSalesReceipt } from '../services/salesReceipt';

// All Quick Sale / checkout state, pricing math and the commit-payload builder
// live here so the desktop CartSaleView and the mobile step flow share ONE
// implementation of the business logic (no duplication).

export interface CartCheckout {
  soldRows: InventoryItem[];              // device rows to mark sold (replace by id)
  accessoryQtys: Record<string, number>; // accessoryId -> qty to decrement
  transaction: SalesTransaction;         // sales record to persist
  customer?: Customer;                   // customer to upsert
  newInventoryItems?: InventoryItem[];   // custom items to add to inventory
}

export type CustomCategory = 'device' | 'accessory' | 'service' | 'other';

// Device-type options for a custom device line — the analytics-meaningful set
// (Phone/Tablet/Laptop/Watch each map to a named category; Other → Other Devices).
export const CUSTOM_DEVICE_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Watch', 'Other'];

export interface CartLine {
  key: string;
  inventoryId: string;   // '' for custom items not tied to inventory
  kind: ItemKind;
  name: string;
  code: string;
  quantity: number;
  maxQty: number;        // accessories: available stock; devices: 1; custom: 9999
  unitPrice: number;
  purchaseCost: number;  // per-unit purchase / cost estimate
  repairCost: number;    // per-unit repair (devices)
  taxable: boolean;
  discount: number;
  isCustom?: boolean;
  category?: CustomCategory;
  deviceType?: DeviceType; // device lines: real item's type, or a custom device's chosen type
  imei?: string;
  notes?: string;
  addToInventory?: boolean;
}

interface Args {
  inventory: InventoryItem[];
  customers?: Customer[];
  // Open retail repairs, so a tech can find and add a "Ready for Pickup" repair
  // to the sale directly from Quick Sale (same result as the ticket's Check Out).
  repairs?: Repair[];
  initialCustomer?: Customer;
  onConsumeInitial?: () => void;
  // Pre-seed the cart as a repair checkout (device/parts/labor/price as one
  // service line + the repair's customer), so a "Ready for Pickup" repair is
  // completed through the same Quick Sale flow as a regular in-store sale.
  initialRepair?: RepairSalePrefill;
  onConsumeInitialRepair?: () => void;
  onComplete: (payload: CartCheckout) => void;
  // Allocate a real SKU the same way normal device intake does (App's atomic
  // generator). Used to give a custom device opted into inventory a proper SKU
  // instead of a blank one.
  onGenerateSku?: (deviceType?: DeviceType) => Promise<string>;
}

const uid = newId;

export function useCheckout({ inventory, customers = [], repairs = [], initialCustomer, onConsumeInitial, initialRepair, onConsumeInitialRepair, onComplete, onGenerateSku }: Args) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picker, setPicker] = useState<null | ItemKind>(null);
  const [search, setSearch] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  // Explicit override to allow completing a sale that has a $0 device line.
  const [allowZeroPrice, setAllowZeroPrice] = useState(false);

  const [platformName, setPlatformName] = useState('None / In-Store');
  const [platformFeePercent, setPlatformFeePercent] = useState('0');
  const [soldDate, setSoldDate] = useState(new Date().toISOString().split('T')[0]);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  // The repair being checked out (if this cart was seeded from a repair). Kept so
  // the built transaction can link back to it (transaction.repairId) and the app
  // can mark the repair complete + linked once the sale commits.
  const [linkedRepairId, setLinkedRepairId] = useState<string | undefined>(undefined);
  // Print the receipt automatically when the sale completes. Opt-in — off by
  // default so completing a sale never force-opens a print dialog; the tech can
  // tick it to auto-print, or use the Print Receipt button on the done screen.
  const [printReceiptOnComplete, setPrintReceiptOnComplete] = useState(false);

  // Seed the cart from a repair checkout: one service line priced at the full
  // repair price (cost = parts cost, so profit = labor) plus the repair's
  // customer. `replace` starts a fresh cart (the ticket's Check Out flow);
  // otherwise the repair is appended to whatever's already in the cart (added
  // from the Quick Sale search) and the customer is only filled if still blank.
  const seedRepairPrefill = (p: RepairSalePrefill, replace: boolean) => {
    const c = p.customer;
    if (c && (replace || !customerName.trim())) {
      setCustomerName(c.name || '');
      setCustomerPhone(c.phone || '');
      setCustomerEmail(c.email || '');
      setSelectedCustomerId(c.id);
    }
    setLinkedRepairId(p.repairId);
    const line: CartLine = {
      key: uid(), inventoryId: '', kind: 'accessory', name: p.lineName, code: '',
      quantity: 1, maxQty: 1, unitPrice: p.repairPrice, purchaseCost: p.partsCost,
      repairCost: 0, taxable: true, discount: 0, isCustom: true, category: 'service', addToInventory: false,
    };
    setCart(prev => replace ? [line] : [...prev, line]);
    // Any deposit was collected earlier — note it for the tech rather than
    // re-collecting it or deferring recognition as a layaway.
    if (p.deposit > 0) setPaymentNotes(`Repair deposit of $${p.deposit.toFixed(2)} already collected — balance due $${Math.max(0, p.repairPrice - p.deposit).toFixed(2)}.`);
  };

  useEffect(() => {
    if (!initialCustomer) return;
    setCustomerName(initialCustomer.name || '');
    setCustomerPhone(initialCustomer.phone || '');
    setCustomerEmail(initialCustomer.email || '');
    setSelectedCustomerId(initialCustomer.id);
    onConsumeInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomer?.id]);

  // Seed the cart from the ticket's Check Out flow (fresh cart).
  useEffect(() => {
    if (!initialRepair) return;
    seedRepairPrefill(initialRepair, true);
    onConsumeInitialRepair?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRepair?.repairId]);

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mixed'>('cash');
  const [cashTaxStatus, setCashTaxStatus] = useState<'none' | 'separate' | 'included'>('none');
  const [paymentNotes, setPaymentNotes] = useState('');

  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [etransferAmount, setEtransferAmount] = useState('');
  const [taxCollected, setTaxCollected] = useState('');
  // Deposit / layaway: amount collected now when the customer isn't paying in
  // full. Blank/0 = paid in full (unchanged behaviour).
  const [deposit, setDeposit] = useState('');

  const [scan, setScan] = useState('');
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [lastTx, setLastTx] = useState<SalesTransaction | null>(null);
  const [showTx, setShowTx] = useState(false);
  const [labelItem, setLabelItem] = useState<InventoryItem | null>(null);

  const emptyCustom = () => ({ name: '', category: 'accessory' as CustomCategory, deviceType: 'Phone' as DeviceType, quantity: '1', unitPrice: '', costEstimate: '', taxable: true, notes: '', imei: '', addToInventory: false });
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState(emptyCustom());

  const taxRate = getPOSSettings().taxRate;
  const feePercent = parseFloat(platformFeePercent) || 0;

  // A reserved device is spoken for on an open layaway — treat it as unavailable
  // for another sale, same as a fully sold one.
  const soldIds = new Set(inventory.filter(i => kindOf(i) === 'device' && (i.soldDate || i.deviceStatus === 'sold' || i.deviceStatus === 'reserved')).map(i => i.id));
  const inCart = new Set(cart.map(l => l.inventoryId));

  const previousPurchases = useMemo(() => {
    const n = customerName.trim().toLowerCase();
    const p = customerPhone.trim();
    if (!n && !p) return [];
    return inventory.filter(i =>
      (i.soldDate || i.deviceStatus === 'sold') &&
      ((n && (i.customerName || i.soldTo || '').toLowerCase() === n) ||
       (p && (i.customerPhone || '') === p))
    );
  }, [inventory, customerName, customerPhone]);

  const availableDevices = inventory.filter(i =>
    kindOf(i) === 'device' && !soldIds.has(i.id) && !inCart.has(i.id) &&
    ((i.item || '').toLowerCase().includes(search.toLowerCase()) ||
     (i.sku || '').toLowerCase().includes(search.toLowerCase()) ||
     (i.imei || '').toLowerCase().includes(search.toLowerCase()))
  );
  const availableAccessories = inventory.filter(i =>
    kindOf(i) === 'accessory' && (i.quantity ?? 0) > 0 && !inCart.has(i.id) &&
    ((i.item || '').toLowerCase().includes(search.toLowerCase()) ||
     (i.sku || '').toLowerCase().includes(search.toLowerCase()) ||
     (i.manufacturerBarcode || '').toLowerCase().includes(search.toLowerCase()))
  );

  // ---- math ----
  const lineSubtotal = (l: CartLine) => {
    const v = l.quantity * l.unitPrice - l.discount;
    return l.isCustom ? v : Math.max(0, v);
  };
  const linePurchase = (l: CartLine) => l.quantity * l.purchaseCost;
  const lineRepair = (l: CartLine) => l.quantity * l.repairCost;

  const subtotal = cart.reduce((s, l) => s + lineSubtotal(l), 0);
  const discountTotal = cart.reduce((s, l) => s + (l.discount || 0), 0);
  const purchaseCostTotal = cart.reduce((s, l) => s + linePurchase(l), 0);
  const repairCostTotal = cart.reduce((s, l) => s + lineRepair(l), 0);
  const totalCost = purchaseCostTotal + repairCostTotal;
  const taxableBase = cart.filter(l => l.taxable).reduce((s, l) => s + lineSubtotal(l), 0);
  const taxApplies = !(paymentMethod === 'cash' && cashTaxStatus === 'none');
  const tax = paymentMethod === 'mixed'
    ? (parseFloat(taxCollected) || 0)
    : (taxApplies ? taxableBase * taxRate / 100 : 0);
  const platformFee = subtotal * feePercent / 100;
  const totalPaid = subtotal + tax;
  const netProfit = subtotal - totalCost - platformFee;

  // ---- deposit / layaway ----
  // If the customer leaves a deposit that's less than the grand total, the sale
  // is a layaway: we record what's still owed rather than treating it as fully
  // settled. Blank/0 (or a deposit >= total) means paid in full.
  const depositAmount = parseFloat(deposit) || 0;
  const balanceOwing = salesBalanceOwing(totalPaid, depositAmount);
  const isLayaway = balanceOwing > 0;

  // Customer name is optional — a blank name checks out as a "Walk-in".
  const effectiveName = customerName.trim() || 'Walk-in';

  // $0 device safeguard: flag device lines priced at $0 and block checkout until
  // the seller ticks the override (guards against selling a device whose sale
  // price was never set).
  const isZeroPricedDevice = (l: CartLine) => isZeroPricedLine(l);
  const hasZeroPricedDevice = cartHasZeroPricedDevice(cart);
  const blockedByZeroPrice = hasZeroPricedDevice && !allowZeroPrice;

  // ---- mutations ----
  const addDevice = (i: InventoryItem) => {
    setCart(c => [...c, {
      key: uid(), inventoryId: i.id, kind: 'device', name: getDeviceDisplayName(i),
      code: i.sku || i.imei, quantity: 1, maxQty: 1, deviceType: i.deviceType,
      unitPrice: i.targetSalePrice || 0, purchaseCost: i.purchaseCost, repairCost: i.repairCost || 0,
      taxable: true, discount: 0,
    }]);
    setPicker(null); setSearch('');
  };
  const addAccessory = (i: InventoryItem) => {
    setCart(c => [...c, {
      key: uid(), inventoryId: i.id, kind: 'accessory', name: i.item,
      code: i.sku || i.manufacturerBarcode || '', quantity: 1, maxQty: i.quantity ?? 1,
      unitPrice: i.sellingPrice || 0, purchaseCost: i.costPerUnit || 0, repairCost: 0,
      taxable: true, discount: 0,
    }]);
    setPicker(null); setSearch('');
  };
  const updateLine = (key: string, patch: Partial<CartLine>) =>
    setCart(c => c.map(l => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key: string) => setCart(c => c.filter(l => l.key !== key));
  const num = (v: string) => parseFloat(v) || 0;

  const addCustomItem = () => {
    if (!custom.name.trim()) return;
    setCart(c => [...c, {
      key: uid(), inventoryId: '', kind: custom.category === 'device' ? 'device' : 'accessory',
      name: custom.name.trim(), code: custom.imei.trim(),
      quantity: Math.max(1, Math.round(num(custom.quantity)) || 1), maxQty: 9999,
      unitPrice: num(custom.unitPrice), purchaseCost: num(custom.costEstimate), repairCost: 0,
      taxable: custom.taxable, discount: 0,
      isCustom: true, category: custom.category,
      deviceType: custom.category === 'device' ? custom.deviceType : undefined,
      imei: custom.imei.trim() || undefined,
      notes: custom.notes.trim() || undefined, addToInventory: custom.addToInventory,
    }]);
    setCustom(emptyCustom());
    setShowCustom(false);
  };

  // Add an accessory (merging into an existing line) or a device from the typed
  // pick-list. Clears the search box + any "not found" message.
  const addScanResult = (i: InventoryItem) => {
    if (kindOf(i) === 'accessory') {
      const line = cart.find(l => l.inventoryId === i.id);
      if (line) updateLine(line.key, { quantity: Math.min(line.maxQty, line.quantity + 1) });
      else addAccessory(i);
    } else {
      addDevice(i);
    }
    setScan(''); setScanMsg(null);
  };

  // Typed-search fallback pick-list: substring matches when the value isn't an
  // exact scan. Bounded and reactive to the current input.
  const scanResults = searchCheckoutInventory(inventory, scan, {
    excludeIds: new Set<string>([...soldIds, ...inCart]),
    limit: 6,
  });

  // Checkout-eligible repairs: retail tickets that are still open (not
  // completed/cancelled/picked-up) and not already checked out via a sale — the
  // same set the ticket's Check Out button acts on. A repair already added to
  // this cart is excluded so it can't be added twice.
  const eligibleRepairs = useMemo(
    () => repairs.filter(r => r.type === 'retail' && isRepairOpen(r) && !r.salesTransactionId && r.id !== linkedRepairId),
    [repairs, linkedRepairId],
  );
  // Typed-search matches among those repairs (by repair #, customer, phone,
  // IMEI/serial, model, issue) — surfaced in the same pick-list as inventory.
  const repairMatches = scan.trim() ? eligibleRepairs.filter(r => matchesRepair(r, scan)).slice(0, 6) : [];

  // Add a ready repair to the cart (from the Quick Sale search) — same pre-fill
  // as the ticket's Check Out: a service line at the repair price (cost = parts)
  // plus the customer. Appends to the current cart rather than replacing it.
  const addRepair = (r: Repair) => {
    seedRepairPrefill(repairSalePrefill(r), false);
    setScan(''); setScanMsg(null);
  };

  const handleScan = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const q = v.toLowerCase();
    const eq = (a?: string) => (a || '').toLowerCase() === q;

    // Fast path: an exact SKU/IMEI/barcode match adds instantly (real scans).
    const device = inventory.find(i => kindOf(i) === 'device' && !soldIds.has(i.id) && !inCart.has(i.id) && (eq(i.sku) || eq(i.imei)));
    if (device) { addDevice(device); setScan(''); setScanMsg(null); return; }

    const acc = inventory.find(i => kindOf(i) === 'accessory' && (i.quantity ?? 0) > 0 && (eq(i.sku) || eq(i.manufacturerBarcode)));
    if (acc) {
      const line = cart.find(l => l.inventoryId === acc.id);
      if (line) updateLine(line.key, { quantity: Math.min(line.maxQty, line.quantity + 1) });
      else addAccessory(acc);
      setScan(''); setScanMsg(null); return;
    }

    // Exact repair match (repair number or device IMEI/serial) adds it instantly.
    const rep = eligibleRepairs.find(r => eq(r.repairNumber) || eq(r.imei));
    if (rep) { addRepair(rep); return; }

    // No exact match: leave the pick-list of substring matches visible (don't
    // auto-add — several items may match). Only warn when there's nothing at all.
    if (scanResults.length === 0 && repairMatches.length === 0) { setScanMsg(`No item found for "${v}"`); setScan(''); }
    else setScanMsg(null);
  };

  // ---- checkout ----
  const handleCheckout = async () => {
    if (cart.length === 0 || blockedByZeroPrice) return;
    const transactionId = uid();
    const soldRows: InventoryItem[] = [];
    const accessoryQtys: Record<string, number> = {};
    const newInventoryItems: InventoryItem[] = [];

    for (const l of cart) {
      const saleShare = lineSubtotal(l);
      const feeShare = subtotal > 0 ? platformFee * (saleShare / subtotal) : 0;
      const taxShare = l.taxable && taxableBase > 0 ? tax * (saleShare / taxableBase) : 0;
      const common = {
        transactionId, soldDate, soldTo: effectiveName,
        customerName: effectiveName, customerPhone, customerEmail, customerNotes,
        paymentMethod, taxCollected: taxShare,
        cashTaxStatus: paymentMethod === 'cash' ? cashTaxStatus : undefined,
        paymentNotes: paymentNotes || undefined,
        platformName, platformFeePercent: feePercent, platformFees: feeShare,
      };

      if (l.isCustom) {
        if (l.addToInventory && (l.category === 'device' || l.category === 'accessory')) {
          if (l.category === 'device') {
            const deviceType = l.deviceType || 'Other';
            // Give it a real SKU via the same allocator normal device intake uses
            // (not a blank one). Falls back to '' only if no generator is wired,
            // in which case the app fills it in on save.
            const sku = onGenerateSku ? await onGenerateSku(deviceType) : '';
            newInventoryItems.push({
              id: uid(), kind: 'device', sku, date: soldDate, item: l.name, imei: l.imei || '',
              boughtFrom: 'Custom sale', purchaseCost: l.purchaseCost, repairCost: 0,
              deviceType, condition: 'Good',
              salePrice: saleShare, notes: l.notes || 'Added from custom sale', ...common,
              // Layaway: hold the device (no sale date) until the balance is paid.
              deviceStatus: isLayaway ? 'reserved' : 'sold',
              soldDate: isLayaway ? '' : soldDate,
            } as InventoryItem);
          } else {
            newInventoryItems.push({
              id: uid(), kind: 'accessory', sku: '', date: soldDate, item: l.name, imei: '',
              boughtFrom: 'Custom sale', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
              category: 'Custom', quantity: 0, costPerUnit: l.purchaseCost, sellingPrice: l.unitPrice,
              lowStockThreshold: 3, notes: l.notes || 'Added from custom sale',
            } as InventoryItem);
          }
        }
        continue;
      }

      if (l.kind === 'accessory') {
        accessoryQtys[l.inventoryId] = (accessoryQtys[l.inventoryId] || 0) + l.quantity;
      } else {
        const existing = inventory.find(i => i.id === l.inventoryId);
        // Layaway: mark the device reserved and leave its sale date empty so it
        // isn't recognized as a completed sale until the balance is paid.
        if (existing) soldRows.push({
          ...existing, ...common, salePrice: saleShare,
          deviceStatus: isLayaway ? 'reserved' : 'sold',
          soldDate: isLayaway ? '' : soldDate,
        });
      }
    }

    const customer: Customer | undefined = customerName.trim()
      ? { id: (selectedCustomerId || customerPhone.trim() || customerName.trim().toLowerCase().replace(/\s+/g, '-')), name: customerName.trim(), phone: customerPhone.trim(), email: customerEmail.trim() || undefined, notes: customerNotes.trim() || undefined }
      : undefined;

    const transaction: SalesTransaction = {
      id: transactionId, date: soldDate,
      customerId: customer?.id, customerName: effectiveName, customerPhone: customerPhone || undefined, customerEmail: customerEmail || undefined,
      paymentMethod,
      cashAmount: paymentMethod === 'mixed' ? (parseFloat(cashAmount) || 0) : undefined,
      cardAmount: paymentMethod === 'mixed' ? (parseFloat(cardAmount) || 0) : undefined,
      etransferAmount: paymentMethod === 'mixed' ? (parseFloat(etransferAmount) || 0) : undefined,
      platformName,
      subtotal, tax, platformFee, purchaseCost: purchaseCostTotal, repairCost: repairCostTotal,
      totalCost, totalPaid, netProfit,
      deposit: isLayaway ? depositAmount : undefined,
      balanceOwing: isLayaway ? balanceOwing : undefined,
      lines: cart.map(l => ({ inventoryId: l.inventoryId, kind: l.kind, name: l.name, sku: l.code, quantity: l.quantity, unitPrice: l.unitPrice, deviceType: l.kind === 'device' ? l.deviceType : undefined })),
      notes: paymentNotes || undefined,
      repairId: linkedRepairId,
    };

    onComplete({ soldRows, accessoryQtys, transaction, customer, newInventoryItems });
    setLastTx(transaction);
    setConfirmed(true);
    // Opt-in auto-print: only when the tech ticked "Print receipt" at checkout.
    // Prints the just-built transaction (state's lastTx isn't set yet this tick).
    if (printReceiptOnComplete) printReceipt(transaction);
  };

  const reset = () => {
    setCart([]); setLinkedRepairId(undefined); setCustomerName(''); setCustomerPhone(''); setCustomerEmail(''); setCustomerNotes(''); setSelectedCustomerId(undefined);
    setPaymentNotes(''); setPaymentMethod('cash'); setCashTaxStatus('none');
    setCashAmount(''); setCardAmount(''); setEtransferAmount(''); setTaxCollected(''); setDeposit('');
    setPlatformName('None / In-Store'); setPlatformFeePercent('0');
    setLastTx(null); setShowTx(false); setConfirmed(false);
    setCustom(emptyCustom()); setShowCustom(false); setAllowZeroPrice(false);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  // Print the thermal receipt via the shared service (same output as the
  // reprint-from-history action). Defaults to the just-completed sale.
  const printReceipt = (tx: SalesTransaction | null = lastTx) => {
    if (!tx) return;
    printSalesReceipt(tx, { storeName: getStoreProfile().storeName });
  };

  // Print a formal, full-page (8.5×11) invoice suitable for a business/wholesale
  // buyer. Same transaction data as the receipt, but with the real Store Profile
  // header (name, logo, address, contact, business/tax number) pulled from the
  // cached AppSettings.general. The invoice number reuses the transaction id —
  // it's already unique per sale, so no separate invoice counter is introduced.
  const printInvoice = () => {
    if (!lastTx) return;
    const store = getStoreProfile();
    const esc = (v?: string) => (v || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const money = (n: number) => `$${(n || 0).toFixed(2)}`;
    const rows = lastTx.lines.map(l => `<tr>
        <td>${esc(l.name)}${l.sku ? `<br/><span class="sub">${esc(l.sku)}</span>` : ''}</td>
        <td class="c">${l.quantity}</td>
        <td class="r">${money(l.unitPrice)}</td>
        <td class="r">${money(l.quantity * l.unitPrice)}</td>
      </tr>`).join('');
    const payParts = lastTx.paymentMethod === 'mixed'
      ? [['Cash', lastTx.cashAmount], ['Card', lastTx.cardAmount], ['E-transfer', lastTx.etransferAmount]].filter(([, v]) => v).map(([k, v]) => `${k}: ${money(Number(v))}`).join(' · ')
      : (lastTx.paymentMethod || '');
    const contact = [store.address, store.phone, store.email, store.website, store.businessNumber && `Business #: ${store.businessNumber}`]
      .filter(Boolean).map(v => `<div>${esc(String(v))}</div>`).join('');
    const win = window.open('', '_blank', 'width=800,height=1000');
    if (!win) return;
    win.document.write(`<html><head><title>Invoice ${esc(lastTx.id)}</title>
      <style>
        *{box-sizing:border-box;} body{font-family:'Inter',system-ui,Arial,sans-serif;color:#111;max-width:8.5in;margin:0 auto;padding:0.6in;font-size:13px;}
        .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:20px;}
        .store h1{margin:0 0 4px;font-size:22px;} .store .sub,.store div{color:#555;font-size:11px;line-height:1.5;}
        .logo{max-height:64px;max-width:180px;object-fit:contain;margin-bottom:8px;}
        .inv{text-align:right;} .inv h2{margin:0 0 6px;font-size:26px;letter-spacing:1px;color:#333;}
        .inv .meta{font-size:12px;color:#555;line-height:1.6;}
        .bill{margin-bottom:18px;} .bill .label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:2px;}
        .bill .who{font-size:15px;font-weight:700;}
        table{width:100%;border-collapse:collapse;margin-bottom:16px;} th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#666;border-bottom:1px solid #ccc;padding:6px 8px;}
        td{padding:8px;border-bottom:1px solid #eee;vertical-align:top;} td.c{text-align:center;} td.r{text-align:right;} .sub{color:#888;font-size:10px;}
        .totals{width:280px;margin-left:auto;font-size:13px;} .totals .row{display:flex;justify-content:space-between;padding:4px 8px;}
        .totals .grand{border-top:2px solid #111;font-weight:800;font-size:15px;margin-top:4px;padding-top:8px;}
        .totals .owe{color:#b45309;font-weight:800;}
        .pay{margin-top:20px;font-size:12px;color:#555;} .foot{margin-top:36px;text-align:center;color:#888;font-size:11px;border-top:1px solid #eee;padding-top:12px;}
      </style></head>
      <body>
        <div class="top">
          <div class="store">
            ${store.logoUrl ? `<img class="logo" src="${esc(store.logoUrl)}" alt="${esc(store.storeName)}"/>` : ''}
            <h1>${esc(store.storeName)}</h1>
            ${contact}
          </div>
          <div class="inv">
            <h2>INVOICE</h2>
            <div class="meta">Invoice #: ${esc(lastTx.id)}<br/>Date: ${esc(lastTx.date)}</div>
          </div>
        </div>
        <div class="bill">
          <div class="label">Bill To</div>
          <div class="who">${esc(lastTx.customerName || 'Walk-in')}</div>
          ${lastTx.customerPhone ? `<div class="sub">${esc(lastTx.customerPhone)}</div>` : ''}
          ${lastTx.customerEmail ? `<div class="sub">${esc(lastTx.customerEmail)}</div>` : ''}
        </div>
        <table>
          <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="totals">
          <div class="row"><span>Subtotal</span><span>${money(lastTx.subtotal)}</span></div>
          <div class="row"><span>Tax</span><span>${money(lastTx.tax)}</span></div>
          ${lastTx.platformFee ? `<div class="row"><span>Platform fee</span><span>-${money(lastTx.platformFee)}</span></div>` : ''}
          <div class="row grand"><span>Total</span><span>${money(lastTx.totalPaid)}</span></div>
          ${lastTx.balanceOwing ? `<div class="row"><span>Deposit paid</span><span>${money(lastTx.deposit || 0)}</span></div><div class="row owe"><span>Balance owing</span><span>${money(lastTx.balanceOwing)}</span></div>` : ''}
        </div>
        <div class="pay">Payment method: ${esc(payParts)}${lastTx.notes ? ` · ${esc(lastTx.notes)}` : ''}</div>
        <div class="foot">Thank you for your business!${store.website ? ` · ${esc(store.website)}` : ''}</div>
        <script>window.onload=function(){window.print();};</script>
      </body></html>`);
    win.document.close();
  };

  // Email the receipt via a prefilled mailto: link — no backend required, opens
  // the user's own mail client with the customer's captured email pre-addressed.
  // (Limitation: it composes a draft in their client rather than sending
  // server-side; a real transactional-email sender would be a follow-up.)
  const emailReceipt = () => {
    if (!lastTx) return;
    const lines = lastTx.lines.map(l => `- ${l.quantity} x ${l.name} — $${(l.quantity * l.unitPrice).toFixed(2)}`).join('\n');
    const body = [
      `Receipt ${lastTx.id}`,
      lastTx.date,
      '',
      lines,
      '',
      `Subtotal: $${lastTx.subtotal.toFixed(2)}`,
      `Tax: $${lastTx.tax.toFixed(2)}`,
      `Total: $${lastTx.totalPaid.toFixed(2)}`,
      ...(lastTx.balanceOwing ? [`Deposit paid: $${(lastTx.deposit || 0).toFixed(2)}`, `Balance owing: $${lastTx.balanceOwing.toFixed(2)}`] : []),
      '',
      'Thank you for your business!',
      'FlipThatTech',
    ].join('\n');
    const subject = `Your FlipThatTech receipt (${lastTx.date})`;
    const to = encodeURIComponent(lastTx.customerEmail || '');
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const soldDeviceRows = cart.filter(l => l.kind === 'device').map(l => inventory.find(i => i.id === l.inventoryId)).filter(Boolean) as InventoryItem[];

  return {
    customers,
    cart, setCart, picker, setPicker, search, setSearch, confirmed, setConfirmed,
    platformName, setPlatformName, platformFeePercent, setPlatformFeePercent, soldDate, setSoldDate,
    customerName, setCustomerName, customerPhone, setCustomerPhone, customerEmail, setCustomerEmail,
    customerNotes, setCustomerNotes, selectedCustomerId, setSelectedCustomerId,
    paymentMethod, setPaymentMethod, cashTaxStatus, setCashTaxStatus, paymentNotes, setPaymentNotes,
    cashAmount, setCashAmount, cardAmount, setCardAmount, etransferAmount, setEtransferAmount, taxCollected, setTaxCollected,
    deposit, setDeposit, depositAmount, balanceOwing, isLayaway, effectiveName,
    scan, setScan, scanMsg, setScanMsg, scanRef, lastTx, showTx, setShowTx, labelItem, setLabelItem,
    emptyCustom, showCustom, setShowCustom, custom, setCustom,
    taxRate, feePercent, previousPurchases, availableDevices, availableAccessories,
    lineSubtotal, subtotal, discountTotal, purchaseCostTotal, repairCostTotal, totalCost, taxableBase, taxApplies, tax, platformFee, totalPaid, netProfit,
    isZeroPricedDevice, hasZeroPricedDevice, allowZeroPrice, setAllowZeroPrice, blockedByZeroPrice,
    addDevice, addAccessory, updateLine, removeLine, num, addCustomItem, handleScan, handleCheckout, reset, printReceipt, printInvoice, emailReceipt, soldDeviceRows,
    scanResults, addScanResult,
    eligibleRepairs, repairMatches, addRepair,
    printReceiptOnComplete, setPrintReceiptOnComplete,
  };
}

export type CheckoutCtx = ReturnType<typeof useCheckout>;
