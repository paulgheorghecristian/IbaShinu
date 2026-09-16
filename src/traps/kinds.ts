import * as THREE from 'three'
import { Trap, type TrapContext, type TrapSpec } from './Trap'
import type { Physics, RigidBody } from '../engine/Physics'
import type { DropTile } from '../world/Course'
import { surface, emissive } from '../world/Materials'
import { lerp, span, easeInCubic, easeOutCubic, easeInOut } from '../util/ease'
import { FX } from '../config'

const Z_AXIS = new THREE.Vector3(0, 0, 1)
const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** Scratch vectors — emitters run every tick and must not allocate. */
const AT = new THREE.Vector3()
const TO = new THREE.Vector3()

/**
 * Wrecking arm parked against the wall. Fired, it sweeps the full width of the
 * corridor three times at floor height, then returns to its parked angle.
 */
export class Pendulum extends Trap {
  private static readonly PIVOT_Y = 7.1
  private static readonly ARM = 6.2
  private static readonly PARK = 1.42
  /** Slow enough to read and step around, not a coin flip. */
  private static readonly SWING_PERIOD = 2.4

  private readonly head: RigidBody
  private readonly headMesh: THREE.Mesh
  private readonly arm: THREE.Mesh
  private readonly pivot: THREE.Vector3
  private readonly pos = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()

  constructor(physics: Physics, scene: THREE.Scene, spec: TrapSpec, z: number) {
    super(spec, scene)
    this.pivot = new THREE.Vector3(0, Pendulum.PIVOT_Y, z)

    const half = { x: 1.5, y: 0.85, z: 1.3 }
    this.head = physics.kinematicBox(this.pivot, half, 0.4)
    this.headMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 1.7, 2.6), surface(0x8c3b3b, 0.7))
    this.headMesh.castShadow = true
    scene.add(this.headMesh)

    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, Pendulum.ARM, 0.28), surface(0x3c4253))
    this.arm.castShadow = true
    scene.add(this.arm)

    const mount = new THREE.Mesh(new THREE.BoxGeometry(11, 0.5, 0.5), surface(0x3c4253))
    mount.position.copy(this.pivot)
    mount.castShadow = true
    scene.add(mount)

    this.place()
  }

  protected onUpdate(ctx: TrapContext): void {
    this.place()

    // The head clears the deck by a few centimetres at the bottom of its arc, so
    // each pass drags a sheet of dust along with it.
    if (this.active && Math.abs(this.headMesh.position.y - Pendulum.PIVOT_Y + Pendulum.ARM) < 0.35) {
      const n = Math.floor(ctx.dt * 40)
      for (let i = 0; i < n; i += 1) {
        AT.set(this.pos.x + (Math.random() - 0.5) * 3, 0.25, this.pos.z + (Math.random() - 0.5) * 2.4)
        TO.set((Math.random() - 0.5) * 3, 0.6 + Math.random(), (Math.random() - 0.5) * 3)
        ctx.particles.puff(AT, TO, FX.dustTint, 1.1 + Math.random() * 0.6, 0.8)
      }
    }
  }

  private place(): void {
    const angle = this.active
      ? Pendulum.PARK * Math.cos((this.timer / Pendulum.SWING_PERIOD) * Math.PI * 2)
      : Pendulum.PARK

    this.pos.set(
      this.pivot.x + Math.sin(angle) * Pendulum.ARM,
      this.pivot.y - Math.cos(angle) * Pendulum.ARM,
      this.pivot.z,
    )
    this.quat.setFromAxisAngle(Z_AXIS, angle)

    this.head.setNextKinematicTranslation(this.pos)
    this.head.setNextKinematicRotation(this.quat)
    this.headMesh.position.copy(this.pos)
    this.headMesh.quaternion.copy(this.quat)

    this.arm.position.lerpVectors(this.pivot, this.pos, 0.5)
    this.arm.quaternion.copy(this.quat)
  }
}

/** Wall-mounted ram that punches across a narrow beam and retracts. */
export class Piston extends Trap {
  private readonly ram: RigidBody
  private readonly mesh: THREE.Mesh
  private readonly idleX: number
  private readonly windX: number
  private readonly outX: number
  private readonly pos = new THREE.Vector3()

