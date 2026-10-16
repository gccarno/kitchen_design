import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import ServiceWorkerRegistrar from './ServiceWorkerRegistrar';

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
});

describe('ServiceWorkerRegistrar', () => {
  it('registers /sw.js in production', () => {
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
    vi.stubEnv('NODE_ENV', 'production');
    render(<ServiceWorkerRegistrar />);
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('does not register outside production', () => {
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
    vi.stubEnv('NODE_ENV', 'test');
    render(<ServiceWorkerRegistrar />);
    expect(register).not.toHaveBeenCalled();
  });

  it('does not throw when serviceWorker is missing or registration rejects', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow();
    const rejection = Promise.reject(new Error('nope'));
    const register = vi.fn().mockReturnValue(rejection);
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow();
    expect(register).toHaveBeenCalledTimes(1);
    // The rejection must have a handler attached (the component's catch), so it settles cleanly.
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
