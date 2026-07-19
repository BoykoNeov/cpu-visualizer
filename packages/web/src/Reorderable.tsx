/**
 * The drag-to-reorder wrapper for the shell's panels — the view half of {@link movePanel}.
 *
 * **A grip, not a draggable panel.** Only the small handle rendered in each slot's corner carries
 * `draggable`, never the panel itself. That is not decoration: every panel here is interactive —
 * the map's cells are click-to-follow, the datapath has a phase stepper, the source panel is
 * selectable text — and making the whole surface draggable would eat the text selection and turn
 * every mis-aimed click into a drag. The grip is also the only affordance that says the panels MOVE;
 * a draggable panel with no handle is a feature nobody finds.
 *
 * **HTML5 drag-and-drop, not pointer events.** The platform gives the drop targets, the drag image,
 * the escape-to-cancel, and the keyboard-accessible fallback of not breaking anything else for free.
 * The one thing it does NOT give is a same-document payload that survives `dragover` — the browser
 * hides `dataTransfer.getData` during the drag for security — so the dragged key is held in React
 * state alongside it, which is also what draws the drop highlight.
 */

import { useState } from 'react';
import { movePanel, visibleOrder } from './reorder';

/** One reorderable slot: a stable key, the panel's own node, and a human name for the grip's title. */
export interface Slot {
  key: string;
  label: string;
  node: React.ReactNode;
}

/**
 * Render `slots` in the user's dragged order, each wrapped in a drop target with a drag grip.
 *
 * `order`/`setOrder` are owned by the caller (the shell), so the permutation survives re-renders and
 * so the two groups — the vertical stack and the bottom row — are genuinely independent: a datapath
 * can never be dragged into the register column, which would mean a slot whose width its content was
 * never laid out for. The authored order in `slots` is the fallback for anything `order` has not
 * heard of (see {@link visibleOrder}).
 */
export function ReorderGroup(props: {
  slots: Slot[];
  order: string[];
  setOrder: (order: string[]) => void;
  /** Applied to the group container — the grid that owns the slots' widths. */
  style?: React.CSSProperties;
}): React.JSX.Element {
  const { slots, order, setOrder, style } = props;
  // The key being dragged, or null. Held here rather than read from `dataTransfer` because the
  // browser blanks the payload during `dragover` — this is what makes the drop highlight possible.
  const [dragging, setDragging] = useState<string | null>(null);
  // The key currently hovered as a drop target, so the slot about to receive the panel says so.
  const [over, setOver] = useState<string | null>(null);

  const byKey = new Map(slots.map((s) => [s.key, s]));
  const keys = visibleOrder(
    order,
    slots.map((s) => s.key),
  );

  return (
    <div style={style}>
      {keys.map((key) => {
        const slot = byKey.get(key);
        if (!slot) return null;
        const isDragging = dragging === key;
        const isTarget = over === key && dragging !== null && dragging !== key;
        return (
          <div
            key={key}
            className="panel-slot"
            style={{
              position: 'relative',
              // The drop feedback, and it is deliberately an OUTLINE rather than a moved panel: a
              // live preview would have to relayout the group on every `dragover`, which makes the
              // drop target flicker out from under the pointer. The outline says "here" without the
              // layout moving until the drop commits.
              outline: isTarget ? `2px dashed var(--accent)` : undefined,
              outlineOffset: 3,
              borderRadius: 12,
              opacity: isDragging ? 0.45 : 1,
              transition: 'opacity 0.12s ease',
              // The bottom row is a grid whose tracks are `minmax(0, …)`; without this the panel's
              // own content (the source panel's long comment lines) would blow the track back out.
              minWidth: 0,
            }}
            onDragOver={(e) => {
              if (dragging === null) return;
              // Required, and required on EVERY dragover: without it the browser refuses the drop.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOver(key);
            }}
            onDragLeave={() => setOver((k) => (k === key ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragging ?? e.dataTransfer.getData('text/plain');
              if (from) setOrder(movePanel(keys, from, key));
              setDragging(null);
              setOver(null);
            }}
          >
            <button
              className="panel-grip"
              draggable
              onDragStart={(e) => {
                // Set the payload anyway: it is what a drop outside this group (or in another
                // window) sees, and it keeps the drag a legal one on browsers that require data.
                e.dataTransfer.setData('text/plain', key);
                e.dataTransfer.effectAllowed = 'move';
                setDragging(key);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              title={`Drag to move the ${slot.label} panel — drop it on another panel to swap places`}
              aria-label={`Move the ${slot.label} panel`}
            >
              ⠿
            </button>
            {slot.node}
          </div>
        );
      })}
    </div>
  );
}
