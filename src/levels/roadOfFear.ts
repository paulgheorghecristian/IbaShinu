import * as THREE from 'three'
import { COLORS } from '../config'
import type { Level, LevelBuilder } from './Level'

const BLOCK = 3.4

/**
 * A longer, meaner course, in the idiom of CS 1.6 deathrun maps like
 * `deathrun_real` and `deathrun_roadoffear_final`: an enclosed tunnel where the
 * walls hold you in and the danger is the floor — offset ledges over a pit, wall
 * vents that punch you into it, and bars that sweep the whole corridor.
 *
 * Two deliberate departures from those maps:
 *
 * The corridors have tall side walls but **no ceiling**. A roof is fine in a
 * first-person game and ruinous behind a third-person chase cam, which would
 * spend the level jammed against it.
 *
 * Elevation only appears in the **trap-free** sections. The wrecker's arm and the
 * crusher's travel are both measured from a floor at y = 0, so a raised platform
 * would have them sweeping overhead or slamming through the deck.
 */
export const roadOfFear: Level = {
  id: 'roadoffear',
  name: 'Road of Fear',
  blurb: 'A tunnel where the walls keep you in and the floor lets you down.',

  build(b: LevelBuilder): void {
    /** Tall side walls: a corridor you cannot drift out of. */
    const corridor = (z: number, depth: number, halfWidth: number, height = 6) => {
      b.wall(-halfWidth, height / 2, z, 0.5, height, depth)
      b.wall(halfWidth, height / 2, z, 0.5, height, depth)
    }

    // Sections meet exactly, section by section. Every gap in this level is one
    // that was put there on purpose; an accidental 1 m seam between two pads is
    // invisible on screen and eats bots one respawn at a time.

    // ---- Start: 0..16 ----------------------------------------------------
    b.pad(0, 8, 15, 16, COLORS.safe)
    b.wall(-7.2, 0.55, 8, 0.5, 1.1, 16)
    b.wall(7.2, 0.55, 8, 0.5, 1.1, 16)
    b.checkpoint(1, new THREE.Vector3(0, 1.6, 6), 'Start')
    b.route(0, 4)
    b.route(0, 12)

    // ---- Vent tunnel: 16..46. Three wall rams and a crosswind ------------
    b.pad(0, 31, 8, 30, COLORS.platform)
    corridor(31, 30, 4.3)
    for (let z = 19; z <= 43; z += 4) b.route(0, z, 0, 3.2)
    b.trap({ kind: 'ram', z: 22, side: 1 })
    b.trap({ kind: 'ram', z: 30, side: -1 })
    b.trap({ kind: 'ram', z: 38, side: 1 })
    b.trap({ kind: 'gale', z: 34, direction: -1 })

    // ---- 46..52 ----------------------------------------------------------
    b.pad(0, 49, 12, 6, COLORS.safe)
    b.checkpoint(47, new THREE.Vector3(0, 1.6, 49), 'Vents')
    b.route(0, 49)

    // ---- Offset ledges: 52..84. The floor is a pit, the path hugs the walls
    corridor(68, 32, 4.8, 7)
    // The swing is deliberately gentle: 2.4 m of offset every 3.9 m. A harder
    // zigzag looks better and plays worse — there is no room to kill the lateral
    // momentum of one hop before the next, and you slide off the far side.
    const ledges: Array<[number, number, boolean]> = [
      [-1.2, 55, false],
      [1.2, 58.9, true],
      [-1.2, 62.8, false],
      [1.2, 66.7, false],
      [-1.2, 70.6, true],
      [1.2, 74.5, false],
      [-1.2, 78.4, true],
      [1.2, 82.3, false],
    ]
    for (const [x, z, riggable] of ledges) {
      if (riggable) b.trap({ kind: 'trapdoor', tile: b.dropTile(x, z, BLOCK) })
      else b.pad(x, z, BLOCK, BLOCK, COLORS.platform)
      b.route(x, z, 0, BLOCK / 2 - 0.6)
    }

    // ---- 84..90 ----------------------------------------------------------
    b.pad(0, 87, 12, 6, COLORS.safe)
    b.checkpoint(85, new THREE.Vector3(0, 1.6, 87), 'The Ledges')
    b.route(0, 87)

    // ---- Cross bars: 90..120. The sweep covers the corridor, so jump it ---
    b.pad(0, 105, 15, 30, COLORS.platform)
    // Taller than the rest: a spinner hit carries enough to clear a short wall,
    // and being launched out of the level is not a death the player can read.
    corridor(105, 30, 7.8, 10)
    for (let z = 92; z <= 118; z += 4) b.route(0, z, 0, 6)
    b.trap({ kind: 'spinner', z: 98 })
    b.trap({ kind: 'spinner', z: 112 })

    // ---- 120..126 --------------------------------------------------------
    b.pad(0, 123, 12, 6, COLORS.safe)
    b.checkpoint(121, new THREE.Vector3(0, 1.6, 123), 'Cross Bars')
    b.route(0, 123)

    // ---- The climb: 126..167 --------------------------------------------
    // A real ascent: six ledges rising 1.3 m each to a deck eight metres up.
    //
    // The riser is what sets the shape. A jump reaches 1.59 m, but it is only
    // above 1.3 m between t=0.21 s and t=0.64 s — a 0.43 s window, about 2.7 m of
    // travel at running pace. So the ledges are stacked close and barely offset:
    // a wide zigzag here would simply be unjumpable, however good it looked.
    const CLIMB_RISE = 1.1
    const CLIMB_STEPS = 7
    for (let i = 0; i < CLIMB_STEPS; i += 1) {
      const z = 129 + i * 2.3
      const top = CLIMB_RISE * (i + 1)
      b.pad(i % 2 ? 0.6 : -0.6, z, 3.4, 2.6, COLORS.platform, top)
      b.route(i % 2 ? 0.6 : -0.6, z, top, 1.1)
    }

    // The deck at the top, and a crosswind with an eight metre drop under it.
    const DECK = CLIMB_RISE * CLIMB_STEPS
    b.pad(0, 148, 10, 8, COLORS.platform, DECK)
    b.route(0, 146, DECK, 4)
    b.route(0, 150, DECK, 4)
    b.trap({ kind: 'gale', z: 148, direction: 1, floor: DECK })

    // Back down in three free falls — no jump needed, and nothing to catch you
    // if the gale caught you first.
    for (const [z, top] of [
      [155, DECK - 2.6],
      [161, DECK - 5.2],
      [167, 0],
    ] as Array<[number, number]>) {
      b.pad(0, z, 9, 6, COLORS.platform, top)
      b.route(0, z, top, 3.6)
    }

    // ---- 170..176 --------------------------------------------------------
    b.pad(0, 173, 12, 6, COLORS.safe)
    b.checkpoint(171, new THREE.Vector3(0, 1.6, 173), 'The Climb')
    b.route(0, 173)

    // ---- Wrecker gallery: 176..196 ---------------------------------------
    b.pad(0, 186, 9, 20, COLORS.platform)
    corridor(186, 20, 4.9)
    for (let z = 179; z <= 194; z += 3.5) b.route(0, z, 0, 3.6)
    b.trap({ kind: 'wrecker', z: 182 })
    b.trap({ kind: 'wrecker', z: 192 })

    // ---- The crossing: 196..222 ------------------------------------------
    b.pad(0, 198, 9, 4, COLORS.platform)
    b.route(0, 198)
    for (const [z, amplitude, phase] of [
      [205, 3, 0],
      [213, 3.4, Math.PI * 0.75],
    ] as Array<[number, number, number]>) {
      b.route(0, z, 0, 2.2, b.mover(z, amplitude, phase))
    }
    b.pad(0, 220, 9, 4, COLORS.platform)
    b.route(0, 220)

    // ---- 222..228 --------------------------------------------------------
    b.pad(0, 225, 12, 6, COLORS.safe)
    b.checkpoint(223, new THREE.Vector3(0, 1.6, 225), 'The Crossing')
    b.route(0, 225)

    // ---- Crusher squeeze: 228..262. Narrow, and three of them ------------
    b.pad(0, 245, 7, 34, COLORS.platform)
    corridor(245, 34, 3.8)
    for (let z = 231; z <= 259; z += 4) b.route(0, z, 0, 2.6)
    b.trap({ kind: 'crusher', z: 235 })
    b.trap({ kind: 'crusher', z: 244 })
    b.trap({ kind: 'crusher', z: 254 })
    b.trap({ kind: 'gale', z: 249, direction: 1 })

    // ---- Ramp 262..268, podium 268..278 ----------------------------------
    b.ramp(265, 6, 2.2, 14)
    b.route(0, 265, 1.2)
    b.pad(0, 273, 14, 10, COLORS.safe, 2.2)
    b.finish(272, new THREE.Vector3(0, 3.6, 275), 2.2)
    b.wall(-6.7, 3.0, 273, 0.6, 1.6, 10)
    b.wall(6.7, 3.0, 273, 0.6, 1.6, 10)
    b.wall(0, 3.0, 277.7, 14, 1.6, 0.6)
    b.route(0, 272, 2.2)
    b.route(0, 277, 2.2)

    b.pillars([8, 31, 68, 105, 148, 186, 220, 245, 273])
  },
}
