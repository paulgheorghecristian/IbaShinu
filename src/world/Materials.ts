import * as THREE from 'three'

/**
 * Only back faces are drawn into the shadow map. The depth stored is then the far
 * surface of each occluder, so a lit surface can never shadow itself, and the
 * shadow bias can be zero — which is what keeps shadows attached to their caster
 * and solid all the way through instead of hollow.
 *
 * three.js already does this implicitly for `FrontSide` materials, but stating it
 * means a material switched to `DoubleSide` later does not quietly bring the acne
 * (and the bias needed to hide it) back with it.
 */
export const SHADOW_SIDE = THREE.BackSide

/**
 * Shared materials. Instancing them once keeps the draw calls batched and makes a
 * palette change a one-line edit.
 */
const cache = new Map<string, THREE.MeshStandardMaterial>()

export function surface(color: number, roughness = 0.82, metalness = 0.06): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`
  let mat = cache.get(key)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, shadowSide: SHADOW_SIDE })
    cache.set(key, mat)
  }
  return mat
}

export function emissive(color: number, intensity = 1.2): THREE.MeshStandardMaterial {
  const key = `e-${color}-${intensity}`
  let mat = cache.get(key)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.4,
      metalness: 0,
      shadowSide: SHADOW_SIDE,
    })
    cache.set(key, mat)
  }
  return mat
}

/**
 * Procedural coat texture. The asymmetric patches are the point: without them a
 * shaded sphere gives you no read on spin, and spin is most of the feedback a
 * rolling-ball controller has.
 */
export function coatTexture(base: number, patch: number): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const baseCss = '#' + base.toString(16).padStart(6, '0')
  const patchCss = '#' + patch.toString(16).padStart(6, '0')

  ctx.fillStyle = baseCss
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = patchCss
  // A band plus two blobs: enough asymmetry to read rotation on every axis.
  ctx.fillRect(0, size * 0.44, size, size * 0.12)
  for (const [cx, cy, r] of [
    [size * 0.24, size * 0.2, size * 0.13],
    [size * 0.7, size * 0.76, size * 0.16],
  ]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
