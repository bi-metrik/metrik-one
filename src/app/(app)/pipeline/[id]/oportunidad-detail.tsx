'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Building2, User, ChevronRight, Flame, XCircle,
  Trophy, FileText, Plus, Clock, ShieldAlert, Copy, Send, Check, X,
  FolderOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  moveOportunidad, perderOportunidad, ganarOportunidad, updateOportunidad,
} from '../actions-v2'
import { duplicarCotizacion, enviarCotizacion, aceptarCotizacion, rechazarCotizacion } from './cotizaciones/actions-v2'
import { ETAPA_CONFIG, ETAPAS_ACTIVAS, RAZONES_PERDIDA, ESTADO_COTIZACION_CONFIG } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import type { EtapaPipeline, EstadoCotizacion } from '@/lib/pipeline/constants'
import ActivityLog from '@/components/activity-log'
import CustomFieldsSection from '@/components/custom-fields-section'
import FiscalGateForm from './fiscal-gate-form'
import VeDocumentosSection from './ve-documentos-section'
import type { VeDocumentoState, CamposVehiculo } from '@/lib/actions/ve-documentos'

interface OportunidadRow {
  id: string
  codigo: string
  descripcion: string | null
  etapa: string | null
  probabilidad: number | null
  valor_estimado: number | null
  created_at: string | null
  ultima_accion: string | null
  ultima_accion_fecha: string | null
  etapa_changed_at: string | null
  razon_perdida: string | null
  carpeta_url: string | null
  responsable_id: string | null
  custom_data: unknown
  contactos: { id: string; nombre: string; telefono: string | null; email: string | null } | null
  empresas: { id: string; nombre: string; sector: string | null; numero_documento: string | null; tipo_documento: string | null; tipo_persona: string | null; regimen_tributario: string | null; gran_contribuyente: boolean | null; agente_retenedor: boolean | null; autorretenedor: boolean | null } | null
}

interface CotizacionRow {
  id: string
  codigo: string | null
  consecutivo: string | null
  modo: string | null
  estado: string | null
  valor_total: number | null
  descuento_porcentaje?: number | null
  descuento_valor?: number | null
  created_at: string | null
}

interface Props {
  oportunidad: OportunidadRow
  cotizaciones: CotizacionRow[]
  staffList: { id: string; full_name: string }[]
  veDocumentos?: VeDocumentoState[]
  veVehiculoEnUpme?: boolean | null
  veCamposVehiculo?: CamposVehiculo | null
}

