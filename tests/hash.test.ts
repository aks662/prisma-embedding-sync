/** @file Tests canonical source normalization and SHA-256 hashing behavior. */
import { describe, expect, it } from 'vitest';
import { hashSourceFields, normalizeSourceFields, sha256 } from '../src/hash.js';

describe('sha256', () => {
  it('returns a stable lowercase SHA-256 hex digest', () => {
    const digest = sha256('hello');

    expect(digest).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('hashSourceFields', () => {
  it('is deterministic and changes when normalized source text changes', () => {
    const first = hashSourceFields({ title: 'Keyboard', description: 'Tactile switches' }, [
      'title',
      'description',
    ]);

    expect(first).toBe(
      hashSourceFields({ title: 'Keyboard', description: 'Tactile switches' }, [
        'title',
        'description',
      ]),
    );
    expect(first).not.toBe(
      hashSourceFields({ title: 'Mouse', description: 'Tactile switches' }, [
        'title',
        'description',
      ]),
    );
  });

  it('preserves configured field order', () => {
    const data = { first: 'Alpha', second: 'Beta' };

    expect(hashSourceFields(data, ['first', 'second'])).not.toBe(
      hashSourceFields(data, ['second', 'first']),
    );
  });

  it('normalizes missing, null, and whitespace-only values to empty text', () => {
    expect(
      normalizeSourceFields({ present: '  value  ', blank: ' \n ', nil: null }, [
        'missing',
        'nil',
        'blank',
        'present',
      ]),
    ).toBe('value');
    expect(hashSourceFields({}, ['missing'])).toBe(sha256(''));
    expect(hashSourceFields({ value: null }, ['value'])).toBe(sha256(''));
  });

  it('converts scalar values and valid dates deterministically', () => {
    expect(
      normalizeSourceFields(
        { count: 42, active: true, createdAt: new Date('2025-01-02T03:04:05.000Z') },
        ['count', 'active', 'createdAt'],
      ),
    ).toBe('42 true 2025-01-02T03:04:05.000Z');
    expect(normalizeSourceFields({ amount: 12.5 }, ['amount'])).toBe('12.5');
    expect(normalizeSourceFields({ active: false }, ['active'])).toBe('false');
  });

  it('rejects objects, arrays, non-finite numbers, and invalid dates', () => {
    expect(() => hashSourceFields({ value: { nested: true } }, ['value'])).toThrow(TypeError);
    expect(() => hashSourceFields({ value: ['item'] }, ['value'])).toThrow(TypeError);
    expect(() => hashSourceFields({ value: Number.NaN }, ['value'])).toThrow(TypeError);
    expect(() => hashSourceFields({ value: new Date(Number.NaN) }, ['value'])).toThrow(TypeError);
  });
});
