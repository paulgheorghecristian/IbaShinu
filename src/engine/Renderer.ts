import * as THREE from 'three'
import { CAMERA, COLORS, SUN, UI, VIEW } from '../config'

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

    // Push the tunables that were copied into objects at construction, so the
    // panel's saved values are in place before the first frame.
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
  }


  /**
   * Re-read the tunables that were copied into objects when the scene was built.
   *
   * Anything read per frame follows the config on its own; these do not, and the
   * tuning panel would otherwise appear to do nothing when they are dragged.
   */
  refresh(): void {
    this.renderer.toneMappingExposure = SUN.exposure
    this.sun.color.setHex(SUN.color)
    this.sun.intensity = SUN.intensity
    this.fill.color.setHex(SUN.ambientSky)
    this.fill.groundColor.setHex(SUN.ambientGround)
    this.fill.intensity = SUN.ambientIntensity

    this.resize()
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
    this.renderer.render(this.scene, this.camera)
  }
}
