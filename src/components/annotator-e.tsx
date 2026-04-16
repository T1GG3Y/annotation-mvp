'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import * as fabric from 'fabric'
import { MousePointer2, ArrowUpRight, Minus, Circle, Square, Type, Undo2, Redo2, Trash2, Download, Save, ArrowLeft, List, AArrowUp, AArrowDown, RotateCcw, Search, Crop } from 'lucide-react'
import { useAnnotator, COLORS, STROKE_WIDTHS, STROKE_LABELS, type Tool } from '@/hooks/use-annotator'
import { CropOverlay } from '@/components/crop-overlay'
import { applyDamageVisibility } from '@/lib/image-enhance'

interface Props { imageUrl: string; imageName: string; initialState?: string | null; onBack: () => void; hiddenTools?: Tool[] }

const ALL_TOOL_GRID: { tool: Tool; Icon: typeof MousePointer2; label: string; key: string }[][] = [
  [
    { tool: 'circle', Icon: Circle, label: 'Circle', key: 'C' },
    { tool: 'rectangle', Icon: Square, label: 'Rect', key: 'R' },
  ],
  [
    { tool: 'arrow', Icon: ArrowUpRight, label: 'Arrow', key: 'A' },
    { tool: 'line', Icon: Minus, label: 'Line', key: 'L' },
  ],
  [
    { tool: 'text', Icon: Type, label: 'Text', key: 'T' },
    { tool: 'callout', Icon: Search, label: 'Callout', key: 'O' },
  ],
  [
    { tool: 'crop', Icon: Crop, label: 'Crop', key: 'P' },
    { tool: 'select', Icon: MousePointer2, label: 'Select', key: 'V' },
  ],
]

