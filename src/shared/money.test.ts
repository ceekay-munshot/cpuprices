import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice } from './money';

describe('parsePrice', () => {
  it('parses dollars with cents', () => {
    const r = parsePrice('$589.99');
    assert.equal(r.priceCents, 58999);
    assert.equal(r.currency, 'USD');
    assert.equal(r.rawText, '$589.99');
  });

  it('parses comma-separated thousands without cents', () => {
    assert.equal(parsePrice('$1,299').priceCents, 129900);
  });

  it('parses comma-separated thousands with cents', () => {
    assert.equal(parsePrice('$1,299.50').priceCents, 129950);
    assert.equal(parsePrice('$1,234,567.89').priceCents, 123456789);
  });

  it('parses sub-dollar prices', () => {
    assert.equal(parsePrice('$0.99').priceCents, 99);
  });

  it('parses bare numbers without currency symbol', () => {
    assert.equal(parsePrice('1234').priceCents, 123400);
  });

  it('treats one decimal digit as tens of cents', () => {
    assert.equal(parsePrice('$1.5').priceCents, 150);
  });

  it('trims surrounding whitespace', () => {
    assert.equal(parsePrice('  $42.00  ').priceCents, 4200);
  });

  it('returns null for NA-like markers', () => {
    for (const v of ['NA', 'N/A', 'n/a', 'n.a.', '--', '—', '–', 'TBD', 'tba']) {
      const r = parsePrice(v);
      assert.equal(r.priceCents, null, `expected null for ${JSON.stringify(v)}`);
      assert.equal(r.rawText, v);
    }
  });

  it('returns null for empty and whitespace-only input', () => {
    assert.equal(parsePrice('').priceCents, null);
    assert.equal(parsePrice('   ').priceCents, null);
  });

  it('returns null for null and undefined', () => {
    assert.equal(parsePrice(null).priceCents, null);
    assert.equal(parsePrice(undefined).priceCents, null);
  });

  it('returns null for prose without any digits', () => {
    assert.equal(parsePrice('Price unavailable').priceCents, null);
  });

  it('always returns USD in v1', () => {
    assert.equal(parsePrice('$1').currency, 'USD');
    assert.equal(parsePrice('NA').currency, 'USD');
    assert.equal(parsePrice(null).currency, 'USD');
  });

  it('preserves raw text for audit', () => {
    assert.equal(parsePrice('  $589.99  ').rawText, '$589.99');
    assert.equal(parsePrice('NA').rawText, 'NA');
    assert.equal(parsePrice(null).rawText, '');
  });
});
