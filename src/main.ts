import * as THREE from 'three'
import { Physics } from './engine/Physics'
import { Renderer } from './engine/Renderer'
import { Input, type InputFrame } from './engine/Input'
import { CameraRig } from './engine/CameraRig'
import { Course } from './world/Course'
import { Runner } from './entities/Runner'
import { AiBrain } from './entities/AiBrain'
import { TrapSystem } from './traps/TrapSystem'
import { Particles } from './world/Particles'
import { Tuner } from './ui/Tuner'
import { FpsMeter } from './ui/FpsMeter'
import { DogModel } from './world/DogModel'
import { selectLevel, LEVELS } from './levels'
import { Hud, formatTime, type BoardEntry } from './ui/Hud'
import { COLORS, DOG_NAMES, RACE, AI, DOG } from './config'

type Phase = 'countdown' | 'racing' | 'over'

/** Seconds the run keeps going after the first racer crosses, when bots are on. */
const POST_FINISH_GRACE = 14
const BEST_TIME_KEY = 'ibaShinu.bestTime'

/** `?debug` adds the manual trap bar and number-key firing. */
const DEBUG = new URLSearchParams(window.location.search).has('debug')

class Game {
  private readonly renderer: Renderer
  private readonly input: Input
  private readonly rig = new CameraRig()
  private readonly hud = new Hud()
  private readonly course: Course
  private readonly traps: TrapSystem
  private readonly particles: Particles
  private readonly runners: Runner[] = []
  /** One per runner; `null` for the runner you are driving. */
  private readonly brains: Array<AiBrain | null> = []
  private readonly player: Runner

  private phase: Phase = 'countdown'
  private countdown = RACE.countdownSeconds
  private lastCount = -1
  private raceTime = 0
  private elapsed = 0
  private finishGrace = 0
  private hudTimer = 0
  private alpha = 0
  private bestTime: number | null = null
  private lastFrameTime = performance.now()

  private readonly focus = new THREE.Vector3()

  constructor(private readonly physics: Physics, canvas: HTMLCanvasElement, dogs: DogModel | null) {
    this.renderer = new Renderer(canvas)
    this.input = new Input(canvas)
    this.course = new Course(physics, this.renderer.scene, selectLevel())
    this.particles = new Particles(this.renderer.scene)
    this.traps = new TrapSystem(physics, this.renderer.scene, this.course, this.particles)

    const total = RACE.aiCount + 1
    const spawns = this.course.startPositions(total)
    const playerSlot = Math.floor(total / 2)
    const names = [...DOG_NAMES].sort(() => Math.random() - 0.5)

    for (let i = 0; i < total; i += 1) {
      const isPlayer = i === playerSlot
      const color = isPlayer ? COLORS.player : COLORS.ai[i % COLORS.ai.length]
      this.runners.push(
        new Runner(
          physics,
          this.renderer.scene,
          spawns[i],
          isPlayer ? 'You' : names[i % names.length],
          color,
          isPlayer,
          dogs ? dogs.instance(isPlayer ? DOG.baseTint : color) : null,
        ),
      )
      this.brains.push(isPlayer ? null : new AiBrain(randomSkill()))
    }
    this.player = this.runners[playerSlot]

    this.bestTime = readBestTime()
    this.hud.setLevel(this.course.level, LEVELS)
    this.hud.configure({ board: total > 1, trapBar: DEBUG })
    if (DEBUG) this.hud.buildTrapBar(this.traps.traps)
    this.rig.update(this.renderer.camera, this.player.position, 0, physics, true)
  }

  start(): void {
    // Set here, not at construction: the clock would otherwise carry however long
    // the player spent looking at the title screen into the first frame's delta.
    this.lastFrameTime = performance.now()
    this.hud.toast('READY', 0.8)
    requestAnimationFrame(this.frame)
  }

  // -------------------------------------------------------------------------

  private frame = (now: number) => {
    requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000)
    this.lastFrameTime = now

