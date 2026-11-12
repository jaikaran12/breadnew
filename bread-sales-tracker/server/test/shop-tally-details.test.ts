import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanGstin, cleanPincode, gstinCheckChar } from '../src/util/gst.js';
import { seedBasics, setupTestApp, uuid, type TestContext } from './helpers.js';

let ctx: TestContext;
let s: Awaited<ReturnType<typeof seedBasics>>;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

// A made-up GSTIN for Jammu & Kashmir (state code 01) with a correct check character.
const GSTIN = `01ABCDE1234F1Z${gstinCheckChar('01ABCDE1234F1Z')}`;

beforeAll(async () => {
  ctx = await setupTestApp();
  s = await seedBasics(ctx.app);
});

afterAll(() => {
  ctx.close();
});

describe('GSTIN and pincode checks', () => {
  it('accepts real GSTINs and catches typing mistakes', () => {
    // The sample GSTIN printed in the GST documentation
    expect(cleanGstin('27AAPFU0939F1ZV')).toEqual({ value: '27AAPFU0939F1ZV' });
    expect(cleanGstin(' 27aapfu0939f1zv ')).toEqual({ value: '27AAPFU0939F1ZV' });
    expect(cleanGstin('27 AAPFU 0939 F1ZV')).toEqual({ value: '27AAPFU0939F1ZV' });
    expect(GSTIN).toBe('01ABCDE1234F1ZE');
    expect(cleanGstin('27AAPFU0939F1ZW').error).toMatch(/typing mistake/);
    expect(cleanGstin('27AAPFU0939F1Z').error).toMatch(/15 letters/);
    expect(cleanGstin('AAPFU0939F')).toMatchObject({ value: null });
    expect(cleanGstin('')).toEqual({ value: null });
    expect(cleanGstin(null)).toEqual({ value: null });
  });

  it('accepts 6-digit pincodes', () => {
    expect(cleanPincode('180001')).toEqual({ value: '180001' });
    expect(cleanPincode(' 180 001 ')).toEqual({ value: '180001' });
    expect(cleanPincode(180001)).toEqual({ value: '180001' });
    expect(cleanPincode('')).toEqual({ value: null });
    expect(cleanPincode('18000').error).toMatch(/6 digits/);
    expect(cleanPincode('080001').error).toMatch(/6 digits/);
    expect(cleanPincode('18000a').error).toMatch(/6 digits/);
  });
});

