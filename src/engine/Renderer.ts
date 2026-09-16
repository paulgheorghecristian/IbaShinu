import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { CAMERA, COLORS, POST, SUN, UI, VIEW } from '../config'

/** Vertical gradient sky. Cheaper and moodier than a cubemap for a prototype. */
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Object space, not world. The sphere is centred on the camera, so this is
    // the direction being looked in. World space folds the camera's own position
    // into the gradient: three hundred metres down the course every vertex is
    // dominated by its z, the whole sky collapses onto one band of the gradient,
    // and it stops matching the fog that distant geometry fades into.
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 top;
  uniform vec3 bottom;
  uniform vec3 haze;
  void main() {
    float h = normalize(vDir).y * 0.5 + 0.5;
    vec3 c = mix(bottom, top, smoothstep(0.28, 0.78, h));
    // Everything at and below the horizon is exactly the fog colour, and the
    // gradient is only allowed above it. A raw ShaderMaterial gets no fog of its
    // own, and the course sits at or below the horizon from any playing camera —
    // so if the backdrop there is not what geometry fades into, every distant
    // object is a silhouette that blinks out when it reaches the far plane.
    gl_FragColor = vec4(mix(haze, c, smoothstep(0.5, 0.75, h)), 1.0);
    // These uniforms are Colors, so they are in the renderer's linear working
    // space. Scene fog, by contrast, is mixed in *after* the colour-space step
    // and so lands on screen as its literal hex. Without converting here the sky
    // renders about four times too dark, every distant object emerges from the
    // haze as a bright shape against near-black, and no amount of moving the fog
    // planes around fixes it.
    #include <colorspace_fragment>
  }
