import * as THREE from 'three'
import { COLORS } from '../config'
import type { Level, LevelBuilder } from './Level'

const TILE = 2.8

/**
 * The original course: one 230 m corridor of eight sections, each a single idea.
 * Every gap is sized against the measured jump — 4.8 m of air at full speed, about
 * 3.2 m from a short run-up on a tile.
 */
export const gauntlet: Level = {
  id: 'gauntlet',
  name: 'The Gauntlet',
  blurb: 'Eight sections, ten machines, one way through.',

  build(b: LevelBuilder): void {
    // ---- Start pad -------------------------------------------------------
    b.pad(0, 8, 15, 16, COLORS.safe)
    b.wall(-7.2, 0.55, 8, 0.5, 1.1, 16)
    b.wall(7.2, 0.55, 8, 0.5, 1.1, 16)
    b.checkpoint(1, new THREE.Vector3(0, 1.6, 6), 'Start')
    b.route(0, 4)
    b.route(0, 12)

    // ---- Wrecker corridor: open floor, nothing to hide behind ------------
    b.pad(0, 31, 8.5, 30, COLORS.platform)
    for (let z = 20; z <= 44; z += 6) b.route(0, z)
    b.trap({ kind: 'wrecker', z: 26 })
    b.trap({ kind: 'wrecker', z: 38 })

    b.pad(0, 49, 12, 6, COLORS.safe)
    b.checkpoint(48, new THREE.Vector3(0, 1.6, 49), 'Corridor')
    b.route(0, 49)

    // ---- Stepping stones: two of them are not load-bearing ---------------
    const stones: Array<[number, number, boolean]> = [
      [0, 56, false],
      [-1.3, 60.8, true],
      [1.3, 65.6, false],
      [-1.3, 70.4, true],
      [1.3, 75.2, false],
      [0, 80, false],
    ]
    for (const [x, z, riggable] of stones) {
      if (riggable) b.trap({ kind: 'trapdoor', tile: b.dropTile(x, z) })
      else b.pad(x, z, TILE, TILE, COLORS.platform)
      b.route(x, z, 0, TILE / 2 - 0.6)
    }

    b.pad(0, 87, 12, 6, COLORS.safe)
    b.checkpoint(86, new THREE.Vector3(0, 1.6, 87), 'Stones')
    b.route(0, 87)

    // ---- The beam: 3.4 m wide, 28 m long, two side rams ------------------
    b.pad(0, 104, 3.4, 28, COLORS.platform)
    for (let z = 92; z <= 116; z += 4) b.route(0, z, 0, 0.9)
    b.trap({ kind: 'ram', z: 98, side: 1 })
    b.trap({ kind: 'ram', z: 110, side: -1 })

    b.pad(0, 121, 12, 6, COLORS.safe)
    b.checkpoint(119, new THREE.Vector3(0, 1.6, 121), 'The Beam')
    b.route(0, 121)

    // ---- The slide: wait for the platform, then step on ------------------
    // Starts at 124, where the safe pad ends, rather than 123.5. Both slabs put
    // their walking surface at y=0, so half a metre of overlap is half a metre
    // of two coplanar faces arguing over the depth buffer, in a band right
    // across the lane. The far edge is what the jump to the first mover is
    // measured from, so it does not move.
    b.pad(0, 126.25, 10, 4.5, COLORS.platform)
    b.route(0, 126)
    for (const [z, amplitude, phase] of [
      [132, 2.6, 0],
      [140, 3.2, Math.PI * 0.6],
      [148, 2.2, Math.PI * 1.3],
    ] as Array<[number, number, number]>) {
      b.route(0, z, 0, 2.2, b.mover(z, amplitude, phase))
    }
    // Ends at 156, where the safe pad begins — the same overlap as the boarding
    // pad, mirrored. The near edge, which the last mover is jumped to, is fixed.
    b.pad(0, 153.75, 10, 4.5, COLORS.platform)
    b.route(0, 154)

    b.pad(0, 159, 12, 6, COLORS.safe)
    b.checkpoint(157, new THREE.Vector3(0, 1.6, 159), 'The Slide')
    b.route(0, 159)

    // ---- Arena: one bar through the middle -------------------------------
    b.pad(0, 174, 19, 24, COLORS.platform)
    b.route(0, 166)
    b.route(0, 174)
    b.route(0, 182)
    b.trap({ kind: 'spinner', z: 174 })

    b.pad(0, 189, 12, 6, COLORS.safe)
    b.checkpoint(187, new THREE.Vector3(0, 1.6, 189), 'Arena')
    b.route(0, 189)

    // ---- Crusher hall ----------------------------------------------------
    b.pad(0, 205, 8.5, 26, COLORS.platform)
    for (let z = 194; z <= 216; z += 4) b.route(0, z)
    b.trap({ kind: 'crusher', z: 199 })
    b.trap({ kind: 'crusher', z: 211 })
    b.trap({ kind: 'gale', z: 205, direction: 1 })

    // ---- Ramp, podium, gate ---------------------------------------------
    b.ramp(221, 6, 2.2, 14)
    b.route(0, 221, 1.2)
    b.pad(0, 229, 14, 10, COLORS.safe, 2.2)
    b.finish(228, new THREE.Vector3(0, 3.6, 231), 2.2)
    // Pen the podium in, or a racer crossing at speed simply rolls off the end.
    b.wall(-6.7, 3.0, 229, 0.6, 1.6, 10)
    b.wall(6.7, 3.0, 229, 0.6, 1.6, 10)
    b.wall(0, 3.0, 233.7, 14, 1.6, 0.6)
    b.route(0, 228, 2.2)
    b.route(0, 233, 2.2)

    b.pillars([8, 31, 87, 104, 126, 154, 174, 205, 229])
  },
}
