import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { useOnline, markOffline, markOnline } from './online';

function setNavigatorOnline(v: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}

afterEach(() => {
  setNavigatorOnline(true);
  act(() => markOnline());
});

describe('useOnline', () => {
  it('starts from navigator.onLine', () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);
  });

  it('flips on offline / online window events', () => {
    setNavigatorOnline(true);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('markOffline flips a connection that still reports onLine, markOnline restores it', () => {
    const { result } = renderHook(() => useOnline());
    act(() => markOffline());
    expect(result.current).toBe(false);
    act(() => markOnline());
    expect(result.current).toBe(true);
  });

  it('an online event clears a markOffline', () => {
    const { result } = renderHook(() => useOnline());
    act(() => markOffline());
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('server snapshot is online', async () => {
    const { renderToString } = await import('react-dom/server');
    const React = await import('react');
    setNavigatorOnline(false);
    function C() {
      return React.createElement('span', null, String(useOnline()));
    }
    expect(renderToString(React.createElement(C))).toContain('true');
  });
});
