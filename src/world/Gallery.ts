import * as THREE from 'three'
import { ENEMY } from '../config'
import type { Physics } from '../engine/Physics'
import type { Course } from './Course'
import type { Trap } from '../traps/Trap'

/**
 * Lit from inside rather than by the sun.
 *
 * The gallery is roofed for its whole length, so the one directional light in
 * the scene never reaches it and an unlit corridor renders as a black tunnel
 * with a bright course in the window. A low emissive is a strip light without
 * being one: no second light in the scene, no shadow-map cost, and nothing for
 * the sun's tuning to push around.
 */
const SHELL = new THREE.MeshStandardMaterial({
  color: 0x2b3142,
  emissive: 0x2b3142,
  emissiveIntensity: 0.5,
  roughness: 0.85,
  metalness: 0.05,
})

/**
 * Barely there: it has to read as a pane without costing any of the view.
 *
 * Unlit, and that is the whole point. As a `MeshStandardMaterial` at roughness
 * 0.05 it was a mirror a metre and a half from the eye, and a dielectric that
 * smooth concentrates a directional light into a specular peak orders of
 * magnitude brighter than the scene around it. Bloom then did what bloom does and
 * smeared it into a soft white ball that read as a sun — one that tracked the
 * head, hung in mid-air, and washed out whatever was behind it. There is no sun
 * geometry anywhere in this game; that blob was this pane catching the
 * directional light. A basic material has no specular term to blow out, and a
 * pane that is 8% opaque had nothing to gain from being shaded in the first place.
 */
const GLASS = new THREE.MeshBasicMaterial({
  color: 0x9fd0e8,
  transparent: true,
  opacity: 0.08,
  side: THREE.DoubleSide,
  depthWrite: false,
})

const PLATE = new THREE.MeshStandardMaterial({
  color: 0x1d2230,
  emissive: 0x1d2230,
  emissiveIntensity: 0.4,
  roughness: 0.8,
})

interface Button {
  readonly mesh: THREE.Mesh
  readonly material: THREE.MeshStandardMaterial
  readonly world: THREE.Vector3
  /**
   * 1 / luminance of this button's colour.
   *
   * Multiplying the target luminance by this is what makes a red button glow as
   * hard as a yellow one. See `ENEMY.button.glow`.
   */
  readonly lumGain: number
}

/**
 * The enemy's gallery: a glass-fronted corridor the length of the course.
 *
 * Each trap's button is mounted on the window, level with that trap and nowhere
 * else, and a button out of `ENEMY.reach` cannot be pressed. That one rule is the
 * mode: the course has ten machines spread over hundreds of metres, the pack
 * covers that ground at 7.4 m/s, and you cannot be at two of them at once.
 * Choosing a trap is choosing where to stand.
 *
 * The floor follows the course's own height, sampled at build time, and it
 * *ramps* rather than steps — see `ENEMY.gallery.rampRun`. A stepped gallery puts
 * a wall between you and the traps on a climb and leaves their buttons up a face
 * you cannot walk; a ramped one keeps the window level with the racing line for
 * the whole eight metres of ascent.
 *
 * None of it is physical. There are no colliders: the enemy is moved by hand and
 * clamped to the interior, the runners can never reach it, and a corridor made of
 * real geometry would be several hundred metres of collider for a room nothing
 * collides with.
 */
export class Gallery {
  readonly group = new THREE.Group()
  readonly startZ: number
  readonly endZ: number

  /** Smoothed floor height per sample, walked by `floorAt`. */
  private readonly heights: number[] = []
  private readonly step: number
  private readonly buttons: Button[] = []
  private readonly toButton = new THREE.Vector3()

