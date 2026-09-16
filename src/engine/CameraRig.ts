import * as THREE from 'three'
import { CAMERA } from '../config'
import type { Physics } from './Physics'

const DEG2RAD = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Counter-Strike 1.6 style view control in third person.
 *
 * Nothing here is directed. The camera orbits one point above the ball at a fixed
 * radius, and `yaw`/`pitch` are the raw mouse deltas scaled by a sensitivity —
 * never filtered, never eased, never `lookAt`-lerped toward a target. Orientation
 * is written straight from those two angles and position straight from the orbit,
 * so where the camera ends up is a pure function of where you are and where you
 * are looking. The only thing that moves it off that circle is geometry in the way.
 */
export class CameraRig {
  yaw = 0
  pitch: number = CAMERA.pitchStart

  private readonly dir = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly pivot = new THREE.Vector3()
  private readonly back = new THREE.Vector3()

  applyMouse(dx: number, dy: number): void {
    this.yaw -= dx * CAMERA.sensitivity * CAMERA.yawPerCount * DEG2RAD
    const dp = dy * CAMERA.sensitivity * CAMERA.pitchPerCount * DEG2RAD
    this.pitch += CAMERA.invertY ? -dp : dp
    this.pitch = Math.max(CAMERA.pitchMin, Math.min(CAMERA.pitchMax, this.pitch))
    // Wrap yaw so it never drifts into float territory over a long session.
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  }

  /** Unit view vector. Movement input is resolved against its horizontal part. */
  get viewDirection(): THREE.Vector3 {
    const cp = Math.cos(this.pitch)
    return this.dir.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp)
  }

  update(
    camera: THREE.PerspectiveCamera,
    target: THREE.Vector3,
    dt: number,
    physics: Physics,
    snap = false,
  ): void {
    const dir = this.viewDirection
    this.pivot.copy(target).addScaledVector(UP, CAMERA.height)

    // Pull in if the boom would put the camera inside geometry.
    let distance: number = CAMERA.distance
    this.back.copy(dir).negate()
    const blocked = physics.rayDistance(this.pivot, this.back, distance + 0.6)
    // A hit at ~zero means the pivot is *inside* something (a crusher landing on
    // you). Hugging that surface is worse than staying out at full boom length.
    if (blocked !== null && blocked > 0.2) {
      distance = Math.max(CAMERA.minDistance, blocked - CAMERA.collisionPadding)
    }

    this.desired.copy(this.pivot).addScaledVector(dir, -distance)
    if (snap || CAMERA.followRate <= 0) {
      camera.position.copy(this.desired)
    } else {
      camera.position.lerp(this.desired, 1 - Math.exp(-CAMERA.followRate * dt))
    }

    // Orientation is the mouse, verbatim.
    camera.rotation.set(-this.pitch, this.yaw + Math.PI, 0, 'YXZ')
  }
}
