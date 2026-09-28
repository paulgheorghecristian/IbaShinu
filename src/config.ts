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
   * The feint: jump, then press again in the air and the dog turns over
   * backwards and lands where it took off. The take-off is the bait — a
   * saboteur watching for "jumping now" sees a real one — and the return is
   * the bluff, because the dog is back on its own tile while the trap fires at
   * the one it was going to land on.
   *
   * It is asked for with its own input — the jump finger sliding down while
   * held, or `F` on a keyboard — never with a second press, so that a second
   * press can always mean glide and nobody feints by accident reaching for
   * one.
   *
   * Until the ask the jump is a real one — same crouch, same launch, same
   * arc — so how long the bait is held is the player's call. At the ask the
   * forward motion reverses and the dog lands `backStep` metres behind where
   * it took off, having turned one full backflip on the way. It is arcade,
   * not physical: `kick` is the least upward speed it has at the ask, so a
   * flip asked for on the way down pops up first and then drops, and
   * `returnGravity` is the gravity multiplier from the ask until the paws
   * touch, so the drop is a snap rather than a float. `settleTime` is the
   * tail of the return where the arc is no longer corrected, so a residual
   * cannot become a huge last-tick velocity.
   */
  feint: {
    backStep: 1.5,
    kick: 3,
    returnGravity: 2.2,
    settleTime: 0.05,
    /**
     * Seconds after the landing that the mesh keeps its heading regardless of
     * how the body is moving. It lands still going backwards, and the drive
     * takes a moment to turn that round; turning the dog to face the skid
     * read as it landing backwards.
     */
    settleFacing: 0.4,
  },

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
 * Touch: one finger held anywhere runs, sliding it sideways steers, and a
 * second finger presses to jump and holds to glide. That finger sliding down
 * while held is the feint. Read every event, so the tuner can move them live.
 */
