/**
 * `@cpu-viz/engine-common` — helpers shared by every microarchitecture in the engine layer.
 * A leaf beneath the engines in the DAG (`engine-common ← isa, assembler, trace`): the models
 * depend on it, never the reverse. Keep it framework-agnostic and free of any per-model state.
 */

export { toProgramImage } from './program-image';
