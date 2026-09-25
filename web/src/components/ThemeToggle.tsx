'use client';

import { useEffect, useState } from 'react';

type Choice = 'system' | 'light' | 'dark';
const ORDER: Choice[] = ['system', 'light', 'dark'];
const LABEL: Record<Choice, string> = { system: 'Match system', light: 'Light', dark: 'Dark' };

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', choice);
  } catch {
    // Storage can be unavailable (private windows); the choice still applies to this page.
  }
}

/** Cycles system, light, dark. The label names the current state, not the next one. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [choice, setChoice] = useState<Choice>('system');

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setChoice(t === 'light' || t === 'dark' ? t : 'system');
  }, []);

  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
  return (
    <button
      type="button"
      onClick={() => { apply(next); setChoice(next); }}
      className={`inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-2 hover:text-ink ${className}`}
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[next]}.`}
    >
      <ThemeIcon choice={choice} />
      <span>{LABEL[choice]}</span>
    </button>
  );
}

function ThemeIcon({ choice }: { choice: Choice }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true } as const;
  if (choice === 'light') {
    return (
      <svg {...common}><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>
    );
  }
  if (choice === 'dark') {
    return <svg {...common}><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" /></svg>;
  }
  return <svg {...common}><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" /></svg>;
}
