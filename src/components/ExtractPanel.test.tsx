import { render, screen, fireEvent, waitFor, act, cleanup as cleanupRender } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { markOffline, markOnline } from '@/lib/client/online';
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
const JOB = '9d0c8b7a-1234-4abc-8def-0123456789ab';
const KEY = `kd-job:extract:${ID}`;
const job = (status: string, extra: Record<string, unknown> = {}) => json({ id: JOB, kind: 'extract', status, ...extra });
/** Let polling timers fire (fake clock) and React settle. */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

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
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is disabled until there is a photo', () => {
    const { button } = setup(false);
    expect(button().disabled).toBe(true);
    expect(screen.getByText(/upload at least one photo/i)).not.toBeNull();
  });

  it('sends filled-in measurements and the hint, then hands back an llm proposal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockResolvedValueOnce(job('running')).mockResolvedValueOnce(job('done', { result: RESULT }));
    const { onProposal, button } = setup();
    fillRow(0, 'sink wall', '3600');
    fireEvent.click(screen.getByRole('button', { name: /add another wall/i }));
    fillRow(1, 'window wall', '2450');
    fireEvent.change(screen.getByLabelText(/anything else/i), { target: { value: 'galley kitchen' } });
    fireEvent.click(button());
    await tick(1500);
    expect(sessionStorage.getItem(KEY)).toContain(JOB);
    await tick(2500);

    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/jobs/${JOB}`);
    expect(sessionStorage.getItem(KEY)).toBeNull();
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
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202));
    const { button } = setup();
    fireEvent.click(button());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ measurements: [] });
  });

  it('keeps the measured-wall fields in a section that starts closed, and extracts without them', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockResolvedValueOnce(job('running'));
    const { button } = setup();
    const section = screen.getByText(/i measured a wall/i).closest('details')!;
    expect(section.open).toBe(false);
    expect(section.contains(screen.getAllByLabelText(/which wall/i)[0])).toBe(true);
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ measurements: [] });
  });

  it('takes a measured length in feet and inches in an inch project', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockResolvedValueOnce(job('running'));
    render(<ExtractPanel projectId={ID} hasPhotos units="in" onProposal={vi.fn()} />);
    fireEvent.change(screen.getAllByLabelText(/which wall/i)[0], { target: { value: 'sink wall' } });
    fireEvent.change(screen.getAllByLabelText(/length \(ft\/in\)/i)[0], { target: { value: `12' 6"` } });
    fireEvent.click(screen.getByRole('button', { name: /get room from photos/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.measurements[0].lengthMm).toBeCloseTo(3810);
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
    expect(screen.getByText(/usually takes 1–4 minutes/i)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(job('done', { result: RESULT }));
    resolve(json({ jobId: JOB }, 202));
    await tick(1500);
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2); // the POST, then one poll
  });

  it('shows the server error, e.g. no LLM configured', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'LLM_API_KEY is not set. You can still sketch the room by hand.' }, 503));
    const { onProposal, button } = setup();
    fireEvent.click(button());
    expect(await screen.findByText(/LLM_API_KEY is not set/)).not.toBeNull();
    expect(onProposal).not.toHaveBeenCalled();
  });

  it("shows a failed job's error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(json({ jobId: JOB }, 202))
      .mockResolvedValueOnce(job('failed', { error: { status: 502, error: 'the model kept answering badly' } }));
    const { onProposal, button } = setup();
    fireEvent.click(button());
    await tick(1500);
    expect(await screen.findByText('the model kept answering badly')).not.toBeNull();
    expect(onProposal).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('after a rate limit, counts down to a Try again button that runs the same extraction', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(json({ jobId: JOB }, 202))
      .mockResolvedValueOnce(job('failed', { error: { status: 502, error: 'The free AI models are busy right now.', retryAfterMs: 60_000 } }));
    const { button } = setup();
    fillRow(0, 'sink wall', '3600');
    fireEvent.click(button());
    await tick(1500);
    const retry = (await screen.findByRole('button', { name: /try again in 1:00/i })) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    await tick(30_000);
    expect(screen.getByRole('button', { name: /try again in 0:3\d/i })).not.toBeNull();
    await tick(30_000);
    const ready = screen.getByRole('button', { name: /^try again$/i }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202));
    fireEvent.click(ready);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe(`/api/projects/${ID}/extract`);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ measurements: [{ description: 'sink wall', lengthMm: 3600 }] });
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('shows the time to come back when the wait is long (daily quota)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(json({ jobId: JOB }, 202))
      .mockResolvedValueOnce(job('failed', { error: { status: 502, error: 'limit used up', retryAfterMs: 3 * 60 * 60 * 1000 } }));
    const { button } = setup();
    fireEvent.click(button());
    await tick(1500);
    expect(await screen.findByRole('button', { name: /try again after/i })).not.toBeNull();
  });

  it('offers no Try again for errors that are not rate limits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(json({ jobId: JOB }, 202))
      .mockResolvedValueOnce(job('failed', { error: { status: 502, error: 'bad answer' } }));
    const { button } = setup();
    fireEvent.click(button());
    await tick(1500);
    expect(await screen.findByText('bad answer')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('explains a job the server lost (404 while polling)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockResolvedValueOnce(json({ error: 'job not found' }, 404));
    const { button } = setup();
    fireEvent.click(button());
    await tick(1500);
    expect(await screen.findByText('The request was lost (the server restarted). Please try again.')).not.toBeNull();
  });

  it('says it is still working after 20 s, with a clock that shows the time passing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockImplementation(async () => job('running'));
    const { button } = setup();
    fireEvent.click(button());
    expect(screen.getByRole('status').textContent).toMatch(/0:00/);
    await tick(19_000);
    expect(screen.queryByText(/still working/i)).toBeNull();
    await tick(1_500);
    expect(screen.getByText(/still working/i)).not.toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/0:(19|2\d)/);
  });

  it('resumes polling a remembered job after a remount instead of posting again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockImplementation(async () => job('running'));
    const first = setup();
    fireEvent.click(first.button());
    await tick(1500);
    cleanupRender();
    expect(sessionStorage.getItem(KEY)).toContain(JOB);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(job('done', { result: RESULT }));
    const second = setup();
    expect(screen.getByText(/usually takes 1–4 minutes/i)).not.toBeNull();
    await tick(1500);
    await waitFor(() => expect(second.onProposal).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/jobs/${JOB}`);
    expect(first.onProposal).not.toHaveBeenCalled();
  });

  it('on a lost connection, says so and keeps the job so reopening the panel resumes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockImplementation(async () => json({ error: 'down' }, 503));
    const first = setup();
    fireEvent.click(first.button());
    await tick(130_000);
    expect(await screen.findByText('Connection lost — reopen this panel to check the result')).not.toBeNull();
    expect(first.button().disabled).toBe(false);
    expect(sessionStorage.getItem(KEY)).toContain(JOB);

    cleanupRender();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(job('done', { result: RESULT }));
    const second = setup();
    await tick(1500);
    await waitFor(() => expect(second.onProposal).toHaveBeenCalled());
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe('ExtractPanel offline', () => {
  afterEach(() => act(() => markOnline()));
  it('disables the extract button while offline', () => {
    const { button } = setup();
    act(() => markOffline());
    expect(button().disabled).toBe(true);
    expect(button().title).toBe('Offline');
  });
});
