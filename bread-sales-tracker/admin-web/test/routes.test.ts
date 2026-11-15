import { describe, expect, it } from 'vitest';
import { daysLabel, metres, nearestOrder, routeLengthM } from '../src/routeOrder';

// Shops along a road (≈ 111 m apart per 0.001° of latitude) given in a muddled order, plus one without a location
const shop = (name: string, lat: number | null) => ({ name, lat, lng: lat === null ? null : 74.86 });
const muddled = [shop('A', 32.7), shop('D', 32.703), shop('No map', null), shop('B', 32.701), shop('E', 32.704), shop('C', 32.702)];

describe('route planning helpers', () => {
  it('orders shops by nearest next, from the first shop; shops without a location go last', () => {
    expect(nearestOrder(muddled).map((s) => s.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'No map']);
    // Fewer than 3 located shops: nothing to optimise
    expect(nearestOrder([shop('X', 32.7), shop('Y', null), shop('Z', 32.71)]).map((s) => s.name)).toEqual(['X', 'Z', 'Y']);
  });

  it('measures a route in straight lines', () => {
    const ordered = nearestOrder(muddled);
    expect(routeLengthM(ordered)).toBe(444); // 4 steps of ≈111 m
    expect(routeLengthM(muddled)).toBeGreaterThan(routeLengthM(ordered));
    expect([metres(445), metres(1250)]).toEqual(['445 m', '1.3 km']);
  });

  it('names the days a route runs', () => {
    expect(daysLabel('1234567')).toBe('Every day');
    expect(daysLabel('123456')).toBe('Mon–Sat');
    expect(daysLabel('12345')).toBe('Mon–Fri');
    expect(daysLabel('531')).toBe('Mon, Wed, Fri');
  });
});
