import { TUNABLES, DEFAULTS, TUNING_KEY, applyTuning, collectTuning, resetTuning } from '../config'

/**
 * Paths whose value is read once, when something is built, rather than every tick.
 *
 * A collider's mass, a material's colour, the length of a buffer: changing these
 * in the panel writes them down but cannot change what has already been made, so
 * the panel says a reload is needed instead of quietly doing nothing. A prefix
 * covers everything under it.
 */
const NEEDS_RELOAD = [
  'PHYSICS.fixedDt',
  'PHYSICS.maxStepsPerFrame',
  'RUNNER.radius',
  'RUNNER.mass',
  'RUNNER.friction',
  'RUNNER.restitution',
  'RUNNER.linearDamping',
  'RUNNER.angularDamping',
  'RACE.aiCount',
  'RACE.startSpacing',
  'DOG.url',
  'DOG.runUrl',
  'DOG.targetHeight',
  'DOG.groundOffset',
  'VIEW.skyRadius',
  'FX.smokeCapacity',
  'FX.fireCapacity',
  'FX.atlas',
  'SUN.mapSize',
  'POST.samples',
  'POST.ao.reuseDepth',
  'UI.antialias',
  'COLORS',
]

/** Whole numbers, where a fractional slider step would be nonsense. */
const INTEGERS = new Set([
  'PHYSICS.maxStepsPerFrame',
  'RACE.aiCount',
  'SUN.mapSize',
  'FX.smokeCapacity',
  'FX.fireCapacity',
  'FX.impactSmoke',
  'FX.impactSparks',
  'POST.samples',
  'POST.ao.samples',
  'POST.ao.debugOutput',
  'POST.ao.denoiseSamples',
  'POST.ao.denoiseRings',
])

const CSS = `
.tuner {
  position: fixed; top: 0; right: 0; bottom: 0; width: 360px; z-index: 40;
  display: flex; flex-direction: column;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #d7dee9; background: rgba(14, 18, 27, 0.94);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(6px);
}
.tuner[hidden] { display: none; }
.tuner-head, .tuner-foot { padding: 10px 12px; flex: 0 0 auto; }
.tuner-head { border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.tuner-foot { border-top: 1px solid rgba(255, 255, 255, 0.08); }
.tuner-title { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.tuner-title b { font-size: 13px; letter-spacing: 0.06em; color: #ff9f43; }
.tuner-title span { color: #7c8798; font-variant-numeric: tabular-nums; }
.tuner-filter { width: 100%; box-sizing: border-box; }
.tuner-body { flex: 1 1 auto; overflow-y: auto; padding: 4px 0 12px; }
.tuner input, .tuner button {
  font: inherit; color: inherit; background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 3px; padding: 3px 6px;
}
.tuner input:focus { outline: 1px solid #ff9f43; }
.tuner button { cursor: pointer; }
.tuner button:hover { background: rgba(255, 159, 67, 0.22); }
.tuner details { border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.tuner summary {
  padding: 7px 12px; cursor: pointer; color: #9fb0c6;
  letter-spacing: 0.08em; text-transform: uppercase; font-size: 11px;
}
.tuner summary::marker { color: #62708a; }
.tuner-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; padding: 3px 12px 5px; align-items: center; }
.tuner-row.changed { background: rgba(255, 159, 67, 0.09); }
.tuner-row label { color: #c3cddb; overflow-wrap: anywhere; }
.tuner-row .tuner-num { width: 78px; text-align: right; }
.tuner-row input[type='range'] { grid-column: 1 / -1; width: 100%; padding: 0; background: none; border: 0; }
.tuner-row input[type='text'] { grid-column: 1 / -1; width: 100%; box-sizing: border-box; }
.tuner-row .tuner-swatches { grid-column: 1 / -1; display: flex; gap: 4px; flex-wrap: wrap; }
.tuner-row input[type='color'] { width: 34px; height: 20px; padding: 0; }
.tuner-tag { font-size: 9px; color: #ffb86b; border: 1px solid rgba(255, 184, 107, 0.4); border-radius: 2px; padding: 0 3px; }
.tuner-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.tuner-note { margin-top: 8px; color: #7c8798; }
.tuner-note b { color: #ffb86b; }
.tuner-hint { position: fixed; right: 12px; bottom: 10px; z-index: 39; color: #6b7686;
  font: 11px ui-monospace, monospace; pointer-events: none; }
`

