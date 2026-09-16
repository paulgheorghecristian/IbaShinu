export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Maps `t` from the range [from, to] onto [0, 1], clamped. */
export const span = (t: number, from: number, to: number): number => clamp01((t - from) / (to - from))

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3
export const easeInCubic = (t: number): number => t * t * t
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
