/**
 * Every tunable number in the prototype. Keeping them in one place makes the
 * "feel" pass (which is most of the work on a game like this) a single-file job.
 */

export const PHYSICS = {
  /** Fixed simulation step. The server would run this exact rate in multiplayer. */
  fixedDt: 1 / 60,
  maxStepsPerFrame: 5,
  /** Roughly CS 1.6's 800 u/s², converted at 1 unit ≈ 2.54 cm. */
  gravity: -20,
}

export const RUNNER = {
  radius: 0.55,
  mass: 1.1,
  linearDamping: 0.35,
  angularDamping: 0.9,
  friction: 0.85,
  /** The ball reads as a ball: it kicks off walls and off every trap. */
  restitution: 0.32,
  /**
   * Fraction of a landing's rebound that is kept, 0 absorbing it entirely.
   *
   * `restitution` is wanted for being thrown about by the machines, but it also
   * applies to the floor, and a body that bounces every time it lands is the
   * wrong one for a course made of one-metre tiles: a full jump rebounds at
   * 1.4 m/s and a long fall at 3.0, each followed by a second smaller hop, and
   * all of it puts you down somewhere you did not aim at.
   *
   * Only a rebound consistent with a bounce is absorbed — no faster than
   * `restitution` times the impact — so a trap that hits you upward still does.
   */
  landingBounce: 0,

  /**
   * Movement is scaled to Counter-Strike 1.6: ~250 u/s ≈ 6.4 m/s on the ground.
   * The acceleration clamp means the speed actually reached settles a little
   * under `maxGroundSpeed`.
   *
   * It was briefly slowed to match the walk cycle, which implies only about
   * 0.5 m/s. That made the dog read correctly and the game read as a crawl, so
   * the speed came back and the walk clip came out of locomotion instead.
   */
  groundAccel: 34,
  /** Far weaker in the air — you commit to a jump when you leave the ground. */
  airAccel: 14,
  maxGroundSpeed: 7.4,
  maxAirSpeed: 7.8,
  /**
   * Deceleration when you are on the ground asking for nothing. Without it a ball
   * coasts, and you cannot stop on a tile you meant to stop on.
   */
  groundFriction: 12,

  /**
   * Hold Shift to sprint. The base speed stays the careful one — this is what you
   * spend on the open stretches, and the pool is deliberately separate from the
   * glide's so the two are separate decisions rather than one budget.
   *
   * Sprinting into a precision section is a mistake, not a shortcut: it roughly
   * doubles your jump range, which overshoots a 2.8 m stepping stone.
   */
  sprint: {
    maxSpeed: 10,
    accel: 46,
    drainPerSecond: 26,
    refillPerSecond: 18,
    /** Hysteresis: once drained it stays off until this far recovered, so an
     *  empty pool cannot stutter on and off a few times a second. */
    minToEngage: 18,
  },

  /** ~1.75 m of air — a touch above CS's 44-unit jump, for room to correct. */
  jumpSpeed: 8.4,
  /**
   * The dog crouches and pushes before it leaves the ground, so the jump waits
   * this long between the key press and the impulse, and the anticipation plays
   * in that window.
   *
   * The authored crouch runs 0.625 s, so that value plays it at its true speed;
   * anything less compresses it. This is a real cost to responsiveness, and 0
   * restores an instantaneous jump with the clip starting at the push-off.
   */
  jumpWindup: 0.2,

  /** Grace window after leaving a ledge where a jump still counts. */
  coyoteTime: 0.14,
  /** Jump pressed slightly before landing still fires when you get there. */
  jumpBuffer: 0.16,
  /** How far below the ball still counts as standing on something. */
  groundProbe: 0.22,
  /**
   * Ignore the ground for this long after launching. A jump only lifts the ball
   * ~0.19 m in the first tick, which is still inside the probe's reach — without
   * a lockout the very next tick sees floor, re-arms, and fires again.
   */
  jumpLockout: 0.12,
  /**
   * Off: every jump costs a separate key press, no bunny-hopping. Holding jump
   * still glides, it just will not re-fire on landing. The press latch, coyote
   * time and input buffer are what make that reliable rather than fussy.
   */
  holdToJump: false,

  /**
   * Tail glide — the signature move, and at these speeds the precision tool: it
   * buys you time in the air to line up a landing you would otherwise miss.
   */
  glide: {
    gravityScale: 0.3,
    maxFallSpeed: 2.8,
    /** Forward push, so gliding is a traversal tool and not just a slow fall. */
    forwardForce: 7,
    drainPerSecond: 30,
    refillPerSecond: 24,
    /** Won't engage until you have been falling a moment — avoids eating jumps. */
    minFallSpeed: -0.6,
  },

  /** Per-second velocity retention once a runner has crossed the line. */
  /**
   * Ground the runner must gain along the direction it is asking for before it
   * counts as unstuck. A standing start covers this in about 0.13 s, well inside
   * DOG.scrabbleAfter, so setting off does not read as scrabbling.
   */
  stallAdvance: 0.3,

  finishBraking: 0.02,

  killY: -22,
  respawnDelay: 0.9,
  /** Brief invulnerable-ish float so you can see where you landed. */
  respawnSettle: 0.25,
}

