import * as THREE from 'three'
import { COLORS } from '../config'
import type { Level, LevelBuilder } from './Level'

const TILE = 3
/** Step height for every climb. Kept low: see the note in roadOfFear. */
const RISE = 1.1

/**
 * The long one. 668 metres in two acts, twenty-two sections, seventy machines,
 * and two hazards the other courses do not have.
 *
 * Drawn from the CS 1.6 deathrun catalogue — `long_run`'s endless walled
 * corridors and sunken arenas, `fusion_stones` and `temple-dust`'s thin ledges
 * over a drop — and built around the two ideas those maps keep returning to: a
 * floor you cannot trust, and a walkway narrow enough that any push is fatal.
 *
 * Where the first two courses ask whether you can read a machine, this one asks
 * whether you can keep reading them for five minutes without one lapse. The
 * catwalk is 2.6 m wide with nothing under it for forty-four metres. The cascade
 * cannot be waited out — stopping to read it is how it kills you.
 */
export const grinder: Level = {
  id: 'grinder',
  name: 'The Grinder',
  blurb: 'Two acts, 668 metres, seventy machines. Bring a thermos.',

  build(b: LevelBuilder): void {
    const corridor = (z: number, depth: number, halfWidth: number, height = 6) => {
      b.wall(-halfWidth, height / 2, z, 0.5, height, depth)
      b.wall(halfWidth, height / 2, z, 0.5, height, depth)
    }

    // ---- Start: 0..16 ----------------------------------------------------
    b.pad(0, 8, 15, 16, COLORS.safe)
    b.wall(-7.2, 0.55, 8, 0.5, 1.1, 16)
    b.wall(7.2, 0.55, 8, 0.5, 1.1, 16)
    b.checkpoint(1, new THREE.Vector3(0, 1.6, 6), 'Start')
    b.route(0, 4)
    b.route(0, 12)

    // ---- Spike alley: 16..52. Six metres wide, and the floor is hostile --
    b.pad(0, 34, 6, 36, COLORS.platform)
    corridor(34, 36, 3.3)
    for (let z = 19; z <= 49; z += 3) b.route(0, z, 0, 2.2)
    for (const [z, x] of [
      [22, -1.4],
      [28, 1.4],
      [34, -1.4],
      [40, 1.4],
      [46, 0],
    ] as Array<[number, number]>) {
      b.trap({ kind: 'spike', z, x })
    }
    b.trap({ kind: 'ram', z: 25, side: 1 })
    b.trap({ kind: 'ram', z: 43, side: -1 })

    b.pad(0, 55, 12, 6, COLORS.safe)
    b.checkpoint(53, new THREE.Vector3(0, 1.6, 55), 'Spike Alley')
    b.route(0, 55)

    // ---- The cascade: 58..100. Eight tiles that go in a wave -------------
    // Straight and spaced to be jumped, so it is trivial standing still and
    // lethal once the wave starts: the run has to be taken at pace, in one go.
    //
    // The spacing is a jump, not a stride. Ten tiles at 4.2 left a 1.2 m gap
    // between them, and the ball is 1.1 m across: too narrow to read as a jump,
    // too wide to roll over, so the dog dropped into every one and was shoved
    // back out by the next edge — a run across it bobbed the whole way. Eight at
    // 5.2 opens the gap to 2.2 m, inside the ~3.2 m a tile's run-up buys, and the
    // last tile stops clear of the landing pad instead of ending inside it.
    const bridge: number[] = []
    for (let i = 0; i < 8; i += 1) {
      const z = 61 + i * 5.2
      const x = i % 2 ? 0.8 : -0.8
      bridge.push(b.dropTile(x, z, TILE))
      b.route(x, z, 0, TILE / 2 - 0.7)
    }
    b.trap({ kind: 'cascade', tiles: bridge })

    b.pad(0, 103, 12, 6, COLORS.safe)
    b.checkpoint(101, new THREE.Vector3(0, 1.6, 103), 'The Cascade')
    b.route(0, 103)

    // ---- Sunken arena: 106..146. Everything at once ----------------------
    b.pad(0, 126, 17, 40, COLORS.platform)
    corridor(126, 40, 8.8, 9)
    for (let z = 109; z <= 143; z += 4) b.route(0, z, 0, 6)
    b.trap({ kind: 'spinner', z: 116 })
    b.trap({ kind: 'spinner', z: 132 })
    b.trap({ kind: 'crusher', z: 124 })
    b.trap({ kind: 'crusher', z: 140 })
    b.trap({ kind: 'spike', z: 120, x: -3 })
    b.trap({ kind: 'spike', z: 128, x: 3 })
    b.trap({ kind: 'spike', z: 136, x: 0 })

    b.pad(0, 149, 12, 6, COLORS.safe)
    b.checkpoint(147, new THREE.Vector3(0, 1.6, 149), 'The Arena')
    b.route(0, 149)

    // ---- The catwalk: 152..196. 2.6 m wide, 44 m long, no walls ----------
    b.pad(0, 174, 2.6, 44, COLORS.platform)
    for (let z = 155; z <= 193; z += 3) b.route(0, z, 0, 0.6)
    b.trap({ kind: 'spike', z: 158 })
    b.trap({ kind: 'wrecker', z: 162 })
    b.trap({ kind: 'gale', z: 170, direction: -1 })
    b.trap({ kind: 'spike', z: 174 })
    b.trap({ kind: 'wrecker', z: 178 })
    b.trap({ kind: 'gale', z: 186, direction: 1 })
    b.trap({ kind: 'wrecker', z: 190 })

    b.pad(0, 199, 12, 6, COLORS.safe)
    b.checkpoint(197, new THREE.Vector3(0, 1.6, 199), 'The Catwalk')
    b.route(0, 199)

    // ---- The ascent: 202..250. Eight metres up, into a crosswind ---------
    const STEPS = 7
    for (let i = 0; i < STEPS; i += 1) {
      const z = 205 + i * 2.3
      const top = RISE * (i + 1)
      b.pad(i % 2 ? 0.6 : -0.6, z, 3.4, 2.6, COLORS.platform, top)
      b.route(i % 2 ? 0.6 : -0.6, z, top, 1.1)
    }
    // The deck is wide and carries one spike, not two. With a gale and two spikes
    // on a ten-metre deck nothing got across it at all — every runner was thrown
    // off and made to climb again, which is a wall rather than a challenge.
    const DECK = RISE * STEPS
    b.pad(0, 227, 15, 11, COLORS.platform, DECK)
    b.route(0, 223, DECK, 6)
    b.route(0, 231, DECK, 6)
    b.trap({ kind: 'gale', z: 227, direction: 1, floor: DECK })
    b.trap({ kind: 'spike', z: 224, x: -2.5, floor: DECK })
    for (const [z, top] of [
      [235, DECK - 2.6],
      [241, DECK - 5.2],
      [247, 0],
    ] as Array<[number, number]>) {
      b.pad(0, z, 9, 6, COLORS.platform, top)
      b.route(0, z, top, 3.6)
    }

    b.pad(0, 253, 12, 6, COLORS.safe)
    b.checkpoint(251, new THREE.Vector3(0, 1.6, 253), 'The Ascent')
    b.route(0, 253)

    // ---- The crossing: 256..292. Three sliders, wider throw -------------
    b.pad(0, 258, 9, 4, COLORS.platform)
    b.route(0, 258)
    for (const [z, amplitude, phase] of [
      [265, 3.5, 0],
      [273, 4, Math.PI * 0.6],
      [281, 3, Math.PI * 1.35],
    ] as Array<[number, number, number]>) {
      b.route(0, z, 0, 2.2, b.mover(z, amplitude, phase))
    }
    b.pad(0, 288, 10, 8, COLORS.safe)
    b.checkpoint(286, new THREE.Vector3(0, 1.6, 288), 'The Crossing')
    b.route(0, 288)

    // ---- The last hall: 292..312 -----------------------------------------
    b.pad(0, 302, 6.5, 20, COLORS.platform)
    corridor(302, 20, 3.5)
    for (let z = 294; z <= 310; z += 4) b.route(0, z, 0, 2.4)
    b.trap({ kind: 'crusher', z: 296 })
    b.trap({ kind: 'gale', z: 302, direction: 1 })
    b.trap({ kind: 'crusher', z: 308 })

    // ==== ACT TWO ========================================================
    // Everything above, again, with the dials further round. The breather at 312
    // is the halfway mark.

    b.pad(0, 315, 12, 6, COLORS.safe)
    b.checkpoint(313, new THREE.Vector3(0, 1.6, 315), 'Halfway')
    b.route(0, 315)

    // ---- Spike gauntlet: 318..356. Seven of them, and nowhere to stand ---
    b.pad(0, 337, 6, 38, COLORS.platform)
    corridor(337, 38, 3.3)
    for (let z = 321; z <= 353; z += 3) b.route(0, z, 0, 2.2)
    for (const [z, x] of [
      [322, -1.5],
      [327, 1.5],
      [332, 0],
      [337, -1.5],
      [342, 1.5],
      [347, 0],
      [352, -1.5],
    ] as Array<[number, number]>) {
      b.trap({ kind: 'spike', z, x })
    }
    b.trap({ kind: 'ram', z: 330, side: 1 })
    b.trap({ kind: 'ram', z: 345, side: -1 })

    b.pad(0, 359, 12, 6, COLORS.safe)
    b.checkpoint(357, new THREE.Vector3(0, 1.6, 359), 'Spike Gauntlet')
    b.route(0, 359)

    // ---- Twin cascades: 362..410. Two waves, back to back ----------------
    // Split into two runs so the second starts while you are still committed to
    // the first: there is no safe tile to stop and read from.
    // Spaced like the first cascade and for the same reason: at 4 m the gap was
    // 1.0 m against a 1.1 m ball, which is a stumble rather than a jump.
    const first: number[] = []
    const second: number[] = []
    for (let i = 0; i < 9; i += 1) {
      const z = 365 + i * 5.2
      const x = i % 2 ? 0.8 : -0.8
      const tile = b.dropTile(x, z, TILE)
      ;(i < 5 ? first : second).push(tile)
      b.route(x, z, 0, TILE / 2 - 0.7)
    }
    b.trap({ kind: 'cascade', tiles: first })
    b.trap({ kind: 'cascade', tiles: second })

    b.pad(0, 413, 12, 6, COLORS.safe)
    b.checkpoint(411, new THREE.Vector3(0, 1.6, 413), 'Twin Cascades')
    b.route(0, 413)

    // ---- The pit: 416..458. The arena again, with the floor against you --
    b.pad(0, 437, 16, 42, COLORS.platform)
    corridor(437, 42, 8.3, 9)
    for (let z = 419; z <= 455; z += 4) b.route(0, z, 0, 5.5)
    b.trap({ kind: 'spinner', z: 424 })
    b.trap({ kind: 'spinner', z: 450 })
    b.trap({ kind: 'crusher', z: 432 })
    b.trap({ kind: 'crusher', z: 444 })
    b.trap({ kind: 'spike', z: 428, x: -3.5 })
    b.trap({ kind: 'spike', z: 436, x: 3.5 })
    b.trap({ kind: 'spike', z: 440, x: 0 })
    b.trap({ kind: 'spike', z: 448, x: -2 })

    b.pad(0, 461, 12, 6, COLORS.safe)
    b.checkpoint(459, new THREE.Vector3(0, 1.6, 461), 'The Pit')
    b.route(0, 461)

    // ---- The ram run: 464..506. Three metres wide, five rams -------------
    b.pad(0, 485, 3, 42, COLORS.platform)
    for (let z = 467; z <= 503; z += 3) b.route(0, z, 0, 0.8)
    b.trap({ kind: 'ram', z: 470, side: 1 })
    b.trap({ kind: 'gale', z: 474, direction: -1 })
    b.trap({ kind: 'ram', z: 478, side: -1 })
    b.trap({ kind: 'wrecker', z: 482 })
    b.trap({ kind: 'ram', z: 486, side: 1 })
    b.trap({ kind: 'wrecker', z: 490 })
    b.trap({ kind: 'ram', z: 494, side: -1 })
    b.trap({ kind: 'gale', z: 498, direction: 1 })
    b.trap({ kind: 'ram', z: 502, side: 1 })

    b.pad(0, 509, 12, 6, COLORS.safe)
    b.checkpoint(507, new THREE.Vector3(0, 1.6, 509), 'The Ram Run')
    b.route(0, 509)

    // ---- The high road: 512..568. A climb onto a walkway in the sky ------
    for (let i = 0; i < 7; i += 1) {
      const z = 515 + i * 2.3
      const top = RISE * (i + 1)
      b.pad(i % 2 ? 0.6 : -0.6, z, 3.4, 2.6, COLORS.platform, top)
      b.route(i % 2 ? 0.6 : -0.6, z, top, 1.1)
    }
    const HIGH = RISE * 7
    b.pad(0, 540, 3.2, 20, COLORS.platform, HIGH)
    for (let z = 532; z <= 548; z += 3) b.route(0, z, HIGH, 0.9)
    b.trap({ kind: 'spike', z: 534, floor: HIGH })
    b.trap({ kind: 'spike', z: 540, floor: HIGH })
    b.trap({ kind: 'gale', z: 543, direction: 1, floor: HIGH })
    b.trap({ kind: 'spike', z: 546, floor: HIGH })
    for (const [z, top] of [
      [553, HIGH - 2.6],
      [559, HIGH - 5.2],
      [565, 0],
    ] as Array<[number, number]>) {
      b.pad(0, z, 9, 6, COLORS.platform, top)
      b.route(0, z, top, 3.6)
    }

    b.pad(0, 571, 12, 6, COLORS.safe)
    b.checkpoint(569, new THREE.Vector3(0, 1.6, 571), 'The High Road')
    b.route(0, 571)

    // ---- The long crossing: 574..616. Four sliders -----------------------
    b.pad(0, 576, 9, 4, COLORS.platform)
    b.route(0, 576)
    for (const [z, amplitude, phase] of [
      [583, 3.5, 0],
      [591, 4, Math.PI * 0.5],
      [599, 4.5, Math.PI * 1.1],
      [607, 3, Math.PI * 1.7],
    ] as Array<[number, number, number]>) {
      b.route(0, z, 0, 2.2, b.mover(z, amplitude, phase))
    }
    b.pad(0, 614, 9, 4, COLORS.platform)
    b.route(0, 614)

    b.pad(0, 619, 12, 6, COLORS.safe)
    b.checkpoint(617, new THREE.Vector3(0, 1.6, 619), 'The Long Crossing')
    b.route(0, 619)

    // ---- The last mile: 622..658. All of it at once ----------------------
    b.pad(0, 640, 6, 36, COLORS.platform)
    corridor(640, 36, 3.3)
    for (let z = 625; z <= 655; z += 3) b.route(0, z, 0, 2.2)
    b.trap({ kind: 'crusher', z: 628 })
    b.trap({ kind: 'spike', z: 631, x: -1.5 })
    b.trap({ kind: 'wrecker', z: 634 })
    b.trap({ kind: 'gale', z: 637, direction: 1 })
    b.trap({ kind: 'crusher', z: 640 })
    b.trap({ kind: 'spike', z: 643, x: 1.5 })
    b.trap({ kind: 'wrecker', z: 646 })
    b.trap({ kind: 'crusher', z: 652 })
    b.trap({ kind: 'spike', z: 655, x: 0 })

    // ---- Ramp 658..664, podium 664..674 ----------------------------------
    b.ramp(661, 6, 2.2, 14)
    b.route(0, 661, 1.2)
    b.pad(0, 669, 14, 10, COLORS.safe, 2.2)
    b.finish(668, new THREE.Vector3(0, 3.6, 671), 2.2)
    b.wall(-6.7, 3.0, 669, 0.6, 1.6, 10)
    b.wall(6.7, 3.0, 669, 0.6, 1.6, 10)
    b.wall(0, 3.0, 673.7, 14, 1.6, 0.6)
    b.route(0, 668, 2.2)
    b.route(0, 673, 2.2)

    b.pillars([8, 34, 103, 126, 174, 227, 258, 288, 302, 337, 437, 485, 540, 576, 640, 669])
  },
}
