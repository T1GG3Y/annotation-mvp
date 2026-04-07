'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import * as fabric from 'fabric'
import { MousePointer2, ArrowUpRight, Minus, Circle, Square, Type, Undo2, Redo2, Trash2, Download, Save, ArrowLeft, List, AArrowUp, AArrowDown, RotateCcw } from 'lucide-react'
import { useAnnotator, COLORS, STROKE_WIDTHS, STROKE_LABELS, type Tool } from '@/hooks/use-annotator'
import { applyDamageVisibility } from '@/lib/image-enhance'

interface Props { imageUrl: string; imageName: string; initialState?: string | null; onBack: () => void }

const TOOLS: { tool: Tool; Icon: typeof MousePointer2; label: string; key: string }[] = [
  { tool: 'circle', Icon: Circle, label: 'Circle', key: 'C' },
  { tool: 'rectangle', Icon: Square, label: 'Rect', key: 'R' },
  { tool: 'arrow', Icon: ArrowUpRight, label: 'Arrow', key: 'A' },
  { tool: 'line', Icon: Minus, label: 'Line', key: 'L' },
  { tool: 'text', Icon: Type, label: 'Text', key: 'T' },
  { tool: 'select', Icon: MousePointer2, label: 'Select', key: 'V' },
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

  // Track visual viewport height so the canvas rises above the keyboard
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

  // Damage Visibility
  const [damageVisibility, setDamageVisibility] = useState(0)
  const originalImgRef = useRef<HTMLImageElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyingRef = useRef(false)

  // Reset Photo
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const isTextMode = a.colorMode === 'text'
  const isStrokeMode = a.colorMode === 'stroke'
  const isFillMode = a.colorMode === 'fill'
  const activeOpacity = isStrokeMode ? a.strokeOpacity : a.fillOpacity
  const activeSelectedColor = isTextMode ? a.activeTextColor : isStrokeMode ? a.activeColor : a.fillColor

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
    const scaleX = bg?.scaleX ?? 1
    const scaleY = bg?.scaleY ?? 1
    const left = bg?.left ?? canvas.width! / 2
    const top = bg?.top ?? canvas.height! / 2

    const loader = (fabric as any).FabricImage?.fromURL ?? (fabric as any).Image?.fromURL
    if (!loader) { applyingRef.current = false; return }

    if (strength === 0) {
      loader.call((fabric as any).FabricImage ?? (fabric as any).Image, imageUrl, { crossOrigin: 'anonymous' })
        .then((img: any) => {
          img.set({ scaleX, scaleY, originX: 'center', originY: 'center', left, top })
          canvas.backgroundImage = img; canvas.renderAll(); applyingRef.current = false
        }).catch(() => { applyingRef.current = false })
      return
    }

    try {
      const enhanced = applyDamageVisibility(origImg, strength / 100)
      const dataUrl = enhanced.toDataURL('image/jpeg', 0.92)
      loader.call((fabric as any).FabricImage ?? (fabric as any).Image, dataUrl, { crossOrigin: 'anonymous' })
        .then((img: any) => {
          img.set({ scaleX, scaleY, originX: 'center', originY: 'center', left, top })
          canvas.backgroundImage = img; canvas.renderAll(); applyingRef.current = false
        }).catch(() => { applyingRef.current = false })
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
    setShowResetConfirm(false)
  }, [a.fabricRef])

  const wrapperStyle: React.CSSProperties = viewportHeight
    ? { height: `${viewportHeight}px` }
    : { height: '100dvh' }

  return (
    <div className="flex flex-col bg-zinc-950 overflow-hidden" style={wrapperStyle}>
      {/* Canvas — fills all available space above the toolbar */}
      <div ref={containerRef} className="flex-1 overflow-hidden min-h-0">
        <canvas ref={canvasElRef} />
      </div>

      {/* Bottom toolbar */}
      <div className="bg-zinc-900 border-t border-zinc-800 flex-shrink-0 select-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>

        {/* Row 1: Back button + tool buttons with label + shortcut */}
        <div className="flex items-center px-1 border-b border-zinc-800/60" style={{ height: 52 }}>
          <button onClick={onBack}
            className="flex items-center gap-1 px-3 h-11 rounded-xl text-zinc-400 active:bg-zinc-800 text-sm font-medium shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div className="flex flex-1 justify-around">
            {TOOLS.map(({ tool, Icon, label, key }) => (
              <button key={tool} onClick={() => a.changeTool(tool)} title={`${label} (${key})`}
                className={`flex flex-col items-center justify-center w-11 h-11 rounded-xl transition-colors ${a.activeTool === tool ? 'bg-blue-600 text-white' : 'text-zinc-400 active:bg-zinc-800'}`}>
                <Icon size={18} />
                <span className={`text-[8px] leading-none mt-0.5 font-mono ${a.activeTool === tool ? 'text-blue-200' : 'text-zinc-600'}`}>{key}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Stroke/Fill/Text tab + 8 color swatches */}
        <div className="flex items-center gap-2 px-3 border-b border-zinc-800/60" style={{ height: 52 }}>
          <div className="flex rounded-lg overflow-hidden border border-zinc-700 shrink-0">
            {a.selectedType === 'text' ? (
              <>
                <button onClick={() => a.setColorModeAction('text')}
                  className={`px-2 h-9 text-xs font-semibold transition-colors ${isTextMode ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}>
                  Txt
                </button>
                <button onClick={() => a.setColorModeAction('fill')}
                  className={`px-2 h-9 text-xs font-semibold transition-colors ${isFillMode ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}>
                  Fill
                </button>
              </>
            ) : (
              <>
                <button onClick={() => a.setColorModeAction('stroke')}
                  className={`px-2 h-9 text-xs font-semibold transition-colors ${isStrokeMode ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}>
                  Str
                </button>
                <button onClick={() => a.setColorModeAction('fill')}
                  className={`px-2 h-9 text-xs font-semibold transition-colors ${isFillMode ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}>
                  Fill
                </button>
              </>
            )}
          </div>
          <div className="flex flex-1 justify-around items-center">
            {COLORS.map(({ value, label }) => (
              <button key={value} onClick={() => a.changeColor(value)} title={label}
                className={`w-8 h-8 rounded-full border-2 transition-all ${activeSelectedColor === value ? 'border-blue-400 scale-110' : 'border-zinc-600 active:scale-105'}`}
                style={{ backgroundColor: value }} />
            ))}
            {!isTextMode && (
              <button
                onClick={isStrokeMode ? a.clearStroke : a.clearFill}
                title={isStrokeMode ? 'No stroke' : 'No fill'}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${isFillMode && !a.isFilled ? 'border-blue-400 scale-110' : 'border-zinc-600 active:scale-105'}`}
                style={{ backgroundColor: '#27272a' }}>
                <NoColorIcon />
              </button>
            )}
          </div>
        </div>

        {/* Row 3: Opacity + border size + font size */}
        <div className="flex items-center gap-3 px-3 border-b border-zinc-800/60" style={{ height: 48 }}>
          {!isTextMode && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wide shrink-0">Opacity</span>
              <input type="range" min={10} max={100} value={Math.round(activeOpacity * 100)}
                onChange={(e) => a.changeOpacity(parseInt(e.target.value) / 100)}
                className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-blue-500 bg-zinc-700 min-w-0" />
              <span className="text-[10px] text-zinc-400 w-7 text-right shrink-0">{Math.round(activeOpacity * 100)}%</span>
            </div>
          )}
          {a.selectedType === 'shape' && (
            <div className="flex gap-1 shrink-0">
              {STROKE_WIDTHS.map((w, i) => (
                <button key={w} onClick={() => a.changeStrokeWidth(w)} title={STROKE_LABELS[i]}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${a.strokeWidth === w ? 'bg-blue-600' : 'active:bg-zinc-800'}`}>
                  <StrokeBarIcon width={w} />
                </button>
              ))}
            </div>
          )}
          {a.selectedType === 'text' && (
            <div className="flex gap-1 shrink-0">
              <button onClick={() => a.changeFontSize(-4)} title="Decrease font size"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 active:bg-zinc-800">
                <AArrowDown size={18} />
              </button>
              <button onClick={() => a.changeFontSize(4)} title="Increase font size"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 active:bg-zinc-800">
                <AArrowUp size={18} />
              </button>
            </div>
          )}
          {/* Legend shape picker on mobile */}
          {a.legendPickerColor && (
            <div className="flex items-center gap-1 shrink-0">
              <div className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: a.legendPickerColor }} />
              <button onClick={() => a.placeLegendShape('circle', a.legendPickerColor!)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 active:bg-zinc-800">
                <Circle size={18} />
              </button>
              <button onClick={() => a.placeLegendShape('rectangle', a.legendPickerColor!)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 active:bg-zinc-800">
                <Square size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Row 4: Damage Visibility slider */}
        <div className="flex items-center gap-2 px-3 border-b border-zinc-800/60" style={{ height: 44 }}>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wide shrink-0">Damage</span>
          <input type="range" min={0} max={100} value={damageVisibility}
            onChange={(e) => handleDamageSlider(parseInt(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-orange-500 bg-zinc-700" />
          <span className="text-[10px] text-zinc-400 w-7 text-right shrink-0">
            {damageVisibility === 0 ? 'Off' : `${damageVisibility}%`}
          </span>
        </div>

        {/* Row 5: Actions */}
        <div className="flex items-center justify-between px-2" style={{ height: 52 }}>
          <div className="flex gap-0.5">
            <button onClick={a.undo} disabled={!a.canUndo}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-zinc-400 active:bg-zinc-800 disabled:opacity-25">
              <Undo2 size={20} />
            </button>
            <button onClick={a.redo} disabled={!a.canRedo}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-zinc-400 active:bg-zinc-800 disabled:opacity-25">
              <Redo2 size={20} />
            </button>
            <button onClick={a.deleteSelected} disabled={!a.hasSelection}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-zinc-400 active:bg-zinc-800 disabled:opacity-25">
              <Trash2 size={20} />
            </button>
          </div>
          <div className="flex gap-0.5">
            <button onClick={a.createLegend}
              className="h-11 px-2.5 rounded-xl flex items-center gap-1.5 text-zinc-400 active:bg-zinc-800 text-xs font-medium">
              <List size={16} /><span>Legend</span>
            </button>
            <button onClick={() => setShowResetConfirm(true)}
              className="h-11 px-2.5 rounded-xl flex items-center gap-1.5 text-zinc-400 active:bg-zinc-800 text-xs font-medium">
              <RotateCcw size={16} /><span>Reset</span>
            </button>
          </div>
          <div className="flex gap-1">
            <button onClick={a.saveEditable}
              className="h-11 px-3 rounded-xl flex items-center gap-1.5 bg-zinc-700 active:bg-zinc-600 text-white text-xs font-medium">
              <Save size={14} /><span>Save</span>
            </button>
            <button onClick={a.downloadImage}
              className="h-11 px-3 rounded-xl flex items-center gap-1.5 bg-blue-600 active:bg-blue-500 text-white text-xs font-medium">
              <Download size={14} /><span>Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white font-semibold text-base mb-2">Delete all markings?</h2>
            <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
              Are you sure you want to delete all markings? You can undo this with the undo button.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3 rounded-xl bg-zinc-700 active:bg-zinc-600 text-white text-sm font-medium">
                Cancel
              </button>
              <button onClick={handleResetConfirmed}
                className="flex-1 py-3 rounded-xl bg-red-600 active:bg-red-500 text-white text-sm font-medium">
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
