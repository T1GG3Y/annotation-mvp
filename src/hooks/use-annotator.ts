'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import * as fabric from 'fabric'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type Tool = 'select' | 'arrow' | 'line' | 'circle' | 'rectangle' | 'text'
export type ColorMode = 'stroke' | 'fill' | 'text'
export type SelectedType = 'text' | 'shape' | 'none'
export type SelectedSubType = 'text' | 'line' | 'fillable' | 'none'
export type AnnotationColor = '#EF4444' | '#FACC15' | '#0ADD08' | '#3B82F6' | '#EC4899' | '#FFFFFF' | '#000000'

// 7 colors — rendered as 2 rows of 4 with a null button as the 8th cell
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

// Custom properties to persist through JSON serialization
const CUSTOM_PROPS = ['_boxStroke', '_boxStrokeWidth', 'isLegend', 'isLegendBg', 'legendColor', '_legendScale', '_isArrow']

function makeShadow() {
  return new fabric.Shadow({ color: 'rgba(0,0,0,0.92)', blur: 20, offsetX: 4, offsetY: 4 })
}

export function hexToRgba(hex: string | AnnotationColor, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// Extract the hex color from either '#RRGGBB' or 'rgba(r,g,b,a)' format
function extractHex(color: string | undefined | null): string {
  if (!color) return ''
  if (color.startsWith('#')) return color.toUpperCase()
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return ''
  const h = (n: number) => (+n).toString(16).padStart(2, '0')
  return `#${h(+m[1])}${h(+m[2])}${h(+m[3])}`.toUpperCase()
}

// Looks at stroke colors and (for non-text) fill colors
function getUsedColors(canvas: fabric.Canvas): string[] {
  const used: string[] = []
  const found = new Set<string>()
  canvas.getObjects().forEach((obj: any) => {
    if (obj.isLegend) return
    const sources: (string | undefined)[] = [obj.stroke, obj._boxStroke]
    // Include fill for shapes (not text characters, not transparent)
    const isText = obj.type === 'i-text' || obj.type === 'textbox'
    if (!isText && typeof obj.fill === 'string' && obj.fill !== 'transparent' && obj.fill !== '') {
      sources.push(obj.fill)
    }
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

// Applies a box stroke renderer to a text object — stroke appears on the
// surrounding box, not on the text characters themselves.
function applyBoxStrokeRenderer(obj: any) {
  if (obj._boxStrokeApplied) return
  const protoRenderBg = (fabric.IText.prototype as any)._renderBackground
  obj._renderBackground = function (ctx: CanvasRenderingContext2D) {
    // Draw Fabric's built-in backgroundColor if set
    if (this.backgroundColor) protoRenderBg.call(this, ctx)
    // Draw border around the textbox (not the characters)
    if (this._boxStroke && this._boxStrokeWidth > 0) {
      const extra = 4
      ctx.save()
      ctx.strokeStyle = this._boxStroke
      ctx.lineWidth = this._boxStrokeWidth
      ctx.lineJoin = 'round'
      ctx.strokeRect(
        -this.width / 2 - extra,
        -this.height / 2 - extra,
        this.width + extra * 2,
        this.height + extra * 2,
      )
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

// Circular handle renderer for line endpoint controls
function renderEndpointHandle(ctx: CanvasRenderingContext2D, left: number, top: number) {
  ctx.save()
  ctx.fillStyle = '#3B82F6'
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(left, top, 7, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

// Replaces default Fabric controls on a Line with endpoint-only drag handles.
// Dragging an endpoint moves that point; dragging the line body moves the whole line.
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
        l.setCoords()
        return true
      },
      cursorStyle: 'crosshair',
      actionName: 'modifyEndpoint',
      render: renderEndpointHandle,
      sizeX: 14,
      sizeY: 14,
    })

  line.controls = { p1: makeEndpointControl('p1'), p2: makeEndpointControl('p2') }
  line.hasBorders = false
}

// Override _render on a line to draw an arrowhead if _isArrow is set
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
    ctx.lineWidth = this.strokeWidth
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(p.x2 - hl * Math.cos(angle - ha), p.y2 - hl * Math.sin(angle - ha))
    ctx.lineTo(p.x2, p.y2)
    ctx.lineTo(p.x2 - hl * Math.cos(angle + ha), p.y2 - hl * Math.sin(angle + ha))
    ctx.stroke()
    ctx.restore()
  }
  ;(line as any)._arrowRendererApplied = true
}

function applyLineControlsToAll(canvas: fabric.Canvas) {
  canvas.getObjects().forEach((obj: any) => {
    if (obj.type === 'line') {
      obj.objectCaching = false  // keep caching off so _render override always runs
      applyLineEndpointControls(obj as fabric.Line)
      if (obj._isArrow) { applyArrowRenderer(obj as fabric.Line); obj.dirty = true }
    }
  })
}

// Re-measures actual Textbox heights and repositions all legend rows + resizes bg.
// Pass newWidth to also resize label wrap width (on horizontal drag resize).
function relayoutLegend(canvas: fabric.Canvas, newBgWidth?: number) {
  const bg = canvas.getObjects().find((o: any) => o.isLegendBg) as any
  if (!bg) return
  const s = (bg._legendScale ?? 1) as number
  const pad = Math.round(14 * s), titleH = Math.round(28 * s)
  const swatchSz = Math.round(18 * s), xBtnSize = Math.round(16 * s)
  const rowPad = Math.round(8 * s), labelGap = Math.round(10 * s)
  const y = bg.top as number
  const bgW = newBgWidth ?? (bg.width as number)

  // If new width supplied, bake it into the bg rect (reset scale)
  if (newBgWidth !== undefined) {
    bg.set({ width: newBgWidth, scaleX: 1 }); bg.setCoords()
  }

  // Recompute label wrap width from current bg width
  const labelW = bgW - pad * 2 - swatchSz - labelGap - xBtnSize - Math.round(8 * s)

  // Labels in canvas insertion order (which matches colors order)
  const labels = canvas.getObjects().filter((o: any) =>
    o.isLegend && (o.type === 'textbox' || o.type === 'i-text') && o.legendColor && !o.isLegendX
  ) as any[]

  let curY = y + pad + titleH
  labels.forEach((label: any) => {
    const color = label.legendColor
    const swatch = canvas.getObjects().find((o: any) => o.isLegendSwatch && o.legendColor === color) as any
    const xBtn = canvas.getObjects().find((o: any) => o.isLegendX && o.legendColor === color) as any
    // Update label width if horizontal resize changed it
    if (newBgWidth !== undefined && Math.abs(label.width - labelW) > 1) {
      label.set({ width: labelW }); label.initDimensions()
    }
    const labelH = label.height ?? swatchSz
    const rowH = Math.max(swatchSz, labelH) + rowPad
    // Swatch top-aligns with first line of text
    if (swatch) { swatch.set({ top: curY, left: bg.left + pad }); swatch.setCoords() }
    label.set({ top: curY, left: bg.left + pad + swatchSz + labelGap }); label.setCoords()
    if (xBtn) { xBtn.set({ top: curY, left: bg.left + bgW - pad - xBtnSize }); xBtn.setCoords() }
    curY += rowH
  })

  // Resize bg height to fit content; also update LEGEND title position
  const newH = (curY - y) + Math.round(pad / 2)
  bg.set({ height: newH, scaleY: 1 }); bg.setCoords()

  // Update LEGEND title left in case width changed
  const title = canvas.getObjects().find((o: any) => o.isLegend && !o.legendColor && !o.isLegendBg && !o.isLegendX) as any
  if (title) { title.set({ left: bg.left + pad, top: y + pad - 2 }); title.setCoords() }

  canvas.renderAll()
}

// Switch fully to select mode (tool changes too — used by Escape key)
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
  const legendResizingRef = useRef(false)  // guard against double-fire during resize
  const copiedRef = useRef<fabric.FabricObject | null>(null)

  // Stable refs so canvas event handlers (defined once) can call latest versions
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
      applyBoxStrokeToAll(c); applyLineControlsToAll(c)
      c.renderAll(); loadingHistoryRef.current = false; syncButtons()
    })
  }, [syncButtons])

  const undo = useCallback(() => { if (hIdxRef.current > 0) loadHistoryState(hIdxRef.current - 1) }, [loadHistoryState])
  const redo = useCallback(() => { if (hIdxRef.current < historyRef.current.length - 1) loadHistoryState(hIdxRef.current + 1) }, [loadHistoryState])

  // -- Tool --

  const changeTool = useCallback((tool: Tool) => {
    setActiveTool(tool); activeToolRef.current = tool
    const c = fabricRef.current; if (!c) return
    c.isDrawingMode = false
    if (tool === 'select') {
      c.selection = true; (c as any).skipTargetFind = false; c.defaultCursor = 'default'; c.hoverCursor = 'move'
    } else {
      // skipTargetFind = true: drawing tools can't accidentally interact with existing objects
      c.selection = false; (c as any).skipTargetFind = true
      c.discardActiveObject(); c.defaultCursor = 'crosshair'; c.hoverCursor = 'crosshair'; c.renderAll()
    }
  }, [])

  // -- Color mode --

  const setColorModeAction = useCallback((next: ColorMode) => {
    setColorMode(next); colorModeRef.current = next
  }, [])

  const toggleColorMode = useCallback(() => {
    const next: ColorMode = colorModeRef.current === 'stroke' ? 'fill' : 'stroke'
    setColorMode(next); colorModeRef.current = next
  }, [])

  // -- Unified color picker --

  const changeColor = useCallback((color: AnnotationColor) => {
    const c = fabricRef.current
    const mode = colorModeRef.current
    const obj = c?.getActiveObject()

    if (mode === 'text') {
      setActiveTextColor(color); activeTextColorRef.current = color
      if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
        obj.set({ fill: color }); obj.dirty = true
        c!.renderAll(); saveHistory()
      }
      return
    }

    if (mode === 'stroke') {
      setActiveColor(color); activeColorRef.current = color
      setIsStroked(true); isStrokedRef.current = true
      if (obj && obj.type !== 'i-text' && obj.type !== 'textbox') {
        obj.set({ stroke: hexToRgba(color, strokeOpacityRef.current), strokeWidth: strokeWidthRef.current })
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

  // -- Clear fill --

  const clearFill = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type === 'i-text' || obj.type === 'textbox') {
      obj.set({ backgroundColor: '' }); obj.dirty = true
      lastTextFillColorRef.current = ''
    } else {
      setIsFilled(false); isFilledRef.current = false
      obj.set({ fill: 'transparent' })
    }
    c.renderAll(); saveHistory()
  }, [saveHistory])

  const clearStroke = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type !== 'i-text' && obj.type !== 'textbox') {
      setIsStroked(false); isStrokedRef.current = false
      obj.set({ stroke: '', strokeWidth: 0 })
      c.renderAll(); saveHistory()
    }
  }, [saveHistory])

  // -- Legend shape placement --

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
      // Re-clone so paste again works
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

  // -- Unified opacity (stroke or fill depending on mode) --

  const changeOpacity = useCallback((opacity: number) => {
    const c = fabricRef.current
    const mode = colorModeRef.current
    const obj = c?.getActiveObject()

    if (mode === 'stroke') {
      setStrokeOpacity(opacity); strokeOpacityRef.current = opacity
      if (obj && obj.type !== 'i-text' && obj.type !== 'textbox') {
        obj.set({ stroke: hexToRgba(activeColorRef.current, opacity) })
        c!.renderAll(); saveHistory()
      }
    } else if (mode === 'text') {
      // Opacity not applicable to text character color
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

  // -- Stroke width (shapes only, not text) --

  const changeStrokeWidth = useCallback((w: number) => {
    setStrokeWidth(w); strokeWidthRef.current = w
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type !== 'i-text' && obj.type !== 'textbox') {
      obj.set({ strokeWidth: w }); c.renderAll(); saveHistory()
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
    // If the legend background is selected, delete the entire legend
    const deletingLegendBg = objs.some((o: any) => o.isLegendBg)
    if (deletingLegendBg) {
      c.getObjects().filter((o: any) => o.isLegend).forEach((o) => c.remove(o))
    } else {
      objs.forEach((o) => c.remove(o))
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
      // Exclude X buttons (type 'text' / FabricText) — they contain '✕' not a label
      if (o.isLegend && o.legendColor && !o.isLegendX && !o.isLegendSwatch &&
          (o.type === 'i-text' || o.type === 'textbox' || o.type === 'text'))
        legendLabelsRef.current[o.legendColor] = o.text || 'edit'
    })
  }, [])

  const buildLegend = useCallback((colors: string[], position?: { x: number; y: number }, scale = 1) => {
    const c = fabricRef.current; if (!c) return
    c.getObjects().filter((o: any) => o.isLegend).forEach((o) => c.remove(o))
    const s = Math.max(0.25, scale)
    const pad = Math.round(14 * s), swatchSz = Math.round(18 * s)
    const labelGap = Math.round(10 * s), titleH = Math.round(28 * s)
    const xBtnSize = Math.round(16 * s), rowPad = Math.round(8 * s)
    const totalW = Math.round(220 * s)
    const maxLabelW = totalW - pad * 2 - swatchSz - labelGap - xBtnSize - Math.round(8 * s)
    const fontSize = Math.round(15 * s)

    if (colors.length === 0) {
      const emptyH = pad * 2 + Math.round(60 * s)
      const x = position?.x ?? (c.width! - totalW) / 2, y = position?.y ?? (c.height! - emptyH) / 2
      const bg = new fabric.Rect({ left: x, top: y, width: totalW, height: emptyH, fill: 'rgba(0,0,0,0.8)', rx: Math.round(8 * s), ry: Math.round(8 * s), stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, shadow: makeShadow(), selectable: true, evented: true, hoverCursor: 'move' })
      ;(bg as any).isLegend = true; (bg as any).isLegendBg = true; (bg as any)._legendScale = s; c.add(bg)
      const hint = new fabric.FabricText('Add an element to\nbuild the legend.', { left: x + pad, top: y + pad, fontFamily: 'Arial, sans-serif', fontSize: Math.round(12 * s), fill: 'rgba(255,255,255,0.45)', selectable: false, evented: false })
      ;(hint as any).isLegend = true; c.add(hint)
      c.renderAll(); return
    }

    // --- Two-pass layout: measure Textbox heights first, then place everything ---
    // Pass 1: create all Textboxes off-screen to measure their wrapped height
    const labelTexts = colors.map(color => legendLabelsRef.current[color] || 'edit')
    const tempLabels = labelTexts.map(text => {
      const tb = new fabric.Textbox(text, {
        left: -9999, top: -9999,
        fontFamily: 'Arial, sans-serif', fontSize, fill: '#FFFFFF',
        width: maxLabelW, splitByGrapheme: false,
      })
      c.add(tb); tb.initDimensions()
      return tb
    })
    const rowHeights = tempLabels.map(tb => Math.max(swatchSz, tb.height ?? swatchSz) + rowPad)
    tempLabels.forEach(tb => c.remove(tb))

    const totalH = pad + titleH + rowHeights.reduce((a, b) => a + b, 0) + Math.round(pad / 2)
    const x = position?.x ?? (c.width! - totalW) / 2, y = position?.y ?? (c.height! - totalH) / 2

    // Background box — height calculated from actual content
    const bg = new fabric.Rect({ left: x, top: y, width: totalW, height: totalH, fill: 'rgba(0,0,0,0.8)', rx: Math.round(8 * s), ry: Math.round(8 * s), stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, shadow: makeShadow(), selectable: true, evented: true, hoverCursor: 'move' })
    ;(bg as any).isLegend = true; (bg as any).isLegendBg = true; (bg as any)._legendScale = s; c.add(bg)
    const title = new fabric.FabricText('LEGEND', { left: x + pad, top: y + pad - 2, fontFamily: 'Arial, sans-serif', fontSize: Math.round(13 * s), fontWeight: 'bold', fill: 'rgba(255,255,255,0.6)', selectable: false, evented: false })
    ;(title as any).isLegend = true; c.add(title)

    // Pass 2: place rows using measured heights — swatch top-aligns with first text line
    let curY = y + pad + titleH
    colors.forEach((color, i) => {
      const rowH = rowHeights[i]
      // Swatch top = curY (same as label top) so first text line aligns with swatch
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
        fontFamily: 'Arial, sans-serif', fontSize: Math.round(12 * s), fill: 'rgba(255,255,255,0.55)',
        selectable: false, evented: false, hasControls: false, hasBorders: false, hoverCursor: 'pointer',
        lockMovementX: true, lockMovementY: true, visible: false,
      })
      ;(xBtn as any).isLegend = true; (xBtn as any).isLegendX = true; (xBtn as any).legendColor = color; c.add(xBtn)
      curY += rowH
    })
    c.renderAll()
  }, [])

  // Toggle: if legend exists → remove it. If not → create it (starts empty, fills as shapes are added).
  const createLegend = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const existingBg = c.getObjects().find((o: any) => o.isLegendBg)
    if (existingBg) {
      c.getObjects().filter((o: any) => o.isLegend).forEach((o) => c.remove(o))
      c.renderAll(); saveHistory(); return
    }
    saveLegendLabels()
    legendExcludedColorsRef.current = new Set() // reset exclusions when re-opening
    const usedColors = getUsedColors(c)
    buildLegend(usedColors)
    saveHistory(); changeTool('select')
  }, [buildLegend, saveLegendLabels, saveHistory, changeTool])

  // Remove a single color row from the legend (user taps X)
  const removeLegendColor = useCallback((color: string) => {
    const c = fabricRef.current; if (!c) return
    legendExcludedColorsRef.current.add(color)
    const existingBg = c.getObjects().find((o: any) => o.isLegendBg)
    if (!existingBg) return
    saveLegendLabels()
    const usedColors = getUsedColors(c).filter(clr => !legendExcludedColorsRef.current.has(clr))
    const currentScale = (existingBg as any)._legendScale ?? 1
    buildLegend(usedColors, { x: existingBg.left!, y: existingBg.top! }, currentScale)
    saveHistory()
  }, [buildLegend, saveLegendLabels, saveHistory])

  const maybeUpdateLegend = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const existingBg = c.getObjects().find((o: any) => o.isLegendBg); if (!existingBg) return
    saveLegendLabels()
    const usedColors = getUsedColors(c).filter(clr => !legendExcludedColorsRef.current.has(clr))
    const cur = [...new Set(c.getObjects().filter((o: any) => o.isLegend && o.legendColor && !o.isLegendX && !o.isLegendSwatch).map((o: any) => o.legendColor as string))]
    // Rebuild if colors differ in any way
    const same = usedColors.length === cur.length && usedColors.every((clr) => cur.includes(clr))
    if (same) return
    const currentScale = (existingBg as any)._legendScale ?? 1
    buildLegend(usedColors, { x: existingBg.left!, y: existingBg.top! }, currentScale)
    saveHistory()
  }, [buildLegend, saveLegendLabels, saveHistory])

  // Keep refs in sync so canvas event handlers call latest versions
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
      // Free corner-scaling by default; hold Shift to lock aspect ratio
      canvas.uniformScaling = false
      fabricRef.current = canvas

      if (initialState) {
        canvas.loadFromJSON(JSON.parse(initialState)).then(() => {
          applyBoxStrokeToAll(canvas); applyLineControlsToAll(canvas); canvas.renderAll(); saveHistory()
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

      // Helper to derive selectedType from canvas
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
        // Determine if this is a line/arrow (line object with _isArrow or plain line — no fill option)
        const isLine = obj.type === 'line'
        setSelectedType('shape')
        setSelectedSubType(isLine ? 'line' : 'fillable')
        // Lines/arrows always use stroke mode
        if (isLine || colorModeRef.current === 'text') {
          setColorMode('stroke'); colorModeRef.current = 'stroke'
        }
        // Sync isFilled / isStroked from object
        const objFill = (obj as any).fill
        const hasFill = !isLine && objFill && objFill !== 'transparent' && objFill !== ''
        setIsFilled(!!hasFill); isFilledRef.current = !!hasFill
        const objStroke = (obj as any).stroke
        const hasStroke = objStroke && objStroke !== ''
        setIsStroked(!!hasStroke); isStrokedRef.current = !!hasStroke
      }

      // Mouse
      canvas.on('mouse:down', (opt) => {
        const tool = activeToolRef.current, color = activeColorRef.current
        if (tool === 'select') return
        const pointer = getPointer(canvas, opt)

        if (tool === 'text') {
          const txt = new fabric.IText('', {
            left: pointer.x, top: pointer.y,
            fontFamily: 'Arial, sans-serif', fontSize: fontSizeRef.current, fontWeight: 'bold',
            fill: activeTextColorRef.current, backgroundColor: '#000000',
            stroke: '', strokeWidth: 0,
            shadow: makeShadow(),
          })
          applyBoxStrokeRenderer(txt as any)
          canvas.add(txt); canvas.setActiveObject(txt); (txt as fabric.IText).enterEditing(); return
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
        const pointer = getPointer(canvas, opt), s = startRef.current, shape = shapeRef.current, tool = activeToolRef.current
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
          if (len < 4) { canvas.remove(shape) }
          else if (tool === 'arrow') {
            // objectCaching=false (set at creation) ensures _render override is always called, not a stale cache
            ;(shape as any)._isArrow = true
            applyArrowRenderer(shape as fabric.Line)
            applyLineEndpointControls(shape as fabric.Line)
            shape.dirty = true
            shape.setCoords(); canvas.setActiveObject(shape); saveHistory()
          } else {
            if (shape.type === 'line') applyLineEndpointControls(shape as fabric.Line)
            shape.setCoords(); canvas.setActiveObject(shape); saveHistory()
          }
        }
        // Keep drawing tool active — re-enable selection so the placed shape has handles
        // but keep skipTargetFind=true so the tool doesn't accidentally select on next click
        canvas.selection = true; (canvas as any).skipTargetFind = true
        canvas.defaultCursor = 'crosshair'
        maybeUpdateLegendRef.current()
        shapeRef.current = null; canvas.renderAll()
      })

      const setXBtnsVisible = (visible: boolean) => {
        canvas.getObjects().forEach((o: any) => {
          if (o.isLegendX) { o.visible = visible; o.evented = visible }
        })
      }

      canvas.on('selection:created', (opt: any) => {
        setHasSelection(true); syncSelectedType()
        const obj = opt.selected?.[0] as any
        canvas.uniformScaling = !!obj?.isLegendBg
        const legendBgSelected = !!obj?.isLegendBg
        setXBtnsVisible(legendBgSelected)
        if (obj?.isLegendSwatch && obj?.legendColor) {
          setLegendPickerColor(obj.legendColor)
          canvas.discardActiveObject(); canvas.renderAll()
        } else {
          setLegendPickerColor(null)
        }
      })
      canvas.on('selection:updated', (opt: any) => {
        setHasSelection(true); syncSelectedType()
        const obj = opt.selected?.[0] as any
        canvas.uniformScaling = !!obj?.isLegendBg
        const legendBgSelected = !!obj?.isLegendBg
        setXBtnsVisible(legendBgSelected)
        if (obj?.isLegendSwatch && obj?.legendColor) {
          setLegendPickerColor(obj.legendColor)
          canvas.discardActiveObject(); canvas.renderAll()
        } else {
          setLegendPickerColor(null)
        }
      })
      canvas.on('selection:cleared', () => {
        setHasSelection(false); setSelectedType('none'); setLegendPickerColor(null)
        canvas.uniformScaling = false
        setXBtnsVisible(false)
      })

      // Shift-key rotation snapping to 30° intervals
      canvas.on('object:rotating', (opt: any) => {
        if ((opt.e as MouseEvent).shiftKey) {
          const obj = opt.target
          obj.angle = Math.round(obj.angle / 30) * 30
        }
      })

      // While scaling the legend bg, show a live preview by relaying out children
      canvas.on('object:scaling', (opt: any) => {
        const obj = opt.target as any
        if (!obj?.isLegendBg || legendResizingRef.current) return
        const newW = Math.round((obj.width as number) * (obj.scaleX as number))
        legendResizingRef.current = true
        relayoutLegend(canvas, newW)
        legendResizingRef.current = false
      })

      canvas.on('object:modified', (opt: any) => {
        if (legendResizingRef.current) return
        const obj = opt.target as any
        if (obj?.isLegendBg && (obj.scaleX !== 1 || obj.scaleY !== 1)) {
          legendResizingRef.current = true
          // Bake scale into actual pixel dimensions — keep font sizes unchanged
          const newW = Math.round((obj.width as number) * (obj.scaleX as number))
          // Height is managed by relayoutLegend from content — ignore scaleY
          obj.set({ width: newW, scaleX: 1, scaleY: 1 }); obj.setCoords()
          relayoutLegend(canvas, newW)
          legendResizingRef.current = false
        }
        saveHistory()
      })

      let legendDragStart: { x: number; y: number } | null = null
      canvas.on('object:moving', (opt) => {
        const obj = opt.target as any; if (!obj?.isLegendBg) return
        const dx = obj.left! - (legendDragStart?.x ?? obj.left!), dy = obj.top! - (legendDragStart?.y ?? obj.top!)
        legendDragStart = { x: obj.left!, y: obj.top! }
        canvas.getObjects().forEach((o: any) => { if (o.isLegend && o !== obj) { o.set({ left: o.left! + dx, top: o.top! + dy }); o.setCoords() } })
      })
      canvas.on('mouse:down', (opt) => {
        const t = opt.target as any
        if (t?.isLegendBg) legendDragStart = { x: t.left!, y: t.top! }
        // X button — remove that color row
        if (t?.isLegendX && t?.legendColor) {
          removeLegendColorRef.current(t.legendColor)
          canvas.discardActiveObject(); canvas.renderAll()
          return
        }
        // Single click enters editing mode for legend text labels
        if (t?.isLegend && (t.type === 'i-text' || t.type === 'textbox')) {
          canvas.setActiveObject(t)
          ;(t as fabric.IText).enterEditing()
          canvas.renderAll()
        }
      })
      canvas.on('mouse:up', () => { legendDragStart = null })

      // Live-resize legend box as user types
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
        // Select the text object but keep the text tool active (same pattern as shapes)
        if (t && t.text?.trim() !== '') canvas.setActiveObject(t)
        // Re-enable canvas selection so handles work, keep skipTargetFind=true for drawing tools
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
          if (e.key === 'a' && !isEditing) { e.preventDefault(); const objs = canvas.getObjects().filter((o: any) => !o.isLegend); if (objs.length) { canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas })); canvas.renderAll() } return }
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
    changeTool, setColorModeAction, toggleColorMode, changeColor, clearFill, clearStroke,
    changeOpacity, changeStrokeWidth, changeFontSize,
    copySelected, pasteSelected, duplicateSelected,
    placeLegendShape,
    undo, redo, deleteSelected, downloadImage, saveEditable, createLegend, removeLegendColor,
    fabricRef,
  }
}
