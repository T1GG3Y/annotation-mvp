'use client'

import { useCallback, useEffect } from 'react'
import { Check, X } from 'lucide-react'

export interface CropBounds { left: number; top: number; width: number; height: number }

interface Props {
  bounds: CropBounds
  onBoundsChange: (b: CropBounds) => void
  onConfirm: () => void
  onCancel: () => void
}

const CORNER = 20  // L-handle arm length (px)
const THICK = 3    // handle bar thickness (px)

export function CropOverlay({ bounds, onBoundsChange, onConfirm, onCancel }: Props) {
  const { left: l, top: t, width: w, height: h } = bounds
  const r = l + w
  const b = t + h

  // Enter = confirm, Escape = cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter')  { e.preventDefault(); onConfirm() }
      if (e.key === 'Escape') { e.preventDefault(); onCancel()  }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  const startDrag = useCallback((
    e: React.MouseEvent,
    type: 'tl'|'tr'|'bl'|'br'|'ml'|'mr'|'mt'|'mb'|'move',
  ) => {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const sb = { ...bounds }

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      let { left: nl, top: nt, width: nw, height: nh } = sb
      switch (type) {
        case 'tl':   nl += dx; nt += dy; nw -= dx; nh -= dy; break
        case 'tr':              nt += dy; nw += dx; nh -= dy; break
        case 'bl':   nl += dx;           nw -= dx; nh += dy; break
        case 'br':                        nw += dx; nh += dy; break
        case 'ml':   nl += dx;           nw -= dx;            break
        case 'mr':                        nw += dx;            break
        case 'mt':              nt += dy;           nh -= dy; break
        case 'mb':                                  nh += dy; break
        case 'move': nl += dx; nt += dy;                      break
      }
      // Min size
      if (nw < 20) { if (type === 'tl' || type === 'ml' || type === 'bl') nl = sb.left + sb.width - 20; nw = 20 }
      if (nh < 20) { if (type === 'tl' || type === 'mt' || type === 'tr') nt = sb.top  + sb.height - 20; nh = 20 }
      // Keep inside viewport (soft clamp; hard clamp in applyCrop)
      nl = Math.max(0, nl); nt = Math.max(0, nt)
      onBoundsChange({ left: Math.round(nl), top: Math.round(nt), width: Math.round(nw), height: Math.round(nh) })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [bounds, onBoundsChange])

  // Helper: render one white bar (corner arm or edge tick)
  const bar = (
    style: React.CSSProperties,
    drag: 'tl'|'tr'|'bl'|'br'|'ml'|'mr'|'mt'|'mb',
    cursor: string,
  ) => (
    <div
      style={{ position: 'absolute', background: 'white', borderRadius: 1, pointerEvents: 'auto', cursor, ...style }}
      onMouseDown={(e) => startDrag(e, drag)}
    />
  )

  const mx = l + w / 2 - CORNER / 2  // edge mid X offset
  const my = t + h / 2 - CORNER / 2  // edge mid Y offset

  return (
    <div className="absolute inset-0" style={{ zIndex: 10, pointerEvents: 'none' }}>

      {/* ── Dark masks ──────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: t,                            background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, top: b, right: 0, bottom: 0,                            background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, top: t, width:  l,   height: h,                         background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: r, top: t, right: 0,    height: h,                         background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

      {/* ── Crop border ─────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', left: l, top: t, width: w, height: h,
        border: '1px solid rgba(255,255,255,0.4)', pointerEvents: 'none' }} />

      {/* ── Move area (interior) ────────────────────────────────────────── */}
      <div
        style={{ position: 'absolute', left: l + CORNER, top: t + CORNER,
          width: Math.max(0, w - CORNER * 2), height: Math.max(0, h - CORNER * 2),
          cursor: 'move', pointerEvents: 'auto' }}
        onMouseDown={(e) => startDrag(e, 'move')}
      />

      {/* ── Corner handles ──────────────────────────────────────────────── */}
      {/* TL */}
      {bar({ left: l-1,            top: t-1,            width: CORNER, height: THICK  }, 'tl', 'nw-resize')}
      {bar({ left: l-1,            top: t-1,            width: THICK,  height: CORNER }, 'tl', 'nw-resize')}
      {/* TR */}
      {bar({ left: r-CORNER+1,     top: t-1,            width: CORNER, height: THICK  }, 'tr', 'ne-resize')}
      {bar({ left: r-THICK+1,      top: t-1,            width: THICK,  height: CORNER }, 'tr', 'ne-resize')}
      {/* BL */}
      {bar({ left: l-1,            top: b-THICK+1,      width: CORNER, height: THICK  }, 'bl', 'sw-resize')}
      {bar({ left: l-1,            top: b-CORNER+1,     width: THICK,  height: CORNER }, 'bl', 'sw-resize')}
      {/* BR */}
      {bar({ left: r-CORNER+1,     top: b-THICK+1,      width: CORNER, height: THICK  }, 'br', 'se-resize')}
      {bar({ left: r-THICK+1,      top: b-CORNER+1,     width: THICK,  height: CORNER }, 'br', 'se-resize')}

      {/* ── Edge handles ────────────────────────────────────────────────── */}
      {bar({ left: mx,   top: t-1,       width: CORNER, height: THICK  }, 'mt', 'n-resize')}
      {bar({ left: mx,   top: b-THICK+1, width: CORNER, height: THICK  }, 'mb', 's-resize')}
      {bar({ left: l-1,  top: my,        width: THICK,  height: CORNER }, 'ml', 'w-resize')}
      {bar({ left: r-THICK+1, top: my,   width: THICK,  height: CORNER }, 'mr', 'e-resize')}

      {/* ── Confirm / Cancel ────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: Math.round(l + w / 2 - 44),
        top:  b + 12,
        display: 'flex', gap: 8,
        pointerEvents: 'auto', zIndex: 20,
      }}>
        <button
          onClick={onCancel}
          className="w-9 h-9 rounded-xl flex items-center justify-center bg-zinc-800 text-white border border-zinc-600 hover:bg-zinc-700 active:bg-zinc-600">
          <X size={16} />
        </button>
        <button
          onClick={onConfirm}
          className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-600 text-white border border-blue-500 hover:bg-blue-500 active:bg-blue-400">
          <Check size={16} />
        </button>
      </div>
    </div>
  )
}
