import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferSegment, inferVendor } from './vendor';

describe('inferVendor', () => {
  it('classifies Intel desktop and workstation chips', () => {
    assert.equal(inferVendor('Intel Core Ultra 9 285K'), 'Intel');
    assert.equal(inferVendor('Intel Core i9-13900K'), 'Intel');
    assert.equal(inferVendor('Intel(R) Xeon Gold 6314U'), 'Intel');
    assert.equal(inferVendor('Intel Atom x6425E'), 'Intel');
  });

  it('classifies AMD chips across families', () => {
    assert.equal(inferVendor('AMD Ryzen 9 9950X3D'), 'AMD');
    assert.equal(inferVendor('AMD EPYC 9554'), 'AMD');
    assert.equal(inferVendor('AMD Threadripper PRO 7995WX'), 'AMD');
  });

  it('classifies Apple Silicon (named and M-series identifiers)', () => {
    assert.equal(inferVendor('Apple M1'), 'Apple');
    assert.equal(inferVendor('Apple M2 Pro'), 'Apple');
    assert.equal(inferVendor('Apple M3 Max'), 'Apple');
    assert.equal(inferVendor('Apple M4'), 'Apple');
    assert.equal(inferVendor('Apple A15 Bionic'), 'Apple');
  });

  it('classifies Qualcomm / Snapdragon', () => {
    assert.equal(inferVendor('Qualcomm Snapdragon 8 Gen 3'), 'Qualcomm');
    assert.equal(inferVendor('Snapdragon X Elite'), 'Qualcomm');
  });

  it('classifies ARM and AArch64 platforms', () => {
    assert.equal(inferVendor('ARM Cortex-A78'), 'ARM');
    assert.equal(inferVendor('AArch64 generic'), 'ARM');
  });

  it('falls back to Other for unrecognized vendors', () => {
    assert.equal(inferVendor('Loongson 3A5000'), 'Other');
    assert.equal(inferVendor('IBM POWER9'), 'Other');
    assert.equal(inferVendor('VIA C3'), 'Other');
    assert.equal(inferVendor('Sun UltraSPARC T2'), 'Other');
  });

  it('is case-insensitive', () => {
    assert.equal(inferVendor('intel core i9-14900K'), 'Intel');
    assert.equal(inferVendor('amd ryzen 5 5600'), 'AMD');
    assert.equal(inferVendor('apple m1'), 'Apple');
  });

  it('Intel/AMD start-anchored — not flipped by mid-string mention', () => {
    // Synthetic edge case: a hypothetical row that mentions AMD inside an
    // Intel name. We anchor to start, so it stays Intel.
    assert.equal(inferVendor('Intel Core (AMD competitor) i9'), 'Intel');
  });
});

describe('inferSegment', () => {
  it('returns null for now (deliberate placeholder)', () => {
    assert.equal(inferSegment('Intel Core Ultra 9 285K'), null);
    assert.equal(inferSegment('AMD EPYC 9554'), null);
    assert.equal(inferSegment('Apple M1'), null);
  });
});
