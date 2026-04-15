'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import * as fabric from 'fabric'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type Tool = 'select' | 'arrow' | 'line' | 'circle' | 'rectangle' | 'text' | 'callout' | 'crop'
export type ColorMode = 'stroke' | 'fill' | 'text'
export type SelectedType = 'text' | 'shape' | 'none'
export type SelectedSubType = 'text' | 'line' | 'fillable' | 'none'
export type AnnotationColor = '#EF4444' | '#FACC15' | '#0ADD08' | '#3B82F6' | '#EC4899' | '#FFFFFF' | '#000000'

export const COLORS: { value: AnnotationColor; label: string }[] = [
  { value: '#EF4444', label: 'Red' },
  { value: '#FACC15', label: 'Yellow' },
  { value: '#0ADD08', label: 'Green' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#FFFFFF', label: 'White' },
  { value: '#000000', label: 'Black' },
]

export const STROKE_WIDTHS = [3, 6, 10] as const
export const STROKE_LABELS = ['Thin', 'Medium', 'Thick'] as const

const DEFAULT_STROKE = 6
const MAX_HISTORY = 40
const DEFAULT_LEGEND_WIDTH = 220 // reference width used for font-size scaling

const CUSTOM_PROPS = [
  '_boxStroke', '_boxStrokeWidth', 'isLegend', 'isLegendBg', 'isLegendSwatch', 'isLegendX',
  'legendColor', '_legendScale', '_legendWidth', '_isArrow',
  '_calloutId', '_isCalloutAnchor', '_isCalloutBubble', '_isCalloutLine',
  '_calloutZoom', '_calloutAnchorX', '_calloutAnchorY', '_calloutRadius',
]

function makeShadow() {
  return new fabric.Shadow({ color: 'rgba(0,0,0,0.92)', blur: 20, offsetX: 4, offsetY: 4 })
}

export function hexToRgba(hex: string | AnnotationColor, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function extractHex(color: string | undefined | null): string {
  if (!color) return ''
  if (color.startsWith('#')) return color.toUpperCase()
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return ''
  const h = (n: number) => (+n).toString(16).padStart(2, '0')
  return `#${h(+m[1])}${h(+m[2])}${h(+m[3])}`.toUpperCase()
}

// Only stroke colors drive the legend (fills and text colors excluded)
function getUsedColors(canvas: fabric.Canvas): string[] {
  const used: string[] = []
  const found = new Set<string>()
  canvas.getObjects().forEach((obj: any) => {
    if (obj.isLegend || obj._isCalloutAnchor || obj._isCalloutLine) return
    const sources: (string | undefined)[] = [obj.stroke, obj._boxStroke]
    sources.forEach((src) => {
      const hex = extractHex(src)
      if (!hex) return
      COLORS.forEach((col) => {
        if (!found.has(col.value) && col.value.toUpperCase() === hex) {
          found.add(col.value); used.push(col.value)
        }
      })
    })
  })
  return used
}

function getPointer(canvas: any, opt: any): { x: number; y: number } {
  if (typeof canvas.getScenePoint === 'function') return canvas.getScenePoint(opt.e)
  if (typeof canvas.getPointer === 'function') return canvas.getPointer(opt.e)
  const rect = canvas.getElement().getBoundingClientRect()
  return { x: opt.e.clientX - rect.left, y: opt.e.clientY - rect.top }
}

function applyBoxStrokeRenderer(obj: any) {
  if (obj._boxStrokeApplied) return
  const protoRenderBg = (fabric.IText.prototype as any)._renderBackground
  obj._renderBackground = function (ctx: CanvasRenderingContext2D) {
    if (this.backgroundColor) protoRenderBg.call(this, ctx)
    if (this._boxStroke && this._boxStrokeWidth > 0) {
      const extra = 4
      ctx.save()
      ctx.strokeStyle = this._boxStroke
      ctx.lineWidth = this._boxStrokeWidth
      ctx.lineJoin = 'round'
      ctx.strokeRect(-this.width / 2 - extra, -this.height / 2 - extra, this.width + extra * 2, this.height + extra * 2)
      ctx.restore()
    }
  }
  obj._boxStrokeApplied = true
}

function applyBoxStrokeToAll(canvas: fabric.Canvas) {
  canvas.getObjects().forEach((obj: any) => {
    if (obj.type === 'i-text' || obj.type === 'textbox') applyBoxStrokeRenderer(obj)
  })
}

function renderEndpointHandle(ctx: CanvasRenderingContext2D, left: number, top: number) {
  ctx.save()
  ctx.fillStyle = '#3B82F6'; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(left, top, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()
  ctx.restore()
}

function applyLineEndpointControls(line: fabric.Line) {
  const makeEndpointControl = (which: 'p1' | 'p2') =>
    new fabric.Control({
      positionHandler: (_dim: any, finalMatrix: any, fabricObject: any) => {
        const l = fabricObject as fabric.Line
        const lp = l.calcLinePoints()
        const pt = which === 'p1' ? { x: lp.x1, y: lp.y1 } : { x: lp.x2, y: lp.y2 }
        return new fabric.Point(pt.x, pt.y).transform(finalMatrix)
      },
      actionHandler: (_evt: any, transform: any, x: number, y: number) => {
        const l = transform.target as fabric.Line
        const lp = l.calcLinePoints()
        const matrix = l.calcTransformMatrix()
        if (which === 'p1') {
          const p2 = new fabric.Point(lp.x2, lp.y2).transform(matrix)
          l.set({ x1: x, y1: y, x2: p2.x, y2: p2.y })
        } else {
          const p1 = new fabric.Point(lp.x1, lp.y1).transform(matrix)
          l.set({ x1: p1.x, y1: p1.y, x2: x, y2: y })
        }
        l.setCoords(); return true
      },
      cursorStyle: 'crosshair', actionName: 'modifyEndpoint',
      render: renderEndpointHandle, sizeX: 14, sizeY: 14,
    })
  line.controls = { p1: makeEndpointControl('p1'), p2: makeEndpointControl('p2') }
  line.hasBorders = false
}

function applyArrowRenderer(line: fabric.Line) {
  if ((line as any)._arrowRendererApplied) return
  ;(line as any)._render = function(this: any, ctx: CanvasRenderingContext2D) {
    fabric.Line.prototype._render.call(this, ctx)
    if (!this._isArrow) return
    const p = this.calcLinePoints()
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1
    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return
    const angle = Math.atan2(dy, dx)
    const hl = Math.max(this.strokeWidth * 4, 16), ha = Math.PI / 6
    ctx.save()
    ctx.strokeStyle = typeof this.stroke === 'string' ? this.stroke : '#000'
    ctx.lineWidth = this.strokeWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(p.x2 - hl * Math.cos(angle - ha), p.y2 - hl * Math.sin(angle - ha))
    ctx.lineTo(p.x2, p.y2)
    ctx.lineTo(p.x2 - hl * Math.cos(angle + ha), p.y2 - hl * Math.sin(angle + ha))
    ctx.stroke(); ctx.restore()
  }
  ;(line as any)._arrowRendererApplied = true
}

function applyLineControlsToAll(canvas: fabric.Canvas) {
  canvas.getObjects().forEach((obj: any) => {
    if (obj.type === 'line') {
      obj.objectCaching = false
      applyLineEndpointControls(obj as fabric.Line)
      if (obj._isArrow) { applyArrowRenderer(obj as fabric.Line); obj.dirty = true }
    }
  })
}

// ---------------------------------------------------------------------------
// Callout helpers
// ---------------------------------------------------------------------------

function genId(): string {
  return Math.random().toString(36).slice(2, 9)
}

function updateCalloutConnector(canvas: fabric.Canvas, calloutId: string) {
  const anchor = canvas.getObjects().find((o: any) => o._calloutId === calloutId && o._isCalloutAnchor) as any
  const bubble = canvas.getObjects().find((o: any) => o._calloutId === calloutId && o._isCalloutBubble) as any
  const line = canvas.getObjects().find((o: any) => o._calloutId === calloutId && o._isCalloutLine) as any
  if (!anchor || !bubble || !line) return
  const ax = anchor.left ?? 0, ay = anchor.top ?? 0
  const bx = bubble.left ?? 0, by = bubble.top ?? 0
  const dx = ax - bx, dy = ay - by
  const dist = Math.sqrt(dx * dx + dy * dy)
  const r = bubble.radius ?? 60
  const edgeX = dist > 0.5 ? bx + (dx / dist) * r : bx + r
  const edgeY = dist > 0.5 ? by + (dy / dist) * r : by
  // Connector color follows bubble stroke
  const bubbleStroke = (bubble.stroke as string) ?? '#000000'
  line.set({ x1: ax, y1: ay, x2: edgeX, y2: edgeY, stroke: bubbleStroke })
  line.setCoords()
}

const HANDLE_OFFSET = 14 // pixels outside the bubble circumference

function applyCalloutBubbleRenderer(bubble: any, canvas: fabric.Canvas) {
  if (bubble._calloutRendererApplied) return
  bubble._fabricCanvas = canvas
  bubble.objectCaching = false

  // _render: draw circular zoomed crop of base image centered on anchor
  bubble._render = function (this: any, ctx: CanvasRenderingContext2D) {
    const r: number = this.radius ?? 60
    const bg = this._fabricCanvas?.backgroundImage
    let drawn = false
    if (bg) {
      const bgEl = (bg as any).getElement?.() || (bg as any)._element
      if (bgEl && (bgEl.naturalWidth || bgEl.width)) {
        const imgW: number = bgEl.naturalWidth || bgEl.width
        const imgH: number = bgEl.naturalHeight || bgEl.height
        const bgScaleX: number = bg.scaleX ?? 1
        const bgScaleY: number = bg.scaleY ?? bgScaleX
        const bgLeft: number = bg.left ?? 0
        const bgTop: number = bg.top ?? 0
        const ax: number = this._calloutAnchorX ?? this.left
        const ay: number = this._calloutAnchorY ?? this.top
        const imgX = (ax - bgLeft) / bgScaleX + imgW / 2
        const imgY = (ay - bgTop) / bgScaleY + imgH / 2
        const zoomLevel: number = this._calloutZoom ?? 2
        const srcR = r / (bgScaleX * zoomLevel)
        const sx = Math.max(0, imgX - srcR)
        const sy = Math.max(0, imgY - srcR)
        const sw = Math.min(imgW - sx, srcR * 2)
        const sh = Math.min(imgH - sy, srcR * 2)
        if (sw > 0 && sh > 0) {
          ctx.save()
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip()
          ctx.drawImage(bgEl, sx, sy, sw, sh, -r, -r, r * 2, r * 2)
          ctx.restore()
          drawn = true
        }
      }
    }
    if (!drawn) {
      ctx.save(); ctx.fillStyle = 'rgba(60,60,60,0.7)'
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore()
    }
    // Border using object's own stroke properties
    ctx.save()
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.strokeStyle = typeof this.stroke === 'string' && this.stroke ? this.stroke : '#000000'
    ctx.lineWidth = Math.max(1, this.strokeWidth ?? 2)
    ctx.stroke(); ctx.restore()
  }

  // Green handle: zoom (12 o'clock to 3 o'clock = 1x to 3x, slides along arc)
  const zoomControl = new fabric.Control({
    positionHandler: (_dim: any, finalMatrix: any, obj: any) => {
      const r = (obj as any).radius ?? 60
      const zoom: number = (obj as any)._calloutZoom ?? 2
      // angle 0 = 12 o'clock (zoom=1), π/2 = 3 o'clock (zoom=3)
      const angle = ((zoom - 1) / 4) * (Math.PI / 2)
      const hx = Math.sin(angle) * (r + HANDLE_OFFSET)
      const hy = -Math.cos(angle) * (r + HANDLE_OFFSET)
      return new fabric.Point(hx, hy).transform(finalMatrix)
    },
    actionHandler: (_evt: any, transform: any, x: number, y: number) => {
      const b = transform.target as any
      const cx = b.left as number, cy = b.top as number
      const localX = x - cx, localY = y - cy
      // atan2(x, -y) gives angle from top going clockwise
      let angle = Math.atan2(localX, -localY)
      angle = Math.max(0, Math.min(Math.PI / 2, angle))
      b._calloutZoom = 1 + (angle / (Math.PI / 2)) * 4
      b.dirty = true; b._fabricCanvas?.renderAll()
      return true
    },
    cursorStyle: 'crosshair', actionName: 'zoomBubble',
    render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
      ctx.save(); ctx.fillStyle = '#22C55E'; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(left, top, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore()
    },
    sizeX: 14, sizeY: 14,
  })

  // Blue handle: resize bubble (at 4:30 = 135° clockwise from 12 o'clock)
  const resizeControl = new fabric.Control({
    positionHandler: (_dim: any, finalMatrix: any, obj: any) => {
      const r = (obj as any).radius ?? 60
      const angle = (3 * Math.PI) / 4 // 135° from top
      const hx = Math.sin(angle) * (r + HANDLE_OFFSET)
      const hy = -Math.cos(angle) * (r + HANDLE_OFFSET)
      return new fabric.Point(hx, hy).transform(finalMatrix)
    },
    actionHandler: (_evt: any, transform: any, x: number, y: number) => {
      const b = transform.target as any
      const center = new fabric.Point(b.left as number, b.top as number)
      const newR = Math.max(20, Math.round(center.distanceFrom(new fabric.Point(x, y))))
      b.set({ radius: newR })
      b._calloutRadius = newR; b.dirty = true; b.setCoords()
      updateCalloutConnector(b._fabricCanvas, b._calloutId)
      b._fabricCanvas?.renderAll()
      return true
    },
    cursorStyle: 'se-resize', actionName: 'resizeBubble',
    render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
      ctx.save(); ctx.fillStyle = '#3B82F6'; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(left, top, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore()
    },
    sizeX: 14, sizeY: 14,
  })

  bubble.controls = { zoom: zoomControl, resize: resizeControl }
  bubble.hasBorders = true
  bubble._calloutRendererApplied = true
}

function applyCalloutControlsToAll(canvas: fabric.Canvas) {
  canvas.getObjects().forEach((obj: any) => {
    if (obj._isCalloutBubble) {
      obj._fabricCanvas = canvas; obj.objectCaching = false
      if (!obj._calloutRendererApplied) applyCalloutBubbleRenderer(obj, canvas)
      obj.dirty = true
    }
    if (obj._isCalloutLine) { obj.selectable = false; obj.evented = false }
    if (obj._isCalloutAnchor) { obj.visible = false }
  })
}

// ---------------------------------------------------------------------------
// Crop helper
// ---------------------------------------------------------------------------

// Applies a destructive crop: transforms all annotation objects and reloads background.
// Legend objects are excluded (they float independently of image content).
function applyCrop(
  canvas: fabric.Canvas,
  cropLeft: number, cropTop: number,
  cropWidth: number, cropHeight: number,
  onDone?: () => void,
) {
  const cW = canvas.width!, cH = canvas.height!
  const sf = Math.min(cW / cropWidth, cH / cropHeight)
  const offsetX = (cW - cropWidth * sf) / 2
  const offsetY = (cH - cropHeight * sf) / 2

  canvas.getObjects().forEach((obj: any) => {
    if (obj.isLegend) return // legend floats independently

    if (obj.type === 'line') {
      // Get true world-space endpoints via transform matrix
      const lp = (obj as fabric.Line).calcLinePoints()
      const matrix = obj.calcTransformMatrix()
      const absP1 = new fabric.Point(lp.x1, lp.y1).transform(matrix)
      const absP2 = new fabric.Point(lp.x2, lp.y2).transform(matrix)
      obj.set({
        x1: (absP1.x - cropLeft) * sf + offsetX,
        y1: (absP1.y - cropTop) * sf + offsetY,
        x2: (absP2.x - cropLeft) * sf + offsetX,
        y2: (absP2.y - cropTop) * sf + offsetY,
        scaleX: 1, scaleY: 1, angle: 0,
        strokeWidth: Math.max(1, (obj.strokeWidth ?? 1) * sf),
      })
    } else if (obj.type === 'i-text' || obj.type === 'textbox') {
      obj.set({
        left: (obj.left - cropLeft) * sf + offsetX,
        top: (obj.top - cropTop) * sf + offsetY,
        fontSize: Math.max(8, Math.round((obj.fontSize ?? 24) * sf)),
        scaleX: 1, scaleY: 1,
      })
    } else if (obj._isCalloutBubble || obj._isCalloutAnchor) {
      // Circles: scale radius directly instead of scaleX/Y
      obj.set({
        left: (obj.left - cropLeft) * sf + offsetX,
        top: (obj.top - cropTop) * sf + offsetY,
        radius: Math.round((obj.radius ?? 60) * sf),
        strokeWidth: Math.max(0.5, (obj.strokeWidth ?? 2) * sf),
        scaleX: 1, scaleY: 1,
      })
      if (obj._isCalloutBubble) {
        obj._calloutAnchorX = ((obj._calloutAnchorX ?? obj.left) - cropLeft) * sf + offsetX
        obj._calloutAnchorY = ((obj._calloutAnchorY ?? obj.top) - cropTop) * sf + offsetY
      }
    } else {
      // Shapes (rect, ellipse) — scale via scaleX/Y
      obj.set({
        left: (obj.left - cropLeft) * sf + offsetX,
        top: (obj.top - cropTop) * sf + offsetY,
        scaleX: (obj.scaleX ?? 1) * sf,
        scaleY: (obj.scaleY ?? 1) * sf,
        strokeWidth: Math.max(0.5, (obj.strokeWidth ?? 1) * sf),
      })
    }
    obj.setCoords()
  })

  // Fix callout connectors after object transforms
  const calloutBubbles = canvas.getObjects().filter((o: any) => o._isCalloutBubble) as any[]
  calloutBubbles.forEach(b => updateCalloutConnector(canvas, b._calloutId))

  // Crop background image and reload
  const bg = canvas.backgroundImage as any
  if (bg) {
    const bgEl = (bg as any).getElement?.() || (bg as any)._element
    if (bgEl && (bgEl.naturalWidth || bgEl.width)) {
      const bgScaleX: number = bg.scaleX ?? 1, bgScaleY: number = bg.scaleY ?? bgScaleX
      const bgLeft: number = bg.left ?? cW / 2, bgTop: number = bg.top ?? cH / 2
      // bg uses center origin
      const bgDispLeft = bgLeft - (bg.width ?? 0) * bgScaleX / 2
      const bgDispTop = bgTop - (bg.height ?? 0) * bgScaleY / 2
      const srcX = Math.max(0, (cropLeft - bgDispLeft) / bgScaleX)
      const srcY = Math.max(0, (cropTop - bgDispTop) / bgScaleY)
      const srcW = Math.min((bg.width ?? 0) - srcX, cropWidth / bgScaleX)
      const srcH = Math.min((bg.height ?? 0) - srcY, cropHeight / bgScaleY)
      if (srcW > 0 && srcH > 0) {
        const tmp = document.createElement('canvas')
        tmp.width = Math.round(srcW); tmp.height = Math.round(srcH)
        tmp.getContext('2d')!.drawImage(bgEl, srcX, srcY, srcW, srcH, 0, 0, tmp.width, tmp.height)
        const loader = (fabric as any).FabricImage?.fromURL ?? (fabric as any).Image?.fromURL
        loader.call((fabric as any).FabricImage ?? (fabric as any).Image, tmp.toDataURL(), { crossOrigin: 'anonymous' })
          .then((newImg: any) => {
            const newScale = Math.min(cW / newImg.width, cH / newImg.height)
            newImg.set({ scaleX: newScale, scaleY: newScale, originX: 'center', originY: 'center', left: cW / 2, top: cH / 2 })
            canvas.backgroundImage = newImg
            canvas.renderAll()
            onDone?.()
          })
        return
      }
    }
  }
  canvas.renderAll()
  onDone?.()
}

// ---------------------------------------------------------------------------
// Legend layout helpers
// ---------------------------------------------------------------------------

// Font size derived from legend width: proportional, capped at 15px (default at 220px)
function legendFontSize(bgW: number): number {
  return Math.max(8, Math.min(15, Math.round(15 * bgW / DEFAULT_LEGEND_WIDTH)))
}
function legendTitleFontSize(bgW: number): number {
  return Math.max(7, Math.min(13, Math.round(13 * bgW / DEFAULT_LEGEND_WIDTH)))
}
function legendXFontSize(bgW: number): number {
  return Math.max(7, Math.min(12, Math.round(12 * bgW / DEFAULT_LEGEND_WIDTH)))
}

function relayoutLegend(canvas: fabric.Canvas, newBgWidth?: number) {
  const bg = canvas.getObjects().find((o: any) => o.isLegendBg) as any
  if (!bg) return
  const s = (bg._legendScale ?? 1) as number
  const pad = Math.round(14 * s), titleH = Math.round(28 * s)
  const swatchSz = Math.round(18 * s), xBtnSize = Math.round(16 * s)
  const rowPad = Math.round(8 * s), labelGap = Math.round(10 * s)
  const y = bg.top as number
  const clampedW = newBgWidth !== undefined ? Math.max(120, newBgWidth) : undefined
  const bgW = clampedW ?? (bg.width as number)

  if (clampedW !== undefined) {
    bg.set({ width: clampedW, scaleX: 1, scaleY: 1 }); bg.setCoords()
    ;(bg as any)._legendWidth = clampedW
  }

  // Recompute font sizes from new width
  const fs = legendFontSize(bgW)
  const titleFS = legendTitleFontSize(bgW)
  const xFS = legendXFontSize(bgW)

  const labelW = bgW - pad * 2 - swatchSz - labelGap - xBtnSize - Math.round(8 * s)
  const labels = canvas.getObjects().filter((o: any) =>
    o.isLegend && (o.type === 'textbox' || o.type === 'i-text') && o.legendColor && !o.isLegendX
  ) as any[]

  let curY = y + pad + titleH
  labels.forEach((label: any) => {
    const color = label.legendColor
    const swatch = canvas.getObjects().find((o: any) => o.isLegendSwatch && o.legendColor === color) as any
    const xBtn = canvas.getObjects().find((o: any) => o.isLegendX && o.legendColor === color) as any
    if (label.fontSize !== fs) { label.set({ fontSize: fs }) }
    if (clampedW !== undefined && Math.abs(label.width - labelW) > 1) {
      label.set({ width: labelW })
    }
    label.initDimensions()
    if (xBtn && xBtn.fontSize !== xFS) xBtn.set({ fontSize: xFS })
    const labelH = label.height ?? swatchSz
    const rowH = Math.max(swatchSz, labelH) + rowPad
    if (swatch) { swatch.set({ top: curY, left: bg.left + pad }); swatch.setCoords() }
    label.set({ top: curY, left: bg.left + pad + swatchSz + labelGap }); label.setCoords()
    if (xBtn) { xBtn.set({ top: curY, left: bg.left + bgW - pad - xBtnSize }); xBtn.setCoords() }
    curY += rowH
  })

  const newH = (curY - y) + Math.round(pad / 2)
  bg.set({ height: newH, scaleY: 1 }); bg.setCoords()

  const title = canvas.getObjects().find((o: any) => o.isLegend && !o.legendColor && !o.isLegendBg && !o.isLegendX) as any
  if (title) {
    if (title.fontSize !== titleFS) title.set({ fontSize: titleFS })
    title.set({ left: bg.left + pad, top: y + pad - 2 }); title.setCoords()
  }
  canvas.renderAll()
}

function applySelectMode(
  canvas: fabric.Canvas,
  setActiveTool: (t: Tool) => void,
  activeToolRef: React.MutableRefObject<Tool>,
) {
  setActiveTool('select'); activeToolRef.current = 'select'
  canvas.selection = true; (canvas as any).skipTargetFind = false
  canvas.defaultCursor = 'default'; canvas.hoverCursor = 'move'
}


// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAnnotatorOptions {
  imageUrl: string
  imageName: string
  initialState?: string | null
  canvasElRef: React.RefObject<HTMLCanvasElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function useAnnotator({ imageUrl, imageName, initialState, canvasElRef, containerRef }: UseAnnotatorOptions) {
  const fabricRef = useRef<fabric.Canvas | null>(null)

  const [activeTool, setActiveTool] = useState<Tool>('circle')
  const [colorMode, setColorMode] = useState<ColorMode>('stroke')
  const [activeColor, setActiveColor] = useState<AnnotationColor>('#EF4444')
  const [fillColor, setFillColor] = useState<AnnotationColor>('#000000')
  const [activeTextColor, setActiveTextColor] = useState<AnnotationColor>('#FFFFFF')
  const [strokeOpacity, setStrokeOpacity] = useState(1.0)
  const [fillOpacity, setFillOpacity] = useState(0.85)
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE)
  const [isFilled, setIsFilled] = useState(false)
  const [isStroked, setIsStroked] = useState(true)
  const [fontSize, setFontSize] = useState(24)
  const [selectedType, setSelectedType] = useState<SelectedType>('none')
  const [selectedSubType, setSelectedSubType] = useState<SelectedSubType>('none')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [legendPickerColor, setLegendPickerColor] = useState<string | null>(null)

  const activeToolRef = useRef<Tool>('circle')
  const colorModeRef = useRef<ColorMode>('stroke')
  const activeColorRef = useRef<AnnotationColor>('#EF4444')
  const fillColorRef = useRef<AnnotationColor>('#000000')
  const activeTextColorRef = useRef<AnnotationColor>('#FFFFFF')
  const lastTextFillColorRef = useRef<string>('#000000')
  const strokeOpacityRef = useRef(1.0)
  const fillOpacityRef = useRef(0.85)
  const strokeWidthRef = useRef(DEFAULT_STROKE)
  const isFilledRef = useRef(false)
  const isStrokedRef = useRef(true)
  const fontSizeRef = useRef(24)
  const isDrawingRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })
  const shapeRef = useRef<fabric.FabricObject | null>(null)
  const historyRef = useRef<string[]>([])
  const hIdxRef = useRef(-1)
  const loadingHistoryRef = useRef(false)
  const onKeyRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const legendLabelsRef = useRef<Record<string, string>>({})
  const legendExcludedColorsRef = useRef<Set<string>>(new Set())
  const legendResizingRef = useRef(false)
  const copiedRef = useRef<fabric.FabricObject | null>(null)

  const [cropMode, setCropMode] = useState(false)
  const cropModeRef = useRef(false)
  const [cropBounds, setCropBounds] = useState({ left: 0, top: 0, width: 100, height: 100 })
  const cropBoundsRef = useRef({ left: 0, top: 0, width: 100, height: 100 })
  const justCreatedRef = useRef<fabric.FabricObject | null>(null)
  const imageUrlRef = useRef(imageUrl)
  imageUrlRef.current = imageUrl

  const maybeUpdateLegendRef = useRef<() => void>(() => {})
  const removeLegendColorRef = useRef<(color: string) => void>(() => {})

  // -- History --

  const syncButtons = useCallback(() => {
    setCanUndo(hIdxRef.current > 0)
    setCanRedo(hIdxRef.current < historyRef.current.length - 1)
  }, [])

  const saveHistory = useCallback(() => {
    if (loadingHistoryRef.current) return
    const c = fabricRef.current; if (!c) return
    historyRef.current = historyRef.current.slice(0, hIdxRef.current + 1)
    historyRef.current.push(JSON.stringify((c as any).toJSON(CUSTOM_PROPS)))
    if (historyRef.current.length > MAX_HISTORY) historyRef.current = historyRef.current.slice(-MAX_HISTORY)
    hIdxRef.current = historyRef.current.length - 1
    syncButtons()
  }, [syncButtons])

  const loadHistoryState = useCallback((idx: number) => {
    const c = fabricRef.current
    if (!c || idx < 0 || idx >= historyRef.current.length) return
    loadingHistoryRef.current = true; hIdxRef.current = idx
    c.loadFromJSON(JSON.parse(historyRef.current[idx])).then(() => {
      applyBoxStrokeToAll(c); applyLineControlsToAll(c); applyCalloutControlsToAll(c)
      c.renderAll(); loadingHistoryRef.current = false; syncButtons()
    })
  }, [syncButtons])

  const undo = useCallback(() => { if (hIdxRef.current > 0) loadHistoryState(hIdxRef.current - 1) }, [loadHistoryState])
  const redo = useCallback(() => { if (hIdxRef.current < historyRef.current.length - 1) loadHistoryState(hIdxRef.current + 1) }, [loadHistoryState])

  // -- Tool --

  const changeTool = useCallback((tool: Tool) => {
    // Cancel crop mode when switching away
    if (cropModeRef.current && tool !== 'crop') {
      cropModeRef.current = false; setCropMode(false)
    }
    setActiveTool(tool); activeToolRef.current = tool
    justCreatedRef.current = null
    const c = fabricRef.current; if (!c) return
    c.isDrawingMode = false
    if (tool === 'select') {
      c.selection = true; (c as any).skipTargetFind = false; c.defaultCursor = 'default'; c.hoverCursor = 'move'
    } else if (tool === 'crop') {
      c.selection = false; (c as any).skipTargetFind = true
      c.discardActiveObject(); c.defaultCursor = 'default'; c.hoverCursor = 'default'
      // Initialise crop bounds to displayed background image bounds (or 80% of canvas)
      const bg = c.backgroundImage as any
      let bounds: { left: number; top: number; width: number; height: number }
      if (bg) {
        const bw = Math.round((bg.width  ?? 0) * (bg.scaleX ?? 1))
        const bh = Math.round((bg.height ?? 0) * (bg.scaleY ?? 1))
        const bl = Math.round((bg.left   ?? c.width!  / 2) - bw / 2)
        const bt = Math.round((bg.top    ?? c.height! / 2) - bh / 2)
        bounds = { left: Math.max(0, bl), top: Math.max(0, bt), width: Math.min(bw, c.width!), height: Math.min(bh, c.height!) }
      } else {
        bounds = { left: Math.round(c.width! * 0.1), top: Math.round(c.height! * 0.1), width: Math.round(c.width! * 0.8), height: Math.round(c.height! * 0.8) }
      }
      cropBoundsRef.current = bounds; setCropBounds(bounds)
      cropModeRef.current = true; setCropMode(true); c.renderAll()
    } else {
      c.selection = false; (c as any).skipTargetFind = true
      c.discardActiveObject(); c.defaultCursor = 'crosshair'; c.hoverCursor = 'crosshair'; c.renderAll()
    }
  }, [])

  const confirmCrop = useCallback(() => {
    const c = fabricRef.current; if (!c || !cropModeRef.current) return
    const b = cropBoundsRef.current
    cropModeRef.current = false; setCropMode(false)
    if (b.width > 20 && b.height > 20) applyCrop(c, b.left, b.top, b.width, b.height, saveHistory)
    applySelectMode(c, setActiveTool, activeToolRef)
  }, [saveHistory])

  const cancelCrop = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    cropModeRef.current = false; setCropMode(false)
    applySelectMode(c, setActiveTool, activeToolRef)
  }, [])

  const updateCropBounds = useCallback((bounds: { left: number; top: number; width: number; height: number }) => {
    cropBoundsRef.current = bounds; setCropBounds(bounds)
  }, [])

  const resetPhoto = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    if (cropModeRef.current) { cropModeRef.current = false; setCropMode(false) }
    c.getObjects().forEach((o) => c.remove(o))
    c.discardActiveObject()
    const loader = (fabric as any).FabricImage?.fromURL ?? (fabric as any).Image?.fromURL
    const url = imageUrlRef.current
    if (loader && url && url !== '__saved__') {
      loader.call((fabric as any).FabricImage ?? (fabric as any).Image, url, { crossOrigin: 'anonymous' })
        .then((img: any) => {
          const w = c.width!, h = c.height!
          const scale = Math.min(w / img.width!, h / img.height!) * 0.95
          img.set({ scaleX: scale, scaleY: scale, originX: 'center', originY: 'center', left: w / 2, top: h / 2 })
          c.backgroundImage = img; c.renderAll()
          c.fire('object:modified' as any)
        })
    } else {
      c.backgroundImage = undefined as any; c.renderAll()
      c.fire('object:modified' as any)
    }
  }, [])

  const setColorModeAction = useCallback((next: ColorMode) => {
    setColorMode(next); colorModeRef.current = next
  }, [])

  const toggleColorMode = useCallback(() => {
    const next: ColorMode = colorModeRef.current === 'stroke' ? 'fill' : 'stroke'
    setColorMode(next); colorModeRef.current = next
  }, [])

  // -- Color --

  const changeColor = useCallback((color: AnnotationColor) => {
    const c = fabricRef.current
    const mode = colorModeRef.current
    const obj = c?.getActiveObject()

    if (mode === 'text') {
      setActiveTextColor(color); activeTextColorRef.current = color
      if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
        obj.set({ fill: color }); obj.dirty = true; c!.renderAll(); saveHistory()
      }
      return
    }

    if (mode === 'stroke') {
      setActiveColor(color); activeColorRef.current = color
      setIsStroked(true); isStrokedRef.current = true
      if (obj && obj.type !== 'i-text' && obj.type !== 'textbox') {
        const strokeVal = hexToRgba(color, strokeOpacityRef.current)
        obj.set({ stroke: strokeVal, strokeWidth: strokeWidthRef.current })
        // Sync callout group: anchor ↔ bubble always share stroke color
        const calloutId = (obj as any)._calloutId
        if (calloutId && c) {
          c.getObjects().filter((o: any) => o._calloutId === calloutId && o !== obj).forEach((o: any) => {
            if ((o as any)._isCalloutAnchor || (o as any)._isCalloutBubble) {
              o.set({ stroke: strokeVal })
              if ((o as any)._isCalloutBubble) o.dirty = true
            }
          })
          updateCalloutConnector(c, calloutId)
        }
        c!.renderAll(); saveHistory()
      }
      maybeUpdateLegendRef.current()
    } else {
      setFillColor(color); fillColorRef.current = color
      if (obj) {
        if (obj.type === 'i-text' || obj.type === 'textbox') {
          const rgba = hexToRgba(color, fillOpacityRef.current)
          obj.set({ backgroundColor: rgba }); obj.dirty = true
          lastTextFillColorRef.current = rgba
        } else {
          setIsFilled(true); isFilledRef.current = true
          obj.set({ fill: hexToRgba(color, fillOpacityRef.current) })
        }
        c!.renderAll(); saveHistory()
      }
    }
  }, [saveHistory])

  const clearFill = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type === 'i-text' || obj.type === 'textbox') {
      obj.set({ backgroundColor: '' }); obj.dirty = true; lastTextFillColorRef.current = ''
    } else {
      setIsFilled(false); isFilledRef.current = false; obj.set({ fill: 'transparent' })
    }
    c.renderAll(); saveHistory()
  }, [saveHistory])

  const clearStroke = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type !== 'i-text' && obj.type !== 'textbox') {
      setIsStroked(false); isStrokedRef.current = false; obj.set({ stroke: '', strokeWidth: 0 })
      c.renderAll(); saveHistory()
    }
  }, [saveHistory])

  const placeLegendShape = useCallback((tool: 'circle' | 'rectangle', color: string) => {
    const c = fabricRef.current; if (!c) return
    const cx = c.width! / 2, cy = c.height! / 2
    const sw = strokeWidthRef.current
    const strokeColor = hexToRgba(color, strokeOpacityRef.current)
    let shape: fabric.FabricObject
    if (tool === 'circle') {
      shape = new fabric.Ellipse({ left: cx, top: cy, rx: 40, ry: 40, fill: 'transparent', stroke: strokeColor, strokeWidth: sw, strokeUniform: true, shadow: makeShadow(), originX: 'center', originY: 'center' })
    } else {
      shape = new fabric.Rect({ left: cx - 50, top: cy - 35, width: 100, height: 70, fill: 'transparent', stroke: strokeColor, strokeWidth: sw, strokeUniform: true, shadow: makeShadow(), rx: 8, ry: 8 })
    }
    c.add(shape); c.setActiveObject(shape); shape.setCoords(); c.renderAll(); saveHistory()
    applySelectMode(c, setActiveTool, activeToolRef)
    maybeUpdateLegendRef.current()
  }, [saveHistory])

  // -- Copy / Paste / Duplicate --

  const copySelected = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    ;(obj as any).clone().then((cloned: fabric.FabricObject) => { copiedRef.current = cloned })
  }, [])

  const finalizeClone = useCallback((cloned: fabric.FabricObject, c: fabric.Canvas, offset = true) => {
    if (offset) cloned.set({ left: (cloned.left ?? 0) + 20, top: (cloned.top ?? 0) + 20 })
    if (cloned.type === 'line') {
      applyLineEndpointControls(cloned as fabric.Line)
      if ((cloned as any)._isArrow) applyArrowRenderer(cloned as fabric.Line)
    }
    c.discardActiveObject()
    c.add(cloned); c.setActiveObject(cloned); cloned.setCoords(); c.renderAll(); saveHistory()
  }, [saveHistory])

  const pasteSelected = useCallback(() => {
    const c = fabricRef.current; if (!c || !copiedRef.current) return
    ;(copiedRef.current as any).clone().then((cloned: fabric.FabricObject) => {
      finalizeClone(cloned, c)
      ;(copiedRef.current as any).clone().then((next: fabric.FabricObject) => {
        next.set({ left: (next.left ?? 0) + 20, top: (next.top ?? 0) + 20 })
        copiedRef.current = next
      })
    })
  }, [finalizeClone])

  const duplicateSelected = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    ;(obj as any).clone().then((cloned: fabric.FabricObject) => { finalizeClone(cloned, c) })
  }, [finalizeClone])

  // -- Opacity --

  const changeOpacity = useCallback((opacity: number) => {
    const c = fabricRef.current
    const mode = colorModeRef.current
    const obj = c?.getActiveObject()

    if (mode === 'stroke') {
      setStrokeOpacity(opacity); strokeOpacityRef.current = opacity
      if (obj && obj.type !== 'i-text' && obj.type !== 'textbox') {
        const strokeVal = hexToRgba(activeColorRef.current, opacity)
        obj.set({ stroke: strokeVal })
        const calloutId = (obj as any)._calloutId
        if (calloutId && c) {
          c.getObjects().filter((o: any) => o._calloutId === calloutId && o !== obj).forEach((o: any) => {
            if ((o as any)._isCalloutAnchor || (o as any)._isCalloutBubble) {
              o.set({ stroke: strokeVal })
              if ((o as any)._isCalloutBubble) o.dirty = true
            }
          })
          updateCalloutConnector(c, calloutId)
        }
        c!.renderAll(); saveHistory()
      }
    } else if (mode === 'text') {
      // n/a
    } else {
      setFillOpacity(opacity); fillOpacityRef.current = opacity
      if (obj) {
        if (obj.type === 'i-text' || obj.type === 'textbox') {
          if ((obj as any).backgroundColor) {
            obj.set({ backgroundColor: hexToRgba(fillColorRef.current, opacity) }); obj.dirty = true
          }
        } else if (isFilledRef.current) {
          obj.set({ fill: hexToRgba(fillColorRef.current, opacity) })
        }
        c!.renderAll(); saveHistory()
      }
    }
  }, [saveHistory])

  // -- Stroke width --

  const changeStrokeWidth = useCallback((w: number) => {
    setStrokeWidth(w); strokeWidthRef.current = w
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type !== 'i-text' && obj.type !== 'textbox') {
      const calloutId = (obj as any)._calloutId
      if ((obj as any)._isCalloutAnchor && calloutId) {
        // Anchor selected: update bubble + connector width, never anchor itself
        const bubble = c.getObjects().find((o: any) => o._calloutId === calloutId && (o as any)._isCalloutBubble) as any
        const line   = c.getObjects().find((o: any) => o._calloutId === calloutId && (o as any)._isCalloutLine)   as any
        if (bubble) { bubble.set({ strokeWidth: w }); bubble.dirty = true }
        if (line)   line.set({ strokeWidth: Math.max(0.5, w * 0.4) })
        c.renderAll(); saveHistory(); return
      }
      obj.set({ strokeWidth: w })
      if (calloutId) {
        // Bubble selected: update connector only — anchor width never changes
        c.getObjects().filter((o: any) => o._calloutId === calloutId && o !== obj).forEach((o: any) => {
          if ((o as any)._isCalloutLine) o.set({ strokeWidth: Math.max(0.5, w * 0.4) })
        })
      }
      c.renderAll(); saveHistory()
    }
  }, [saveHistory])

  // -- Font size --

  const changeFontSize = useCallback((delta: number) => {
    const next = Math.max(8, Math.min(120, fontSizeRef.current + delta))
    setFontSize(next); fontSizeRef.current = next
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject()
    if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
      obj.set({ fontSize: next }); c.renderAll(); saveHistory()
    }
  }, [saveHistory])

  // -- Actions --

  const deleteSelected = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const objs = c.getActiveObjects(); if (!objs.length) return
    const deletingLegendBg = objs.some((o: any) => o.isLegendBg)
    const calloutIdsToDelete = new Set<string>()
    objs.forEach((o: any) => { if (o._calloutId) calloutIdsToDelete.add(o._calloutId) })
    if (deletingLegendBg) {
      c.getObjects().filter((o: any) => o.isLegend).forEach((o) => c.remove(o))
    } else {
      objs.forEach((o) => c.remove(o))
      calloutIdsToDelete.forEach(id => {
        c.getObjects().filter((o: any) => o._calloutId === id).forEach((o) => c.remove(o))
      })
    }
    c.discardActiveObject(); c.renderAll(); saveHistory()
    maybeUpdateLegendRef.current()
  }, [saveHistory])

  const downloadImage = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    c.discardActiveObject(); c.renderAll()
    const bg = c.backgroundImage as fabric.FabricImage | undefined
    let mult = 1, left: number | undefined, top: number | undefined, width: number | undefined, height: number | undefined
    if (bg && bg.scaleX) {
      const sw = bg.width! * bg.scaleX!, sh = bg.height! * bg.scaleY!
      left = bg.left! - sw / 2; top = bg.top! - sh / 2; width = sw; height = sh
      mult = Math.min(1 / bg.scaleX!, 4)
    }
    const url = c.toDataURL({ format: 'png', quality: 1, multiplier: mult, left, top, width, height } as any)
    const a = document.createElement('a'); a.download = `annotated-${imageName || 'image'}.png`; a.href = url; a.click()
  }, [imageName])

  const saveEditable = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    c.discardActiveObject(); c.renderAll()
    try {
      const parsed = (c as any).toJSON(CUSTOM_PROPS)
      const bg = c.backgroundImage
      if (bg && parsed.backgroundImage) {
        const el = (bg as any).getElement?.() || (bg as any)._element
        if (el && el instanceof HTMLImageElement) {
          const tmp = document.createElement('canvas'); tmp.width = el.naturalWidth || el.width; tmp.height = el.naturalHeight || el.height
          tmp.getContext('2d')!.drawImage(el, 0, 0); parsed.backgroundImage.src = tmp.toDataURL('image/jpeg', 0.85)
        }
      }
      const blob = new Blob([JSON.stringify(parsed)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.download = `${imageName || 'annotation'}.annotate.json`; a.href = url; a.click()
      URL.revokeObjectURL(url)
    } catch (err) { console.error('Save failed:', err) }
  }, [imageName])

  // -- Legend --

  const saveLegendLabels = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    c.getObjects().forEach((o: any) => {
      if (o.isLegend && o.legendColor && !o.isLegendX && !o.isLegendSwatch &&
          (o.type === 'i-text' || o.type === 'textbox' || o.type === 'text'))
        legendLabelsRef.current[o.legendColor] = o.text || 'edit'
    })
  }, [])

  const buildLegend = useCallback((colors: string[], position?: { x: number; y: number }, scale = 1, fixedWidth?: number) => {
    const c = fabricRef.current; if (!c) return
    c.getObjects().filter((o: any) => o.isLegend).forEach((o) => c.remove(o))
    const s = Math.max(0.25, scale)
    const pad = Math.round(14 * s), swatchSz = Math.round(18 * s)
    const labelGap = Math.round(10 * s), titleH = Math.round(28 * s)
    const xBtnSize = Math.round(16 * s), rowPad = Math.round(8 * s)
    const defaultW = Math.round(DEFAULT_LEGEND_WIDTH * s)
    const totalW = fixedWidth !== undefined ? Math.max(120, fixedWidth) : defaultW
    const maxLabelW = totalW - pad * 2 - swatchSz - labelGap - xBtnSize - Math.round(8 * s)
    const fontSize = legendFontSize(totalW)

    if (colors.length === 0) {
      const emptyH = pad * 2 + Math.round(60 * s)
      const x = position?.x ?? (c.width! - totalW) / 2, y = position?.y ?? (c.height! - emptyH) / 2
      const bg = new fabric.Rect({ left: x, top: y, width: totalW, height: emptyH, fill: 'rgba(0,0,0,0.8)', rx: Math.round(8 * s), ry: Math.round(8 * s), stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, shadow: makeShadow(), selectable: true, evented: true, hoverCursor: 'move' })
      ;(bg as any).isLegend = true; (bg as any).isLegendBg = true; (bg as any)._legendScale = s; (bg as any)._legendWidth = totalW; c.add(bg)
      // Horizontal-only resize: show only left/right handles
      bg.setControlsVisibility({ tl: false, tr: false, bl: false, br: false, mt: false, mb: false, mtr: false, ml: true, mr: true })
      const hint = new fabric.FabricText('Add an element to\nbuild the legend.', { left: x + pad, top: y + pad, fontFamily: 'Arial, sans-serif', fontSize: Math.round(12 * s), fill: 'rgba(255,255,255,0.45)', selectable: false, evented: false })
      ;(hint as any).isLegend = true; c.add(hint)
      c.renderAll(); return
    }

    // Two-pass layout
    const labelTexts = colors.map(color => legendLabelsRef.current[color] || 'edit')
    const tempLabels = labelTexts.map(text => {
      const tb = new fabric.Textbox(text, { left: -9999, top: -9999, fontFamily: 'Arial, sans-serif', fontSize, fill: '#FFFFFF', width: maxLabelW, splitByGrapheme: false })
      c.add(tb); tb.initDimensions(); return tb
    })
    const rowHeights = tempLabels.map(tb => Math.max(swatchSz, tb.height ?? swatchSz) + rowPad)
    tempLabels.forEach(tb => c.remove(tb))

    const totalH = pad + titleH + rowHeights.reduce((a, b) => a + b, 0) + Math.round(pad / 2)
    const x = position?.x ?? (c.width! - totalW) / 2, y = position?.y ?? (c.height! - totalH) / 2

    const bg = new fabric.Rect({ left: x, top: y, width: totalW, height: totalH, fill: 'rgba(0,0,0,0.8)', rx: Math.round(8 * s), ry: Math.round(8 * s), stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, shadow: makeShadow(), selectable: true, evented: true, hoverCursor: 'move' })
    ;(bg as any).isLegend = true; (bg as any).isLegendBg = true; (bg as any)._legendScale = s; (bg as any)._legendWidth = totalW; c.add(bg)
    // Horizontal-only resize
    bg.setControlsVisibility({ tl: false, tr: false, bl: false, br: false, mt: false, mb: false, mtr: false, ml: true, mr: true })

    const titleFS = legendTitleFontSize(totalW)
    const title = new fabric.FabricText('LEGEND', { left: x + pad, top: y + pad - 2, fontFamily: 'Arial, sans-serif', fontSize: titleFS, fontWeight: 'bold', fill: 'rgba(255,255,255,0.6)', selectable: false, evented: false })
    ;(title as any).isLegend = true; c.add(title)

    const xFS = legendXFontSize(totalW)
    let curY = y + pad + titleH
    colors.forEach((color, i) => {
      const rowH = rowHeights[i]
      const sw = new fabric.Rect({ left: x + pad, top: curY, width: swatchSz, height: swatchSz, fill: color, rx: Math.round(3 * s), ry: Math.round(3 * s), selectable: true, evented: true, hasControls: false, hasBorders: false, hoverCursor: 'pointer', lockMovementX: true, lockMovementY: true })
      ;(sw as any).isLegend = true; (sw as any).isLegendSwatch = true; (sw as any).legendColor = color; c.add(sw)
      const label = new fabric.Textbox(labelTexts[i], {
        left: x + pad + swatchSz + labelGap, top: curY,
        fontFamily: 'Arial, sans-serif', fontSize, fill: '#FFFFFF', editable: true,
        selectable: true, evented: true, lockMovementX: true, lockMovementY: true, hasControls: false, hasBorders: false,
        width: maxLabelW, splitByGrapheme: false,
      })
      ;(label as any).isLegend = true; (label as any).legendColor = color; c.add(label)
      const xBtn = new fabric.FabricText('✕', {
        left: x + totalW - pad - xBtnSize, top: curY,
        fontFamily: 'Arial, sans-serif', fontSize: xFS, fill: 'rgba(255,255,255,0.55)',
        selectable: false, evented: false, hasControls: false, hasBorders: false, hoverCursor: 'pointer',
        lockMovementX: true, lockMovementY: true, visible: false,
      })
      ;(xBtn as any).isLegend = true; (xBtn as any).isLegendX = true; (xBtn as any).legendColor = color; c.add(xBtn)
      curY += rowH
    })
    c.renderAll()
  }, [])

  const createLegend = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const existingBg = c.getObjects().find((o: any) => o.isLegendBg)
    if (existingBg) {
      c.getObjects().filter((o: any) => o.isLegend).forEach((o) => c.remove(o))
      c.renderAll(); saveHistory(); return
    }
    saveLegendLabels(); legendExcludedColorsRef.current = new Set()
    buildLegend(getUsedColors(c))
    saveHistory(); changeTool('select')
  }, [buildLegend, saveLegendLabels, saveHistory, changeTool])

  const removeLegendColor = useCallback((color: string) => {
    const c = fabricRef.current; if (!c) return
    legendExcludedColorsRef.current.add(color)
    const existingBg = c.getObjects().find((o: any) => o.isLegendBg); if (!existingBg) return
    saveLegendLabels()
    const usedColors = getUsedColors(c).filter(clr => !legendExcludedColorsRef.current.has(clr))
    const currentScale = (existingBg as any)._legendScale ?? 1
    const currentWidth = (existingBg as any)._legendWidth
    buildLegend(usedColors, { x: existingBg.left!, y: existingBg.top! }, currentScale, currentWidth)
    saveHistory()
  }, [buildLegend, saveLegendLabels, saveHistory])

  const maybeUpdateLegend = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const existingBg = c.getObjects().find((o: any) => o.isLegendBg); if (!existingBg) return
    saveLegendLabels()
    const usedColors = getUsedColors(c).filter(clr => !legendExcludedColorsRef.current.has(clr))
    const cur = [...new Set(c.getObjects().filter((o: any) => o.isLegend && o.legendColor && !o.isLegendX && !o.isLegendSwatch).map((o: any) => o.legendColor as string))]
    const same = usedColors.length === cur.length && usedColors.every((clr) => cur.includes(clr))
    if (same) return
    const currentScale = (existingBg as any)._legendScale ?? 1
    const currentWidth = (existingBg as any)._legendWidth
    buildLegend(usedColors, { x: existingBg.left!, y: existingBg.top! }, currentScale, currentWidth)
    saveHistory()
  }, [buildLegend, saveLegendLabels, saveHistory])

  maybeUpdateLegendRef.current = maybeUpdateLegend
  removeLegendColorRef.current = removeLegendColor

  // -- Canvas init --

  useEffect(() => {
    const el = canvasElRef.current; const container = containerRef.current
    if (!el || !container) return
    const raf = requestAnimationFrame(() => {
      if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }
      const w = container.clientWidth, h = container.clientHeight
      if (w === 0 || h === 0) return
      const canvas = new fabric.Canvas(el, { width: w, height: h, backgroundColor: '#18181b', selection: true, preserveObjectStacking: true })
      canvas.uniformScaling = false
      fabricRef.current = canvas

      if (initialState) {
        canvas.loadFromJSON(JSON.parse(initialState)).then(() => {
          applyBoxStrokeToAll(canvas); applyLineControlsToAll(canvas); applyCalloutControlsToAll(canvas)
          canvas.renderAll(); saveHistory()
        }).catch((e: any) => console.error('Load failed:', e))
      } else if (imageUrl && imageUrl !== '__saved__') {
        const loader = (fabric as any).FabricImage?.fromURL ?? (fabric as any).Image?.fromURL
        if (loader) {
          loader.call((fabric as any).FabricImage ?? (fabric as any).Image, imageUrl, { crossOrigin: 'anonymous' })
            .then((img: any) => {
              const scale = Math.min(w / img.width!, h / img.height!) * 0.95
              img.set({ scaleX: scale, scaleY: scale, originX: 'center', originY: 'center', left: w / 2, top: h / 2 })
              canvas.backgroundImage = img; canvas.renderAll(); saveHistory()
            }).catch((e: any) => console.error('Image load failed:', e))
        }
      }

      const syncSelectedType = () => {
        const obj = canvas.getActiveObject()
        if (!obj) { setSelectedType('none'); setSelectedSubType('none'); return }
        if (obj.type === 'i-text' || obj.type === 'textbox') {
          setSelectedType('text'); setSelectedSubType('text')
          setColorMode('text'); colorModeRef.current = 'text'
          const currentFill = (obj as any).fill
          if (currentFill && typeof currentFill === 'string') {
            const hex = extractHex(currentFill) as AnnotationColor
            const match = COLORS.find(c => c.value === hex)
            if (match) { setActiveTextColor(match.value); activeTextColorRef.current = match.value }
          }
          return
        }
        // Callout bubble/anchor: treat as line subtype (no fill tab, stroke only)
        const isCalloutObj = (obj as any)._isCalloutBubble || (obj as any)._isCalloutAnchor
        const isLine = obj.type === 'line' || isCalloutObj
        setSelectedType('shape')
        setSelectedSubType(isLine ? 'line' : 'fillable')
        // Always switch to Stroke when any shape is selected (Fill is rarely used)
        setColorMode('stroke'); colorModeRef.current = 'stroke'
        if (isCalloutObj) {
          // Sync active color from callout stroke
          const hex = extractHex(typeof obj.stroke === 'string' ? obj.stroke : '') as AnnotationColor
          const match = COLORS.find(c => c.value === hex)
          if (match) { setActiveColor(match.value); activeColorRef.current = match.value }
          return
        }
        const objFill = (obj as any).fill
        const hasFill = !isLine && objFill && objFill !== 'transparent' && objFill !== ''
        setIsFilled(!!hasFill); isFilledRef.current = !!hasFill
        const objStroke = (obj as any).stroke
        const hasStroke = objStroke && objStroke !== ''
        setIsStroked(!!hasStroke); isStrokedRef.current = !!hasStroke
      }

      // Track previous anchor position for delta calculation when anchor moves bubble
      const calloutAnchorPrevPos = new Map<string, { x: number; y: number }>()

      // --- Drawing mouse:down ---
      canvas.on('mouse:down', (opt) => {
        const tool = activeToolRef.current, color = activeColorRef.current
        if (tool === 'select' || tool === 'crop') return

        // If the user clicks the just-drawn shape, let Fabric handle move/resize
        if (justCreatedRef.current && opt.target === justCreatedRef.current) return

        // Any other click: clear just-created and begin drawing
        justCreatedRef.current = null
        canvas.discardActiveObject()
        ;(canvas as any).skipTargetFind = true
        canvas.selection = false

        const pointer = getPointer(canvas, opt)

        if (tool === 'text') {
          const txt = new fabric.IText('', {
            left: pointer.x, top: pointer.y,
            fontFamily: 'Arial, sans-serif', fontSize: fontSizeRef.current, fontWeight: 'bold',
            fill: activeTextColorRef.current, backgroundColor: '#000000', stroke: '', strokeWidth: 0,
            shadow: makeShadow(),
          })
          applyBoxStrokeRenderer(txt as any)
          canvas.add(txt); canvas.setActiveObject(txt); (txt as fabric.IText).enterEditing(); return
        }

        if (tool === 'callout') {
          const id = genId()
          const bubbleR = 60
          const bubbleX = pointer.x + 130, bubbleY = pointer.y - 90
          const dx = pointer.x - bubbleX, dy = pointer.y - bubbleY
          const dist = Math.sqrt(dx * dx + dy * dy)
          const edgeX = dist > 0.5 ? bubbleX + (dx / dist) * bubbleR : bubbleX + bubbleR
          const edgeY = dist > 0.5 ? bubbleY + (dy / dist) * bubbleR : bubbleY
          const connLine = new fabric.Line([pointer.x, pointer.y, edgeX, edgeY], {
            stroke: '#000000', strokeWidth: 1.5, selectable: false, evented: false, objectCaching: false,
          })
          ;(connLine as any)._calloutId = id; (connLine as any)._isCalloutLine = true
          canvas.add(connLine)
          const bubble = new fabric.Circle({
            left: bubbleX, top: bubbleY, radius: bubbleR,
            fill: 'rgba(60,60,60,0.5)', stroke: '#000000', strokeWidth: 2,
            originX: 'center', originY: 'center', objectCaching: false,
          })
          ;(bubble as any)._calloutId = id; (bubble as any)._isCalloutBubble = true
          ;(bubble as any)._calloutZoom = 2
          ;(bubble as any)._calloutAnchorX = pointer.x; (bubble as any)._calloutAnchorY = pointer.y
          ;(bubble as any)._calloutRadius = bubbleR
          applyCalloutBubbleRenderer(bubble as any, canvas)
          canvas.add(bubble)
          const anchor = new fabric.Circle({
            left: pointer.x, top: pointer.y, radius: 8,
            fill: 'transparent', stroke: '#000000', strokeWidth: 1.5,
            originX: 'center', originY: 'center', visible: false,
            hasControls: false, hasBorders: false, hoverCursor: 'move',
          })
          ;(anchor as any)._calloutId = id; (anchor as any)._isCalloutAnchor = true
          canvas.add(anchor)
          anchor.visible = true
          canvas.setActiveObject(bubble)
          applySelectMode(canvas, setActiveTool, activeToolRef)
          canvas.renderAll(); saveHistory(); return
        }

        isDrawingRef.current = true; startRef.current = { x: pointer.x, y: pointer.y }
        const sw = strokeWidthRef.current
        const strokeColor = hexToRgba(color, strokeOpacityRef.current)
        let shape: fabric.FabricObject | null = null
        if (tool === 'circle') shape = new fabric.Ellipse({ left: pointer.x, top: pointer.y, rx: 0, ry: 0, fill: 'transparent', stroke: strokeColor, strokeWidth: sw, strokeUniform: true, shadow: makeShadow(), originX: 'center', originY: 'center' })
        else if (tool === 'rectangle') shape = new fabric.Rect({ left: pointer.x, top: pointer.y, width: 0, height: 0, fill: 'transparent', stroke: strokeColor, strokeWidth: sw, strokeUniform: true, shadow: makeShadow(), rx: 8, ry: 8 })
        else if (tool === 'line' || tool === 'arrow') shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], { stroke: strokeColor, strokeWidth: sw, strokeUniform: true, strokeLineCap: 'round', shadow: makeShadow(), fill: 'transparent', objectCaching: false })
        if (shape) { canvas.add(shape); shapeRef.current = shape; canvas.selection = false }
      })

      canvas.on('mouse:move', (opt) => {
        if (!isDrawingRef.current || !shapeRef.current) return
        const pointer = getPointer(canvas, opt)
        const s = startRef.current, shape = shapeRef.current, tool = activeToolRef.current

        const shift = (opt.e as MouseEvent).shiftKey
        if (tool === 'circle') {
          const size = shift ? Math.max(Math.abs(pointer.x - s.x), Math.abs(pointer.y - s.y)) : 0
          const dx = shift ? size * Math.sign(pointer.x - s.x || 1) : pointer.x - s.x
          const dy = shift ? size * Math.sign(pointer.y - s.y || 1) : pointer.y - s.y
          ;(shape as fabric.Ellipse).set({ rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2, left: s.x + dx / 2, top: s.y + dy / 2 })
        } else if (tool === 'rectangle') {
          const size = shift ? Math.max(Math.abs(pointer.x - s.x), Math.abs(pointer.y - s.y)) : 0
          const rectW = shift ? size : Math.abs(pointer.x - s.x)
          const rectH = shift ? size : Math.abs(pointer.y - s.y)
          const l = shift ? (pointer.x >= s.x ? s.x : s.x - size) : Math.min(s.x, pointer.x)
          const t = shift ? (pointer.y >= s.y ? s.y : s.y - size) : Math.min(s.y, pointer.y)
          shape.set({ left: l, top: t, width: rectW, height: rectH })
        } else if (tool === 'line' || tool === 'arrow') {
          if (shift) {
            const dx = pointer.x - s.x, dy = pointer.y - s.y
            const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
            const dist = Math.sqrt(dx * dx + dy * dy)
            ;(shape as fabric.Line).set({ x2: s.x + Math.cos(angle) * dist, y2: s.y + Math.sin(angle) * dist })
          } else {
            ;(shape as fabric.Line).set({ x2: pointer.x, y2: pointer.y })
          }
        }
        canvas.renderAll()
      })

      canvas.on('mouse:up', () => {
        if (!isDrawingRef.current) return; isDrawingRef.current = false
        const shape = shapeRef.current, tool = activeToolRef.current

        if (shape) {
          let len = 0
          if (shape.type === 'ellipse') { const e = shape as fabric.Ellipse; len = Math.max(e.rx ?? 0, e.ry ?? 0) }
          else if (shape.type === 'rect') len = Math.max(shape.width ?? 0, shape.height ?? 0)
          else if (shape.type === 'line') { const l = shape as fabric.Line; len = Math.sqrt(((l.x2 ?? 0) - (l.x1 ?? 0)) ** 2 + ((l.y2 ?? 0) - (l.y1 ?? 0)) ** 2) }
          if (len < 4) {
            canvas.remove(shape); justCreatedRef.current = null
          } else if (tool === 'arrow') {
            ;(shape as any)._isArrow = true
            applyArrowRenderer(shape as fabric.Line); applyLineEndpointControls(shape as fabric.Line)
            shape.dirty = true; shape.setCoords(); canvas.setActiveObject(shape); saveHistory()
            justCreatedRef.current = shape
          } else {
            if (shape.type === 'line') applyLineEndpointControls(shape as fabric.Line)
            shape.setCoords(); canvas.setActiveObject(shape); saveHistory()
            justCreatedRef.current = shape
          }
        }
        // skipTargetFind=false so the just-drawn shape can be grabbed without switching to select
        canvas.selection = true; (canvas as any).skipTargetFind = false
        canvas.defaultCursor = 'crosshair'
        maybeUpdateLegendRef.current()
        shapeRef.current = null; canvas.renderAll()
      })

      const setXBtnsVisible = (visible: boolean) => {
        canvas.getObjects().forEach((o: any) => { if (o.isLegendX) { o.visible = visible; o.evented = visible } })
      }

      canvas.on('selection:created', (opt: any) => {
        setHasSelection(true); syncSelectedType()
        const obj = opt.selected?.[0] as any
        // Legend: no uniformScaling (horizontal-only handles control this)
        canvas.uniformScaling = false
        setXBtnsVisible(!!obj?.isLegendBg)
        if (obj?.isLegendSwatch && obj?.legendColor) {
          setLegendPickerColor(obj.legendColor); canvas.discardActiveObject(); canvas.renderAll()
        } else { setLegendPickerColor(null) }
        if (obj?._calloutId) {
          canvas.getObjects().forEach((o: any) => { if (o._calloutId === obj._calloutId && o._isCalloutAnchor) { o.visible = true; o.setCoords() } })
          canvas.renderAll()
        }
      })
      canvas.on('selection:updated', (opt: any) => {
        setHasSelection(true); syncSelectedType()
        const obj = opt.selected?.[0] as any
        canvas.uniformScaling = false
        setXBtnsVisible(!!obj?.isLegendBg)
        if (obj?.isLegendSwatch && obj?.legendColor) {
          setLegendPickerColor(obj.legendColor); canvas.discardActiveObject(); canvas.renderAll()
        } else { setLegendPickerColor(null) }
        if (obj?._calloutId) {
          canvas.getObjects().forEach((o: any) => { if (o._calloutId === obj._calloutId && o._isCalloutAnchor) { o.visible = true; o.setCoords() } })
          canvas.renderAll()
        }
      })
      canvas.on('selection:cleared', () => {
        setHasSelection(false); setSelectedType('none'); setLegendPickerColor(null)
        canvas.uniformScaling = false; setXBtnsVisible(false)
        canvas.getObjects().forEach((o: any) => { if (o._isCalloutAnchor) o.visible = false })
        canvas.renderAll()
      })

      canvas.on('object:rotating', (opt: any) => {
        if ((opt.e as MouseEvent).shiftKey) { opt.target.angle = Math.round(opt.target.angle / 30) * 30 }
      })

      // Legend: horizontal-only resize (no vertical scaling)
      canvas.on('object:scaling', (opt: any) => {
        const obj = opt.target as any
        if (!obj?.isLegendBg || legendResizingRef.current) return
        legendResizingRef.current = true
        // Clamp width, ignore any vertical scale
        const newW = Math.max(120, Math.round((obj.width as number) * (obj.scaleX as number)))
        obj.set({ scaleY: 1 }) // lock height
        relayoutLegend(canvas, newW)
        legendResizingRef.current = false
      })

      canvas.on('object:modified', (opt: any) => {
        if (legendResizingRef.current) return
        const obj = opt.target as any
        if (obj?.isLegendBg && (obj.scaleX !== 1 || obj.scaleY !== 1)) {
          legendResizingRef.current = true
          const newW = Math.max(120, Math.round((obj.width as number) * (obj.scaleX as number)))
          obj.set({ width: newW, scaleX: 1, scaleY: 1 }); obj.setCoords()
          relayoutLegend(canvas, newW)
          legendResizingRef.current = false
        }

        // Callout sync after move
        const calloutIds = new Set<string>()
        if ((obj as any)?._calloutId) calloutIds.add((obj as any)._calloutId)
        if (obj?.type === 'activeselection') {
          ;(obj as any).getObjects?.()?.forEach?.((o: any) => { if (o._calloutId) calloutIds.add(o._calloutId) })
        }
        calloutIds.forEach(id => {
          const cAnchor = canvas.getObjects().find((o: any) => o._calloutId === id && o._isCalloutAnchor) as any
          const cBubble = canvas.getObjects().find((o: any) => o._calloutId === id && o._isCalloutBubble) as any
          if (cAnchor && cBubble) {
            cBubble._calloutAnchorX = cAnchor.left; cBubble._calloutAnchorY = cAnchor.top; cBubble.dirty = true
            updateCalloutConnector(canvas, id)
          }
        })
        saveHistory()
      })

      let legendDragStart: { x: number; y: number } | null = null
      canvas.on('object:moving', (opt) => {
        const obj = opt.target as any
        if (obj?.isLegendBg) {
          const dx = obj.left! - (legendDragStart?.x ?? obj.left!), dy = obj.top! - (legendDragStart?.y ?? obj.top!)
          legendDragStart = { x: obj.left!, y: obj.top! }
          canvas.getObjects().forEach((o: any) => { if (o.isLegend && o !== obj) { o.set({ left: o.left! + dx, top: o.top! + dy }); o.setCoords() } })
        }
        // Anchor moved: move bubble WITH anchor (keeping relative offset)
        if (obj?._isCalloutAnchor) {
          const id = obj._calloutId
          const prev = calloutAnchorPrevPos.get(id)
          if (prev) {
            const dx = (obj.left as number) - prev.x, dy = (obj.top as number) - prev.y
            const cBubble = canvas.getObjects().find((o: any) => o._calloutId === id && o._isCalloutBubble) as any
            if (cBubble) {
              cBubble.set({ left: (cBubble.left as number) + dx, top: (cBubble.top as number) + dy })
              cBubble._calloutAnchorX = obj.left; cBubble._calloutAnchorY = obj.top
              cBubble.dirty = true; cBubble.setCoords()
            }
          }
          calloutAnchorPrevPos.set(id, { x: obj.left as number, y: obj.top as number })
          updateCalloutConnector(canvas, id); canvas.renderAll()
        } else if (obj?._isCalloutBubble) {
          // Bubble moved alone: anchor stays, only connector updates
          updateCalloutConnector(canvas, obj._calloutId); canvas.renderAll()
        }
      })

      canvas.on('mouse:down', (opt) => {
        const t = opt.target as any
        if (t?.isLegendBg) legendDragStart = { x: t.left!, y: t.top! }
        // Also record anchor start position for delta tracking
        if (t?._isCalloutAnchor) calloutAnchorPrevPos.set(t._calloutId, { x: t.left!, y: t.top! })
        if (t?.isLegendX && t?.legendColor) {
          removeLegendColorRef.current(t.legendColor); canvas.discardActiveObject(); canvas.renderAll(); return
        }
        if (t?.isLegend && (t.type === 'i-text' || t.type === 'textbox')) {
          canvas.setActiveObject(t); (t as fabric.IText).enterEditing(); canvas.renderAll()
        }
        // Callout anchor clicked: select anchor (for repositioning)
        if (t?._isCalloutAnchor) {
          t.visible = true; canvas.setActiveObject(t); canvas.renderAll()
        }
      })
      canvas.on('mouse:up', () => { legendDragStart = null })

      canvas.on('text:changed', (opt: any) => {
        const t = opt.target as any
        if (t?.isLegend && t.legendColor) relayoutLegend(canvas)
      })

      canvas.on('text:editing:exited', (opt: any) => {
        const t = opt.target
        if (t && typeof t.text === 'string' && t.text.trim() === '' && !(t as any).isLegend) {
          canvas.remove(t)
        } else if (t && (t as any).isLegend && (t as any).legendColor) {
          legendLabelsRef.current[(t as any).legendColor] = t.text || 'edit'
          relayoutLegend(canvas)
        }
        saveHistory()
        if (t && t.text?.trim() !== '') canvas.setActiveObject(t)
        canvas.selection = true
        if (activeToolRef.current !== 'select') (canvas as any).skipTargetFind = true
        canvas.renderAll()
      })

      const onKey = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return
        const active = canvas.getActiveObject()
        const isEditing = active && (active.type === 'i-text' || active.type === 'textbox') && (active as fabric.IText).isEditing
        if (e.metaKey || e.ctrlKey) {
          if (e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
          if (e.key === 'a' && !isEditing) { e.preventDefault(); const objs = canvas.getObjects().filter((o: any) => !o.isLegend && !o._isCalloutLine); if (objs.length) { canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas })); canvas.renderAll() } return }
          if (e.key === 'c' && !isEditing) { e.preventDefault(); copySelected(); return }
          if (e.key === 'v' && !isEditing) { e.preventDefault(); pasteSelected(); return }
          if (e.key === 'd' && !isEditing) { e.preventDefault(); duplicateSelected(); return }
          return
        }
        switch (e.key) {
          case 'Escape':
            e.preventDefault()
            if (isEditing) { ;(active as fabric.IText).exitEditing(); canvas.setActiveObject(active!) }
            else { canvas.discardActiveObject(); changeTool('select') }
            canvas.renderAll(); break
          case 'Delete': case 'Backspace': if (!isEditing) { e.preventDefault(); deleteSelected() } break
          case 'v': case 'V': if (!isEditing) changeTool('select'); break
          case 'a': case 'A': if (!isEditing) changeTool('arrow'); break
          case 'l': case 'L': if (!isEditing) changeTool('line'); break
          case 'c': case 'C': if (!isEditing) changeTool('circle'); break
          case 'r': case 'R': if (!isEditing) changeTool('rectangle'); break
          case 't': case 'T': if (!isEditing) changeTool('text'); break
          case 'o': case 'O': if (!isEditing) changeTool('callout'); break
          case 'p': case 'P': if (!isEditing) changeTool('crop'); break
        }
      }
      onKeyRef.current = onKey; document.addEventListener('keydown', onKey)
    })
    return () => {
      cancelAnimationFrame(raf)
      if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }
      if (onKeyRef.current) document.removeEventListener('keydown', onKeyRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, initialState])

  return {
    activeTool, colorMode, activeColor, fillColor, activeTextColor, strokeOpacity, fillOpacity, strokeWidth,
    isFilled, isStroked, fontSize, selectedType, selectedSubType, canUndo, canRedo, hasSelection, legendPickerColor,
    cropMode, cropBounds,
    changeTool, setColorModeAction, toggleColorMode, changeColor, clearFill, clearStroke,
    changeOpacity, changeStrokeWidth, changeFontSize,
    copySelected, pasteSelected, duplicateSelected,
    placeLegendShape,
    undo, redo, deleteSelected, downloadImage, saveEditable, createLegend, removeLegendColor,
    confirmCrop, cancelCrop, updateCropBounds, resetPhoto,
    fabricRef,
  }
}