function StrokeBarIcon({ width }: { width: number }) {
  const h = width <= 3 ? 2 : width <= 6 ? 4 : 7
  return <span className="block rounded-full bg-zinc-200" style={{ width: 22, height: h }} />
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

export default function AnnotatorE({ imageUrl, imageName, initialState, onBack, hiddenTools }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const a = useAnnotator({ imageUrl, imageName, initialState, canvasElRef, containerRef })

  const TOOL_GRID = ALL_TOOL_GRID
    .map(row => row.filter(t => !(hiddenTools ?? []).includes(t.tool)))
    .filter(row => row.length > 0)

  const [damageVisibility, setDamageVisibility] = useState(0)
  const originalImgRef = useRef<HTMLImageElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyingRef = useRef(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const isTextMode = a.colorMode === 'text'
  const isStrokeMode = a.colorMode === 'stroke'
  const isFillMode = a.colorMode === 'fill'
  const isLine = a.selectedSubType === 'line'
  const activeOpacity = isStrokeMode ? a.strokeOpacity : a.fillOpacity
  const activeSelectedColor = isTextMode ? a.activeTextColor : isStrokeMode ? a.activeColor : a.fillColor
  // Null is "selected" when: in stroke mode and no stroke, OR in fill mode and no fill
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
    a.resetPhoto()
    setShowResetConfirm(false)
  }, [a.resetPhoto])

  const sectionLabel = (text: string) => (
    <div className="px-3 pt-5 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{text}</div>
  )

  return (
    <div className="h-screen flex bg-zinc-950">
      <div className="w-52 flex flex-col bg-zinc-900 border-r border-zinc-800 select-none overflow-y-auto">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-4 text-zinc-400 hover:text-white hover:bg-zinc-800 text-sm font-medium border-b border-zinc-800">
          <ArrowLeft size={18} /> Back
        </button>

        {sectionLabel('Tools')}
        <div className="px-3 flex flex-col gap-1">
          {TOOL_GRID.map((row, ri) => (
            <div key={ri} className="grid grid-cols-2 gap-1">
              {row.map(({ tool, Icon, key }) => (
                <button key={tool} onClick={() => a.changeTool(tool)}
                  className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-sm font-medium transition-colors ${a.activeTool === tool ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
                  <Icon size={16} />
                  {key && <span className={`text-[10px] font-mono ${a.activeTool === tool ? 'text-blue-200' : 'text-zinc-600'}`}>{key}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Legend font size — only when legend is selected */}
        {a.isLegendSelected && (
          <>
            {sectionLabel('Font Size')}
            <div className="px-3 flex items-center gap-2">
              <button onClick={() => a.changeFontSize(-1)} className="flex-1 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white">
                <AArrowDown size={20} />
              </button>
              <button onClick={() => a.changeFontSize(1)} className="flex-1 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white">
                <AArrowUp size={20} />
              </button>
            </div>
          </>
        )}

        {!a.isLegendSelected && (
          <>
            {sectionLabel('Color')}
            <div className="px-3">
              {/* Tab row */}
              <div className="flex rounded-lg overflow-hidden border border-zinc-700 mb-3">
                {isTextMode || a.selectedType === 'text' ? (
                  <>
                    <button onClick={() => a.setColorModeAction('text')}
                      className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${isTextMode ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
                      Text
                    </button>
                    <button onClick={() => a.setColorModeAction('fill')}
                      className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${isFillMode ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
                      Fill
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => a.setColorModeAction('stroke')}
                      className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${isStrokeMode ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
                      Stroke
                    </button>
                    {/* Hide fill tab for lines/arrows */}
                    {!isLine && (
                      <button onClick={() => a.setColorModeAction('fill')}
                        className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${isFillMode ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
                        Fill
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* 2×4 color grid: 7 colors + null */}
              <div className="grid grid-cols-4 gap-1.5">
                {COLORS.map(({ value, label }) => (
                  <button key={value} onClick={() => a.changeColor(value)} title={label}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${!nullSelected && activeSelectedColor === value ? 'border-blue-500 scale-110' : 'border-zinc-600 hover:border-zinc-400'}`}
                    style={{ backgroundColor: value }} />
                ))}
                {/* Null cell — no color; hide for text color mode */}
                {!isTextMode && (
                  <button
                    onClick={isStrokeMode ? a.clearStroke : a.clearFill}
                    title={isStrokeMode ? 'No stroke' : 'No fill'}
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${nullSelected ? 'border-blue-500 scale-110' : 'border-zinc-600 hover:border-zinc-400'}`}
                    style={{ backgroundColor: '#27272a' }}>
                    <NoColorIcon />
                  </button>
                )}
              </div>

              {/* Opacity — only for stroke/fill */}
              {!isTextMode && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Opacity</span>
                    <span className="text-[11px] text-zinc-400">{Math.round(activeOpacity * 100)}%</span>
                  </div>
                  <input type="range" min={10} max={100} value={Math.round(activeOpacity * 100)}
                    onChange={(e) => a.changeOpacity(parseInt(e.target.value) / 100)}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-blue-500 bg-zinc-700" />
                </div>
              )}
            </div>

            {/* Border — shapes and lines */}
            {a.selectedType === 'shape' && (
              <>
                {sectionLabel('Border')}
                <div className="px-3 flex items-center gap-2">
                  {STROKE_WIDTHS.map((w, i) => (
                    <button key={w} onClick={() => a.changeStrokeWidth(w)} title={STROKE_LABELS[i]}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${a.strokeWidth === w ? 'bg-blue-600' : 'hover:bg-zinc-800'}`}>
                      <StrokeBarIcon width={w} />
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Font size — text only */}
            {a.selectedType === 'text' && (
              <>
                {sectionLabel('Font Size')}
                <div className="px-3 flex items-center gap-2">
                  <button onClick={() => a.changeFontSize(-4)} className="flex-1 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white">
                    <AArrowDown size={20} />
                  </button>
                  <button onClick={() => a.changeFontSize(4)} className="flex-1 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white">
                    <AArrowUp size={20} />
                  </button>
                </div>
              </>
            )}

            {/* Legend shape picker */}
            {a.legendPickerColor && (
              <>
                {sectionLabel('Place Shape')}
                <div className="px-3 flex items-center gap-2">
                  <div className="w-4 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: a.legendPickerColor }} />
                  <button onClick={() => a.placeLegendShape('circle', a.legendPickerColor!)}
                    className="flex-1 h-10 rounded-lg flex items-center justify-center gap-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white text-sm">
                    <Circle size={16} /> Circle
                  </button>
                  <button onClick={() => a.placeLegendShape('rectangle', a.legendPickerColor!)}
                    className="flex-1 h-10 rounded-lg flex items-center justify-center gap-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white text-sm">
                    <Square size={16} /> Rect
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {sectionLabel('Damage Visibility')}
        <div className="px-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Enhance</span>
            <span className="text-[11px] text-zinc-400">{damageVisibility === 0 ? 'Off' : `${damageVisibility}%`}</span>
          </div>
          <input type="range" min={0} max={100} value={damageVisibility}
            onChange={(e) => handleDamageSlider(parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-orange-500 bg-zinc-700" />
          <p className="mt-1.5 text-[10px] text-zinc-600 leading-tight">
            Boosts local contrast, sharpness &amp; shadow detail to reveal damage
          </p>
        </div>

        <div className="flex-1" />

        <div className="px-2 pb-3 flex flex-col gap-1.5">
          <div className="flex gap-1">
            <button onClick={a.undo} disabled={!a.canUndo} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Undo2 size={20} className="mx-auto" /></button>
            <button onClick={a.redo} disabled={!a.canRedo} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Redo2 size={20} className="mx-auto" /></button>
            <button onClick={a.deleteSelected} disabled={!a.hasSelection} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Trash2 size={20} className="mx-auto" /></button>
          </div>
          <button onClick={a.createLegend} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-white text-sm font-medium">
            <List size={20} /> Legend
          </button>
          <button onClick={() => setShowResetConfirm(true)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-red-400 text-sm font-medium">
            <RotateCcw size={18} /> Reset Photo
          </button>
          <button onClick={a.saveEditable} className="w-full flex items-center justify-center gap-2 py-3 bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl text-sm font-medium"><Save size={18} /> Save</button>
          <button onClick={a.downloadImage} className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium"><Download size={18} /> Download</button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden relative">
        <canvas ref={canvasElRef} />
        {a.cropMode && (
          <CropOverlay
            bounds={a.cropBounds}
            onBoundsChange={a.updateCropBounds}
            onConfirm={a.confirmCrop}
            onCancel={a.cancelCrop}
            hasCrop={a.hasCrop}
            onRevertCrop={a.revertCrop}
          />
        )}
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 shadow-2xl">
            <h2 className="text-white font-semibold text-base mb-2">Delete all markings?</h2>
            <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
              This will remove all markings and reset the photo to its original (uncropped) state.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium">Cancel</button>
              <button onClick={handleResetConfirmed} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium">Delete All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
