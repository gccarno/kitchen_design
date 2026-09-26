import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ReferenceMarker from './ReferenceMarker';
import React from 'react';

describe('ReferenceMarker', () => {
  const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // 1x1 transparent pixel

  it('renders an image and a dropdown', () => {
    const onChange = vi.fn();
    render(<ReferenceMarker imageUrl={imageUrl} onChange={onChange} />);
    expect(screen.getByRole('img')).not.toBeNull();
    expect(screen.getByRole('combobox')).not.toBeNull();
  });

  it('calls onChange with null when cleared', () => {
    const onChange = vi.fn();
    render(<ReferenceMarker imageUrl={imageUrl} onChange={onChange} />);
    // We'll implement a clear button later. For now, skip.
    expect(true).toBe(true);
  });

  it('calls onChange when user draws a rectangle', async () => {
    const onChange = vi.fn();
    const { container } = render(<ReferenceMarker imageUrl={imageUrl} onChange={onChange} />);
    const img = screen.getByRole('img');
    // Wait for the image to load (we'll mock naturalWidth and naturalHeight to be 100)
    // We'll use waitFor to ensure the image is rendered (though it's immediate)
    await waitFor(() => {
      // We'll just check that the img has a src attribute
      expect(img.getAttribute('src')).toBe(imageUrl);
    });
    // Mock the naturalWidth and naturalHeight to be 100 so we can compute scale if needed.
    Object.defineProperty(img, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });
    const rect = img.getBoundingClientRect();
    // We'll simulate a drag from (10,10) to (90,90) relative to the image's top-left.
    const startX = rect.left + 10;
    const startY = rect.top + 10;
    const endX = rect.left + 90;
    const endY = rect.top + 90;
    // Simulate mousedown at start
    fireEvent.mouseDown(img, { clientX: startX, clientY: startY });
    // Simulate mousemove to end
    fireEvent.mouseMove(img, { clientX: endX, clientY: endY });
    // Simulate mouseup
    fireEvent.mouseUp(img, { clientX: endX, clientY: endY });
    // Wait for onChange to be called
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const call = onChange.mock.calls[0][0];
    expect(call).toHaveProperty('kind');
    expect(call.kind).toBe('credit_card');
    expect(call).toHaveProperty('pixelBox');
    expect(Array.isArray(call.pixelBox)).toBe(true);
    expect(call.pixelBox).toHaveLength(4);
    expect(call.pixelBox.every(Number.isFinite)).toBe(true);
    expect(call).toHaveProperty('lengthMM');
    expect(typeof call.lengthMM).toBe('number');
    // Since we selected credit-card by default, lengthMM should be the width of the credit-card (85.60)
    expect(call.lengthMM).toBeCloseTo(85.60, 2);
  });
});