  constructor(scene: THREE.Scene, physics: Physics, course: Course, traps: Trap[]) {
    const g = ENEMY.gallery
    this.step = g.sampleStep
    this.startZ = -g.margin
    this.endZ = course.finishZ + g.margin

    // 1. Sample the course surface down the racing line. A gap carries the last
    //    height forward: the gallery is a corridor, not a set of islands.
    const raw: number[] = []
    let last = 0
    for (let z = this.startZ; z <= this.endZ; z += this.step) {
      const toi = physics.rayDistance({ x: 0, y: 40, z }, { x: 0, y: -1, z: 0 }, 90)
      if (toi !== null) last = Math.round((40 - toi) / g.sampleQuantum) * g.sampleQuantum
      raw.push(last)
    }

    // 2. Smooth it. A box filter the width of the ramp turns every step in the
    //    sampled profile into a slope of exactly the length we asked for, which
    //    is a great deal simpler than detecting the steps and fitting ramps to
    //    them — and it cannot produce a discontinuity, however the course jumps.
    const half = Math.max(1, Math.round(g.rampRun / (2 * this.step)))
    for (let i = 0; i < raw.length; i += 1) {
      let sum = 0
      let n = 0
      for (let k = i - half; k <= i + half; k += 1) {
        sum += raw[Math.max(0, Math.min(raw.length - 1, k))]
        n += 1
      }
      this.heights.push(sum / n)
    }

    // 3. Emit one tilted section per run of constant slope, so a flat two hundred
    //    metres is a handful of boxes and a climb is a handful more.
    let spanStart = 0
    const slopeAt = (i: number) => (this.heights[i + 1] - this.heights[i]) / this.step
    for (let i = 1; i < this.heights.length; i += 1) {
      const lastSample = i === this.heights.length - 1
      const changed = Math.abs(slopeAt(i - 1) - slopeAt(spanStart)) > g.slopeTolerance
      if (!changed && !lastSample) continue
      this.addSection(spanStart, lastSample ? i : i - 1)
      spanStart = lastSample ? i : i - 1
    }

    // 4. One button per trap, on the *window* side, level with the machine it fires.
    //
    // On the glass rather than the back wall, and that is not decoration: a
    // button behind you is one you have to turn your back on the course to use,
    // and the whole skill of the role is firing on what you can see. Here you
    // stand at the glass facing the trap, with the button between you and it.
    //
    // It sits below the sightline on purpose. The dogs are a metre lower than eye
    // height and thirteen metres out, so they sit a few degrees below level; the
    // button is close and lower still, which puts it under them in the view
    // rather than over them.
    const { height: buttonHeight, size, plate } = ENEMY.button
    const face = g.x - g.width / 2 + 0.06
    for (const trap of traps) {
      const z = trap.spec.anchor.z
      const y = this.floorAt(z) + buttonHeight

      this.group.add(box(0.05, size * plate, size * plate, face, y, z, PLATE))
      const material = new THREE.MeshStandardMaterial({
        color: trap.spec.color,
        emissive: trap.spec.color,
        emissiveIntensity: 0.8,
        roughness: 0.4,
      })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, size, size), material)
      const x = face + 0.09
      mesh.position.set(x, y, z)
      this.group.add(mesh)
      // `material.emissive` is already in the renderer's linear working space —
      // `Color` converts the sRGB hex on the way in — so this is the luminance the
      // bloom pass will actually weigh, not the one the hex looks like.
      const e = material.emissive
      const lum = Math.max(1e-4, 0.2126 * e.r + 0.7152 * e.g + 0.0722 * e.b)
      this.buttons.push({ mesh, material, world: new THREE.Vector3(x, y, z), lumGain: 1 / lum })
    }

    scene.add(this.group)
  }

  /**
   * One run of corridor, tilted to its slope.
   *
   * Built as a group in the section's own frame and then rotated, so the floor,
   * both walls and the roof stay square to each other and meet the neighbouring
   * section cleanly. Rotating each box on its own leaves gaps at every joint.
   */
  private addSection(from: number, to: number): void {
    const { x, width, height } = ENEMY.gallery
    const z0 = this.startZ + from * this.step
    const z1 = this.startZ + to * this.step
    const y0 = this.heights[from]
    const y1 = this.heights[to]
    const dz = z1 - z0
    const dy = y1 - y0
    const length = Math.hypot(dz, dy)
    if (length < 1e-3) return

    const section = new THREE.Group()
    section.add(box(width, 0.24, length, 0, -0.12, 0, SHELL))
    section.add(box(0.16, height, length, width / 2, height / 2, 0, SHELL))
    section.add(box(width, 0.14, length, 0, height, 0, SHELL))
    section.add(box(0.05, height, length, -width / 2, height / 2, 0, GLASS))
    section.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2)
    // Maps the section's +Z onto the run direction (0, dy, dz).
    section.rotation.x = -Math.atan2(dy, dz)
    this.group.add(section)
  }

  /** Gallery floor height at a course position, interpolated between samples. */
  floorAt(z: number): number {
    const t = (z - this.startZ) / this.step
    const i = Math.floor(t)
    if (i < 0) return this.heights[0]
    if (i >= this.heights.length - 1) return this.heights[this.heights.length - 1]
    return this.heights[i] + (this.heights[i + 1] - this.heights[i]) * (t - i)
  }

  /** Keep a walker inside the corridor and standing on its floor. */
  clamp(position: THREE.Vector3): void {
    const { x, width } = ENEMY.gallery
    const inset = 0.45
    position.x = Math.max(x - width / 2 + inset, Math.min(x + width / 2 - inset, position.x))
    position.z = Math.max(this.startZ + 1, Math.min(this.endZ - 1, position.z))
    position.y = this.floorAt(position.z)
  }

  /**
   * The button being looked at from where you are standing, or -1.
   *
   * Reach first, angle second. Out of reach is not a near miss to be nudged into
   * range — it is the answer, and the reason the corridor is worth walking.
   */
  aimedAt(eye: THREE.Vector3, view: THREE.Vector3): number {
    const limit = Math.cos(ENEMY.aimCone * (Math.PI / 180))
    const reachSq = ENEMY.reach * ENEMY.reach
    let best = -1
    let bestDot = limit
    for (let i = 0; i < this.buttons.length; i += 1) {
      this.toButton.copy(this.buttons[i].world).sub(eye)
      if (this.toButton.lengthSq() > reachSq) continue
      const dot = this.toButton.normalize().dot(view)
      if (dot > bestDot) {
        bestDot = dot
        best = i
      }
    }
    return best
  }

  /** The nearest button and how far off it is, so the HUD can point you down the corridor. */
  nearest(eye: THREE.Vector3): { index: number; distance: number; ahead: number } {
    let index = -1
    let distance = Infinity
    let ahead = 0
    for (let i = 0; i < this.buttons.length; i += 1) {
      const world = this.buttons[i].world
      const d = world.distanceTo(eye)
      if (d < distance) {
        distance = d
        index = i
        ahead = world.z - eye.z
      }
    }
    return { index, distance, ahead }
  }

  /**
   * Light the wall. A button's brightness means one thing and one thing only:
   * whether its trap can be fired.
   *
   * It used to mean two, and the second ruined the first. Anything out of reach
   * was dimmed to a third on the reasoning that a button you cannot press should
   * not look like one you can — but reach is 2.8 m and the buttons are tens of
   * metres apart, so that dimmed *every button except the one you are standing at*
   * and left a ready trap twenty metres away sitting at near black. The wall read
   * as half-broken: some lit, some not, for no reason you could see from where you
   * were standing.
   *
   * Distance is not worth saying here anyway. You know perfectly well whether you
   * are at a button, and the HUD names the nearest one and how far off it is. What
   * you cannot know without looking is which traps are armed — so that is what the
   * corridor shows, all the way down it, which is what makes it worth looking at
   * before deciding where to run.
   */
  refresh(traps: Trap[], aimed: number): void {
    for (let i = 0; i < this.buttons.length; i += 1) {
      const trap = traps[i]
      const { material } = this.buttons[i]

      // Grey while it recharges; its own colour the rest of the time. The glow is
      // spent only on being looked at and on the swing itself — see ENEMY.button.glow.
      const cooling = !trap.ready && !trap.active
      const lit = trap.active || (i === aimed && !cooling)
      const g = ENEMY.button.glow
      material.color.setHex(cooling ? ENEMY.button.coolingColor : trap.spec.color)
      // Solved per colour, so every lit button reaches the same luminance and so
      // the same bloom, whatever hue it happens to be.
      material.emissiveIntensity = lit
        ? Math.min(g.maxGain, g.lit * this.buttons[i].lumGain)
        : g.idle
    }
  }
}

function box(
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material)
  mesh.position.set(x, y, z)
  return mesh
}