  constructor(
    physics: Physics,
    scene: THREE.Scene,
    spec: TrapSpec,
    z: number,
    side: 1 | -1,
  ) {
    super(spec, scene)
    this.idleX = side * 4.8
    this.windX = side * 5.6
    this.outX = side * 0.4

    this.pos.set(this.idleX, 0.95, z)
    this.ram = physics.kinematicBox(this.pos, { x: 0.9, y: 0.9, z: 0.9 }, 0.35)
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), surface(0x9a4a2f, 0.6))
    this.mesh.castShadow = true
    this.mesh.position.copy(this.pos)
    scene.add(this.mesh)

    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3, 3), surface(0x2c3242))
    housing.position.set(side * 6.2, 0.9, z)
    housing.castShadow = true
    scene.add(housing)
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.4, 26, 0.4), surface(0x232937))
    strut.position.set(side * 6.2, -12.5, z)
    scene.add(strut)
  }

  protected onUpdate(ctx: TrapContext): void {
    const p = this.phase
    // Draw back into the housing first — that wind-up is your cue — then punch,
    // hold, and retract slowly. The retract is the safe window.
    const x = !this.active
      ? this.idleX
      : p < 0.24
        ? lerp(this.idleX, this.windX, easeInOut(span(p, 0, 0.24)))
        : p < 0.38
          ? lerp(this.windX, this.outX, easeOutCubic(span(p, 0.24, 0.38)))
          : p < 0.58
            ? this.outX
            : lerp(this.outX, this.idleX, easeInOut(span(p, 0.58, 1)))

    this.pos.x = x
    this.ram.setNextKinematicTranslation(this.pos)
    this.mesh.position.copy(this.pos)

    // Vents while it drives out, then a hard puff at full extension.
    const side = Math.sign(this.idleX)
    if (this.active && p > 0.24 && p < 0.38) {
      const n = Math.floor(ctx.dt * FX.ventRate)
      for (let i = 0; i < n; i += 1) {
        AT.set(side * 6.2 - side * 0.8, 0.9 + (Math.random() - 0.5) * 1.6, this.pos.z + (Math.random() - 0.5) * 2)
        TO.set(-side * (3 + Math.random() * 3), 0.8 + Math.random(), (Math.random() - 0.5) * 2)
        ctx.particles.puff(AT, TO, 0xc8d4e4, 0.8 + Math.random() * 0.5, 0.55)
      }
    }
    if (this.crossed(0.38)) {
      AT.set(this.outX, 0.95, this.pos.z)
      ctx.particles.impact(AT, 1.4, 2.4)
    }
  }
}

/** Ceiling block that slams the width of a hallway. */
export class Crusher extends Trap {
  private readonly block: RigidBody
  private readonly mesh: THREE.Mesh
  private readonly guide: THREE.Mesh
  private readonly topY = 9.5
  private readonly bottomY = 1.15
  private readonly pos = new THREE.Vector3()

  constructor(physics: Physics, scene: THREE.Scene, spec: TrapSpec, z: number) {
    super(spec, scene)
    this.pos.set(0, this.topY, z)
    this.block = physics.kinematicBox(this.pos, { x: 3.6, y: 1.1, z: 1.7 }, 0.5)
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.2, 3.4), surface(0x7d4a86, 0.6))
    this.mesh.castShadow = true
    this.mesh.position.copy(this.pos)
    scene.add(this.mesh)

    this.guide = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.18, 3.4),
      new THREE.MeshBasicMaterial({ color: 0xff5566, transparent: true, opacity: 0, depthWrite: false }),
    )
    this.guide.position.set(0, 0.06, z)
    scene.add(this.guide)
  }

  protected onUpdate(ctx: TrapContext): void {
    const p = this.phase
    // A third of the cycle is spent armed and warning before anything moves.
    const y = !this.active
      ? this.topY
      : p < 0.32
        ? this.topY
        : p < 0.42
          ? lerp(this.topY, this.bottomY, easeInCubic(span(p, 0.32, 0.42)))
          : p < 0.62
            ? this.bottomY
            : lerp(this.bottomY, this.topY, easeInOut(span(p, 0.62, 1)))

    this.pos.y = y
    this.block.setNextKinematicTranslation(this.pos)
    this.mesh.position.copy(this.pos)

    // Seven metres of block hitting the deck pushes the air out sideways, so the
    // dust runs flat along the floor rather than mushrooming.
    if (this.crossed(0.42)) {
      for (let i = 0; i < 18; i += 1) {
        const side = i % 2 ? 1 : -1
        AT.set(side * (1 + Math.random() * 2.6), 0.2, this.pos.z + (Math.random() - 0.5) * 3.2)
        TO.set(side * (5 + Math.random() * 5), 0.5 + Math.random() * 1.2, (Math.random() - 0.5) * 3)
        ctx.particles.puff(AT, TO, FX.dustTint, 1.3 + Math.random() * 0.8, 1.1 + Math.random())
      }
      AT.set(0, 0.2, this.pos.z)
      ctx.particles.impact(AT, 2.2, 2)
    }

    // The floor decal brightens through the wind-up, so the strike is earned.
    const mat = this.guide.material as THREE.MeshBasicMaterial
    mat.opacity = !this.active
      ? 0
      : p < 0.42
        ? 0.12 + 0.55 * span(p, 0, 0.42)
        : 0.67 * (1 - span(p, 0.42, 0.66))
  }
}

