/**
 * Single source of truth for device input.
 *
 * Deliberately shaped like a network input frame: the per-tick struct returned by
 * `sample()` is exactly what a client would serialise and send to an authoritative
 * server, which is what makes client-side prediction possible later.
 *
 * Keyboard and touch are merged here rather than picked between, so a laptop
 * with a touchscreen simply has both. Touch is shaped for a phone held in two
 * hands: the first finger down is the run finger — hold it to run, slide it
 * sideways to steer — and any finger after it is the action finger, which
 * presses to jump and holds to glide, exactly as the space bar does.
 *
 * The feint is that same action finger, still held after the press, sliding
 * down the glass. It is its own signal rather than a second press, so a
 * second press can always mean glide and nobody feints reaching for one.
 *
 * One thumb works too. A run finger that lifts again almost at once, without
 * having steered, was a tap rather than a hold, and counts as a press — so
 * hold to run, let go and tap to jump. The glide and the feint need the
 * second finger, because both are things done with a finger that stays down.
 */

import { TOUCH } from '../config'

export interface InputFrame {
  forward: number
  right: number
  jump: boolean
  /** Rising edge only — consumed once per fixed step. */
  jumpPressed: boolean
  /** Rising edge only. Turn the jump in progress into the flip back. */
  fakePressed: boolean
  sprint: boolean
  /** Camera yaw at the moment of sampling; movement is resolved against it. */
  yaw: number
}

/** The finger that is held to run, and where and when it went down. */
interface RunTouch {
  id: number
  startX: number
  startY: number
  x: number
  y: number
  startAt: number
  /** Ever pushed past the dead zone. A finger that steered was not a tap. */
  steered: boolean
  /** Pushed up far enough to sprint; held with hysteresis. */
  sprinting: boolean
}

export class Input {
  private readonly down = new Set<string>()
  private readonly tapped = new Set<string>()
  /**
   * Set on keydown, cleared only when a simulation tick actually consumes it.
   *
   * It deliberately does NOT reset per rendered frame: a frame can complete
   * without advancing the fixed-step simulation at all (it always does on a
   * display faster than the tick rate), and clearing the edge there throws the
   * press away before anything has read it.
   */
  private jumpLatched = false
  /** Same lifetime as the jump latch, for the same reason. */
  private fakeLatched = false

  private runTouch: RunTouch | null = null
  /** The action finger while it is down. */
  private actionTouch: {
    id: number
    startY: number
    startAt: number
    /** Landed with the dog already off the ground, so its slide counts at once. */
    inAir: boolean
    /** Can no longer feint: it was a swipe from the start, or it already has. */
    spent: boolean
  } | null = null
  /**
   * Whether the dog is off the ground, told to us by the game each frame. It
   * decides what a finger landing now means — a press on the ground is a jump,
   * and its slide has to wait for the jump to leave; a press in the air is not.
   */
  airborne = false
  /** True once any finger has touched the canvas. Locks the pointer no more. */
  touched = false
  /** The steer as the simulation sees it: the thumb's, eased over a few ticks. */
  private steerEased = 0

