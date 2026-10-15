import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import LoginForm from './LoginForm';

const assign = vi.fn();
const fetchMock = vi.fn();

beforeEach(() => {
  assign.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'location', { value: { assign }, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

function fill(email = 'a@x.io', password = 'correct horse battery') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
}

describe('LoginForm', () => {
  it('posts JSON to the login route and navigates to / by default', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    render(<LoginForm canRegister={false} />);
    fill();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@x.io', password: 'correct horse battery' });
  });

  it('shows the error message from a 401 and does not navigate', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401 }));
    render(<LoginForm canRegister={false} />);
    fill();
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password');
    expect(assign).not.toHaveBeenCalled();
  });

  it('offers Create account only when registration is open, and posts to register', async () => {
    const { unmount } = render(<LoginForm canRegister={false} />);
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    unmount();
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
    render(<LoginForm canRegister />);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@x.io' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/register');
  });

  it('honours a safe next path', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    render(<LoginForm canRegister={false} next="/project/abc?x=1" />);
    fill();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/project/abc?x=1'));
  });

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)'])('ignores unsafe next %s', async (next) => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    render(<LoginForm canRegister={false} next={next} />);
    fill();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });
});
