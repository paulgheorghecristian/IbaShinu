import * as THREE from 'three'
import { Physics, type RigidBody } from '../engine/Physics'
import { COLORS, RACE } from '../config'
import { surface, emissive } from './Materials'
import type { Level, LevelBuilder, TrapPlacement } from '../levels/Level'

export interface Checkpoint {
  /** Crossing this world Z claims the checkpoint. The course is linear on purpose. */
  z: number
  respawn: THREE.Vector3
  label: string
}

/** A platform that slides on a fixed path. Motion is a pure function of sim time. */
interface Mover {
  body: RigidBody
  mesh: THREE.Mesh
  origin: THREE.Vector3
  axis: THREE.Vector3
  amplitude: number
  period: number
  phase: number
  /** Where it sat last tick, and how far it moved this one. */
  offset: number
  delta: THREE.Vector3
}

/**
 * A node on the racing line. Bots steer through these; `halfWidth` tells them how
 * much lateral freedom the platform actually allows, and `moverIndex` links a node
 * to a sliding platform so bots chase where it *is*, not where it started.
 */
export interface RouteNode {
  pos: THREE.Vector3
  halfWidth: number
  moverIndex: number
}

/** A stepping-stone tile a trapdoor can yank out from under the pack. */
export interface DropTile {
  body: RigidBody
  mesh: THREE.Mesh
  home: THREE.Vector3
}

const MOVER_PERIOD = 5.6

/**
 * Builds and runs one level.
 *
 * The geometry lives in `src/levels` as data; this is the machinery that turns it
 * into colliders and meshes, and then drives whatever moves. Keeping the two apart
 * is what makes a second level a file rather than a rewrite.
 */
export class Course implements LevelBuilder {
  readonly checkpoints: Checkpoint[] = []
  readonly waypoints: RouteNode[] = []
  readonly dropTiles: DropTile[] = []
  readonly trapPlacements: TrapPlacement[] = []
  readonly group = new THREE.Group()

  finishZ = 0
  /** Where finishers come to rest — also the recovery point if one slips off. */
  podium = new THREE.Vector3(0, 2, 0)

  private readonly movers: Mover[] = []
  /** Body handle -> mover, so a runner can ask what it is standing on. */
  private readonly moverByBody = new Map<number, Mover>()
  private readonly tmpVec = new THREE.Vector3()

  constructor(
    private readonly physics: Physics,
    scene: THREE.Scene,
    readonly level: Level,
  ) {
    scene.add(this.group)
    level.build(this)
    if (!this.checkpoints.length) throw new Error(`level ${level.id} defined no checkpoints`)
    if (!this.finishZ) throw new Error(`level ${level.id} never called finish()`)
  }

  // -------------------------------------------------------------------------
  // LevelBuilder
  // -------------------------------------------------------------------------