  mouseDx = 0
  mouseDy = 0
  wheel = 0
  clicked = false
  dragging = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.release)
    // Hand the cursor back before the page goes away. Nothing else releases the
    // lock, so without these the pointer stays captured as the tab is torn down
    // and the user is left with a mouse that appears dead. `pagehide` covers
    // closing and navigating (including into the bfcache); `visibilitychange`
    // covers being backgrounded.
    window.addEventListener('pagehide', this.release)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    canvas.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    // Not passive: the default for a touch on the canvas is to scroll, zoom, or
    // synthesise a click, and every one of those has to be refused.
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false })
    canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false })
  }

  /** True while the keystroke belongs to a field on a panel, not to the game. */
  private typing(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null
    return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Typing a value into the tuning panel must not also drive the dog, and R
    // in a text field must not restart the run.
    if (this.typing(e)) return
    // Let the browser keep its own shortcuts, but claim the ones we drive on.
    if (['Tab', 'Space', 'KeyR'].includes(e.code)) e.preventDefault()
    if (!this.down.has(e.code)) {
      this.tapped.add(e.code)
      if (e.code === 'Space') this.jumpLatched = true
      if (e.code === 'KeyF') this.fakeLatched = true
    }
    this.down.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code)
  }

  /** Drop every held input and give the cursor back. */
  private release = () => {
    this.down.clear()
    this.tapped.clear()
    this.jumpLatched = false
    this.fakeLatched = false
    this.dragging = false
    this.runTouch = null
    this.actionTouch = null
    this.steerEased = 0
    this.exitPointerLock()
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.release()
  }

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.canvas) {
      this.mouseDx += e.movementX
      this.mouseDy += e.movementY
    } else if (this.dragging) {
      this.mouseDx += e.movementX
      this.mouseDy += e.movementY
    }
  }

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.clicked = true
      this.dragging = true
    }
  }

  private onMouseUp = () => {
    this.dragging = false
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.wheel += e.deltaY
  }

  // --- touch ---------------------------------------------------------------

  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault()
    this.touched = true
    const now = performance.now()
    for (const t of Array.from(e.changedTouches)) {
      if (this.runTouch === null) {
        // A lone finger's tap is only known on the way up: until then it is a
        // hold like any other.
        this.runTouch = {
          id: t.identifier,
          startX: t.clientX,
          startY: t.clientY,
          x: t.clientX,
          y: t.clientY,
          startAt: now,
          steered: false,
          sprinting: false,
        }
        continue
      }
      if (this.actionTouch !== null) continue
      this.actionTouch = {
        id: t.identifier,
        startY: t.clientY,
        startAt: now,
        inAir: this.airborne,
        spent: false,
      }
      // Read on the way down, not up, so a jump costs no more latency on glass
      // than on a key.
      this.jumpLatched = true
    }
  }

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault()
    for (const t of Array.from(e.changedTouches)) {
      if (this.runTouch && t.identifier === this.runTouch.id) {
        const run = this.runTouch
        run.x = t.clientX
        run.y = t.clientY
        // Steered means deliberately: a thumb wobbles a few px just landing,
        // and that must not cost it the tap.
        if (Math.hypot(t.clientX - run.startX, t.clientY - run.startY) > TOUCH.swipeJitter) {
          run.steered = true
        }
        // Up is sprint. Engaged at the line, let go a little below it.
        const up = run.startY - run.y
        run.sprinting = up > (run.sprinting ? TOUCH.sprintUp * TOUCH.sprintRelease : TOUCH.sprintUp)
      }
      // The jump finger sliding down is the feint — once per press, so a
      // finger that keeps travelling does not keep asking. A finger that
      // landed on the ground pressed a jump, and has to rest before its slide
      // counts; moving during the rest makes it a swipe, which is only the jump.
      const action = this.actionTouch
      if (action && t.identifier === action.id && !action.spent) {
        const dy = t.clientY - action.startY
        const resting = action.inAir || performance.now() - action.startAt >= TOUCH.swipeDelayMs
        if (!resting) {
          if (Math.abs(dy) > TOUCH.swipeJitter) action.spent = true
        } else if (dy > TOUCH.swipeDown) {
          action.spent = true
          this.fakeLatched = true
          // The flip resets the dog to straight ahead, so the stick resets
          // with it: wherever the run thumb is now is the new centre, and it
          // walks straight off the landing until the thumb moves again.
          if (this.runTouch) {
            this.runTouch.startX = this.runTouch.x
            this.runTouch.startY = this.runTouch.y
            this.runTouch.sprinting = false
          }
        }
      }
    }
  }

  private onTouchEnd = (e: TouchEvent) => {
    e.preventDefault()
    const now = performance.now()
    for (const t of Array.from(e.changedTouches)) {
      if (this.runTouch && t.identifier === this.runTouch.id) {
        // Down and up again before a hold could have meant anything: a tap by
        // the only finger there is. Read on the way up, unavoidably, because
        // until then it is a hold like any other.
        const run = this.runTouch
        this.runTouch = null
        if (e.type === 'touchend' && !run.steered && now - run.startAt < TOUCH.tapMs) {
          this.jumpLatched = true
        }
      }
      if (this.actionTouch && t.identifier === this.actionTouch.id) this.actionTouch = null
    }
  }

  /**
   * The on-screen stick: where its ring sits and how far its knob is over.
   * The ring is centred on where the run finger landed — or on where it was
   * when a flip reset the steer — and there is no stick without the finger.
   */
  get stick(): { x: number; y: number; steer: number; up: number; sprinting: boolean } | null {
    const run = this.runTouch
    if (!run) return null
    const up = Math.max(0, Math.min(1, (run.startY - run.y) / TOUCH.sprintUp))
    return { x: run.startX, y: run.startY, steer: this.touchSteer(), up, sprinting: run.sprinting }
  }

  /** Steer from the run finger's sideways travel: -1..1 past a dead zone. */
  private touchSteer(): number {
    if (!this.runTouch) return 0
    const dx = this.runTouch.x - this.runTouch.startX
    const beyond = Math.max(0, Math.abs(dx) - TOUCH.deadZone)
    const span = Math.max(1, TOUCH.steerRange - TOUCH.deadZone)
    return Math.sign(dx) * Math.min(1, beyond / span)
  }

  // -------------------------------------------------------------------------

  isDown(code: string): boolean {
    return this.down.has(code)
  }

  /** True exactly once per key press, on the frame the key went down. */
  wasTapped(code: string): boolean {
    return this.tapped.has(code)
  }

  /** Register a press from somewhere other than the keyboard, e.g. a HUD button. */
  tap(code: string): void {
    this.tapped.add(code)
  }

  /** Axis helper: returns -1, 0 or 1 from a negative/positive key pair. */
  axis(negative: string, positive: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0)
  }

  /** Consumes one tick's worth of input. The latches are cleared here, and
   *  only here, so no press can be lost between rendered frames. */
  sample(yaw: number, dt: number): InputFrame {
    const jumpPressed = this.jumpLatched
    const fakePressed = this.fakeLatched
    this.jumpLatched = false
    this.fakeLatched = false

    // Hard steering on glass gives up some forward drive for sideways, or the
    // best a thumb could do is a 45° line and every turn would feel slow.
    // Eased toward the thumb rather than read raw, so a thumb that shifts a
    // few px in an instant leans the dog over instead of kicking it.
    const raw = this.touchSteer()
    const k = 1 - Math.exp(-dt / Math.max(1e-3, TOUCH.steerSmoothing))
    this.steerEased += (raw - this.steerEased) * k
    if (Math.abs(this.steerEased) < 1e-3) this.steerEased = 0
    const steer = this.steerEased
    const touchForward = this.runTouch ? 1 - TOUCH.steerBias * Math.abs(steer) : 0
    const frame: InputFrame = {
      forward: this.axis('KeyS', 'KeyW') + this.axis('ArrowDown', 'ArrowUp') + touchForward,
      right: this.axis('KeyA', 'KeyD') + this.axis('ArrowLeft', 'ArrowRight') + steer,
      jump: this.isDown('Space') || this.actionTouch !== null,
      jumpPressed,
      fakePressed,
      sprint: this.isDown('ShiftLeft') || this.isDown('ShiftRight') || this.runTouch?.sprinting === true,
      yaw,
    }
    frame.forward = Math.max(-1, Math.min(1, frame.forward))
    frame.right = Math.max(-1, Math.min(1, frame.right))
    return frame
  }

  /** Call once at the end of every rendered frame. */
  endFrame(): void {
    this.tapped.clear()
    this.mouseDx = 0
    this.mouseDy = 0
    this.wheel = 0
    this.clicked = false
  }

  /** Throw away latched presses that no longer apply, e.g. on a race reset. */
  clearJumpLatch(): void {
    this.jumpLatched = false
    this.fakeLatched = false
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.canvas) return
    // Browsers refuse for about a second after Esc, and reject rather than throw.
    // Unhandled, that is console noise on every click during the cooldown.
    const pending = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined
    pending?.catch(() => undefined)
  }

  exitPointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  /** Detach every listener and release the cursor. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.release)
    window.removeEventListener('pagehide', this.release)
    window.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.release()
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas
  }
}
