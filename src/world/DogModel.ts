import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { DOG, RUNNER } from '../config'
import { SHADOW_SIDE } from './Materials'

/** One runner's copy of the dog: its own scene graph, skeleton and mixer. */
export class DogInstance {
  readonly root = new THREE.Group()

  private readonly mixer: THREE.AnimationMixer
  private readonly walk: THREE.AnimationAction
  private readonly run: THREE.AnimationAction
  private readonly jump: THREE.AnimationAction | null
  /** A single held frame of the standing pose, so a stopped dog stands. */
  private readonly idle: THREE.AnimationAction | null
  private blend = 0
  private moving = 0
  private air = 0
  private wasGrounded = true
  /** Where the jump clip is scrubbed to, in clip seconds. */
  private jumpClock = 0
  /** Seconds of landing squash left to play out. */
  private landPlayout = 0
  private scrabbleClock = 0

  constructor(
    model: THREE.Object3D,
    clips: DogClips,
    tint: number,
    private readonly phase: JumpPhase,
  ) {
    const dog = cloneSkinned(model)
    dog.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.castShadow = true
      node.receiveShadow = false
      // A skinned mesh's bounds are computed from the bind pose, so an animated
      // limb reaching outside them makes three cull the whole dog mid-stride.
      node.frustumCulled = false
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) mat.shadowSide = SHADOW_SIDE
      }
    })
    this.root.add(dog)

    this.mixer = new THREE.AnimationMixer(dog)
    this.walk = this.mixer.clipAction(clips.walk)
    this.run = this.mixer.clipAction(clips.run)
    for (const action of [this.walk, this.run]) {
      action.play()
      action.setLoop(THREE.LoopRepeat, Infinity)
    }
    // Start on the walk so a stationary dog is not frozen mid-gallop.
    this.walk.setEffectiveWeight(1)
    this.run.setEffectiveWeight(0)

    // The jump is scrubbed, not played: its time comes from vertical velocity in
    // update(). It stays on LoopRepeat so the mixer never disables it out from
    // under us the way LoopOnce would once it reached the end.
    this.idle = clips.idle ? this.mixer.clipAction(clips.idle) : null
    if (this.idle) {
      this.idle.play()
      this.idle.setEffectiveTimeScale(0)
      this.idle.setEffectiveWeight(0)
      this.idle.time = 0
    }

    this.jump = clips.jump ? this.mixer.clipAction(clips.jump) : null
    if (this.jump) {
      this.jump.setLoop(THREE.LoopRepeat, Infinity)
      this.jump.play()
      this.jump.setEffectiveWeight(0)
      this.jump.time = phase.takeoff
    }

    // Per-runner tint, so a pack does not read as one dog six times.
    if (tint !== DOG.baseTint) this.applyTint(dog, tint)
  }

  private applyTint(dog: THREE.Object3D, tint: number): void {
    const target = new THREE.Color(tint)
    const seen = new Set<THREE.Material>()
    dog.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      node.material = mats.map((mat) => {
        if (!(mat instanceof THREE.MeshStandardMaterial)) return mat
        if (seen.has(mat)) return mat
        const copy = mat.clone()
        // The coat is vertex-painted tan and cream; multiplying by the tint keeps
        // that shading and only shifts the hue.
        copy.color.multiply(target).multiplyScalar(1.6)
        seen.add(copy)
        return copy
      }) as THREE.Material[] & THREE.Material
      if (Array.isArray(node.material) && node.material.length === 1) node.material = node.material[0]
    })
  }

  /** Dev introspection: which clip is currently carrying the pose. */
  get weights(): Record<string, number> {
    return {
      idle: +(this.idle?.getEffectiveWeight() ?? 0).toFixed(2),
      walk: +this.walk.getEffectiveWeight().toFixed(2),
      run: +this.run.getEffectiveWeight().toFixed(2),
      jump: +(this.jump?.getEffectiveWeight() ?? 0).toFixed(2),
    }
  }

  /** Dev introspection: where the jump clip is currently scrubbed to. */
  get jumpTime(): number {
    return this.jump ? this.jump.time : -1
  }

  /**
   * The gait clips are always both playing and crossfaded, which avoids the pop a
   * hard switch gives, and each is retimed so the stride roughly tracks how fast
   * the ground is moving under it.
   */
  update(dt: number, state: DogState): void {
    const { speed, grounded, verticalSpeed, windup, sprinting, blocked } = state
    if (this.jump) {
      const phase = this.phase
      if (windup > 0 && grounded) {
        // Crouch: scrub the anticipation, compressed into the wind-up window.
        this.jumpClock = phase.takeoff * windup
        this.jump.setEffectiveTimeScale(0)
        this.jump.time = this.jumpClock
        this.landPlayout = 0
      } else if (!grounded) {
        this.landPlayout = 0
        this.jump.setEffectiveTimeScale(0)

        // Where the arc says we are, from vertical velocity alone.
        const k = THREE.MathUtils.clamp(verticalSpeed / RUNNER.jumpSpeed, -1, 1)
        const mapped =
          k >= 0
            ? THREE.MathUtils.lerp(phase.apex, phase.takeoff, k)
            : THREE.MathUtils.lerp(phase.apex, phase.land, -k)

        // Scrubbing straight to `mapped` keeps perfect sync but plays the clip at
        // whatever rate the arc implies — and the game hangs in the air roughly
        // twice as long as the authored hop, which halves the speed of the push
        // and the tuck and drains the snap out of them.
        //
        // So the two halves are treated differently. Rising plays at the authored
        // rate — the push-off and the tuck keep their snap — and then simply waits
        // at the apex for however long the float lasts. Falling follows the arc,
        // so the legs reach out progressively and arrive at the landing pose on
        // the frame the paws actually touch, rather than 0.3 s early and holding.
        this.jumpClock =
          verticalSpeed >= 0
            ? Math.min(phase.apex, this.jumpClock + dt)
            : THREE.MathUtils.clamp(Math.max(this.jumpClock, mapped), phase.apex, phase.land)

        // A long drop runs out of jump to scrub and holds on the landing frame
        // until the paws touch. That is waiting for a falling clip to be authored,
        // not something to fake by sweeping these frames back and forth.
        this.jump.time = this.jumpClock
      } else if (blocked > 0 && windup <= 0) {
        // Jammed against a step. Sweep the gather-and-reach window of the jump so
        // the front legs claw at the obstacle instead of the run cycle striding on
        // the spot.
        this.landPlayout = 0
        this.jump.setEffectiveTimeScale(0)
        this.scrabbleClock += dt * DOG.scrabbleRate
        const sweep = 0.5 - 0.5 * Math.cos(this.scrabbleClock * Math.PI * 2)
        this.jumpClock = THREE.MathUtils.lerp(phase.takeoff, phase.apex, sweep)
        this.jump.time = this.jumpClock
      } else {
        this.scrabbleClock = 0
        if (!this.wasGrounded) {
          // Just landed: hand the clip back to normal playback from touchdown so
          // the squash and the settle actually play.
          this.jump.time = phase.land
          this.jump.setEffectiveTimeScale(1)
          this.landPlayout = DOG.landPlayout
        }
        this.landPlayout = Math.max(0, this.landPlayout - dt)
        // Once the squash has played, park the clip. Left running it would loop
        // the whole jump under a zero weight for as long as the dog is on the
        // ground, and any weight that is not exactly zero would leak into the gait.
        if (this.landPlayout <= 0) this.jump.setEffectiveTimeScale(0)
      }
    }
    this.wasGrounded = grounded

    // Locomotion is the run clip at every speed unless the walk is switched back
    // on, in which case the gait follows the sprint key rather than the
    // speedometer — see DOG.useWalkClip.
    const gaitTarget = DOG.useWalkClip ? (sprinting ? 1 : 0) : 1
    this.blend += (gaitTarget - this.blend) * Math.min(1, dt * DOG.blendRate)
    // The jump clip is weighted in through the crouch as well as the flight, or
    // the anticipation would be scrubbed with nothing showing it.
    // Hold some of its weight through the landing squash too, rather than cutting
    // to the gait the instant the paws touch.
    const airTarget =
      !grounded || windup > 0
        ? 1
        : blocked > 0
          ? blocked * DOG.scrabbleWeight
          : this.landPlayout > 0
            ? DOG.landWeight
            : 0
    const airRate = !grounded
      ? DOG.airBlendRate
      : blocked > 0
        ? DOG.scrabbleBlend
        : DOG.landBlendRate
    this.air += (airTarget - this.air) * Math.min(1, dt * airRate)

    // Weights are driven directly rather than through fadeIn/fadeOut, so the
    // gait crossfade and the airborne crossfade cannot fight each other.
    // Below walking pace the gait fades out entirely and the dog just stands.
    const still = THREE.MathUtils.clamp(
      (speed - DOG.idleAt) / Math.max(0.01, DOG.walkAt - DOG.idleAt),
      0,
      1,
    )
    this.moving += (still - this.moving) * Math.min(1, dt * DOG.blendRate)

    const ground = this.jump ? 1 - this.air : 1
    const gait = this.idle ? this.moving : 1
    this.walk.setEffectiveWeight(ground * gait * (1 - this.blend))
    this.run.setEffectiveWeight(ground * gait * this.blend)
    this.idle?.setEffectiveWeight(ground * (1 - gait))
    this.jump?.setEffectiveWeight(this.air)

    // Each gait has its own reference speed, so the walk can keep up with a brisk
    // pace without the run having to crawl.
    const paced = (reference: number) =>
      grounded
        ? THREE.MathUtils.clamp(speed / reference, DOG.minRate, DOG.maxRate)
        : DOG.airRate
    this.walk.setEffectiveTimeScale(paced(DOG.walkStride))
    this.run.setEffectiveTimeScale(paced(DOG.runStride))
    this.mixer.update(dt)
  }
}

