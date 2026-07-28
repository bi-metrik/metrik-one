'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { FolderOpen, Pause, CheckCircle2, XCircle, Ban, User, Megaphone, Copy, Check, Plus, X, Search, Loader2, Clock, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { NegocioResumen } from './negocio-v2-actions'
import { agregarResponsable, quitarResponsable } from './negocio-v2-actions'
import { STAGE_BADGE_CLASSES, type WorkflowStage } from '@/components/workflow/types'

export type StaffAsignable = { id: string; full_name: string }

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v)

const fmtShort = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return fmt(v)
}

const STAGE_LABELS: Record<string, string> = {
  venta: 'VENTA',
  ejecucion: 'EJECUCION',
  cobro: 'COBRO',
}

const CIERRE_ICONS = {
  exitoso: CheckCircle2,
  perdido: XCircle,
  cancelado: Ban,
} as const

const CIERRE_COLORS = {
  exitoso: 'text-[#10B981]',
  perdido: 'text-[#6B7280]',
  cancelado: 'text-[#EF4444]',
} as const

const CIERRE_LABELS = {
  exitoso: 'Exitoso',
  perdido: 'Perdido',
  cancelado: 'Cancelado',
} as const

/**
 * Etiqueta compacta del atraso: horas hábiles si es menos de un día hábil,
 * días hábiles a partir de ahí (24h = 1 día hábil, misma equivalencia que el SLA).
 */
function formatAtraso(horas: number): string {
  if (horas < 24) return `${Math.max(1, Math.round(horas))}h`
  return `${Math.floor(horas / 24)}d`
}

function formatDateShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function openFolder(url: string, e: React.MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * La tarjeta entera es un <Link>: TODO control interactivo dentro de ella debe
 * frenar la navegación antes de hacer lo suyo. Helper único para no olvidarlo.
 */
function frenarNavegacion(e: React.MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
}

/**
 * Responsables del negocio, asignables desde el listado (Daniela/Deisy pedían no
 * tener que entrar al detalle para repartir trabajo).
 *
 * `canAsignar` refleja el gate de rol (owner/admin/supervisor) que las server
 * actions ya validan server-side; aquí solo evita mostrar un control que iba a
 * fallar. Sin permiso, se conserva la vista de solo lectura de siempre.
 */
function ResponsablesInline({
  negocioId,
  responsables,
  staffList,
  canAsignar,
}: {
  negocioId: string
  responsables: Array<{ id: string; full_name: string }>
  staffList: StaffAsignable[]
  canAsignar: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [isPending, startTransition] = useTransition()
  const popoverRef = useRef<HTMLDivElement>(null)

  // Cerrar al hacer click fuera del selector.
  useEffect(() => {
    if (!open) return
    function handleClick(ev: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const asignados = new Set(responsables.map((r) => r.id))
  const term = search.trim().toLowerCase()
  const disponibles = staffList.filter(
    (s) => !asignados.has(s.id) && (!term || s.full_name.toLowerCase().includes(term)),
  )

  const handleToggleOpen = (e: React.MouseEvent) => {
    frenarNavegacion(e)
    setSearch('')
    setOpen((v) => !v)
  }

  const handleAdd = (e: React.MouseEvent, staffId: string, nombre: string) => {
    frenarNavegacion(e)
    setOpen(false)
    setSearch('')
    startTransition(async () => {
      const res = await agregarResponsable(negocioId, staffId)
      if (res.error) toast.error(res.error)
      else toast.success(`Responsable agregado: ${nombre}`)
    })
  }

  const handleRemove = (e: React.MouseEvent, staffId: string) => {
    frenarNavegacion(e)
    startTransition(async () => {
      const res = await quitarResponsable(negocioId, staffId)
      if (res.error) toast.error(res.error)
      else toast.success('Responsable removido')
    })
  }

  return (
    <div className="relative mt-1.5 flex flex-wrap items-center gap-1" ref={popoverRef}>
      <User className="h-3 w-3 shrink-0 text-[#6B7280]/70" />
      {responsables.map((r) => (
        <span
          key={r.id}
          className="inline-flex max-w-[140px] items-center gap-1 rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[10px] font-medium text-[#6B7280]"
          title={r.full_name}
        >
          <span className="truncate">{r.full_name}</span>
          {canAsignar && (
            <button
              type="button"
              onClick={(e) => handleRemove(e, r.id)}
              disabled={isPending}
              className="-mr-0.5 shrink-0 rounded-full p-0.5 transition-colors hover:bg-white hover:text-[#1A1A1A] disabled:opacity-60"
              title={`Quitar a ${r.full_name}`}
              aria-label={`Quitar a ${r.full_name}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}

      {responsables.length === 0 && !canAsignar && (
        <span className="text-[10px] italic text-[#6B7280]/60">Sin responsable</span>
      )}

      {canAsignar && (
        <button
          type="button"
          onClick={handleToggleOpen}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-dashed border-[#E5E7EB] px-2 py-0.5 text-[10px] font-medium text-[#6B7280] transition-colors hover:border-[#10B981] hover:text-[#10B981] disabled:opacity-60"
          aria-label="Asignar responsable"
        >
          {isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
          {responsables.length === 0 ? 'Asignar' : ''}
        </button>
      )}

      {open && (
        <div
          onClick={frenarNavegacion}
          className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-lg"
        >
          <div className="relative border-b border-[#E5E7EB]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#6B7280]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar persona…"
              aria-label="Buscar persona"
              className="w-full py-1.5 pl-7 pr-2 text-xs text-[#1A1A1A] placeholder:text-[#6B7280] focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {disponibles.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-[#6B7280]">Sin personas disponibles</p>
            ) : (
              disponibles.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={(e) => handleAdd(e, s.id, s.full_name)}
                  className="block w-full truncate px-3 py-1.5 text-left text-xs text-[#1A1A1A] transition-colors hover:bg-[#F5F4F2]"
                >
                  {s.full_name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function NegocioCard({
  negocio,
  staffList = [],
  canAsignar = false,
}: {
  negocio: NegocioResumen
  staffList?: StaffAsignable[]
  canAsignar?: boolean
}) {
  const precio = negocio.precio_aprobado ?? negocio.precio_estimado

  // Copiar el radicado al portapapeles (para pegarlo rápido en la plataforma UPME).
  // La tarjeta es un Link; frenamos la navegación al tocar el botón.
  const [radicadoCopiado, setRadicadoCopiado] = useState(false)
  const handleCopiarRadicado = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!negocio.radicado) return
    try {
      await navigator.clipboard.writeText(negocio.radicado)
      setRadicadoCopiado(true)
      toast.success('Radicado copiado')
      setTimeout(() => setRadicadoCopiado(false), 1500)
    } catch {
      toast.error('No se pudo copiar el radicado')
    }
  }

  const isCerrado = negocio.cierre_motivo !== null
  const motivoCierre = negocio.cierre_motivo

  const stageKey = negocio.stage_actual as WorkflowStage | null
  const pillClass = isCerrado
    ? 'bg-[#F5F4F2] text-[#6B7280]'
    : stageKey && stageKey in STAGE_BADGE_CLASSES
      ? STAGE_BADGE_CLASSES[stageKey]
      : 'bg-[#F5F4F2] text-[#6B7280]'

  const stageLabel = isCerrado
    ? motivoCierre
      ? CIERRE_LABELS[motivoCierre].toUpperCase()
      : 'CERRADO'
    : (STAGE_LABELS[negocio.stage_actual ?? ''] ?? negocio.stage_actual?.toUpperCase())

  const CierreIcon = motivoCierre ? CIERRE_ICONS[motivoCierre] : null
  const cierreColor = motivoCierre ? CIERRE_COLORS[motivoCierre] : ''

  // Barra de ejecucion: solo en stages activos con presupuesto
  const showEjecucion =
    !isCerrado && negocio.stage_actual !== 'venta' && precio && precio > 0
  const pctEjecutado = showEjecucion ? Math.round((negocio.costos_ejecutados / precio) * 100) : 0
  const barColor =
    pctEjecutado > 90
      ? 'bg-[#EF4444]'
      : pctEjecutado > 70
        ? 'bg-[#F59E0B]'
        : 'bg-[#10B981]'

  return (
    <Link
      href={`/negocios/${negocio.id}`}
      className="block rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Fila 1: estado actual — [STAGE] › [E{N} Etapa] */}
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${pillClass}`}
            >
              {CierreIcon && <CierreIcon className={`h-2.5 w-2.5 ${cierreColor}`} />}
              {stageLabel}
            </span>
            {negocio.etapa_nombre && !isCerrado && (
              <>
                <span className="text-[11px] text-[#6B7280]/40">›</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${pillClass}`}
                >
                  {negocio.etapa_numero !== null && (
                    <span className="mr-1 font-mono opacity-70">E{negocio.etapa_numero}</span>
                  )}
                  <span className="truncate uppercase">{negocio.etapa_nombre}</span>
                </span>
              </>
            )}
            {negocio.pausado && !isCerrado && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F59E0B]/10 px-2 py-0.5 text-[10px] font-medium text-[#F59E0B]">
                <Pause className="h-2.5 w-2.5" />
                Pausado
              </span>
            )}
            {/* Atraso de etapa. Solo se pinta cuando la etapa TIENE sla_horas
                configurado y ya se pasó. Sin SLA: silencio (ni "a tiempo" ni
                "sin SLA") — hoy la mayoría de etapas no tiene SLA y un badge
                permanente sería ruido, no señal. */}
            {!isCerrado && negocio.sla_exceso_horas !== null && negocio.sla_exceso_horas > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-[#EF4444]/10 px-2 py-0.5 text-[10px] font-medium text-[#EF4444]"
                title={`Lleva ${Math.round(negocio.horas_habiles_en_etapa ?? 0)}h hábiles en esta etapa; el SLA es de ${negocio.etapa_sla_horas}h`}
              >
                <Clock className="h-2.5 w-2.5" />
                {formatAtraso(negocio.sla_exceso_horas)} de atraso
              </span>
            )}
            {negocio.es_meta_lead && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-[#1877F2]/10 px-2 py-0.5 text-[10px] font-medium text-[#1877F2]"
                title="Lead recibido automáticamente desde Meta (Facebook)"
              >
                <Megaphone className="h-2.5 w-2.5" />
                Meta
              </span>
            )}
            {/* Reproceso: relleno sólido, no tinte suave como los demás. Un caso
                reprocesado tiene un cliente esperando algo que ya creía resuelto,
                y debe saltar a la vista en una lista larga. */}
            {negocio.reproceso && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-[#DC2626] px-2 py-0.5 text-[10px] font-semibold text-white"
                title={
                  `Reproceso ${negocio.reproceso.ciclo}` +
                  (negocio.reproceso.etapa_retorno ? ` — devuelto a ${negocio.reproceso.etapa_retorno}` : '') +
                  '. Prioridad máxima.'
                }
              >
                <RotateCcw className="h-2.5 w-2.5" />
                Reproceso {negocio.reproceso.ciclo > 1 ? negocio.reproceso.ciclo : ''}
              </span>
            )}
          </div>
          {/* Fila 2: contexto — L{N} Linea */}
          {negocio.linea_nombre && (
            <p className="mb-0.5 truncate text-[11px] text-[#6B7280]">
              {negocio.linea_numero !== null && (
                <span className="mr-1 font-mono text-[#6B7280]/70">L{negocio.linea_numero}</span>
              )}
              {negocio.linea_nombre}
            </p>
          )}
          <p className="text-sm font-semibold leading-tight text-[#1A1A1A]">
            {negocio.codigo && (
              <span className="shrink-0 font-mono">{negocio.codigo}{' — '}</span>
            )}
            <span>{negocio.nombre}</span>
            {negocio.cedula && (
              <span className="ml-1.5 font-mono text-[11px] font-normal text-[#6B7280]">
                CC {negocio.cedula}
              </span>
            )}
          </p>
          {negocio.vehiculo_label || negocio.seccional_label ? (
            /* Variante config-driven (ej. SOENA): vehículo (izq) + seccional DIAN (der).
               El nombre del cliente ya va en la línea de título (código — nombre). */
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#1A1A1A]">
                {negocio.vehiculo_label ?? '—'}
              </span>
              {negocio.seccional_label && (
                <span className="shrink-0 truncate text-[10px] text-[#6B7280]" title={negocio.seccional_label}>
                  {negocio.seccional_label}
                </span>
              )}
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-[#6B7280]">
              {negocio.empresa_nombre ?? negocio.contacto_nombre ?? '—'}
            </p>
          )}
          {/* Radicado de certificación (config-driven, ej. SOENA) + copiar al portapapeles */}
          {negocio.radicado && (
            <div className="mt-0.5 flex items-center gap-1">
              <span className="truncate font-mono text-[11px] text-[#6B7280]" title={`Radicado: ${negocio.radicado}`}>
                Rad. {negocio.radicado}
              </span>
              <button
                type="button"
                onClick={handleCopiarRadicado}
                className="shrink-0 rounded p-0.5 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#10B981]"
                title="Copiar radicado"
                aria-label="Copiar radicado"
              >
                {radicadoCopiado
                  ? <Check className="h-3 w-3 text-[#10B981]" />
                  : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )}
          {/* Responsables asignados (asignables inline si el rol lo permite) */}
          <ResponsablesInline
            negocioId={negocio.id}
            responsables={negocio.responsables}
            staffList={staffList}
            canAsignar={canAsignar}
          />
          {isCerrado && negocio.closed_at && (
            <p className="mt-1 text-[10px] text-[#6B7280]">
              Cerrado {formatDateShort(negocio.closed_at)}
              {negocio.razon_cierre && (
                <>
                  {' · '}
                  <span className="italic">
                    {negocio.razon_cierre.length > 60
                      ? `${negocio.razon_cierre.slice(0, 60)}…`
                      : negocio.razon_cierre}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <div className="flex items-center gap-1.5">
            {negocio.carpeta_url && (
              <button
                type="button"
                onClick={(e) => openFolder(negocio.carpeta_url!, e)}
                className="rounded p-0.5 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A]"
                aria-label="Abrir carpeta Drive"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            )}
            {precio !== null && precio !== undefined && (
              <p className="text-sm font-bold tabular-nums text-[#1A1A1A]">
                {fmt(precio)}
              </p>
            )}
          </div>
          {negocio.precio_aprobado && !isCerrado && (
            <span className="text-[9px] text-[#6B7280]/70">aprobado</span>
          )}
        </div>
      </div>

      {/* Barra de ejecucion vs presupuesto */}
      {showEjecucion && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-[#6B7280]">
              {fmtShort(negocio.costos_ejecutados)} ejecutado
            </span>
            <span
              className={`text-[10px] font-semibold tabular-nums ${
                pctEjecutado > 90
                  ? 'text-[#EF4444]'
                  : pctEjecutado > 70
                    ? 'text-[#F59E0B]'
                    : 'text-[#10B981]'
              }`}
            >
              {pctEjecutado}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(pctEjecutado, 100)}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  )
}
