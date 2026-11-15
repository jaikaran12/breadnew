import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { distanceM, judgeVisit, weekday } from '../src/services/geo.js';
import { parseLatLng } from '../src/util/latlng.js';
import { seedBasics, setupTestApp, uuid, type TestContext } from './helpers.js';

let ctx: TestContext;
let s: Awaited<ReturnType<typeof seedBasics>>;
let token2: string;
let driver2: { id: number };
const auth = (t = s.token) => ({ Authorization: `Bearer ${t}` });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

// Sharma Kirana sits at SHOP; 0.00045° of latitude ≈ 50 m, 0.009° ≈ 1 km.
const SHOP = { lat: 32.73, lng: 74.86 };
const near = (m: number) => ({ lat: SHOP.lat + (m / 50) * 0.00045, lng: SHOP.lng, accuracy: 12, at: new Date().toISOString() });

beforeAll(async () => {
  ctx = await setupTestApp();
  s = await seedBasics(ctx.app);
  driver2 = (await s.admin.post('/api/admin/drivers').send({ name: 'Suresh', phone: '9000000002', pin: '2222' }).expect(201)).body.driver;
  token2 = (await request(ctx.app).post('/api/driver/login').send({ phone: '9000000002', pin: '2222' }).expect(200)).body.token;
});

afterAll(() => {
  ctx.close();
});

const bill = (storeId: number, extra: object = {}) => ({
  clientId: uuid(),
  storeId,
  paymentMode: 'cash',
  items: [{ productId: s.milk.id, quantity: 1, unitPricePaise: 4000 }],
  totalPaise: 4000,
  ...extra,
});

describe('distances and verdicts (same file on the phone)', () => {
  it('measures metres and judges a visit', () => {
    expect(distanceM(SHOP, SHOP)).toBe(0);
    expect(distanceM(SHOP, { lat: SHOP.lat + 0.009, lng: SHOP.lng })).toBe(1001);
    expect(distanceM(SHOP, { lat: SHOP.lat, lng: SHOP.lng + 0.01 })).toBe(935); // shorter east–west at this latitude
    expect(judgeVisit(near(50), SHOP, 100)).toEqual({ status: 'ok', distanceM: 50 });
    expect(judgeVisit(near(150), SHOP, 100)).toEqual({ status: 'far', distanceM: 150 });
    expect(judgeVisit(null, SHOP, 100)).toEqual({ status: 'no_gps', distanceM: null });
    expect(judgeVisit(near(10), null, 100)).toEqual({ status: 'no_shop_location', distanceM: null });
    expect(judgeVisit(null, null, 100).status).toBe('no_gps');
    expect([weekday('2026-11-16'), weekday('2026-11-21'), weekday('2026-11-22')]).toEqual([1, 6, 7]); // Mon, Sat, Sun
  });

  it('has identical copies of geo.ts and latlng.ts', async () => {
    const fs = await import('node:fs');
    const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
    expect(read('../../driver-app/src/geo.ts')).toBe(read('../src/services/geo.ts'));
    expect(read('../../admin-web/src/geo.ts')).toBe(read('../src/services/geo.ts'));
    expect(read('../../admin-web/src/latlng.ts')).toBe(read('../src/util/latlng.ts'));
  });

  it('reads a pasted location or Google Maps link', () => {
    expect(parseLatLng('32.7311, 74.8573')).toEqual({ lat: 32.7311, lng: 74.8573 });
    expect(parseLatLng('https://www.google.com/maps/place/X/@32.7299,74.8611,17z/data=!3m1!4b1!3d32.7311!4d74.8573')).toEqual({
      lat: 32.7311,
      lng: 74.8573,
    });
    expect(parseLatLng('https://www.google.com/maps/search/?api=1&query=32.7311%2C74.8573')).toEqual({ lat: 32.7311, lng: 74.8573 });
    expect(parseLatLng('https://maps.app.goo.gl/abc')).toBeNull();
    expect(parseLatLng('0,0')).toBeNull();
  });
});