interface DogClips {
  walk: THREE.AnimationClip
  run: THREE.AnimationClip
  /** Optional: an export without it simply falls back to the gait clips. */
  jump: THREE.AnimationClip | null
  /** One held frame of the standing pose, sliced from the head of the jump. */
  idle: THREE.AnimationClip | null
}

/** Everything the animator needs to know about a runner this frame. */
export interface DogState {
  /** Horizontal ground speed. */
  speed: number
  grounded: boolean
  verticalSpeed: number
  /** 0 while standing, rising to 1 across the jump crouch. */
  windup: number
  /** Holding the sprint key. Chooses the gait; speed only sets its tempo. */
  sprinting: boolean
  /** 0 free, rising to 1 the longer the runner is jammed against geometry. */
  blocked: number
}

export interface JumpPhase {
  takeoff: number
  apex: number
  land: number
}

/**
 * Find the airborne window inside the jump clip by watching the lowest skinned
 * vertex, which is whichever paw is nearest the floor.
 *
 * Measuring this from the asset rather than hard-coding it means re-exporting the
 * animation can never leave the runtime scrubbing to stale timestamps — and the
 * numbers are subtly time-base dependent, so a figure copied out of Blender does
 * not necessarily agree with what three.js ends up with.
 */
function measureJumpPhase(root: THREE.Object3D, clip: THREE.AnimationClip): JumpPhase | null {
  let body: THREE.SkinnedMesh | null = null
  root.traverse((node) => {
    if (!(node instanceof THREE.SkinnedMesh)) return
    const count = node.geometry.attributes.position.count
    if (!body || count > body.geometry.attributes.position.count) body = node
  })
  const mesh = body as THREE.SkinnedMesh | null
  if (!mesh) return null

  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.play()
  action.paused = true

  const vertices = mesh.geometry.attributes.position.count
  // Every eighth vertex is plenty to find the lowest point of a paw.
  const stride = Math.max(1, Math.floor(vertices / 900))
  const probe = new THREE.Vector3()
  const SAMPLES = 120
  const lows: number[] = []
  for (let i = 0; i < SAMPLES; i += 1) {
    action.time = (i / (SAMPLES - 1)) * clip.duration
    mixer.update(0)
    root.updateMatrixWorld(true)
    let low = Infinity
    for (let v = 0; v < vertices; v += stride) {
      mesh.getVertexPosition(v, probe)
      mesh.localToWorld(probe)
      if (probe.y < low) low = probe.y
    }
    lows.push(low)
  }
  action.stop()
  mixer.uncacheClip(clip)

  // The clip opens standing, dips through an anticipation crouch that goes BELOW
  // the planted paws, then lifts. So the reference is the opening pose, never the
  // minimum — and the first rise past it is the actual take-off.
  const standing = lows[0]
  const peak = Math.max(...lows)
  if (peak - standing < 0.05) return null
  const threshold = standing + (peak - standing) * 0.05

  const at = (i: number) => (i / (SAMPLES - 1)) * clip.duration
  const above = lows.map((y, i) => (y > threshold ? i : -1)).filter((i) => i >= 0)
  if (above.length < 3) return null
  return {
    takeoff: at(above[0]),
    apex: at(lows.indexOf(peak)),
    land: at(above[above.length - 1]),
  }
}