export const TRAPS = {
  /**
   * Traps fire themselves. Every re-arm rolls a fresh delay inside
   * `autoInterval * [jitterMin, jitterMax]`, so a second run down the same
   * corridor never has the rhythm you just learned.
   */
  jitterMin: 0.5,
  jitterMax: 1.9,
  /** A trap only springs if a runner is within this many metres of it. */
  triggerRange: 44,
}

/**
 * Third-person chase cam modelled on Counter-Strike 1.6's `thirdperson`: the view
 * angles are the mouse, one to one, with no smoothing, acceleration or lookAt lag.
 * The camera simply sits a fixed distance back along the view vector.
 */
export const CAMERA = {
  /** Metres the camera trails behind the ball along the view vector. */
  distance: 7.6,
  /**
   * Height of the point the camera orbits, above the ball's centre. Not framing:
   * it puts the pivot at 1.6 m off the ground, which is CS 1.6's eye height, and
   * it is what keeps the boom out of the floor when you look up.
   */
  height: 1.05,
  /**
   * Position smoothing, in units of 1/second. **0 means rigid** — the camera is
   * simply bolted to the orbit point, which is what CS 1.6's third person does.
   * Rotation is never smoothed either way.
   *
   * Rigid is the chosen feel, not a default waiting to be improved: a damped
   * version (a spring arm at rate 18, with the pivot raised to 1.5) was built,
   * played and rejected for looking like a directed chase cam. Anything above 0
   * brings that lag back.
   */
  followRate: 0,
  /**
   * Keeps the camera out of walls: pulled in if the boom is blocked. Also sets how
   * far off the floor the camera ends up at full look-up, since the boom is
   * grounded there — roughly `collisionPadding * sin(pitch)`.
   */
  collisionPadding: 0.7,
  /** Never pull closer than this, or a glance upward jams the lens into the ball. */
  minDistance: 2.6,

  /** CS-style: radians per mouse count = sensitivity * yawPerCount (degrees).
   *  2.5 is Counter-Strike's own default, and it is deliberately slow. */
  sensitivity: 2.5,
  yawPerCount: 0.022,
  pitchPerCount: 0.022,
  invertY: false,
  /**
   * Asymmetric, unlike a first-person game: looking far up in third person swings
   * the boom into the floor, so up is limited while down stays generous.
   */
  pitchMin: -0.45,
  pitchMax: 1.3,
  /** Slightly nose-down at rest so you can read the platforms ahead. */
  pitchStart: 0.3,

  /** ~89° horizontal at 16:9, matching CS 1.6's default. */
  fov: 65,
}

