import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pack, sectionWidth } from '../src/layout.ts';

test('pack hands each row its spare columns so rows are full', () => {
  assert.deepEqual(pack([1, 1, 1], 4), [2, 1, 1]);
  assert.deepEqual(pack([1, 1, 1], 4, true), [1, 1, 2]);
  assert.deepEqual(pack([2, 2, 2], 4), [2, 2, 4]);
  assert.deepEqual(pack([1, 1, 1], 5), [2, 2, 1]);
  assert.deepEqual(pack([1, 1, 1], 5, true), [1, 2, 2]);
});

test('pack never lets an item exceed the row', () => {
  assert.deepEqual(pack([6], 4), [4]);
  assert.deepEqual(pack([], 4), []);
});

test('sectionWidth is one row when short, else rows of at most four', () => {
  assert.equal(sectionWidth(1, 8), 1);
  assert.equal(sectionWidth(6, 8), 6);
  assert.equal(sectionWidth(8, 8), 4);
  assert.equal(sectionWidth(9, 8), 3);
  assert.equal(sectionWidth(20, 4), 4);
});
