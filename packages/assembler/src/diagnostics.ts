/**
 * Located diagnostics for the assembler (handoff §8: "good error messages with
 * line/column"). Internally we throw {@link AssemblyError} to abort one statement
 * and let the driver collect it; the public surface is the plain {@link AssemblerError}.
 *
 * Lines and columns are **1-based** — line 1, column 1 is the first character of
 * the source — to match what editors show.
 */

/** A located assembler diagnostic surfaced to callers. */
export interface AssemblerError {
  message: string;
  line: number;
  column: number;
}

/** Thrown internally to abort processing of one statement with a located message. */
export class AssemblyError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
    this.name = 'AssemblyError';
  }

  /** The plain, serializable diagnostic. */
  get diagnostic(): AssemblerError {
    return { message: this.message, line: this.line, column: this.column };
  }
}

/** Throw a located error. */
export function fail(message: string, line: number, column: number): never {
  throw new AssemblyError(message, line, column);
}

/**
 * Range-check a signed immediate that must fit in `bits` two's-complement bits.
 * `even` additionally requires the low bit to be clear (branch/jump byte offsets).
 */
export function checkSigned(
  value: number,
  bits: number,
  what: string,
  line: number,
  column: number,
  even = false,
): number {
  const min = -(2 ** (bits - 1));
  const max = 2 ** (bits - 1) - 1;
  if (value < min || value > max) {
    fail(
      `${what} ${value} out of range for a signed ${bits}-bit value (${min}..${max})`,
      line,
      column,
    );
  }
  if (even && (value & 1) !== 0) {
    fail(`${what} ${value} must be even`, line, column);
  }
  return value;
}

/** Range-check an unsigned immediate that must fit in `[min, max]`. */
export function checkRange(
  value: number,
  min: number,
  max: number,
  what: string,
  line: number,
  column: number,
): number {
  if (value < min || value > max) {
    fail(`${what} ${value} out of range (${min}..${max})`, line, column);
  }
  return value;
}