export const RACE = {
  countdownSeconds: 3.2,
  /**
   * Bot racers to spawn alongside you. 0 = solo run, which is the current POC.
   * Raise it and the pack, the race-order board and finish placings all come back:
   * the steering brain in `entities/AiBrain.ts` is unchanged and still exercised.
   */
  aiCount: 5,
  /** Spread across the start pad. */
  startSpacing: 2.4,
}

export const AI = {
  /** Per-bot multipliers are randomised inside these bounds at spawn. */
  skillMin: 0.78,
  skillMax: 1.0,
  /**
   * How far ahead the bot probes for a hole in the floor. Kept short: braking is
   * near-instant, and probing far ahead makes the bot launch well before the edge
   * and come up short on the far side. The wind-up adds `speed * jumpWindup` on
   * top of this, which is most of the lead the bot actually needs.
   */
  gapProbeDistance: 0.8,
  gapProbeDepth: 3.2,
  /** Tolerance before a bot decides it is running at the wrong speed to jump. */
  approachTolerance: 1.18,
  brakeThrottle: 0.9,
  /** Lateral wander so the pack does not travel as one line. */
  wanderAmplitude: 2.6,
  wanderSpeed: 0.35,
  /** Bots that stop moving for this long assume they are stuck and jump. */
  stuckTime: 0.8,
  lookaheadNodes: 2,
}

/**
 * The Shiba model, exported from the Blender rig to `public/models/shiba.glb`
 * (skinned mesh decimated to ~18k verts, with the expressive walk and the
 * energetic run baked as clips named `Walk` and `Run`).
 *
 * The physics body stays a ball — a sphere is the right collider for a racer that
 * gets launched by traps, and swapping it for a capsule would change the feel for
 * nothing. The dog is purely what you see on top of it.
 */
