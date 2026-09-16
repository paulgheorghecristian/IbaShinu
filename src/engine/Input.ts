/**
 * Single source of truth for device input.
 *
 * Deliberately shaped like a network input frame: the per-tick struct returned by
 * `sample()` is exactly what a client would serialise and send to an authoritative
 * server, which is what makes client-side prediction possible later.
 */

export interface InputFrame {
  forward: number
  right: number
  jump: boolean
  /** Rising edge only — consumed once per fixed step. */
  jumpPressed: boolean
  sprint: boolean
  /** Camera yaw at the moment of sampling; movement is resolved against it. */
  yaw: number
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
  /** Dev counter: how many jump presses this Input has seen. */

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
    this.dragging = false
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

  isDown(code: string): boolean {
    return this.down.has(code)
  }

  /** True exactly once per key press, on the frame the key went down. */
  wasTapped(code: string): boolean {
    return this.tapped.has(code)
  }

  /** Axis helper: returns -1, 0 or 1 from a negative/positive key pair. */
  axis(negative: string, positive: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0)
  }

  /** Consumes one tick's worth of input. The jump latch is cleared here, and
   *  only here, so no press can be lost between rendered frames. */
  sample(yaw: number): InputFrame {
    const jumpPressed = this.jumpLatched
    this.jumpLatched = false

    const frame: InputFrame = {
      forward: this.axis('KeyS', 'KeyW') + this.axis('ArrowDown', 'ArrowUp'),
      right: this.axis('KeyA', 'KeyD') + this.axis('ArrowLeft', 'ArrowRight'),
      jump: this.isDown('Space'),
      jumpPressed,
      sprint: this.isDown('ShiftLeft') || this.isDown('ShiftRight'),
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

  /** Throw away a latched jump that no longer applies, e.g. on a race reset. */
  clearJumpLatch(): void {
    this.jumpLatched = false
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
