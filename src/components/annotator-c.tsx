'use client'

import { useRef } from 'react'
import { MousePointer2, ArrowUpRight, Minus, Circle, Square, Type, Undo2, Redo2, Trash2, Download, Save, ArrowLeft, List } from 'lucide-react'
import { useAnnotator, COLORS, STROKE_WIDTHS, hexToRgba, type Tool } from '@/hooks/use-annotator'

interface Props { imageUrl: string; imageName: string; initialState?: string | null; onBack: () => void }

const TOOLS: { tool: Tool; Icon: typeof MousePointer2; key: string }[] = [
  { tool: 'select', Icon: MousePointer2, key: 'V' },
  { tool: 'arrow', Icon: ArrowUpRight, key: 'A' },
  { tool: 'line', Icon: Minus, key: 'L' },
  { tool: 'circle', Icon: Circle, key: 'C' },
  { tool: 'rectangle', Icon: Square, key: 'R' },
  { tool: 'text', Icon: Type, key: 'T' },
]

export default function AnnotatorC({ imageUrl, imageName, initialState, onBack }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const a = useAnnotator({ imageUrl, imageName, initialState, canvasElRef, containerRef })

  const pill = "bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/50 rounded-2xl shadow-2xl px-2.5 py-2 flex items-center gap-1.5"

  return (
    <div className="h-screen relative bg-zinc-950">
      <div ref={containerRef} className="absolute inset-0"><canvas ref={canvasElRef} /></div>

      {/* Floating top-left: back */}
      <div className="absolute top-3 left-3 z-10">
        <button onClick={onBack} className={`${pill} !px-4 text-zinc-400 hover:text-white`}><ArrowLeft size={20} /></button>
      </div>

      {/* Floating top-right: actions */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <div className={pill}>
          <button onClick={a.undo} disabled={!a.canUndo} className="p-2.5 rounded-xl text-zinc-400 hover:text-white disabled:opacity-25"><Undo2 size={20} /></button>
          <button onClick={a.redo} disabled={!a.canRedo} className="p-2.5 rounded-xl text-zinc-400 hover:text-white disabled:opacity-25"><Redo2 size={20} /></button>
          <button onClick={a.deleteSelected} disabled={!a.hasSelection} className="p-2.5 rounded-xl text-zinc-400 hover:text-white disabled:opacity-25"><Trash2 size={20} /></button>
          <button onClick={a.createLegend} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-zinc-400 hover:text-white"><List size={20} /> <span className="text-sm font-medium">Legend</span></button>
        </div>
        <button onClick={a.saveEditable} className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/50 rounded-2xl shadow-2xl px-4 py-3 text-white text-sm font-medium hover:bg-zinc-800/90 flex items-center gap-2"><Save size={18} /> Save</button>
        <button onClick={a.downloadImage} className="bg-blue-600/90 backdrop-blur-sm border border-blue-500/50 rounded-2xl shadow-2xl px-4 py-3 text-white text-sm font-medium hover:bg-blue-500/90 flex items-center gap-2"><Download size={18} /> Export</button>
      </div>

      {/* Floating right: colors + fill + stroke */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-2">
        <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/50 rounded-2xl shadow-2xl p-2.5 flex flex-col items-center gap-2.5">
          {COLORS.map(({ value, label }) => (
            <button key={value} onClick={() => a.changeColor(value)} title={label}
              className={`w-10 h-10 rounded-full border-2 transition-all ${a.activeColor === value ? 'border-blue-500 scale-110' : 'border-zinc-600 hover:border-zinc-400'}`}
              style={{ backgroundColor: value }} />
          ))}
          <div className="h-px w-7 bg-zinc-700" />
          <button onClick={a.toggleColorMode}
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.isFilled ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}>
            <div className="w-5 h-5 rounded-sm border-2" style={{ borderColor: a.activeColor, backgroundColor: a.isFilled ? hexToRgba(a.activeColor, 0.35) : 'transparent' }} />
          </button>
          <div className="h-px w-7 bg-zinc-700" />
          {STROKE_WIDTHS.map((w) => (
            <button key={w} onClick={() => a.changeStrokeWidth(w)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.strokeWidth === w ? 'bg-blue-600' : 'hover:bg-zinc-800'}`}>
              <span className="rounded-full bg-zinc-200 block" style={{ width: w + 1, height: w + 1 }} />
            </button>
          ))}
        </div>
      </div>

      {/* Floating bottom center: tools */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10">
        <div className={`${pill} gap-1`}>
          {TOOLS.map(({ tool, Icon, key }) => (
            <button key={tool} onClick={() => a.changeTool(tool)} title={key}
              className={`p-3.5 rounded-xl transition-colors ${a.activeTool === tool ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
              <Icon size={24} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