export const DOG = {
  url: 'models/shiba.glb',
  /**
   * The run ships separately because every clip has to be exported from the blend
   * it was authored in — retargeting an IK-driven action into another rig exports
   * a dog with a correct body arc and frozen legs. This file is skeleton-only
   * (55 kB); three.js binds its clip onto the main model by bone name.
   */
  runUrl: 'models/shiba-run.glb',
  /** Metres from paw to ear tip once scaled, matched to the ball it replaces. */
  targetHeight: 1.5,
  /** Lifts the paws off the physics centre so they meet the floor, not sink in. */
  groundOffset: 0.52,
  /** The rig travels along -Y in Blender, which lands on +Z once converted. */
  yawOffset: 0,

  /**
   * Below this ground speed the dog stands still. Without it the gait blend
   * bottoms out at "walk, very slowly" and a stationary dog walks on the spot.
   */
  idleAt: 0.45,
  /** Ground speed above which the dog is definitely moving rather than idling. */
  walkAt: 1.4,
  /** How fast the idle/locomotion crossfade chases its target, per second. */
  blendRate: 6,

  /**
   * Locomotion runs, at every speed. The walk cycle covers about 0.5 m per second
   * at its authored rate against a game that travels 6.4, and no playback rate
   * makes a walk look like it is moving that fast — it just skates. A gallop at a
   * brisk rate carries the speed convincingly, so the walk clip is exported and
   * loaded but kept out of locomotion. Set this true to blend it back in under
   * the sprint key.
   */
  useWalkClip: false,

  /**
   * Ground speed at which each clip plays at its authored tempo.
   *
   * These are not the animations' true stride speeds — measured off the exported
   * clips, the walk implies about 0.5 m/s and the run 0.76 m/s at their authored
   * rate, against a game that moves at 6.4. Some foot sliding is structural at
   * these speeds; these values trade it against how frantic the legs look.
   */
  walkStride: 2.1,
  runStride: 4.0,
  minRate: 0.5,
  maxRate: 2.4,
  /** Airborne: no ground to stride against, so hold a slow cycle. */
  airRate: 0.55,

  /**
   * Fallback only. The runtime measures these off the loaded GLB itself (see
   * `measureJumpPhase`), so re-exporting the animation cannot leave the game
   * scrubbing to stale timestamps. These values are what that measurement
   * produced for the current model, and are used only if it fails.
   *
   * The clip is a whole jump — stand, crouch, push, flight, land, recover — but
   * the game's jump is instantaneous, so there is no anticipation to show. Only
   * the flight window is used, and it is driven by the runner's actual vertical
   * velocity rather than a timer: launch maps to `takeoff`, the top of the arc to
   * `apex`, and coming down at launch speed to `land`. That stays in sync however
   * high the jump, however long the glide, and whatever a trap does to you.
   */
  jumpPhase: { takeoff: 0.625, apex: 0.917, land: 1.167 },
  /** How fast the airborne crossfade engages on take-off, per second. */
  airBlendRate: 14,
  /** Slower on landing, so the clip's compression is briefly visible. */
  landBlendRate: 6,

  /**
   * How fast the anticipation is played during the wind-up. The authored crouch
   * runs 0.625 s, which is far too long to stand still for, so it is compressed
   * into `RUNNER.jumpWindup` and shown at whatever rate that implies.
   */
  /** Seconds the landing squash stays weighted in before blending back to the gait. */
  landPlayout: 0.2,

  /**
   * A long fall should not be one held pose. Past this much air time the legs
   * start paddling: the jump clip's flight window is swept back and forth instead
   * of being pinned by vertical velocity, which reuses the authored frames to get
   * a dog scrabbling at the air on the way down.
   */
  /**
   * Running into a step.
   *
   * Pressed against geometry the dog used to keep striding on the spot, which
   * reads as a bug. `scrabbleAfter` is how long it must be stalled before the
   * legs start clawing at the obstacle, by sweeping the gather-and-reach window
   * of the jump clip.
   */
  /**
   * Standing on a slope.
   *
   * The runner is a ball, so physics has no opinion about which way up the animal
   * on top of it is — left alone it stays world-upright on a ramp, with the
   * downhill paws buried and the uphill ones in the air. The mesh is tilted to
   * the face underfoot instead. `slopeAlignRate` eases it, because stepping off a
   * ramp is a hard change of normal, and `slopeMaxTilt` is the ceiling: a probe
   * that catches a wall or the lip of a step should not lay the dog on its side.
   */
  slopeAlignRate: 9,
  slopeMaxTilt: 0.72,

  scrabbleAfter: 0.25,
  scrabbleRate: 3.4,
  scrabbleWeight: 0.6,
  scrabbleBlend: 10,

  landWeight: 0.75,
  /** Coat colour the export already has; runners matching it are left alone. */
  baseTint: 0xffffff,
}

/**
 * Draw distance. The Grinder is 668 m of corridor, and without fog the far end is
 * still submitting draw calls that resolve to a few pixels of haze.
 *
 * The fog and the far plane are set together on purpose: fog that ends past the
 * far plane leaves geometry popping out of nothing, and a far plane past the fog
 * is just wasted work. The sky sphere is sized from the far plane for the same
 * reason — put it outside and it gets clipped away entirely.
 */
export const VIEW = {
  /**
   * Where the haze begins and where it finishes.
   *
   * `THREE.Fog` is named for the class, not for the curve. Three evaluates it as
   * `smoothstep(near, far, depth)`, which eases in at `near` and eases out at
   * `far` with zero slope at both ends, so nothing changes abruptly as an object
   * crosses either one.
   *
   * It is used here in preference to `FogExp2` for the one property the
   * exponential does not have: it reaches *exactly* opaque, at a distance we
   * pick. The exponential only ever approaches opaque, so its far plane has to
   * sit out in the tail. Saturating at 30 m is what lets the far plane sit at 34
   * — on The Grinder that is 34 m of a 668 m course being drawn.
   */
  fogNear: 2,
  fogFar: 50,
  /**
   * The clip. It sits on `fogFar` rather than past it: smoothstep reaches
   * exactly opaque at `fogFar`, so the last metre before the clip is already
   * fully fogged and there is nothing left to see being cut.
   */
  cameraFar: 50,
  /**
   * Fraction of the far plane the sky sphere sits at. It travels with the camera
   * — see Renderer.render — so this is a radius around the player, not a dome
   * over the start line. Anything drawn between it and the clip is within a
   * percent of fully fogged, which is the same colour the sky's own horizon band
   * is set to, so the overlap is invisible either way.
   */
  skyRadius: 0.92,
}

