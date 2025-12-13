import { InventoryItem } from './types';

export const DEFAULT_PIN = '2522';

export const INITIAL_DATA: InventoryItem[] = [
  // September 2025
  {
    id: '101',
    date: '2025-09-01',
    item: 'iPhone 15 Pro 128GB',
    imei: '357891234567890',
    boughtFrom: 'OfferUp',
    purchaseCost: 650,
    repairCost: 0,
    soldDate: '2025-09-12',
    soldTo: 'Alice M.',
    salePrice: 850,
    notes: 'Quick flip, battery 95%.'
  },
  {
    id: '102',
    date: '2025-09-05',
    item: 'MacBook Air M3',
    imei: 'FVFX1234HJKL',
    boughtFrom: 'University Sale',
    purchaseCost: 800,
    repairCost: 0,
    soldDate: '2025-09-25',
    soldTo: 'Student',
    salePrice: 1100,
    notes: 'Mint condition w/ box.'
  },
  {
    id: '103',
    date: '2025-09-15',
    item: 'Sony PS5 Slim',
    imei: '001122334455',
    boughtFrom: 'Local Pawn',
    purchaseCost: 300,
    repairCost: 20,
    soldDate: '2025-09-28',
    soldTo: 'GamerGuy99',
    salePrice: 450,
    notes: 'Cleaned dust, repasted.'
  },
  
  // October 2025
  {
    id: '104',
    date: '2025-10-02',
    item: 'Samsung Galaxy S25',
    imei: '998877665544332',
    boughtFrom: 'Trade-In Program',
    purchaseCost: 500,
    repairCost: 150,
    soldDate: '2025-10-20',
    soldTo: 'Tech Resale Shop',
    salePrice: 800,
    notes: 'Cracked back glass replaced.'
  },
  {
    id: '105',
    date: '2025-10-10',
    item: 'Dell XPS 15 9530',
    imei: 'XYZ98765',
    boughtFrom: 'Office Liquidation',
    purchaseCost: 700,
    repairCost: 0,
    soldDate: '2025-10-15',
    soldTo: 'Business Client',
    salePrice: 1000,
    notes: 'Bulk buy deal.'
  },
  {
    id: '106',
    date: '2025-10-25',
    item: 'iPad Pro 12.9 M2',
    imei: 'DMPQ5678',
    boughtFrom: 'Facebook Marketplace',
    purchaseCost: 600,
    repairCost: 0,
    soldDate: '2025-11-05',
    soldTo: 'Artist',
    salePrice: 900,
    notes: 'Included Apple Pencil.'
  },

  // November 2025
  {
    id: '107',
    date: '2025-11-01',
    item: 'Nvidia RTX 5080 GPU',
    imei: 'SN-NV-5080-123',
    boughtFrom: 'Gamer Upgrade',
    purchaseCost: 900,
    repairCost: 0,
    soldDate: '2025-11-10',
    soldTo: 'Crypto Miner',
    salePrice: 1300,
    notes: 'Hot item.'
  },
  {
    id: '108',
    date: '2025-11-15',
    item: 'iPhone 16 (Base)',
    imei: '351111111111111',
    boughtFrom: 'Carrier Promo',
    purchaseCost: 750,
    repairCost: 0,
    soldDate: '2025-11-29', // Black Friday sale
    soldTo: 'Gift Buyer',
    salePrice: 950,
    notes: 'Sealed box.'
  },
  {
    id: '109',
    date: '2025-11-20',
    item: 'Canon EOS R6 Mark II',
    imei: '2345678901',
    boughtFrom: 'Photographer',
    purchaseCost: 1500,
    repairCost: 100,
    soldDate: '2025-12-05',
    soldTo: 'Studio',
    salePrice: 2100,
    notes: 'Sensor cleaning required.'
  },

  // December 2025
  {
    id: '110',
    date: '2025-12-01',
    item: 'Nintendo Switch 2',
    imei: 'XKW-9999999',
    boughtFrom: 'Retail',
    purchaseCost: 400,
    repairCost: 0,
    soldDate: '2025-12-15',
    soldTo: 'Parent (Xmas)',
    salePrice: 600,
    notes: 'Scalped? No, just good timing.'
  },
  {
    id: '111',
    date: '2025-12-10',
    item: 'MacBook Pro 16 M4 Max',
    imei: 'C02ZZZ999',
    boughtFrom: 'Tech Startup Closing',
    purchaseCost: 2500,
    repairCost: 0,
    soldDate: '', // Still in inventory
    soldTo: '',
    salePrice: 0,
    notes: 'High value asset, holding for Jan.'
  },
  {
    id: '112',
    date: '2025-12-15',
    item: 'Apple Watch Ultra 3',
    imei: 'H4X0R1337',
    boughtFrom: 'Prize Winner',
    purchaseCost: 600,
    repairCost: 0,
    soldDate: '2025-12-24',
    soldTo: 'Last Minute Shopper',
    salePrice: 850,
    notes: 'Sold on Xmas Eve.'
  },
  {
    id: '113',
    date: '2025-12-28',
    item: 'Broken iPhone 14',
    imei: '359999999999',
    boughtFrom: 'E-waste pile',
    purchaseCost: 50,
    repairCost: 200,
    soldDate: '', // In repair
    soldTo: '',
    salePrice: 0,
    notes: 'Needs new screen and battery.'
  }
];