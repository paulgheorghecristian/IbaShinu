import * as THREE from 'three'
import { ENEMY } from '../config'
import type { InputFrame } from '../engine/Input'
import type { Gallery } from '../world/Gallery'

/**
 * The saboteur, on foot in the gallery.
 *
 * Deliberately not a physics body. There is nothing for one to do — the corridor
 * is a smooth floor between two walls with no gaps and nothing to collide with —
 * and a body would inherit every problem this role does not want: it could be
 * thrown by a gale it was standing beside, it would need its own collision layer
 * to stay out of the course, and the gallery has no colliders for it to stand on
 * in the first place. A clamped position and a floor lookup is the whole
 * simulation.
 *
 * Movement is resolved against the same basis the runners use, so W is "the way
 * I am looking" in both roles and switching between them costs no relearning.
 * Walking is the only way to reach a button, which is the point of the mode: the
 * traps are spread over the whole course and you are one person.
 */
export class Enemy {
  readonly position = new THREE.Vector3()
  readonly eye = new THREE.Vector3()

  private readonly step = new THREE.Vector3()

  /** Put the enemy at the near end of the gallery, level with the start pad. */
  spawn(gallery: Gallery): void {
    this.position.set(ENEMY.gallery.x, 0, 6)
    gallery.clamp(this.position)
    this.sync()
  }

  update(dt: number, frame: InputFrame | null, gallery: Gallery): void {
    if (frame && (frame.forward !== 0 || frame.right !== 0)) {
      const sin = Math.sin(frame.yaw)
      const cos = Math.cos(frame.yaw)
      // forward = (sin, 0, cos); right = forward x UP = (-cos, 0, sin).
      this.step.set(
        sin * frame.forward - cos * frame.right,
        0,
        cos * frame.forward + sin * frame.right,
      )
      if (this.step.lengthSq() > 1) this.step.normalize()
      this.position.addScaledVector(this.step, ENEMY.moveSpeed * dt)
    }
    gallery.clamp(this.position)
    this.sync()
  }

  private sync(): void {
    this.eye.copy(this.position)
    this.eye.y += ENEMY.eyeHeight
  }
}
