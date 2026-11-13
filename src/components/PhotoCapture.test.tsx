import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { markOffline, markOnline } from '@/lib/client/online';
import { act as actOffline } from '@testing-library/react';
import PhotoCapture, { PICKER_PENDING_KEY, UPLOAD_TIMEOUT_MS } from './PhotoCapture';

const monitoring = vi.hoisted(() => ({ reportUploadFailure: vi.fn(), uploadStep: vi.fn(), reportPickerLost: vi.fn() }));
vi.mock('@/lib/client/monitoring', () => monitoring);
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

/** Open the reference marker on a photo (it starts closed). */
function openMarker(index = 0) {
  fireEvent.click(screen.getAllByRole('button', { name: /mark a known-size object|edit the marked object/i })[index]);
}

/** Make a rendered marker image measurable, then drag a box on it (display 200×150, natural 400×300). */
function drawBox(index = 0, { alreadyOpen = false } = {}) {
  if (!alreadyOpen) openMarker(index);
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

  it('reports a failed upload with its status, and a network failure as status 0', async () => {
    monitoring.reportUploadFailure.mockClear();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'too big' }, 413)).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<PhotoCapture projectId={PROJECT} />);
    const files = [new File(['xx'], 'a.jpg', { type: 'image/jpeg' }), new File(['y'], 'b.jpg', { type: 'image/jpeg' })];
    fireEvent.change(screen.getByLabelText(/choose photos/i), { target: { files } });
    await waitFor(() => expect(monitoring.reportUploadFailure).toHaveBeenCalledTimes(2));
    expect(monitoring.reportUploadFailure.mock.calls[0][0]).toMatchObject({ status: 413, error: 'too big', sizeBytes: 2, mimeType: 'image/jpeg' });
    expect(monitoring.reportUploadFailure.mock.calls[1][0]).toMatchObject({ status: 0, error: 'Failed to fetch' });
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
    openMarker();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${PROJECT}/photos/a/reference`);
    expect(init.method).toBe('DELETE');
  });

  it('shows a photo without the reference marker until asked, and can close it again', () => {
    render(<PhotoCapture projectId={PROJECT} initialPhotos={[photo('a')]} />);
    expect(screen.queryByTestId('reference-surface')).toBeNull();
    expect(screen.queryByLabelText('Reference object')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /mark a known-size object \(optional\)/i }));
    expect(screen.getByTestId('reference-surface')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /done marking/i }));
    expect(screen.queryByTestId('reference-surface')).toBeNull();
  });

  it('offers to edit a photo that already has a marked object', () => {
    const withRef = photo('a', {
      referenceObject: { kind: 'credit_card', side: 'long', knownSizeMm: 85.6, pixelBox: [20, 20, 220, 120] },
    });
    render(<PhotoCapture projectId={PROJECT} initialPhotos={[withRef]} />);
    expect(screen.getByRole('button', { name: /edit the marked object/i })).not.toBeNull();
  });

  it('passes a saved custom reference back to the marker with its size', () => {
    const withCustom = photo('a', {
      referenceObject: { kind: 'custom', side: 'long', knownSizeMm: 600, pixelBox: [0, 0, 100, 10] },
    });
    render(<PhotoCapture projectId={PROJECT} initialPhotos={[withCustom]} />);
    openMarker();
    expect((screen.getByLabelText(/size \(mm\)/i) as HTMLInputElement).value).toBe('600');
  });
});

describe('PhotoCapture upload diagnostics', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    Object.values(monitoring).forEach((f) => f.mockClear());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('records each step of a successful upload, without file names', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ photo: photo('one') }, 201));
    render(<PhotoCapture projectId={PROJECT} />);
    const input = screen.getByLabelText(/take photo/i);
    fireEvent.click(input);
    fireEvent.change(input, { target: { files: [new File(['abc'], 'secret-name.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));
    expect(monitoring.uploadStep.mock.calls.map((c) => c[0])).toEqual(['picker-open', 'files-picked', 'upload-start', 'upload-done']);
    expect(JSON.stringify(monitoring.uploadStep.mock.calls)).not.toContain('secret-name');
    expect(localStorage.getItem(PICKER_PENDING_KEY)).toBeNull();
  });

  it('reports a camera result lost to a reload and asks for the photo again', () => {
    localStorage.setItem(PICKER_PENDING_KEY, JSON.stringify({ source: 'camera', at: Date.now() - 30_000 }));
    render(<PhotoCapture projectId={PROJECT} />);
    expect(monitoring.reportPickerLost).toHaveBeenCalledTimes(1);
    expect(monitoring.reportPickerLost.mock.calls[0][0]).toMatchObject({ source: 'camera' });
    expect(screen.getByRole('alert').textContent).toMatch(/didn.t come through/i);
    expect(localStorage.getItem(PICKER_PENDING_KEY)).toBeNull();
  });

  it('ignores a marker older than ten minutes', () => {
    localStorage.setItem(PICKER_PENDING_KEY, JSON.stringify({ source: 'camera', at: Date.now() - 60 * 60 * 1000 }));
    render(<PhotoCapture projectId={PROJECT} />);
    expect(monitoring.reportPickerLost).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the marker when the picker is cancelled', () => {
    const { unmount } = render(<PhotoCapture projectId={PROJECT} />);
    const input = screen.getByLabelText(/choose photos/i);
    fireEvent.click(input);
    expect(localStorage.getItem(PICKER_PENDING_KEY)).not.toBeNull();
    input.dispatchEvent(new Event('cancel'));
    expect(localStorage.getItem(PICKER_PENDING_KEY)).toBeNull();
    expect(monitoring.uploadStep).toHaveBeenLastCalledWith('picker-cancelled');
    fireEvent.click(input);
    unmount();
    expect(localStorage.getItem(PICKER_PENDING_KEY)).toBeNull();
  });

  it('reports an empty file and does not send it', async () => {
    render(<PhotoCapture projectId={PROJECT} />);
    fireEvent.change(screen.getByLabelText(/choose photos/i), { target: { files: [new File([], 'a.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByText(/came through empty/i)).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(monitoring.reportUploadFailure.mock.calls[0][0]).toMatchObject({ status: -1, sizeBytes: 0 });
  });

  it('gives up on an upload that never answers, and reports it as a timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );
    render(<PhotoCapture projectId={PROJECT} />);
    fireEvent.change(screen.getByLabelText(/choose photos/i), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    await actOffline(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS + 10);
    });
    expect(monitoring.reportUploadFailure).toHaveBeenCalledTimes(1);
    expect(monitoring.reportUploadFailure.mock.calls[0][0]).toMatchObject({ status: 0, timedOut: true });
    expect(screen.getByText(/timed out/i)).not.toBeNull();
  });
});

describe('PhotoCapture offline', () => {
  afterEach(() => actOffline(() => markOnline()));
  it('disables both upload inputs while offline', () => {
    const { container } = render(<PhotoCapture projectId={PROJECT} />);
    actOffline(() => markOffline());
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBe(2);
    inputs.forEach((i) => expect((i as HTMLInputElement).disabled).toBe(true));
  });
});

describe('PhotoCapture offline reference marker', () => {
  afterEach(() => actOffline(() => markOnline()));
  it('makes the reference marker read-only and saves nothing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<PhotoCapture projectId={PROJECT} initialPhotos={[photo('a')]} />);
    actOffline(() => markOffline());
    openMarker();
    expect((screen.getByLabelText('Reference object') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Edge in the box') as HTMLSelectElement).disabled).toBe(true);
    drawBox(0, { alreadyOpen: true });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
