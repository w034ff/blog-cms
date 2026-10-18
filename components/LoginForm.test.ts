import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginForm } from './LoginForm';

// docs/multi-author-requirements.md §9.9 row 19.
describe('LoginForm (criteria 19)', () => {
  it('renders a link to /auth/google when showGoogle is true', () => {
    const html = renderToStaticMarkup(React.createElement(LoginForm, { showGoogle: true }));
    expect(html).toContain('href="/auth/google"');
    expect(html).toContain('Google でログイン');
  });

  it('omits the Google login button when showGoogle is false', () => {
    const html = renderToStaticMarkup(React.createElement(LoginForm, { showGoogle: false }));
    expect(html).not.toContain('/auth/google');
    expect(html).not.toContain('Google でログイン');
  });

  it('renders the error message when passed', () => {
    const html = renderToStaticMarkup(
      React.createElement(LoginForm, {
        showGoogle: false,
        errorMessage: 'このメールアドレスは招待されていません。',
      }),
    );
    expect(html).toContain('このメールアドレスは招待されていません。');
    expect(html).toContain('role="alert"');
  });
});
