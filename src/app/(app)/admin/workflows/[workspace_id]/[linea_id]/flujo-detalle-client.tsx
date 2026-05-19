'use client'

import { useState } from 'react'
import type { AdminFlujoDetalle, AdminEtapa, AdminBloque } from '../../actions'
import { ShieldCheck, AlertTriangle, ChevronDown, ChevronRight, Clock } from 'lucide-react'

const STAGE_LABELS: Record<AdminEtapa['stage'], string> = {
  venta: 'Venta',
  ejecucion: 'Ejecución',
  cobro: 'Cobro',
}

const STAGE_COLORS: Record<AdminEtapa['stage'], { bg: string; text: string; border: string }> = {
  venta:     { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' },
  ejecucion: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  cobro:     { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
}

export default function FlujoDetalleClient({ detalle }: { detalle: AdminFlujoDetalle }) {
  if (detalle.etapas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#F5F4F2] p-8 text-center">
        <p className="text-sm text-[#6B7280]">Esta línea aún no tiene etapas configuradas.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {detalle.etapas.map(e => <EtapaPanel key={e.id} etapa={e} />)}
    </div>
  )
}

function EtapaPanel({ etapa }: { etapa: AdminEtapa }) {
  const [expanded, setExpanded] = useState(true)
  const stageColor = STAGE_COLORS[etapa.stage]
  const slaDias = ((etapa.config_extra as { sla_dias?: number | null } | null)?.sla_dias) ?? null
  const tieneAlerta = slaDias !== null && slaDias > 0 && etapa.vencidos > 0
  const routing = (etapa.config_extra as Record<string, unknown> | null)?.routing as Record<string, unknown> | undefined
  const gates = (etapa.config_extra as Record<string, unknown> | null)?.gates as string[] | undefined

  return (
    <section className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      <header
        className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[#F5F4F2]"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex min-w-0 items-center gap-3">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7280]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[#6B7280]" />}
          <span className="shrink-0 text-[11px] font-semibold text-[#6B7280]">
            {String(etapa.orden).padStart(2, '0')}
          </span>
          <h3 className="truncate text-sm font-bold text-[#1A1A1A]">{etapa.nombre}</h3>
          <span
            className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: stageColor.bg,
              color: stageColor.text,
              borderColor: stageColor.border,
            }}
          >
            {STAGE_LABELS[etapa.stage]}
          </span>
          {!etapa.is_active && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">inactiva</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {slaDias !== null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]" title="SLA configurado">
              <Clock className="h-3 w-3" />
              {slaDias}d
            </span>
          )}
          <span
            className="inline-flex items-center rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[11px] font-semibold text-[#1A1A1A]"
            title="Negocios abiertos"
          >
            {etapa.abiertos}
          </span>
          {tieneAlerta && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}
              title={`Vencidos (SLA ${slaDias}d)`}
            >
              <AlertTriangle className="h-3 w-3" />
              {etapa.vencidos}
            </span>
          )}
          <span className="text-[11px] text-[#6B7280]">{etapa.bloques.length} bloque{etapa.bloques.length === 1 ? '' : 's'}</span>
        </div>
      </header>

      {expanded && (
        <div className="border-t border-[#E5E7EB] p-4">
          {/* Etapa-level config (routing + gates) */}
          {(routing || (gates && gates.length > 0)) && (
            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {gates && gates.length > 0 && (
                <ConfigBox titulo="Gates de etapa">
                  <ul className="space-y-1">
                    {gates.map(g => (
                      <li key={g} className="font-mono text-[11px] text-[#1A1A1A]">{g}</li>
                    ))}
                  </ul>
                </ConfigBox>
              )}
              {routing && (
                <ConfigBox titulo="Routing">
                  <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-[#1A1A1A]">
                    {JSON.stringify(routing, null, 2)}
                  </pre>
                </ConfigBox>
              )}
            </div>
          )}

          {/* Bloques */}
          {etapa.bloques.length === 0 ? (
            <p className="text-[11px] italic text-[#6B7280]">Sin bloques en esta etapa.</p>
          ) : (
            <div className="space-y-2">
              {etapa.bloques.map(b => <BloqueRow key={b.config_id} bloque={b} />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ConfigBox({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F5F4F2] p-2.5">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{titulo}</p>
      {children}
    </div>
  )
}

function BloqueRow({ bloque }: { bloque: AdminBloque }) {
  const [expanded, setExpanded] = useState(false)
  const hasConfig = Object.keys(bloque.config_extra || {}).length > 0

  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
      <header
        className={`flex items-center justify-between gap-2 px-3 py-2 ${hasConfig ? 'cursor-pointer hover:bg-[#F5F4F2]' : ''}`}
        onClick={() => hasConfig && setExpanded(!expanded)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: bloque.es_gate ? '#10B981' : '#6B7280' }}
          />
          <span className="shrink-0 text-[10px] font-mono text-[#6B7280]">{bloque.orden}</span>
          <span className="truncate text-[12px] font-semibold text-[#1A1A1A]">{bloque.nombre_definition}</span>
          <span className="rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[10px] font-mono text-[#6B7280]">{bloque.tipo}</span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: bloque.estado === 'editable' ? '#DBEAFE' : '#F3F4F6',
              color: bloque.estado === 'editable' ? '#1D4ED8' : '#6B7280',
            }}
          >
            {bloque.estado}
          </span>
          {bloque.es_gate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-medium text-[#059669]">
              <ShieldCheck className="h-3 w-3" />
              gate
            </span>
          )}
        </div>
        {hasConfig && (
          expanded
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
        )}
      </header>
      {expanded && hasConfig && (
        <div className="border-t border-[#E5E7EB] bg-[#F5F4F2] px-3 py-2">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-[#1A1A1A]">
            {JSON.stringify(bloque.config_extra, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
