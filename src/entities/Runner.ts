import * as THREE from 'three'
import {
  Physics,
  RigidBodyDesc,
  ColliderDesc,
  RUNNER_GROUPS,
  type RigidBody,
} from '../engine/Physics'
import type { InputFrame } from '../engine/Input'
import type { Course } from '../world/Course'
import { RUNNER, DOG } from '../config'
import { coatTexture, SHADOW_SIDE } from '../world/Materials'
import type { DogInstance } from '../world/DogModel'

export type RunnerState = 'racing' | 'respawning' | 'finished'

const UP = new THREE.Vector3(0, 1, 0)
/** Scratch for the slope alignment, which runs per runner per frame. */
const TILT = new THREE.Quaternion()
const SPIN = new THREE.Quaternion()
const FLAT = new THREE.Quaternion()

/**
 * A racer. The player and every bot share this class — only the source of the
 * `InputFrame` differs, which is exactly the split multiplayer needs (remote
 * players are just runners fed frames that arrived over the wire).
 */
export class Runner {
  readonly body: RigidBody
  readonly root = new THREE.Group()

  state: RunnerState = 'racing'
  checkpointIndex = 0
  falls = 0
  jumps = 0
  finishTime: number | null = null
  stamina = 100
  sprintStamina = 100
  grounded = false
  gliding = false
  sprinting = false

  private readonly shell: THREE.Mesh
  /** Yaws to the travel direction. The dog, when present, rides on this. */
  private readonly dressing = new THREE.Group()
  private readonly tail: THREE.Mesh
  /** The placeholder ball, hidden once a dog model is available. */
  private readonly ballParts: THREE.Object3D[] = []
  private readonly dog: DogInstance | null

  /** Dev introspection only. */
  get dogWeights(): Record<string, number> | null {
    return this.dog ? this.dog.weights : null
  }

  /** Dev introspection only. */
  get dogJumpTime(): number {
    return this.dog ? this.dog.jumpTime : -1
  }
  /** Seconds spent asking to move on the ground while gaining no ground. */
  private stalled = 0
  /** Where we were when we last made progress, for the stall test. */
  private readonly stallAnchor = new THREE.Vector3()
  /** The face underfoot this tick, and the eased version the mesh is stood on. */
  private readonly groundNormal = new THREE.Vector3(0, 1, 0)
  private readonly restNormal = new THREE.Vector3(0, 1, 0)
  /** Eased heading of the mesh, kept apart from `facing` so it can lag it. */
  private meshYaw = 0
  /** Vertical speed at the top of the previous tick, for the landing test. */
  private lastVy = 0
  private coyote = 0
  private jumpBuffer = 0
  private jumpLock = 0
  /** Seconds left of the crouch before the impulse actually fires. */
  private windup = 0
  private respawnTimer = 0
  private facing = 0

  /** Forgiveness for a human thumb; bots plan their jumps and do not want it. */
  private readonly holdToJump: boolean

  /** Transform at the end of the previous tick, for render interpolation. */
  /** Velocity of the platform underfoot, for a jump to inherit. */
  private readonly carried = new THREE.Vector3()

  private readonly prevPos = new THREE.Vector3()
  private readonly prevQuat = new THREE.Quaternion()
  private readonly livePos = new THREE.Vector3()
  private readonly liveQuat = new THREE.Quaternion()

  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly move = new THREE.Vector3()
  private readonly scratch = new THREE.Vector3()

