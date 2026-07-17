/**
 * The instruction-reference panel: the editor's answer to "what am I allowed to type?".
 *
 * The shell has always let anyone rewrite the program but never said what the vocabulary is,
 * which makes the editor a blank page for exactly the learner this project is for. It lives
 * INSIDE the editor rather than beside it because that is the only place the question is asked
 * — and because the editor is force-opened when an edit fails to assemble, a mistyped mnemonic
 * lands the reader on the panel that explains it, with no extra wiring.
 *
 * Everything shown comes from {@link ./isa-reference}, which derives membership and grammar from
 * the assembler and ISA themselves; this file is presentation only. Examples are click-to-insert:
 * a reference answers "what exists", but the thing a stuck learner actually needs is a line of
 * assembly in the buffer.
 *
 * **Split into a stateful container and a pure {@link ReferenceBody}** because this repo's web
 * tests are `renderToStaticMarkup` (there is no jsdom, and the vitest environment is `node`), so
 * a panel that held its own tab in a closure would be a surface no test could see the inside of —
 * the gap `App.test.tsx` names. With `tab`/`query` as props, every tab is a static render, and
 * what remains invisible is exactly the click wiring, which the browser pass covers.
 */

import { useMemo, useState } from 'react';
import {
  directiveEntries,
  instructionSections,
  pseudoEntries,
  registerCount,
  registerEntries,
  type RefEntry,
} from './isa-reference';
import { MONO, T } from './theme';

export type Tab = 'instructions' | 'pseudo' | 'directives' | 'registers';

export const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'pseudo', label: 'Shorthands' },
  { id: 'directives', label: 'Directives' },
  { id: 'registers', label: 'Registers' },
];

const code = {
  fontFamily: MONO,
  fontSize: '0.8rem',
  background: T.codeBg,
  color: T.codeInk,
  padding: '0.05rem 0.3rem',
  borderRadius: 3,
} as const;

const blurb = {
  margin: '0 0 0.4rem',
  fontSize: '0.76rem',
  color: T.ink3,
  lineHeight: 1.5,
} as const;

/** An example you can click to drop into the editor at the caret. */
function ExampleChip(props: { text: string; onInsert?: (t: string) => void }): React.JSX.Element {
  const { text, onInsert } = props;
  if (!onInsert) return <code style={code}>{text}</code>;
  return (
    <button
      onClick={() => onInsert(text)}
      title="Insert this line into the program at the cursor"
      style={{
        ...code,
        border: `1px solid ${T.line}`,
        cursor: 'pointer',
        textAlign: 'left',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </button>
  );
}

function EntryRow(props: { entry: RefEntry; onInsert?: (t: string) => void }): React.JSX.Element {
  const { entry, onInsert } = props;
  return (
    <div style={{ padding: '0.4rem 0', borderTop: `1px solid ${T.line}` }}>
      <div
        style={{
          display: 'flex',
          gap: '0.6rem',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: '0.82rem' }}>
          <strong style={{ color: T.accent }}>{entry.name}</strong>
          {entry.forms.map((form) => {
            // `forms` are full lines (`add rd, rs1, rs2`); the mnemonic is already shown above.
            const operands = form.slice(entry.name.length).trim();
            return operands ? (
              <span key={form} style={{ color: T.ink3, marginLeft: '0.5rem' }}>
                {operands}
              </span>
            ) : null;
          })}
        </div>
        <ExampleChip text={entry.example} onInsert={onInsert} />
      </div>
      <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: T.ink2, lineHeight: 1.45 }}>
        {entry.summary}
      </p>
    </div>
  );
}

