import { describe, it, expect } from 'vitest';
import { DevicePhoto, InventoryItem } from '../types';
import {
  MAX_DEVICE_PHOTOS, STOCK_PHOTO_NOTE, canAddPhoto, damagePhotoPrompt, hasRealPhoto,
  mainPhoto, orderedPhotos, photoCredit, photoNote, photoPath, removePhoto,
  setMainPhoto, thumbPath, wantsDamagePhoto,
} from './devicePhotos';

const photo = (p: Partial<DevicePhoto> = {}): DevicePhoto => ({
  id: 'p1', url: 'https://x/p1.jpg', kind: 'real', addedBy: 'u1', addedAt: 1, ...p,
});

const stock = (p: Partial<DevicePhoto> = {}) =>
  photo({ id: 's1', kind: 'stock', credit: 'Someone / Wikimedia Commons / CC BY-SA 4.0', ...p });

describe('which photo is the main one', () => {
  it('A REAL PHOTO ALWAYS BEATS A STOCK ONE, whatever the order says', () => {
    // This is what makes "a real photo takes priority everywhere" true without
    // anybody remembering to delete the placeholder.
    const list = [stock(), photo({ id: 'r1' })];
    expect(mainPhoto(list)?.id).toBe('r1');
  });

  it('within a kind, the stored order wins — so "set as main" works', () => {
    const list = [photo({ id: 'r1' }), photo({ id: 'r2' })];
    expect(mainPhoto(list)?.id).toBe('r1');
    expect(mainPhoto(setMainPhoto(list, 'r2'))?.id).toBe('r2');
  });

  it('falls back to the stock photo when that is all there is', () => {
    expect(mainPhoto([stock()])?.id).toBe('s1');
  });

  it('no photos is null, not a crash', () => {
    expect(mainPhoto([])).toBeNull();
    expect(mainPhoto(undefined)).toBeNull();
  });

  it('orders real photos ahead of stock ones for the gallery', () => {
    const list = [stock({ id: 's1' }), photo({ id: 'r1' }), stock({ id: 's2' }), photo({ id: 'r2' })];
    expect(orderedPhotos(list).map(p => p.id)).toEqual(['r1', 'r2', 's1', 's2']);
  });
});

describe('editing the list', () => {
  it('set-as-main moves one to the front and keeps the rest in order', () => {
    const list = [photo({ id: 'a' }), photo({ id: 'b' }), photo({ id: 'c' })];
    expect(setMainPhoto(list, 'c').map(p => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('set-as-main on a photo that is not there changes nothing', () => {
    const list = [photo({ id: 'a' })];
    expect(setMainPhoto(list, 'zzz')).toBe(list);
  });

  it('removes by id', () => {
    const list = [photo({ id: 'a' }), photo({ id: 'b' })];
    expect(removePhoto(list, 'a').map(p => p.id)).toEqual(['b']);
  });

  it('caps at six', () => {
    expect(MAX_DEVICE_PHOTOS).toBe(6);
    const six = Array.from({ length: 6 }, (_, i) => photo({ id: `p${i}` }));
    expect(canAddPhoto(six.slice(0, 5))).toBe(true);
    expect(canAddPhoto(six)).toBe(false);
    expect(canAddPhoto(undefined)).toBe(true);
  });
});

describe('what a customer is told', () => {
  it('a STOCK photo is labelled — it is a picture of the model, not of this one', () => {
    expect(photoNote(stock())).toBe(STOCK_PHOTO_NOTE);
    expect(STOCK_PHOTO_NOTE).toMatch(/actual device may vary/i);
  });

  it('a REAL photo is labelled nothing — a label on everything is read by nobody', () => {
    expect(photoNote(photo())).toBeNull();
    expect(photoNote(null)).toBeNull();
  });

  it('a stock photo carries its credit, because CC-BY requires it', () => {
    expect(photoCredit(stock())).toBe('Someone / Wikimedia Commons / CC BY-SA 4.0');
  });

  it('a real photo needs no credit — the shop took it', () => {
    expect(photoCredit(photo({ credit: 'ignored' }))).toBeNull();
  });
});

describe('the damage-photo nudge', () => {
  const device = (over: Partial<InventoryItem> = {}) =>
    ({ kind: 'device', condition: 'Good', photos: [], ...over }) as InventoryItem;

  it('asks when the grade says there is something to see', () => {
    for (const condition of ['Excellent', 'Good', 'Fair', 'For Parts']) {
      expect({ condition, asks: wantsDamagePhoto(device({ condition })) })
        .toEqual({ condition, asks: true });
    }
  });

  it('does NOT ask about a clean one', () => {
    for (const condition of ['New', 'Like New']) {
      expect({ condition, asks: wantsDamagePhoto(device({ condition })) })
        .toEqual({ condition, asks: false });
    }
  });

  it('stops asking once there is a real photo — the question is answered', () => {
    expect(wantsDamagePhoto(device({ condition: 'Fair', photos: [photo()] }))).toBe(false);
    // A stock photo does NOT answer it: it shows no marks at all.
    expect(wantsDamagePhoto(device({ condition: 'Fair', photos: [stock()] }))).toBe(true);
  });

  it('never asks about an accessory, or about a device with no grade yet', () => {
    expect(wantsDamagePhoto(device({ kind: 'accessory', condition: 'Fair' }))).toBe(false);
    expect(wantsDamagePhoto(device({ condition: '' }))).toBe(false);
    expect(wantsDamagePhoto(device({ condition: undefined }))).toBe(false);
  });

  it('names the grade in the prompt, so it reads as being about this device', () => {
    expect(damagePhotoPrompt('Fair')).toContain('Fair');
    expect(damagePhotoPrompt('Fair')).not.toContain('{condition}');
  });

  it('is a NUDGE — it returns a question, never a refusal', () => {
    expect(typeof wantsDamagePhoto(device({ condition: 'Fair' }))).toBe('boolean');
    expect(damagePhotoPrompt('Fair')).toMatch(/want to add one/i);
  });
});

describe('storage paths', () => {
  it('put the uploader and the deleter in the same place', () => {
    expect(photoPath('ws1', 'item1', 'p1')).toBe('deviceImages/ws1/item1/p1.jpg');
    expect(thumbPath('ws1', 'item1', 'p1')).toBe('deviceImages/ws1/item1/p1_thumb.jpg');
  });

  it('stay under the one public prefix, never beside the backups', () => {
    expect(photoPath('ws1', 'i', 'p')).toMatch(/^deviceImages\//);
    expect(photoPath('ws1', 'i', 'p')).not.toMatch(/backups/);
  });

  it('hasRealPhoto answers the question the nudge and the kiosk both ask', () => {
    expect(hasRealPhoto([stock()])).toBe(false);
    expect(hasRealPhoto([stock(), photo()])).toBe(true);
    expect(hasRealPhoto(undefined)).toBe(false);
  });
});
