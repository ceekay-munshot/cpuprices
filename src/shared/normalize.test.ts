import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCpuName } from './normalize';

describe('normalizeCpuName', () => {
  it('lowercases and trims', () => {
    assert.equal(
      normalizeCpuName('  Intel Core Ultra 9 285K  '),
      'intel core ultra 9 285k',
    );
  });

  it('strips clock-speed suffix with GHz', () => {
    assert.equal(
      normalizeCpuName('Intel Core Ultra 9 285K @ 3.7GHz'),
      'intel core ultra 9 285k',
    );
  });

  it('strips clock-speed suffix with spaces', () => {
    assert.equal(
      normalizeCpuName('AMD Ryzen 9 9950X3D @ 4.3 GHz'),
      'amd ryzen 9 9950x3d',
    );
  });

  it('strips unicode trademark glyphs', () => {
    assert.equal(
      normalizeCpuName('Intel® Core™ Ultra 9 285K'),
      'intel core ultra 9 285k',
    );
  });

  it('strips ASCII (R) and (TM) markers', () => {
    assert.equal(
      normalizeCpuName('Intel(R) Core(TM) Ultra 9 285K'),
      'intel core ultra 9 285k',
    );
  });

  it('collapses multiple whitespace and tabs', () => {
    assert.equal(
      normalizeCpuName('AMD   Ryzen\t9   9950X3D'),
      'amd ryzen 9 9950x3d',
    );
  });

  it('preserves SKU suffix variants like X3D and KF', () => {
    assert.equal(normalizeCpuName('AMD Ryzen 7 9800X3D'), 'amd ryzen 7 9800x3d');
    assert.equal(normalizeCpuName('Intel Core Ultra 5 245KF'), 'intel core ultra 5 245kf');
  });

  it('is idempotent', () => {
    const input = 'Intel(R) Core(TM) Ultra 5 245KF @ 4.2 GHz';
    const once = normalizeCpuName(input);
    assert.equal(normalizeCpuName(once), once);
  });

  it('returns empty string for empty input', () => {
    assert.equal(normalizeCpuName(''), '');
    assert.equal(normalizeCpuName('   '), '');
  });

  it('handles a kitchen-sink combination', () => {
    assert.equal(
      normalizeCpuName('  Intel(R) Core(TM) Ultra 5 245KF @ 4.2 GHz  '),
      'intel core ultra 5 245kf',
    );
  });
});
