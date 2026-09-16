# Iba Shinu

A 3D browser deathrun. Round proto-shibas run a gauntlet of platforms while ten
machines try to make sure they never reach the gate.

This repository is **step one**: a single-player, client-only prototype. No server,
no networking, no accounts. The point is to prove the moving parts that everything
else depends on — a physics feel worth keeping, a course worth running, and traps
worth being afraid of. The rest of the plan is written down in
[Roadmap](#roadmap) so the prototype can be judged against where it is going.

---

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build      # typecheck + production bundle into dist/
npm run typecheck  # types only
npm run preview    # serve the built bundle
```

Requires Node 18+. The physics engine ships as WebAssembly inlined into the bundle,
so there is nothing to host but static files.

### Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Roll, relative to where the camera is pointing |
| Mouse | Look. Click the canvas to capture the pointer, `Esc` to release |
| `Space` | Jump |
| `Space` (held while falling) | **Tail glide** — the signature move. Holding it never re-jumps |
| `Shift` | **Sprint** — burns the Run bar, and roughly doubles your jump range |
| `R` | Restart the run |

Append `?debug` to the URL for a trap bar along the bottom and number keys `1`–`0`
to fire each trap by hand. `window.ibaShinu.debug()` dumps runner, camera and trap
state; `window.ibaShinu.teleport(z)` drops you at a course position.

---

## What is in the prototype

**The runner.** A ball with a physics body, ears and a tail, moving at
Counter-Strike 1.6 speeds: **6.4 m/s** flat out (CS runs ~250 u/s ≈ 6.4) and
**9.2 m/s** sprinting, under gravity of 20 m/s² (CS uses 800 u/s²), with a
**1.59 m** jump apex. A flat jump carries **4.8 m**; the glide stretches it further.

This is a game about being in the right place, not about being fast. Rolling uses a
Quake-style acceleration clamp — you only ever gain speed you do not already have
in the direction you asked for — and letting go of the keys on the ground brakes
you deliberately, because you cannot do precision platforming on a ball that
coasts.

Jumping is deliberately forgiving, because a platformer without that forgiveness
feels broken in ways players cannot name:

- A press is **latched until a simulation tick consumes it**, never cleared per
  rendered frame. A frame can finish without advancing the fixed-step simulation
  at all — on a display faster than 60 Hz most frames do — and clearing the press
  there silently throws it away.
- **Coyote time** (0.14 s): a jump still counts just after you leave a ledge.
- **Input buffer** (0.16 s): a jump pressed just before you land fires on landing.
- **Ground check is five rays**, not one — centre plus four at 62 % of the radius.
  A single centre ray calls you airborne the moment your centre clears an edge,
  which is exactly where you are most likely to be pressing jump.
- **No bunny hopping.** Every jump costs its own key press. Holding jump still
  glides, it just never re-fires on landing. (`RUNNER.holdToJump` flips this.)
- A short **lockout** after launch, because the ball is still inside the ground
  probe's reach on the tick after it jumps.

**Sprint.** Hold Shift and the ball goes from 6.5 m/s to **10 m/s**, drawn from a
Run bar that refills when you let go. The base speed stays the careful one; this is
what you spend on the open stretches. It is not a free upgrade — sprinting roughly
doubles your jump range, which overshoots a 2.8 m stepping stone, so sprinting into
a precision section is a mistake rather than a shortcut. Once the bar empties the
sprint drops out and will not re-engage until it has recovered to 18%, so an empty
pool cannot stutter on and off a few times a second.

Run and Glide are deliberately **separate pools**, shown as separate bars, because
they are separate decisions. One budget would make them trade against each other,
and the interesting choice is when to spend each.

**Moving platforms carry you.** Rapier drags a resting body along a kinematic
platform through friction alone, which at these speeds is far too weak — the
platform slides out from under you while you stand still. So a runner asks what it
is standing on, and if that is a slider it applies the platform's step to itself
directly. Jumping off inherits the platform's velocity, because leaving a moving
floor should launch you from its frame and not the world's.

**The tail glide.** Hold jump while falling and the tail fans into a wing: gravity
drops to a quarter, fall speed clamps, and you get a forward push, drawn from a
stamina bar that refills on the ground. It is a traversal tool and a save, not just
a slow fall — you can clear gaps with it that you cannot clear by jumping.

**Checkpoints** are claimed by passing their Z *while standing on something*. The
contact requirement is not incidental: a runner knocked off the course keeps its
forward speed all the way down, and the fall to the kill plane lasts about a second
and a half — enough to carry it seven or eight metres further along and sail past
the next checkpoint line in mid-air, eleven metres below the floor. It would then
respawn *past* the section it had just failed, which on the bots read as them
being mysteriously good at the beam.

**The courses.** Two of them, in `src/levels`, picked with `?level=<id>`:

| | length | sections | traps | character |
| --- | --- | --- | --- | --- |
| **The Gauntlet** (`gauntlet`) | 228 m | 8 | 10 | Open platforms over a void — you fall off the *sides* |
| **Road of Fear** (`roadoffear`) | 272 m | 10 | 16 | Walled tunnels — the walls hold you in and the *floor* lets you down |
| **The Grinder** (`grinder`) | 668 m | 22 | 68 | Two acts. Everything, twice, with the dials further round |

The first two have six checkpoints, the Grinder fourteen. Fall and you respawn at your last one with a wipeout on
your record. The Gauntlet's sections are below. Road of Fear runs vent tunnel,
offset ledges over a pit, cross bars, an **eight-metre climb** up staggered ledges
to a windswept deck, a wrecker gallery, a sliding crossing, and a crusher
squeeze. The Grinder runs all of that twice over, at its narrowest: a 2.6 m
catwalk with forty-four metres of nothing under it, a ten-tile cascade, twin
cascades, a three-metre ram run, and a walkway eight metres up.

| Section | What it is | Traps |
| --- | --- | --- |
| Start | Wide railed pad | — |
| Wrecker corridor | Open floor, nothing to hide behind | 2 × **Wrecker** |
| Stepping stones | Six 2.8 m tiles staggered over the void, 2 m of air at the nearest corners | 2 × **Trapdoor** |
| The Beam | 3.4 m wide, 28 m long | 2 × **Ram** |
| The Slide | Three platforms on a slow sideways cycle — wait, then step on | — (the platforms *are* the hazard) |
| Arena | Open floor with a bar through the middle | 1 × **Spinner** |
| Crusher hall | Narrow, low ceiling | 2 × **Crusher**, 1 × **Gale** |
| Ramp and podium | Walled, so winners stop where they land | — |

**The traps.** Ten machines, six kinds. They fire themselves: each rolls a fresh
random delay between cycles and only springs when a runner is close enough to be
caught, so the same corridor never has the rhythm you just learned.

Every one of them telegraphs. A trap that cannot be read is a coin flip, and a
deathrun is supposed to be a test of nerve and timing — so the ram draws back into
its housing before it punches, the crusher spends a third of its cycle armed with
the floor decal brightening under it, and a trapdoor flashes before it goes.

| Trap | Behaviour |
| --- | --- |
| **Wrecker** | A weighted arm parked against the wall sweeps the full width three times at floor height, slowly enough to step around |
| **Trapdoor** | A stepping stone flashes, drops out of the world, waits, and comes back |
| **Ram** | A wall piston draws back, punches across the beam, holds, and retracts slowly |
| **Crusher** | A ceiling block arms, warns through a brightening floor decal, then slams the hallway |
| **Spinner** | A 14 m bar idling at walking pace spins up to something you have to time your way past |
| **Gale** | A directed air blast that pushes and lifts anything in its volume |
| **Spike** | A pillar that punches up out of the deck. Every other machine comes at you sideways or from above, so the floor turning hostile is the one thing you cannot dodge by reading the walls |
| **Cascade** | A run of tiles that drops in a wave, one after the next. A single trapdoor asks where you are standing; a cascade asks whether you are still moving |

**The dog.** The runner is a real Shiba Inu, exported from the Blender rigs into
`public/models/` — a skinned mesh with three clips: the expressive **walk**, the
improved **jump**, and the energetic **run**. The coat is the sculpt's own painted
colour attributes exported as vertex colours, so there are no textures at all and
the whole model is 1.4 MB.

It ships as two files. `shiba.glb` carries the mesh, the skeleton, the walk and
the jump; `shiba-run.glb` is 55 kB of skeleton and the run alone, and three.js
binds its clip onto the same bones by name. That split is not tidiness — every
clip has to be exported from the blend it was authored in, for reasons under
[Re-exporting the dog](#re-exporting-the-dog).

The physics body stays a **ball**. A sphere is the right collider for a racer that
gets launched by traps, and swapping it for a capsule would change the feel for
nothing — the dog is purely what you see on top of it. It rides the same group
that used to yaw the placeholder ball's face toward its direction of travel, so it
inherits that turn easing for free.

**Locomotion runs, at every speed**, with the tempo scaled by how fast the ground
is actually moving. The walk clip is exported and loaded but kept out of
locomotion, because it covers only about 0.5 m per second at its authored rate
against a game that travels at 6.4 — no playback rate makes a walk look like it is
moving that fast, it just skates, whereas a gallop at a brisk rate carries the
speed convincingly. `DOG.useWalkClip` blends it back in under the sprint key.

Slowing the game to suit the walk was tried and reverted: matching it properly
needs roughly 2 m/s, which turns a 228 m course into a long stroll. The sliding is
structural, and running is the cheaper lie.

If the model is missing the game falls back to the placeholder ball, which is
still built and simply hidden.

**Standing still means standing still.** The gait blend bottoms out at "walk, very
slowly", so without an explicit idle a stationary dog walks on the spot. Below
`DOG.idleAt` the gaits fade out entirely in favour of a single held frame of the
standing pose, sliced off the head of the jump clip — which is the only neutral
pose in the set.

**The jump waits for the crouch.** A dog gathers itself before it leaves the
ground; a bare parabola starting on the frame you press the key has nothing the
animation can sit on. So the impulse is held back by `RUNNER.jumpWindup` (200 ms)
and the authored anticipation plays in that window. The authored crouch is 0.625 s,
so that value would play it at true speed and anything less compresses it.

This is a real cost to responsiveness, paid deliberately; 0 restores an
instantaneous jump with the clip starting at the push-off. The bots compensate for
it by probing `speed × jumpWindup` further ahead, or they commit to a jump too
late and launch past the edge.

**The rest of the jump is scrubbed, not played.** The authored clip is a whole jump — stand,
crouch, push off, fly, land, recover — but the game's jump is instantaneous: it
sets an upward velocity on a single frame and there is no anticipation to show.
Starting the clip at its beginning on take-off therefore plays the crouch while
you are already in the air, and the two drift apart from there.

Instead the clip is scrubbed against the arc, and the two halves are treated
differently, because the authored hop clears about 0.5 m over 0.41 s of flight
while the game leaps 1.59 m and hangs for 0.84 s:

- **Rising** plays at the clip's authored rate, so the push-off and the tuck keep
  their snap, and then simply waits at the apex for however long the float lasts.
  Scrubbing this half proportionally instead halves its speed, which drains the
  attack out of the animation and makes a punchy jump read as a mushy one.
- **Falling** follows the arc — vertical velocity maps onto apex-to-touchdown — so
  the legs reach out progressively and hit the landing pose on the frame the paws
  actually touch, rather than arriving early and holding.
- **Landing** hands the clip back to normal playback for a moment so the
  compression plays out under the fade back to walking, then parks it.

That stays synchronised however high the jump, however long you glide, and
whatever a trap does to you.

The three timestamps are **measured from the GLB at load** by sampling the lowest
skinned vertex across the clip — whichever paw is nearest the floor — and taking
the window where it lifts clear. Hard-coding them was the obvious approach and the
wrong one: the numbers are subtly time-base dependent, so what Blender reports and
what three.js ends up with are not the same figures, and a re-export would
silently desync the animation. `DOG.jumpPhase` is only the fallback if that
measurement fails.

**The camera.** Third person, with Counter-Strike 1.6 control, and deliberately not
directed. It orbits one point above the ball at a fixed radius — nothing more. View
angles are raw mouse deltas times a sensitivity (CS's own default of 2.5), never
filtered, never eased, never lagged behind a `lookAt` target, and the position is
rigid too, so where the camera ends up is a pure function of where you are and
where you are looking. Field of view is ~89° horizontal, also CS's.

Rigid sounds like it should shake, but a sphere rolling on a plane keeps its centre
at a constant height: measured over 104 frames of flat running, the camera moves
1 cm. It only moves when the ball genuinely does, which is the point. Two things
are not stylistic choices — the boom pulls in when geometry blocks it, and the
pitch clamp is asymmetric, because looking far up in third person swings the boom
into the floor.

**The light.** The sun sits **perpendicular to the course** — elevated and off to
one side, with no component along the running axis. That is a gameplay decision,
not a lighting one: a shadow then lands at its caster's own Z, so a hammer's
shadow marks the exact slice of corridor it is about to sweep, and a crusher's
shadow slides in toward the exact tile it is going to flatten. Angle the sun down
the course instead and every shadow is displaced along the one axis you most need
to read.

For the shadows to be worth reading they have to be solid, so:

- **Only back faces are drawn into the shadow map.** The stored depth is then the
  far surface of each occluder, and a lit surface can never shadow itself.
- **The bias is zero.** Back-face casting is what allows that, and it matters: a
  bias large enough to hide acne is also large enough to detach a shadow from its
  caster and hollow it out. The old `-0.0012` over a 1→260 depth range worked out
  to roughly 0.3 world units of offset.
- **The frustum is tight** — 92 m along the course by 52 m across, near 1, far 160.
  Every metre of frustum is resolution and depth precision spent.
- **The focus is snapped to whole shadow texels** and pinned to a fixed height, so
  the depth map does not resample every frame and make the shadow edges crawl
  while you are standing still trying to read one.

**Atmosphere.** Draw distance is cut by fog rather than by a hard far plane: haze
from **2 m**, fully opaque by **50 m**, with the camera's far plane sitting on the
same 50 m. On a 668 m course that is most of the level never drawn.

`THREE.Fog` is named for the class, not for the curve — three evaluates it as
`smoothstep(near, far, depth)`, easing in at `near` and out at `far` with zero
slope at both, so nothing changes abruptly as an object crosses either one. It is
used here in preference to `FogExp2` for the property the exponential does not
have: it reaches *exactly* opaque at a distance we pick. The exponential only
approaches opaque, so its far plane has to sit out in the tail — the same look
cost 50 m of draw distance instead of 34.

Getting that last part actually true took fixing three things, and none of them
was the fog distance:

- **The sky has to travel with the camera.** It is a sphere a little inside the
  far plane, and it was parked at the world origin — a 72 m bubble around the
  start line on a 668 m course. Run past it and the backdrop becomes the clear
  colour, so scenery emerges from flat black however the fog is set.
- **The sky's gradient has to be read in object space.** Once the sphere follows
  the camera, a gradient taken from the vertex's *world* position folds the
  camera's own position into it: three hundred metres down the course every
  vertex is dominated by its z, and the whole sky collapses onto one band. The
  direction being looked in is the sphere's object-space position, which is
  exactly what a translated sphere leaves unchanged.
- **The sky has to be written in the same colour space as the fog.** `THREE.Color`
  converts a hex into the renderer's linear working space, and a raw
  `ShaderMaterial` writes that straight out; scene fog, meanwhile, is mixed in
  *after* three's colour-space step and lands on screen as its literal hex. The
  sky was rendering about four times too dark, so a fully fogged object was a
  bright slate-blue shape against near-black. Appending `<colorspace_fragment>`
  to the sky shader — and not the tone-mapping chunk, which fog also skips —
  makes the horizon land on exactly the fog colour.

Everything at and below the horizon is therefore exactly the fog colour, and the
gradient is allowed only above it — the course sits at or below the horizon from
any camera you play from, so that is where the backdrop has to match.

Measured with a probe wall on The Grinder, as its worst-channel difference from
the backdrop beside it: at the fog's far distance it is **0/255** looking level and
**0/255** looking down, against 11 before the object-space fix and 54 before the
colour-space one.

Looking *up* it is whatever `COLORS.sky` differs from `COLORS.fog` by, because
that is the one direction the gradient is allowed in. Keep those two within reach
of each other or a distant object seen against open sky is a silhouette again —
it is the same failure as the colour-space bug, just reached through the palette
instead.

Measured on The Grinder, shortening the far plane from 215 m to 78 m took the main
pass from ~370 draw calls to ~290, and it is tighter than that now. It barely touches the triangle count,
which is the more useful finding: **the shadow pass is about half of everything
drawn** — 424k triangles per frame with shadows, 213k without — because the sun's
frustum is sized by `SUN.extentAlongCourse`, not by the camera, so pulling the
view in does not shrink it. The other half is the dogs, at 16k triangles each and
drawn twice. Neither is addressed by draw distance; see Known gaps.

**Smoke and fire.** Traps emit into **two shared pools**, not one system each —
sixty-eight machines would otherwise be sixty-eight draw calls for something that
is idle most of the time. Each pool is a ring buffer behind a single `Points`
cloud: `emit` overwrites the oldest particle when it runs out, so the cost is
fixed however much is going off, and an index list rebuilt each frame keeps the
dead ones out of the rasteriser.

The two exist because one material cannot do two blend modes. Smoke is alpha
blended and **sorted back to front** — unsorted, near puffs punch holes in the
ones behind them — and holds the atlas's soft first frame, tinted per particle.
Fire is additive, needs no sorting, and plays the whole 4x4 flipbook over its
life with **the frames blended into each other**, so a burst reads as burning
down rather than as sixteen stamps. Both borrow the reference engine's trick of
making **buoyancy proportional to size**: a puff spreads as it ages and rises
faster as it spreads.

Two details are not decoration. Particle alpha repeats the fog curve by hand,
because points ignore scene fog and would otherwise glow through the haze. And
`gl_PointSize` is both **capped and faded out near the eye** — a sprite 10 cm
from the camera is otherwise 3000 px across, and a few hundred of those are
enough overdraw to lose the WebGL context outright, which is exactly what
happened the first time.

Where the effects go is a gameplay decision, not a garnish. The **gale** was the
one machine on the course with no tell at all — an invisible shove — so its
stream doubles as the telegraph. The **crusher** throws its dust flat along the
floor rather than mushrooming, because seven metres of block pushes the air
sideways. The **cascade** puffs tile by tile on each tile's own beat, which is
what makes the direction of the wave readable while you are still standing on it.

**Runners are ghosts to each other.** Rapier interaction groups put runners and
world geometry on separate layers: a runner collides with the course and nothing
else, and every ray — ground checks, AI gap probes, the camera boom — filters to
world only. A pack of dogs on one narrow ledge is a race, not a shoving match.

**Post-processing was tried and removed.** GTAO and bloom went in behind an
`EffectComposer`, measured, and came out again: the player asked for the plain
game back, and code that is switched off still has to be carried. What the
attempt established is recorded in the paragraph below, and the one thing worth
keeping from it is the corner frame counter, `UI.showFps`.

**A round of renderer optimisation was tried and reverted.** Static scenery
merged into chunked meshes, all sixty-eight warning rings as one instanced draw,
idle machines and empty particle pools skipping their per-tick work, and the
shadow map redrawn on alternate frames. Draw calls fell by about 30%, measured
exactly — and the game got choppy, and stayed less smooth than before even after
the alternate-frame shadows (the obvious culprit: light and heavy frames
alternating, a heavy one landing past the vsync budget and displaying a whole
interval late) were undone. The testing environment here is a software
rasteriser whose frame times vary by 2× on identical settings, so it can count
draw calls but cannot see smoothness, and the player could. Everything from that
round is gone; the render and simulation path is what it was when it ran at
70–80 fps.

What that episode did establish is worth keeping. The frame counter that arrived
with post-processing showed 70–80 fps "with post off" — measured, it turned out,
at pixel ratio 1, because post-processing's cap of 1 had been applied at load and
a bug stopped it being re-applied when post was switched off. The game has always
drawn at pixel ratio 2, and still does — that is how it ran when it was last
judged smooth, and a faithful revert keeps it. But it is the single largest
performance lever in the project: `UI.pixelRatio: 1` is a quarter of the pixels
on a high-density display and costs only sharpness. `UI.antialias` is the second
lever.

**Landings do not bounce.** `RUNNER.restitution` is there so the machines can
throw you about, but it applies to the floor as much as to a wrecker, and a body
that rebounds off every landing is the wrong one for a course made of one-metre
tiles. Measured: a full jump lands at 8.7 m/s and rebounds at **1.4**, a long fall
at 18.9 and rebounds at **3.0**, each followed by a second smaller hop, and every
one of them puts you down somewhere you did not aim at.

The landing absorbs that, but only when the rebound really is one — it has to
follow a fall, and be no faster than `restitution` times the impact. Anything
above that line came from a machine rather than the floor, so a spike under a
standing runner still launches them at 53 m/s, and horizontal knockback is never
touched at all. Settling after a long fall went from 23 ticks of vertical
twitching to 2, with the jump arc unchanged to the millimetre.

**Standing on slopes.** The runner is a ball, so the physics has no opinion about
which way up the animal riding it should be — left alone the dog stays
world-upright on a ramp, with the downhill paws buried in the surface and the
uphill ones in the air. The ground probe now returns the face it hit as well as
the body, and the mesh is tilted onto that normal.

Three things make it hold up:

- **The height comes out right for free.** Tilting about the body's centre puts
  the paws `DOG.groundOffset` along the normal, and the ball's contact point is
  its radius along the same normal — the 3 cm of clearance flat ground already
  has. No separate height correction.
- **The normal is held through coyote time**, not dropped the first tick the probe
  misses. A ball resting on a ramp loses contact for the odd tick, and treating
  each of those as "airborne, stand up straight" pulled the mesh about two degrees
  off a slope it was plainly sitting on.
- **The tilt is capped** at `DOG.slopeMaxTilt`. A probe that catches a wall or the
  lip of a step reports a near-horizontal normal, and without a ceiling the dog
  lies on its side. Measured: a 20.1° ramp gives 19.6° of lean, and a 70° face
  gives exactly the 41.3° cap.

**Hitting a step.** There is no scrabble animation, but the jump clip has the
frames for one, so it is scrubbed rather than authored: jammed against geometry
the dog used to keep striding on the spot, and now the gather-and-reach window is
swept quickly at 60 % weight so the front legs claw at the obstacle.

The stall test behind it is **ground gained, not speed**. Speed is far too
twitchy: a runner shoved into a step bounces off it, re-accelerates through any
threshold you pick and hits it again several times a second, which flickers the
animation. Distance actually covered in the direction asked for does not care
about the bounce. The anchor resets on real progress and on a turn, and a
standing start covers the 0.3 m inside 0.13 s — comfortably under the 0.25 s it
takes to count as stuck, so setting off never reads as scrabbling.

---

## How it fits together

```
public/models/          the dog: skinned mesh + walk, run and jump clips
public/textures/        the 4x4 fire flipbook the effects sample
tools/export-shiba.sh   re-export it from the Blender sources
src/
  config.ts             every tunable number in the game, in one file
  levels/
    Level.ts            what a level may build, and how it places traps
    gauntlet.ts         the original course
    roadOfFear.ts       the longer, meaner one
    grinder.ts          the long one, and the hardest
    index.ts            the registry, and ?level= selection
  main.ts               the game loop, run state, HUD wiring
  engine/
    Physics.ts          Rapier world + the fixed-timestep accumulator
    Renderer.ts         three.js scene, lights, gradient sky, shadow tracking
    Input.ts            device input, sampled into a per-tick InputFrame
    CameraRig.ts        the CS-style third-person chase cam
  world/
    Course.ts           turns a level into colliders and meshes, and drives what moves
    Materials.ts        shared materials, procedural coat texture
    Particles.ts        the two effect pools every trap emits into
    DogModel.ts         loads the GLB, and gives each runner its own mixer
  entities/
    Runner.ts           a racer: body, mesh, movement, glide, respawn
    AiBrain.ts          steering for bot racers (dormant — see below)
  traps/
    Trap.ts             base class: fire, cooldown, normalised animation phase
    kinds.ts            the eight machines
    TrapSystem.ts       placement, random firing, proximity gating
  ui/Hud.ts             DOM overlay
  ui/Tuner.ts           the in-game tuning panel, on backtick
  ui/FpsMeter.ts        frame cost in the corner, average and worst
  util/ease.ts          easing helpers
```

Three decisions here exist because of where this is going, not because the
prototype needs them:

1. **Gameplay only advances inside a fixed 60 Hz step.** `Physics.step()` drains
   wall-clock time into whole ticks and never lets rendering rate change the
   simulation. An authoritative server runs the identical loop, and prediction and
   rollback are only possible if the client can replay a tick deterministically.
2. **Input is a struct, not a set of key reads.** `Input.sample()` returns an
   `InputFrame` — the exact payload a client would send upstream. `Runner` cannot
   tell whether a frame came from a keyboard, a bot, or a socket.
3. **Every trap is a float and a bool.** A trap is a one-shot animation on a
   cooldown driven by a normalised `phase`. That is a trivially small amount of
   state to replicate, and it means one trap bar can drive ten different machines.

### Adding a level

A level is a data file. It says what goes where and never touches a rigid body, a
cooldown or a material:

```ts
export const myLevel: Level = {
  id: 'mine', name: 'My Course', blurb: 'One line for the title card.',
  build(b) {
    b.pad(0, 8, 15, 16, COLORS.safe)
    b.checkpoint(1, new THREE.Vector3(0, 1.6, 6), 'Start')
    b.route(0, 4)
    b.trap({ kind: 'crusher', z: 40 })
    b.finish(60, new THREE.Vector3(0, 3.6, 63), 2.2)
  },
}
```

Add it to `LEVELS` in `src/levels/index.ts` and it appears on the title card.

Three things to know before laying one out, all learned by watching bots fall:

- **Sections must meet exactly.** A 1 m seam between two pads is invisible on
  screen and eats a runner one respawn at a time. Work in explicit ranges and
  check that each section's far edge is the next one's near edge.
- **Most traps assume a floor at y = 0.** The wrecker's arm and the crusher's
  travel are measured from there, so a raised platform has them sweeping overhead
  or slamming through the deck. The gale is the exception — it takes a `floor`,
  so it can blow across a raised deck.
- **Gaps are sized by the jump**: 4.8 m of air at full speed, about 3.2 m from a
  short run-up on a tile. And a hard left-right zigzag plays much worse than it
  looks, because there is no room to kill one hop's lateral momentum before the
  next.
- **Climbing is a different sum.** A jump reaches 1.59 m, but it is only above
  1.1 m for roughly half a second — about 3.3 m of travel at running pace, and far
  less if you approach slowly. So risers want to be low and closely spaced, and
  the bots deliberately do *not* brake before a climb the way they do before a
  flat gap, because braking for accuracy leaves them short every time.

### Re-exporting the dog

```bash
./tools/export-shiba.sh          # writes shiba.glb and shiba-run.glb
WALK_JUMP_BLEND=… RUN_BLEND=… ./tools/export-shiba.sh
```

The source rig renders with a million-vertex fur coat, guard hairs and ear
fringes, which is wonderful in Cycles and hopeless in a browser. The exporter
drops all of it along with the subsurf and displace modifiers, decimates what is
left from 86k vertices to about 18k, and replaces the procedural Cycles shaders
with flat Principled materials that read the sculpt's painted colour attributes.

Two things about this pipeline are worth knowing, because both failed silently
before they were understood.

**Every clip is exported from the blend it was authored in.** The three blends
share the same 31-bone `Shiba | walk rig`, so appending an action across files
looks like it works — the body arc came out matching the source to within 1%.
The legs do not move at all, because the foreign rig's constraints never solve
them. Hence the split output.

**The solved pose is baked by hand.** The skin is bound to the `DEF_` bones, whose
legs are posed entirely by IK and `COPY_ROTATION` constraints driven from a few
`CTRL_` bones — the walk and jump actions contain no leg channels whatsoever.
glTF has no constraints, and the exporter's "force sampling" samples the *action*,
not the solved pose, so a straight export produces a dog whose body arcs perfectly
and whose legs are frozen solid. The script therefore reads each bone's
constraint-evaluated `pose.bone.matrix` per frame, converts it back to a basis
matrix (`rest_local⁻¹ · parent_pose⁻¹ · pose`), strips the constraints, and keys
the result onto every bone.

It then **measures mean leg articulation per clip and refuses to write a file
below 5°**, because that is precisely the failure that is invisible until someone
plays the game and says the legs look stiff. Current values: walk 33°, jump 60°,
run 71°.

Ubuntu's Blender has no numpy and the glTF exporter needs it, so the shell script
vendors numpy into `tools/.blender-deps` rather than touching the system Python.

### Tuning

Every number lives in [`src/config.ts`](src/config.ts), and **`` ` `` opens a panel
that edits it in the running game**. Anything read per tick — acceleration, jump
speed, trap intervals, the AI's nerve — responds as you drag the slider. Anything
read once, when a collider or a material or a buffer is built, is tagged `reload`
in the panel, because writing it down and pretending it took effect would be
worse than saying so.

Changes are saved to `localStorage` as you make them, and applied by `config.ts`
at import time on the next load — early enough to build the scene with, which an
entry point would not be. `Export` and `Import` move a run of tuning between
browsers or into a commit, and the file holds only what differs from the authored
values, so it reads as a changelist rather than a dump. `Reset all` puts
everything back.

The things most worth touching first:

- `RUNNER.groundAccel` / `maxGroundSpeed` — how heavy the dog feels
- `RUNNER.sprint` — the whole sprint: speed, pool size, drain, re-engage floor
- `DOG.targetHeight` / `groundOffset` — how big the dog is and where its paws sit
- `DOG.idleAt` / `walkAt` — where the dog stops standing and starts moving
- `DOG.runStride` — the speed at which the gait plays at its authored rate
- `DOG.useWalkClip` — `false`; `true` brings the walk back under the sprint key
- `RUNNER.jumpWindup` — the crouch before the jump; 0 makes the jump instantaneous
- `RUNNER.groundFriction` — how hard it stops when you let go
- `RUNNER.restitution` — how much it kicks off walls and traps
- `RUNNER.landingBounce` — `0` absorbs landings entirely; `1` restores the bounce
- `UI.pixelRatio` — resolution; `1` is the biggest single saving there is
- `UI.antialias` — MSAA on the canvas; the second thing to turn off on a weak GPU (reload)
- `UI.showFps` — the corner frame counter
- `SUN.color` / `intensity` / `ambientSky` / `ambientGround` / `exposure` — the whole
  lighting mood, and the one to reach for if post-processing shifts it
- `RUNNER.holdToJump` — `false`; set it `true` if you want bunny hopping back
- `RUNNER.glide` — the whole feel of the signature move
- `CAMERA.sensitivity` — CS 1.6's default of `2.5`
- `CAMERA.followRate` — `0` is a rigid mount; raise it to soften the camera
- `TRAPS.jitterMin` / `jitterMax` — how unpredictable the course is
- `SUN.offset` — keep `z` at 0 or shadows stop telling you where a trap will land
- `VIEW.fogNear` / `fogFar` — where the haze starts and where it is total;
  `cameraFar` only has to clear `fogFar`
- `FX.smokeCapacity` / `fireCapacity` — pool sizes; `?debug` reports live counts
- `FX.fanRate` — how thick the gale reads
- `FX.emitRange` — keep it above `TRAPS.triggerRange` plus `CAMERA.distance`
- `DOG.slopeAlignRate` / `slopeMaxTilt` — how fast the dog leans into a slope, and
  how far it is ever allowed to lean
- `DOG.scrabbleWeight` — how hard the dog claws at a step it cannot climb
- `RUNNER.stallAdvance` — how little progress counts as being stuck
- `RACE.aiCount` — see below

### The bots are built, and switched off

`RACE.aiCount` is `0`, so you run alone. The steering brain in
[`src/entities/AiBrain.ts`](src/entities/AiBrain.ts) is complete and tested: it
follows the course's racing line, probes ahead for holes in the floor, plans jumps
ballistically (braking with reverse thrust when it is running too fast to land on a
stepping stone), waits on the launch lip for a sliding platform to swing into range,
and glides to stretch a jump. On the retuned course a three-bot field finished in
34.8 s, 36.6 s and 37.0 s with one or two wipeouts each — which is also how the
geometry was checked: every gap is one the shared movement code can actually
clear.

Set `aiCount` to `5` and the pack, the race-order board and the finishing placings
all come back. It is one number.

---

## Roadmap

### 1 — Prototype · done
Physics feel, course, traps, camera, checkpoints, wipeouts, personal best.

### 2 — Actual dogs · done
The rigged Shiba is in, with idle, walk, run and jump driven by ground speed and
airborne state, and a crouch before the jump so the physics has something the
animation can sit on. Still missing: a glide pose (the tail should fan into a
wing, which is what the mechanic is named after) and a wipeout reaction.

### 3 — Make the pack matter
Turn the bots back on, then give the race stakes: qualification cutoffs, a pack that
bunches and overtakes, a camera that knows when something interesting is happening
to somebody else.

### 4 — Multiplayer
The architecture this is built toward.

- **Transport.** [Colyseus](https://colyseus.io) for rooms, matchmaking and schema
  delta compression. If head-of-line blocking on movement becomes the bottleneck,
  [geckos.io](https://geckos.io) gives WebRTC unreliable-unordered datagrams for
  position updates while keeping TCP for state that must arrive.
- **Authority.** Node runs the same fixed-step Rapier world the client does.
  Clients send `InputFrame`s; the server owns positions and trap state.
- **Prediction and reconciliation.** The client keeps simulating locally, buffers
  its last N input frames, and on each server snapshot replays any frames the
  server had not yet processed. This is why the simulation is already deterministic
  and input is already a struct.
- **Interpolation.** Other racers render one snapshot behind, interpolated. The
  fixed-step loop already produces the alpha value for this — `Physics.step()`
  returns it and the prototype simply ignores it.
- **Lag compensation.** A ring buffer of past world states so a trap fired at
  timestamp T is resolved against where runners actually were at T on the firing
  client's screen.

### 5 — The saboteur
The reason this game exists. One player, or a rotating one, leaves the track and
takes the levers: an overhead view of the course, an energy pool, and a cooldown on
each machine. Firing a trap becomes a read on where the pack will be in two seconds
rather than a timer.

The hooks are already in place. `TrapSystem.fire(index)` is the entry point, wired
to the number keys behind `?debug`. What it needs is the energy economy, the
overhead camera, the pick-a-trap-with-the-mouse interaction, and a scoring rule that
makes sabotage worth doing well.

### 6 — Content and meta
More trap kinds (conveyors, swinging floors, a chase hazard). A course defined as
data rather than code, so courses can be authored and eventually shared. Cosmetics.
Rounds and a lobby.

### Infrastructure
Containerise the Node/Colyseus server and deploy regionally — Fly.io or Railway both
make multi-region trivial — so that ping stays under about 50 ms for the majority of
a session's players. Above that, the time-offset maths behind lag compensation gets
visibly unfair.

---

## Known gaps

- **Only runners are render-interpolated.** Racers are drawn smoothly between
  simulation ticks, and the camera follows the interpolated position. The
  kinematic platforms and trap machinery still snap at 60 Hz, which is visible on
  a fast display for the quicker ones — the pendulum and the spun-up spinner.
  They need the same prev/current treatment `Runner` already has.
- **No audio.** A deathrun without a crusher sound is missing half its telegraph.
- **The course is code, not data.** Fine for one course, wrong for ten.
- **Traps push, they do not kill.** Being flattened by a crusher is survivable if
  you are not near an edge. A "squashed" state is worth adding.
- **Particles are not soft.** Where a sprite intersects the floor it cuts on a
  straight line instead of fading into it. The fix is the reference engine's: read
  scene depth in the fragment shader and fade on the difference. It needs the main
  pass rendered to a target with a depth texture, which is a renderer change for
  an effect the soft sprite shape already mostly hides.
- **Point sprites do not rotate with the view and pop at the screen edge.** Points
  are culled on their centre, so a large near sprite vanishes while half of it is
  still on screen. Quads or instanced billboards would fix both, at more cost per
  particle than this needs.
- **The frame cost is shadows and dogs, not distance.** Half the triangles and
  half the draw calls are the shadow pass, whose frustum is independent of the
  camera; most of the rest is six 16k-triangle dogs drawn twice. The levers are
  `SUN.extentAlongCourse`, a lower-poly dog, or a shadow LOD that drops distant
  runners from the depth pass — not the fog.
- **The fog is still subtle in the tightest corridors.** `COLORS.fog` is darker
  than the platforms, so distance there reads as shadow more than as haze, and
  the enclosed sections have short sightlines anyway. Raising it makes the fog
  read as atmosphere everywhere, at the cost of a lighter, less oppressive scene.
- **No GPU means slow motion, not a slideshow.** On a software rasteriser the
  Grinder runs about 137 ms a frame. `main.ts` clamps the frame delta to 0.05 s
  and `PHYSICS.maxStepsPerFrame` is 5, so the backlog is dropped rather than
  spiralled — which keeps the controls in step with the simulation, at the price
  of the whole game running at roughly a third speed. There is no dynamic quality
  fallback; the tuning panel is the manual one.
- **Mobile is untouched.** No touch controls, no performance budget for phones.
- **A clean run is about 30 seconds.** Reasonable for a round, but the course is
  still one long corridor with no branches and nothing to choose.
- **No falling animation.** A long drop runs out of jump clip to scrub and holds
  on the landing frame until the paws touch. Sweeping those frames back and forth
  to fake it was tried and reads as choppy — this wants an authored falling cycle.
- **The feet slide.** The clips are authored for a real dog's pace — about
  0.5 m/s walking and 0.76 m/s running — against a game that moves at 6.4. The run
  at a brisk playback rate hides most of it. Fixing it properly means re-authored
  cycles with far longer strides, not a tuning value.

---

## Stack

[three.js](https://threejs.org) for rendering, [Rapier](https://rapier.rs)
(WebAssembly) for physics, TypeScript, Vite. No framework, no state library, no
renderer abstraction — at this size they would cost more than they returned.
