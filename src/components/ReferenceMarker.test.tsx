import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import ReferenceMarker from './ReferenceMarker';

const imageUrl = '/api/projects/p/photos/ph';

/**
 * The image is displayed at 200×150 CSS px but is 400×300 natural px, so
 * every display coordinate should be doubled in the emitted pixelBox.
 */
function setup(props: Partial<React.ComponentProps<typeof ReferenceMarker>> = {}) {
  const onChange = vi.fn();
  render(<ReferenceMarker imageUrl={imageUrl} onChange={onChange} {...props} />);
  const img = screen.getByRole('img') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 300, configurable: true });
  img.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 150, right: 200, bottom: 150, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  fireEvent.load(img);
  const surface = screen.getByTestId('reference-surface');
  return { onChange, img, surface };
}

function drag(surface: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(surface, { pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(surface, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(surface, { pointerId: 1, clientX: to[0], clientY: to[1] });
}

describe('ReferenceMarker', () => {
  it('renders the photo plus object and side pickers', () => {
    setup();
    expect(screen.getByRole('img').getAttribute('src')).toBe(imageUrl);
    expect(screen.getByLabelText(/reference object/i)).not.toBeNull();
    expect(screen.getByLabelText(/edge/i)).not.toBeNull();
  });

  it('emits the box in natural image pixels, not CSS pixels', () => {
    const { onChange, surface } = setup();
    drag(surface, [10, 10], [110, 60]);
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'credit_card',
      side: 'long',
      pixelBox: [20, 20, 220, 120],
    });
  });

  it('normalizes a box dragged up and to the left', () => {
    const { onChange, surface } = setup();
    drag(surface, [110, 60], [10, 10]);
    expect(onChange.mock.lastCall?.[0].pixelBox).toEqual([20, 20, 220, 120]);
  });

  it('clamps the box to the image bounds', () => {
    const { onChange, surface } = setup();
    drag(surface, [150, 100], [260, 190]);
    expect(onChange.mock.lastCall?.[0].pixelBox).toEqual([300, 200, 400, 300]);
  });

  it('ignores a tap that does not drag', () => {
    const { onChange, surface } = setup();
    drag(surface, [50, 50], [50, 50]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an existing box when the user taps (or a wobbly tap moves a pixel)', () => {
    const { onChange, surface } = setup();
    drag(surface, [10, 10], [110, 60]);
    onChange.mockClear();
    drag(surface, [150, 100], [150.5, 100.5]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('reference-box').style.left).toBe('5%');
    expect(screen.getByTestId('reference-box').style.width).toBe('50%');
  });

  it('restores the previous box when the pointer is cancelled mid-drag', () => {
    const { surface } = setup();
    drag(surface, [10, 10], [110, 60]);
    fireEvent.pointerDown(surface, { pointerId: 2, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 190, clientY: 140 });
    fireEvent.pointerCancel(surface, { pointerId: 2 });
    expect(screen.getByTestId('reference-box').style.left).toBe('5%');
  });

  it('shows a live preview rectangle while dragging', () => {
    const { surface } = setup();
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 20, clientY: 15 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 120, clientY: 90 });
    const box = screen.getByTestId('reference-box');
    // Positioned as a percentage of the image, so it tracks resizes.
    expect(box.style.left).toBe('10%');
    expect(box.style.top).toBe('10%');
    expect(box.style.width).toBe('50%');
    expect(box.style.height).toBe('50%');
  });

  it('re-emits when the object kind or edge changes after drawing', () => {
    const { onChange, surface } = setup();
    drag(surface, [10, 10], [110, 60]);
    fireEvent.change(screen.getByLabelText(/reference object/i), { target: { value: 'a4_paper' } });
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ kind: 'a4_paper', side: 'long' });
    fireEvent.change(screen.getByLabelText(/edge/i), { target: { value: 'short' } });
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ kind: 'a4_paper', side: 'short' });
  });

  it('asks for a size for a custom object and only emits once it is valid', () => {
    const { onChange, surface } = setup();
    fireEvent.change(screen.getByLabelText(/reference object/i), { target: { value: 'custom' } });
    drag(surface, [10, 10], [110, 60]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/size \(mm\)/i), { target: { value: '600' } });
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'custom',
      side: 'long',
      customSizeMm: 600,
      pixelBox: [20, 20, 220, 120],
    });
  });

  it('clears the box and emits null', () => {
    const { onChange, surface } = setup();
    drag(surface, [10, 10], [110, 60]);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId('reference-box')).toBeNull();
  });

  it('starts from an existing value', () => {
    setup({ value: { kind: 'us_letter', side: 'short', pixelBox: [40, 30, 240, 180] } });
    expect((screen.getByLabelText(/reference object/i) as HTMLSelectElement).value).toBe('us_letter');
    expect((screen.getByLabelText(/edge/i) as HTMLSelectElement).value).toBe('short');
    expect(screen.getByTestId('reference-box').style.left).toBe('10%');
  });
});