`

export class Renderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly sun: THREE.DirectionalLight

  private readonly shadowFocus = new THREE.Vector3()
  private readonly sky: THREE.Mesh
  private readonly fill: THREE.HemisphereLight
  /** Built only if POST.enabled was set at load; null means draw straight out. */
  private composer: EffectComposer | null = null
  private ao: GTAOPass | null = null
  private bloom: UnrealBloomPass | null = null
  /** The depth texture the AO pass is currently reading, so it is only re-aimed on a change. */
  private aoDepth: THREE.DepthTexture | null = null

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: UI.antialias,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(this.pixelRatio())
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = SUN.exposure

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, VIEW.cameraFar)
    this.camera.position.set(0, 8, -12)

    this.scene.fog = new THREE.Fog(COLORS.fog, VIEW.fogNear, VIEW.fogFar)

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(VIEW.cameraFar * VIEW.skyRadius, 24, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(COLORS.sky) },
          bottom: { value: new THREE.Color(COLORS.horizon) },
          haze: { value: new THREE.Color(COLORS.fog) },
        },
      }),
    )
    this.sky.frustumCulled = false
    // Drawn before everything and never into the depth buffer, so it is a
    // backdrop rather than a thing in the world.
    this.sky.renderOrder = -1
    this.scene.add(this.sky)

    this.fill = new THREE.HemisphereLight(SUN.ambientSky, SUN.ambientGround, SUN.ambientIntensity)
    this.scene.add(this.fill)

    this.sun = new THREE.DirectionalLight(SUN.color, SUN.intensity)
    this.sun.position.set(SUN.offset.x, SUN.offset.y, SUN.offset.z)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(SUN.mapSize, SUN.mapSize)
    this.sun.shadow.bias = SUN.bias
    this.sun.shadow.normalBias = SUN.normalBias

    // With the sun perpendicular to the course, the shadow camera's own X axis
    // lands on world -Z, so `left`/`right` is the stretch of course covered and
    // `top`/`bottom` spans the width plus the height the traps reach. Both are
    // kept tight: every metre of frustum is resolution and depth precision spent.
    const cam = this.sun.shadow.camera
    cam.near = SUN.near
    cam.far = SUN.far
    cam.left = -SUN.extentAlongCourse
    cam.right = SUN.extentAlongCourse
    cam.top = SUN.extentAcross
    cam.bottom = -SUN.extentAcross
    cam.updateProjectionMatrix()
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    // The composer builds itself on the first refresh that finds POST on, which
    // is also what puts the configured values into the passes before the first
    // frame rather than waiting for the tuner to nudge them.
    this.refresh()

    this.resize()
    window.addEventListener('resize', this.resize)
  }


  /**
   * Keeps the (small) shadow frustum centred on the action.
   *
   * The focus is quantised to whole shadow texels along the course and pinned to a
   * fixed height. Without that the depth map resamples every frame as you run and
   * the shadow edges crawl — which is fatal when the shadow is the thing you are
   * reading to decide where to stand.
   */
  trackShadows(focus: THREE.Vector3): void {
    const texel = (SUN.extentAlongCourse * 2) / SUN.mapSize
    this.shadowFocus.set(
      Math.round(focus.x / texel) * texel,
      SUN.focusHeight,
      Math.round(focus.z / texel) * texel,
    )
    this.sun.target.position.copy(this.shadowFocus)
    this.sun.position.set(
      this.shadowFocus.x + SUN.offset.x,
      this.shadowFocus.y + SUN.offset.y,
      this.shadowFocus.z + SUN.offset.z,
    )
    this.sun.target.updateMatrixWorld()
  }

  /** Drawing-buffer scale, the same in every render path. */
  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio, UI.pixelRatio)
  }

  private resize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setPixelRatio(this.pixelRatio())
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (!this.composer) return

    // In drawing-buffer pixels, not CSS ones: EffectComposer sizes its targets
    // to exactly what it is given.
    const ratio = this.renderer.getPixelRatio()
    const cw = Math.max(1, Math.round(w * ratio * POST.resolutionScale))
    const ch = Math.max(1, Math.round(h * ratio * POST.resolutionScale))
    this.composer.setSize(cw, ch)
    this.syncDepthSize(cw, ch)
    this.bloom?.setSize(cw, ch)
    // Sized against the chain rather than the canvas, so the two scales compose.
    this.ao?.setSize(
      Math.max(1, Math.round(cw * POST.ao.resolutionScale)),
      Math.max(1, Math.round(ch * POST.ao.resolutionScale)),
    )
  }

  /**
   * Point the AO pass at the depth of the buffer the scene was actually drawn into.
   *
   * RenderPass draws into the composer's *read* buffer, and that starts life as
   * `renderTarget2` rather than 1. Which buffer it is then flips whenever a frame
   * performs an odd number of swaps, and that depends on which passes are
   * enabled — turning AO off removes one, so toggling it inverts the pairing for
   * every frame after. Handing the pass a single depth texture once, at build
   * time, therefore aims it at a target the scene is never drawn into: the AO
   * samples cleared depth, finds nothing to occlude, and quietly does nothing.
   * Following the read buffer costs one reference comparison a frame.
   */
  private aimAoAtSceneDepth(): void {
    if (!this.ao || !this.composer || !POST.ao.reuseDepth) return
    const depth = this.composer.readBuffer.depthTexture
    if (!depth || depth === this.aoDepth) return
    // undefined for the normal texture deliberately: with none, the shader
    // compiles its reconstruct-from-depth path and the G-buffer pass stays off.
    this.ao.setGBuffer(depth, undefined)
    this.aoDepth = depth
  }

  /**
   * Keep the depth attachment the same size as the colour one.
   *
   * `RenderTarget.setSize` resizes the colour textures and stops there, so a
   * depth texture holds whatever size it was built at and the first window
   * resize leaves the framebuffer with attachments of two different sizes —
   * incomplete, and the MSAA resolve fails on every frame after. The composer
   * ping-pongs between two targets and the second is a clone carrying a depth
   * texture of its own, so both need telling.
   */
  private syncDepthSize(w: number, h: number): void {
    if (!this.composer) return
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      const depth = target.depthTexture
      if (!depth || (depth.image.width === w && depth.image.height === h)) continue
      depth.image.width = w
      depth.image.height = h
      depth.needsUpdate = true
    }
  }

  /**
   * The composer path.
   *
   * `antialias: true` buys MSAA on the default framebuffer, and nothing drawn
   * through a composer ever reaches it — so the target asks for samples of its
   * own. Half-float, because bloom needs headroom above 1.0 to have anything to
   * find.
   */
  private buildComposer(): void {
    const size = this.renderer.getSize(new THREE.Vector2())
    // The render pass writes depth here and the AO pass reads it back, which is
    // what lets the AO skip re-rendering the scene. Multisampling is no
    // obstacle — three resolves the depth buffer into this texture, and
    // `resolveDepthBuffer` is on by default — but the resolve is a
    // `blitFramebuffer`, and that rejects a depth-only renderbuffer blitted
    // into a depth+stencil texture. `stencilBuffer` is false on a render target
    // unless asked for, so the buffer being resolved is DEPTH_COMPONENT24 and
    // the texture has to say the same. GTAOPass's own G-buffer uses
    // depth+stencil, which is fine there because nothing ever blits it; copy
    // that choice here and every frame logs GL_INVALID_OPERATION and the AO
    // reads whatever stale depth it can find.
    let depthTexture: THREE.DepthTexture | null = null
    if (POST.ao.reuseDepth) {
      depthTexture = new THREE.DepthTexture(size.x, size.y)
      depthTexture.format = THREE.DepthFormat
      depthTexture.type = THREE.UnsignedIntType
    }
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: POST.samples,
      depthTexture,
    })
    const composer = new EffectComposer(this.renderer, target)
    // RenderPass draws into the read buffer and does not swap, so the depth
    // above is the depth of the frame the AO pass is about to shade.
    composer.addPass(new RenderPass(this.scene, this.camera))
    this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y)
    composer.addPass(this.ao)
    this.bloom = new UnrealBloomPass(size, POST.bloom.strength, POST.bloom.radius, POST.bloom.threshold)
    composer.addPass(this.bloom)
    // Tone mapping and the colour-space conversion happen here instead of in
    // each material: three turns those off in-shader when drawing into a
    // render target, and this pass puts them back at the end.
    composer.addPass(new OutputPass())
    this.composer = composer
  }

  /** What the post chain is actually running at. Surfaced for the frame counter. */
  get postSize(): { width: number; height: number } | null {
    if (!this.composer || !POST.enabled) return null
    const t = this.composer.renderTarget1
    return { width: t.width, height: t.height }
  }


  /**
   * Re-read the tunables that were copied into objects when the scene was built.
   *
   * Anything read per frame follows the config on its own; these do not, and the
   * tuning panel would otherwise appear to do nothing when they are dragged.
   */
  refresh(): void {
    // Built here rather than in the constructor, and on demand rather than once.
    // Gating construction on the value POST.enabled happened to hold at load
    // left `ao` and `bloom` null for the rest of the session whenever post was
    // off, and every POST.ao / POST.bloom control in the tuner then did nothing
    // at all — silently, because neither is listed as needing a reload. The only
    // way back was to toggle POST, which does ask for one. Building on first use
    // makes all of it live, and the branch in render() still decides whether the
    // chain is drawn through at all.
    if (POST.enabled && !this.composer) this.buildComposer()

    this.renderer.toneMappingExposure = SUN.exposure
    this.sun.color.setHex(SUN.color)
    this.sun.intensity = SUN.intensity
    this.fill.color.setHex(SUN.ambientSky)
    this.fill.groundColor.setHex(SUN.ambientGround)
    this.fill.intensity = SUN.ambientIntensity

    this.resize()
    if (this.ao) {
      this.ao.enabled = POST.ao.enabled
      this.ao.blendIntensity = POST.ao.blend
      this.ao.output = POST.ao.debugOutput
      this.ao.updateGtaoMaterial({
        radius: POST.ao.radius,
        distanceExponent: POST.ao.distanceExponent,
        thickness: POST.ao.thickness,
        scale: POST.ao.scale,
        samples: POST.ao.samples,
      })
      this.ao.updatePdMaterial({
        samples: POST.ao.denoiseSamples,
        rings: POST.ao.denoiseRings,
      })
    }
    if (this.bloom) {
      this.bloom.enabled = POST.bloom.enabled
      this.bloom.strength = POST.bloom.strength
      this.bloom.radius = POST.bloom.radius
      this.bloom.threshold = POST.bloom.threshold
    }

    this.camera.fov = CAMERA.fov
    this.camera.far = VIEW.cameraFar
    this.camera.updateProjectionMatrix()

    const fog = this.scene.fog as THREE.Fog
    fog.color.setHex(COLORS.fog)
    fog.near = VIEW.fogNear
    fog.far = VIEW.fogFar
    const haze = (this.sky.material as THREE.ShaderMaterial).uniforms
    haze.haze.value.setHex(COLORS.fog)
    haze.top.value.setHex(COLORS.sky)
    haze.bottom.value.setHex(COLORS.horizon)

    const cam = this.sun.shadow.camera
    cam.near = SUN.near
    cam.far = SUN.far
    cam.left = -SUN.extentAlongCourse
    cam.right = SUN.extentAlongCourse
    cam.top = SUN.extentAcross
    cam.bottom = -SUN.extentAcross
    cam.updateProjectionMatrix()
    this.sun.shadow.bias = SUN.bias
    this.sun.shadow.normalBias = SUN.normalBias
  }

  render(): void {
    // The sky is a sphere a little inside the far plane, so it has to travel with
    // the camera. Left at the origin it is a 72 m bubble around the start line,
    // and every course here is far longer than that — run past it and the
    // backdrop becomes the clear colour, with scenery emerging from flat black.
    this.sky.position.copy(this.camera.position)
    if (this.composer && POST.enabled) {
      this.aimAoAtSceneDepth()
      this.composer.render()
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }
}
