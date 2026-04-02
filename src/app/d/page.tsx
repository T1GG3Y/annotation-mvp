'use client'
import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import UploadScreen from '@/components/upload-screen'
const Annotator = dynamic(() => import('@/components/annotator-d'), { ssr: false, loading: () => <div className="h-screen bg-zinc-950" /> })

export default function PageD() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [canvasState, setCanvasState] = useState<string | null>(null)

  const handleFile = useCallback((file: File) => {
    if (file.name.endsWith('.json')) {
      const r = new FileReader()
      r.onload = (e) => { try { const j = e.target?.result as string; const p = JSON.parse(j); if (p.objects !== undefined && p.backgroundImage) { setCanvasState(j); setImageUrl('__saved__'); setImageName(file.name.replace(/\.annotate\.json$|\.json$/, '')) } } catch {} }
      r.readAsText(file); return
    }
    if (!file.type.startsWith('image/')) return
    setCanvasState(null); setImageUrl(URL.createObjectURL(file)); setImageName(file.name)
  }, [])

  const handleBack = useCallback(() => {
    if (imageUrl && imageUrl !== '__saved__') URL.revokeObjectURL(imageUrl)
    setImageUrl(null); setImageName(''); setCanvasState(null)
  }, [imageUrl])

  if (imageUrl) return <Annotator imageUrl={imageUrl} imageName={imageName} initialState={canvasState} onBack={handleBack} />
  return <UploadScreen onFile={handleFile} versionLabel="Version D — Refined Controls" />
}
