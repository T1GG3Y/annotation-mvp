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

export default function AnnotatorB({ imageUrl, imageName, initialState, onBack }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const a = useAnnotator({ imageUrl, imageName, initialState, canvasElRef, containerRef })

  const btn = (active: boolean) =>
    `flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`

  return (
    <div className="h-screen flex bg-zinc-950">
      {/* Left sidebar */}
      <div className="w-52 flex flex-col bg-zinc-900 border-r border-zinc-800 select-none overflow-y-auto">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-4 text-zinc-400 hover:text-white hover:bg-zinc-800 text-sm font-medium border-b border-zinc-800">
          <ArrowLeft size={18} /> Back
        </button>

        <div className="px-3 pt-4 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Tools</div>
        <div className="px-2 flex flex-col gap-0.5">
          {TOOLS.map(({ tool, Icon, label, key }) => (
            <button key={tool} onClick={() => a.changeTool(tool)} className={btn(a.activeTool === tool)}>
              <Icon size={20} /> {label} <span className="ml-auto text-xs opacity-40">{key}</span>
            </button>
          ))}
        </div>

        <div className="px-3 pt-5 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Color</div>
        <div className="px-3 flex gap-2.5">
          {COLORS.map(({ value, label }) => (
            <button key={value} onClick={() => a.changeColor(value)} title={label}
              className={`w-10 h-10 rounded-full border-2 transition-all ${a.activeColor === value ? 'border-blue-500 scale-110' : 'border-zinc-600 hover:border-zinc-400'}`}
              style={{ backgroundColor: value }} />
          ))}
        </div>

        <div className="px-3 pt-5 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Options</div>
        <div className="px-3 flex items-center gap-2">
          <button onClick={a.toggleFill} title={a.isFilled ? 'Hollow' : 'Filled'}
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${a.isFilled ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}>
            <div className="w-6 h-6 rounded-sm border-2" style={{ borderColor: a.activeColor, backgroundColor: a.isFilled ? hexToRgba(a.activeColor, 0.35) : 'transparent' }} />
          </button>
          {STROKE_WIDTHS.map((w, i) => (
            <button key={w} onClick={() => a.changeStrokeWidth(w)} title={STROKE_LABELS[i]}
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${a.strokeWidth === w ? 'bg-blue-600' : 'hover:bg-zinc-800'}`}>
              <span className="rounded-full bg-zinc-200 block" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="px-2 pb-3 flex flex-col gap-1.5">
          <div className="flex gap-1">
            <button onClick={a.undo} disabled={!a.canUndo} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Undo2 size={20} className="mx-auto" /></button>
            <button onClick={a.redo} disabled={!a.canRedo} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Redo2 size={20} className="mx-auto" /></button>
            <button onClick={a.deleteSelected} disabled={!a.hasSelection} className="flex-1 p-3 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-25"><Trash2 size={20} className="mx-auto" /></button>
          </div>
          <button onClick={a.createLegend} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-white text-sm font-medium"><List size={20} /> Legend</button>
          <button onClick={a.saveEditable} className="w-full flex items-center justify-center gap-2 py-3 bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl text-sm font-medium"><Save size={18} /> Save</button>
          <button onClick={a.downloadImage} className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium"><Download size={18} /> Download</button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden"><canvas ref={canvasElRef} /></div>
    </div>
  )
}
