import assert from 'node:assert/strict';
import test from 'node:test';
import { discountPercent, formatMoney, parseMoneyToCents } from './money';

test('converte preços em formatos brasileiro e internacional para centavos', () => {
  assert.equal(parseMoneyToCents('R$ 79,90'), 7990);
  assert.equal(parseMoneyToCents('1.234,56'), 123456);
  assert.equal(parseMoneyToCents('79.90'), 7990);
  assert.equal(parseMoneyToCents('1,234.56'), 123456);
  assert.equal(parseMoneyToCents(79.9), 7990);
  assert.equal(parseMoneyToCents('grátis'), null);
  assert.equal(parseMoneyToCents(''), null);
});

test('não trata milhar sem decimais como centavos', () => {
  assert.equal(parseMoneyToCents('1.234'), 123400);
});

test('calcula desconto percentual', () => {
  assert.equal(discountPercent(5000, 10000), 50);
  assert.equal(discountPercent(9990, 10000), 0);
  assert.equal(discountPercent(null, 10000), 0);
  assert.equal(discountPercent(5000, 0), 0);
});

test('formata centavos na moeda informada', () => {
  assert.match(formatMoney(7990, 'BRL'), /79,90/);
  assert.match(formatMoney(7990, 'USD'), /79[.,]90/);
  assert.equal(formatMoney(null), '—');
});
