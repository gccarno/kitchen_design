import { describe, it, expect } from 'vitest';
import { clientIp } from './http';

const h = (xff?: string) => new Headers(xff ? { 'x-forwarded-for': xff } : {});
const env = (hops?: string) => (hops === undefined ? {} : { TRUSTED_PROXY_HOPS: hops }) as unknown as NodeJS.ProcessEnv;

describe('clientIp', () => {
  it('defaults to the rightmost entry', () => {
    expect(clientIp(h('6.6.6.6, 1.1.1.1'), env())).toBe('1.1.1.1');
    expect(clientIp(h('1.1.1.1'), env())).toBe('1.1.1.1');
  });
  it('is unknown without the header', () => {
    expect(clientIp(h(), env())).toBe('unknown');
  });
  it('0 ignores the header', () => {
    expect(clientIp(h('1.1.1.1'), env('0'))).toBe('unknown');
  });
  it('N takes the Nth from the right', () => {
    expect(clientIp(h('9.9.9.9, 2.2.2.2, 3.3.3.3'), env('2'))).toBe('2.2.2.2');
    expect(clientIp(h('9.9.9.9, 2.2.2.2, 3.3.3.3'), env('3'))).toBe('9.9.9.9');
  });
  it('is unknown when there are fewer entries than hops', () => {
    expect(clientIp(h('1.1.1.1'), env('2'))).toBe('unknown');
  });
  it('treats an invalid value as the default', () => {
    expect(clientIp(h('6.6.6.6, 1.1.1.1'), env('abc'))).toBe('1.1.1.1');
    expect(clientIp(h('6.6.6.6, 1.1.1.1'), env('-1'))).toBe('1.1.1.1');
  });
});