type Leaf = { path: string; row: HTMLElement; sync: () => void }

const isColour = (path: string): boolean =>
  path.startsWith('COLORS.') || /tint$/i.test(path)

const needsReload = (path: string): boolean =>
  NEEDS_RELOAD.some((p) => path === p || path.startsWith(`${p}.`))

const hex = (n: number): string => `#${Math.max(0, Math.round(n)).toString(16).padStart(6, '0').slice(-6)}`

/** A slider range that makes sense around a value we have no other bounds for. */
function sliderRange(base: number, integer: boolean): { min: number; max: number; step: number } {
  if (base === 0) return { min: integer ? 0 : -1, max: integer ? 16 : 1, step: integer ? 1 : 0.01 }
  const size = Math.abs(base)
  const step = integer ? 1 : size >= 100 ? 0.5 : size >= 10 ? 0.05 : size >= 1 ? 0.01 : 0.001
  return base > 0 ? { min: 0, max: size * 3, step } : { min: size * -3, max: 0, step }
}

function at(path: string): { holder: Record<string, unknown>; key: string } {
  const parts = path.split('.')
  const key = parts.pop() as string
  let holder = TUNABLES as unknown as Record<string, unknown>
  for (const part of parts) holder = holder[part] as Record<string, unknown>
  return { holder, key }
}

function defaultAt(path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, part) => (acc as Record<string, unknown>)?.[part],
    DEFAULTS as unknown,
  )
}

/**
 * Live tuning panel.
 *
 * It edits the same objects the game reads, so anything read per tick responds as
 * you drag. Everything is written to localStorage as you go and applied by
 * `config.ts` at import on the next load, which is early enough for the values
 * that build the scene.
 */
export class Tuner {
  private readonly root = document.createElement('aside')
  private readonly body = document.createElement('div')
  private readonly status = document.createElement('div')
  private readonly banner = document.createElement('div')
  private readonly hint = document.createElement('div')
  private readonly leaves: Leaf[] = []
  private readonly fps: HTMLElement
  private reloadPending = false

