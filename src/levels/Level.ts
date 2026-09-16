import type * as THREE from 'three'

/**
 * A trap, described rather than constructed. The level says what goes where; the
 * trap system owns how each kind is built and tuned, so a level file never has to
 * know about rigid bodies or cooldowns.
 */
export type TrapPlacement =
  /** Wrecking arm parked against the wall, sweeping the full width. */
  | { kind: 'wrecker'; z: number }
  /** Yanks a stepping stone out of the world. `tile` indexes the build order. */
  | { kind: 'trapdoor'; tile: number }
  /** Wall piston that punches across a narrow beam. */
  | { kind: 'ram'; z: number; side: 1 | -1 }
  /** Centre bar that spins up hard. */
  | { kind: 'spinner'; z: number }
  /** Ceiling block that slams a hallway. */
  | { kind: 'crusher'; z: number }
  /** Directed air blast across a volume. `floor` lifts it to a raised deck. */
  | { kind: 'gale'; z: number; direction: 1 | -1; floor?: number }
  /** A pillar that punches up out of the deck. */
  | { kind: 'spike'; z: number; x?: number; floor?: number }
  /** A run of tiles that drops in a wave. `tiles` are drop-tile indices, in order. */
  | { kind: 'cascade'; tiles: number[] }

/**
 * What a level is handed to draw itself with.
 *
 * Everything is in world metres along +Z, which is the direction of travel. The
 * course is linear on purpose: checkpoints are claimed by passing a Z, and
 * ranking is by Z, so a level that doubled back would need both reworked.
 */
export interface LevelBuilder {
  /** A flat slab whose walking surface sits at `top`. */
  pad(x: number, z: number, width: number, depth: number, color: number, top?: number): void
  /** A solid block: rails, kerbs, back walls. */
  wall(x: number, y: number, z: number, sx: number, sy: number, sz: number): void
  /** Sloped slab, gaining `rise` over `length` travelling toward +Z. */
  ramp(z: number, length: number, rise: number, width: number): void
  /** A stepping stone that a trapdoor can drop. Returns its index. */
  dropTile(x: number, z: number, size?: number): number
  /** A platform sliding on X. Returns its index, for linking a route node to it. */
  mover(z: number, amplitude: number, phase: number, size?: number): number

  /** A node on the bots' racing line. `halfWidth` is the lateral room available. */
  route(x: number, z: number, y?: number, halfWidth?: number, moverIndex?: number): void
  checkpoint(z: number, respawn: THREE.Vector3, label: string): void

  /** The finish gate, and where finishers come to rest. */
  finish(z: number, podium: THREE.Vector3, top: number): void
  trap(placement: TrapPlacement): void

  /** Non-colliding support pillars under the given course positions. */
  pillars(zs: number[], xs?: number[]): void
}

export interface Level {
  readonly id: string
  readonly name: string
  /** One line, shown on the title card. */
  readonly blurb: string
  build(b: LevelBuilder): void
}
