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
  private readonly help = el('help')
  private readonly toastEl = el('toast')

  private readonly trapNodes: Array<{ root: HTMLElement; fill: HTMLElement }> = []
  private boardRows: HTMLElement[] = []
  private toastTimer = 0

  constructor() {
    this.help.innerHTML =
      '<b>Run</b><br>' +
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · mouse to look<br>' +
      '<kbd>Space</kbd> jump — hold while falling to <b>tail-glide</b><br>' +
      '<kbd>Shift</kbd> sprint<br>' +
      '<kbd>R</kbd> restart · <kbd>Esc</kbd> free mouse'
  }

  /** Panels that only earn their space in some configurations. */
  configure(options: { board: boolean; trapBar: boolean }): void {
    this.board.style.display = options.board ? 'block' : 'none'
    this.trapBar.style.display = options.trapBar ? 'flex' : 'none'
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