export const FX = {
  atlas: 'textures/particle-atlas.png',
  smokeCapacity: 520,
  fireCapacity: 340,
  /**
   * Metres past which a trap stops emitting.
   *
   * Parked on VIEW.fogFar, where the fog is fully opaque, so the cut can never
   * be seen. It used to also have to clear TRAPS.triggerRange plus
   * CAMERA.distance, or a trap the player walked into could be cut off while
   * still on screen; the fog now closes well inside that and settles it alone.
   */
  emitRange: 50,
  /** Point size in pixels at one metre; gl_PointSize divides this by depth. */
  pointScale: 340,
  /** Hard ceiling on a sprite's size in pixels — overdraw insurance. */
  maxPointSize: 220,
  /** Metres from the eye a particle is fully faded out by. */
  nearFade: 0.9,

  smokeDrag: 0.7,
  /** Fraction of its own size a puff grows per second. */
  smokeDiffusion: 0.85,
  /** Lift per metre of size — a puff accelerates upward as it spreads. */
  smokeBuoyancy: 0.5,
  fireDrag: 2.2,
  fireGravity: -5,

  /** Particles per impact. */
  impactSmoke: 10,
  impactSparks: 14,
  dustTint: 0x9aa6bb,

  /** Gale: wisps per second, and how fast they leave the blades. */
  fanRate: 46,
  fanSpeed: 15,
  fanTint: 0xbfe8ff,
  /** Ram and spike vent a little steam as they extend. */
  ventRate: 30,
}

export const SUN = {
  /**
   * The sun is deliberately perpendicular to the course — no component along +Z.
   *
   * That makes shadows a position readout rather than decoration: a hammer's
   * shadow lands at the hammer's own Z, so you can see which slice of the
   * corridor it is about to sweep, and a crusher's shadow slides in toward the
   * exact tile it is going to hit. Angle the sun down the course and every
   * shadow is displaced along the one axis you need to read.
   */
  offset: { x: 38, y: 23, z: 0 },

  /**
   * Key light. A sun this low in the sky is a warm one, so the colour follows
   * the angle rather than fighting it.
   */
  color: 0xffd9a8,
  intensity: 2.1,
  /**
   * Fill. The sky half is tied to the colour the fog resolves to, because that
   * is what is actually above the course — leave it a different blue and lit
   * surfaces disagree with the background they sit against.
   */
  ambientSky: 0x8ea4c8,
  ambientGround: 0x3d4a63,
  ambientIntensity: 1.5,
  exposure: 1.18,

  mapSize: 2048,
  /** Half-extent of the shadow frustum along the course. */
  extentAlongCourse: 46,
  /** Half-extent across the course, which also has to cover trap height. */
  extentAcross: 26,
  near: 1,
  far: 160,
  /**
   * Shadows are cast by back faces only, so the depth stored is the far surface
   * of the occluder and self-shadow acne cannot happen. That is what lets the
   * bias be zero — and a zero bias is what keeps shadows attached and solid
   * instead of detached, hollow outlines.
   */
  bias: 0,
  normalBias: 0,
  /** The course is essentially flat, so pinning this stops vertical shadow swim. */
  focusHeight: 2,
}

/**
 * Post-processing.
 *
 * On, and the chain is the shipped look. Turning `enabled` off is genuinely off
 * rather than a bypass: the scene draws straight to the canvas, which is also
 * the only path that gets the free MSAA `antialias: true` takes from the default
 * framebuffer. Nothing drawn through an EffectComposer ever reaches that
 * framebuffer, so inside post the anti-aliasing has to be asked for by hand —
 * hence `samples`. Tone mapping likewise moves from per-material to a final
 * pass, and three mixes scene fog before it there rather than after, so the same
 * fog colour lands a little differently between the two paths; `SUN.exposure` is
 * the dial if it matters.
 */
