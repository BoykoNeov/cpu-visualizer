/**
 * The one adapter every microarchitecture shares: {@link AssembledProgram} → the pure
 * {@link ProgramImage} the engines consume. It lives here — in a leaf package that may depend
 * on both `assembler` and `trace` — precisely because `trace` itself must stay pure (it depends
 * only on `isa`), so the `AssembledProgram → ProgramImage` bridge cannot live there. Hoisted
 * out of `engine/single-cycle` when the second model landed (m1 decisions log; m2 step 0), so
 * both engines import the *same* adapter rather than each carrying a copy.
 *
 * The golden reference does NOT use this — its differential path never touches the assembler,
 * which is why the adapter was a free-standing function from the start.
 */

import { TEXT_BASE, type AssembledProgram } from '@cpu-viz/assembler';
import type { ProgramImage } from '@cpu-viz/trace';

/**
 * Adapt an {@link AssembledProgram} into the pure {@link ProgramImage} an engine consumes.
 * Execution begins at {@link TEXT_BASE} (the §"memory map" entry). This is the `AssembledProgram`
 * minus the assembler-only symbol table, with an explicit entry point.
 */
export function toProgramImage(program: AssembledProgram): ProgramImage {
  return {
    words: program.words,
    data: program.data,
    entry: TEXT_BASE,
    sourceMap: program.sourceMap,
  };
}
