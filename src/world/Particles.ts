import * as THREE from 'three'
import { VIEW, FX } from '../config'

/** The atlas is a 4x4 flipbook: white-hot core, through orange, to scattering embers. */
const COLS = 4
const ROWS = 4
const FRAMES = COLS * ROWS

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute float age;
  attribute float angle;
  uniform float fogNear;
  uniform float fogFar;
  uniform float pointScale;
  uniform float maxPointSize;
  uniform float nearFade;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vAge;
  varying float vAngle;

  void main() {
    vColor = color;
    vAge = age;
    vAngle = angle;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;
    // Fade out anything about to pass through the eye. Without this a puff at
    // 10cm paints the whole screen, and a few hundred of those stall the
    // rasteriser badly enough to lose the context.
    float near = smoothstep(nearFade, nearFade * 3.0, depth);
    // The same curve three uses for THREE.Fog, by hand: points get no fog of
    // their own, and a sprite fading on a different curve from the wall behind it
    // is visible as a sprite.
    vAlpha = alpha * near * (1.0 - smoothstep(fogNear, fogFar, depth));
    // Capped as well as faded: drivers clamp gl_PointSize anyway, and an
    // uncapped one is unbounded overdraw.
    gl_PointSize = clamp(size * (pointScale / max(depth, 0.5)), 1.0, maxPointSize);
    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D atlas;
  uniform vec2 grid;
  uniform float frames;
  /** 1 plays the flipbook over the particle's life, 0 holds the soft first frame. */
  uniform float animate;
  /** 1 throws away the atlas colour and keeps only its shape, for tinted smoke. */
  uniform float whiten;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vAge;
  varying float vAngle;

  vec4 cell(float index, vec2 uv) {
    float col = mod(index, grid.x);
    float row = floor(index / grid.x);
    vec2 span = 1.0 / grid;
    // Atlas rows read top-down, texture coordinates read bottom-up.
    vec2 origin = vec2(col * span.x, 1.0 - (row + 1.0) * span.y);
    return texture2D(atlas, origin + clamp(uv, 0.001, 0.999) * span);
  }

  void main() {
    // Spin each sprite about its own centre so a stream of puffs from one
    // emitter does not read as the same stamp over and over.
    vec2 c = gl_PointCoord - 0.5;
    float s = sin(vAngle), k = cos(vAngle);
    vec2 uv = vec2(c.x * k - c.y * s, c.x * s + c.y * k) + 0.5;
    uv.y = 1.0 - uv.y;

    float t = vAge * (frames - 1.0) * animate;
    float i = floor(t);
    vec4 tex = mix(cell(i, uv), cell(min(i + 1.0, frames - 1.0), uv), fract(t));
    if (tex.a < 0.01) discard;

    gl_FragColor = vec4(vColor * mix(tex.rgb, vec3(1.0), whiten), tex.a * vAlpha);
  }
`

export interface Spawn {
  position: THREE.Vector3
  velocity: THREE.Vector3
  colour: THREE.Color
  life: number
  size: number
  /** Per-second velocity retention. */
  drag?: number
  gravity?: number
  /** Metres per second the sprite grows — the reference engine's diffusion. */
  diffusion?: number
  /** Lift proportional to current size: a puff rises faster as it spreads out. */
  buoyancy?: number
}

/**
 * One pool of points, drawn as a single indexed cloud.
 *
 * A system per trap would be sixty-eight draw calls and sixty-eight buffers for
 * something that is idle almost all the time. This is a ring buffer instead:
 * `emit` overwrites the oldest particle when it runs out, so the cost is fixed no
 * matter how much is going off at once, and each frame an index list is rebuilt
 * with only the live ones so the dead are never rasterised.
 */
class Pool {
  private readonly position: THREE.BufferAttribute
  private readonly colour: THREE.BufferAttribute
  private readonly size: THREE.BufferAttribute
  private readonly alpha: THREE.BufferAttribute
  private readonly age: THREE.BufferAttribute
  private readonly angle: THREE.BufferAttribute
  private readonly geometry: THREE.BufferGeometry

  private readonly velocity: Float32Array
  private readonly life: Float32Array
  private readonly span: Float32Array
  private readonly drag: Float32Array
  private readonly gravity: Float32Array
  private readonly diffusion: Float32Array
  private readonly buoyancy: Float32Array
  private readonly scale: Float32Array

  private readonly order: Uint32Array
  private readonly depth: Float32Array
  private readonly sorted: boolean
  /** Reused across frames so the depth sort does not allocate every frame. */
  private readonly ranking: number[] = []
  private readonly index: THREE.BufferAttribute
  private cursor = 0
  /** Particles drawn last frame — the tuning signal for pool sizes. */
  live = 0

  constructor(
    scene: THREE.Scene,
    readonly capacity: number,
    atlas: THREE.Texture,
    options: { animate: boolean; whiten: boolean; blending: THREE.Blending; sorted: boolean },
  ) {
    this.geometry = new THREE.BufferGeometry()
    this.position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3)
    this.colour = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3)
    this.size = new THREE.BufferAttribute(new Float32Array(capacity), 1)
    this.alpha = new THREE.BufferAttribute(new Float32Array(capacity), 1)
    this.age = new THREE.BufferAttribute(new Float32Array(capacity), 1)
    this.angle = new THREE.BufferAttribute(new Float32Array(capacity), 1)
    for (const a of [this.position, this.colour, this.size, this.alpha, this.age, this.angle]) {
      a.setUsage(THREE.DynamicDrawUsage)
    }
    this.geometry.setAttribute('position', this.position)
    this.geometry.setAttribute('color', this.colour)
    this.geometry.setAttribute('size', this.size)
    this.geometry.setAttribute('alpha', this.alpha)
    this.geometry.setAttribute('age', this.age)
    this.geometry.setAttribute('angle', this.angle)

    this.index = new THREE.BufferAttribute(new Uint32Array(capacity), 1)
    this.index.setUsage(THREE.DynamicDrawUsage)
    this.geometry.setIndex(this.index)
    this.geometry.setDrawRange(0, 0)
    // Particles are scattered over the whole course; the bounds computed at bind
    // time would cull the entire cloud the moment they left the frustum.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    this.velocity = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.span = new Float32Array(capacity)
    this.drag = new Float32Array(capacity)
    this.gravity = new Float32Array(capacity)
    this.diffusion = new Float32Array(capacity)
    this.buoyancy = new Float32Array(capacity)
    this.scale = new Float32Array(capacity)
    this.order = new Uint32Array(capacity)
    this.depth = new Float32Array(capacity)
    this.sorted = options.sorted

    const points = new THREE.Points(
      this.geometry,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          atlas: { value: atlas },
          grid: { value: new THREE.Vector2(COLS, ROWS) },
          frames: { value: FRAMES },
          animate: { value: options.animate ? 1 : 0 },
          whiten: { value: options.whiten ? 1 : 0 },
          fogNear: { value: VIEW.fogNear },
          fogFar: { value: VIEW.fogFar },
          pointScale: { value: FX.pointScale },
          maxPointSize: { value: FX.maxPointSize },
          nearFade: { value: FX.nearFade },
        },
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        blending: options.blending,
      }),
    )
    points.frustumCulled = false
    points.renderOrder = 3
    scene.add(points)
    this.material = points.material as THREE.ShaderMaterial
  }

  private readonly material: THREE.ShaderMaterial

  /** Push tuned values into the shader, so the tuner does not need a reload. */
  refresh(): void {
    this.material.uniforms.fogNear.value = VIEW.fogNear
    this.material.uniforms.fogFar.value = VIEW.fogFar
    this.material.uniforms.pointScale.value = FX.pointScale
    this.material.uniforms.maxPointSize.value = FX.maxPointSize
    this.material.uniforms.nearFade.value = FX.nearFade
  }

  emit(s: Spawn): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.capacity

    this.position.setXYZ(i, s.position.x, s.position.y, s.position.z)
    this.colour.setXYZ(i, s.colour.r, s.colour.g, s.colour.b)
    const b = i * 3
    this.velocity[b] = s.velocity.x
    this.velocity[b + 1] = s.velocity.y
    this.velocity[b + 2] = s.velocity.z
    this.life[i] = s.life
    this.span[i] = s.life
    this.drag[i] = s.drag ?? 0.4
    this.gravity[i] = s.gravity ?? -1.5
    this.diffusion[i] = s.diffusion ?? 0
    this.buoyancy[i] = s.buoyancy ?? 0
    this.scale[i] = s.size
    this.size.setX(i, s.size)
    this.alpha.setX(i, 1)
    this.age.setX(i, 0)
    this.angle.setX(i, Math.random() * Math.PI * 2)
  }

  update(dt: number, camera: THREE.Camera): void {
    const pos = this.position.array as Float32Array
    let live = 0

    for (let i = 0; i < this.capacity; i += 1) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      if (this.life[i] <= 0) continue

      const b = i * 3
      const keep = Math.exp(-this.drag[i] * dt)
      this.scale[i] += this.diffusion[i] * dt
      // Buoyancy rises with the particle's own size, so a puff accelerates
      // upward as it spreads. Straight from the reference engine's smoke.
      const lift = this.gravity[i] + this.scale[i] * this.buoyancy[i]

      this.velocity[b] *= keep
      this.velocity[b + 1] = this.velocity[b + 1] * keep + lift * dt
      this.velocity[b + 2] *= keep
      pos[b] += this.velocity[b] * dt
      pos[b + 1] += this.velocity[b + 1] * dt
      pos[b + 2] += this.velocity[b + 2] * dt

      const t = 1 - this.life[i] / this.span[i]
      this.age.setX(i, t)
      this.size.setX(i, this.scale[i])
      // Hold up through the first third, then fade — a puff that starts
      // vanishing immediately never reads as smoke.
      this.alpha.setX(i, t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7)

      this.order[live] = i
      if (this.sorted) {
        const dx = pos[b] - camera.position.x
        const dy = pos[b + 1] - camera.position.y
        const dz = pos[b + 2] - camera.position.z
        this.depth[i] = dx * dx + dy * dy + dz * dz
      }
      live += 1
    }

    // Alpha-blended smoke has to draw back to front or near puffs punch holes
    // in the ones behind them. Additive sparks do not care, so they skip this.
    if (this.sorted && live > 1) {
      const rank = this.ranking
      rank.length = live
      for (let i = 0; i < live; i += 1) rank[i] = this.order[i]
      rank.sort((a, c) => this.depth[c] - this.depth[a])
      for (let i = 0; i < live; i += 1) this.order[i] = rank[i]
    }

    this.live = live
    ;(this.index.array as Uint32Array).set(this.order.subarray(0, live))
    this.index.needsUpdate = true
    this.geometry.setDrawRange(0, live)
    this.position.needsUpdate = true
    this.colour.needsUpdate = true
    this.size.needsUpdate = true
    this.alpha.needsUpdate = true
    this.age.needsUpdate = true
    this.angle.needsUpdate = true
  }

  clear(): void {
    this.life.fill(0)
    this.geometry.setDrawRange(0, 0)
  }
}

const SMOKE = new THREE.Color()
const SPARK = new THREE.Color()
const P = new THREE.Vector3()
const V = new THREE.Vector3()

/**
 * The scene's effects, in two pools.
 *
 * Smoke is alpha blended, depth sorted and holds the atlas's soft first frame;
 * fire runs the whole flipbook additively. They are split because one material
 * cannot do two blend modes, and because only one of them needs sorting.
 */
export class Particles {
  private readonly smoke: Pool
  private readonly fire: Pool
  /** Where the camera is, so traps far off screen do not fill the pool. */
  private readonly viewpoint = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    const atlas = new THREE.TextureLoader().load(FX.atlas)
    atlas.colorSpace = THREE.SRGBColorSpace
    atlas.minFilter = THREE.LinearFilter
    atlas.magFilter = THREE.LinearFilter
    // The flipbook is sampled cell by cell; wrapping would bleed neighbours in.
    atlas.wrapS = THREE.ClampToEdgeWrapping
    atlas.wrapT = THREE.ClampToEdgeWrapping

    this.smoke = new Pool(scene, FX.smokeCapacity, atlas, {
      animate: false,
      whiten: true,
      blending: THREE.NormalBlending,
      sorted: true,
    })
    this.fire = new Pool(scene, FX.fireCapacity, atlas, {
      animate: true,
      whiten: false,
      blending: THREE.AdditiveBlending,
      sorted: false,
    })
  }

  setViewpoint(v: THREE.Vector3): void {
    this.viewpoint.copy(v)
  }

  /** False when a trap is too far off to be worth spending particles on. */
  visible(at: THREE.Vector3): boolean {
    return at.distanceToSquared(this.viewpoint) < FX.emitRange * FX.emitRange
  }

  /** A drifting puff: grows, and rises faster as it grows. */
  puff(at: THREE.Vector3, vel: THREE.Vector3, tint: number, life: number, size: number): void {
    if (!this.visible(at)) return
    this.smoke.emit({
      position: at,
      velocity: vel,
      colour: SMOKE.setHex(tint),
      life,
      size,
      drag: FX.smokeDrag,
      gravity: 0,
      diffusion: size * FX.smokeDiffusion,
      buoyancy: FX.smokeBuoyancy,
    })
  }

  /** A burst of flame that burns down through the flipbook into embers. */
  flame(at: THREE.Vector3, vel: THREE.Vector3, life: number, size: number): void {
    if (!this.visible(at)) return
    this.fire.emit({
      position: at,
      velocity: vel,
      colour: SPARK.setHex(0xffffff),
      life,
      size,
      drag: FX.fireDrag,
      gravity: FX.fireGravity,
    })
  }

  /**
   * Machinery hitting something: dust off the deck and a few sparks off the metal.
   * `spread` is the radius it throws to, `up` how hard it kicks.
   */
  impact(at: THREE.Vector3, spread: number, up: number, tint: number = FX.dustTint): void {
    if (!this.visible(at)) return
    for (let i = 0; i < FX.impactSmoke; i += 1) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * spread
      P.set(at.x + Math.cos(a) * r, at.y + Math.random() * 0.4, at.z + Math.sin(a) * r * 0.6)
      V.set(Math.cos(a) * spread * 1.6, up * (0.3 + Math.random() * 0.5), Math.sin(a) * spread)
      this.puff(P, V, tint, 0.9 + Math.random() * 0.7, 0.9 + Math.random() * 0.8)
    }
    for (let i = 0; i < FX.impactSparks; i += 1) {
      const a = Math.random() * Math.PI * 2
      P.set(at.x, at.y + 0.1, at.z)
      V.set(Math.cos(a) * (2 + Math.random() * 5), up * (0.6 + Math.random()), Math.sin(a) * (2 + Math.random() * 5))
      this.flame(P, V, 0.35 + Math.random() * 0.4, 0.5 + Math.random() * 0.5)
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    this.smoke.update(dt, camera)
    this.fire.update(dt, camera)
  }

  reset(): void {
    this.smoke.clear()
    this.fire.clear()
  }

  /** Re-read the tunables the shader holds as uniforms. */
  refresh(): void {
    this.smoke.refresh()
    this.fire.refresh()
  }

  /** Live counts against capacity, so a pool running dry is visible while tuning. */
  stats(): { smoke: string; fire: string } {
    return {
      smoke: `${this.smoke.live}/${this.smoke.capacity}`,
      fire: `${this.fire.live}/${this.fire.capacity}`,
    }
  }
}
