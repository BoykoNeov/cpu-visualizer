/**
 * The shapes shared by {@link Rob} and {@link RenameTable} — kept in their own file because both
 * consume them and neither should own the other's vocabulary.
 *
 * `Tag` is deliberately opaque (PRF-forward-compat seam #1, `docs/plans/m9-tasks.md`): at this
 * step it happens to equal a ROB slot index, but nothing outside `rob.ts`'s allocator may assume
 * that. A future PRF-style backend would hand out tags from a different namespace entirely, and
 * every caller here only ever compares tags for equality or looks one up — never does arithmetic
 * on one — so that swap would not touch this file.
 */

declare const TAG_BRAND: unique symbol;
/** An opaque handle to an in-flight result. Compare with {@link tagsEqual}; never do arithmetic. */
export type Tag = number & { readonly [TAG_BRAND]: true };

/** Only place a raw number becomes a `Tag` — the ROB's allocator. */
export function makeTag(n: number): Tag {
  return n as Tag;
}

export function tagsEqual(a: Tag, b: Tag): boolean {
  return (a as number) === (b as number);
}

/** The one place a `Tag` may be read back as a plain number — for use as a `Set`/`Map` key. */
export function tagNumber(tag: Tag): number {
  return tag as number;
}

/**
 * What an instruction's source register resolves to at the moment it's read (PRF-forward-compat
 * seam #3's operand-read choke point produces this). `ready: true` covers BOTH a committed
 * architectural value and a tag whose result has already been broadcast — the reader never needs
 * to know which, which is exactly what keeps a future PRF swap localized to the choke point.
 */
export type OperandSource =
  | { readonly ready: true; readonly value: number }
  | { readonly ready: false; readonly tag: Tag };

/** What an architectural register currently means: the committed value, or an in-flight tag. */
export type RenameSlot =
  | { readonly kind: 'committed' }
  | { readonly kind: 'pending'; readonly tag: Tag };

export const COMMITTED: RenameSlot = { kind: 'committed' };