  constructor(
    private readonly physics: Physics,
    scene: THREE.Scene,
    spawn: THREE.Vector3,
    readonly name: string,
    readonly color: number,
    readonly isPlayer: boolean,
    dog: DogInstance | null = null,
  ) {
    this.dog = dog
    this.holdToJump = isPlayer && RUNNER.holdToJump
    this.body = physics.world.createRigidBody(
      RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setLinearDamping(RUNNER.linearDamping)
        .setAngularDamping(RUNNER.angularDamping)
        .setCcdEnabled(true),
    )
    physics.world.createCollider(
      ColliderDesc.ball(RUNNER.radius)
        .setFriction(RUNNER.friction)
        .setRestitution(RUNNER.restitution)
        .setDensity(RUNNER.mass / ((4 / 3) * Math.PI * RUNNER.radius ** 3))
        // Solid to the course, transparent to the rest of the pack.
        .setCollisionGroups(RUNNER_GROUPS),
      this.body,
    )

    const patch = new THREE.Color(color).lerp(new THREE.Color(0x1b1f2a), 0.45).getHex()
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(RUNNER.radius, 26, 18),
      new THREE.MeshStandardMaterial({
        map: coatTexture(color, patch),
        roughness: 0.68,
        metalness: 0.02,
        shadowSide: SHADOW_SIDE,
      }),
    )
    this.shell.castShadow = true
    this.root.add(this.shell)
    this.ballParts.push(this.shell)

