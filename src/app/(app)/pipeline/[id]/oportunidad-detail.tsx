'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Building2, User, ChevronRight, Flame, XCircle,
  Trophy, FileText, Plus, Clock, ShieldAlert, Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  moveOportunidad, perderOportunidad, ganarOportunidad,
} from '../actions-v2'
import { duplicarCotizacion } from './cotizaciones/actions-v2'
import { ETAPA_CONFIG, ETAPAS_ACTIVAS, RAZONES_PERDIDA, ESTADO_COTIZACION_CONFIG } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import type { EtapaPipeline, EstadoCotizacion } from '@/lib/pipeline/constants'
import NotesSection from '@/components/notes-section'
import FiscalGateForm from './fiscal-gate-form'

interface OportunidadRow {
  id: string
  descripcion: string | null
  etapa: string | null
  probabilidad: number | null
  valor_estimado: number | null
  created_at: string | null
  ultima_accion: string | null
  ultima_accion_fecha: string | null
  razon_perdida: string | null
  contactos: { id: string; nombre: string; telefono: string | null; email: string | null } | null
  empresas: { id: string; nombre: string; sector: string | null; nit: string | null; tipo_persona: string | null; regimen_tributario: string | null; gran_contribuyente: boolean | null; agente_retenedor: boolean | null } | null
}

interface CotizacionRow {
  id: string
  consecutivo: string | null
  modo: string | null
  estado: string | null
  valor_total: number | null
  created_at: string | null
}

interface Props {
  oportunidad: OportunidadRow
  cotizaciones: CotizacionRow[]
}

