'use client'

import { useState } from 'react'
import { getPdfSignedUrl, setEstado } from '../actions'
import type { WorkflowRow } from '../actions'

const ESTADO_LABELS: Record<string, { label: string; cls: string }> = {
  en_construccion: { label: 'En construccion', cls: 'bg-blue-100 text-blue-700' },
  listo_revision:  { label: 'Listo revision',  cls: 'bg-amber-100 text-amber-700' },
  vigente:         { label: 'Vigente',         cls: 'bg-emerald-100 text-emerald-700' },
  archivado:       { label: 'Archivado',       cls: 'bg-gray-200 text-gray-500' },
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return s
  }
}

export default function WorkflowDetailClient({ workflow }: { workflow: WorkflowRow }) {
  const [downloading, setDownloading] = useState(false)
  const [estado, setEstadoLocal] = useState(workflow.estado)
  const [changing, setChanging] = useState(false)

  const identificador = workflow.numero_flujo
    ? `${workflow.cliente_slug}${workflow.numero_flujo}`
    : workflow.cliente_slug

  async function handlePdfDownload() {
    setDownloading(true)
    try {
      const url = await getPdfSignedUrl(workflow.id)
      if (url) window.location.href = url
      else alert('No hay PDF disponible. Genera uno desde el skill /workflow local.')
    } finally {
      setDownloading(false)
    }
  }

  async function handleEstadoChange(next: typeof estado) {
    if (changing || next === estado) return
    setChanging(true)
    const ok = await setEstado(workflow.id, next as 'en_construccion' | 'listo_revision' | 'vigente' | 'archivado')
    if (ok) setEstadoLocal(next)
    setChanging(false)
  }

  const lineaCliente = workflow.linea_negocio_cliente || '—'

  return (
    <>
      {/* Identidad */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Identidad</p>
        <div className="space-y-1.5 text-xs">
          <Row label="ID" value={identificador} />
          <Row label="Cliente" value={workflow.cliente_nombre ?? workflow.cliente_slug} />
          <Row label="Proyecto" value={workflow.proyecto_slug} />
          <Row label="Linea" value={lineaCliente} />
          <Row label="Version" value={`v${workflow.version}`} />
          <Row label="Estado" value={ESTADO_LABELS[estado]?.label ?? estado} />
        </div>
      </div>

      {/* Estructura */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Estructura</p>
        <div className="space-y-1.5 text-xs">
          <Row label="Total fases" value={String(workflow.total_fases ?? '—')} />
          <Row label="Total etapas" value={String(workflow.total_etapas ?? '—')} />
          <Row label="Total bloques" value={String(workflow.total_bloques ?? '—')} />
          <Row label="Condicionales" value={workflow.tiene_condicionales ? 'Si' : 'No'} />
          {workflow.basado_en && <Row label="Basado en" value={workflow.basado_en} />}
        </div>
      </div>

      {/* Fechas (sueltas, sin bloque "Auditoria") */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="space-y-1.5 text-xs">
          <Row label="Creado" value={formatDate(workflow.created_at)} />
          <Row label="Actualizado" value={formatDate(workflow.updated_at)} />
        </div>
      </div>

      {/* Acciones */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Cambiar estado</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(['en_construccion', 'listo_revision', 'vigente', 'archivado'] as const).map(s => (
              <button
                key={s}
                onClick={() => handleEstadoChange(s)}
                disabled={changing || estado === s}
                className={`rounded-md border px-2 py-1 text-[10px] font-medium transition ${
                  estado === s
                    ? `${ESTADO_LABELS[s].cls} border-transparent`
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400 disabled:opacity-50'
                }`}
              >
                {ESTADO_LABELS[s].label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handlePdfDownload}
          disabled={downloading || !workflow.pdf_storage_path}
          className="w-full rounded-lg bg-[#10B981] py-2 text-sm font-semibold text-white transition hover:bg-[#059669] disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {workflow.pdf_storage_path
            ? (downloading ? 'Descargando…' : 'Descargar PDF')
            : 'PDF no disponible'}
        </button>
        {!workflow.pdf_storage_path && (
          <p className="text-[10px] text-gray-400">
            Para generar el PDF ejecuta el skill <code className="rounded bg-gray-100 px-1 font-mono">/workflow</code> localmente y vuelve a publicar.
          </p>
        )}
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="truncate text-right text-[#1A1A1A]">{value}</span>
    </div>
  )
}