describe('shop locations and the allowed distance', () => {
  it('has a default distance of 100 m that the owner can change; phones get it with the lists', async () => {
    const before = (await request(ctx.app).get('/api/driver/catalog').set(auth()).expect(200)).body;
    expect(before.visitRadiusM).toBe(100);
    await s.admin.put('/api/admin/settings').send({ visitRadiusM: 10 }).expect(400);
    const set = await s.admin.put('/api/admin/settings').send({ visitRadiusM: 120 }).expect(200);
    expect(set.body.settings.visitRadiusM).toBe(120);
    const after = (await request(ctx.app).get('/api/driver/catalog').set(auth()).expect(200)).body;
    expect(after.visitRadiusM).toBe(120);
    expect(after.version).not.toBe(before.version);
    await s.admin.put('/api/admin/settings').send({ visitRadiusM: 100 }).expect(200);
  });

  it('owner sets, clears and confirms locations; a driver may save one only where none exists', async () => {
    const set = await s.admin.put(`/api/admin/stores/${s.store.id}`).send({ location: SHOP }).expect(200);
    expect(set.body.store).toMatchObject({ lat: SHOP.lat, lng: SHOP.lng, locationStatus: 'owner', locationByDriverName: null });
    const cat = (await request(ctx.app).get('/api/driver/catalog').set(auth()).expect(200)).body;
    expect(cat.stores.find((x: { id: number }) => x.id === s.store.id)).toMatchObject({ lat: SHOP.lat, lng: SHOP.lng, locationStatus: 'owner' });
    // The phone cannot change a location the owner set
    await request(ctx.app).post(`/api/driver/stores/${s.store.id}/location`).set(auth()).send(near(500)).expect(409);

    // A shop without a location: the driver at the shop saves it; it waits for the owner's check
    await request(ctx.app).post(`/api/driver/stores/${s.store2.id}/location`).set(auth()).send({ lat: 32.8, lng: 74.9, accuracy: 300 }).expect(400);
    const saved = await request(ctx.app).post(`/api/driver/stores/${s.store2.id}/location`).set(auth()).send({ lat: 32.8, lng: 74.9, accuracy: 15 }).expect(200);
    expect(saved.body.store).toMatchObject({ lat: 32.8, lng: 74.9, locationStatus: 'driver' });
    await request(ctx.app).post(`/api/driver/stores/${s.store2.id}/location`).set(auth(token2)).send({ lat: 32.9, lng: 74.9, accuracy: 5 }).expect(409);
    const toCheck = (await s.admin.get('/api/admin/stores').query({ location: 'check' }).expect(200)).body.stores;
    expect(toCheck.map((x: { name: string; locationByDriverName: string }) => [x.name, x.locationByDriverName])).toEqual([['Gupta General Store', 'Ramesh']]);
    const confirmed = await s.admin.post(`/api/admin/stores/${s.store2.id}/location/confirm`).expect(200);
    expect(confirmed.body.store).toMatchObject({ locationStatus: 'owner', lat: 32.8 });
    await s.admin.post(`/api/admin/stores/${s.store2.id}/location/confirm`).expect(409);

    // Clear and set again
    const cleared = await s.admin.put(`/api/admin/stores/${s.store2.id}`).send({ location: null }).expect(200);
    expect(cleared.body.store).toMatchObject({ lat: null, lng: null, locationStatus: null });
    const missing = (await s.admin.get('/api/admin/stores').query({ location: 'missing' }).expect(200)).body.stores;
    expect(missing.map((x: { name: string }) => x.name)).toContain('Gupta General Store');
  });

  it('imports locations from Latitude/Longitude columns or a Google Maps link', async () => {
    const csv = [
      'Area,Shop name,Latitude,Longitude,Location',
      'Gandhi Nagar,Map Shop One,32.71,74.81,',
      // A link contains commas, so a CSV file has it in quotes (Excel does this when saving)
      'Gandhi Nagar,Map Shop Two,,,"https://www.google.com/maps/place/x/@32.7,74.8,17z/data=!3d32.7222!4d74.8333"',
      'Station Road,Gupta General Store,32.81,74.91,',
      'Gandhi Nagar,Map Shop Three,,,near the temple',
    ].join('\n');
    const res = await s.admin.post('/api/admin/stores/import').send({ csv }).expect(200);
    expect(res.body).toMatchObject({ storesCreated: 2, updatedExisting: 1 });
    expect(res.body.errors).toHaveLength(1);
    const find = async (q: string) => (await s.admin.get('/api/admin/stores').query({ q }).expect(200)).body.stores[0];
    expect(await find('Map Shop One')).toMatchObject({ lat: 32.71, lng: 74.81, locationStatus: 'owner' });
    expect(await find('Map Shop Two')).toMatchObject({ lat: 32.7222, lng: 74.8333 });
    expect(await find('Gupta General Store')).toMatchObject({ lat: 32.81, lng: 74.91, locationStatus: 'owner' });
  });
});

