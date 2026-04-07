'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import * as fabric from 'fabric'
import { MousePointer2, ArrowUpRight, Minus, Circle, Square, Type, Undo2, Redo2, Trash2, Download, ArrowLeft, AArrowUp, AArrowDown, Pen, PaintBucket, Eye, List, RotateCcw, MoreHorizontal } from 'lucide-react'
import { useAnnotator, COLORS, STROKE_WIDTHS, STROKE_LABELS, type Tool } from '@/hooks/use-annotator'
import { applyDamageVisibility } from '@/lib/image-enhance'

interface Props { imageUrl: string; imageName: string; initialState?: string | null; onBack: () => void }

const TOOLS: { tool: Tool; Icon: typeof MousePointer2 }[] = [
  { tool: 'circle', Icon: Circle },
  { tool: 'rectangle', Icon: Square },
  { tool: 'arrow', Icon: ArrowUpRight },
  { tool: 'line', Icon: Minus },
  { tool: 'text', Icon: Type },
  { tool: 'select', Icon: MousePointer2 },
]

function StrokeBarIcon({ width }: { width: number }) {
  const h = width <= 3 ? 2 : width <= 6 ? 4 : 7
  return <span className="block rounded-full bg-zinc-200" style={{ width: 20, height: h }} />
}

function NoColorIcon() {
  return (
    <div className="w-5 h-5 relative">
      <div className="absolute inset-0 rounded-full border-2 border-zinc-400" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="absolute w-[110%] h-0.5 bg-red-500 rotate-45 rounded" />
      </div>
    </div>
  )
}