export default function OportunidadDetail({ oportunidad, cotizaciones }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showLossModal, setShowLossModal] = useState(false)
  const [showFiscalGate, setShowFiscalGate] = useState(false)
  const [lossReason, setLossReason] = useState('')

  const etapa = oportunidad.etapa as EtapaPipeline
  const etapaConfig = ETAPA_CONFIG[etapa]
  const empresa = oportunidad.empresas as OportunidadRow['empresas']
  const contacto = oportunidad.contactos as OportunidadRow['contactos']
  const isTerminal = etapa === 'ganada' || etapa === 'perdida'

  const currentIdx = ETAPAS_ACTIVAS.indexOf(etapa as EtapaPipeline)
  const nextEtapa = !isTerminal && currentIdx < ETAPAS_ACTIVAS.length - 1
    ? ETAPAS_ACTIVAS[currentIdx + 1]
    : null

  const handleAdvance = () => {
    if (!nextEtapa) return
    startTransition(async () => {
      const res = await moveOportunidad(oportunidad.id, nextEtapa)
      if (res.success) {
        toast.success(`Movida a ${ETAPA_CONFIG[nextEtapa].label}`)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleWin = () => {
    startTransition(async () => {
      const res = await ganarOportunidad(oportunidad.id)
      if (res.success) {
        toast.success('Oportunidad ganada! Proyecto creado.')
        router.refresh()
      } else if ((res as { needsFiscal?: boolean }).needsFiscal) {
        setShowFiscalGate(true)
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleLoss = () => {
    if (!lossReason) return
    startTransition(async () => {
      const res = await perderOportunidad(oportunidad.id, lossReason)
      if (res.success) {
        toast.success('Oportunidad marcada como perdida')
        setShowLossModal(false)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/pipeline"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-lg font-bold">{oportunidad.descripcion || 'Sin descripcion'}</h1>
          <div className="flex items-center gap-2">
            {etapaConfig && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${etapaConfig.chipClass}`}>
                {etapaConfig.label} · {etapaConfig.probabilidad}%
              </span>
            )}
            {oportunidad.valor_estimado && (
              <span className="text-sm font-semibold">{formatCOP(oportunidad.valor_estimado)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Etapa progress bar */}
      {!isTerminal && (
        <div className="flex gap-1">
          {ETAPAS_ACTIVAS.map((e, i) => (
            <div
              key={e}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= currentIdx ? etapaConfig?.dotClass ?? 'bg-gray-400' : 'bg-muted'
              }`}
            />
          ))}
        </div>
      )}

      {/* Action buttons */}
      {!isTerminal && (
        <div className="flex gap-2">
          {nextEtapa && (
            <button
              onClick={handleAdvance}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
              Avanzar a {ETAPA_CONFIG[nextEtapa].label}
            </button>
          )}
          <button
            onClick={handleWin}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Trophy className="h-4 w-4" />
            Ganar
          </button>
          <button
            onClick={() => setShowLossModal(true)}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" />
            Perder
          </button>
        </div>
      )}

      {/* Fiscal gate form */}
      {showFiscalGate && empresa && (
        <FiscalGateForm
          oportunidadId={oportunidad.id}
          empresa={empresa}
          onComplete={() => {
            setShowFiscalGate(false)
            router.refresh()
          }}
          onCancel={() => setShowFiscalGate(false)}
        />
      )}

      {/* Contacto + Empresa info */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {contacto && (
          <Link
            href={`/directorio/contacto/${contacto.id}`}
            className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50"
          >
            <User className="h-5 w-5 text-blue-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{contacto.nombre}</p>
              <p className="text-xs text-muted-foreground truncate">{contacto.telefono || contacto.email || 'Contacto'}</p>
            </div>
          </Link>
        )}
        {empresa && (
          <Link
            href={`/directorio/empresa/${empresa.id}`}
            className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50"
          >
            <Building2 className="h-5 w-5 text-purple-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{empresa.nombre}</p>
              <p className="text-xs text-muted-foreground truncate">{empresa.sector || 'Empresa'}</p>
            </div>
          </Link>
        )}
      </div>

      {/* Cotizaciones */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Cotizaciones ({cotizaciones.length})</h2>
          {!isTerminal && (
            <Link
              href={`/pipeline/${oportunidad.id}/cotizacion/nueva`}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3 w-3" />
              Nueva
            </Link>
          )}
        </div>
        {cotizaciones.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Sin cotizaciones</p>
        ) : (
          <div className="space-y-2">
            {cotizaciones.map(c => {
              const estadoConfig = ESTADO_COTIZACION_CONFIG[c.estado as EstadoCotizacion]
              const canDuplicate = c.estado !== 'borrador'
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent/50 cursor-pointer"
                  onClick={() => router.push(`/pipeline/${oportunidad.id}/cotizacion/${c.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                    <div>
                      <span className="text-sm font-medium">{c.consecutivo || 'Sin consecutivo'}</span>
                      <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                        {c.modo === 'flash' ? 'Flash' : 'Detallada'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.valor_total !== null && (
                      <span className="text-xs font-medium">{formatCOP(c.valor_total)}</span>
                    )}
                    {estadoConfig && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estadoConfig.chipClass}`}>
                        {estadoConfig.label}
                      </span>
                    )}
                    {canDuplicate && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          startTransition(async () => {
                            const res = await duplicarCotizacion(c.id)
                            if (res.success) {
                              toast.success('Cotización duplicada (borrador)')
                              router.refresh()
                            } else {
                              toast.error(res.error ?? 'Error al duplicar')
                            }
                          })
                        }}
                        disabled={isPending}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                        title="Duplicar cotización"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Notas */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Notas y actividad</h2>
        <NotesSection entityType="oportunidad" entityId={oportunidad.id} />
      </div>

      {/* Loss modal */}
      {showLossModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl">
            <h3 className="text-sm font-bold">Marcar como perdida</h3>
            <p className="mt-1 text-xs text-muted-foreground">Selecciona la razon principal</p>
            <div className="mt-3 space-y-1.5">
              {RAZONES_PERDIDA.map(r => (
                <button
                  key={r.value}
                  onClick={() => setLossReason(r.value)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    lossReason === r.value ? 'border-red-500 bg-red-50 text-red-700' : 'hover:bg-accent'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowLossModal(false)}
                className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={handleLoss}
                disabled={!lossReason || isPending}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
