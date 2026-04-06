'use client'

import { useRef } from 'react'
import { MousePointer2, ArrowUpRight, Minus, Circle, Square, Type, Undo2, Redo2, Trash2, Download, Save, ArrowLeft, List, AArrowUp, AArrowDown } from 'lucide-react'
import { useAnnotator, COLORS, STROKE_WIDTHS, STROKE_LABELS, type Tool } from '@/hooks/use-annotator'

interface Props { imageUrl: string; imageName: string; initialState?: string | null; onBack: () => void }

// Tool grid: circle TL, rect TR, arrow ML, line MR, text BL, select BR
const TOOL_GRID: { tool: Tool; Icon: typeof MousePointer2; label: string }[][] = [
  [
    { tool: 'circle', Icon: Circle, label: 'Circle' },
    { tool: 'rectangle', Icon: Square, label: 'Rect' },
  ],
  [
    { tool: 'arrow', Icon: ArrowUpRight, label: 'Arrow' },
    { tool: 'line', Icon: Minus, label: 'Line' },
  ],
  [
    { tool: 'text', Icon: Type, label: 'Text' },
    { tool: 'select', Icon: MousePointer2, label: 'Select' },
  ],
]

function StrokeBarIcon({ width }: { width: number }) {
  const h = width <= 3 ? 2 : width <= 6 ? 4 : 7
  return <span className="block rounded-full bg-zinc-200" style={{ width: 22, height: h }} />
}

function NoFillIcon() {
  return (
    <div className="w-5 h-5 relative">
      <div className="absolute inset-0 rounded-full border-2 border-zinc-400" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="absolute w-[110%] h-0.5 bg-red-500 rotate-45 rounded" />
      </div>
    </div>
  )
}

export default function AnnotatorB({ imageUrl, imageName, initialState, onBack }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const a = useAnnotator({ imageUrl, imageName, initialState, canvasElRef, containerRef })

  const activeOpacity = a.colorMode === 'stroke' ? a.strokeOpacity : a.fillOpacity
  const activeSelectedColor = a.colorMode === 'stroke' ? a.activeColor : a.fillColor

  const sectionLabel = (text: string) => (
    <div className="px-3 pt-5 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{text}</div>
  )

  return (
    <div className="h-screen flex bg-zinc-950">
      {/* Left sidebar */}
      <div className="w-48 flex flex-col bg-zinc-900 border-r border-zinc-800 select-none overflow-y-auto">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-4 text-zinc-400 hover:text-white hover:bg-zinc-800 text-sm font-medium border-b border-zinc-800">
          <ArrowLeft size={18} /> Back
        </button>

        {/* Tool grid */}
        {sectionLabel('Tools')}
        <div className="px-3 flex flex-col gap-1">
          {TOOL_GRID.map((row, ri) => (
            <div key={ri} className="grid grid-cols-2 gap-1">
              {row.map(({ tool, Icon, label }) => (
                <button key={tool} onClick={() => a.changeTool(tool)} title={label}
                  className={`flex items-center justify-center py-2.5 rounded-xl text-sm font-medium transition-colors ${a.activeTool === tool ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
                  <Icon size={20} />
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Color — stroke/fill toggle + swatches + opacity */}
        {sectionLabel('Color')}
        <div className="px-3">
          <div className="flex rounded-lg overflow-hidden border border-zinc-700 mb-3">
            <button onClick={() => a.colorMode !== 'stroke' && a.toggleColorMode()}
              className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${a.colorMode === 'stroke' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
              Stroke
            </button>
            <button onClick={() => a.colorMode !== 'fill' && a.toggleColorMode()}
              className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${a.colorMode === 'fill' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
              Fill
            </button>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {a.colorMode === 'fill' && (
              <button onClick={a.clearFill} title="No fill"
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${!a.isFilled ? 'border-blue-500 scale-110' : 'border-zinc-600 hover:border-zinc-400'}`}
                style={{ backgroundColor: '#27272a' }}>
                <NoFillIcon />
              </button>
            )}
            {COLORS.map(({ value, label }) => (
              <button key={value} onClick={() => a.changeColor(value)} title={label}
                className={`w-8 h-8 rounded-full border-2 transition-all ${activeSelectedColor === value && (a.colorMode === 'stroke' || a.isFilled) ? 'border-blue-500 scale-110' : 'border-zinc-600 hover:border-zinc-400'}`}
                style={{ backgroundColor: value }} />
            ))}
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Opacity</span>
              <span className="text-[11px] text-zinc-400">{Math.round(activeOpacity * 100)}%</span>
            </div>
            <input type="range" min={10} max={100} value={Math.round(activeOpacity * 100)}
              onChange={(e) => a.changeOpacity(parseInt(e.target.value) / 100)}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-blue-500 bg-zinc-700" />
          </div>
        </div>

        {/* Border — only when a shape is selected */}
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

        {/* Font size — only when text is selected */}
        {a.selectedType === 'text' && (
          <>
            {sectionLabel('Font Size')}
            <div className="px-3 flex items-center gap-2">
              <button onClick={() => a.changeFontSize(-4)} title="Decrease font size"
                className="flex-1 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white">
                <AArrowDown size={20} />
              </button>
              <button onClick={() => a.changeFontSize(4)} title="Increase font size"
                className="flex-1 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white">
                <AArrowUp size={20} />
              </button>
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Actions */}
        <div className="px-2 pb-3 flex flex-col gap-1.5">
          <div className="flex gap-1">
            <button onClick={a.undo} disabled={!a.canUndo} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Undo2 size={20} className="mx-auto" /></button>
            <button onClick={a.redo} disabled={!a.canRedo} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Redo2 size={20} className="mx-auto" /></button>
            <button onClick={a.deleteSelected} disabled={!a.hasSelection} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Trash2 size={20} className="mx-auto" /></button>
          </div>
          <button onClick={a.createLegend} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-white text-sm font-medium">
            <List size={20} /> Legend
          </button>
          <button onClick={a.saveEditable} className="w-full flex items-center justify-center gap-2 py-3 bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl text-sm font-medium"><Save size={18} /> Save</button>
          <button onClick={a.downloadImage} className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium"><Download size={18} /> Download</button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden"><canvas ref={canvasElRef} /></div>
    </div>
  )
}