export const POST = {
  enabled: true,
  /** MSAA samples on the composer's target. 0 turns anti-aliasing off entirely. */
  samples: 2,
  /**
   * Fraction of the drawing buffer every pass runs at, the final upscale to the
   * canvas included. Scales the render pass, the occlusion prepass and the bloom
   * mips together; cost goes with the square.
   */
  resolutionScale: 0.75,

  /**
   * Bloom. The palette is full of things built to glow — trap markers,
   * checkpoint rings, the gale volume, the spike's warning decal. The threshold
   * is high on purpose: those are unlit basic materials at full colour, and at
   * 0.72 the gale's volume takes over the screen.
   */
  bloom: { enabled: true, strength: 0.22, radius: 0.4, threshold: 0.85 },

  /**
   * Ground-truth ambient occlusion. On, and it has to be paid for honestly: the
   * earlier note that it cost more than the whole rest of the frame was measured
   * under SwiftShader, Chromium's software rasteriser, which charges CPU prices
   * per fragment and says nothing about a GPU. What it did cost is largely gone
   * — see `reuseDepth` and `denoiseSamples` below, which between them delete a
   * whole scene render and halve the denoise. If a weak machine still cannot
   * hold a frame, `resolutionScale` is the dial before `enabled` is. Radius is
   * in world units — three's default of 0.35 is sized for props on a desk, not
   * metre-scale boxes. `debugOutput` is GTAOPass.OUTPUT: -1 off, 0 the
   * normal composited image, 1 diffuse only, 2 depth, 3 normals, 4 raw AO,
   * 5 denoised AO.
   */
  ao: {
    enabled: true,
    radius: 1.2,
    distanceExponent: 1,
    thickness: 1,
    scale: 1,
    samples: 8,
    resolutionScale: 0.5,
    blend: 0.9,
    debugOutput: 0,

    /**
     * Read depth from the render pass instead of drawing the scene a second time.
     *
     * GTAOPass ships expecting to own its G-buffer: every frame it re-renders
     * the whole scene with a normal material to get normals and depth, which is
     * a full geometry pass in aid of a screen-space effect. The composer's
     * target already holds that depth, so handing it over deletes the pass
     * outright and the shader reconstructs normals from depth instead. They come
     * out softer, and they are reconstructed at the AO resolution rather than the
     * chain's, so a hard crease can shimmer; that is the price of one whole
     * scene render per frame, and on any real GPU it is worth paying.
     */
    reuseDepth: true,
    /**
     * Poisson denoise taps over the raw AO, and the rings they spiral into.
     *
     * three defaults to 16, which costs more per pixel than the AO it is
     * cleaning up — at `samples: 8` the AO pass itself is nine taps. Nothing in
     * the pass surfaces this, so it was quietly the most expensive thing in the
     * chain. 8 keeps most of the smoothing for half the bandwidth; go to 4
     * before you start cutting `samples`.
     */
    denoiseSamples: 8,
    denoiseRings: 2,
  },
}

/** Small pieces of on-screen furniture that are not the HUD proper. */
export const UI = {
  /**
   * Cap on the device pixel ratio. 2 is how the game has always drawn: on a
   * high-density display that is twice the CSS resolution in each axis, four
   * times the pixels of 1, with MSAA paid on every one. It is the single
   * largest performance lever in the renderer; 1 is the first thing to try on
   * a machine that struggles, and costs only sharpness.
   */
  pixelRatio: 2,

  /**
   * Multisampling on the canvas. The right anti-aliasing for hard-edged boxes,
   * and the only one here, but it is paid on every pixel: on a weak GPU it is
   * the second thing to turn off after `pixelRatio`. Read when the renderer is
   * made, so it needs a reload.
   */
  antialias: true,

  /** Frame counter in the corner: average and worst frame of the last window. */
  showFps: true,
  /** Averaging window in milliseconds. Shorter is twitchier, longer is steadier. */
  fpsWindow: 500,
}

