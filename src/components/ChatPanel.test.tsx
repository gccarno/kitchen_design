import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ChatPanel from './ChatPanel';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the message and turns an edit into an LLM proposal', async () => {
    fetchMock.mockResolvedValueOnce(json(EDIT));
    const { onProposal, say, box } = setup();
    say('move the fridge to the north wall');

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
    fetchMock.mockResolvedValueOnce(json({ ...EDIT, commands: [], patch: [], summary: '', reply: 'The room is 3 × 4 m.' }));
    const { onProposal, say } = setup();
    say('how big is the room?');
    expect(await screen.findByText('The room is 3 × 4 m.')).not.toBeNull();
    expect(onProposal).not.toHaveBeenCalled();
  });

  it('sends recent turns as history for follow-ups', async () => {
    fetchMock.mockResolvedValueOnce(json(EDIT)).mockResolvedValueOnce(json(EDIT));
    const { say } = setup();
    say('move the fridge to the north wall');
    await screen.findByText(/Moved the fridge/);
    say('a bit further left');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
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
      .mockResolvedValueOnce(json(EDIT));
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
    resolve(json(EDIT));
    await waitFor(() => expect(screen.queryByText(/thinking/i)).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends on Enter and adds a newline on Shift+Enter', async () => {
    fetchMock.mockResolvedValueOnce(json(EDIT));
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
});
