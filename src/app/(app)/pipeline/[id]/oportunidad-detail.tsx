'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Building2, User, ChevronRight, Flame, XCircle,
  Trophy, FileText, Plus, Clock, ShieldAlert, Copy, Send, Check, X,
  FolderOpen, ChevronDown, TrendingUp, TrendingDown, Banknote,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  moveOportunidad, perderOportunidad, ganarOportunidad, updateOportunidad,
} from '../actions-v2'
import { moveProyectoVe } from '@/lib/actions/ve-proyecto'
import type { EstadoVe } from '@/lib/actions/ve-proyecto'
import { duplicarCotizacion, enviarCotizacion, aceptarCotizacion, rechazarCotizacion } from './cotizaciones/actions-v2'
import { ETAPA_CONFIG, ETAPAS_ACTIVAS, RAZONES_PERDIDA, ESTADO_COTIZACION_CONFIG } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import type { EtapaPipeline, EstadoCotizacion } from '@/lib/pipeline/constants'
import type { WorkspaceStageWithProceso, ProyectoVinculado } from '../actions-v2'
import ActivityLog from '@/components/activity-log'
import CustomFieldsSection from '@/components/custom-fields-section'
import FiscalGateForm from './fiscal-gate-form'
import VeDocumentosSection from './ve-documentos-section'
import type { VeDocumentoState, CamposVehiculo } from '@/lib/actions/ve-documentos'

// ── Configuracion estados VE ──────────────────────────────────

const VE_ESTADOS_ORDEN: EstadoVe[] = [
  'por_inclusion', 'por_radicar', 'por_certificar', 'certificado', 'por_cobrar', 'cerrado',
]

const VE_ESTADO_CONFIG: Record<EstadoVe, { label: string; chipClass: string; dotClass: string }> = {
  por_inclusion:  { label: 'Por inclusión',  chipClass: 'bg-indigo-100 text-indigo-700',  dotClass: 'bg-indigo-400' },
  por_radicar:    { label: 'Por radicar',    chipClass: 'bg-amber-100 text-amber-700',    dotClass: 'bg-amber-400' },
  por_certificar: { label: 'Por certificar', chipClass: 'bg-purple-100 text-purple-700',  dotClass: 'bg-purple-400' },
  certificado:    { label: 'Certificado',    chipClass: 'bg-green-100 text-green-700',    dotClass: 'bg-green-400' },
  por_cobrar:     { label: 'Por cobrar',     chipClass: 'bg-blue-100 text-blue-700',      dotClass: 'bg-blue-400' },
  cerrado:        { label: 'Cerrado',        chipClass: 'bg-slate-100 text-slate-600',    dotClass: 'bg-slate-400' },
}

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
  stages?: WorkspaceStageWithProceso[]
  veDocumentos?: VeDocumentoState[]
  veVehiculoEnUpme?: boolean | null
  veCamposVehiculo?: CamposVehiculo | null
  proyectoVe?: ProyectoVinculado | null
}

