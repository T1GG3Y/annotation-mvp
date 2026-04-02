'use client'

import { useRef, useState, useCallback } from 'react'
import { ImageIcon } from 'lucide-react'

interface Props {
  onFile: (file: File) => void
  versionLabel?: string
}

export default function UploadScreen({ onFile, versionLabel }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div
      className="h-screen flex flex-col items-center justify-center bg-zinc-950"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {versionLabel && <p className="text-zinc-500 text-sm mb-6 font-medium">{versionLabel}</p>}
      <div
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center gap-4 p-16 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
          isDragging ? 'border-blue-500 bg-blue-500/10 scale-105' : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/50'
        }`}
      >
        <div className="p-4 rounded-full bg-zinc-800"><ImageIcon size={36} className="text-zinc-400" /></div>
        <div className="text-center">
          <p className="text-zinc-300 font-medium text-lg">Drop a photo here or click to browse</p>
          <p className="text-zinc-500 text-sm mt-1">PNG, JPG, WebP, or saved .annotate.json</p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} className="hidden" />
      <a href="/" className="mt-8 text-zinc-500 hover:text-zinc-300 text-sm">&larr; Back to version picker</a>
    </div>
  )
}
