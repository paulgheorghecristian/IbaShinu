import * as THREE from 'three'
import { Trap, type TrapContext, type TrapSpec } from './Trap'
import { Pendulum, Piston, Crusher, Spinner, DropFloor, Fan, Spike, Cascade } from './kinds'
import type { Physics } from '../engine/Physics'
import type { Course } from '../world/Course'
import type { Runner } from '../entities/Runner'
import type { Particles } from '../world/Particles'
import type { TrapPlacement } from '../levels/Level'
import { TRAPS } from '../config'

/** Everything about a kind of trap that is not its position. */
const TUNING = {
  wrecker: { label: 'Wrecker', cooldown: 7, duration: 7.2, autoInterval: 10, color: 0xff6b6b, lift: 8.6 },
  trapdoor: { label: 'Trapdoor', cooldown: 9, duration: 3.8, autoInterval: 14, color: 0xffc93c, lift: 3.6 },
  ram: { label: 'Ram', cooldown: 4, duration: 2.0, autoInterval: 6.5, color: 0xff9f43, lift: 4.4 },
  spinner: { label: 'Spinner', cooldown: 12, duration: 7, autoInterval: 17, color: 0x5ad1c8, lift: 5.4 },
  crusher: { label: 'Crusher', cooldown: 6, duration: 3.4, autoInterval: 9, color: 0xc77dff, lift: 6.2 },
  gale: { label: 'Gale', cooldown: 7, duration: 3.6, autoInterval: 12, color: 0x7fe0ff, lift: 5.2 },
  spike: { label: 'Spike', cooldown: 3.5, duration: 2.2, autoInterval: 5.5, color: 0xff7a5c, lift: 3.4 },
  cascade: { label: 'Cascade', cooldown: 10, duration: 5.2, autoInterval: 15, color: 0xffc93c, lift: 4.2 },
} as const

/** Debug hotkeys, in placement order. Traps past the tenth get none. */
const KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0']

/**
 * Owns every trap on the course and decides when each one springs.
 *
 * Nothing pulls these levers: each trap rolls its own randomised delay and fires
 * whenever a runner is close enough to be worth catching. `fire()` is the same
 * entry point a remote saboteur would use once there is a second client, which is
 * why manual firing stays wired up behind the debug flag.
 *
 * The levels say only what goes where — see `src/levels`. Tuning lives here, so a
 * balance pass is one file and a new level never has to mention a cooldown.
 */
export class TrapSystem {
  readonly traps: Trap[] = []

  constructor(
    physics: Physics,
    scene: THREE.Scene,
    course: Course,
    private readonly particles: Particles,
  ) {
    course.trapPlacements.forEach((placement, index) => {
      const tuning = TUNING[placement.kind]
      let z: number
      let x = 0
      if (placement.kind === 'trapdoor') {
        ;({ x, z } = course.dropTiles[placement.tile].home)
      } else if (placement.kind === 'cascade') {
        // Mark the middle of the run, so the warning ring sits over the whole thing.
        const mid = course.dropTiles[placement.tiles[Math.floor(placement.tiles.length / 2)]]
        ;({ x, z } = mid.home)
      } else {
        z = placement.z
        if (placement.kind === 'spike') x = placement.x ?? 0
      }
      const floor =
        placement.kind === 'gale' || placement.kind === 'spike' ? (placement.floor ?? 0) : 0
      const spec: TrapSpec = {
        label: tuning.label,
        key: KEYS[index] ?? '',
        keyLabel: index < KEYS.length ? String((index + 1) % 10) : '',
        anchor: new THREE.Vector3(x, floor + tuning.lift, z),
        cooldown: tuning.cooldown,
        duration: tuning.duration,
        autoInterval: tuning.autoInterval,
        color: tuning.color,
      }

      switch (placement.kind) {
        case 'wrecker':
          this.traps.push(new Pendulum(physics, scene, spec, placement.z))
          break
        case 'trapdoor':
          this.traps.push(new DropFloor(scene, spec, course.dropTiles[placement.tile]))
          break
        case 'ram':
          this.traps.push(new Piston(physics, scene, spec, placement.z, placement.side))
          break
        case 'spinner':
          this.traps.push(new Spinner(physics, scene, spec, placement.z))
          break
        case 'crusher':
          this.traps.push(new Crusher(physics, scene, spec, placement.z))
          break
        case 'gale':
          this.traps.push(new Fan(scene, spec, placement.z, placement.direction, floor))
          break
        case 'spike':
          this.traps.push(new Spike(physics, scene, spec, x, placement.z, floor))
          break
        case 'cascade':
          this.traps.push(
            new Cascade(scene, spec, placement.tiles.map((i) => course.dropTiles[i])),
          )
          break
      }
    })
  }

  /** Fire a specific trap on demand. Used by the debug overlay. */
  fire(index: number): boolean {
    return this.traps[index]?.fire() ?? false
  }

  update(dt: number, elapsed: number, runners: Runner[]): void {
    const ctx: TrapContext = { dt, elapsed, runners, particles: this.particles }
    for (const trap of this.traps) {
      trap.autoTimer -= dt
      if (trap.autoTimer <= 0) {
        trap.autoTimer = trap.rollDelay()
        // Only spring a trap somebody is close enough to be caught by.
        if (this.someoneNear(trap.spec.anchor.z, runners)) trap.fire()
      }
      trap.update(ctx)
    }
  }

  drawMarkers(elapsed: number, cameraPosition: THREE.Vector3): void {
    for (const trap of this.traps) trap.drawMarker(elapsed, cameraPosition)
  }

  reset(): void {
    for (const trap of this.traps) trap.reset(this.particles)
  }

  private someoneNear(z: number, runners: Runner[]): boolean {
    return runners.some((r) => r.state === 'racing' && Math.abs(r.progress - z) < TRAPS.triggerRange)
  }
}
