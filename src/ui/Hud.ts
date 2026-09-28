import type { Trap } from '../traps/Trap'

export interface BoardEntry {
  name: string
  color: number
  isPlayer: boolean
  /** 0..1 along the course. */
  progress: number
  finishTime: number | null
  down: boolean
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`HUD element #${id} is missing from index.html`)
  return node as T
}

export const formatTime = (seconds: number): string => {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`
}

/**
 * Plain DOM overlay. Text and bars are cheaper and far sharper in the DOM than in
 * the WebGL canvas, and it keeps the renderer free of UI concerns.
 */
export class Hud {
  private readonly clock = el('clock')
  private readonly best = el('best')
  private readonly cp = el('cp')
  private readonly falls = el('falls')
  private readonly staminaFill = el('staminaFill')
  private readonly sprintFill = el('sprintFill')
  private readonly glideMeter = el('glideMeter')
  private readonly runMeter = el('runMeter')
  private readonly board = el('board')
  private readonly boardList = el('boardList')
  private readonly trapBar = el('traps')
  private readonly metersEl = el('meters')
  private readonly crosshair = el('crosshair')
  private readonly enemyPanel = el('enemyPanel')
  private readonly enemyRunning = el('enemyRunning')
  private readonly enemyThrough = el('enemyThrough')
  private readonly enemyOut = el('enemyOut')
  private readonly enemyAim = el('enemyAim')
  private readonly runnerRows = Array.from(
    document.querySelectorAll<HTMLElement>('#status .runner-row'),
  )
  private readonly help = el('help')
  private readonly toastEl = el('toast')
  private readonly restartBtn = el<HTMLButtonElement>('restartBtn')
  private readonly stick = el('stick')
  private readonly stickKnob = el('stickKnob')
  private stickShown = false

  private readonly trapNodes: Array<{ root: HTMLElement; fill: HTMLElement }> = []
  private boardRows: HTMLElement[] = []
  private toastTimer = 0

  constructor() {
    this.help.innerHTML =
      '<b>Run</b><br>' +
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · mouse to look<br>' +
      '<kbd>Space</kbd> jump — hold while falling to <b>tail-glide</b><br>' +
      '<kbd>Shift</kbd> sprint · <kbd>F</kbd> mid-jump: <b>flip back</b><br>' +
      '<kbd>R</kbd> restart · <kbd>Esc</kbd> free mouse'
  }

  /**
   * The corner help for glass. Short, because on a phone this panel sits on
   * top of the course, and the title card has already said it in full.
   */
  useTouchHelp(): void {
    this.help.innerHTML =
      '<b>Run</b><br>' +
      'hold to run · slide to steer · push up to <b>sprint</b><br>' +
      'second finger: press to jump · hold to <b>glide</b><br>' +
      'slide it down while held to <b>flip back</b> · a quick tap of the run finger jumps too'
  }

  /**
   * The touch stick, once per rendered frame: a ring under the run finger and
   * a knob that slides across it with the steer. Visual only — the input is
   * already read from the finger — so it is drawn where the finger is rather
   * than the finger having to find it. The knob's travel is for the eye, not
   * the thumb: full lock is a nudge on the glass and would not read at scale.
   */
  setStick(
    stick: { x: number; y: number; steer: number; up: number; sprinting: boolean } | null,
  ): void {
    if (!stick) {
      if (this.stickShown) this.stick.style.display = 'none'
      this.stickShown = false
      return
    }
    if (!this.stickShown) this.stick.style.display = 'block'
    this.stickShown = true
    this.stick.style.left = `${stick.x}px`
    this.stick.style.top = `${stick.y}px`
    this.stickKnob.style.transform = `translate(${Math.round(stick.steer * 40)}px, ${-Math.round(stick.up * 40)}px)`
    this.stick.classList.toggle('steering', Math.abs(stick.steer) > 0.02 || stick.up > 0.02)
    this.stick.classList.toggle('sprinting', stick.sprinting)
  }

  /** The on-screen restart, for a device with no R key. */
  onRestart(handler: () => void): void {
    this.restartBtn.addEventListener('click', handler)
  }

  /** Swap the corner help for the gallery's, since none of the running keys apply. */
  useEnemyHelp(): void {
    this.help.innerHTML =
      '<b>Enemy</b><br>' +
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk the gallery · mouse to look<br>' +
      'every trap has one button, on the window in front of it<br>' +
      'stand at it and press <kbd>E</kbd> — a dark button is still cooling<br>' +
      '<kbd>R</kbd> restart · <kbd>Esc</kbd> free mouse'
  }

  /** Panels that only earn their space in some configurations. */
  configure(options: { board: boolean; trapBar: boolean; enemy?: boolean }): void {
    this.board.style.display = options.board ? 'block' : 'none'
    this.trapBar.style.display = options.trapBar ? 'flex' : 'none'
    // The runner's panels describe a dog you do not have in enemy mode: a
    // checkpoint you are not chasing and two stamina pools you cannot spend.
    const enemy = options.enemy === true
    this.runnerRows.forEach((row) => (row.style.display = enemy ? 'none' : ''))
    this.metersEl.style.display = enemy ? 'none' : ''
    this.enemyPanel.style.display = enemy ? 'block' : 'none'
    this.crosshair.style.display = enemy ? 'block' : 'none'
  }

  /**
   * The enemy's readout: what is left to stop, and what the console is offering.
   *
   * The aimed trap is named here rather than on the button, because a label on a
   * 30 cm box a metre away is either unreadable or the size of the button. The
   * cooldown is spelled out in seconds for the same reason the bar exists — it
   * is the only resource in the mode.
   */
  setEnemyStats(
    time: number,
    running: number,
    through: number,
    out: number,
    aimed: Trap | null,
    nearest: { label: string; ahead: number } | null,
  ): void {
    this.clock.textContent = formatTime(time)
    this.enemyRunning.textContent = String(running)
    this.enemyThrough.textContent = String(through)
    this.enemyOut.textContent = String(out)

    if (aimed) {
      const cooling = aimed.cooldownLeft > 0 || aimed.active
      const left = aimed.active ? aimed.spec.duration : aimed.cooldownLeft
      this.enemyAim.textContent = cooling
        ? `${aimed.spec.label} ${left.toFixed(1)}s`
        : aimed.spec.label
      this.enemyAim.className = cooling ? 'aim cooling' : 'aim ready'
      return
    }

    // Nothing in reach, so the readout becomes a signpost instead. Which way to
    // walk is the question the mode actually asks, and a bare dash does not
    // answer it in a corridor six hundred metres long.
    if (!nearest) {
      this.enemyAim.textContent = '—'
      this.enemyAim.className = 'aim'
      return
    }
    const way = nearest.ahead >= 0 ? 'ahead' : 'back'
    this.enemyAim.textContent = `${nearest.label} · ${Math.abs(Math.round(nearest.ahead))}m ${way}`
    this.enemyAim.className = 'aim'
  }

  /** Name the course on the title card, and link the others. */
  setLevel(
    current: { id: string; name: string; blurb: string },
    all: ReadonlyArray<{ id: string; name: string }>,
  ): void {
    const tag = document.querySelector('#overlay .tag')
    if (tag) tag.textContent = current.blurb

    const picker = document.getElementById('levelPicker')
    if (!picker) return
    picker.replaceChildren()
    for (const level of all) {
      const node = document.createElement(level.id === current.id ? 'b' : 'a')
      node.textContent = level.name
      if (node instanceof HTMLAnchorElement) node.href = `?level=${level.id}`
      picker.append(node)
    }
  }

  /**
   * The two ways to play, as links that keep whatever level is selected.
   *
   * A link rather than a button because the mode is read from the query string
   * once, at construction — every system that cares (who owns the traps, who
   * gets a camera, whether a dog is yours) is wired at startup, and a toggle
   * that promised to switch mid-run would be a lie.
   */
  setMode(isEnemy: boolean, levelId: string): void {
    const picker = document.getElementById('modePicker')
    if (!picker) return
    picker.replaceChildren()
    for (const mode of [
      { label: 'Play as dog', enemy: false },
      { label: 'Play as enemy', enemy: true },
    ]) {
      const active = mode.enemy === isEnemy
      const node = document.createElement(active ? 'b' : 'a')
      node.textContent = mode.label
      if (node instanceof HTMLAnchorElement) {
        node.href = `?level=${levelId}${mode.enemy ? '&enemy' : ''}`
      }
      picker.append(node)
    }
    const blurb = document.getElementById('enemyBlurb')
    if (blurb) blurb.style.display = isEnemy ? 'list-item' : 'none'
  }

  setStats(time: number, best: number | null, checkpoint: string, falls: number): void {
    this.clock.textContent = formatTime(time)
    this.best.textContent = best === null ? '—' : formatTime(best)
    this.cp.textContent = checkpoint
    this.falls.textContent = String(falls)
  }

  /** Both pools, as 0..1. They drain independently and are spent on different things. */
  setMeters(glide: number, sprint: number): void {
    this.staminaFill.style.width = `${Math.round(glide * 100)}%`
    this.sprintFill.style.width = `${Math.round(sprint * 100)}%`
    this.glideMeter.classList.toggle('low', glide < 0.2)
    this.runMeter.classList.toggle('low', sprint < 0.2)
  }

  buildTrapBar(traps: Trap[]): void {
    this.trapBar.replaceChildren()
    this.trapNodes.length = 0
    for (const trap of traps) {
      const root = document.createElement('div')
      root.className = 'trap'
      const key = document.createElement('b')
      key.className = 'key'
      const fill = document.createElement('i')
      fill.className = 'fill'
      const glyph = document.createElement('span')
      glyph.textContent = trap.spec.keyLabel
      key.append(fill, glyph)
      const label = document.createElement('span')
      label.className = 'lbl'
      label.textContent = trap.spec.label
      root.append(key, label)
      this.trapBar.append(root)
      this.trapNodes.push({ root, fill })
    }
  }

  updateTrapBar(traps: Trap[]): void {
    traps.forEach((trap, i) => {
      const node = this.trapNodes[i]
      if (!node) return
      const cooling = trap.cooldownLeft > 0 || trap.active
      const progress = trap.cooldownLeft > 0 ? 1 - trap.cooldownLeft / trap.spec.cooldown : 1
      node.fill.style.width = `${(trap.active ? 1 : progress) * 100}%`
      node.root.classList.toggle('cooling', cooling)
      node.root.classList.toggle('ready', !cooling)
    })
  }

  setBoard(entries: BoardEntry[]): void {
    if (this.boardRows.length !== entries.length) {
      this.boardList.replaceChildren()
      this.boardRows = entries.map(() => {
        const row = document.createElement('div')
        row.className = 'ent'
        row.innerHTML =
          '<span class="pos"></span><span class="dot"></span><span class="nm"></span><span class="pr"></span>'
        this.boardList.append(row)
        return row
      })
    }
    entries.forEach((entry, i) => {
      const row = this.boardRows[i]
      const [pos, dot, nm, pr] = Array.from(row.children) as HTMLElement[]
      pos.textContent = `${i + 1}`
      dot.style.background = `#${entry.color.toString(16).padStart(6, '0')}`
      nm.textContent = entry.name
      pr.textContent =
        entry.finishTime !== null ? formatTime(entry.finishTime) : `${Math.round(entry.progress * 100)}%`
      row.classList.toggle('me', entry.isPlayer)
      row.classList.toggle('done', entry.finishTime !== null)
      row.classList.toggle('dead', entry.down)
    })
  }

  toast(text: string, seconds = 1.2, small = false): void {
    this.toastEl.textContent = text
    this.toastEl.classList.toggle('sub', small)
    this.toastEl.classList.add('show')
    this.toastTimer = seconds
  }

  tickToast(dt: number): void {
    if (this.toastTimer <= 0) return
    this.toastTimer -= dt
    if (this.toastTimer <= 0) this.toastEl.classList.remove('show')
  }
}
