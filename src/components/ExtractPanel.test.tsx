import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ExtractPanel from './ExtractPanel';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const RESULT = {
  room: {},
  patch: [{ op: 'replace', path: '/name', value: 'x' }],
  baseRevision: 1,
  confidence: 0.8,
  notes: 'n',
  warnings: [],
  scale: 1,
  residual: 0,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(hasPhotos = true) {
  const onProposal = vi.fn();
  render(<ExtractPanel projectId={ID} hasPhotos={hasPhotos} onProposal={onProposal} />);
  return { onProposal, button: () => screen.getByRole('button', { name: /get room from photos/i }) as HTMLButtonElement };
}

function fillRow(i: number, description: string, mm: string) {
  fireEvent.change(screen.getAllByLabelText(/which wall/i)[i], { target: { value: description } });
  fireEvent.change(screen.getAllByLabelText(/length \(mm\)/i)[i], { target: { value: mm } });
}

describe('ExtractPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is disabled until there is a photo', () => {
    const { button } = setup(false);
    expect(button().disabled).toBe(true);
    expect(screen.getByText(/upload at least one photo/i)).not.toBeNull();
  });

  it('sends filled-in measurements and the hint, then hands back an llm proposal', async () => {
    fetchMock.mockResolvedValueOnce(json(RESULT));
    const { onProposal, button } = setup();
    fillRow(0, 'sink wall', '3600');
    fireEvent.click(screen.getByRole('button', { name: /add another wall/i }));
    fillRow(1, 'window wall', '2450');
    fireEvent.change(screen.getByLabelText(/anything else/i), { target: { value: 'galley kitchen' } });
    fireEvent.click(button());

    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${ID}/extract`);
    expect(JSON.parse(init.body)).toEqual({
      measurements: [
        { description: 'sink wall', lengthMm: 3600 },
        { description: 'window wall', lengthMm: 2450 },
      ],
      hint: 'galley kitchen',
    });
    expect(onProposal.mock.calls[0][0]).toMatchObject({ source: 'llm', confidence: 0.8, baseRevision: 1 });
  });

  it('allows extracting with no measurements (blank rows are ignored)', async () => {
    fetchMock.mockResolvedValueOnce(json(RESULT));
    const { button } = setup();
    fireEvent.click(button());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ measurements: [] });
  });

  it('blocks a half-filled measurement row', () => {
    const { button } = setup();
    fillRow(0, 'sink wall', '');
    expect(button().disabled).toBe(true);
    expect(screen.getByText(/each measurement needs a wall and a length/i)).not.toBeNull();
  });

  it('caps measurements at four', () => {
    setup();
    const add = () => screen.getByRole('button', { name: /add another wall/i }) as HTMLButtonElement;
    for (let i = 0; i < 3; i++) fireEvent.click(add());
    expect(screen.getAllByLabelText(/which wall/i)).toHaveLength(4);
    expect(add().disabled).toBe(true);
  });

  it('removes a measurement row', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /add another wall/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    expect(screen.getAllByLabelText(/which wall/i)).toHaveLength(1);
  });

  it('shows progress while the model works, and one request per click', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { button } = setup();
    fireEvent.click(button());
    fireEvent.click(button());
    expect(screen.getByText(/can take up to a minute/i)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(json(RESULT));
    await waitFor(() => expect(button().disabled).toBe(false));
  });

  it('shows the server error, e.g. no LLM configured', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'LLM_API_KEY is not set. You can still sketch the room by hand.' }, 503));
    const { onProposal, button } = setup();
    fireEvent.click(button());
    expect(await screen.findByText(/LLM_API_KEY is not set/)).not.toBeNull();
    expect(onProposal).not.toHaveBeenCalled();
  });
});