/** Centre bar that idles slowly and spins up hard when fired. */
export class Spinner extends Trap {
  private static readonly IDLE_RATE = 0.3
  /** Halved: a bar you can time your way past, not one that simply removes you. */
  private static readonly FIRED_RATE = 2.6

  private readonly bar: RigidBody
  private readonly mesh: THREE.Mesh
  private readonly quat = new THREE.Quaternion()
  private spin = 0

  constructor(physics: Physics, scene: THREE.Scene, spec: TrapSpec, z: number) {
    super(spec, scene)
    const pos = { x: 0, y: 0.78, z }
    this.bar = physics.kinematicBox(pos, { x: 7, y: 0.45, z: 0.45 }, 0.3)
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(14, 0.9, 0.9), surface(0x3f7f8c, 0.55))
    this.mesh.castShadow = true
    this.mesh.position.set(pos.x, pos.y, pos.z)
    scene.add(this.mesh)

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 3.2, 12), surface(0x2c3242))
    hub.position.set(0, 1.6, z)
    hub.castShadow = true
    scene.add(hub)
  }

  protected onUpdate(ctx: TrapContext): void {
    const boost = this.active ? Math.sin(Math.PI * this.phase) : 0
    const rate = lerp(Spinner.IDLE_RATE, Spinner.FIRED_RATE, boost)
    this.spin += rate * ctx.dt
    this.quat.setFromAxisAngle(Y_AXIS, this.spin)
    this.bar.setNextKinematicRotation(this.quat)
    this.mesh.quaternion.copy(this.quat)
  }
}

/** Yanks a stepping stone out of the course and puts it back a beat later. */
export class DropFloor extends Trap {
  private readonly pos = new THREE.Vector3()
  private readonly material: THREE.MeshStandardMaterial

  constructor(scene: THREE.Scene, spec: TrapSpec, private readonly tile: DropTile) {
    super(spec, scene)
    // Own material instance so this tile can flash without tinting its sibling.
    this.material = (tile.mesh.material as THREE.MeshStandardMaterial).clone()
    tile.mesh.material = this.material
  }

  protected onUpdate(ctx: TrapContext): void {
    const p = this.phase
    // Glows for a quarter of a second before it goes — long enough to step off.
    const drop = !this.active
      ? 0
      : p < 0.26
        ? 0
        : p < 0.34
          ? easeInCubic(span(p, 0.26, 0.34)) * 18
          : p < 0.8
            ? 18
            : lerp(18, 0, easeInOut(span(p, 0.8, 1)))

    this.pos.copy(this.tile.home).setY(this.tile.home.y - drop)
    this.tile.body.setNextKinematicTranslation(this.pos)
    this.tile.mesh.position.copy(this.pos)

    // Grit falls into the hole the moment the tile lets go.
    if (this.crossed(0.26)) {
      for (let i = 0; i < 8; i += 1) {
        AT.set(
          this.tile.home.x + (Math.random() - 0.5) * 3,
          this.tile.home.y + 0.1,
          this.tile.home.z + (Math.random() - 0.5) * 3,
        )
        TO.set((Math.random() - 0.5) * 2, -1 - Math.random(), (Math.random() - 0.5) * 2)
        ctx.particles.puff(AT, TO, FX.dustTint, 1 + Math.random() * 0.6, 0.7)
      }
    }

    this.material.emissive.setHex(0xff3b3b)
    this.material.emissiveIntensity = !this.active
      ? 0
      : p < 0.26
        ? 0.3 + 0.9 * Math.abs(Math.sin(p * 40))
        : 0.8 * (1 - p)
  }
}

