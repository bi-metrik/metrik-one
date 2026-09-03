'use client'
import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * «Descargar Excel» de la lista de negocios.
 *
 * Manda los ids que la lista tiene a la vista (ya filtrados) a
 * `POST /api/negocios/export` y dispara la descarga con el nombre que la ruta pone en
 * `Content-Disposition`. El gate real está en la ruta; este botón solo se pinta para
 * los roles que pasan (`puedeDescargarNegocios`, resuelto en el servidor).
 */

const NOMBRE_POR_DEFECTO = 'negocios.xlsx'

function nombreDeArchivo(res: Response): string {
  const cd = res.headers.get('Content-Disposition') ?? ''
  const m = /filename="([^"]+)"/.exec(cd)
  return m?.[1] ?? NOMBRE_POR_DEFECTO
}

function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.visibility = 'hidden'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function DescargarExcelButton({ ids }: { ids: string[] }) {
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const descargar = async () => {
    if (cargando || ids.length === 0) return
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/negocios/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) {
        const texto = (await res.text().catch(() => '')).trim()
        throw new Error(texto || `No se pudo generar el archivo (HTTP ${res.status})`)
      }
      const blob = await res.blob()
      descargarBlob(blob, nombreDeArchivo(res))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo generar el archivo'
      setError(msg)
      toast.error(msg)
    } finally {
      setCargando(false)
    }
  }

  const n = ids.length
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={descargar}
        disabled={cargando || n === 0}
        aria-busy={cargando}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#1A1A1A] transition-colors hover:border-[#1A1A1A]/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        {cargando ? 'Generando…' : 'Descargar Excel'}
        <span className="rounded-full bg-[#F5F4F2] px-1.5 py-0.5 text-[10px] font-bold">
          {n} negocio{n !== 1 ? 's' : ''}
        </span>
      </button>
      {error && (
        <p role="alert" className="text-[11px] text-[#EF4444]">
          {error}
        </p>
      )}
    </div>
  )
}
