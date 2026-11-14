import { describe, expect, it } from 'vitest';
import { trapTarget } from './focusTrap';

describe('trapTarget', () => {
  const items = ['a', 'b', 'c'];
  it('lets Tab move normally in the middle', () => {
    expect(trapTarget(items, 'a', false)).toBeNull();
    expect(trapTarget(items, 'b', false)).toBeNull();
    expect(trapTarget(items, 'b', true)).toBeNull();
  });
  it('wraps Tab from the last to the first', () => {
    expect(trapTarget(items, 'c', false)).toBe('a');
  });
  it('wraps Shift+Tab from the first to the last', () => {
    expect(trapTarget(items, 'a', true)).toBe('c');
  });
  it('brings focus back in when it is outside', () => {
    expect(trapTarget(items, null, false)).toBe('a');
    expect(trapTarget(items, 'x', false)).toBe('a');
    expect(trapTarget(items, 'x', true)).toBe('c');
  });
  it('does nothing with no focusable element', () => {
    expect(trapTarget([], null, false)).toBeNull();
  });
  it('with one element, Tab and Shift+Tab stay on it', () => {
    expect(trapTarget(['a'], 'a', false)).toBe('a');
    expect(trapTarget(['a'], 'a', true)).toBe('a');
  });
});