/**
 * Directed air blast. Unlike the other traps this one has no body — it reaches
 * into the runner list and shoves anything standing in its volume.
 */
export class Fan extends Trap {
  private static readonly PUSH = 16
  private static readonly LIFT = 4

  private readonly zone: THREE.Box3
  private readonly volume: THREE.Mesh
  private readonly blades: THREE.Mesh
  private readonly floor: number
  /** Own accumulator: a shared one would hand every wisp to the first fan to ask. */
  private spawn = 0

  constructor(
    scene: THREE.Scene,
    spec: TrapSpec,
    z: number,
    private readonly direction: 1 | -1,
    floor = 0,
  ) {
    super(spec, scene)
    // The volume follows the deck it blows across, so a gale can sit at the top
    // of a climb rather than only at ground level.
    this.zone = new THREE.Box3(
      new THREE.Vector3(-5, floor - 0.5, z - 3.4),
      new THREE.Vector3(5, floor + 5, z + 3.4),
    )

    this.volume = new THREE.Mesh(
      new THREE.BoxGeometry(10, 5.5, 6.8),
      new THREE.MeshBasicMaterial({
        color: 0x7fe0ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.volume.position.set(0, floor + 2.25, z)
    scene.add(this.volume)

    this.blades = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 4.4), emissive(0x7fe0ff, 0.6))
    this.blades.position.set(-direction * 5.6, floor + 2.4, z)
    scene.add(this.blades)
    this.floor = floor
  }

  protected onUpdate(ctx: TrapContext): void {
    const mat = this.volume.material as THREE.MeshBasicMaterial
    mat.opacity = this.active ? 0.05 + 0.1 * Math.sin(ctx.elapsed * 22) : 0
    this.blades.rotation.x = this.active ? ctx.elapsed * 18 : ctx.elapsed * 1.2

    if (!this.active || ctx.dt === 0) return
    const strength = Math.sin(Math.PI * this.phase)

    // Without this the gale is an invisible shove — the one trap on the course
    // with no tell at all. The stream doubles as the telegraph.
    this.spawn += FX.fanRate * strength * ctx.dt
    const wisps = Math.floor(this.spawn)
    this.spawn -= wisps
    for (let i = 0; i < wisps; i += 1) {
      AT.set(
        this.blades.position.x + this.direction * (0.4 + Math.random()),
        this.floor + 0.3 + Math.random() * 4,
        this.blades.position.z + (Math.random() - 0.5) * 4.2,
      )
      const speed = FX.fanSpeed * (0.7 + Math.random() * 0.6) * strength
      TO.set(this.direction * speed, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 1.5)
      ctx.particles.puff(AT, TO, FX.fanTint, 0.7 + Math.random() * 0.5, 0.7 + Math.random() * 0.7)
    }

    for (const runner of ctx.runners) {
      if (runner.state !== 'racing') continue
      if (!this.zone.containsPoint(runner.position)) continue
      runner.body.applyImpulse(
        {
          x: this.direction * Fan.PUSH * strength * ctx.dt,
          y: Fan.LIFT * strength * ctx.dt,
          z: 0,
        },
        true,
      )
    }
  }
}


/**
 * A pillar that punches up out of the deck.
 *
 * The other machines all come at you sideways or from above, so the floor itself
 * turning hostile is the one thing a player cannot dodge by reading the walls. It
 * telegraphs with a decal because a spike you cannot see coming is not a trap,
 * it is a dice roll.
 */
export class Spike extends Trap {
  private static readonly HALF = 1.7

  private readonly shaft: RigidBody
  private readonly mesh: THREE.Mesh
  private readonly warning: THREE.Mesh
  private readonly restY: number
  private readonly outY: number
  private readonly pos = new THREE.Vector3()

  constructor(
    physics: Physics,
    scene: THREE.Scene,
    spec: TrapSpec,
    x: number,
    z: number,
    floor = 0,
  ) {
    super(spec, scene)
    // Parked far enough under the deck that nothing of it shows.
    this.restY = floor - Spike.HALF - 1.4
    this.outY = floor + Spike.HALF - 0.35
    this.pos.set(x, this.restY, z)

    this.shaft = physics.kinematicBox(this.pos, { x: 0.85, y: Spike.HALF, z: 0.85 }, 0.4)
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, Spike.HALF * 2, 1.7),
      surface(0x9c4a3a, 0.55),
    )
    this.mesh.castShadow = true
    this.mesh.position.copy(this.pos)
    scene.add(this.mesh)

