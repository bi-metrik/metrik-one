'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { FlujoData, FlujoEtapa } from './actions'
import { updateEtapaSla } from './actions'
import { GitFork, AlertTriangle, Clock, ShieldCheck, Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'

const STAGE_LABELS: Record<FlujoEtapa['stage'], string> = {
  venta: 'Venta',
  ejecucion: 'Ejecución',
  cobro: 'Cobro',
}

const STAGE_COLORS: Record<FlujoEtapa['stage'], { bg: string; text: string; border: string }> = {
  venta:     { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' },
  ejecucion: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  cobro:     { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
}

export default function FlujoClient({ data }: { data: FlujoData }) {
  const router = useRouter()
  const { lineas, selectedLineaId, etapas, canConfigSla } = data

  const handleLineaChange = (id: string) => {
    const params = new URLSearchParams()
    params.set('linea', id)
    router.push(`/flujo?${params.toString()}`)
  }

  if (lineas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#F5F4F2] p-8 text-center">
        <GitFork className="mx-auto h-8 w-8 text-[#6B7280]" />
        <p className="mt-3 text-sm font-semibold text-[#1A1A1A]">Aún no hay flujo configurado</p>
        <p className="mt-1 text-xs text-[#6B7280]">
          Tu workspace todavía no tiene líneas de negocio activas. Contacta a tu administrador MéTRIK.
        </p>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">Flujo</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              Etapas y bloques del proceso de tu negocio.
            </p>
          </div>
          {lineas.length > 1 && (
            <div className="flex items-center gap-2">
              <label htmlFor="linea-select" className="text-xs text-[#6B7280]">Línea:</label>
              <select
                id="linea-select"
                value={selectedLineaId ?? ''}
                onChange={(e) => handleLineaChange(e.target.value)}
                className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
              >
                {lineas.map(l => (
                  <option key={l.id} value={l.id}>{l.nombre}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      {etapas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-white p-8 text-center">
          <p className="text-sm text-[#6B7280]">Esta línea aún no tiene etapas configuradas.</p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-3">
          <div className="flex gap-3 min-w-max">
            {etapas.map((etapa) => (
              <EtapaCard key={etapa.id} etapa={etapa} canConfigSla={canConfigSla} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EtapaCard({ etapa, canConfigSla }: { etapa: FlujoEtapa; canConfigSla: boolean }) {
  const stageColor = STAGE_COLORS[etapa.stage]
  const tieneAlerta = etapa.sla_dias !== null && etapa.sla_dias > 0 && etapa.vencidos > 0

  return (
    <article
      className="flex w-72 shrink-0 flex-col rounded-xl border bg-white shadow-sm"
      style={{ borderColor: '#E5E7EB' }}
    >
      {/* Header */}
      <header
        className="flex items-start justify-between gap-2 border-b px-4 pb-3 pt-3"
        style={{ borderColor: '#E5E7EB' }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-[#6B7280]">
              {String(etapa.orden).padStart(2, '0')}
            </span>
            <h3 className="truncate text-sm font-bold text-[#1A1A1A]">{etapa.nombre}</h3>
          </div>
          <span
            className="mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: stageColor.bg,
              color: stageColor.text,
              borderColor: stageColor.border,
            }}
          >
            {STAGE_LABELS[etapa.stage]}
          </span>
        </div>

        {/* Badges contadores */}
        <div className="flex flex-col items-end gap-1">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[11px] font-semibold text-[#1A1A1A]"
            title={`${etapa.abiertos} negocio(s) abierto(s) en esta etapa`}
          >
            {etapa.abiertos}
          </span>
          {tieneAlerta && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}
              title={`${etapa.vencidos} vencido(s) (SLA ${etapa.sla_dias} días)`}
            >
              <AlertTriangle className="h-3 w-3" />
              {etapa.vencidos}
            </span>
          )}
        </div>
      </header>

      {/* SLA config */}
      <SlaConfig etapaId={etapa.id} slaDias={etapa.sla_dias} canEdit={canConfigSla} />

      {/* Bloques */}
      <div className="flex-1 px-4 py-3">
        {etapa.bloques.length === 0 ? (
          <p className="text-[11px] italic text-[#6B7280]">Sin bloques configurados.</p>
        ) : (
          <ul className="space-y-1.5">
            {etapa.bloques.map(b => (
              <li
                key={b.config_id}
                className="flex items-center gap-2 text-[12px] text-[#1A1A1A]"
              >
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: b.es_gate ? '#10B981' : '#6B7280' }}
                  title={b.es_gate ? 'Gate (bloquea avance)' : 'Bloque normal'}
                />
                <span className="flex-1 truncate">{b.nombre}</span>
                {b.es_gate && (
                  <ShieldCheck className="h-3 w-3 shrink-0 text-[#10B981]" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}

function SlaConfig({
  etapaId,
  slaDias,
  canEdit,
}: {
  etapaId: string
  slaDias: number | null
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(slaDias?.toString() ?? '')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  if (!canEdit && slaDias === null) {
    return null
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2"
        style={{ borderColor: '#E5E7EB' }}>
        <div className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          <Clock className="h-3 w-3" />
          {slaDias !== null ? (
            <span>SLA: <span className="font-semibold text-[#1A1A1A]">{slaDias} día{slaDias === 1 ? '' : 's'}</span></span>
          ) : (
            <span>Sin alerta</span>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md p-1 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A]"
            title="Configurar SLA"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  const save = () => {
    const trimmed = value.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650)) {
      toast.error('Ingresa un número entero entre 0 y 3650 (o vacía para quitar la alerta)')
      return
    }
    startTransition(async () => {
      const res = await updateEtapaSla(etapaId, parsed)
      if (res.ok) {
        toast.success(parsed === null ? 'Alerta desactivada' : `SLA actualizado a ${parsed} días`)
        setEditing(false)
        router.refresh()
      } else {
        toast.error(res.error ?? 'No se pudo guardar')
      }
    })
  }

  return (
    <div className="border-b bg-[#F5F4F2] px-3 py-2" style={{ borderColor: '#E5E7EB' }}>
      <label htmlFor={`sla-${etapaId}`} className="block text-[10px] font-medium text-[#6B7280]">
        Días esperados en esta etapa
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          id={`sla-${etapaId}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={3650}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Sin alerta"
          disabled={isPending}
          className="w-full rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[12px] text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-50"
        />
        <button
          onClick={save}
          disabled={isPending}
          className="rounded-md bg-[#10B981] p-1 text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
          title="Guardar"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          onClick={() => { setEditing(false); setValue(slaDias?.toString() ?? '') }}
          disabled={isPending}
          className="rounded-md bg-white p-1 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] disabled:opacity-50"
          style={{ border: '1px solid #E5E7EB' }}
          title="Cancelar"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1 text-[10px] text-[#6B7280]">Vacía el campo para desactivar la alerta.</p>
    </div>
  )
}