describe('shop pincode and GSTIN', () => {
  it('saves them with a shop, cleaned up, and can change or clear them', async () => {
    const created = await s.admin
      .post('/api/admin/stores')
      .send({ areaId: s.area.id, name: 'New Kirana Store', address: 'Main Bazar', pincode: '180 011', gstin: ' 01abcde1234f1ze ' })
      .expect(201);
    expect(created.body.store).toMatchObject({ pincode: '180011', gstin: GSTIN, address: 'Main Bazar' });
    const id = created.body.store.id;

    // Other edits keep them
    const renamed = await s.admin.put(`/api/admin/stores/${id}`).send({ ownerName: 'Owner' }).expect(200);
    expect(renamed.body.store).toMatchObject({ pincode: '180011', gstin: GSTIN });
    // Empty clears them
    const cleared = await s.admin.put(`/api/admin/stores/${id}`).send({ gstin: '', pincode: null }).expect(200);
    expect(cleared.body.store).toMatchObject({ pincode: null, gstin: null });
    const set = await s.admin.put(`/api/admin/stores/${id}`).send({ gstin: GSTIN, pincode: '180011' }).expect(200);
    expect(set.body.store).toMatchObject({ pincode: '180011', gstin: GSTIN });

    // The shop list and the shop page show them
    const list = await s.admin.get('/api/admin/stores').query({ q: 'new kirana' }).expect(200);
    expect(list.body.stores[0]).toMatchObject({ pincode: '180011', gstin: GSTIN });
    const detail = await s.admin.get(`/api/admin/stores/${id}`).expect(200);
    expect(detail.body.store).toMatchObject({ pincode: '180011', gstin: GSTIN });
  });

  it('refuses a wrong GSTIN or pincode and changes nothing', async () => {
    const bad = await s.admin
      .post('/api/admin/stores')
      .send({ areaId: s.area.id, name: 'Typo Store', gstin: '01ABCDE1234F1ZX' })
      .expect(400);
    expect(bad.body.error).toMatch(/gstin: This GSTIN has a typing mistake/);
    const pin = await s.admin.post('/api/admin/stores').send({ areaId: s.area.id, name: 'Typo Store', pincode: '1800' }).expect(400);
    expect(pin.body.error).toMatch(/pincode: Pincode should be 6 digits/);
    await s.admin.put(`/api/admin/stores/${s.store.id}`).send({ gstin: 'NOT-A-GSTIN' }).expect(400);
    const store = await s.admin.get(`/api/admin/stores/${s.store.id}`).expect(200);
    expect(store.body.store.gstin).toBeNull();
  });

  it('imports Pincode and GSTIN columns from a shop list', async () => {
    const csv = [
      'Area,Shop name,Address,Pincode,GSTIN',
      `Gandhi Nagar,Imported One,Main road,180004,${GSTIN.toLowerCase()}`,
      'Gandhi Nagar,Imported Two,,,',
      'Gandhi Nagar,Imported Three,,18000,',
    ].join('\n');
    const res = await s.admin.post('/api/admin/stores/import').send({ csv }).expect(200);
    expect(res.body).toMatchObject({ storesCreated: 2, errors: [{ line: 4, message: 'Pincode should be 6 digits, like 180001' }] });
    const one = (await s.admin.get('/api/admin/stores').query({ q: 'Imported One' }).expect(200)).body.stores[0];
    expect(one).toMatchObject({ pincode: '180004', gstin: GSTIN, address: 'Main road' });
    const two = (await s.admin.get('/api/admin/stores').query({ q: 'Imported Two' }).expect(200)).body.stores[0];
    expect(two).toMatchObject({ pincode: null, gstin: null });
  });

  it('fills in Pincode and GSTIN of shops already in the list from an imported sheet', async () => {
    // e.g. the downloaded shop list with the two columns filled in Excel
    const csv = [
      'Area,Shop name,Owner,Pincode,GSTIN,Active',
      `Gandhi Nagar,Imported Two,Someone,180002,${GSTIN}, yes`,
      'Gandhi Nagar,Imported One,,,,yes',
      'Gandhi Nagar,Sharma Kirana,,180003,,yes',
    ].join('\n');
    const check = await s.admin.post('/api/admin/stores/import').send({ csv, dryRun: true }).expect(200);
    expect(check.body).toMatchObject({ storesCreated: 0, updatedExisting: 2, skippedExisting: 1, errors: [] });
    const res = await s.admin.post('/api/admin/stores/import').send({ csv }).expect(200);
    expect(res.body).toMatchObject({ storesCreated: 0, updatedExisting: 2, skippedExisting: 1 });
    const find = async (q: string) => (await s.admin.get('/api/admin/stores').query({ q }).expect(200)).body.stores[0];
    // Only pincode and GSTIN change; empty cells keep what is saved; other columns are not touched
    expect(await find('Imported Two')).toMatchObject({ pincode: '180002', gstin: GSTIN, ownerName: null });
    expect(await find('Imported One')).toMatchObject({ pincode: '180004', gstin: GSTIN });
    expect(await find('Sharma Kirana')).toMatchObject({ pincode: '180003', gstin: null });
    // Importing the same sheet again changes nothing
    const again = await s.admin.post('/api/admin/stores/import').send({ csv, dryRun: true }).expect(200);
    expect(again.body).toMatchObject({ updatedExisting: 0, skippedExisting: 3 });
  });

  it('gives the shop details with each bill in the export (for the Tally file)', async () => {
    const shop = (await s.admin.get('/api/admin/stores').query({ q: 'new kirana' }).expect(200)).body.stores[0];
    await request(ctx.app)
      .post('/api/driver/sales')
      .set({ Authorization: `Bearer ${s.token}` })
      .send({
        clientId: uuid(),
        storeId: shop.id,
        paymentMode: 'cash',
        items: [{ productId: s.milk.id, quantity: 2, unitPricePaise: 4000 }],
        totalPaise: 8000,
      })
      .expect(201);
    const page = (await s.admin.get('/api/admin/sales/export').query({ date: today() }).expect(200)).body;
    expect(page.sales).toHaveLength(1);
    expect(page.sales[0]).toMatchObject({
      storeName: 'New Kirana Store',
      storeAddress: 'Main Bazar',
      storePincode: '180011',
      storeGstin: GSTIN,
      items: [{ productName: 'Milk Bread', quantity: 2, unitPricePaise: 4000, lineTotalPaise: 8000 }],
    });
  });
});