describe('routes', () => {
  let routeId: number;
  let shops: number[];
  it('creates a route for a driver with shops in order; the driver gets only their active routes', async () => {
    const one = (await s.admin.get('/api/admin/stores').query({ q: 'Map Shop One' }).expect(200)).body.stores[0];
    const two = (await s.admin.get('/api/admin/stores').query({ q: 'Map Shop Two' }).expect(200)).body.stores[0];
    shops = [s.store.id, one.id, two.id, s.store2.id];
    const created = await s.admin
      .post('/api/admin/routes')
      .send({ name: 'Morning A', driverId: s.driver.id, days: '7654321', storeIds: shops })
      .expect(201);
    routeId = created.body.route.id;
    expect(created.body.route).toMatchObject({ name: 'Morning A', driverName: 'Ramesh', days: '1234567', isActive: true });
    expect(created.body.route.stops.map((x: { position: number; storeId: number }) => [x.position, x.storeId])).toEqual(
      shops.map((id, i) => [i + 1, id]),
    );
    await s.admin.post('/api/admin/routes').send({ name: 'morning a', storeIds: [] }).expect(409);
    await s.admin.post('/api/admin/routes').send({ name: 'Bad days', days: '08' }).expect(400);
    await s.admin.post('/api/admin/routes').send({ name: 'Twice', storeIds: [s.store.id, s.store.id] }).expect(400);
    await s.admin.post('/api/admin/routes').send({ name: 'Unknown', storeIds: [99999] }).expect(400);
    await s.admin.post('/api/admin/routes').send({ name: 'Off route', driverId: s.driver.id, isActive: false, storeIds: [s.store.id] }).expect(201);
    await s.admin.post('/api/admin/routes').send({ name: 'Suresh route', driverId: driver2.id, storeIds: [s.store2.id] }).expect(201);

    const cat = (await request(ctx.app).get('/api/driver/catalog').set(auth()).expect(200)).body;
    expect(cat.routes).toEqual([{ id: routeId, name: 'Morning A', days: '1234567', storeIds: shops }]);
    const list = (await s.admin.get('/api/admin/routes').expect(200)).body.routes;
    // Every shop of the route has a location by now (Gupta's came from the import above)
    expect(list.find((r: { id: number }) => r.id === routeId)).toMatchObject({ stopCount: 4, withoutLocation: 0, driverName: 'Ramesh' });
  });

  it('changes the order, the days and the driver', async () => {
    const reordered = [shops[1], shops[0], shops[2], shops[3]];
    const res = await s.admin.put(`/api/admin/routes/${routeId}`).send({ storeIds: reordered, days: '123456' }).expect(200);
    expect(res.body.route.stops.map((x: { storeId: number }) => x.storeId)).toEqual(reordered);
    expect(res.body.route.days).toBe('123456');
    // Back to the first order, every day
    await s.admin.put(`/api/admin/routes/${routeId}`).send({ storeIds: shops, days: '1234567' }).expect(200);
    await s.admin.put('/api/admin/routes/99999').send({ name: 'x' }).expect(404);
  });
});