export default function OportunidadDetail({
  oportunidad,
  cotizaciones,
  staffList,
  veDocumentos = [],
  veVehiculoEnUpme = null,
  veCamposVehiculo = null,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showLossModal, setShowLossModal] = useState(false)
  const [showFiscalGate, setShowFiscalGate] = useState(false)
  const [lossReason, setLossReason] = useState('')
  const [carpetaUrl, setCarpetaUrl] = useState(oportunidad.carpeta_url ?? '')
  const [carpetaEditing, setCarpetaEditing] = useState(false)
  const [responsableId, setResponsableId] = useState(oportunidad.responsable_id ?? '')

  const etapa = oportunidad.etapa as EtapaPipeline
  const etapaConfig = ETAPA_CONFIG[etapa]
  const empresa = oportunidad.empresas as OportunidadRow['empresas']
  const contacto = oportunidad.contactos as OportunidadRow['contactos']
  const isTerminal = etapa === 'ganada' || etapa === 'perdida'

  const calcDias = (fecha: string | null) => {
    if (!fecha) return 0
    return Math.floor((Date.now() - new Date(fecha).getTime()) / (1000 * 60 * 60 * 24))
  }
  const diasEnStage = calcDias(oportunidad.etapa_changed_at ?? oportunidad.ultima_accion_fecha)
  const diasSinActividad = calcDias(oportunidad.ultima_accion_fecha ?? oportunidad.created_at)

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
        <button
          onClick={() => router.back()}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-lg font-bold">
            <span className="font-medium text-amber-600">{oportunidad.codigo}·C</span>{' '}
            {oportunidad.descripcion || 'Sin descripcion'}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
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
        {/* Drive icon — visible y clicable cuando hay URL confirmada en servidor */}
        {oportunidad.carpeta_url && !carpetaEditing && (
          <button
            onClick={() => window.open(oportunidad.carpeta_url!, '_blank')}
            onContextMenu={e => { e.preventDefault(); setCarpetaEditing(true) }}
            onDoubleClick={() => setCarpetaEditing(true)}
            className="rounded-md p-1.5 text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/30"
            title="Abrir carpeta Drive (doble clic para editar)"
          >
            <FolderOpen className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Carpeta URL — visible si no hay URL en servidor, o si está editando */}
      {(!oportunidad.carpeta_url || carpetaEditing) && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="url"
            value={carpetaUrl}
            onChange={e => setCarpetaUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="flex-1 rounded-md border bg-background px-2 py-1 text-xs"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') {
                setCarpetaEditing(false)
                startTransition(async () => {
                  const res = await updateOportunidad(oportunidad.id, { carpeta_url: carpetaUrl.trim() || null })
                  if (res?.success) { toast.success('Carpeta guardada'); router.refresh() }
                  else { toast.error(res?.error ?? 'Error al guardar'); setCarpetaUrl(oportunidad.carpeta_url ?? '') }
                })
              }
              if (e.key === 'Escape') {
                setCarpetaEditing(false)
                setCarpetaUrl(oportunidad.carpeta_url ?? '')
              }
            }}
          />
          <button
            onClick={() => {
              setCarpetaEditing(false)
              startTransition(async () => {
                const res = await updateOportunidad(oportunidad.id, { carpeta_url: carpetaUrl.trim() || null })
                if (res?.success) { toast.success('Carpeta guardada'); router.refresh() }
                else { toast.error(res?.error ?? 'Error al guardar'); setCarpetaUrl(oportunidad.carpeta_url ?? '') }
              })
            }}
            className="rounded-md p-1 text-green-600 hover:bg-green-50"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setCarpetaEditing(false)
              setCarpetaUrl(oportunidad.carpeta_url ?? '')
            }}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Etapa progress bar */}
      {!isTerminal && etapaConfig && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">{etapaConfig.label}</span>
            <span className="text-xs font-semibold text-amber-600">{etapaConfig.probabilidad}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${etapaConfig.probabilidad}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground">
              {diasEnStage}d en esta etapa
            </span>
            {diasSinActividad >= 4 && (
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                diasSinActividad >= 8
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}>
                {diasSinActividad}d sin actividad
              </span>
            )}
          </div>
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

      {/* Responsable */}
      {staffList.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <User className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex flex-1 items-center justify-between min-w-0">
            <label className="text-xs text-muted-foreground shrink-0 mr-2">Responsable</label>
            <select
              value={responsableId}
              onChange={(e) => {
                const newVal = e.target.value
                setResponsableId(newVal)
                startTransition(async () => {
                  await updateOportunidad(oportunidad.id, { responsable_id: newVal || null })
                  toast.success('Responsable actualizado')
                })
              }}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm min-w-0"
            >
              <option value="">Sin asignar</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
        </div>
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
              const estado = c.estado as EstadoCotizacion
              const canDuplicate = estado !== 'borrador'

              const handleEstado = (e: React.MouseEvent, action: 'enviar' | 'aceptar' | 'rechazar') => {
                e.stopPropagation()
                startTransition(async () => {
                  // Special flow: accept → auto-win → create project
                  if (action === 'aceptar') {
                    const acceptRes = await aceptarCotizacion(c.id)
                    if (!acceptRes.success) {
                      toast.error((acceptRes as { error?: string }).error ?? 'Error')
                      return
                    }
                    toast.success('Cotización aceptada')

                    // Chain: auto-win the oportunidad
                    const winRes = await ganarOportunidad(oportunidad.id)
                    if (winRes.success) {
                      toast.success('Oportunidad ganada! Proyecto creado.')
                      if ((winRes as { proyectoId?: string }).proyectoId) {
                        router.push(`/proyectos/${(winRes as { proyectoId?: string }).proyectoId}`)
                        return
                      }
                    } else if ((winRes as { needsFiscal?: boolean }).needsFiscal) {
                      setShowFiscalGate(true)
                    } else {
                      toast.error(winRes.error)
                    }
                    router.refresh()
                    return
                  }

                  const fn = action === 'enviar' ? enviarCotizacion : rechazarCotizacion
                  const label = action === 'enviar' ? 'Enviada' : 'Rechazada'
                  const res = await fn(c.id)
                  if (res.success) {
                    toast.success(`Cotización ${label.toLowerCase()}`)
                    router.refresh()
                  } else {
                    toast.error(res.error ?? 'Error')
                  }
                })
              }

              return (
                <div
                  key={c.id}
                  className="rounded-md border transition-colors hover:bg-accent/50 cursor-pointer"
                  onClick={() => router.push(`/pipeline/${oportunidad.id}/cotizacion/${c.id}`)}
                >
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{c.codigo || c.consecutivo || 'Sin codigo'}</span>
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                            {c.modo === 'flash' ? 'Rápida' : 'Detallada'}
                          </span>
                        </div>
                        {c.valor_total !== null && (() => {
                          const descuento = Number(c.descuento_valor ?? 0)
                          const valorNeto = c.valor_total - descuento
                          return descuento > 0 ? (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              <span className="line-through opacity-60">{formatCOP(c.valor_total)}</span>{' '}
                              <span className="font-medium text-foreground">{formatCOP(valorNeto)}</span>
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground mt-0.5">{formatCOP(c.valor_total)}</p>
                          )
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {estadoConfig && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estadoConfig.chipClass}`}>
                          {estadoConfig.label}
                        </span>
                      )}

                      {/* State actions */}
                      {estado === 'borrador' && (
                        <button
                          onClick={(e) => handleEstado(e, 'enviar')}
                          disabled={isPending}
                          className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-950/30"
                          title="Enviar cotización"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {estado === 'enviada' && (
                        <>
                          <button
                            onClick={(e) => handleEstado(e, 'aceptar')}
                            disabled={isPending}
                            className="rounded-md p-1.5 text-green-600 hover:bg-green-50 disabled:opacity-50 dark:hover:bg-green-950/30"
                            title="Aceptar cotización"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => handleEstado(e, 'rechazar')}
                            disabled={isPending}
                            className="rounded-md p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
                            title="Rechazar cotización"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}

                      {/* Duplicate (only after sent) */}
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
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Campos custom + Labels */}
      <CustomFieldsSection
        entidad="oportunidad"
        entidadId={oportunidad.id}
        initialCustomData={(oportunidad.custom_data as Record<string, unknown> | null) ?? {}}
      />

      {/* Documentos VE — visible solo para oportunidades con linea_negocio = 've' */}
      {(oportunidad.custom_data as Record<string, unknown> | null)?.linea_negocio === 've' && (
        <VeDocumentosSection
          oportunidadId={oportunidad.id}
          vehiculoEnUpme={veVehiculoEnUpme}
          documentosActuales={veDocumentos}
          camposVehiculo={veCamposVehiculo}
        />
      )}

      {/* Actividad */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Actividad</h2>
        <ActivityLog entidadTipo="oportunidad" entidadId={oportunidad.id} staffList={staffList} />
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