    // Dressing does not roll with the shell, so the face keeps pointing forward.
    const eyeGeo = new THREE.SphereGeometry(0.075, 10, 8)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14161d, roughness: 0.3 })
    for (const dx of [-0.19, 0.19]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(dx, 0.17, RUNNER.radius - 0.06)
      this.dressing.add(eye)
      this.ballParts.push(eye)
    }
    const earGeo = new THREE.ConeGeometry(0.14, 0.3, 5)
    const earMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, shadowSide: SHADOW_SIDE })
    for (const dx of [-0.26, 0.26]) {
      const ear = new THREE.Mesh(earGeo, earMat)
      ear.position.set(dx, RUNNER.radius - 0.02, 0.16)
      ear.castShadow = true
      this.dressing.add(ear)
      this.ballParts.push(ear)
    }
    this.tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.17, 0.72, 7),
      new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.55, shadowSide: SHADOW_SIDE }),
    )
    this.tail.position.set(0, 0.28, -RUNNER.radius - 0.12)
    this.tail.rotation.x = -Math.PI / 2.4
    this.tail.castShadow = true
    this.dressing.add(this.tail)
    this.ballParts.push(this.tail)

    this.root.add(this.dressing)

    if (dog) {
      // The dog rides the facing group, so it inherits the same turn easing the
      // ball's face had. The ball itself stays built but hidden, as the fallback.
      this.dressing.add(dog.root)
      for (const part of this.ballParts) part.visible = false
    }

    this.root.position.copy(spawn)
    scene.add(this.root)
  }

  /** Simulation position. Gameplay reads this; the camera reads `renderPosition`. */
  get position(): THREE.Vector3 {
    const t = this.body.translation()
    return this.scratch.set(t.x, t.y, t.z)
  }

  /** Interpolated position actually on screen this frame. */
  get renderPosition(): THREE.Vector3 {
    return this.root.position
  }

  /** Linear distance travelled down the course — the ranking key. */
  get progress(): number {
    return this.body.translation().z
  }

  // -------------------------------------------------------------------------

  /** One fixed simulation step. `frame` is null while the race is not live. */
  fixedUpdate(dt: number, frame: InputFrame | null, course: Course, raceTime: number): void {
    const t = this.body.translation()
    const v = this.body.linvel()
    // What the body was doing before the last solve, so this tick can tell a
    // bounce off the floor from something hitting it.
    const priorVy = this.lastVy
    this.lastVy = v.y

    // Runs before world.step(), so the body still holds last tick's result: this
    // is the "from" end of the interpolation the renderer will draw between.
    const r = this.body.rotation()
    this.prevPos.set(t.x, t.y, t.z)
    this.prevQuat.set(r.x, r.y, r.z, r.w)

    if (this.state === 'respawning') {
      // Clear the action flags, or they go stale across the respawn. A sprint
      // flag left set is not cosmetic: it is what the hysteresis reads to decide
      // whether the pool has recovered far enough to engage again.
      this.gliding = false
      this.sprinting = false
      this.respawnTimer -= dt
      if (this.respawnTimer <= 0) this.state = 'racing'
      this.stamina = Math.min(100, this.stamina + RUNNER.glide.refillPerSecond * dt * 2)
      this.sprintStamina = Math.min(100, this.sprintStamina + RUNNER.sprint.refillPerSecond * dt * 2)
      this.body.setGravityScale(1, true)
      return
    }

    if (t.y < RUNNER.killY) {
      // A finisher is never sent back to a checkpoint — put them on the podium.
      if (this.state === 'finished') {
        this.body.setTranslation(course.podium, true)
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        this.snapRender()
      } else {
        this.wipeout(course)
      }
      return
    }

    if (this.state === 'racing' && t.z >= course.finishZ) {
      this.state = 'finished'
      this.finishTime = raceTime
    }

    // --- ground contact ---------------------------------------------------
    this.jumpLock = Math.max(0, this.jumpLock - dt)
    const ground =
      this.jumpLock > 0
        ? null
        : this.physics.probeGround(
            { x: t.x, y: t.y, z: t.z },
            RUNNER.radius,
            RUNNER.groundProbe,
            this.body,
          )
    this.grounded = ground !== null

    // Remember the face underfoot so the dog can be stood square to it. Eased
    // rather than copied: stepping from a ramp onto flat ground is a hard change
    // of normal, and snapping the whole animal upright in one tick reads worse
    // than the tilt being slightly late.
    //
    // The normal is held through coyote time rather than dropped the first tick
    // the probe misses. A ball resting on a ramp loses contact for the odd tick,
    // and treating each of those as "airborne, stand up straight" pulls the mesh
    // a couple of degrees off the slope it is plainly sitting on.
    if (ground) this.groundNormal.set(ground.normal.x, ground.normal.y, ground.normal.z)
    else if (this.coyote <= 0) this.groundNormal.copy(UP)

    // Absorb the landing. The solver has just turned a fall into a small hop,
    // which on a course of one-metre tiles puts you down somewhere you did not
    // aim at — and then does it again, smaller, a few ticks later.
    //
    // The test is whether the rebound is one: it has to follow a fall, and be no
    // faster than restitution times the impact. Anything above that came from a
    // machine rather than the floor, so a spike under a standing runner and a
    // wrecker to the ribs both still throw them.
    if (this.grounded && priorVy < -0.5 && v.y > 0 && v.y <= -priorVy * RUNNER.restitution + 0.2) {
      this.body.setLinvel({ x: v.x, y: v.y * RUNNER.landingBounce, z: v.z }, true)
    }

    // Ride a moving platform. Friction alone cannot hold a runner on one at these
    // speeds, so the platform's step is applied to the runner directly, and its
    // velocity is remembered so a jump off it carries the right momentum.
    const carry = ground ? course.carryDelta(ground.body) : null
    if (carry) {
      this.body.setTranslation({ x: t.x + carry.x, y: t.y + carry.y, z: t.z + carry.z }, true)
      this.carried.copy(carry).divideScalar(dt)
    } else if (this.grounded) {
      this.carried.set(0, 0, 0)
    }
    this.coyote = this.grounded ? RUNNER.coyoteTime : Math.max(0, this.coyote - dt)

    if (!frame || this.state === 'finished') {
      this.gliding = false
      this.sprinting = false
      this.sprintStamina = Math.min(100, this.sprintStamina + RUNNER.sprint.refillPerSecond * dt)
      this.body.setGravityScale(1, true)
      this.stamina = Math.min(100, this.stamina + RUNNER.glide.refillPerSecond * dt)
      if (this.state === 'finished') {
        // Bleed off the crossing speed so winners settle on the podium.
        const damp = RUNNER.finishBraking ** dt
        this.body.setLinvel({ x: v.x * damp, y: v.y, z: v.z * damp }, true)
      }
      return
    }

    // --- horizontal drive -------------------------------------------------
    this.forward.set(Math.sin(frame.yaw), 0, Math.cos(frame.yaw))
    this.right.copy(this.forward).cross(UP)
    this.move.set(0, 0, 0)
      .addScaledVector(this.forward, frame.forward)
      .addScaledVector(this.right, frame.right)

    const drive = this.move.length()

    // Sprint is a ground state. In the air your existing speed simply carries,
    // because the acceleration clamp never takes speed away, only declines to add
    // more — so a sprinting jump keeps its length without any special case.
    const sprintFloor = this.sprinting ? 0 : RUNNER.sprint.minToEngage
    this.sprinting =
      frame.sprint && this.grounded && drive > 1e-3 && this.sprintStamina > sprintFloor

    if (this.sprinting) {
      this.sprintStamina = Math.max(0, this.sprintStamina - RUNNER.sprint.drainPerSecond * dt)
    } else {
      this.sprintStamina = Math.min(100, this.sprintStamina + RUNNER.sprint.refillPerSecond * dt)
    }

    if (drive > 1e-3) {
      // Keep direction and throttle separate: bots use partial throttle as a handicap.
      this.move.divideScalar(drive)
      const throttle = Math.min(1, drive)
      const accel = this.sprinting
        ? RUNNER.sprint.accel
        : this.grounded
          ? RUNNER.groundAccel
          : RUNNER.airAccel
      const cap = this.sprinting
        ? RUNNER.sprint.maxSpeed
        : this.grounded
          ? RUNNER.maxGroundSpeed
          : RUNNER.maxAirSpeed
      // Quake-style clamp: only add speed we do not already have in that direction.
      const along = v.x * this.move.x + v.z * this.move.z
      const room = Math.max(0, 1 - along / cap)
      const impulse = accel * room * throttle * dt
      this.body.applyImpulse({ x: this.move.x * impulse, y: 0, z: this.move.z * impulse }, true)
      this.facing = Math.atan2(this.move.x, this.move.z)

      // Driving hard and gaining no ground means something is in the way — a step,
      // a wall, the lip of a platform. The animator turns this into scrabbling
      // legs rather than a stride played on the spot.
      //
      // The test is distance covered, not speed. Speed is far too twitchy here:
      // a runner shoved into a step bounces off, re-accelerates through any
      // threshold you pick and hits it again, several times a second. Ground
      // actually gained in the direction asked for does not care about the bounce.
      const advanced =
        (t.x - this.stallAnchor.x) * this.move.x + (t.z - this.stallAnchor.z) * this.move.z
      if (Math.abs(advanced) > RUNNER.stallAdvance || !this.grounded || throttle <= 0.5) {
        // Re-anchor on real progress, and on a turn, which makes the old anchor
        // meaningless because it is measured against the direction we now want.
        this.stalled = 0
        this.stallAnchor.set(t.x, 0, t.z)
      } else {
        this.stalled += dt
      }
    } else if (this.grounded) {
      this.stalled = 0
      this.stallAnchor.set(t.x, 0, t.z)
      // Asking for nothing on the ground means stop. Without this the ball coasts
      // and you cannot park it on the tile you were aiming for.
      const speed = Math.hypot(v.x, v.z)
      if (speed > 0.04) {
        const shed = Math.min(speed, RUNNER.groundFriction * dt) / speed
        this.body.applyImpulse(
          { x: -v.x * shed * RUNNER.mass, y: 0, z: -v.z * shed * RUNNER.mass },
          true,
        )
      }
    }

    // --- jump -------------------------------------------------------------
    // A dog gathers itself before it leaves the ground. The impulse is held back
    // for `jumpWindup` so the crouch and push-off have somewhere to happen —
    // without it the physics is a bare parabola that the animation cannot match.
    const asking = frame.jumpPressed || (this.holdToJump && frame.jump)
    this.jumpBuffer = asking ? RUNNER.jumpBuffer : Math.max(0, this.jumpBuffer - dt)

    if (this.windup > 0) {
      this.windup = Math.max(0, this.windup - dt)
      if (this.windup <= 0) this.launch()
    } else if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.jumpBuffer = 0
      this.coyote = 0
      if (RUNNER.jumpWindup > 0) this.windup = RUNNER.jumpWindup
      else this.launch()
    }

    // --- tail glide -------------------------------------------------------
    const wantsGlide =
      !this.grounded && frame.jump && v.y < RUNNER.glide.minFallSpeed && this.stamina > 0
    this.gliding = wantsGlide

    if (wantsGlide) {
      this.body.setGravityScale(RUNNER.glide.gravityScale, true)
      if (v.y < -RUNNER.glide.maxFallSpeed) {
        this.body.setLinvel({ x: v.x, y: -RUNNER.glide.maxFallSpeed, z: v.z }, true)
      }
      this.body.applyImpulse(
        {
          x: this.forward.x * RUNNER.glide.forwardForce * dt,
          y: 0,
          z: this.forward.z * RUNNER.glide.forwardForce * dt,
        },
        true,
      )
      this.stamina = Math.max(0, this.stamina - RUNNER.glide.drainPerSecond * dt)
    } else {
      this.body.setGravityScale(1, true)
      const rate = this.grounded ? RUNNER.glide.refillPerSecond * 1.8 : RUNNER.glide.refillPerSecond * 0.5
      this.stamina = Math.min(100, this.stamina + rate * dt)
    }
  }

  /** Leave the ground. Velocity is read fresh, so this tick's drive is included. */
  private launch(): void {
    const v = this.body.linvel()
    // Leaving a moving platform should launch you from its frame, not the world's.
    this.body.setLinvel(
      { x: v.x + this.carried.x, y: RUNNER.jumpSpeed, z: v.z + this.carried.z },
      true,
    )
    this.carried.set(0, 0, 0)
    this.grounded = false
    this.jumpLock = RUNNER.jumpLockout
    // The ground contact has been spent. `jumpLockout` stops the probe re-arming
    // the jump, but coyote time is a second, independent way back in and the
    // lockout does not cover it: the runner is still standing through the whole
    // windup, so the tick that launches has just refreshed coyote to its full
    // `coyoteTime` — which is longer than the lockout anyway. Leave it set and
    // for the next tenth of a second the runner is airborne with a live ground
    // credit, so any buffered press fires a second jump out of mid-air and the
    // dog sails up twice as high.
    this.coyote = 0
    this.jumps += 1
  }

  /** 0 while standing, rising to 1 across the crouch. Drives the anticipation. */
  get windupProgress(): number {
    return this.windup > 0 ? 1 - this.windup / RUNNER.jumpWindup : 0
  }

  /** Send the runner back to its last checkpoint. */
  wipeout(course: Course): void {
    if (this.state === 'finished') return
    this.falls += 1
    this.state = 'respawning'
    this.gliding = false
    this.sprinting = false
    this.windup = 0
    this.respawnTimer = RUNNER.respawnDelay
    this.stalled = 0
    const cp = course.checkpoints[this.checkpointIndex]
    const jitter = (Math.random() - 0.5) * 3
    this.body.setTranslation({ x: cp.respawn.x + jitter, y: cp.respawn.y, z: cp.respawn.z }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.stamina = 100
    this.sprintStamina = 100
    this.snapRender()
  }

  /** Collapse the interpolation window after a teleport, so nothing smears. */
  snapRender(): void {
    const t = this.body.translation()
    const r = this.body.rotation()
    this.prevPos.set(t.x, t.y, t.z)
    this.prevQuat.set(r.x, r.y, r.z, r.w)
    this.root.position.copy(this.prevPos)
  }

  /** Put the runner back on the start line for a fresh race. */
  reset(spawn: THREE.Vector3): void {
    this.body.setTranslation(spawn, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setGravityScale(1, true)
    this.state = 'racing'
    this.checkpointIndex = 0
    this.falls = 0
    this.jumps = 0
    this.finishTime = null
    this.stamina = 100
    this.sprintStamina = 100
    this.gliding = false
    this.sprinting = false
    this.coyote = 0
    this.jumpBuffer = 0
    this.jumpLock = 0
    this.windup = 0
    this.respawnTimer = 0
    this.stalled = 0
    this.stallAnchor.copy(spawn)
    this.facing = 0
    this.meshYaw = 0
    this.lastVy = 0
    this.groundNormal.copy(UP)
    this.restNormal.copy(UP)
    this.root.position.copy(spawn)
    this.root.visible = true
    this.snapRender()
  }

  /**
   * Linear course, so a checkpoint is claimed by passing its Z — but only while
   * standing on something.
   *
   * A runner knocked off the course keeps its forward speed all the way down, and
   * a fall to the kill plane lasts about a second and a half. That carries it
   * seven or eight metres further down the course while it drops, which is enough
   * to sail past the next checkpoint line in mid-air, eleven metres below the
   * floor — and then respawn *past* the section it just failed. Requiring
   * contact means a checkpoint has to actually be reached on foot.
   */
  updateCheckpoints(course: Course): void {
    if (!this.grounded) return
    while (
      this.checkpointIndex < course.checkpoints.length - 1 &&
      this.progress >= course.checkpoints[this.checkpointIndex + 1].z
    ) {
      this.checkpointIndex += 1
    }
  }

  /**
   * Copy physics state onto the scene graph, once per rendered frame.
   *
   * `alpha` is how far the renderer is between the last two simulation ticks. The
   * simulation runs at a fixed 60 Hz; without this the ball would only move on
   * frames that happened to advance a tick, which on any display faster than
   * 60 Hz is a minority of them — and that judder reads as input lag.
   */
  syncMesh(dt: number, alpha: number): void {
    const t = this.body.translation()
    const r = this.body.rotation()
    this.livePos.set(t.x, t.y, t.z)
    this.liveQuat.set(r.x, r.y, r.z, r.w)
    this.root.position.lerpVectors(this.prevPos, this.livePos, alpha)
    this.shell.quaternion.copy(this.prevQuat).slerp(this.liveQuat, alpha)

    const v = this.body.linvel()
    if (v.x * v.x + v.z * v.z > 0.6) this.facing = Math.atan2(v.x, v.z)
    // Ease the dressing toward travel direction so it does not snap on contact.
    let delta = this.facing - this.meshYaw
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    this.meshYaw += delta * Math.min(1, dt * 12)

    // Stand the animal on the face underfoot rather than on world up. Tilting
    // about the root works out at the right height for free: the paws sit
    // DOG.groundOffset along the normal, and the ball's contact point is its
    // radius along the same normal, which is the 3 cm of clearance flat ground
    // already has.
    this.restNormal.lerp(this.groundNormal, Math.min(1, dt * DOG.slopeAlignRate)).normalize()
    TILT.setFromUnitVectors(UP, this.restNormal)
    const lean = 2 * Math.acos(Math.min(1, Math.abs(TILT.w)))
    if (lean > DOG.slopeMaxTilt) TILT.copy(FLAT.identity().slerp(TILT, DOG.slopeMaxTilt / lean))
    SPIN.setFromAxisAngle(UP, this.meshYaw)
    this.dressing.quaternion.copy(TILT).multiply(SPIN)

    if (this.dog) {
      this.dog.update(dt, {
        speed: Math.hypot(v.x, v.z),
        grounded: this.grounded,
        verticalSpeed: v.y,
        windup: this.windupProgress,
        sprinting: this.sprinting,
        blocked: Math.min(1, Math.max(0, this.stalled - DOG.scrabbleAfter) / DOG.scrabbleAfter),
      })
    } else {
      // The tail fans out into a glider and tucks back in when you land.
      const target = this.gliding ? 1 : 0
      const s = this.tail.scale
      const k = Math.min(1, dt * 11)
      s.x += (1 + target * 2.1 - s.x) * k
      s.y += (1 + target * 0.5 - s.y) * k
      s.z += (1 + target * 1.4 - s.z) * k
    }
    this.root.visible = this.state !== 'respawning' || Math.floor(performance.now() / 90) % 2 === 0
  }
}
