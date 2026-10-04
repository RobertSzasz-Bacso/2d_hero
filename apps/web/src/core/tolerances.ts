/**
 * Editor tolerances from docs/algorithms.md.
 * Detection tolerances stay in Python. Do not copy these numbers into other modules.
 */
export const editorTolerances = {
  join_snap_m: 0.05,
  miter_limit: 3,
  min_room_m2: 0.5,
  snap_px: 8,
  ortho_deg: 1,
  grid_m: 0.01,
  seed_search_m: 0.3,
  extension_max_m: 2,
  history_limit: 100,
} as const
