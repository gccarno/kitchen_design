import { describe, it, expect } from 'vitest';
import { parseTraces, readReasoning, REASONING_MAX } from './reasoning';

describe('readReasoning', () => {
  it('reads message.reasoning', () => {
    expect(readReasoning({ reasoning: '  Width: 12 ft.\nSo 3657.6 mm.  ' })).toBe('Width: 12 ft.\nSo 3657.6 mm.');
  });

  it('falls back to the text (or summary) of reasoning_details', () => {
    const details = [
      { type: 'reasoning.text', text: 'step one' },
      { type: 'reasoning.encrypted', data: 'xx' },
      { type: 'reasoning.summary', summary: 'in short' },
    ];
    expect(readReasoning({ reasoning_details: details })).toBe('step one\n\nin short');
  });

  it('is undefined when the model gave none', () => {
    expect(readReasoning({})).toBeUndefined();
    expect(readReasoning({ reasoning: '   ', reasoning_details: [{ type: 'reasoning.encrypted', data: 'x' }] })).toBeUndefined();
    expect(readReasoning({ reasoning: null })).toBeUndefined();
  });

  it('cuts a very long trace short, saying so', () => {
    const out = readReasoning({ reasoning: 'x'.repeat(REASONING_MAX + 500) })!;
    expect(out.startsWith('x'.repeat(REASONING_MAX))).toBe(true);
    expect(out.endsWith('… (cut short)')).toBe(true);
  });
});

describe('parseTraces', () => {
  it('keeps well-formed traces and drops the rest', () => {
    expect(
      parseTraces([
        { model: 'a/m', outcome: 'ok', text: 'why' },
        { text: 'no model', outcome: 'bad_json' },
        { text: '' },
        null,
        'x',
        { model: 1, text: 'odd' },
      ])
    ).toEqual([
      { model: 'a/m', outcome: 'ok', text: 'why' },
      { outcome: 'bad_json', text: 'no model' },
      { outcome: 'ok', text: 'odd' },
    ]);
  });

  it('is undefined for nothing usable', () => {
    expect(parseTraces(undefined)).toBeUndefined();
    expect(parseTraces({ text: 'x' })).toBeUndefined();
    expect(parseTraces([])).toBeUndefined();
  });
});