export const TOUCH = {
  /**
   * A run finger lifted within this many ms of landing, without having steered,
   * was a tap and not a hold: it jumps, the same as a second finger's tap would.
   * That is the one-thumb grip — hold to run, let go and tap to jump.
   */
  tapMs: 200,
  /** CSS px the run finger has to move sideways before it counts as steering. */
  deadZone: 4,
  /**
   * CSS px the jump finger has to slide *down*, still held, to turn the jump
   * into the flip back. Far enough that a thumb settling after a press does
   * not do it by itself, near enough that it is one short flick.
   */
  swipeDown: 40,
  /**
   * A finger that lands on the ground has pressed a jump, and its slide only
   * counts once it has rested this many ms first — long enough for the jump
   * to have left. One continuous press-and-swipe is a different gesture, and
   * it is only the jump: a finger that moves more than `swipeJitter` px before
   * the rest is up can no longer flip. A finger that lands with the dog
   * already in the air — thrown by a trap, say — can slide at once.
   */
  swipeDelayMs: 250,
  swipeJitter: 12,
  /**
   * CSS px from the touch-down point at which the steer input saturates. A
   * thumb steers with small motions, so this is short: full lock is a nudge.
   */
  steerRange: 18,
  /**
   * CSS px the run finger has to be pushed *up* from where it landed to
   * sprint, and the fraction of that it has to come back down to stop — a
   * little hysteresis, so a thumb resting on the line does not flicker the
   * sprint on and off.
   */
  sprintUp: 28,
  sprintRelease: 0.7,
  /**
   * Seconds the steer takes to settle on where the thumb is — a time constant,
   * so it is most of the way there in about three of these. Short enough not
   * to be felt as lag, long enough that the thumb shifting a few px when the
   * other one taps a jump is a lean rather than a kick.
   */
  steerSmoothing: 0.04,
  /**
   * How much forward drive full lock gives up for sideways. At 0 the dog is
   * driven equally forward and across, a 45° line at most; at 0.45 full lock
   * drives it about 60° off the course line, so a hard steer actually turns.
   */
  steerBias: 0.45,
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

/**
 * Enemy mode: you stop the pack instead of joining it.
 *
 * Every dog is a bot and you are the saboteur, in first person, in a booth that
 * rides the course alongside the leader. The traps are not yours to touch
 * directly — the booth has a console, one button per machine, and a button is
 * fired by looking at it and pressing E. Cooldowns are the whole game: the
 * course has more traps than you can keep lit, so the choice is which one is
 * worth spending on the dog in front of you right now.
 *
 * `TrapSystem` stops firing on its own the moment somebody is manning it, which
 * is what `autoInterval` always meant.
 */
export const ENEMY = {
  /**
   * Wipeouts a runner survives before it is out for good. One: a dog that falls
   * is dead.
   *
   * Runners respawn at their last checkpoint forever in a normal race, so in this
   * mode a wipeout has to be worth something or "stop them finishing" is
   * unwinnable — the clock is on their side and they only have to keep trying.
   *
   * It was three, and three does not survive the arithmetic. Six bots at three
   * lives is eighteen kills, and a course carries ten traps that each realistically
   * fire once as the pack goes past: every single firing would have had to take two
   * dogs with it, while you walked sixty metres between some of the buttons firing
   * nothing at all. At one life the six kills needed are roughly the six best
   * firings you can reach, which is a game. Raise it if the mode ever turns out to
   * be too easy — it is the first dial to reach for.
   */
  lives: 1,

  /**
   * The gallery: a glass-fronted corridor running the whole length of the course.
   *
   * It is the mode's only real constraint. Every trap's button is mounted on the
   * wall beside that trap and nowhere else, so firing one means being level with
   * it, and the pack is moving. You cannot hold the whole course — you pick a
   * stretch, get ahead of them, and spend what is in reach when they arrive.
   *
   * The floor follows the course's own height, sampled at build time, so the
   * gallery climbs when the course climbs and you are always looking across at
   * the racing line rather than down a well or up at a ceiling.
   */
  gallery: {
    /**
     * Centreline offset from the racing line.
     *
     * Set by the widest thing on any course, not by taste: the gauntlet's arena is
     * 19 m across, so the racing line reaches x=9.5, and a gallery whose glass sat
     * inside that would have dogs pressed against the window — and, on the arena,
     * inside the corridor. Glass lands at `x - width/2`, so this clears the widest
     * course by a little over two metres.
     */
    x: 13.5,
    width: 3.2,
    height: 2.8,
    /** Corridor either side of the course proper, so the ends are not cliffs. */
    margin: 12,
    /**
     * How often the course floor is sampled for the gallery's height, and the
     * step that is rounded to before smoothing.
     */
    sampleStep: 2,
    sampleQuantum: 0.5,
    /**
     * Metres a change in height is spread over, which is what makes the gallery
     * ramp instead of step.
     *
     * A step is not a cosmetic problem. The course climbs eight metres in places,
     * and a gallery that climbed it in one jump would put the wall between you
     * and the traps you are meant to be watching — and strand the buttons for
     * them at the top of a face you cannot walk up. Spreading the rise over a run
     * this long keeps the floor walkable and the window level with the action the
     * whole way.
     */
    rampRun: 9,
    /** Slope change, in metres of rise per metre, that starts a new floor segment. */
    slopeTolerance: 0.02,
  },

  /**
   * Walk speed, and it is the balance of the whole mode.
   *
   * Above the dogs' 7.4 m/s ground speed, because the corridor is straight and
   * level and the course is neither — a runner spends its speed on jumps and
   * corners, and the enemy does not. Far enough above to get ahead of the pack
   * if you commit to it; not so far that being everywhere is free.
   */
  moveSpeed: 8.6,
  eyeHeight: 1.62,

  /**
   * How close you have to stand to a button to use it.
   *
   * The reason the mode is about movement. Aiming at a button from thirty metres
   * down the corridor does nothing — you have to be at it, which is what makes
   * choosing one trap mean giving up another.
   */
  reach: 2.8,
  /**
   * Mounted on the window, level with the trap they fire.
   *
   * Height is set against the sightline, not comfort. Eye height is 1.62 and the
   * dogs are a metre below that thirteen metres out, which puts them 4.5° under
   * level — so the button and its backplate have to sit lower than that or they
   * cover the only thing you are watching. At 1.2 with a 1.7x plate the plate's
   * top edge landed at exactly 4.5° and clipped them; 1.1 with a 1.3x plate
   * starts at 11° and leaves them clear.
   */
  button: {
    height: 1.1,
    size: 0.36,
    plate: 1.3,
    /**
     * Four states, and the glow is reserved for two of them:
     *
     *   ready, not looked at   its own colour, unlit — a button, sitting there
     *   looked at              glows
     *   trap running           glows, whether you are still looking or not
     *   cooling                grey
     *
     * Spending the glow on *everything* available was what made the wall unreadable
     * earlier: ten lit squares down a corridor say nothing, because the thing worth
     * knowing is not "these exist" but "this is the one I am about to press, and
     * that one is still recharging". An armed button is legible from its colour
     * alone; the emissive is what marks the two states that are actually events.
     *
     * `lit` is a target *luminance*, not an emissive intensity, and each button
     * solves for the intensity that reaches it.
     *
     * One intensity across eight colours does not give eight equal glows, because
     * luminance is hue-weighted — Rec.709 pays green 0.7152, red 0.2126 and blue
     * 0.0722. At a flat 1.6 the gale and the trapdoor cleared `POST.bloom.threshold`
     * of 0.85 and everything else did not: the wrecker's red landed at 0.525, which
     * is not a dim glow but *no bloom at all*, so it rendered as a flat pastel
     * square next to a yellow that was blazing. Dividing the target by each
     * colour's own luminance is what makes one dial mean one thing.
     *
     * Keep it above the bloom threshold or nothing glows at all; `maxGain` is the
     * ceiling for a colour dark enough that the division runs away.
     */
    glow: { lit: 1.05, idle: 0, maxGain: 6 },
    /** What a button fades to while its trap recharges. */
    coolingColor: 0x39405a,
  },

  /**
   * Degrees off the crosshair a button can be and still count as aimed at.
   *
   * Generous, because a button you are standing next to subtends a wide angle
   * and a tight cone would mean staring straight at a box a metre away instead
   * of watching the dogs you are trying to catch.
   */
  aimCone: 18,
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
   *
   * Which *side* of the course it sits on is a separate question, and the answer
   * is the enemy's. The gallery runs down +X with its window facing back at the
   * racing line, so a sun at +X is behind a solid wall and a roof for the whole
   * mode — the one role that spends the race standing still and looking at the
   * sky never saw it. At -X it comes in through the window. Nothing else cares:
   * the frustum extents are symmetric, so flipping the sign costs the shadow
   * mapping nothing, and perpendicular is perpendicular either way.
   *
   * The elevation is bounded by that window. At 31 degrees the gallery roof cuts
   * the sun off from the back third of the corridor; raise it much further and it
   * is only visible with your nose against the glass.
   */
  offset: { x: -38, y: 23, z: 0 },

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

  /**
   * The sun, as a thing you can see rather than only a direction light comes from.
   *
   * Drawn into the sky shader, in the direction of `offset`, so it sits where the
   * light and the shadows say it should and stays there when you turn. That is
   * worth saying because the game had no sun in it for a long time and looked as
   * though it did: the enemy gallery's glass was briefly a mirror at roughness
   * 0.05, and the specular peak it threw off the directional light bloomed into a
   * convincing white ball. It moved with the head and hung in mid-air, because it
   * was a reflection rather than a sun. This is the real one.
   *
   * It is in the sky sphere, which draws before everything and never writes depth,
   * so the course occludes it for free — no depth work, and nothing to go wrong
   * when a platform passes in front of it.
   */
  disc: {
    /** Angular radius in degrees. The real sun is 0.27; this is a game. */
    size: 1.3,
    /** Degrees of soft edge, so the rim does not crawl from pixel to pixel. */
    softness: 0.8,
    /**
     * Brightness of the disc itself. Above 1 on purpose: the bloom pass only
     * takes pixels over `POST.bloom.threshold`, and a sun that does not bloom
     * reads as a white sticker rather than a light.
     */
    intensity: 7,
    /** The haze around it: how strong, and how tightly it hugs the disc. */
    glow: 0.5,
    glowFalloff: 240,
  },
}

/**
 * Post-processing.
 *
 * On, for the bloom. The AO below is off, which is where the frames went — it is
 * far cheaper than it was but it is still the expensive half of the chain, and
 * the glow is what the palette was built around.
 *
 * Turning `enabled` off is genuinely off and not a bypass: the scene draws
 * straight to the canvas, which costs nothing and is also the only path that gets
 * the free MSAA `antialias: true` takes from the default framebuffer. Nothing drawn through an EffectComposer ever reaches that
 * framebuffer, so inside post the anti-aliasing has to be asked for by hand —
 * hence `samples`. Tone mapping likewise moves from per-material to a final
 * pass, and three mixes scene fog before it there rather than after, so the same
 * fog colour lands a little differently between the two paths; `SUN.exposure` is
 * the dial if it matters.
 *
 * Nothing in the game depends on any of it: the sun is drawn in the sky shader,
 * so it is there whether this is on or off.
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
   * Ground-truth ambient occlusion. Off: it is the expensive half of the chain and
   * frames won.
   *
   * It is a great deal cheaper than it was — `reuseDepth` and `denoiseSamples`
   * below delete a whole scene render and halve the denoise between them, and the
   * old note claiming it cost more than the entire rest of the frame was measured
   * under SwiftShader, Chromium's software rasteriser, which charges CPU prices
   * per fragment and says nothing at all about a GPU. Cheaper is not free, and at
   * `radius: 1.2` on metre-scale boxes it is a subtle effect for the price.
   *
   * Turn it on and `resolutionScale` is the dial before `enabled` is again. Radius
   * is in world units — three's default of 0.35 is sized for props on a desk. `debugOutput` is GTAOPass.OUTPUT: -1 off, 0 the
   * normal composited image, 1 diffuse only, 2 depth, 3 normals, 4 raw AO,
   * 5 denoised AO.
   */
  ao: {
    enabled: false,
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
export const TUNABLES = { PHYSICS, RUNNER, TRAPS, TOUCH, CAMERA, RACE, ENEMY, AI, DOG, VIEW, FX, POST, SUN, UI, COLORS }

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
