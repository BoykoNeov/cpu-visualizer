/**
 * The cache grid view (M6 step 6) — the drawing half of {@link buildCacheGrid}, in the same
 * two-halves shape as the pipeline map: `cache-grid.ts` owns the pure fold and this file owns the
 * HTML and the hues. It is the D-cache made visible: **one row per line, each showing whether it is
 * valid and which block of memory it holds, with the line touched this cycle called out** — hit,
 * miss, eviction, or filling.
 *
 * HTML, not SVG (the map's pinned reasoning applies): the surface is a small table, and each line is
 * a highlight target. There is no datapath geometry here to hand-roll.
 *
 * **What the reader is meant to SEE, in order of why the surface exists:**
 *   - **A miss, then hits** — the first touch of a block misses and brings the whole line in; the
 *     next few addresses in that block hit. Spatial locality, made concrete (step 7's first lesson).
 *   - **The stall a miss costs.** A miss line reads `filling · N` and counts down for the whole
 *     penalty, in lock-step with the `MEM MEM MEM` the pipeline map shows above — the two surfaces
 *     tell one story about the same cycles.
 *   - **A conflict eviction** — under the small cache, a third block lands on a line already holding
 *     another and kicks it out (`evicted 0x…`). Flip to the large cache and the eviction is gone.
 *     That is the flagship size experiment, on the structure it happens in.
 *
 * Like the fold, this is a STATE view (see the fold's header): it draws the cache AT the cursor, the
 * way the register and memory panels do, so `micro.cache`'s post-cycle tags are exactly right — this
 * is not the datapath's one-cycle-ahead `micro` trap.
 */

import type { CacheConfig, CycleTrace } from '@cpu-viz/trace';
import { useMemo } from 'react';
import { buildCacheGrid, type CacheGridView, type LineState } from './cache-grid';
import { hex32 } from './format';
import { MONO, T } from './theme';

/** The label + hue for each non-idle line state — the relief rule made data: a hue never travels
 *  without the word beside it. Keyed off the fold's {@link LineState} so a new state can't be drawn
 *  hueless-or-wordless by omission. */
const STATE_STYLE: Record<Exclude<LineState, 'idle'>, { label: string; hue: string }> = {
  hit: { label: 'HIT', hue: T.monoGreen },
  miss: { label: 'MISS', hue: T.monoAmber },
  evict: { label: 'EVICT', hue: T.danger },
  filling: { label: 'FILLING', hue: T.monoAmber },
};

/** The byte range a line-sized block covers, as `0x…–0x…` — the human form of a tag. */
function blockRange(base: number, lineSize: number): string {
  return `${hex32(base)}–${hex32(base + lineSize - 1)}`;
}

export function CacheGrid(props: {
  /** The trace at the current cursor (`null` pre-run — the grid then shows a cold cache). */
  trace: CycleTrace | null;
  /** The configured cache geometry. When `null` the grid renders nothing (no cache to show). */
  cache: CacheConfig | null;
}): React.JSX.Element | null {
  const { trace, cache } = props;
  const grid = useMemo(() => buildCacheGrid(trace, cache), [trace, cache]);
  if (grid === null) return null;

  return (
    <section className="panel cache-panel" style={{ marginTop: '1rem' }} aria-label="D-cache">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '0.5rem',
        }}
      >
        <h2 className="panel-heading" style={{ margin: 0 }}>
          Cache
        </h2>
        <span style={{ fontSize: '0.75rem', color: T.ink3 }}>
          direct-mapped · {grid.numLines} lines × {grid.lineSize} B · each address maps to one line
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <AccessCaption grid={grid} />
        </span>
      </div>

      <div className="cache-lines">
        {grid.lines.map((line) => {
          const style = line.state === 'idle' ? null : STATE_STYLE[line.state];
          return (
            <div
              key={line.index}
              className={`cache-line cache-line--${line.state}`}
              style={style ? ({ '--line-hue': style.hue } as React.CSSProperties) : undefined}
            >
              <span className="cache-line-idx" style={{ color: T.ink3, fontFamily: MONO }}>
                line {line.index}
              </span>
              <span
                className="cache-line-valid"
                title={line.valid ? 'valid — holds a block' : 'invalid — empty'}
                aria-hidden
              >
                {line.valid ? '●' : '○'}
              </span>
              <span className="cache-line-block" style={{ fontFamily: MONO }}>
                {line.blockBase === null ? (
                  <span style={{ color: T.ink3 }}>empty</span>
                ) : (
                  blockRange(line.blockBase, grid.lineSize)
                )}
              </span>
              {style ? (
                <span
                  className="cache-line-tag"
                  style={{ color: style.hue, borderColor: style.hue, fontFamily: MONO }}
                >
                  {style.label}
                  {line.state === 'filling' && line.penaltyLeft !== undefined
                    ? ` · ${line.penaltyLeft}`
                    : ''}
                </span>
              ) : (
                <span className="cache-line-tag cache-line-tag--idle" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {/* The legend: every treatment the grid can draw, keyed with its word — the same relief rule as
          the map's. Static (there are exactly four states), unlike the map's derived hue swatches. */}
      <div className="dp-legend cache-legend">
        {(['hit', 'miss', 'evict', 'filling'] as const).map((s) => (
          <span key={s}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                verticalAlign: 'middle',
                marginRight: 5,
                background: STATE_STYLE[s].hue,
              }}
            />
            {STATE_STYLE[s].label.toLowerCase()}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: T.ink3 }}>
          ● valid · ○ empty · a miss brings its whole line in
        </span>
      </div>
    </section>
  );
}

/** The one-line status of THIS cycle's access — the caption that names what just happened. Reads the
 *  same fold the grid does, so the two never disagree about which line was touched. */
function AccessCaption(props: { grid: CacheGridView }): React.JSX.Element {
  const { access, lineSize } = props.grid;
  if (access === null) {
    return <span style={{ fontSize: '0.75rem', color: T.ink3 }}>no memory access this cycle</span>;
  }
  const style = STATE_STYLE[access.state];
  return (
    <span style={{ fontSize: '0.78rem', color: T.ink2, fontFamily: MONO }}>
      <span style={{ color: style.hue, fontWeight: 700 }}>{style.label}</span> {hex32(access.addr)}{' '}
      → line {access.line}
      {access.state === 'evict' && access.evicted !== undefined
        ? ` · evicted ${blockRange(access.evicted, lineSize)}`
        : ''}
      {access.state === 'filling' && access.penaltyLeft !== undefined
        ? ` · ${access.penaltyLeft} cycle${access.penaltyLeft === 1 ? '' : 's'} left`
        : ''}
    </span>
  );
}