/** The shared, loaded-once source model. */
export class DogModel {
  private constructor(
    private readonly model: THREE.Object3D,
    private readonly clips: DogClips,
    readonly jumpPhase: JumpPhase,
  ) {}

  /** Resolves to null if the model is missing or unusable — the ball is the fallback. */
  static async load(): Promise<DogModel | null> {
    try {
      const loader = new GLTFLoader()
      const [gltf, runGltf] = await Promise.all([
        loader.loadAsync(DOG.url),
        // Skeleton-only companion file; its clip binds by bone name.
        loader.loadAsync(DOG.runUrl).catch((err) => {
          console.warn('[dog] run clip failed to load', err)
          return null
        }),
      ])
      const clipsFound = [...gltf.animations, ...(runGltf?.animations ?? [])]
      const walk = THREE.AnimationClip.findByName(clipsFound, 'Walk')
      const run = THREE.AnimationClip.findByName(clipsFound, 'Run')
      const jump = THREE.AnimationClip.findByName(clipsFound, 'Jump') ?? null
      if (!walk || !run) {
        console.warn('[dog] expected Walk and Run clips, found', clipsFound.map((c) => c.name))
        return null
      }

      // Normalise: the source is Z-up metres at whatever size it was sculpted, and
      // the physics body is a ball of a fixed radius sitting on the ground.
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const size = new THREE.Vector3()
      box.getSize(size)
      const scale = DOG.targetHeight / Math.max(1e-3, size.y)
      model.scale.setScalar(scale)
      // Drop it so the paws meet the floor rather than the body centre.
      model.position.y = -box.min.y * scale - DOG.groundOffset
      model.rotation.y = DOG.yawOffset

      // The jump clip opens on a clean standing pose, which is the only neutral
      // pose in the set — slice one frame off it and hold that as the idle.
      const idle = jump ? THREE.AnimationUtils.subclip(jump, 'Idle', 0, 1, 24) : null

      const measured = jump ? measureJumpPhase(model, jump) : null
      const phase = measured ?? DOG.jumpPhase

      if (import.meta.env.DEV) {
        console.info('[dog] source size', size.toArray().map((n) => +n.toFixed(2)),
          '-> scale', scale.toFixed(3), '| clips', clipsFound.map((c) => `${c.name} ${c.duration.toFixed(2)}s`))
        console.info('[dog] jump phase', measured ? 'measured' : 'FALLBACK from config',
          Object.fromEntries(Object.entries(phase).map(([k, v]) => [k, +v.toFixed(3)])))
      }
      return new DogModel(model, { walk, run, jump, idle }, phase)
    } catch (err) {
      console.warn('[dog] model failed to load, falling back to the ball', err)
      return null
    }
  }

  instance(tint: number): DogInstance {
    return new DogInstance(this.model, this.clips, tint, this.jumpPhase)
  }
}
