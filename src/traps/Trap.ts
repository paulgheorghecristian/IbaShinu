import * as THREE from 'three'
import type { Runner } from '../entities/Runner'
import type { Particles } from '../world/Particles'
import { TRAPS } from '../config'

export interface TrapContext {
  dt: number
  elapsed: number
  runners: Runner[]
  particles: Particles
}

export interface TrapSpec {
  label: string
  /** KeyboardEvent.code that fires it, e.g. 'Digit1'. */
  key: string
  keyLabel: string
  anchor: THREE.Vector3
  cooldown: number
  /** Seconds the trap takes to play its whole cycle. */
  duration: number
  /** When nobody is manning the traps, the course fires them on this interval. */
  autoInterval: number
  color: number
}

/**
 * A hazard a saboteur can fire.
 *
 * Every trap is a one-shot animation on a cooldown: `fire()` starts it, `update()`
 * drives it from a normalised `phase`, and it returns itself to an idle pose. That
 * uniformity is what lets one trap bar drive ten different machines — and it keeps
 * every trap's state to a float and a bool, which is what a netcode schema wants.
 */
export abstract class Trap {
  cooldownLeft = 0
  active = false
  /** Counts down to this trap's next self-fire. Re-rolled every cycle. */
  autoTimer: number

  /** Slim ring hovering over the machine: "there is something here, and it is armed". */
  readonly marker: THREE.Mesh
  protected timer = 0
  private prevPhase = 0

  constructor(readonly spec: TrapSpec, scene: THREE.Scene) {
    this.autoTimer = this.rollDelay()
    this.marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.05, 6, 20),
      new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.5, depthWrite: false }),
    )
    this.marker.rotation.x = -Math.PI / 2
    this.marker.position.copy(spec.anchor)
    scene.add(this.marker)
  }

  /** A fresh randomised delay before this trap springs again. */
  rollDelay(): number {
    const { jitterMin, jitterMax } = TRAPS
    return this.spec.autoInterval * (jitterMin + Math.random() * (jitterMax - jitterMin))
  }

  get ready(): boolean {
    return !this.active && this.cooldownLeft <= 0
  }

  /** 0..1 through the active animation; 0 while idle. */
  protected get phase(): number {
    return this.active ? Math.min(1, this.timer / this.spec.duration) : 0
  }

  /**
   * True on the single tick the animation passes `at`.
   *
   * Effects are one-shot where the machine actually strikes, which is a moment in
   * the cycle rather than a state. Without an edge test a slam would emit its dust
   * on every tick it spent at the bottom.
   */
  protected crossed(at: number): boolean {
    return this.active && this.prevPhase < at && this.phase >= at
  }

  fire(): boolean {
    if (!this.ready) return false
    this.active = true
    this.timer = 0
    return true
  }

  update(ctx: TrapContext): void {
    if (this.active) {
      this.timer += ctx.dt
      if (this.timer >= this.spec.duration) {
        this.active = false
        this.timer = 0
        this.cooldownLeft = this.spec.cooldown
      }
    } else if (this.cooldownLeft > 0) {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - ctx.dt)
    }
    this.onUpdate(ctx)
    this.prevPhase = this.phase
  }

  /** Visual state only — safe to run per rendered frame rather than per tick. */
  drawMarker(elapsed: number, cameraPosition: THREE.Vector3): void {
    const mat = this.marker.material as THREE.MeshBasicMaterial
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.4)
    const base = this.active ? 0.9 : this.ready ? 0.3 + pulse * 0.35 : 0.1

    // Fade out up close, or the ring you are about to run through fills the screen.
    const distance = this.marker.position.distanceTo(cameraPosition)
    const nearFade = Math.min(1, Math.max(0, (distance - 3.5) / 5))
    mat.opacity = base * nearFade

    this.marker.visible = mat.opacity > 0.01
    this.marker.rotation.z = elapsed * (this.ready ? 0.9 : 0.2)
    this.marker.scale.setScalar(this.active ? 1.35 : 1)
  }

  reset(particles: Particles): void {
    this.active = false
    this.timer = 0
    this.cooldownLeft = 0
    this.autoTimer = this.rollDelay()
    this.prevPhase = 0
    this.onUpdate({ dt: 0, elapsed: 0, runners: [], particles })
  }

  protected abstract onUpdate(ctx: TrapContext): void
}