  pad(x: number, z: number, width: number, depth: number, color: number, top = 0): void {
    const thickness = 1.2
    const y = top - thickness / 2
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), surface(color))
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    this.group.add(mesh)
    this.physics.staticBox({ x, y, z }, { x: width / 2, y: thickness / 2, z: depth / 2 })
  }

  wall(x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), surface(COLORS.platformEdge))
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    this.group.add(mesh)
    this.physics.staticBox({ x, y, z }, { x: sx / 2, y: sy / 2, z: sz / 2 })
  }

  /** Sloped slab. `rise` is gained over `length` travelling toward +Z. */
  ramp(z: number, length: number, rise: number, width: number): void {
    const angle = Math.atan2(rise, length)
    const slope = Math.hypot(length, rise)
    const thickness = 1
    // Offset the box centre down along the tilted surface normal.
    const normal = new THREE.Vector3(0, Math.cos(angle), -Math.sin(angle))
    const centre = new THREE.Vector3(0, rise / 2, z).addScaledVector(normal, -thickness / 2)
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-angle, 0, 0))

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, slope), surface(COLORS.platform))
    mesh.position.copy(centre)
    mesh.quaternion.copy(quat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)

    this.physics.staticBox(
      centre,
      { x: width / 2, y: thickness / 2, z: slope / 2 },
      { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
    )
  }

  dropTile(x: number, z: number, size = 2.8): number {
    const thickness = 1.2
    const home = new THREE.Vector3(x, -thickness / 2, z)
    const body = this.physics.kinematicBox(home, { x: size / 2, y: thickness / 2, z: size / 2 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, thickness, size), surface(COLORS.hazard))
    mesh.position.copy(home)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    return this.dropTiles.push({ body, mesh, home }) - 1
  }

  mover(z: number, amplitude: number, phase: number, size = 6): number {
    const thickness = 1
    const origin = new THREE.Vector3(0, -thickness / 2, z)
    const body = this.physics.kinematicBox(origin, { x: size / 2, y: thickness / 2, z: size / 2 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, thickness, size), surface(COLORS.moving))
    mesh.position.copy(origin)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    const record: Mover = {
      body,
      mesh,
      origin,
      axis: new THREE.Vector3(1, 0, 0),
      amplitude,
      period: MOVER_PERIOD,
      phase,
      offset: Math.sin(phase) * amplitude,
      delta: new THREE.Vector3(),
    }
    this.moverByBody.set(body.handle, record)
    return this.movers.push(record) - 1
  }

  route(x: number, z: number, y = 0, halfWidth = 3.5, moverIndex = -1): void {
    this.waypoints.push({ pos: new THREE.Vector3(x, y, z), halfWidth, moverIndex })
  }

  checkpoint(z: number, respawn: THREE.Vector3, label: string): void {
    this.checkpoints.push({ z, respawn, label })
  }

  finish(z: number, podium: THREE.Vector3, top: number): void {
    this.finishZ = z
    this.podium = podium

    const postGeo = new THREE.BoxGeometry(0.7, 6, 0.7)
    for (const x of [-6.2, 6.2]) {
      const post = new THREE.Mesh(postGeo, surface(COLORS.platformEdge))
      post.position.set(x, top + 3, z)
      post.castShadow = true
      this.group.add(post)
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(12.8, 1.1, 0.3), emissive(COLORS.player, 1.6))
    banner.position.set(0, top + 5.4, z)
    this.group.add(banner)

    const beam = new THREE.Mesh(
      new THREE.PlaneGeometry(12.8, 5.6),
      new THREE.MeshBasicMaterial({
        color: COLORS.player,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    beam.position.set(0, top + 2.6, z)
    this.group.add(beam)
  }

  trap(placement: TrapPlacement): void {
    this.trapPlacements.push(placement)
  }

  /** Non-colliding scenery: support pillars that give the void some depth. */
  pillars(zs: number[], xs: number[] = [-4.5, 4.5]): void {
    const geo = new THREE.BoxGeometry(1.6, 40, 1.6)
    const mat = surface(0x232937)
    for (const z of zs) {
      for (const x of xs) {
        const pillar = new THREE.Mesh(geo, mat)
        pillar.position.set(x, -20.6, z)
        this.group.add(pillar)
      }
    }
  }


  // -------------------------------------------------------------------------
  // Runtime
  // -------------------------------------------------------------------------

  /** Drives every kinematic platform from absolute sim time (deterministic). */
  update(elapsed: number): void {
    for (const m of this.movers) {
      const offset = Math.sin((elapsed / m.period) * Math.PI * 2 + m.phase) * m.amplitude
      m.delta.copy(m.axis).multiplyScalar(offset - m.offset)
      m.offset = offset
      this.tmpVec.copy(m.origin).addScaledVector(m.axis, offset)
      m.body.setNextKinematicTranslation(this.tmpVec)
      m.mesh.position.copy(this.tmpVec)
    }
  }

  /**
   * How far the platform under `body` moves this tick, or null for solid ground.
   *
   * Rapier drags a resting body along a kinematic platform through friction alone,
   * which at these speeds is far too weak — the platform slides out from under
   * you. Runners ask for this and move themselves with it instead.
   */
  carryDelta(body: RigidBody): THREE.Vector3 | null {
    return this.moverByBody.get(body.handle)?.delta ?? null
  }

  startPositions(count: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    for (let i = 0; i < count; i += 1) {
      const x = (i - (count - 1) / 2) * RACE.startSpacing
      const z = 3 + (i % 2) * 1.8
      out.push(new THREE.Vector3(x, 1.4, z))
    }
    return out
  }

  /** Nearest route node ahead of a position — the bots' steering target. */
  nextWaypointIndex(from: THREE.Vector3, current: number): number {
    let index = current
    while (index < this.waypoints.length - 1 && this.waypoints[index].pos.z < from.z - 1.2) {
      index += 1
    }
    return index
  }

  /** Live world position of a route node, following its platform if it has one. */
  nodePosition(index: number, out: THREE.Vector3): THREE.Vector3 {
    const node = this.waypoints[Math.min(index, this.waypoints.length - 1)]
    out.copy(node.pos)
    if (node.moverIndex >= 0) out.x = this.movers[node.moverIndex].mesh.position.x
    return out
  }

  nodeHalfWidth(index: number): number {
    return this.waypoints[Math.min(index, this.waypoints.length - 1)].halfWidth
  }

  nodeIsMover(index: number): boolean {
    return this.waypoints[Math.min(index, this.waypoints.length - 1)].moverIndex >= 0
  }
}
