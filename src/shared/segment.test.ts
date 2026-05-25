import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferSegment } from './segment';

describe('inferSegment', () => {
  it('classifies Intel Xeon as Server (including mobile Xeon)', () => {
    assert.equal(inferSegment('Intel Xeon Gold 6314U'), 'Server');
    assert.equal(inferSegment('Intel Xeon Platinum 8568Y+'), 'Server');
    assert.equal(inferSegment('Intel Xeon Max 9480'), 'Server');
    assert.equal(inferSegment('Intel Xeon E-2186M'), 'Server'); // mobile Xeon → still Server
  });

  it('classifies AMD EPYC as Server', () => {
    assert.equal(inferSegment('AMD EPYC 9755'), 'Server');
    assert.equal(inferSegment('AMD EPYC 7713'), 'Server');
    assert.equal(inferSegment('AMD EPYC Embedded 9755'), 'Server');
  });

  it('classifies AMD Threadripper PRO as Server, non-PRO as Desktop', () => {
    assert.equal(inferSegment('AMD Ryzen Threadripper PRO 9995WX'), 'Server');
    assert.equal(inferSegment('AMD Ryzen Threadripper PRO 3995WX'), 'Server');
    assert.equal(inferSegment('AMD Ryzen Threadripper 7960X'), 'Desktop');
    assert.equal(inferSegment('AMD Ryzen Threadripper 3990X'), 'Desktop');
  });

  it('classifies IBM POWER as Server', () => {
    assert.equal(inferSegment('IBM POWER9'), 'Server');
    assert.equal(inferSegment('IBM POWER 10'), 'Server');
  });

  it('classifies Intel desktop K/KF/F/T/S as Desktop', () => {
    assert.equal(inferSegment('Intel Core Ultra 9 285K'), 'Desktop');
    assert.equal(inferSegment('Intel Core Ultra 7 265KF'), 'Desktop');
    assert.equal(inferSegment('Intel Core Ultra 5 245K'), 'Desktop');
    assert.equal(inferSegment('Intel Core i9-14900K @ 3.20GHz'), 'Desktop');
    assert.equal(inferSegment('Intel Core i7-14700F'), 'Desktop');
    assert.equal(inferSegment('Intel Core i9-13900T'), 'Desktop');
  });

  it('classifies AMD desktop X/X3D/G as Desktop', () => {
    assert.equal(inferSegment('AMD Ryzen 9 9950X3D'), 'Desktop');
    assert.equal(inferSegment('AMD Ryzen 7 9800X3D'), 'Desktop');
    assert.equal(inferSegment('AMD Ryzen 5 9600X'), 'Desktop');
    assert.equal(inferSegment('AMD Ryzen 5 5600G'), 'Desktop');
  });

  it('classifies Intel mobile H/HX/U/Y as Laptop', () => {
    assert.equal(inferSegment('Intel Core i9-13900HX'), 'Laptop');
    assert.equal(inferSegment('Intel Core i9-13900H'), 'Laptop');
    assert.equal(inferSegment('Intel Core i7-1365U'), 'Laptop');
    assert.equal(inferSegment('Intel Core Ultra 9 185H'), 'Laptop');
    assert.equal(inferSegment('Intel Core Ultra 7 165U'), 'Laptop');
  });

  it('classifies AMD mobile HX/HS/H/U as Laptop', () => {
    assert.equal(inferSegment('AMD Ryzen 9 7945HX'), 'Laptop');
    assert.equal(inferSegment('AMD Ryzen 9 7940HS'), 'Laptop');
    assert.equal(inferSegment('AMD Ryzen 7 7840U'), 'Laptop');
  });

  it('classifies Apple Silicon (and A-series) as Laptop', () => {
    assert.equal(inferSegment('Apple M1'), 'Laptop');
    assert.equal(inferSegment('Apple M2 Pro'), 'Laptop');
    assert.equal(inferSegment('Apple M3 Ultra 32 Core'), 'Laptop');
    assert.equal(inferSegment('Apple M4'), 'Laptop');
    assert.equal(inferSegment('Apple A15 Bionic'), 'Laptop');
  });

  it('classifies Qualcomm / Snapdragon as Laptop', () => {
    assert.equal(inferSegment('Qualcomm Snapdragon 8 Gen 3'), 'Laptop');
    assert.equal(inferSegment('Snapdragon X Elite'), 'Laptop');
  });

  it('falls back to Desktop for suffix-less Core / Ryzen', () => {
    assert.equal(inferSegment('Intel Core Ultra 5 235'), 'Desktop');
    assert.equal(inferSegment('AMD Ryzen 5 9600'), 'Desktop');
    assert.equal(inferSegment('AMD Ryzen 5 5500'), 'Desktop');
  });

  it('classifies Intel Atom as Other (embedded / IoT)', () => {
    assert.equal(inferSegment('Intel Atom x6425E'), 'Other');
    assert.equal(inferSegment('Intel Atom Z3735F'), 'Other');
  });

  it('returns Other for generic ARM / unknown vendors', () => {
    assert.equal(inferSegment('ARM Cortex-A78'), 'Other');
    assert.equal(inferSegment('Loongson 3A5000'), 'Other');
  });

  it('classifies AMD Opteron as Server', () => {
    assert.equal(inferSegment('AMD Opteron 6376'), 'Server');
    assert.equal(inferSegment('AMD Opteron 6128 HE'), 'Server');
  });

  it('classifies older AMD desktop families as Desktop', () => {
    assert.equal(inferSegment('AMD Athlon 64 X2 Dual Core 5000+'), 'Desktop');
    assert.equal(inferSegment('AMD Phenom II X4 965'), 'Desktop');
    assert.equal(inferSegment('AMD Sempron 145'), 'Desktop');
    assert.equal(inferSegment('AMD FX-8350'), 'Desktop');
    assert.equal(inferSegment('AMD A10-7890K APU'), 'Desktop');
  });

  it('classifies AMD Turion as Laptop', () => {
    assert.equal(inferSegment('AMD Turion X2 Ultra Dual-Core ZM-87'), 'Laptop');
    assert.equal(inferSegment('AMD Turion II Dual-Core Mobile M520'), 'Laptop');
  });

  it('classifies broader Qualcomm naming as Laptop', () => {
    assert.equal(inferSegment('Qualcomm Technologies, Inc SM8550-AB'), 'Laptop');
    assert.equal(inferSegment('QTI SM8650'), 'Laptop');
  });

  it('classifies phone-chip vendors as Laptop', () => {
    assert.equal(inferSegment('MediaTek MT6789'), 'Laptop');
    assert.equal(inferSegment('Samsung Exynos 2400'), 'Laptop');
    assert.equal(inferSegment('Spreadtrum SC9863A'), 'Laptop');
    assert.equal(inferSegment('Unisoc T618'), 'Laptop');
  });

  it('classifies Core 2 / older Pentium as Desktop', () => {
    assert.equal(inferSegment('Intel Core 2 Duo E8400'), 'Desktop');
    assert.equal(inferSegment('Intel Core 2 Quad Q9550'), 'Desktop');
    assert.equal(inferSegment('Intel Pentium 4 3.20GHz'), 'Desktop');
  });

  it('classifies VIA / Zhaoxin as Desktop', () => {
    assert.equal(inferSegment('VIA C3 Esther'), 'Desktop');
    assert.equal(inferSegment('Zhaoxin KaiXian KX-U6780A'), 'Desktop');
  });

  it('classifies Rockchip / Virtual as Other', () => {
    assert.equal(inferSegment('Rockchip RK3566'), 'Other');
    assert.equal(inferSegment('Virtual CPU 1.0'), 'Other');
  });

  it('"Mobile" in the name overrides default Desktop bucket', () => {
    // "Athlon" would otherwise → Desktop; "Mobile" must win because Laptop is
    // checked before Desktop in the rule order.
    assert.equal(inferSegment('AMD Athlon Mobile 4000+'), 'Laptop');
  });

  it('is case-insensitive', () => {
    assert.equal(inferSegment('intel xeon gold 6314u'), 'Server');
    assert.equal(inferSegment('AMD ryzen 5 5600'), 'Desktop');
    assert.equal(inferSegment('apple m1'), 'Laptop');
  });
});
