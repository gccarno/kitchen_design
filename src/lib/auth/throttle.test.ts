import { describe, it, expect } from 'vitest';
import { MAX_KEYS, Throttle, WINDOW_MS } from './throttle';

function make() {
  const clock = { t: 1_000_000 };
  return { clock, th: new Throttle(() => clock.t) };
}

describe('Throttle', () => {
  it('allows 4 failures, blocks after the 5th', () => {
    const { th } = make();
    for (let i = 0; i < 4; i++) th.recordFailure('k');
    expect(th.allowed('k')).toBe(true);
    th.recordFailure('k');
    expect(th.allowed('k')).toBe(false);
    expect(th.allowed('other')).toBe(true);
  });
  it('allows again once the window passes', () => {
    const { th, clock } = make();
    for (let i = 0; i < 5; i++) th.recordFailure('k');
    clock.t += WINDOW_MS - 1;
    expect(th.allowed('k')).toBe(false);
    clock.t += 1;
    expect(th.allowed('k')).toBe(true);
    th.recordFailure('k');
    expect(th.allowed('k')).toBe(true);
  });
  it('clear and reset forget failures', () => {
    const { th } = make();
    for (let i = 0; i < 5; i++) th.recordFailure('k');
    th.clear('k');
    expect(th.allowed('k')).toBe(true);
    for (let i = 0; i < 5; i++) th.recordFailure('k');
    th.reset();
    expect(th.allowed('k')).toBe(true);
  });
  it('never holds more than 10 000 keys', () => {
    const { th } = make();
    for (let i = 0; i < MAX_KEYS + 50; i++) th.recordFailure(`k${i}`);
    expect(th.size).toBeLessThanOrEqual(MAX_KEYS);
  });
  it('prunes expired keys first when full', () => {
    const { th, clock } = make();
    for (let i = 0; i < MAX_KEYS; i++) th.recordFailure(`k${i}`);
    clock.t += WINDOW_MS;
    th.recordFailure('fresh');
    expect(th.size).toBe(1);
  });
});