/** Case-insensitive match over everything a reader might type into the filter. */
function matches(entry: RefEntry, q: string): boolean {
  if (!q) return true;
  const hay = `${entry.name} ${entry.forms.join(' ')} ${entry.summary}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

/**
 * The reference's content for one tab — pure, so every tab is a static render.
 * `query` filters within the tab; an empty query shows everything.
 */
export function ReferenceBody(props: {
  tab: Tab;
  query: string;
  onInsert?: (text: string) => void;
}): React.JSX.Element {
  const { tab, query, onInsert } = props;
  const q = query.trim();

  if (tab === 'instructions') {
    const sections = instructionSections()
      .map((s) => ({ group: s.group, entries: s.entries.filter((e) => matches(e, q)) }))
      .filter((s) => s.entries.length > 0);
    if (sections.length === 0) return <NoMatches />;
    return (
      <>
        {sections.map((section) => (
          <section key={section.group} style={{ marginBottom: '0.6rem' }}>
            <h3
              style={{
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: T.ink3,
                margin: '0.4rem 0 0',
              }}
            >
              {section.group}
            </h3>
            {section.entries.map((entry) => (
              <EntryRow key={entry.name} entry={entry} onInsert={onInsert} />
            ))}
          </section>
        ))}
      </>
    );
  }

  if (tab === 'pseudo') {
    const shown = pseudoEntries().filter((e) => matches(e, q));
    return (
      <>
        <p style={blurb}>
          Shorthands the assembler expands into real instructions — the source panel shows you what
          each one became.
        </p>
        {shown.length === 0 ? (
          <NoMatches />
        ) : (
          shown.map((entry) => <EntryRow key={entry.name} entry={entry} onInsert={onInsert} />)
        )}
      </>
    );
  }

  if (tab === 'directives') {
    const shown = directiveEntries().filter((e) => matches(e, q));
    return (
      <>
        <p style={blurb}>
          Directives shape the program rather than run in it. Labels are written{' '}
          <code style={code}>name:</code> and may be used before they are defined.
        </p>
        {shown.length === 0 ? (
          <NoMatches />
        ) : (
          shown.map((entry) => <EntryRow key={entry.name} entry={entry} onInsert={onInsert} />)
        )}
      </>
    );
  }

  const shown = registerEntries().filter(
    (r) => !q || `${r.name} x${r.number} ${r.role}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <p style={blurb}>
        {registerCount()} registers, each usable by number or by ABI name —{' '}
        <code style={code}>a0</code> and <code style={code}>x10</code> are the same register. Apart
        from <code style={code}>x0</code>, the roles below are convention rather than rules the
        hardware enforces.
      </p>
      {shown.length === 0 ? (
        <NoMatches />
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <tbody>
            {shown.map((r) => (
              <tr key={r.name} style={{ borderTop: `1px solid ${T.line}` }}>
                <td
                  style={{
                    fontFamily: MONO,
                    color: T.accent,
                    padding: '0.25rem 0.5rem 0.25rem 0',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.name}
                </td>
                <td
                  style={{ fontFamily: MONO, color: T.ink3, padding: '0.25rem 0.5rem 0.25rem 0' }}
                >
                  x{r.number}
                </td>
                <td style={{ color: T.ink2, padding: '0.25rem 0' }}>{r.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function NoMatches(): React.JSX.Element {
  return (
    <p style={{ ...blurb, fontStyle: 'italic', margin: '0.6rem 0' }}>
      Nothing matches that filter.
    </p>
  );
}

export function IsaReference(props: { onInsert?: (text: string) => void }): React.JSX.Element {
  const { onInsert } = props;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('instructions');
  const [query, setQuery] = useState('');

  /**
   * The counts are the reassurance the toggle's label cannot give: "what can I write" is a
   * question about size as much as content, and a number is a friendlier answer than an unknown.
   *
   * FOUR numbers, not one total. The first draft said "all 58 things this simulator accepts" —
   * 58 being instructions + shorthands + directives — directly above a tab bar whose fourth tab
   * is Registers, which are also things it accepts and were not in the 58. A total is only honest
   * over a set the reader can see the boundary of, and this panel's four tabs are four sets.
   */
  const counts = useMemo(
    () => ({
      instructions: instructionSections().reduce((n, s) => n + s.entries.length, 0),
      pseudo: pseudoEntries().length,
      directives: directiveEntries().length,
      registers: registerCount(),
    }),
    [],
  );

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <button
        className="btn"
        style={{ fontSize: '0.8rem', background: open ? T.accentSoft : undefined }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {/* No emoji: the shell's glyph vocabulary (✎ ↩ ▶ ⏮ ◐) is all BMP, and the 📖 this
            shipped with is astral — it rendered as tofu wherever the emoji font is absent. */}
        What can I write? {open ? '▲' : '▼'}
      </button>

      {open ? (
        <div
          style={{
            marginTop: '0.5rem',
            border: `1px solid ${T.line}`,
            borderRadius: 6,
            background: T.surface2,
            padding: '0.6rem',
          }}
        >
          <p style={blurb}>
            {counts.instructions} instructions, {counts.pseudo} shorthands, {counts.directives}{' '}
            directives and {counts.registers} registers — everything this simulator accepts. Click
            any example to drop it into your program. A program stops when it reaches{' '}
            <code style={code}>ecall</code>; without one it runs off the end of your code and halts
            there.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: '0.4rem',
            }}
          >
            <div className="seg">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={t.id === tab ? 'seg-btn seg-btn--on' : 'seg-btn'}
                  aria-pressed={t.id === tab}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter…"
              aria-label="Filter the reference"
              spellCheck={false}
              style={{
                fontFamily: MONO,
                fontSize: '0.78rem',
                padding: '0.2rem 0.4rem',
                flex: '1 1 8rem',
                minWidth: '6rem',
              }}
            />
          </div>

          <div style={{ maxHeight: '22rem', overflowY: 'auto', paddingRight: '0.3rem' }}>
            <ReferenceBody tab={tab} query={query} onInsert={onInsert} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
