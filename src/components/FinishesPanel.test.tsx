import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { markOffline, markOnline } from '@/lib/client/online';
import { DEFAULT_FINISHES } from '@/lib/plan/finishes';
import { newProject } from '@/lib/plan/new-project';
import type { Finishes, Project } from '@/lib/plan/schemas';
import FinishesPanel from './FinishesPanel';

const plain: Project = newProject({ name: 'Kitchen' });
const withFinishes = (f: Finishes): Project => ({ ...plain, finishes: f });
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('FinishesPanel', () => {
  afterEach(() => act(() => markOnline()));

  it('shows the standard look when none was chosen, with no reset button', () => {
    render(<FinishesPanel project={plain} onSave={vi.fn()} />);
    expect((screen.getByLabelText('Cabinet colour') as HTMLSelectElement).value).toBe('#f3e8d2');
    expect((screen.getByLabelText('Door style') as HTMLSelectElement).value).toBe('shaker');
    expect((screen.getByLabelText('Countertop') as HTMLSelectElement).value).toBe('quartz');
    expect(screen.getByText(/Standard: natural wood cabinets, shaker doors, quartz countertop/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset to standard' })).toBeNull();
  });

  it('saves each pick straight away, changing only that field, and says what changed', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<FinishesPanel project={plain} onSave={onSave} />);
    pick('Cabinet colour', '#f5f5f4');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_FINISHES, cabinetColor: '#f5f5f4' }, 'Cabinet colour: Natural wood → White');
    pick('Door style', 'glass');
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_FINISHES, doorStyle: 'glass' }, 'Door style: Shaker → Glass-front');
    pick('Countertop', 'granite');
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_FINISHES, countertop: 'granite' }, 'Countertop: Quartz → Granite');
  });

  it('shows what is set, and goes back to the standard look on reset', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<FinishesPanel project={withFinishes({ cabinetColor: '#1e3a5f', doorStyle: 'slab', countertop: 'laminate' })} onSave={onSave} />);
    expect((screen.getByLabelText('Cabinet colour') as HTMLSelectElement).value).toBe('#1e3a5f');
    expect(screen.getByText(/Navy cabinets, slab \(flat\) doors, laminate countertop/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to standard' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(undefined, 'Reset finishes to standard'));
  });

  it('keeps a colour the chat set, which is not a preset, in the list', () => {
    render(<FinishesPanel project={withFinishes({ ...DEFAULT_FINISHES, cabinetColor: '#AA0000' })} onSave={vi.fn()} />);
    const select = screen.getByLabelText('Cabinet colour') as HTMLSelectElement;
    expect(select.value).toBe('#aa0000');
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('#aa0000');
  });

  it('says why a save failed', async () => {
    render(<FinishesPanel project={plain} onSave={vi.fn().mockResolvedValue('plan changed')} />);
    pick('Door style', 'slab');
    expect((await screen.findByRole('alert')).textContent).toBe('Not saved: plan changed');
  });

  it('is read-only offline', () => {
    render(<FinishesPanel project={withFinishes(DEFAULT_FINISHES)} onSave={vi.fn()} />);
    act(() => markOffline());
    for (const label of ['Cabinet colour', 'Door style', 'Countertop']) expect((screen.getByLabelText(label) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reset to standard' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