    this.handleControls()
    this.alpha = this.physics.step(dt, (fixedDt) => this.fixedStep(fixedDt))
    this.draw(dt)
    this.input.endFrame()
  }

  private handleControls(): void {
    if (this.input.wasTapped('KeyR')) this.restart()

    // Mouse look is raw and unfiltered; see CameraRig. Held-drag is the fallback
    // for contexts where pointer lock is refused (embeds, some kiosk browsers).
    if (this.input.pointerLocked || this.input.dragging) {
      this.rig.applyMouse(this.input.mouseDx, this.input.mouseDy)
    }
    if (!this.input.pointerLocked && this.input.clicked) this.input.requestPointerLock()

    if (!DEBUG) return
    for (let i = 0; i < this.traps.traps.length; i += 1) {
      if (this.input.wasTapped(this.traps.traps[i].spec.key)) this.traps.fire(i)
    }
  }

  // -------------------------------------------------------------------------

  private fixedStep(dt: number): void {
    this.elapsed += dt

    if (this.phase === 'countdown') {
      this.countdown -= dt
      const remaining = Math.ceil(this.countdown)
      if (remaining !== this.lastCount && remaining > 0) {
        this.lastCount = remaining
        this.hud.toast(String(remaining), 0.9)
      }
      if (this.countdown <= 0) {
        this.phase = 'racing'
        this.hud.toast('GO', 0.8)
      }
    } else if (this.phase === 'racing' && this.finishGrace > 0) {
      this.finishGrace -= dt
      if (this.finishGrace <= 0) this.endRun()
    }

    if (this.phase === 'racing' && this.player.state === 'racing') this.raceTime += dt

    this.course.update(this.elapsed)
    this.traps.update(dt, this.elapsed, this.runners)

    const live = this.phase === 'racing'
    for (let i = 0; i < this.runners.length; i += 1) {
      const runner = this.runners[i]
      const wasRacing = runner.state === 'racing'
      let frame: InputFrame | null = null

      if (live && wasRacing) {
        const brain = this.brains[i]
        frame = brain
          ? brain.think(runner, this.course, this.physics, dt, this.elapsed)
          : this.input.sample(this.rig.yaw)
      }

      runner.fixedUpdate(dt, frame, this.course, this.raceTime)
      runner.updateCheckpoints(this.course)

      if (wasRacing && runner.state === 'finished') this.onFinish(runner)
    }
  }

  private onFinish(runner: Runner): void {
    const time = runner.finishTime ?? this.raceTime

    if (runner === this.player) {
      const record = this.bestTime === null || time < this.bestTime
      if (record) {
        this.bestTime = time
        writeBestTime(time)
      }
      this.hud.toast(`${record ? 'NEW BEST' : 'FINISHED'}\n${formatTime(time)}`, 4)
      if (this.runners.length === 1) {
        this.endRun()
        return
      }
    }

    if (this.finishGrace <= 0) this.finishGrace = POST_FINISH_GRACE
    if (this.runners.every((r) => r.finishTime !== null)) this.endRun()
  }

  private endRun(): void {
    if (this.phase === 'over') return
    this.phase = 'over'
    this.finishGrace = 0
    const winner = this.rankings()[0]
    const headline = this.runners.length === 1 ? 'R to run again' : `${winner.name} wins · R to race again`
    this.hud.toast(headline, 8, true)
  }

  private restart(): void {
    const spawns = this.course.startPositions(this.runners.length)
    this.runners.forEach((runner, i) => {
      runner.reset(spawns[i])
      if (this.brains[i]) this.brains[i] = new AiBrain(randomSkill())
    })
    this.traps.reset()
    this.particles.reset()
    this.phase = 'countdown'
    this.countdown = RACE.countdownSeconds
    this.lastCount = -1
    this.raceTime = 0
    this.elapsed = 0
    this.finishGrace = 0
    this.input.clearJumpLatch()
    this.hud.toast('RESET', 0.7)
    this.rig.update(this.renderer.camera, this.player.position, 0, this.physics, true)
  }

  // -------------------------------------------------------------------------

  private rankings(): Runner[] {
    return [...this.runners].sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime
      if (a.finishTime !== null) return -1
      if (b.finishTime !== null) return 1
      return b.progress - a.progress
    })
  }

  private draw(dt: number): void {
    for (const runner of this.runners) runner.syncMesh(dt, this.alpha)

    // Follow the interpolated ball, not the simulation one, or the camera
    // reintroduces exactly the judder the interpolation just removed.
    this.focus.copy(this.player.renderPosition)
    this.rig.update(this.renderer.camera, this.focus, dt, this.physics)
    this.renderer.trackShadows(this.focus)
    this.traps.drawMarkers(this.elapsed, this.renderer.camera.position)
    // Integrated per rendered frame rather than per tick: particles touch nothing
    // the simulation reads, and at 60 ticks they would judder on a 144 Hz screen.
    this.particles.setViewpoint(this.renderer.camera.position)
    this.particles.update(dt, this.renderer.camera)
    this.hud.tickToast(dt)

    this.hudTimer -= dt
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08
      this.updateHud()
    }

    this.renderer.render()
  }

  private updateHud(): void {
    this.hud.setStats(
      this.phase === 'countdown' ? 0 : this.raceTime,
      this.bestTime,
      `${this.player.checkpointIndex + 1}/${this.course.checkpoints.length}`,
      this.player.falls,
    )
    this.hud.setMeters(this.player.stamina / 100, this.player.sprintStamina / 100)
    if (DEBUG) this.hud.updateTrapBar(this.traps.traps)

    if (this.runners.length > 1) {
      const entries: BoardEntry[] = this.rankings().map((runner) => ({
        name: runner.name,
        color: runner.color,
        isPlayer: runner.isPlayer,
        progress: Math.max(0, Math.min(1, runner.progress / this.course.finishZ)),
        finishTime: runner.finishTime,
        down: runner.state === 'respawning',
      }))
      this.hud.setBoard(entries)
    }
  }

  /** Dev-only: drop the runner at a course Z to inspect a section. */
  teleport(z: number): void {
    this.player.body.setTranslation({ x: 0, y: 2.2, z }, true)
    this.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.player.snapRender()
    this.player.updateCheckpoints(this.course)
  }

  /** Dev-only: height of the surface under a point, or null if there is none. */
  floorAt(x: number, z: number, from = 14): number | null {
    const hit = this.physics.rayDistance({ x, y: from, z }, { x: 0, y: -1, z: 0 }, from + 30)
    return hit === null ? null : +(from - hit).toFixed(2)
  }

  /** Dev-only: a summary of the built course. */
  get courseInfo() {
    return {
      level: this.course.level.id,
      finishZ: this.course.finishZ,
      checkpoints: this.course.checkpoints.length,
      routeNodes: this.course.waypoints.length,
      dropTiles: this.course.dropTiles.length,
    }
  }

  /** Dev-only: the scene graph, for reaching into the model from tests. */
  get renderScene() {
    return this.renderer.scene
  }

  /** Dev-only: park the runner at an exact spot, for probing edge cases. */
  place(x: number, y: number, z: number): void {
    this.player.body.setTranslation({ x, y, z }, true)
    this.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.player.snapRender()
  }

  /** Dev-only: shove the runner, for probing ledge and coyote behaviour. */
  push(x: number, y: number, z: number): void {
    this.player.body.setLinvel({ x, y, z }, true)
  }

  /** What the frame is actually being drawn at, post chain included. */
  renderSize(): string {
    const buffer = this.renderer.renderer.getDrawingBufferSize(new THREE.Vector2())
    const post = this.renderer.postSize
    const canvas = `${buffer.x}x${buffer.y}`
    return post ? `${canvas} · post ${post.width}x${post.height}` : canvas
  }

  /**
   * Re-read the tunables that were copied out of the config when things were
   * built. Everything read per tick follows the config without being told.
   */
  refreshTuning(): void {
    this.renderer.refresh()
    this.particles.refresh()
    this.physics.refresh()
  }

  /** Dev-only introspection, surfaced on `window.ibaShinu` for tuning sessions. */
  debug() {
    return {
      phase: this.phase,
      raceTime: this.raceTime,
      best: this.bestTime,
      camera: {
        yaw: +this.rig.yaw.toFixed(3),
        pitch: +this.rig.pitch.toFixed(3),
        x: +this.renderer.camera.position.x.toFixed(2),
        y: +this.renderer.camera.position.y.toFixed(2),
        z: +this.renderer.camera.position.z.toFixed(2),
      },
      runners: this.runners.map((r) => {
        const v = r.body.linvel()
        return {
          name: r.name,
          isPlayer: r.isPlayer,
          x: +r.position.x.toFixed(3),
          z: +r.progress.toFixed(2),
          y: +r.position.y.toFixed(2),
          speed: +Math.hypot(v.x, v.z).toFixed(2),
          speedY: +v.y.toFixed(2),
          state: r.state,
          grounded: r.grounded,
          jumps: r.jumps,
          windup: +r.windupProgress.toFixed(2),
          falls: r.falls,
          checkpoint: r.checkpointIndex,
          gliding: r.gliding,
          dogJumpTime: +r.dogJumpTime.toFixed(3),
          sprinting: r.sprinting,
          weights: r.dogWeights,
          sprintStamina: +r.sprintStamina.toFixed(1),
          finishTime: r.finishTime,
        }
      }),
      particles: this.particles.stats(),
      traps: this.traps.traps.map((t) => ({
        label: t.spec.label,
        active: t.active,
        nextFire: +t.autoTimer.toFixed(2),
        cooldown: +t.cooldownLeft.toFixed(2),
      })),
    }
  }
}