export default function AnnotatorF({ imageUrl, imageName, initialState, onBack }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const a = useAnnotator({ imageUrl, imageName, initialState, canvasElRef, containerRef })

  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setViewportHeight(vv.height)
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])

  const [damageVisibility, setDamageVisibility] = useState(0)
  const [showDamage, setShowDamage] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const originalImgRef = useRef<HTMLImageElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyingRef = useRef(false)

  const isTextMode = a.colorMode === 'text'
  const isStrokeMode = a.colorMode === 'stroke'
  const isFillMode = a.colorMode === 'fill'
  const isLine = a.selectedSubType === 'line'
  const activeSelectedColor = isTextMode ? a.activeTextColor : isStrokeMode ? a.activeColor : a.fillColor
  const nullSelected = isStrokeMode ? !a.isStroked : (isFillMode && !a.isFilled)

  useEffect(() => {
    if (!imageUrl || imageUrl === '__saved__') return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { originalImgRef.current = img }
    img.src = imageUrl
  }, [imageUrl])

  const applyEnhancement = useCallback((strength: number) => {
    const canvas = a.fabricRef.current
    const origImg = originalImgRef.current
    if (!canvas || !origImg || applyingRef.current) return
    applyingRef.current = true
    const bg = canvas.backgroundImage as fabric.FabricImage | undefined
    const scaleX = bg?.scaleX ?? 1, scaleY = bg?.scaleY ?? 1
    const left = bg?.left ?? canvas.width! / 2, top = bg?.top ?? canvas.height! / 2
    const loader = (fabric as any).FabricImage?.fromURL ?? (fabric as any).Image?.fromURL
    if (!loader) { applyingRef.current = false; return }
    if (strength === 0) {
      loader.call((fabric as any).FabricImage ?? (fabric as any).Image, imageUrl, { crossOrigin: 'anonymous' })
        .then((img: any) => { img.set({ scaleX, scaleY, originX: 'center', originY: 'center', left, top }); canvas.backgroundImage = img; canvas.renderAll(); applyingRef.current = false })
        .catch(() => { applyingRef.current = false }); return
    }
    try {
      const enhanced = applyDamageVisibility(origImg, strength / 100)
      const dataUrl = enhanced.toDataURL('image/jpeg', 0.92)
      loader.call((fabric as any).FabricImage ?? (fabric as any).Image, dataUrl, { crossOrigin: 'anonymous' })
        .then((img: any) => { img.set({ scaleX, scaleY, originX: 'center', originY: 'center', left, top }); canvas.backgroundImage = img; canvas.renderAll(); applyingRef.current = false })
        .catch(() => { applyingRef.current = false })
    } catch { applyingRef.current = false }
  }, [a.fabricRef, imageUrl])

  const handleDamageSlider = useCallback((value: number) => {
    setDamageVisibility(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => applyEnhancement(value), 120)
  }, [applyEnhancement])

  const handleResetConfirmed = useCallback(() => {
    const canvas = a.fabricRef.current; if (!canvas) return
    canvas.getObjects().forEach((o) => canvas.remove(o))
    canvas.discardActiveObject(); canvas.renderAll()
    canvas.fire('object:modified' as any)
    setShowResetConfirm(false); setShowMore(false)
  }, [a.fabricRef])

  const toggleColorMode = useCallback(() => {
    if (a.selectedType === 'text') {
      a.setColorModeAction(isTextMode ? 'fill' : 'text')
    } else {
      a.setColorModeAction(isStrokeMode ? 'fill' : 'stroke')
    }
  }, [a, isTextMode, isStrokeMode])

  const wrapperStyle: React.CSSProperties = viewportHeight ? { height: `${viewportHeight}px` } : { height: '100dvh' }

  return (
    <div className="flex flex-col bg-zinc-950 overflow-hidden relative" style={wrapperStyle}>

      {/* Back button — top left overlay on canvas */}
      <button onClick={onBack}
        className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/50 backdrop-blur-sm text-white text-sm font-medium active:bg-black/70">
        <ArrowLeft size={16} />
        <span>Back</span>
      </button>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 overflow-hidden min-h-0">
        <canvas ref={canvasElRef} />
      </div>

      {/* Bottom toolbar */}
      <div className="bg-zinc-900 border-t border-zinc-800 flex-shrink-0 select-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>

        {/* Row 1: Tools — no key labels */}
        <div className="flex items-center justify-around px-2 border-b border-zinc-800/60" style={{ height: 56 }}>
          {TOOLS.map(({ tool, Icon }) => (
            <button key={tool} onClick={() => a.changeTool(tool)}
              className={`flex items-center justify-center w-12 h-12 rounded-xl transition-colors ${a.activeTool === tool ? 'bg-blue-600 text-white' : 'text-zinc-400 active:bg-zinc-800'}`}>
              <Icon size={22} />
            </button>
          ))}
        </div>

        {/* Row 2: Mode toggle + color swatches + null */}
        <div className="flex items-center gap-1 px-2 border-b border-zinc-800/60" style={{ height: 52 }}>
          {/* Stroke/Fill toggle — hidden for lines (always stroke) */}
          {!isLine && (
            <button onClick={toggleColorMode}
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${isFillMode ? 'bg-zinc-600 text-white' : 'text-zinc-500 active:bg-zinc-800'}`}>
              {isFillMode ? <PaintBucket size={18} /> : <Pen size={18} />}
            </button>
          )}
          <div className="flex flex-1 items-center justify-around">
            {COLORS.map(({ value, label }) => (
              <button key={value} onClick={() => a.changeColor(value)} title={label}
                className={`w-8 h-8 rounded-full border-2 transition-all ${!nullSelected && activeSelectedColor === value ? 'border-blue-400 scale-110' : 'border-zinc-600 active:scale-105'}`}
                style={{ backgroundColor: value }} />
            ))}
            {!isTextMode && (
              <button
                onClick={isStrokeMode ? a.clearStroke : a.clearFill}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${nullSelected ? 'border-blue-400 scale-110' : 'border-zinc-600 active:scale-105'}`}
                style={{ backgroundColor: '#27272a' }}>
                <NoColorIcon />
              </button>
            )}
          </div>
        </div>

        {/* Context row: Stroke width (shapes/lines) */}
        {a.selectedType === 'shape' && (
          <div className="flex items-center gap-2 px-3 border-b border-zinc-800/60" style={{ height: 48 }}>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wide shrink-0 w-12">Width</span>
            <div className="flex flex-1 gap-1">
              {STROKE_WIDTHS.map((w, i) => (
                <button key={w} onClick={() => a.changeStrokeWidth(w)} title={STROKE_LABELS[i]}
                  className={`flex-1 h-9 rounded-lg flex items-center justify-center ${a.strokeWidth === w ? 'bg-blue-600' : 'active:bg-zinc-800'}`}>
                  <StrokeBarIcon width={w} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Context row: Font size (text) */}
        {a.selectedType === 'text' && (
          <div className="flex items-center gap-2 px-3 border-b border-zinc-800/60" style={{ height: 48 }}>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wide shrink-0 w-12">Size</span>
            <div className="flex flex-1 items-center gap-2">
              <button onClick={() => a.changeFontSize(-4)} className="flex-1 h-9 rounded-lg flex items-center justify-center text-zinc-300 active:bg-zinc-800">
                <AArrowDown size={18} />
              </button>
              <span className="text-zinc-400 text-sm w-8 text-center">{a.fontSize}</span>
              <button onClick={() => a.changeFontSize(4)} className="flex-1 h-9 rounded-lg flex items-center justify-center text-zinc-300 active:bg-zinc-800">
                <AArrowUp size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Damage slider — shown when toggled from actions row */}
        {showDamage && (
          <div className="flex items-center gap-3 px-4 border-b border-zinc-800/60" style={{ height: 44 }}>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wide shrink-0 w-12">Damage</span>
            <input type="range" min={0} max={100} value={damageVisibility}
              onChange={(e) => handleDamageSlider(parseInt(e.target.value))}
              className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-orange-500 bg-zinc-700" />
            <span className="text-[10px] text-zinc-400 w-8 text-right shrink-0">
              {damageVisibility === 0 ? 'Off' : `${damageVisibility}%`}
            </span>
          </div>
        )}

        {/* Row 3: Actions */}
        <div className="flex items-center justify-between px-2" style={{ height: 56 }}>
          <div className="flex gap-1">
            <button onClick={a.undo} disabled={!a.canUndo} className="w-12 h-12 rounded-xl flex items-center justify-center text-zinc-400 active:bg-zinc-800 disabled:opacity-25"><Undo2 size={20} /></button>
            <button onClick={a.redo} disabled={!a.canRedo} className="w-12 h-12 rounded-xl flex items-center justify-center text-zinc-400 active:bg-zinc-800 disabled:opacity-25"><Redo2 size={20} /></button>
            <button onClick={a.deleteSelected} disabled={!a.hasSelection} className="w-12 h-12 rounded-xl flex items-center justify-center text-zinc-400 active:bg-zinc-800 disabled:opacity-25"><Trash2 size={20} /></button>
          </div>
          <div className="flex gap-1 items-center">
            <button onClick={() => { setShowDamage(s => !s); setShowMore(false) }}
              className={`h-12 px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium transition-colors ${showDamage ? 'bg-orange-600/20 text-orange-400' : 'text-zinc-400 active:bg-zinc-800'}`}>
              <Eye size={16} />
              <span>Damage</span>
            </button>
            <button onClick={() => { setShowMore(s => !s); setShowDamage(false) }}
              className={`w-12 h-12 rounded-xl flex items-center justify-center text-xs font-medium transition-colors ${showMore ? 'bg-zinc-700 text-white' : 'text-zinc-400 active:bg-zinc-800'}`}>
              <MoreHorizontal size={20} />
            </button>
            <button onClick={a.downloadImage} className="h-12 px-4 rounded-xl flex items-center gap-1.5 bg-blue-600 active:bg-blue-500 text-white text-xs font-medium">
              <Download size={14} /><span>Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* More menu overlay */}
      {showMore && (
        <div className="fixed inset-0 z-40" onClick={() => setShowMore(false)}>
          <div className="absolute bottom-[72px] right-3 bg-zinc-800 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden w-44"
            onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { a.createLegend(); setShowMore(false) }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-zinc-200 active:bg-zinc-700 border-b border-zinc-700">
              <List size={16} className="text-zinc-400" />
              Legend
            </button>
            <button onClick={() => { setShowResetConfirm(true); setShowMore(false) }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-red-400 active:bg-zinc-700">
              <RotateCcw size={16} />
              Reset canvas
            </button>
          </div>
        </div>
      )}

      {/* Reset confirm dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white font-semibold text-base mb-2">Delete all markings?</h2>
            <p className="text-zinc-400 text-sm mb-6 leading-relaxed">This will remove all annotations. You can undo with the undo button.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-3 rounded-xl bg-zinc-700 active:bg-zinc-600 text-white text-sm font-medium">Cancel</button>
              <button onClick={handleResetConfirmed} className="flex-1 py-3 rounded-xl bg-red-600 active:bg-red-500 text-white text-sm font-medium">Delete All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
