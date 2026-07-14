/**
 * Theme access for TSX code. `styles.css` owns the actual color values (light + dark); this module
 * exposes them as `var(--…)` references for inline styles, so a component never hard-codes a hex
 * and every color it uses follows the active theme. It also owns the light/dark toggle: the
 * stylesheet's dark block applies under the OS preference OR an explicit `data-theme="dark"` stamp
 * on <html>, and the stamp (persisted to localStorage) must win both ways.
 */

/** Design tokens, by role. Inline styles reference these; the values live in styles.css. */
export const T = {
  page: 'var(--page)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  ink3: 'var(--ink-3)',
  line: 'var(--line)',
  line2: 'var(--line-2)',
  accent: 'var(--accent)',
  accentInk: 'var(--accent-ink)',
  accentSoft: 'var(--accent-soft)',
  accentLine: 'var(--accent-line)',
  highlight: 'var(--highlight)',
  danger: 'var(--danger)',
  dangerBg: 'var(--danger-bg)',
  warnBorder: 'var(--warn-border)',
  warnBg: 'var(--warn-bg)',
  warnInk: 'var(--warn-ink)',
  monoGreen: 'var(--mono-green)',
  monoAmber: 'var(--mono-amber)',
  codeBg: 'var(--code-bg)',
  codeInk: 'var(--code-ink)',
} as const;

/** The monospace stack used for all machine-facing text (code, hex, addresses). */
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The per-phase hue (IF→WB) — one consistent color per within-instruction phase across every
 * model's stepper/track (and, later, the pipeline view's stage columns). The 5-slot set was
 * machine-validated for CVD separation and both surfaces; chips must always carry a text label
 * (hue is never the sole carrier). Keyed by the phase name string shared by all engines.
 */
export const PHASE_COLORS: Readonly<Record<string, string>> = {
  IF: 'var(--phase-if)',
  ID: 'var(--phase-id)',
  EX: 'var(--phase-ex)',
  MEM: 'var(--phase-mem)',
  WB: 'var(--phase-wb)',
};

// --- Light/dark toggle ----------------------------------------------------------------------

export type ThemeChoice = 'light' | 'dark' | 'auto';
const STORAGE_KEY = 'cpu-viz-theme';

/** Read the persisted choice (`auto` when unset or storage is unavailable). */
export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Apply a choice: stamp `data-theme` on <html> (or remove it for `auto`) and persist it. */
export function setThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    if (choice === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* private mode etc. — the stamp still applies for this session */
  }
}

/** Whether the page currently renders dark (the stamp if set, else the OS preference). */
export function isDarkNow(): boolean {
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped === 'dark') return true;
  if (stamped === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Re-apply the persisted choice on startup (before first paint, from main.tsx). */
export function initTheme(): void {
  setThemeChoice(getThemeChoice());
}
