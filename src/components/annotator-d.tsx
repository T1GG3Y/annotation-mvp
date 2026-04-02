'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import * as fabric from 'fabric'
import {
  MousePointer2, ArrowUpRight, Minus, Circle, Square, Type,
  Undo2, Redo2, Trash2, Download, Save, ArrowLeft, List,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Tool = 'select' | 'arrow' | 'line' | 'circle' | 'rectangle' | 'text'
type AnnotationColor = '#EF4444' | '#FACC15' | '#69BE28' | '#3B82F6' | '#000000' | '#FFFFFF'

// Change #3: added black and white
const COLORS: { value: AnnotationColor; label: string }[] = [
  { value: '#EF4444', label: 'Red' },
  { value: '#FACC15', label: 'Yellow' },
  { value: '#69BE28', label: 'Green' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#000000', label: 'Black' },
  { value: '#FFFFFF', label: 'White' },
]

const STROKE_WIDTHS = [3, 6, 10] as const
const DEFAULT_STROKE = 6
const MAX_HISTORY = 40
const DEFAULT_FONT_SIZE = 24
const FONT_SIZE_STEP = 2
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 72
const RECT_RADIUS = 12

// Change #6: heavier drop shadow
function makeShadow() {
  return new fabric.Shadow({ color: 'rgba(0, 0, 0, 0.85)', blur: 16, offsetX: 3, offsetY: 3 })
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getUsedColors(canvas: fabric.Canvas): string[] {
  const used: string[] = []
  const found = new Set<string>()
  canvas.getObjects().forEach((obj) => {
    if ((obj as any).isLegendGroup) return
    COLORS.forEach((col) => {
      if (!found.has(col.value) && (obj.stroke === col.value || obj.fill === col.value)) {
        found.add(col.value); used.push(col.value)
      }
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  imageUrl: string
  imageName: string
  initialState?: string | null
  onBack: () => void
}

const TOOLS: { tool: Tool; Icon: typeof MousePointer2; key: string }[] = [
  { tool: 'select', Icon: MousePointer2, key: 'V' },
  { tool: 'arrow', Icon: ArrowUpRight, key: 'A' },
  { tool: 'line', Icon: Minus, key: 'L' },
  { tool: 'circle', Icon: Circle, key: 'C' },
  { tool: 'rectangle', Icon: Square, key: 'R' },
  { tool: 'text', Icon: Type, key: 'T' },
]

export default function AnnotatorD({ imageUrl, imageName, initialState, onBack }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)

  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [activeColor, setActiveColor] = useState<AnnotationColor>('#EF4444')
  const [fillColor, setFillColor] = useState<AnnotationColor>('#000000')
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE)
  const [isFilled, setIsFilled] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)

  const activeToolRef = useRef<Tool>('select')
  const activeColorRef = useRef<AnnotationColor>('#EF4444')
  const fillColorRef = useRef<AnnotationColor>('#000000')
  const strokeWidthRef = useRef(DEFAULT_STROKE)
  const isFilledRef = useRef(false)
  const isDrawingRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })
  const shapeRef = useRef<fabric.FabricObject | null>(null)
  const historyRef = useRef<string[]>([])
  const hIdxRef = useRef(-1)
  const loadingHistoryRef = useRef(false)
  const onKeyRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const legendLabelsRef = useRef<Record<string, string>>({})

  // -- History --

  const syncButtons = useCallback(() => {
    setCanUndo(hIdxRef.current > 0)
    setCanRedo(hIdxRef.current < historyRef.current.length - 1)
  }, [])

  const saveHistory = useCallback(() => {
    if (loadingHistoryRef.current) return
    const c = fabricRef.current; if (!c) return
    historyRef.current = historyRef.current.slice(0, hIdxRef.current + 1)
    historyRef.current.push(JSON.stringify(c.toJSON()))
    if (historyRef.current.length > MAX_HISTORY) historyRef.current = historyRef.current.slice(-MAX_HISTORY)
    hIdxRef.current = historyRef.current.length - 1
    syncButtons()
  }, [syncButtons])

  const loadHistoryState = useCallback((idx: number) => {
    const c = fabricRef.current
    if (!c || idx < 0 || idx >= historyRef.current.length) return
    loadingHistoryRef.current = true; hIdxRef.current = idx
    c.loadFromJSON(JSON.parse(historyRef.current[idx])).then(() => {
      c.renderAll(); loadingHistoryRef.current = false; syncButtons()
    })
  }, [syncButtons])

  const undo = useCallback(() => { if (hIdxRef.current > 0) loadHistoryState(hIdxRef.current - 1) }, [loadHistoryState])
  const redo = useCallback(() => { if (hIdxRef.current < historyRef.current.length - 1) loadHistoryState(hIdxRef.current + 1) }, [loadHistoryState])

  // -- Tool / color / stroke / fill --

  const changeTool = useCallback((tool: Tool) => {
    setActiveTool(tool); activeToolRef.current = tool
    const c = fabricRef.current; if (!c) return
    c.isDrawingMode = false
    if (tool === 'select') {
      c.selection = true; (c as any).skipTargetFind = false
      c.defaultCursor = 'default'; c.hoverCursor = 'move'
    } else {
      c.selection = false; (c as any).skipTargetFind = true
      c.discardActiveObject(); c.defaultCursor = 'crosshair'; c.hoverCursor = 'crosshair'
      c.renderAll()
    }
  }, [])

  const changeColor = useCallback((color: AnnotationColor) => {
    setActiveColor(color); activeColorRef.current = color
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type === 'i-text' || obj.type === 'textbox') {
      obj.set({ fill: color })
    } else {
      obj.set({ stroke: color })
    }
    c.renderAll(); saveHistory()
  }, [saveHistory])

  // Change #4: fill/background color
  const changeFillColor = useCallback((color: AnnotationColor) => {
    setFillColor(color); fillColorRef.current = color
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type === 'i-text' || obj.type === 'textbox') {
      if ((obj as any).textBackgroundColor) {
        obj.set({ textBackgroundColor: hexToRgba(color, 0.75) })
      }
    } else if ((obj.type === 'ellipse' || obj.type === 'rect') && obj.fill && obj.fill !== 'transparent') {
      obj.set({ fill: hexToRgba(color, 0.3) })
    }
    c.renderAll(); saveHistory()
  }, [saveHistory])

  const changeStrokeWidth = useCallback((w: number) => {
    setStrokeWidth(w); strokeWidthRef.current = w
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject()
    if (obj && obj.type !== 'i-text' && obj.type !== 'textbox') {
      obj.set({ strokeWidth: w }); c.renderAll(); saveHistory()
    }
  }, [saveHistory])

  const toggleFill = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject()

    if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
      const hasBg = !!(obj as any).textBackgroundColor
      obj.set({ textBackgroundColor: hasBg ? '' : hexToRgba(fillColorRef.current, 0.75) })
      setIsFilled(!hasBg); isFilledRef.current = !hasBg
      c.renderAll(); saveHistory()
      return
    }

    if (obj && (obj.type === 'ellipse' || obj.type === 'rect')) {
      const hasFill = !!obj.fill && obj.fill !== 'transparent'
      obj.set({ fill: hasFill ? 'transparent' : hexToRgba(fillColorRef.current, 0.3) })
      setIsFilled(!hasFill); isFilledRef.current = !hasFill
      c.renderAll(); saveHistory()
      return
    }

    const next = !isFilledRef.current
    setIsFilled(next); isFilledRef.current = next
  }, [saveHistory])

  // Change #8: font size controls
  const increaseFontSize = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject()
    if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
      const current = (obj as fabric.IText).fontSize || DEFAULT_FONT_SIZE
      const next = Math.min(current + FONT_SIZE_STEP, MAX_FONT_SIZE)
      ;(obj as fabric.IText).set({ fontSize: next })
      setFontSize(next); c.renderAll(); saveHistory()
    }
  }, [saveHistory])

  const decreaseFontSize = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject()
    if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
      const current = (obj as fabric.IText).fontSize || DEFAULT_FONT_SIZE
      const next = Math.max(current - FONT_SIZE_STEP, MIN_FONT_SIZE)
      ;(obj as fabric.IText).set({ fontSize: next })
      setFontSize(next); c.renderAll(); saveHistory()
    }
  }, [saveHistory])

  // -- Actions --

  const deleteSelected = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const objs = c.getActiveObjects(); if (!objs.length) return
    objs.forEach((o) => c.remove(o)); c.discardActiveObject(); c.renderAll(); saveHistory()
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
      const parsed = c.toJSON()
      const bg = c.backgroundImage
      if (bg && parsed.backgroundImage) {
        const el = (bg as any).getElement?.() || (bg as any)._element
        if (el && el instanceof HTMLImageElement) {
          const tmp = document.createElement('canvas')
          tmp.width = el.naturalWidth || el.width; tmp.height = el.naturalHeight || el.height
          tmp.getContext('2d')!.drawImage(el, 0, 0)
          parsed.backgroundImage.src = tmp.toDataURL('image/jpeg', 0.85)
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
      if (o.isLegend && o.legendColor && (o.type === 'i-text' || o.type === 'text'))
        legendLabelsRef.current[o.legendColor] = (o as fabric.IText).text || 'Edit'
    })
  }, [])

  const buildLegend = useCallback((colors: string[], position?: { x: number; y: number }) => {
    const c = fabricRef.current; if (!c) return
    c.getObjects().filter((o: any) => o.isLegend).forEach((o) => c.remove(o))
    if (colors.length === 0) { c.renderAll(); return }

    const pad = 14, rowH = 30, swatchSz = 18, totalW = pad * 2 + swatchSz + 10 + 140, titleH = 28
    const totalH = pad + titleH + colors.length * rowH + pad / 2
    const x = position?.x ?? (c.width! - totalW) / 2, y = position?.y ?? (c.height! - totalH) / 2

    const bg = new fabric.Rect({
      left: x, top: y, width: totalW, height: totalH,
      fill: 'rgba(0,0,0,0.8)', rx: 8, ry: 8,
      stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1,
      shadow: makeShadow(), selectable: true, evented: true, hoverCursor: 'move',
    })
    ;(bg as any).isLegend = true; (bg as any).isLegendBg = true; c.add(bg)

    const title = new fabric.Text('LEGEND', {
      left: x + pad, top: y + pad - 2,
      fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 'bold',
      fill: 'rgba(255,255,255,0.6)', selectable: false, evented: false,
    })
    ;(title as any).isLegend = true; c.add(title)

    colors.forEach((color, i) => {
      const rowY = y + pad + titleH + i * rowH
      const sw = new fabric.Rect({
        left: x + pad, top: rowY, width: swatchSz, height: swatchSz,
        fill: color, rx: 3, ry: 3, selectable: false, evented: false,
      })
      ;(sw as any).isLegend = true; (sw as any).legendColor = color; c.add(sw)

      // Change #7: legend labels are fixed (non-movable but editable)
      const label = new fabric.IText(legendLabelsRef.current[color] || 'Edit', {
        left: x + pad + swatchSz + 10, top: rowY - 1,
        fontFamily: 'Arial, sans-serif', fontSize: 15, fill: '#FFFFFF',
        editable: true,
        lockMovementX: true, lockMovementY: true,
        hasControls: false, hasBorders: false,
      })
      ;(label as any).isLegend = true; (label as any).legendColor = color; c.add(label)
    })
    c.renderAll()
  }, [])

  const createLegend = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    saveLegendLabels()
    const usedColors = getUsedColors(c)
    if (usedColors.length === 0) COLORS.forEach((col) => usedColors.push(col.value))
    const bg = c.getObjects().find((o: any) => o.isLegendBg)
    buildLegend(usedColors, bg ? { x: bg.left!, y: bg.top! } : undefined)
    saveHistory()
    changeTool('select')
  }, [buildLegend, saveLegendLabels, saveHistory, changeTool])

  const maybeUpdateLegend = useCallback(() => {
    const c = fabricRef.current; if (!c) return
    const bg = c.getObjects().find((o: any) => o.isLegendBg); if (!bg) return
    saveLegendLabels()
    const usedColors = getUsedColors(c); if (usedColors.length === 0) return
    const cur = [...new Set(c.getObjects().filter((o: any) => o.isLegend && o.legendColor).map((o: any) => o.legendColor as string))]
    if (!usedColors.some((clr) => !cur.includes(clr))) return
    buildLegend(usedColors, { x: bg.left!, y: bg.top! })
  }, [buildLegend, saveLegendLabels])

  // -- Canvas init --

  useEffect(() => {
    const el = canvasElRef.current; const container = containerRef.current
    if (!el || !container) return

    const raf = requestAnimationFrame(() => {
      if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }
      const w = container.clientWidth, h = container.clientHeight
      if (w === 0 || h === 0) return

      const canvas = new fabric.Canvas(el, {
        width: w, height: h, backgroundColor: '#18181b',
        selection: true, preserveObjectStacking: true,
      })
      fabricRef.current = canvas

      if (initialState) {
        canvas.loadFromJSON(JSON.parse(initialState)).then(() => {
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

      // -- Mouse handlers --

      canvas.on('mouse:down', (opt) => {
        const tool = activeToolRef.current, color = activeColorRef.current
        if (tool === 'select') return
        const pointer = getPointer(canvas, opt)

        if (tool === 'text') {
          // Change #5: text defaults to white; Change #4: black background
          const txt = new fabric.IText('', {
            left: pointer.x, top: pointer.y,
            fontFamily: 'Arial, sans-serif', fontSize: DEFAULT_FONT_SIZE, fontWeight: 'bold',
            fill: '#FFFFFF',
            stroke: 'rgba(0,0,0,0.85)', strokeWidth: 0.5,
            shadow: makeShadow(), paintFirst: 'stroke',
            textBackgroundColor: hexToRgba(fillColorRef.current, 0.75),
          })
          canvas.add(txt); canvas.setActiveObject(txt); (txt as fabric.IText).enterEditing()
          return
        }

        isDrawingRef.current = true; startRef.current = { x: pointer.x, y: pointer.y }
        const sw = strokeWidthRef.current, filled = isFilledRef.current
        let shape: fabric.FabricObject | null = null

        if (tool === 'circle') {
          shape = new fabric.Ellipse({
            left: pointer.x, top: pointer.y, rx: 0, ry: 0,
            fill: filled ? hexToRgba(fillColorRef.current, 0.3) : 'transparent',
            stroke: color, strokeWidth: sw, strokeUniform: true,
            shadow: makeShadow(), originX: 'center', originY: 'center',
          })
        } else if (tool === 'rectangle') {
          // Change #2: rounded corners
          shape = new fabric.Rect({
            left: pointer.x, top: pointer.y, width: 0, height: 0,
            fill: filled ? hexToRgba(fillColorRef.current, 0.3) : 'transparent',
            stroke: color, strokeWidth: sw, strokeUniform: true,
            shadow: makeShadow(),
            rx: RECT_RADIUS, ry: RECT_RADIUS,
          })
        } else if (tool === 'line' || tool === 'arrow') {
          shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            stroke: color, strokeWidth: sw, strokeUniform: true,
            strokeLineCap: 'round', shadow: makeShadow(),
          })
        }

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
          const w2 = shift ? size : Math.abs(pointer.x - s.x)
          const h2 = shift ? size : Math.abs(pointer.y - s.y)
          const l = shift ? (pointer.x >= s.x ? s.x : s.x - size) : Math.min(s.x, pointer.x)
          const t = shift ? (pointer.y >= s.y ? s.y : s.y - size) : Math.min(s.y, pointer.y)
          shape.set({ left: l, top: t, width: w2, height: h2 })
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
            canvas.remove(shape)
          } else if (tool === 'arrow') {
            const l = shape as fabric.Line; const x1 = l.x1!, y1 = l.y1!, x2 = l.x2!, y2 = l.y2!
            canvas.remove(shape)
            const angle = Math.atan2(y2 - y1, x2 - x1)
            const hl = Math.max(strokeWidthRef.current * 4, 16), ha = Math.PI / 6
            const arrow = new fabric.Path(
              `M ${x1} ${y1} L ${x2} ${y2} M ${x2 - hl * Math.cos(angle - ha)} ${y2 - hl * Math.sin(angle - ha)} L ${x2} ${y2} L ${x2 - hl * Math.cos(angle + ha)} ${y2 - hl * Math.sin(angle + ha)}`,
              { stroke: activeColorRef.current, strokeWidth: strokeWidthRef.current, strokeLineCap: 'round', strokeLineJoin: 'round', fill: 'transparent', shadow: makeShadow(), strokeUniform: true },
            )
            canvas.add(arrow); arrow.setCoords()
            // Change #1: auto-select after creation
            canvas.setActiveObject(arrow)
            setActiveTool('select'); activeToolRef.current = 'select'
            canvas.selection = true; (canvas as any).skipTargetFind = false
            canvas.defaultCursor = 'default'; canvas.hoverCursor = 'move'
            canvas.renderAll()
            saveHistory()
          } else {
            shape.setCoords()
            // Change #1: auto-select after creation
            canvas.setActiveObject(shape)
            setActiveTool('select'); activeToolRef.current = 'select'
            canvas.selection = true; (canvas as any).skipTargetFind = false
            canvas.defaultCursor = 'default'; canvas.hoverCursor = 'move'
            canvas.renderAll()
            saveHistory()
          }
        }

        maybeUpdateLegend(); shapeRef.current = null
      })

      // Selection tracking with font size sync
      canvas.on('selection:created', (e: any) => {
        setHasSelection(true)
        const obj = e.selected?.[0]
        if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
          setFontSize((obj as fabric.IText).fontSize || DEFAULT_FONT_SIZE)
        }
      })
      canvas.on('selection:updated', (e: any) => {
        setHasSelection(true)
        const obj = e.selected?.[0]
        if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
          setFontSize((obj as fabric.IText).fontSize || DEFAULT_FONT_SIZE)
        }
      })
      canvas.on('selection:cleared', () => setHasSelection(false))
      canvas.on('object:modified', () => saveHistory())

      // Legend group drag
      let legendDragStart: { x: number; y: number } | null = null
      canvas.on('object:moving', (opt) => {
        const obj = opt.target as any; if (!obj?.isLegendBg) return
        const dx = obj.left! - (legendDragStart?.x ?? obj.left!), dy = obj.top! - (legendDragStart?.y ?? obj.top!)
        legendDragStart = { x: obj.left!, y: obj.top! }
        canvas.getObjects().forEach((o: any) => {
          if (o.isLegend && o !== obj) { o.set({ left: o.left! + dx, top: o.top! + dy }); o.setCoords() }
        })
      })
      canvas.on('mouse:down', (opt) => { const t = opt.target as any; if (t?.isLegendBg) legendDragStart = { x: t.left!, y: t.top! } })
      canvas.on('mouse:up', () => { legendDragStart = null })

      canvas.on('text:editing:exited', (opt: any) => {
        const t = opt.target
        if (t && typeof t.text === 'string' && t.text.trim() === '' && !(t as any).isLegend) canvas.remove(t)
        if (t && (t as any).isLegend && (t as any).legendColor) legendLabelsRef.current[(t as any).legendColor] = t.text || 'Edit'
        saveHistory()
      })

      // Keyboard
      const onKey = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return
        const active = canvas.getActiveObject()
        const isEditing = active && (active.type === 'i-text' || active.type === 'textbox') && (active as fabric.IText).isEditing
        if (e.metaKey || e.ctrlKey) {
          if (e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
          if (e.key === 'a' && !isEditing) {
            e.preventDefault(); const objs = canvas.getObjects()
            if (objs.length) { canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas })); canvas.renderAll() }
            return
          }
          return
        }
        if (isEditing) return
        switch (e.key) {
          case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break
          case 'Escape': canvas.discardActiveObject(); canvas.renderAll(); changeTool('select'); break
          case 'v': case 'V': changeTool('select'); break
          case 'a': case 'A': changeTool('arrow'); break
          case 'l': case 'L': changeTool('line'); break
          case 'c': case 'C': changeTool('circle'); break
          case 'r': case 'R': changeTool('rectangle'); break
          case 't': case 'T': changeTool('text'); break
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

  // -- Render --

  const pill = 'bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/50 rounded-2xl shadow-2xl px-2.5 py-2 flex items-center gap-1.5'

  return (
    <div className="h-screen relative bg-zinc-950">
      <div ref={containerRef} className="absolute inset-0"><canvas ref={canvasElRef} /></div>

      {/* Top-left: back */}
      <div className="absolute top-3 left-3 z-10">
        <button onClick={onBack} className={`${pill} !px-4 text-zinc-400 hover:text-white`}><ArrowLeft size={20} /></button>
      </div>

      {/* Top-right: actions */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <div className={pill}>
          <button onClick={undo} disabled={!canUndo} className="p-2.5 rounded-xl text-zinc-400 hover:text-white disabled:opacity-25"><Undo2 size={20} /></button>
          <button onClick={redo} disabled={!canRedo} className="p-2.5 rounded-xl text-zinc-400 hover:text-white disabled:opacity-25"><Redo2 size={20} /></button>
          <button onClick={deleteSelected} disabled={!hasSelection} className="p-2.5 rounded-xl text-zinc-400 hover:text-white disabled:opacity-25"><Trash2 size={20} /></button>
          <button onClick={createLegend} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-zinc-400 hover:text-white"><List size={20} /> <span className="text-sm font-medium">Legend</span></button>
        </div>
        <button onClick={saveEditable} className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/50 rounded-2xl shadow-2xl px-4 py-3 text-white text-sm font-medium hover:bg-zinc-800/90 flex items-center gap-2"><Save size={18} /> Save</button>
        <button onClick={downloadImage} className="bg-blue-600/90 backdrop-blur-sm border border-blue-500/50 rounded-2xl shadow-2xl px-4 py-3 text-white text-sm font-medium hover:bg-blue-500/90 flex items-center gap-2"><Download size={18} /> Export</button>
      </div>

      {/* Right side panel: colors, fill, stroke, font size */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10">
        <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/50 rounded-2xl shadow-2xl p-2.5 flex flex-col items-center gap-2">

          {/* Stroke/text colors — 2-column grid */}
          <div className="grid grid-cols-2 gap-2">
            {COLORS.map(({ value, label }) => (
              <button key={value} onClick={() => changeColor(value)} title={label}
                className={`w-9 h-9 rounded-full border-2 transition-all ${
                  activeColor === value ? 'border-blue-500 scale-110' :
                  value === '#FFFFFF' ? 'border-zinc-400 hover:border-zinc-300' :
                  value === '#000000' ? 'border-zinc-500 hover:border-zinc-400' :
                  'border-zinc-600 hover:border-zinc-400'
                }`}
                style={{ backgroundColor: value }} />
            ))}
          </div>

          <div className="h-px w-full bg-zinc-700" />

          {/* Fill toggle */}
          <button onClick={toggleFill} title="Toggle fill / text background"
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${isFilled ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}>
            <div className="w-5 h-5 rounded-sm border-2" style={{
              borderColor: activeColor,
              backgroundColor: isFilled ? hexToRgba(fillColor, 0.5) : 'transparent',
            }} />
          </button>

          {/* Fill/bg colors — compact 3-column grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {COLORS.map(({ value, label }) => (
              <button key={`fill-${value}`} onClick={() => changeFillColor(value)} title={`Fill: ${label}`}
                className={`w-6 h-6 rounded-full border-2 transition-all ${
                  fillColor === value ? 'border-blue-500 scale-110' :
                  value === '#FFFFFF' ? 'border-zinc-400 hover:border-zinc-300' :
                  value === '#000000' ? 'border-zinc-500 hover:border-zinc-400' :
                  'border-zinc-600 hover:border-zinc-400'
                }`}
                style={{ backgroundColor: value }} />
            ))}
          </div>

          <div className="h-px w-full bg-zinc-700" />

          {/* Change #9: stroke width as horizontal bars */}
          {STROKE_WIDTHS.map((w) => (
            <button key={w} onClick={() => changeStrokeWidth(w)} title={`${w}px`}
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${strokeWidth === w ? 'bg-blue-600' : 'hover:bg-zinc-800'}`}>
              <div className="rounded-full bg-zinc-200" style={{ width: 24, height: w === 3 ? 2 : w === 6 ? 4 : 7 }} />
            </button>
          ))}

          <div className="h-px w-full bg-zinc-700" />

          {/* Change #8: font size controls */}
          <div className="flex flex-col items-center gap-0.5">
            <button onClick={increaseFontSize} title="Increase font size"
              className="w-10 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white text-sm font-bold">
              A<span className="text-[10px] ml-0.5">+</span>
            </button>
            <span className="text-[10px] text-zinc-500 font-mono tabular-nums">{fontSize}</span>
            <button onClick={decreaseFontSize} title="Decrease font size"
              className="w-10 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white text-xs font-bold">
              A<span className="text-[10px] ml-0.5">&minus;</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom center: tools */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10">
        <div className={`${pill} gap-1`}>
          {TOOLS.map(({ tool, Icon, key }) => (
            <button key={tool} onClick={() => changeTool(tool)} title={key}
              className={`p-3.5 rounded-xl transition-colors ${activeTool === tool ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
              <Icon size={24} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