const randomSkill = (): number => AI.skillMin + Math.random() * (AI.skillMax - AI.skillMin)

function readBestTime(): number | null {
  try {
    const raw = window.localStorage.getItem(BEST_TIME_KEY)
    const value = raw === null ? NaN : Number.parseFloat(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null // private browsing, storage disabled — a missing best time is harmless
  }
}

function writeBestTime(time: number): void {
  try {
    window.localStorage.setItem(BEST_TIME_KEY, String(time))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)

  const overlay = document.getElementById('overlay') as HTMLDivElement
  const button = document.getElementById('startBtn') as HTMLButtonElement
  const label = document.getElementById('btnLabel') as HTMLSpanElement

  // The model is optional: if it fails to load the prototype still runs on balls.
  const [physics, dogs] = await Promise.all([Physics.create(), DogModel.load()])
  const game = new Game(physics, canvas, dogs)

  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).ibaShinu = game
  }

  new FpsMeter(() => game.renderSize())
  const tuner = new Tuner(() => game.refreshTuning())
  if (new URLSearchParams(window.location.search).has('tune')) tuner.toggle()

  label.textContent = 'Start Run'
  button.disabled = false
  button.addEventListener('click', () => {
    overlay.classList.add('hidden')
    void canvas.requestPointerLock()
    game.start()
  })
}

void boot().catch((err) => {
  console.error(err)
  const label = document.getElementById('btnLabel')
  if (label) label.textContent = 'Failed to load — see console'
})
