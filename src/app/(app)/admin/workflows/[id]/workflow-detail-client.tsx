'use client'

import { useState } from 'react'
import { getPdfSignedUrl } from '../actions'
import type { WorkflowRow } from '../actions'

const LINEA_LABELS: Record<string, string> = {
  '20': '[20] Clarity',
  '21': '[21] ONE',
  '22': '[22] Analytics',
  '23': '[23] Projects',
  'interno': 'Interno',
}

export default function WorkflowDetailClient({ workflow }: { workflow: WorkflowRow }) {
  const [downloading, setDownloading] = useState(false)

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

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Identidad</p>
        <div className="space-y-1.5 text-xs">
          <Row label="Version" value={`v${workflow.version}`} />
          <Row label="Linea" value={LINEA_LABELS[workflow.linea_negocio] ?? workflow.linea_negocio} />
          <Row label="Estado" value={workflow.estado.replace('_', ' ')} />
          <Row label="Tipo proceso" value={workflow.tipo_proceso ?? '—'} />
          <Row label="Fase detallada" value={workflow.fase_detallada ?? '—'} />
          {workflow.fase_cubierta && workflow.fase_cubierta.length > 0 && (
            <Row label="Fase cubierta" value={workflow.fase_cubierta.join(', ')} />
          )}
        </div>
      </div>

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

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Autoria</p>
        <div className="space-y-1.5 text-xs">
          <Row label="Proceso" value={workflow.autor_proceso ?? '—'} />
          <Row label="Tecnico" value={workflow.autor_tecnico ?? '—'} />
          <Row label="Calidad" value={workflow.owner_calidad ?? '—'} />
          {workflow.fecha_actualizacion && (
            <Row label="Actualizado" value={workflow.fecha_actualizacion} />
          )}
        </div>
      </div>

      {workflow.tags && workflow.tags.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Tags</p>
          <div className="flex flex-wrap gap-1">
            {workflow.tags.map(t => (
              <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

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
