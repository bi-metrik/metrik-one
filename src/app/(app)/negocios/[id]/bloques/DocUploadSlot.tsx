'use client'

import { useRef } from 'react'
import { Upload, Loader2, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react'
import { useFileDrop } from '@/hooks/use-file-drop'

export type SlotState = 'empty' | 'uploading' | 'uploaded' | 'error'

interface Props {
  label: string
  state: SlotState
  fileName?: string
  isProcessingAi?: boolean
  onFileSelected: (file: File) => void
}

export default function DocUploadSlot({ label, state, fileName, isProcessingAi, onFileSelected }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  // Drop de archivo: suelta sobre el slot = mismo flujo que el file picker.
  // Inactivo mientras sube o procesa con IA para no pisar la carga en curso.
  const fileDrop = useFileDrop({
    onFiles: files => onFileSelected(files[0]),
    disabled: state === 'uploading' || isProcessingAi === true,
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onFileSelected(file)
      // Reset el input para permitir re-seleccionar el mismo archivo
      e.target.value = ''
    }
  }

  // ── empty ──────────────────────────────────────────────────
  if (state === 'empty') {
    return (
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        {...fileDrop.dropProps}
        className={`flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed p-4 transition-colors ${
          fileDrop.isDragging
            ? 'border-primary bg-primary/5 text-foreground'
            : 'border-muted-foreground/25 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={handleChange}
          className="hidden"
        />
        <Upload className="h-5 w-5" />
        <span className="text-center text-xs font-medium leading-tight">{label}</span>
      </button>
    )
  }

  // ── uploading ──────────────────────────────────────────────
  if (state === 'uploading') {
    return (
      <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-blue-200 bg-blue-50/30 p-4">
        <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        <span className="text-center text-xs font-medium text-blue-600 leading-tight">{label}</span>
      </div>
    )
  }

  // ── uploaded ───────────────────────────────────────────────
  if (state === 'uploaded') {
    return (
      <div
        {...fileDrop.dropProps}
        className={`flex w-full flex-col items-center gap-1.5 rounded-lg border-2 p-4 transition-colors ${
          fileDrop.isDragging
            ? 'border-dashed border-primary bg-primary/5'
            : 'border-solid border-green-300 bg-green-50/30'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={handleChange}
          className="hidden"
        />
        {isProcessingAi ? (
          <Sparkles className="h-5 w-5 animate-pulse text-primary" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        )}
        <span className="max-w-full truncate text-center text-xs font-medium text-green-800 leading-tight px-1">
          {isProcessingAi ? 'Analizando...' : (fileName || label)}
        </span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isProcessingAi}
          className="rounded-md border border-green-300 bg-white px-2 py-0.5 text-[10px] font-medium text-green-700 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reemplazar
        </button>
      </div>
    )
  }

  // ── error ──────────────────────────────────────────────────
  return (
    <button
      type="button"
      onClick={() => fileRef.current?.click()}
      {...fileDrop.dropProps}
      className={`flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed p-4 transition-colors ${
        fileDrop.isDragging
          ? 'border-primary bg-primary/5'
          : 'border-red-300 bg-red-50/30 hover:border-red-400'
      }`}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={handleChange}
        className="hidden"
      />
      <AlertTriangle className="h-5 w-5 text-amber-500" />
      <span className="text-center text-[11px] font-medium text-red-600 leading-tight">
        Error al subir.
        <br />
        Toca para intentar de nuevo.
      </span>
    </button>
  )
}
