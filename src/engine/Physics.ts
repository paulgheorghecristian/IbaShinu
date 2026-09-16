import {
  init as initRapier,
  World,
  RigidBodyDesc,
  ColliderDesc,
  Ray,
  type RigidBody,
  type Collider,
} from '@dimforge/rapier3d-compat'
import { PHYSICS } from '../config'

/**
 * Collision layers, as Rapier interaction groups: membership in the high 16 bits,
 * filter in the low 16. Two colliders touch only if each one's membership is in
 * the other's filter.
 *
 * Runners belong to `runner` and filter for `world` alone, so they collide with
 * the course and pass straight through each other. A pack that shoves itself
 * around turns a race into a pinball table, and none of it is the player's doing.
 */
export const LAYER = { world: 0x0001, runner: 0x0002 } as const

/** What is underfoot: the body, so it can be ridden, and the face it presents. */
export interface GroundHit {
  body: RigidBody
  normal: { x: number; y: number; z: number }
}

/** A runner: in the world, blind to other runners. */
export const RUNNER_GROUPS = (LAYER.runner << 16) | LAYER.world

/**
 * Ray filter for anything probing the course — ground checks, the bots' gap
 * probes, the camera boom. Without it a ray would still hit other dogs, and a
 * dog standing inside another would read as standing on solid ground.
 */
export const WORLD_RAY = (LAYER.world << 16) | LAYER.world

const GROUND_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export type Vec3Like = { x: number; y: number; z: number }
export type QuatLike = { x: number; y: number; z: number; w: number }
export type { RigidBody, Collider }
export { RigidBodyDesc, ColliderDesc }

/**
 * Thin wrapper over the Rapier world that owns the fixed-timestep accumulator.
 *
 * Gameplay only ever advances inside `step()`'s callback, so the simulation is
 * frame-rate independent and reproducible — the property an authoritative server
 * and its rollback buffer would depend on.
 */
export class Physics {
  private accumulator = 0

  private constructor(readonly world: World) {}

  static async create(): Promise<Physics> {
    await initRapier()
    const world = new World({ x: 0, y: PHYSICS.gravity, z: 0 })
    world.integrationParameters.dt = PHYSICS.fixedDt
    return new Physics(world)
  }

  /**
   * Drains wall-clock time into whole fixed steps. Returns the leftover fraction
   * (0..1) which a renderer can use to interpolate between the last two states.
   */
  step(dt: number, onFixedStep: (fixedDt: number) => void): number {
    this.accumulator = Math.min(this.accumulator + dt, 0.25)
    let steps = 0
    while (this.accumulator >= PHYSICS.fixedDt && steps < PHYSICS.maxStepsPerFrame) {
      onFixedStep(PHYSICS.fixedDt)
      this.world.step()
      this.accumulator -= PHYSICS.fixedDt
      steps += 1
    }
    // Ran out of budget: drop the backlog rather than spiralling.
    if (steps === PHYSICS.maxStepsPerFrame) this.accumulator = 0
    return this.accumulator / PHYSICS.fixedDt
  }

  staticBox(pos: Vec3Like, half: Vec3Like, rotation?: QuatLike, friction = 0.9): Collider {
    let desc = RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    if (rotation) desc = desc.setRotation(rotation)
    const body = this.world.createRigidBody(desc)
    return this.world.createCollider(
      ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(friction),
      body,
    )
  }

  kinematicBox(pos: Vec3Like, half: Vec3Like, friction = 0.9): RigidBody {
    const body = this.world.createRigidBody(
      RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z),
    )
    this.world.createCollider(
      ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(friction),
      body,
    )
    return body
  }

  /** Re-read the tunables the world was built with. Gravity is the live one. */
  refresh(): void {
    this.world.gravity = { x: 0, y: PHYSICS.gravity, z: 0 }
  }

  /** Generic ray query. Returns the distance to the first hit, or null. */
  rayDistance(origin: Vec3Like, direction: Vec3Like, maxDistance: number, exclude?: RigidBody): number | null {
    const ray = new Ray(origin, direction)
    const hit = this.world.castRay(ray, maxDistance, true, undefined, WORLD_RAY, undefined, exclude)
    return hit ? hit.timeOfImpact : null
  }

  /**
   * Downward probe used for the bots' gap detection. Returns the distance to the
   * first hit, or null.
   */
  probeDown(origin: Vec3Like, maxDistance: number, exclude?: RigidBody): number | null {
    const ray = new Ray(origin, { x: 0, y: -1, z: 0 })
    const hit = this.world.castRay(ray, maxDistance, true, undefined, WORLD_RAY, undefined, exclude)
    return hit ? hit.timeOfImpact : null
  }

  /**
   * Ground check for a ball: a centre ray plus four around it at 62% of the
   * radius. Returns the body underfoot, or null when airborne.
   *
   * A single centre ray reports "airborne" the moment the ball's centre clears a
   * platform edge, even though most of the ball is still on it — which is exactly
   * where a player is most likely to be pressing jump. Each offset ray is given
   * the shorter reach its position on the sphere actually needs.
   *
   * It returns the body rather than a boolean so a runner can tell a moving
   * platform from solid ground and be carried by it, and the surface normal so
   * the dog on top can be stood up square to whatever it is standing on.
   */
  probeGround(
    centre: Vec3Like,
    radius: number,
    clearance: number,
    exclude?: RigidBody,
  ): GroundHit | null {
    const hit = this.rayBody(centre, radius + clearance, exclude)
    if (hit) return hit

    const offset = radius * 0.62
    const reach = Math.sqrt(radius * radius - offset * offset) + clearance
    for (const [dx, dz] of GROUND_OFFSETS) {
      const origin = { x: centre.x + dx * offset, y: centre.y, z: centre.z + dz * offset }
      const found = this.rayBody(origin, reach, exclude)
      if (found) return found
    }
    return null
  }

  private rayBody(origin: Vec3Like, maxDistance: number, exclude?: RigidBody): GroundHit | null {
    const ray = new Ray(origin, { x: 0, y: -1, z: 0 })
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      undefined,
      WORLD_RAY,
      undefined,
      exclude,
    )
    if (!hit) return null
    const body = hit.collider.parent()
    if (!body) return null
    const n = hit.normal
    // A ray that starts inside a collider reports a zero normal. Fall back to
    // straight up rather than handing out a degenerate vector to rotate by.
    const flat = n.x === 0 && n.y === 0 && n.z === 0
    return { body, normal: flat ? { x: 0, y: 1, z: 0 } : n }
  }
}
