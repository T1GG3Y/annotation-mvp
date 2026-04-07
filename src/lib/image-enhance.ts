// Image enhancement pipeline for Damage Visibility feature.

const MAX_DIM = 2000

// Separable box blur with clamped edges
function blur(data: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(data.length)
  const out = new Float32Array(data.length)
  const diam = 2 * r + 1

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dx = -r; dx <= r; dx++) {
        sum += data[y * w + Math.min(Math.max(x + dx, 0), w - 1)]
      }
      tmp[y * w + x] = sum / diam
    }
  }

  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = -r; dy <= r; dy++) {
        sum += tmp[Math.min(Math.max(y + dy, 0), h - 1) * w + x]
      }
      out[y * w + x] = sum / diam
    }
  }

  return out
}

export function applyDamageVisibility(
  originalImg: HTMLImageElement,
  strength: number, // 0–1
): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DIM / Math.max(originalImg.naturalWidth || 1, originalImg.naturalHeight || 1))
  const w = Math.max(1, Math.round(originalImg.naturalWidth * scale))
  const h = Math.max(1, Math.round(originalImg.naturalHeight * scale))

  // Draw original at processing resolution
  const src = document.createElement('canvas')
  src.width = w; src.height = h
  const sCtx = src.getContext('2d')!
  sCtx.drawImage(originalImg, 0, 0, w, h)
  const imgData = sCtx.getImageData(0, 0, w, h)
  const px = imgData.data
  const n = w * h

  // Extract float channels
  const R = new Float32Array(n)
  const G = new Float32Array(n)
  const B = new Float32Array(n)
  const A = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    R[i] = px[i * 4] / 255
    G[i] = px[i * 4 + 1] / 255
    B[i] = px[i * 4 + 2] / 255
    A[i] = px[i * 4 + 3]
  }

  // Perceptual luminance
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) lum[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]

  // Clarity: local contrast boost using large radius (~2% of image width)
  const clarityR = Math.max(4, Math.round(w * 0.025))
  const lumBlurLarge = blur(lum, w, h, clarityR)
  const clarityAmt = strength * 1.8   // aggressive at 100%

  // Sharpening: unsharp mask with small radius
  const lumBlurSmall = blur(lum, w, h, 2)
  const sharpAmt = strength * 0.9

  const outCanvas = document.createElement('canvas')
  outCanvas.width = w; outCanvas.height = h
  const oCtx = outCanvas.getContext('2d')!
  const outData = oCtx.createImageData(w, h)
  const od = outData.data

  for (let i = 0; i < n; i++) {
    const origL = lum[i]
    let l = origL

    // Clarity: punch up local contrast
    l += clarityAmt * (l - lumBlurLarge[i])
    // Sharpening: unsharp mask
    l += sharpAmt * (l - lumBlurSmall[i])
    // Highlight reduction: compress values above 0.65 (more aggressive threshold)
    if (l > 0.65) l = 0.65 + (l - 0.65) * (1 - strength * 0.55)
    // Shadow lift: strongly raise dark areas to reveal damage detail
    if (l < 0.35) l = 0.35 - (0.35 - l) * (1 - strength * 0.45)
    l = Math.min(1, Math.max(0, l))

    // Preserve chrominance by scaling RGB by luminance ratio
    const ratio = origL > 0.001 ? l / origL : 1
    let r = Math.min(1, R[i] * ratio)
    let g = Math.min(1, G[i] * ratio)
    let b = Math.min(1, B[i] * ratio)

    // Desaturation — reduces chroma noise so damage detail is more visible
    const newL = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const desatAmt = strength * 0.28
    r += (newL - r) * desatAmt
    g += (newL - g) * desatAmt
    b += (newL - b) * desatAmt

    // Blend with original so strength=0 is fully untouched
    od[i * 4] = Math.round(Math.min(255, Math.max(0, (R[i] + (r - R[i]) * strength) * 255)))
    od[i * 4 + 1] = Math.round(Math.min(255, Math.max(0, (G[i] + (g - G[i]) * strength) * 255)))
    od[i * 4 + 2] = Math.round(Math.min(255, Math.max(0, (B[i] + (b - B[i]) * strength) * 255)))
    od[i * 4 + 3] = A[i]
  }

  oCtx.putImageData(outData, 0, 0)
  return outCanvas
}