export default function OportunidadDetail({
  oportunidad,
  cotizaciones,
  staffList,
  stages = [],
  veDocumentos = [],
  veVehiculoEnUpme = null,
  veCamposVehiculo = null,
  proyectoVe = null,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showLossModal, setShowLossModal] = useState(false)
  const [showFiscalGate, setShowFiscalGate] = useState(false)
  const [lossReason, setLossReason] = useState('')
  const [carpetaUrl, setCarpetaUrl] = useState(oportunidad.carpeta_url ?? '')
  const [carpetaEditing, setCarpetaEditing] = useState(false)
  const [responsableId, setResponsableId] = useState(oportunidad.responsable_id ?? '')
  const [resumenComercialAbierto, setResumenComercialAbierto] = useState(false)

  // ── Modo operativo VE ──────────────────────────────────────
  const modoOperativoVe = oportunidad.etapa === 'ganada' && proyectoVe != null
  const estadoVeActual = modoOperativoVe
    ? ((proyectoVe!.custom_data?.estado_ve as EstadoVe | undefined) ?? null)
    : null

  // Calcular estados VE aplicables (si vehiculo_en_upme = true, empezar desde por_radicar)
  const veEstadosAplicables: EstadoVe[] = (() => {
    if (!modoOperativoVe) return VE_ESTADOS_ORDEN
    const customData = oportunidad.custom_data as Record<string, unknown> | null
    const vehiculoEnUpme = customData?.vehiculo_en_upme
    if (vehiculoEnUpme === true) {
      return VE_ESTADOS_ORDEN.filter(e => e !== 'por_inclusion')
    }
    return VE_ESTADOS_ORDEN
  })()

  const veCurrentIdx = estadoVeActual ? veEstadosAplicables.indexOf(estadoVeActual) : -1
  const veNextEstado = veCurrentIdx !== -1 && veCurrentIdx < veEstadosAplicables.length - 1
    ? veEstadosAplicables[veCurrentIdx + 1]
    : null

  // Campos custom VE: base siempre excluida + condicionales según estado_ve
  const veExcludeSlugs: string[] = (() => {
    const base = [
      'link_cedula', 'link_factura', 'link_rut', 'link_soporte_pago_upme',
      'link_ficha_tecnica', 'link_cert_emisiones',
      'marca_vehiculo', 'linea_vehiculo', 'modelo_ano', 'tecnologia',
      'tipo_vehiculo', 'vehiculo_en_upme',
      'nombre_propietario', 'numero_identificacion',
      'regimen_tributario_cliente', 'tipo_persona_cliente',
      'telefono_propietario', 'municipio_propietario', 'correo_propietario', 'direccion_propietario',
      'numero_cus',
    ]
    // Ocultar campos operativos hasta que se alcance la etapa correspondiente
    const idx = estadoVeActual ? VE_ESTADOS_ORDEN.indexOf(estadoVeActual) : -1
    if (idx < VE_ESTADOS_ORDEN.indexOf('por_inclusion')) base.push('numero_radicado_inclusion')
    if (idx < VE_ESTADOS_ORDEN.indexOf('por_radicar')) base.push('numero_radicado_certificacion')
    if (idx < VE_ESTADOS_ORDEN.indexOf('por_certificar')) base.push('cert_upme_url')
    return base
  })()

  const handleAvanzarVe = () => {
    if (!veNextEstado || !proyectoVe) return
    startTransition(async () => {
      const res = await moveProyectoVe(proyectoVe.id, veNextEstado)
      if (res.success) {
        toast.success(`Avanzado a ${VE_ESTADO_CONFIG[veNextEstado].label}`)
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error al avanzar')
      }
    })
  }

  // Valor total de cotizaciones para el resumen comercial
  const valorTotalCotizaciones = cotizaciones.reduce((sum, c) => {
    const descuento = Number(c.descuento_valor ?? 0)
    return sum + (c.valor_total ?? 0) - descuento
  }, 0)

  // Build dynamic stage list from workspace_stages, falling back to hardcoded constants
  const etapasActivas: string[] = stages.length > 0
    ? stages.filter(s => !s.es_terminal && s.activo).sort((a, b) => a.orden - b.orden).map(s => s.slug)
    : (ETAPAS_ACTIVAS as string[])

  const getStageLabel = (slug: string): string => {
    const ws = stages.find(s => s.slug === slug)
    if (ws) return ws.nombre
    return ETAPA_CONFIG[slug as EtapaPipeline]?.label ?? slug
  }

  const etapa = oportunidad.etapa as EtapaPipeline
  // Use hardcoded config if available, else build minimal config from workspace stage
  const etapaConfig = ETAPA_CONFIG[etapa] ?? (() => {
    const ws = stages.find(s => s.slug === etapa)
    if (!ws) return undefined
    return { label: ws.nombre, probabilidad: 50, chipClass: 'bg-slate-100 text-slate-700', dotClass: 'bg-slate-400', order: ws.orden }
  })()
  const empresa = oportunidad.empresas as OportunidadRow['empresas']
  const contacto = oportunidad.contactos as OportunidadRow['contactos']
  const isTerminal = stages.length > 0
    ? (stages.find(s => s.slug === etapa)?.es_terminal ?? (etapa === 'ganada' || etapa === 'perdida'))
    : (etapa === 'ganada' || etapa === 'perdida')

  const calcDias = (fecha: string | null) => {
    if (!fecha) return 0
    return Math.floor((Date.now() - new Date(fecha).getTime()) / (1000 * 60 * 60 * 24))
  }
  const diasEnStage = calcDias(oportunidad.etapa_changed_at ?? oportunidad.ultima_accion_fecha)
  const diasSinActividad = calcDias(oportunidad.ultima_accion_fecha ?? oportunidad.created_at)

  const currentIdx = etapasActivas.indexOf(etapa as string)
  const nextEtapa = !isTerminal && currentIdx !== -1 && currentIdx < etapasActivas.length - 1
    ? etapasActivas[currentIdx + 1] as EtapaPipeline
    : null

  const handleAdvance = () => {
    if (!nextEtapa) return
    startTransition(async () => {
      const res = await moveOportunidad(oportunidad.id, nextEtapa)
      if (res.success) {
        toast.success(`Movida a ${getStageLabel(nextEtapa)}`)
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

      {/* ── Header (5 filas) ─────────────────────────────────── */}
      <div className="space-y-2.5">

        {/* Fila 1: nav */}
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors -ml-0.5"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Pipeline</span>
        </button>

        {/* Fila 2: titulo + accion principal */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-xs font-semibold text-amber-600">{oportunidad.codigo}·C</span>
              {modoOperativoVe && estadoVeActual ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${VE_ESTADO_CONFIG[estadoVeActual].chipClass}`}>
                  {VE_ESTADO_CONFIG[estadoVeActual].label}
                </span>
              ) : etapaConfig ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${etapaConfig.chipClass}`}>
                  {etapaConfig.label}
                </span>
              ) : null}
            </div>
            <h1 className="text-xl font-bold leading-tight">
              {oportunidad.descripcion || 'Sin descripcion'}
            </h1>
          </div>
          {/* CTA principal */}
          {!isTerminal && !modoOperativoVe && nextEtapa && (
            <button
              onClick={handleAdvance}
              disabled={isPending}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
              Avanzar
            </button>
          )}
          {!isTerminal && !modoOperativoVe && !nextEtapa && (
            <button
              onClick={handleWin}
              disabled={isPending}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Trophy className="h-4 w-4" />
              Ganar
            </button>
          )}
          {modoOperativoVe && veNextEstado && (
            <button
              onClick={handleAvanzarVe}
              disabled={isPending}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
              Avanzar
            </button>
          )}
        </div>

        {/* Fila 3: empresa + contacto + precio */}
        {(empresa || contacto || oportunidad.valor_estimado || proyectoVe?.presupuesto_total) && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
              {empresa && (
                <Link
                  href={`/directorio/empresa/${empresa.id}`}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors min-w-0"
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                  <span className="truncate">{empresa.nombre}</span>
                </Link>
              )}
              {empresa && contacto && <span className="text-muted-foreground/40 select-none">·</span>}
              {contacto && (
                <Link
                  href={`/directorio/contacto/${contacto.id}`}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors min-w-0"
                >
                  <User className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                  <span className="truncate">{contacto.nombre}</span>
                </Link>
              )}
            </div>
            {(oportunidad.valor_estimado || proyectoVe?.presupuesto_total) && (
              <span className={`text-base font-bold shrink-0 ${
                proyectoVe?.presupuesto_total ? 'text-foreground' : 'text-muted-foreground'
              }`}>
                {formatCOP(proyectoVe?.presupuesto_total ?? oportunidad.valor_estimado!)}
              </span>
            )}
          </div>
        )}

        {/* Fila 4: carpeta Drive */}
        {oportunidad.carpeta_url && !carpetaEditing ? (
          <button
            onClick={() => window.open(oportunidad.carpeta_url!, '_blank')}
            onContextMenu={e => { e.preventDefault(); setCarpetaEditing(true) }}
            onDoubleClick={() => setCarpetaEditing(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-amber-600 transition-colors"
            title="Abrir carpeta Drive (doble clic para editar)"
          >
            <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span>Carpeta Drive</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="url"
              value={carpetaUrl}
              onChange={e => setCarpetaUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
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
              className="rounded p-0.5 text-green-600 hover:bg-green-50"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={() => { setCarpetaEditing(false); setCarpetaUrl(oportunidad.carpeta_url ?? '') }}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Fila 5: progreso — comercial */}
        {!isTerminal && !modoOperativoVe && etapaConfig && (
          <div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${etapaConfig.probabilidad}%` }}
              />
            </div>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground">{diasEnStage}d en esta etapa</span>
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

        {/* Fila 5: progreso — operativo VE */}
        {modoOperativoVe && estadoVeActual && (
          <div>
            <div className="flex items-center gap-1">
              {veEstadosAplicables.map((estado, idx) => {
                const isPast = idx < veCurrentIdx
                const isCurrent = idx === veCurrentIdx
                const config = VE_ESTADO_CONFIG[estado]
                return (
                  <div key={estado} className="flex items-center gap-1 flex-1">
                    <div className="flex-1 flex flex-col items-center gap-1">
                      <div className={`h-1.5 w-full rounded-full transition-all ${
                        isPast ? 'bg-green-400' : isCurrent ? config.dotClass : 'bg-muted'
                      }`} />
                      <span className={`text-[8px] font-medium leading-tight text-center ${
                        isCurrent ? 'text-foreground' : 'text-muted-foreground'
                      }`}>
                        {config.label}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>

      {/* Acciones secundarias — solo cuando hay nextEtapa activo (comercial) */}
      {!isTerminal && !modoOperativoVe && nextEtapa && (
        <div className="flex gap-2">
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
      {/* Perder — cuando Ganar es el CTA principal (última etapa) */}
      {!isTerminal && !modoOperativoVe && !nextEtapa && (
        <button
          onClick={() => setShowLossModal(true)}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <XCircle className="h-4 w-4" />
          Perder
        </button>
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

      {/* Resumen comercial (acordeón colapsado en modo operativo VE) */}
      {modoOperativoVe ? (
        <div className="rounded-lg border overflow-hidden">
          <button
            onClick={() => setResumenComercialAbierto(v => !v)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Resumen comercial</span>
              {proyectoVe?.presupuesto_total && (
                <span className="text-sm font-semibold text-green-700">
                  {formatCOP(proyectoVe.presupuesto_total)}
                </span>
              )}
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${resumenComercialAbierto ? 'rotate-180' : ''}`} />
          </button>
          {resumenComercialAbierto && (
            <div className="border-t px-4 pb-4 pt-3 space-y-2">
              {cotizaciones.length === 0 ? (
                <p className="py-2 text-center text-xs text-muted-foreground">Sin cotizaciones</p>
              ) : (
                cotizaciones.map(c => {
                  const estadoConfig = ESTADO_COTIZACION_CONFIG[c.estado as EstadoCotizacion]
                  const descuento = Number(c.descuento_valor ?? 0)
                  const valorNeto = (c.valor_total ?? 0) - descuento
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-md border p-2.5 text-xs cursor-pointer hover:bg-accent/50"
                      onClick={() => router.push(`/pipeline/${oportunidad.id}/cotizacion/${c.id}`)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        <span className="font-medium truncate">{c.codigo || c.consecutivo || 'Sin codigo'}</span>
                        {estadoConfig && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${estadoConfig.chipClass}`}>
                            {estadoConfig.label}
                          </span>
                        )}
                      </div>
                      <span className="font-semibold shrink-0 ml-2">{formatCOP(valorNeto)}</span>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      ) : (
      /* Cotizaciones (modo comercial normal) */
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
      )}

      {/* ── Módulos financieros — solo en modo operativo VE ── */}
      {modoOperativoVe && proyectoVe && (
        <>
          {/* Resumen Flujo de Caja */}
          {proyectoVe.proyectoModules?.flujo_caja && proyectoVe.financiero && (
            <div className="rounded-lg border p-4 space-y-3">
              <h2 className="text-sm font-semibold">Flujo de caja</h2>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { label: 'Presupuesto', v: proyectoVe.financiero.presupuesto_total },
                  { label: 'Costo acumulado', v: proyectoVe.financiero.costo_acumulado },
                  { label: 'Facturado', v: proyectoVe.financiero.facturado },
                  { label: 'Cobrado', v: proyectoVe.financiero.cobrado },
                  { label: 'Cartera', v: (proyectoVe.financiero.facturado ?? 0) - (proyectoVe.financiero.cobrado ?? 0) },
                  { label: 'Por facturar', v: (proyectoVe.financiero.presupuesto_total ?? 0) - (proyectoVe.financiero.facturado ?? 0) },
                ] as { label: string; v: number | null }[]).map(({ label, v }) => (
                  <div key={label} className="rounded-lg border p-3">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold mt-0.5 tabular-nums">{formatCOP(v ?? 0)}</p>
                  </div>
                ))}
                <div className="col-span-2 rounded-lg border p-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {(proyectoVe.financiero.ganancia_actual ?? 0) >= 0
                      ? <TrendingUp className="h-4 w-4 text-green-600" />
                      : <TrendingDown className="h-4 w-4 text-red-600" />}
                    <span className="text-xs font-medium">Ganancia actual</span>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${(proyectoVe.financiero.ganancia_actual ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {(proyectoVe.financiero.ganancia_actual ?? 0) >= 0 ? '+' : ''}{formatCOP(proyectoVe.financiero.ganancia_actual ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Cobros VE */}
          {proyectoVe.proyectoModules?.detalle_ejecucion && proyectoVe.cobros.length > 0 && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Cobros</h2>
              </div>
              <div className="space-y-2">
                {proyectoVe.cobros.map(c => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        c.tipo_cobro === 'anticipo' ? 'bg-amber-100 text-amber-700' :
                        c.tipo_cobro === 'saldo'    ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {c.tipo_cobro === 'anticipo' ? 'Anticipo' : c.tipo_cobro === 'saldo' ? 'Saldo' : 'Cobro'}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">{c.notas ?? c.fecha}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        c.estado_causacion === 'PENDIENTE' ? 'bg-orange-100 text-orange-700' :
                        c.estado_causacion === 'APROBADO'  ? 'bg-green-100 text-green-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {c.estado_causacion === 'PENDIENTE' ? 'Pendiente' : c.estado_causacion === 'APROBADO' ? 'Aprobado' : c.estado_causacion}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatCOP(c.monto)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Campos custom + Labels */}
      <CustomFieldsSection
        entidad="oportunidad"
        entidadId={oportunidad.id}
        initialCustomData={(oportunidad.custom_data as Record<string, unknown> | null) ?? {}}
        excludeSlugs={
          (oportunidad.custom_data as Record<string, unknown> | null)?.linea_negocio === 've'
            ? veExcludeSlugs
            : undefined
        }
      />

      {/* Documentos VE — visible solo para oportunidades con linea_negocio = 've' */}
      {(oportunidad.custom_data as Record<string, unknown> | null)?.linea_negocio === 've' && (
        <VeDocumentosSection
          oportunidadId={oportunidad.id}
          etapaActual={oportunidad.etapa}
          vehiculoEnUpme={veVehiculoEnUpme}
          documentosActuales={veDocumentos}
          camposVehiculo={veCamposVehiculo}
        />
      )}

      {/* Actividad */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Actividad</h2>
        <ActivityLog
          entidadTipo="oportunidad"
          entidadId={oportunidad.id}
          staffList={staffList}
          oportunidadId={modoOperativoVe && proyectoVe ? proyectoVe.id : undefined}
        />
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