  constructor(private readonly onChange: (path: string) => void) {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.append(style)

    this.root.className = 'tuner'
    this.root.hidden = true

    const head = document.createElement('div')
    head.className = 'tuner-head'
    head.innerHTML = '<div class="tuner-title"><b>TUNING</b><span class="tuner-fps">` to close</span></div>'
    const filter = document.createElement('input')
    filter.className = 'tuner-filter'
    filter.type = 'search'
    filter.placeholder = 'filter, e.g. jump'
    filter.addEventListener('input', () => this.filter(filter.value.trim().toLowerCase()))
    head.append(filter)

    this.fps = head.querySelector('.tuner-fps') as HTMLElement
    this.body.className = 'tuner-body'
    for (const [name, block] of Object.entries(TUNABLES)) this.section(name, block)

    const foot = document.createElement('div')
    foot.className = 'tuner-foot'
    const actions = document.createElement('div')
    actions.className = 'tuner-actions'
    actions.append(
      this.button('Reset all', () => {
        resetTuning()
        this.save()
        this.syncAll()
        this.markReload()
      }),
      this.button('Export', () => this.exportFile()),
      this.button('Import', () => this.importFile()),
      this.button('Copy', () => void navigator.clipboard?.writeText(this.json())),
      this.button('Reload', () => window.location.reload()),
    )
    this.status.className = 'tuner-note'
    this.banner.className = 'tuner-note'
    foot.append(actions, this.status, this.banner)

    this.root.append(head, this.body, foot)
    this.hint.className = 'tuner-hint'
    this.hint.textContent = '` tuning'
    document.body.append(this.root, this.hint)
    this.syncAll()

    window.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA'].includes(el.tagName))
      if (e.code === 'Backquote' && !typing) {
        e.preventDefault()
        this.toggle()
      } else if (e.code === 'Escape' && this.open) {
        this.toggle()
      }
    })
  }

  get open(): boolean {
    return !this.root.hidden
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden
    this.hint.hidden = !this.root.hidden
    // The panel is unusable through a captured cursor.
    if (this.open) document.exitPointerLock()
  }

  // -------------------------------------------------------------------------

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  private section(name: string, block: object): void {
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = name
    details.append(summary)
    this.walk(name, block, details)
    this.body.append(details)
  }

  private walk(prefix: string, node: object, host: HTMLElement): void {
    for (const [key, value] of Object.entries(node)) {
      const path = `${prefix}.${key}`
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const group = document.createElement('div')
        const label = document.createElement('div')
        label.className = 'tuner-row'
        label.innerHTML = `<label style="color:#7c8798">${key}</label>`
        group.append(label)
        this.walk(path, value as object, group)
        host.append(group)
      } else {
        host.append(this.control(path, key, value))
      }
    }
  }

  private control(path: string, key: string, value: unknown): HTMLElement {
    const row = document.createElement('div')
    row.className = 'tuner-row'
    row.dataset.path = path.toLowerCase()

    const label = document.createElement('label')
    label.textContent = key
    if (needsReload(path)) {
      const tag = document.createElement('span')
      tag.className = 'tuner-tag'
      tag.textContent = 'reload'
      tag.title = 'read once when the scene is built'
      label.append(' ', tag)
    }
    row.append(label)

    let sync: () => void
    if (typeof value === 'boolean') sync = this.boolControl(row, path)
    else if (typeof value === 'string') sync = this.textControl(row, path)
    else if (Array.isArray(value)) sync = this.listControl(row, path, value)
    else if (isColour(path)) sync = this.colourControl(row, path)
    else sync = this.numberControl(row, path)

    this.leaves.push({ path, row, sync })
    return row
  }

  private commit(path: string, value: unknown): void {
    const { holder, key } = at(path)
    holder[key] = value
    this.save()
    this.syncAll()
    if (needsReload(path)) this.markReload()
    this.onChange(path)
  }

  private numberControl(row: HTMLElement, path: string): () => void {
    const { holder, key } = at(path)
    const base = defaultAt(path) as number
    const integer = INTEGERS.has(path)
    const { min, max, step } = sliderRange(base, integer)

    const num = document.createElement('input')
    num.type = 'number'
    num.className = 'tuner-num'
    num.step = String(step)
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(min)
    slider.max = String(max)
    slider.step = String(step)

    const push = (raw: string) => {
      const v = Number(raw)
      if (Number.isFinite(v)) this.commit(path, integer ? Math.round(v) : v)
    }
    slider.addEventListener('input', () => push(slider.value))
    num.addEventListener('change', () => push(num.value))
    row.append(num, slider)

    return () => {
      const v = holder[key] as number
      num.value = String(v)
      // A typed value outside the guessed range widens it rather than clamping.
      if (v < Number(slider.min)) slider.min = String(v)
      if (v > Number(slider.max)) slider.max = String(v)
      slider.value = String(v)
    }
  }

  private colourControl(row: HTMLElement, path: string): () => void {
    const { holder, key } = at(path)
    const picker = document.createElement('input')
    picker.type = 'color'
    picker.addEventListener('input', () => this.commit(path, parseInt(picker.value.slice(1), 16)))
    row.append(picker)
    return () => {
      picker.value = hex(holder[key] as number)
    }
  }

  private boolControl(row: HTMLElement, path: string): () => void {
    const { holder, key } = at(path)
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.addEventListener('change', () => this.commit(path, box.checked))
    row.append(box)
    return () => {
      box.checked = holder[key] as boolean
    }
  }

  private textControl(row: HTMLElement, path: string): () => void {
    const { holder, key } = at(path)
    const field = document.createElement('input')
    field.type = 'text'
    field.addEventListener('change', () => this.commit(path, field.value))
    row.append(field)
    return () => {
      field.value = holder[key] as string
    }
  }

  private listControl(row: HTMLElement, path: string, value: unknown[]): () => void {
    const { holder, key } = at(path)
    const wrap = document.createElement('div')
    wrap.className = 'tuner-swatches'
    const colour = isColour(path) || value.every((v) => typeof v === 'number' && v > 0xffff)
    const fields = value.map((_, i) => {
      const input = document.createElement('input')
      input.type = colour ? 'color' : 'number'
      if (!colour) input.className = 'tuner-num'
      input.addEventListener('input', () => {
        const next = (holder[key] as unknown[]).slice()
        next[i] = colour ? parseInt(input.value.slice(1), 16) : Number(input.value)
        this.commit(path, next)
      })
      wrap.append(input)
      return input
    })
    row.append(wrap)
    return () => {
      const list = holder[key] as number[]
      fields.forEach((f, i) => {
        f.value = colour ? hex(list[i]) : String(list[i])
      })
    }
  }

  // -------------------------------------------------------------------------

  private filter(term: string): void {
    for (const leaf of this.leaves) {
      leaf.row.style.display = !term || leaf.row.dataset.path?.includes(term) ? '' : 'none'
    }
    // Open every section while filtering, or matches stay hidden inside them.
    for (const d of this.body.querySelectorAll('details')) {
      if (term) d.open = true
      const visible = [...d.querySelectorAll<HTMLElement>('.tuner-row[data-path]')].some(
        (r) => r.style.display !== 'none',
      )
      d.style.display = visible ? '' : 'none'
    }
  }

  private syncAll(): void {
    const changed = collectTuning()
    for (const leaf of this.leaves) {
      leaf.sync()
      leaf.row.classList.toggle('changed', has(changed, leaf.path))
    }
    const n = count(changed)
    this.status.textContent = n ? `${n} value${n === 1 ? '' : 's'} changed, saved in this browser` : 'stock values'
  }

  private markReload(): void {
    if (this.reloadPending) return
    this.reloadPending = true
    this.banner.innerHTML = '<b>Reload to apply</b> — that one is read when the scene is built.'
  }

  private json(): string {
    return JSON.stringify(collectTuning(), null, 2)
  }

  private save(): void {
    try {
      const patch = collectTuning()
      if (Object.keys(patch).length) localStorage.setItem(TUNING_KEY, JSON.stringify(patch))
      else localStorage.removeItem(TUNING_KEY)
    } catch {
      this.status.textContent = 'could not save — storage is blocked here'
    }
  }

  private exportFile(): void {
    const blob = new Blob([this.json()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'iba-shinu-tuning.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  private importFile(): void {
    const picker = document.createElement('input')
    picker.type = 'file'
    picker.accept = 'application/json,.json'
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0]
      if (!file) return
      try {
        applyTuning(JSON.parse(await file.text()))
        this.save()
        this.syncAll()
        this.markReload()
        this.onChange('*')
      } catch {
        this.status.textContent = 'that file is not tuning JSON'
      }
    })
    picker.click()
  }
}

function has(patch: Record<string, unknown>, path: string): boolean {
  let node: unknown = patch
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return false
    if (!(part in (node as Record<string, unknown>))) return false
    node = (node as Record<string, unknown>)[part]
  }
  return true
}

function count(patch: Record<string, unknown>): number {
  return Object.values(patch).reduce<number>(
    (n, v) => n + (v !== null && typeof v === 'object' && !Array.isArray(v) ? count(v as Record<string, unknown>) : 1),
    0,
  )
}
