import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the public player route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /duckfeed radio/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /duckfeed/i })).toBeInTheDocument();
  });

  it('renders the admin login route', () => {
    render(
      <MemoryRouter initialEntries={['/admin/login']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
  });
});
