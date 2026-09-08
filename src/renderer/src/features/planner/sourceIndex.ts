// planner/sourceIndex.ts — the planner's door onto the app's item→mob index (design §4.2).
//
// The index itself now lives in `lib/itemSources.ts`. It moved there (2026-08-04) when the Loot
// tab's item drill-down became a second consumer: the inversion is ~33k links over the committed
// mob catalog, and two feature modules each holding their own lazy singleton would build it twice
// and answer one question from two tables. There is ONE index, in lib/, and this file is the
// planner's spelling of it.
//
// The re-export is not ceremony. `PlannerSource` is the name the Farm rollup's types are written
// in, and `tests/plannerSourceIndex.test.mts` imports the builder through this path — keeping the
// door means the move changed no call site and no test.

export {
  buildSourceIndex,
  sourceIndex,
  sourceItemKey,
  sourcesFor,
  type SourceIndex
} from '../../lib/itemSources'

/** The planner's name for one known drop source — `lib/itemSources.ItemSource`, unchanged. */
export type { ItemSource as PlannerSource } from '../../lib/itemSources'
