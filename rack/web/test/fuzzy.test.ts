import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestScore, score } from '../src/fuzzy.ts';

test('exact beats prefix beats word start beats substring beats subsequence', () => {
  const s = (t: string) => score('son', t);
  assert.equal(score('plex', 'Plex'), 100);
  assert.ok(100 > s('sonarr'));
  assert.ok(s('sonarr') > s('the sonic'));
  assert.ok(s('the sonic') > s('reasons'));
  assert.ok(s('reasons') > score('snr', 'sonarr'));
  assert.ok(score('snr', 'sonarr') > 0);
});

test('letters out of order do not match', () => {
  assert.equal(score('xyz', 'sonarr'), 0);
  assert.equal(score('rn', 'nr'), 0);
});

test('an empty query matches everything', () => assert.equal(score('', 'anything'), 1));

test('bestScore weights fields and skips empty ones', () => {
  assert.equal(bestScore('plex', [{ text: null, weight: 1 }, { text: undefined, weight: 1 }]), 0);
  assert.equal(bestScore('plex', [{ text: 'plex', weight: 0.5 }, { text: 'Plex', weight: 1 }]), 100);
  assert.equal(bestScore('plex', [{ text: 'plex', weight: 0.5 }]), 50);
});
