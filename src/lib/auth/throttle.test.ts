import { describe, it, expect } from 'vitest';
import { MAX_FAILURES, MAX_KEYS, Throttle, WINDOW_MS } from './throttle';

function make() {
  const clock = { t: 1_000_000 };
  return { clock, th: new Throttle(() => clock.t) };
}

const fill = (th: Throttle, key: string) => {
  for (let i = 0; i < MAX_FAILURES; i++) th.tryConsume(key);
};

describe('Throttle', () => {
  it('lets 5 attempts through and refuses the 6th', () => {
    const { th } = make();
    for (let i = 0; i < 5; i++) expect(th.tryConsume('k')).toBe(true);
    expect(th.tryConsume('k')).toBe(false);
    expect(th.allowed('k')).toBe(false);
    expect(th.tryConsume('other')).toBe(true);
  });
  it('allows again once the window passes', () => {
    const { th, clock } = make();
    fill(th, 'k');
    clock.t += WINDOW_MS - 1;
    expect(th.tryConsume('k')).toBe(false);
    clock.t += 1;
    expect(th.tryConsume('k')).toBe(true);
  });
  it('clear and reset forget attempts', () => {
    const { th } = make();
    fill(th, 'k');
    th.clear('k');
    expect(th.tryConsume('k')).toBe(true);
    fill(th, 'k');
    th.reset();
    expect(th.tryConsume('k')).toBe(true);
  });
  it('never holds more than 10 000 keys', () => {
    const { th } = make();
    for (let i = 0; i < MAX_KEYS + 50; i++) th.tryConsume(`k${i}`);
    expect(th.size).toBeLessThanOrEqual(MAX_KEYS);
  });
  it('prunes expired keys first when full', () => {
    const { th, clock } = make();
    for (let i = 0; i < MAX_KEYS; i++) th.tryConsume(`k${i}`);
    clock.t += WINDOW_MS;
    expect(th.tryConsume('fresh')).toBe(true);
    expect(th.size).toBe(1);
  });
  it('a flood of distinct keys never evicts an at-limit victim', () => {
    const { th } = make();
    fill(th, 'victim');
    for (let i = 0; i < MAX_KEYS * 2; i++) th.tryConsume(`flood${i}`);
    expect(th.size).toBeLessThanOrEqual(MAX_KEYS);
    expect(th.tryConsume('victim')).toBe(false);
  });
  it('refuses new keys when the map is full of at-limit keys', () => {
    const { th } = make();
    for (let i = 0; i < MAX_KEYS; i++) fill(th, `k${i}`);
    expect(th.size).toBe(MAX_KEYS);
    expect(th.tryConsume('newcomer')).toBe(false);
    expect(th.size).toBe(MAX_KEYS);
    expect(th.tryConsume('k0')).toBe(false);
  });
});
