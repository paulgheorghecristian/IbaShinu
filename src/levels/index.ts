import { gauntlet } from './gauntlet'
import { roadOfFear } from './roadOfFear'
import { grinder } from './grinder'
import type { Level } from './Level'

export type { Level, LevelBuilder, TrapPlacement } from './Level'

/** Every level, in the order they are meant to be played. */
export const LEVELS: readonly Level[] = [gauntlet, roadOfFear, grinder]

/**
 * Pick a level by `?level=<id>` so a course can be opened directly without a
 * rebuild. Unknown or missing ids fall back to the first.
 */
export function selectLevel(search = window.location.search): Level {
  const wanted = new URLSearchParams(search).get('level')
  return LEVELS.find((l) => l.id === wanted) ?? LEVELS[0]
}
