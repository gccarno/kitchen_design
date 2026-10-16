import { render, screen, fireEvent, waitFor, act, cleanup as cleanupRender } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ChatPanel from './ChatPanel';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const JOB = '9d0c8b7a-1234-4abc-8def-0123456789ab';
const KEY = `kd-job:refine:${ID}`;
const job = (status: string, extra: Record<string, unknown> = {}) => json({ id: JOB, kind: 'refine', status, ...extra });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
/** The server's answer to one request: POST → 202 { jobId }, then the job, polled, is done with `result`. */
const viaJob = (result: unknown) => [json({ jobId: JOB }, 202), job('done', { result })];

const EDIT = {
  commands: [{ type: 'moveItem', item: 'i1', wall: 'w1' }],
  patch: [{ op: 'replace', path: '/items/0/position/y', value: 325 }],
  summary: 'Move the fridge to the north wall',
  reply: 'Moved the fridge.',
  warnings: [],
  baseRevision: 3,
};

function setup() {
  const onProposal = vi.fn();
  render(<ChatPanel projectId={ID} onProposal={onProposal} />);
  const box = screen.getByLabelText(/ask for a change/i) as HTMLTextAreaElement;
  const send = () => screen.getByRole('button', { name: /send/i }) as HTMLButtonElement;
  const say = (text: string) => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.click(send());
  };
  return { onProposal, box, send, say };
}

describe('ChatPanel', () => {
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

  it('sends the message and turns an edit into an LLM proposal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockResolvedValueOnce(job('done', { result: EDIT }));
    const { onProposal, say, box } = setup();
    say('move the fridge to the north wall');
    await tick(1500);

    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${ID}/refine`);
    expect(JSON.parse(init.body)).toEqual({ message: 'move the fridge to the north wall', history: [] });
    expect(onProposal.mock.calls[0][0]).toMatchObject({
      source: 'llm',
      summary: 'Move the fridge to the north wall',
      notes: 'Moved the fridge.',
      baseRevision: 3,
    });
    expect(screen.getByText('move the fridge to the north wall')).not.toBeNull();
    const bubble = screen.getByText(/Moved the fridge\./).closest('li')!;
    expect(bubble.textContent).toMatch(/Moved the fridge\..*review the change above/i);
    expect(box.value).toBe('');
  });

  it('shows a plain reply without proposing anything', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    for (const r of viaJob({ ...EDIT, commands: [], patch: [], summary: '', reply: 'The room is 3 × 4 m.' })) fetchMock.mockResolvedValueOnce(r);
    const { onProposal, say } = setup();
    say('how big is the room?');
    await tick(1500);
    expect(await screen.findByText('The room is 3 × 4 m.')).not.toBeNull();
    expect(onProposal).not.toHaveBeenCalled();
  });

  it('sends recent turns as history for follow-ups', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    for (const r of [...viaJob(EDIT), ...viaJob(EDIT)]) fetchMock.mockResolvedValueOnce(r);
    const { say } = setup();
    say('move the fridge to the north wall');
    await tick(1500);
    await screen.findByText(/Moved the fridge/);
    say('a bit further left');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      message: 'a bit further left',
      history: [
        { role: 'user', content: 'move the fridge to the north wall' },
        { role: 'assistant', content: 'Moved the fridge.' },
      ],
    });
  });

  it('shows errors in the conversation but leaves them out of the history', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: 'LLM request timed out after 120000 ms' }, 502))
      .mockResolvedValueOnce(json({ jobId: JOB }, 202));
    const { say } = setup();
    say('first try');
    expect(await screen.findByText(/timed out/)).not.toBeNull();
    say('second try');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).history).toEqual([{ role: 'user', content: 'first try' }]);
  });

  it('shows progress, sends once, and re-enables afterwards', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { say, send } = setup();
    say('add a dishwasher');
    expect(screen.getByText(/thinking/i)).not.toBeNull();
    expect(send().disabled).toBe(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(job('done', { result: EDIT }));
    resolve(json({ jobId: JOB }, 202));
    await tick(1500);
    await waitFor(() => expect(screen.queryByText(/thinking/i)).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2); // the POST, then one poll
  });

  it('sends on Enter and adds a newline on Shift+Enter', async () => {
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202));
    const { box } = setup();
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('does not send an empty message', () => {
    const { send } = setup();
    expect(send().disabled).toBe(true);
  });

  it("shows a failed job's error in the conversation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(json({ jobId: JOB }, 202))
      .mockResolvedValueOnce(job('failed', { error: { status: 502, error: 'LLM request timed out after 120000 ms' } }));
    const { say, send } = setup();
    say('add a dishwasher');
    await tick(1500);
    expect(await screen.findByText('Sorry — LLM request timed out after 120000 ms')).not.toBeNull();
    expect(screen.queryByText(/thinking/i)).toBeNull();
    expect(send().disabled).toBe(true); // empty draft
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('explains a job the server lost (404 while polling)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockResolvedValueOnce(json({ error: 'job not found' }, 404));
    const { say } = setup();
    say('add a dishwasher');
    await tick(1500);
    expect(await screen.findByText('Sorry — The request was lost (the server restarted). Please try again.')).not.toBeNull();
  });

  it('says it is still working after 20 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockImplementation(async () => job('running'));
    const { say } = setup();
    say('add a dishwasher');
    await tick(19_000);
    expect(screen.queryByText(/still working/i)).toBeNull();
    await tick(1_500);
    expect(screen.getByText(/still working/i)).not.toBeNull();
  });

  it('resumes a remembered request after a remount, showing the question and then the answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockImplementation(async () => job('running'));
    setup().say('move the fridge to the north wall');
    await tick(1500);
    cleanupRender();
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ jobId: JOB, message: 'move the fridge to the north wall' });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(job('done', { result: EDIT }));
    const { onProposal } = setup();
    expect(screen.getByText('move the fridge to the north wall')).not.toBeNull();
    expect(screen.getByText(/thinking/i)).not.toBeNull();
    await tick(1500);
    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/jobs/${JOB}`);
    expect(screen.getByText(/Moved the fridge\./)).not.toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('on a lost connection, says so and keeps the job so reopening the panel resumes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(json({ jobId: JOB }, 202)).mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    setup().say('add a dishwasher');
    await tick(130_000);
    expect(await screen.findByText('Sorry — Connection lost — reopen this panel to check the result')).not.toBeNull();
    expect(screen.queryByText(/thinking/i)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ jobId: JOB });

    cleanupRender();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(job('done', { result: EDIT }));
    const { onProposal } = setup();
    await tick(1500);
    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