    this.warning = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 1.9),
      new THREE.MeshBasicMaterial({
        color: 0xff5566,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.warning.rotation.x = -Math.PI / 2
    this.warning.position.set(x, floor + 0.04, z)
    scene.add(this.warning)
  }

  protected onUpdate(ctx: TrapContext): void {
    const p = this.phase
    const y = !this.active
      ? this.restY
      : p < 0.38
        ? this.restY
        : p < 0.46
          ? lerp(this.restY, this.outY, easeOutCubic(span(p, 0.38, 0.46)))
          : p < 0.68
            ? this.outY
            : lerp(this.outY, this.restY, easeInOut(span(p, 0.68, 1)))

    this.pos.y = y
    this.shaft.setNextKinematicTranslation(this.pos)
    this.mesh.position.copy(this.pos)

    // Comes up through the deck, so it throws fire and grit out of the seam.
    if (this.crossed(0.46)) {
      AT.set(this.pos.x, this.warning.position.y, this.pos.z)
      ctx.particles.impact(AT, 1.3, 3.4, 0xd8b9a0)
      for (let i = 0; i < 10; i += 1) {
        AT.set(this.pos.x + (Math.random() - 0.5) * 1.8, this.warning.position.y, this.pos.z + (Math.random() - 0.5) * 1.8)
        TO.set((Math.random() - 0.5) * 2, 4 + Math.random() * 5, (Math.random() - 0.5) * 2)
        ctx.particles.flame(AT, TO, 0.4 + Math.random() * 0.35, 0.6 + Math.random() * 0.6)
      }
    }

    const mat = this.warning.material as THREE.MeshBasicMaterial
    mat.opacity = !this.active ? 0 : p < 0.46 ? 0.2 + 0.6 * span(p, 0, 0.38) : 0.7 * (1 - span(p, 0.46, 0.75))
  }
}

/**
 * A run of tiles that drops in a wave, one after the next.
 *
 * A single trapdoor is a question about where you are standing. A cascade is a
 * question about whether you are still moving, which is a better one — stop to
 * read it and the floor behind you has already gone.
 */
export class Cascade extends Trap {
  private static readonly DEPTH = 18
  /** Fraction of the cycle over which the wave travels the whole run. */
  private static readonly SWEEP = 0.5

  private readonly materials: THREE.MeshStandardMaterial[]
  private readonly pos = new THREE.Vector3()

  constructor(
    scene: THREE.Scene,
    spec: TrapSpec,
    private readonly tiles: DropTile[],
  ) {
    super(spec, scene)
    this.materials = tiles.map((tile) => {
      const mat = (tile.mesh.material as THREE.MeshStandardMaterial).clone()
      tile.mesh.material = mat
      return mat
    })
  }

  protected onUpdate(ctx: TrapContext): void {
    const p = this.phase
    const last = Math.max(1, this.tiles.length - 1)

    this.tiles.forEach((tile, i) => {
      // Each tile has its own moment, spaced evenly along the run.
      const begin = (i / last) * Cascade.SWEEP
      const falling = span(p, begin, begin + 0.07)
      const drop = !this.active
        ? 0
        : p < 0.82
          ? easeInCubic(falling) * Cascade.DEPTH
          : lerp(Cascade.DEPTH, 0, easeInOut(span(p, 0.82, 1)))

      this.pos.copy(tile.home).setY(tile.home.y - drop)
      tile.body.setNextKinematicTranslation(this.pos)
      tile.mesh.position.copy(this.pos)

      if (this.active && this.crossed(begin)) {
        for (let k = 0; k < 4; k += 1) {
          AT.set(
            tile.home.x + (Math.random() - 0.5) * 2.6,
            tile.home.y + 0.1,
            tile.home.z + (Math.random() - 0.5) * 2.6,
          )
          TO.set((Math.random() - 0.5) * 1.6, -0.8 - Math.random(), (Math.random() - 0.5) * 1.6)
          ctx.particles.puff(AT, TO, FX.dustTint, 0.9, 0.6)
        }
      }

      const mat = this.materials[i]
      mat.emissive.setHex(0xff3b3b)
      // Each tile flashes just before its own turn, so the wave is readable.
      mat.emissiveIntensity = !this.active ? 0 : Math.max(0, 1 - Math.abs(p - begin) * 14)
    })
  }
}
