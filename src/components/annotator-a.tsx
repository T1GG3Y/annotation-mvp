'use client'

import { useRef } from 'react'
import { MousePointer2, ArrowUpRight, Minus, Circle, Square, Type, Undo2, Redo2, Trash2, Download, Save, ArrowLeft, List } from 'lucide-react'
import { useAnnotator, COLORS, STROKE_WIDTHS, STROKE_LABELS, hexToRgba, type Tool } from '@/hooks/use-annotator'

interface Props { imageUrl: string; imageName: string; initialState?: string | null; onBack: () => void }

const TOOLS: { tool: Tool; Icon: typeof MousePointer2; label: string; key: string }[] = [
  { tool: 'select', Icon: MousePointer2, label: 'Select', key: 'V' },
  { tool: 'arrow', Icon: ArrowUpRight, label: 'Arrow', key: 'A' },
  { tool: 'line', Icon: Minus, label: 'Line', key: 'L' },
  { tool: 'circle', Icon: Circle, label: 'Circle', key: 'C' },
  { tool: 'rectangle', Icon: Square, label: 'Rect', key: 'R' },
  { tool: 'text', Icon: Type, label: 'Text', key: 'T' },
]

export default function AnnotatorA({ imageUrl, imageName, initialState, onBack }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const a = useAnnotator({ imageUrl, imageName, initialState, canvasElRef, containerRef })

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Top toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-zinc-900 border-b border-zinc-800 select-none flex-wrap">
        <button onClick={onBack} title="Back" className="p-3 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors mr-1"><ArrowLeft size={22} /></button>
        <div className="h-8 w-px bg-zinc-700 mx-1" />

        {TOOLS.map(({ tool, Icon, label, key }) => (
          <button key={tool} onClick={() => a.changeTool(tool)} title={`${label} (${key})`}
            className={`p-3 rounded-lg transition-colors ${a.activeTool === tool ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
            <Icon size={22} />
          </button>
        ))}
        <div className="h-8 w-px bg-zinc-700 mx-2" />

        {COLORS.map(({ value, label }) => (
          <button key={value} onClick={() => a.changeColor(value)} title={label}
            className={`w-9 h-9 rounded-full border-2 transition-all ${a.activeColor === value ? 'border-blue-500 scale-110 shadow-lg' : 'border-zinc-600 hover:border-zinc-400'}`}
            style={{ backgroundColor: value }} />
        ))}
        <div className="h-8 w-px bg-zinc-700 mx-2" />

        <button onClick={a.toggleColorMode} title={a.colorMode === 'fill' ? 'Stroke only' : 'Fill mode'}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${a.isFilled ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}>
          <div className="w-5 h-5 rounded-sm border-2" style={{ borderColor: a.activeColor, backgroundColor: a.isFilled ? hexToRgba(a.activeColor, 0.35) : 'transparent' }} />
        </button>
        <div className="h-8 w-px bg-zinc-700 mx-2" />

        {STROKE_WIDTHS.map((w, i) => (
          <button key={w} onClick={() => a.changeStrokeWidth(w)} title={`${STROKE_LABELS[i]} (${w}px)`}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${a.strokeWidth === w ? 'bg-blue-600' : 'hover:bg-zinc-800'}`}>
            <span className="rounded-full bg-zinc-200 block" style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <div className="h-8 w-px bg-zinc-700 mx-2" />

        <button onClick={a.undo} disabled={!a.canUndo} title="Undo" className="p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"><Undo2 size={22} /></button>
        <button onClick={a.redo} disabled={!a.canRedo} title="Redo" className="p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"><Redo2 size={22} /></button>
        <button onClick={a.deleteSelected} disabled={!a.hasSelection} title="Delete" className="p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"><Trash2 size={22} /></button>
        <button onClick={a.createLegend} title="Add Legend" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">
          <List size={22} /> <span className="text-sm font-medium">Legend</span>
        </button>

        <div className="flex-1" />
        <button onClick={a.saveEditable} className="flex items-center gap-2 px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium"><Save size={18} /> Save</button>
        <button onClick={a.downloadImage} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium ml-2"><Download size={18} /> Download</button>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden"><canvas ref={canvasElRef} /></div>
    </div>
  )
}
