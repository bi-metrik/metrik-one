'use client'

import { useState, useTransition } from 'react'
import { FileSpreadsheet, ExternalLink, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { marcarBloqueCompleto, actualizarBloqueData, actualizarPrecioAprobado } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface BloqueCotizacionProps {
  negocioId: string
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BloqueCotizacion({
  negocioId,
  negocioBloqueId,
  instancia,
  modo,
}: BloqueCotizacionProps) {
  const saved = (instancia?.data ?? {}) as {
    url?: string
    precio?: number
    estado?: 'borrador' | 'enviada' | 'aceptada'
    notas?: string
  }

  const [url, setUrl] = useState(saved.url ?? '')
  const [precio, setPrecio] = useState(saved.precio ? String(saved.precio) : '')
  const [estado, setEstado] = useState<'borrador' | 'enviada' | 'aceptada'>(saved.estado ?? 'borrador')
  const [notas, setNotas] = useState(saved.notas ?? '')
  const [isPending, startTransition] = useTransition()

  const isAceptada = estado === 'aceptada'

  function handleGuardar() {
    startTransition(async () => {
      const data = {
        url: url.trim() || null,
        precio: precio ? Number(precio) : null,
        estado,
        notas: notas.trim() || null,
      }
      let result
      if (isAceptada && url.trim()) {
        result = await marcarBloqueCompleto(negocioBloqueId, data)
        // Actualizar precio_aprobado del negocio si tiene valor
        if (data.precio) {
          await actualizarPrecioAprobado(negocioId, data.precio)
        }
      } else {
        result = await actualizarBloqueData(negocioBloqueId, data)
      }
      if (result.error) toast.error(result.error)
      else toast.success('Cotización guardada')
    })
  }

  const ESTADO_LABELS = { borrador: 'Borrador', enviada: 'Enviada al cliente', aceptada: 'Aceptada ✓' }
  const ESTADO_COLORS = {
    borrador: 'bg-slate-100 text-slate-600',
    enviada: 'bg-blue-100 text-blue-700',
    aceptada: 'bg-green-100 text-green-700',
  }

  if (modo === 'visible') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ESTADO_COLORS[saved.estado ?? 'borrador']}`}>
            {ESTADO_LABELS[saved.estado ?? 'borrador']}
          </span>
          {saved.precio && (
            <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums">{fmt(saved.precio)}</span>
          )}
        </div>
        {saved.url && (
          <a href={saved.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[#10B981] hover:underline">
            <ExternalLink className="h-3 w-3" />
            Ver cotización
          </a>
        )}
        {saved.notas && <p className="text-[11px] text-[#6B7280]">{saved.notas}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Estado */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Estado</label>
        <div className="flex gap-2">
          {(['borrador', 'enviada', 'aceptada'] as const).map(s => (
            <button
              key={s}
              onClick={() => setEstado(s)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                estado === s
                  ? `${ESTADO_COLORS[s]} border-current`
                  : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#10B981]'
              }`}
            >
              {ESTADO_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* URL */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">
          Link de la cotización <span className="text-[#6B7280]/60">(Drive, Sheets, PDF...)</span>
        </label>
        <div className="flex items-center gap-1.5">
          <input
            type="url"
            placeholder="https://drive.google.com/..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="flex-1 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
          />
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#6B7280] hover:text-[#10B981]">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Precio */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Valor de la propuesta</label>
        <input
          type="number"
          placeholder="0"
          value={precio}
          onChange={e => setPrecio(e.target.value)}
          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
        />
        {precio && <p className="mt-0.5 text-[10px] text-[#6B7280]">{fmt(Number(precio))}</p>}
      </div>

      {/* Notas */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Notas</label>
        <textarea
          value={notas}
          onChange={e => setNotas(e.target.value)}
          placeholder="Observaciones, condiciones, versión..."
          rows={2}
          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none resize-none focus:ring-2 focus:ring-[#10B981]/15"
        />
      </div>

      <button
        onClick={handleGuardar}
        disabled={isPending}
        className={`w-full rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-40 ${
          isAceptada && url
            ? 'bg-[#10B981] text-white hover:bg-[#059669]'
            : 'bg-[#1A1A1A] text-white hover:bg-[#333]'
        }`}
      >
        {isPending ? 'Guardando...' : isAceptada && url ? (
          <span className="inline-flex items-center justify-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Guardar y marcar aceptada
          </span>
        ) : 'Guardar'}
      </button>

      {isAceptada && !url && (
        <p className="text-[11px] text-amber-600">Agrega el link para marcar como aceptada</p>
      )}
    </div>
  )
}
