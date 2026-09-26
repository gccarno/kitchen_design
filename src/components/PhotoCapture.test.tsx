import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import PhotoCapture from './PhotoCapture';
import type { Photo } from '@/lib/plan/schemas';

const PROJECT = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  path: `photos/${id}.jpg`,
  width: 400,
  height: 300,
  ...extra,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Make a rendered marker image measurable, then drag a box on it (display 200×150, natural 400×300). */
function drawBox(index = 0) {
  const img = screen.getAllByRole('img')[index] as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 300, configurable: true });
  img.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 150, right: 200, bottom: 150, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  fireEvent.load(img);
  const surface = screen.getAllByTestId('reference-surface')[index];
  fireEvent.pointerDown(surface, { pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(surface, { pointerId: 1, clientX: 110, clientY: 60 });
  fireEvent.pointerUp(surface, { pointerId: 1, clientX: 110, clientY: 60 });
}

describe('PhotoCapture', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers a camera input and a multi-select library input', () => {
    render(<PhotoCapture projectId={PROJECT} />);
    const camera = screen.getByLabelText(/take photo/i) as HTMLInputElement;
    const library = screen.getByLabelText(/choose photos/i) as HTMLInputElement;
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(camera.accept).toBe('image/*');
    expect(library.multiple).toBe(true);
    expect(library.hasAttribute('capture')).toBe(false);
  });

  it('renders existing photos served from the photo route', () => {
    render(<PhotoCapture projectId={PROJECT} initialPhotos={[photo('a'), photo('b')]} />);
    const srcs = screen.getAllByRole('img').map((i) => i.getAttribute('src'));
    expect(srcs).toEqual([`/api/projects/${PROJECT}/photos/a`, `/api/projects/${PROJECT}/photos/b`]);
  });

  it('uploads each chosen file and shows it once saved', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ photo: photo('one') }, 201))
      .mockResolvedValueOnce(jsonResponse({ photo: photo('two') }, 201));
    const onPhotosChange = vi.fn();
    render(<PhotoCapture projectId={PROJECT} onPhotosChange={onPhotosChange} />);

    const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })];
    fireEvent.change(screen.getByLabelText(/choose photos/i), { target: { files } });

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/upload');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('projectId')).toBe(PROJECT);
    expect((form.get('file') as File).name).toBe('a.jpg');
    expect(onPhotosChange).toHaveBeenLastCalledWith([photo('one'), photo('two')]);
  });

  it('shows an upload error and keeps going with the next file', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'file is not a readable image' }, 400))
      .mockResolvedValueOnce(jsonResponse({ photo: photo('ok') }, 201));
    render(<PhotoCapture projectId={PROJECT} />);
    const files = [new File(['x'], 'bad.jpg', { type: 'image/jpeg' }), new File(['y'], 'good.jpg', { type: 'image/jpeg' })];
    fireEvent.change(screen.getByLabelText(/choose photos/i), { target: { files } });

    expect(await screen.findByText(/bad\.jpg.*not a readable image/i)).not.toBeNull();
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));
  });

  it('saves a marked reference with PUT to the reference route', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ photo: photo('a', { referenceObject: { kind: 'credit_card', side: 'long', knownSizeMm: 85.6, pixelBox: [20, 20, 220, 120] } }) })
    );
    render(<PhotoCapture projectId={PROJECT} initialPhotos={[photo('a')]} />);
    drawBox();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${PROJECT}/photos/a/reference`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ kind: 'credit_card', side: 'long', pixelBox: [20, 20, 220, 120] });
    expect(await screen.findByText(/saved/i)).not.toBeNull();
  });

  it('clears a reference with DELETE', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ photo: photo('a') }));
    const withRef = photo('a', {
      referenceObject: { kind: 'credit_card', side: 'long', knownSizeMm: 85.6, pixelBox: [20, 20, 220, 120] },
    });
    render(<PhotoCapture projectId={PROJECT} initialPhotos={[withRef]} />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${PROJECT}/photos/a/reference`);
    expect(init.method).toBe('DELETE');
  });

  it('passes a saved custom reference back to the marker with its size', () => {
    const withCustom = photo('a', {
      referenceObject: { kind: 'custom', side: 'long', knownSizeMm: 600, pixelBox: [0, 0, 100, 10] },
    });
    render(<PhotoCapture projectId={PROJECT} initialPhotos={[withCustom]} />);
    expect((screen.getByLabelText(/size \(mm\)/i) as HTMLInputElement).value).toBe('600');
  });
});
