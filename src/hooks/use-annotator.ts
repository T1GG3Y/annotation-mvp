'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import * as fabric from 'fabric'

// ---------------------------------------------------------------------------
// Types & constants (exported for use by variant UIs)
// ---------------------------------------------------------------------------

export type Tool = 'select' | 'arrow' | 'line' | 'circle' | 'rectangle' | 'text'
export type AnnotationColor = '#EF4444' | '#FACC15' | '#69BE28' | '#3B82F6'

export const COLORS: { value: AnnotationColor; label: string }[] = [
  { value: '#EF4444', label: 'Red' },
  { value: '#FACC15', label: 'Yellow' },
  { value: '#69BE28', label: 'Green' },
  { value: '#3B82F6', label: 'Blue' },
]

export const STROKE_WIDTHS = [3, 6, 10] as const
export const STROKE_LABELS = ['Thin', 'Medium', 'Thick'] as const

const DEFAULT_STROKE = 6
const MAX_HISTORY = 40

function makeShadow() {
  return new fabric.Shadow({ color: 'rgba(0, 0, 0, 0.75)', blur: 10, offsetX: 2, offsetY: 2 })
}

export function hexToRgba(hex: string, alpha: number): string {
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

  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [activeColor, setActiveColor] = useState<AnnotationColor>('#EF4444')
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE)
  const [isFilled, setIsFilled] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)

  const activeToolRef = useRef<Tool>('select')
  const activeColorRef = useRef<AnnotationColor>('#EF4444')
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
      c.selection = true; (c as any).skipTargetFind = false; c.defaultCursor = 'default'; c.hoverCursor = 'move'
    } else {
      c.selection = false; (c as any).skipTargetFind = true
      c.discardActiveObject(); c.defaultCursor = 'crosshair'; c.hoverCursor = 'crosshair'; c.renderAll()
    }
  }, [])

  const changeColor = useCallback((color: AnnotationColor) => {
    setActiveColor(color); activeColorRef.current = color
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject(); if (!obj) return
    if (obj.type === 'i-text' || obj.type === 'textbox') { obj.set({ fill: color }) }
    else { obj.set({ stroke: color }); if (obj.fill && obj.fill !== 'transparent') obj.set({ fill: hexToRgba(color, 0.2) }) }
    c.renderAll(); saveHistory()
  }, [saveHistory])

  const changeStrokeWidth = useCallback((w: number) => {
    setStrokeWidth(w); strokeWidthRef.current = w
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject()
    if (obj && obj.type !== 'i-text' && obj.type !== 'textbox') { obj.set({ strokeWidth: w }); c.renderAll(); saveHistory() }
  }, [saveHistory])

  const toggleFill = useCallback(() => {
    const next = !isFilledRef.current; setIsFilled(next); isFilledRef.current = next
    const c = fabricRef.current; if (!c) return
    const obj = c.getActiveObject()
    if (obj && (obj.type === 'ellipse' || obj.type === 'rect')) {
      obj.set({ fill: next ? hexToRgba((obj.stroke as string) || activeColorRef.current, 0.2) : 'transparent' })
      c.renderAll(); saveHistory()
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
    const bg = new fabric.Rect({ left: x, top: y, width: totalW, height: totalH, fill: 'rgba(0,0,0,0.8)', rx: 8, ry: 8, stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, shadow: makeShadow(), selectable: true, evented: true, hoverCursor: 'move' })
    ;(bg as any).isLegend = true; (bg as any).isLegendBg = true; c.add(bg)
    const title = new fabric.Text('LEGEND', { left: x + pad, top: y + pad - 2, fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 'bold', fill: 'rgba(255,255,255,0.6)', selectable: false, evented: false })
    ;(title as any).isLegend = true; c.add(title)
    colors.forEach((color, i) => {
      const rowY = y + pad + titleH + i * rowH
      const sw = new fabric.Rect({ left: x + pad, top: rowY, width: swatchSz, height: swatchSz, fill: color, rx: 3, ry: 3, selectable: false, evented: false })
      ;(sw as any).isLegend = true; (sw as any).legendColor = color; c.add(sw)
      const label = new fabric.IText(legendLabelsRef.current[color] || 'Edit', { left: x + pad + swatchSz + 10, top: rowY - 1, fontFamily: 'Arial, sans-serif', fontSize: 15, fill: '#FFFFFF', editable: true })
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
    // Auto-switch to select so user can immediately move the legend
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
      const canvas = new fabric.Canvas(el, { width: w, height: h, backgroundColor: '#18181b', selection: true, preserveObjectStacking: true })
      fabricRef.current = canvas

      if (initialState) {
        canvas.loadFromJSON(JSON.parse(initialState)).then(() => { canvas.renderAll(); saveHistory() }).catch((e: any) => console.error('Load failed:', e))
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

      // Mouse
      canvas.on('mouse:down', (opt) => {
        const tool = activeToolRef.current, color = activeColorRef.current
        if (tool === 'select') return
        const pointer = getPointer(canvas, opt)
        if (tool === 'text') {
          const txt = new fabric.IText('', { left: pointer.x, top: pointer.y, fontFamily: 'Arial, sans-serif', fontSize: 24, fontWeight: 'bold', fill: color, stroke: 'rgba(0,0,0,0.85)', strokeWidth: 0.5, shadow: makeShadow(), paintFirst: 'stroke' })
          canvas.add(txt); canvas.setActiveObject(txt); (txt as fabric.IText).enterEditing(); return
        }
        isDrawingRef.current = true; startRef.current = { x: pointer.x, y: pointer.y }
        const sw = strokeWidthRef.current, filled = isFilledRef.current
        let shape: fabric.FabricObject | null = null
        if (tool === 'circle') shape = new fabric.Ellipse({ left: pointer.x, top: pointer.y, rx: 0, ry: 0, fill: filled ? hexToRgba(color, 0.2) : 'transparent', stroke: color, strokeWidth: sw, strokeUniform: true, shadow: makeShadow(), originX: 'center', originY: 'center' })
        else if (tool === 'rectangle') shape = new fabric.Rect({ left: pointer.x, top: pointer.y, width: 0, height: 0, fill: filled ? hexToRgba(color, 0.2) : 'transparent', stroke: color, strokeWidth: sw, strokeUniform: true, shadow: makeShadow() })
        else if (tool === 'line' || tool === 'arrow') shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], { stroke: color, strokeWidth: sw, strokeUniform: true, strokeLineCap: 'round', shadow: makeShadow() })
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
          const w = shift ? size : Math.abs(pointer.x - s.x)
          const h = shift ? size : Math.abs(pointer.y - s.y)
          const l = shift ? (pointer.x >= s.x ? s.x : s.x - size) : Math.min(s.x, pointer.x)
          const t = shift ? (pointer.y >= s.y ? s.y : s.y - size) : Math.min(s.y, pointer.y)
          shape.set({ left: l, top: t, width: w, height: h })
        } else if (tool === 'line' || tool === 'arrow') {
          if (shift) {
            // Snap to nearest 45-degree angle
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
          if (len < 4) canvas.remove(shape)
          else if (tool === 'arrow') {
            const l = shape as fabric.Line; const x1 = l.x1!, y1 = l.y1!, x2 = l.x2!, y2 = l.y2!
            canvas.remove(shape); const angle = Math.atan2(y2 - y1, x2 - x1)
            const hl = Math.max(strokeWidthRef.current * 4, 16), ha = Math.PI / 6
            const arrow = new fabric.Path(`M ${x1} ${y1} L ${x2} ${y2} M ${x2 - hl * Math.cos(angle - ha)} ${y2 - hl * Math.sin(angle - ha)} L ${x2} ${y2} L ${x2 - hl * Math.cos(angle + ha)} ${y2 - hl * Math.sin(angle + ha)}`,
              { stroke: activeColorRef.current, strokeWidth: strokeWidthRef.current, strokeLineCap: 'round', strokeLineJoin: 'round', fill: 'transparent', shadow: makeShadow(), strokeUniform: true })
            canvas.add(arrow); arrow.setCoords(); saveHistory()
          } else { shape.setCoords(); saveHistory() }
        }
        maybeUpdateLegend(); shapeRef.current = null; canvas.selection = activeToolRef.current === 'select'
      })
      canvas.on('selection:created', () => setHasSelection(true))
      canvas.on('selection:updated', () => setHasSelection(true))
      canvas.on('selection:cleared', () => setHasSelection(false))
      canvas.on('object:modified', () => saveHistory())
      let legendDragStart: { x: number; y: number } | null = null
      canvas.on('object:moving', (opt) => {
        const obj = opt.target as any; if (!obj?.isLegendBg) return
        const dx = obj.left! - (legendDragStart?.x ?? obj.left!), dy = obj.top! - (legendDragStart?.y ?? obj.top!)
        legendDragStart = { x: obj.left!, y: obj.top! }
        canvas.getObjects().forEach((o: any) => { if (o.isLegend && o !== obj) { o.set({ left: o.left! + dx, top: o.top! + dy }); o.setCoords() } })
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
          if (e.key === 'a' && !isEditing) { e.preventDefault(); const objs = canvas.getObjects(); if (objs.length) { canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas })); canvas.renderAll() } return }
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

  return {
    activeTool, activeColor, strokeWidth, isFilled, canUndo, canRedo, hasSelection,
    changeTool, changeColor, changeStrokeWidth, toggleFill,
    undo, redo, deleteSelected, downloadImage, saveEditable, createLegend,
  }
}