describe('visits: every bill and "no bill" is checked against the shop location', () => {
  it('judges bills by where the phone was', async () => {
    const post = (body: object, t = s.token) => request(ctx.app).post('/api/driver/sales').set(auth(t)).send(body);
    const routeId = (await s.admin.get('/api/admin/routes').expect(200)).body.routes.find((r: { name: string }) => r.name === 'Morning A').id;

    const ok = await post(bill(s.store.id, { visit: { location: near(40), routeId } })).expect(201);
    expect(ok.body.visit).toEqual({ status: 'ok', distanceM: 40, radiusM: 100 });
    expect(ok.body.sale).toMatchObject({ visitStatus: 'ok', visitDistanceM: 40, visitRadiusM: 100 });
    // Sent again (no internet reply): same bill, same visit
    const again = await post({ ...bill(s.store.id), clientId: ok.body.sale.clientId, visit: { location: near(40), routeId } }).expect(200);
    expect(again.body).toMatchObject({ created: false, visit: { status: 'ok', distanceM: 40 } });

    const far = await post(bill(s.store.id, { visit: { location: near(900) } })).expect(201);
    expect(far.body.visit).toMatchObject({ status: 'far', distanceM: distanceM(near(900), SHOP) });
    expect(far.body.visit.distanceM).toBeGreaterThan(890);
    const noGps = await post(bill(s.store.id, { visit: { location: null } })).expect(201);
    expect(noGps.body.visit).toMatchObject({ status: 'no_gps', distanceM: null });
    // An older app version sends no visit at all
    const old = await post(bill(s.store.id)).expect(201);
    expect(old.body.visit.status).toBe('no_gps');
    // A location measured long before the bill does not count
    const stale = { ...near(10), at: new Date(Date.now() - 30 * 60_000).toISOString() };
    const staleRes = await post(bill(s.store.id, { soldAt: new Date().toISOString(), visit: { location: stale } })).expect(201);
    expect(staleRes.body.visit.status).toBe('no_gps');
    // A shop with no saved location cannot be judged
    await s.admin.put(`/api/admin/stores/${s.store2.id}`).send({ location: null }).expect(200);
    const unknown = await post(bill(s.store2.id, { visit: { location: near(10) } })).expect(201);
    expect(unknown.body.visit).toMatchObject({ status: 'no_shop_location', distanceM: null });

    // Bills on the website carry the verdict
    const list = (await s.admin.get('/api/admin/sales').expect(200)).body.sales;
    expect(list.map((x: { visitStatus: string }) => x.visitStatus).sort()).toEqual(['far', 'no_gps', 'no_gps', 'no_gps', 'no_shop_location', 'ok']);
  });

  it('saves "no bill" visits with a reason, once', async () => {
    const one = (await s.admin.get('/api/admin/stores').query({ q: 'Map Shop One' }).expect(200)).body.stores[0];
    const body = { clientId: uuid(), storeId: one.id, reason: 'closed', location: { lat: 32.71, lng: 74.8105, accuracy: 8, at: new Date().toISOString() } };
    const res = await request(ctx.app).post('/api/driver/visits').set(auth()).send(body).expect(201);
    expect(res.body.visit).toMatchObject({ kind: 'no_bill', reason: 'closed', status: 'ok', distanceM: 47, saleId: null, storeId: one.id });
    const again = await request(ctx.app).post('/api/driver/visits').set(auth()).send(body).expect(200);
    expect(again.body).toMatchObject({ created: false, visit: { id: res.body.visit.id } });
    await request(ctx.app).post('/api/driver/visits').set(auth(token2)).send(body).expect(409);
    await request(ctx.app).post('/api/driver/visits').set(auth()).send({ ...body, clientId: uuid(), reason: 'lazy' }).expect(400);
    await request(ctx.app).post('/api/driver/visits').set(auth()).send({ ...body, clientId: uuid(), storeId: 99999 }).expect(400);
    // The driver's day shows it
    const day = (await request(ctx.app).get('/api/driver/sales').set(auth()).expect(200)).body;
    expect(day.visits.map((v: { reason: string; storeId: number }) => [v.reason, v.storeId])).toEqual([['closed', one.id]]);
  });

  it('route check: planned shops against visits, missed and out-of-order shops, extra visits', async () => {
    // Suresh visits a shop off his route, without a location
    await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth(token2))
      .send(bill(s.store.id, { visit: { location: null } }))
      .expect(201);
    const check = (await s.admin.get('/api/admin/route-check').expect(200)).body;
    expect(check).toMatchObject({ date: today(), radiusM: 100 });
    const ramesh = check.drivers.find((d: { driverName: string }) => d.driverName === 'Ramesh');
    const stops = ramesh.routes[0].stops;
    expect(ramesh.routes.map((r: { name: string }) => r.name)).toEqual(['Morning A']);
    // Sharma Kirana (bills) → Map Shop One (no bill, after Sharma: in order) → Map Shop Two (missed) → Gupta (bill)
    expect(stops.map((x: { storeName: string; state: string; outOfOrder: boolean }) => [x.storeName, x.state, x.outOfOrder])).toEqual([
      ['Sharma Kirana', 'visited', false],
      ['Map Shop One', 'visited', false],
      ['Map Shop Two', 'missed', false],
      ['Gupta General Store', 'visited', true], // its bill came before the "no bill" at Map Shop One
    ]);
    expect(stops[0].visits.map((v: { status: string }) => v.status)).toEqual(['ok', 'far', 'no_gps', 'no_gps', 'no_gps']);
    expect(ramesh.summary).toMatchObject({ planned: 4, visited: 3, missed: 1, outOfOrder: 1, visits: 7, bills: 6, noBills: 1, ok: 2, far: 1, noGps: 3, noShopLocation: 1 });
    const suresh = check.drivers.find((d: { driverName: string }) => d.driverName === 'Suresh');
    expect(suresh.routes[0].stops.map((x: { state: string }) => x.state)).toEqual(['missed']);
    expect(suresh.extraVisits.map((v: { storeName: string; status: string }) => [v.storeName, v.status])).toEqual([['Sharma Kirana', 'no_gps']]);
    expect(check.totals).toMatchObject({ planned: 5, visited: 3, missed: 2, visits: 8 });
    const one = (await s.admin.get('/api/admin/route-check').query({ driverId: driver2.id }).expect(200)).body;
    expect(one.drivers.map((d: { driverName: string }) => d.driverName)).toEqual(['Suresh']);
    const dash = (await s.admin.get('/api/admin/dashboard').expect(200)).body;
    expect(dash.routeCheck).toMatchObject({ planned: 5, missed: 2, far: 1, noGps: 4 });
  });

  it('keeps the plan a driver had on a past day when the route changes later', async () => {
    // The plan of today was saved with the visits; pretend today is over and the route changes.
    await ctx.db.run(`UPDATE visits SET visit_date = '2026-01-05'`); // a Monday
    await ctx.db.run(`UPDATE route_days SET day = '2026-01-05'`);
    const routes = (await s.admin.get('/api/admin/routes').expect(200)).body.routes;
    const morning = routes.find((r: { name: string }) => r.name === 'Morning A');
    await s.admin.put(`/api/admin/routes/${morning.id}`).send({ storeIds: [s.store.id] }).expect(200);
    const past = (await s.admin.get('/api/admin/route-check').query({ date: '2026-01-05' }).expect(200)).body;
    const ramesh = past.drivers.find((d: { driverName: string }) => d.driverName === 'Ramesh');
    expect(ramesh.routes[0].stops).toHaveLength(4);
    const now = (await s.admin.get('/api/admin/route-check').expect(200)).body;
    expect(now.drivers.find((d: { driverName: string }) => d.driverName === 'Ramesh').routes[0].stops).toHaveLength(1);
  });

  it('deletes a route; past visits stay', async () => {
    const routes = (await s.admin.get('/api/admin/routes').expect(200)).body.routes;
    const morning = routes.find((r: { name: string }) => r.name === 'Morning A');
    await s.admin.delete(`/api/admin/routes/${morning.id}`).expect(200);
    await s.admin.delete(`/api/admin/routes/${morning.id}`).expect(404);
    expect(await ctx.db.first(`SELECT count(*) AS n FROM visits`)).toMatchObject({ n: 8 });
    expect(await ctx.db.first(`SELECT count(*) AS n FROM visits WHERE route_id IS NOT NULL`)).toMatchObject({ n: 0 });
    expect(await ctx.db.first(`SELECT count(*) AS n FROM route_days`)).toMatchObject({ n: 1 }); // Suresh's plan only
  });
});

describe('Cloudflare D1 limits (routes and visits)', () => {
  it('stays within the bound-value limit and the per-request query budget', async () => {
    const { usage, D1_MAX_PARAMS, QUERY_BUDGET_PER_REQUEST } = await import('./helpers.js');
    expect(usage.maxParams).toBeLessThanOrEqual(D1_MAX_PARAMS);
    expect(usage.maxQueriesPerRequest, usage.worstRequest).toBeLessThanOrEqual(QUERY_BUDGET_PER_REQUEST);
  });
});