export const COLORS = {
  player: 0xff9f43,
  ai: [0xd1aa1f, 0xc511b6, 0x4aa3f0, 0x9fd356, 0xd45d79, 0x7b6cf6, 0xf0c419],
  platform: 0x4d566c,
  platformEdge: 0x646e87,
  safe: 0x3c7a60,
  hazard: 0xa2453f,
  moving: 0x5a6b95,
  sky: 0x1c2740,
  horizon: 0x486287,
  fog: 0x516081,
}

export const DOG_NAMES = [
  'Mochi', 'Kuma', 'Yuzu', 'Hachi', 'Ramen', 'Taiko',
  'Nori', 'Sora', 'Kiba', 'Momo', 'Daifuku', 'Shio',
] as const

// ---------------------------------------------------------------------------

/**
 * Everything the in-browser tuner may edit, under the names it shows.
 *
 * These are the same objects the game reads, not copies: a value changed here is
 * live everywhere it is read per tick. What is read once — a collider's mass, a
 * material's colour, the size of a buffer — needs a reload, and the tuner says so
 * rather than pretending otherwise.
 */
export const TUNABLES = { PHYSICS, RUNNER, TRAPS, CAMERA, RACE, AI, DOG, VIEW, FX, POST, SUN, UI, COLORS }

export type Tunables = typeof TUNABLES

/** A pristine copy, taken before anything saved is applied. */
export const DEFAULTS: Tunables = structuredClone(TUNABLES)

export const TUNING_KEY = 'ibaShinu.tuning'

type Plain = Record<string, unknown>

function merge(target: Plain, patch: Plain): void {
  for (const [key, next] of Object.entries(patch)) {
    if (!(key in target)) continue
    const current = target[key]
    if (Array.isArray(current) && Array.isArray(next)) {
      target[key] = next.slice()
    } else if (current !== null && typeof current === 'object' && next !== null && typeof next === 'object') {
      merge(current as Plain, next as Plain)
    } else if (typeof current === typeof next) {
      target[key] = next
    }
  }
}

/** Fold a saved patch into the live blocks. Unknown or mistyped keys are dropped. */
export function applyTuning(patch: unknown): void {
  if (patch && typeof patch === 'object') merge(TUNABLES as unknown as Plain, patch as Plain)
}

function diff(live: Plain, base: Plain): Plain | null {
  const out: Plain = {}
  for (const [key, value] of Object.entries(live)) {
    const was = base[key]
    if (Array.isArray(value) && Array.isArray(was)) {
      if (value.length !== was.length || value.some((v, i) => v !== was[i])) out[key] = value.slice()
    } else if (value !== null && typeof value === 'object') {
      const nested = diff(value as Plain, (was ?? {}) as Plain)
      if (nested) out[key] = nested
    } else if (value !== was) {
      out[key] = value
    }
  }
  return Object.keys(out).length ? out : null
}

/** The smallest patch that turns the defaults into what is loaded right now. */
export function collectTuning(): Plain {
  return diff(TUNABLES as unknown as Plain, DEFAULTS as unknown as Plain) ?? {}
}

/** Put every block back to the value it was authored with. */
export function resetTuning(): void {
  merge(TUNABLES as unknown as Plain, structuredClone(DEFAULTS) as unknown as Plain)
}

// Applied here rather than from the entry point. Shaders and materials in other
// modules read these values as they are imported, and by the time an entry point
// runs, every import has already been evaluated — so anything saved would arrive
// a frame too late to have built the scene with.
try {
  const saved = localStorage.getItem(TUNING_KEY)
  if (saved) applyTuning(JSON.parse(saved))
} catch {
  // Private windows and blocked storage both land here. Defaults are fine.
}
