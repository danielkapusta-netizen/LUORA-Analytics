import { describe, expect, it } from 'vitest';
import { canTransition, MANUAL_TARGETS, TRANSITIONS } from '@/server/services/workflow';

describe('order workflow', () => {
  it('follows the happy path', () => {
    expect(canTransition('new', 'processing')).toBe(true);
    expect(canTransition('processing', 'label_created')).toBe(true);
    expect(canTransition('label_created', 'shipped')).toBe(true);
    expect(canTransition('shipped', 'delivered')).toBe(true);
  });

  it('does not reopen shipped or delivered orders', () => {
    expect(canTransition('shipped', 'new')).toBe(false);
    expect(canTransition('shipped', 'cancelled')).toBe(false);
    expect(TRANSITIONS.delivered).toEqual([]);
  });

  it('lets cancelled orders be reopened and held orders resume', () => {
    expect(canTransition('cancelled', 'new')).toBe(true);
    expect(canTransition('on_hold', 'processing')).toBe(true);
    expect(canTransition('on_hold', 'label_created')).toBe(false);
  });

  it('does not offer label_created or delivered as manual targets', () => {
    expect(MANUAL_TARGETS).not.toContain('label_created');
    expect(MANUAL_TARGETS).not.toContain('delivered');
  });
});
