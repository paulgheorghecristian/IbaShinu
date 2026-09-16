import { UI } from '../config'

const CSS = `
.fps {
  position: fixed; right: 12px; bottom: 26px; z-index: 38; pointer-events: none;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #9fb0c6; text-align: right; font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
.fps[hidden] { display: none; }
.fps b { color: #d7dee9; font-weight: 600; }
.fps .fps-worst { color: #7c8798; }
`

/**
 * Frame cost, in the corner.
 *
 * It keeps its own requestAnimationFrame rather than being driven by the game
 * loop, which means it still reports while the game is paused behind the start
 * overlay, and it cannot itself be the thing that stops updating when something
 * goes wrong. Callbacks scheduled for one frame all fire together, so it is
 * measuring the same frames the renderer is drawing.
 *
 * The worst frame in the window matters more than the average for a game like
 * this: a mean of 60 with a 120 ms spike in it is a missed landing.
 */
export class FpsMeter {
  /** Optional second line: what resolution the frame is actually being drawn at. */
  constructor(private readonly detail?: () => string) {
    this.build()
  }

  private readonly root = document.createElement('div')
  private readonly main = document.createElement('b')
  private readonly worstLabel = document.createElement('span')
  private frames = 0
  private since = 0
  private last = 0
  private worst = 0

  private build(): void {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.append(style)

    this.root.className = 'fps'
    this.worstLabel.className = 'fps-worst'
    this.root.append(this.main, document.createElement('br'), this.worstLabel)
    document.body.append(this.root)

    this.root.hidden = !UI.showFps
    this.since = performance.now()
    this.last = this.since
    requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    // Off means off: no per-frame work at all, just a slow poll for being
    // switched back on from the panel.
    if (!UI.showFps) {
      this.root.hidden = true
      this.frames = 0
      this.worst = 0
      this.since = this.last = performance.now()
      setTimeout(() => requestAnimationFrame(this.tick), 500)
      return
    }
    requestAnimationFrame(this.tick)
    const delta = now - this.last
    this.last = now
    this.frames += 1
    // Ignore the first frame after a tab comes back, which is not a real one.
    if (delta < 1000) this.worst = Math.max(this.worst, delta)

    const elapsed = now - this.since
    if (elapsed < UI.fpsWindow) return

    const ms = elapsed / this.frames
    this.main.textContent = `${Math.round(1000 / ms)} fps · ${ms.toFixed(1)} ms`
    this.worstLabel.textContent = this.detail
      ? `worst ${this.worst.toFixed(0)} ms · ${this.detail()}`
      : `worst ${this.worst.toFixed(0)} ms`
    this.frames = 0
    this.worst = 0
    this.since = now
    this.root.hidden = !UI.showFps
  }
}
