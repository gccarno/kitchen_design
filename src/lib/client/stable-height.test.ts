import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { resetStableHeight, useStableHeight } from './stable-height';

function resizeTo(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('useStableHeight', () => {
  beforeEach(() => {
    resetStableHeight();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  it('is a share of the window height', () => {
    const { result } = renderHook(() => useStableHeight(0.6));
    expect(result.current).toBe(480);
  });

  it('ignores a height-only resize (a phone keyboard opening)', () => {
    const { result } = renderHook(() => useStableHeight(0.6));
    resizeTo(400, 500);
    expect(result.current).toBe(480);
  });

  it('re-measures when the width changes (rotation)', () => {
    const { result } = renderHook(() => useStableHeight(0.5));
    resizeTo(800, 400);
    expect(result.current).toBe(200);
  });
});
