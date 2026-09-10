'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { CardLink } from '@/components/card-link'
import { History, FolderOpen, Pause, CheckCircle2, XCircle, Ban, User, Megaphone, Copy, Check, Plus, X, Search, Loader2, Clock, RotateCcw, Tag, FileCheck, AlertTriangle, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import type { NegocioResumen } from './negocio-v2-actions'
import { agregarResponsable, quitarResponsable } from './negocio-v2-actions'
import { detalleAsignacion } from '@/lib/negocios/responsable-copy'
import { agregarMarcaNegocio, quitarMarcaNegocio } from './marcas-actions'
import { MARCAS_CONDICION, type MarcaCondicion } from '@/lib/negocios/constants'
import { origenNegocioConfig } from '@/lib/catalogos/constants'
import { STAGE_BADGE_CLASSES, type WorkflowStage } from '@/components/workflow/types'
import { formatBogotaFechaCorta } from '@/lib/dates/bogota'
import { STAGE_LABEL_UPPER } from '@/lib/negocios/stage-label'
import { fechaHoraEnLetras, partesFechaHora } from '@/lib/negocios/fecha-hora-campo'
import { textoAtencionCita } from '@/lib/negocios/seguimiento-citas'
import { textoChipDesenlace, type DesenlaceMarcado } from '@/lib/negocios/desenlace-retorno'
import { motivoCierreDeEstado } from '@/lib/negocios/motivo-cierre'

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

const STAGE_LABELS = STAGE_LABEL_UPPER

const CIERRE_ICONS = {
  exitoso: CheckCircle2,
  perdido: XCircle,
  cancelado: Ban,
} as const

const CIERRE_COLORS = {
  exitoso: 'text-acento',
  perdido: 'text-tinta-suave',
  cancelado: 'text-alerta',
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
  return formatBogotaFechaCorta(iso) ?? ''
}

/**
 * El tooltip del chip de desenlace: cuántas veces, cuándo fue la última y con qué
 * referencia. La fecha y el radicado son lo que permite ubicar el ciclo sin abrir el
 * negocio; el chip solo dice que pasó.
 */
function tituloDesenlace(d: DesenlaceMarcado): string {
  const veces = d.conteo > 1 ? `${d.conteo} veces` : '1 vez'
  const cuando = formatDateShort(d.ultimo_at || null)
  const ref = d.ultima_referencia ? ` — último radicado ${d.ultima_referencia}` : ''
  return `${d.chip}: ${veces}${cuando ? `, la última el ${cuando}` : ''}${ref}.`
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
      else toast.success(`Responsable agregado: ${nombre}`, { description: detalleAsignacion(res) })
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
      <User className="h-3 w-3 shrink-0 text-tinta-suave/70" />
      {responsables.map((r) => (
        <span
          key={r.id}
          className="inline-flex max-w-[140px] items-center gap-1 rounded-full bg-papel px-2 py-0.5 text-[10px] font-medium text-tinta-suave"
          title={r.full_name}
        >
          <span className="truncate">{r.full_name}</span>
          {canAsignar && (
            <button
              type="button"
              onClick={(e) => handleRemove(e, r.id)}
              disabled={isPending}
              className="-mr-0.5 shrink-0 rounded-full p-0.5 transition-colors hover:bg-white hover:text-tinta disabled:opacity-60"
              title={`Quitar a ${r.full_name}`}
              aria-label={`Quitar a ${r.full_name}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}

      {responsables.length === 0 && !canAsignar && (
        <span className="text-[10px] italic text-tinta-suave/60">Sin responsable</span>
      )}

      {canAsignar && (
        <button
          type="button"
          onClick={handleToggleOpen}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-dashed border-[#E5E7EB] px-2 py-0.5 text-[10px] font-medium text-tinta-suave transition-colors hover:border-acento hover:text-acento disabled:opacity-60"
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
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-tinta-suave" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar persona…"
              aria-label="Buscar persona"
              className="w-full py-1.5 pl-7 pr-2 text-xs text-tinta placeholder:text-tinta-suave focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {disponibles.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-tinta-suave">Sin personas disponibles</p>
            ) : (
              disponibles.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={(e) => handleAdd(e, s.id, s.full_name)}
                  className="block w-full truncate px-3 py-1.5 text-left text-xs text-tinta transition-colors hover:bg-papel"
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

/**
 * Marcas de condición económica (descuento, sin honorario, otra), editables
 * desde el listado. Mismo patrón que ResponsablesInline: la tarjeta es un Link,
 * así que todo control frena la navegación antes de actuar.
 *
 * `canMarcar` refleja el guard de rol que ya valida el server (owner/admin/
 * supervisor); aquí solo evita mostrar un control que iba a fallar. Sin permiso
 * las marcas se ven, pero no se tocan.
 */
function MarcasInline({
  negocioId,
  marcas,
  canMarcar,
}: {
  negocioId: string
  marcas: MarcaCondicion[]
  canMarcar: boolean
}) {
  const [open, setOpen] = useState(false)
  const [nota, setNota] = useState('')
  const [isPending, startTransition] = useTransition()
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(ev: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Sin marcas y sin permiso no hay nada que mostrar: la fila desaparece en vez
  // de ocupar espacio con un "sin marcas" que no aporta.
  if (marcas.length === 0 && !canMarcar) return null

  const puestas = new Set(marcas.map((m) => m.tipo))
  const disponibles = MARCAS_CONDICION.filter((m) => !puestas.has(m.value))

  const handleToggleOpen = (e: React.MouseEvent) => {
    frenarNavegacion(e)
    setNota('')
    setOpen((v) => !v)
  }

  const handleAdd = (e: React.MouseEvent, tipo: string, label: string) => {
    frenarNavegacion(e)
    const notaFinal = nota.trim()
    setOpen(false)
    setNota('')
    startTransition(async () => {
      const res = await agregarMarcaNegocio(negocioId, tipo, notaFinal || undefined)
      if (res.error) toast.error(res.error)
      else toast.success(`Marcado: ${label}`)
    })
  }

  const handleRemove = (e: React.MouseEvent, tipo: string) => {
    frenarNavegacion(e)
    startTransition(async () => {
      const res = await quitarMarcaNegocio(negocioId, tipo)
      if (res.error) toast.error(res.error)
      else toast.success('Marca quitada')
    })
  }

  return (
    <div className="relative mt-1.5 flex flex-wrap items-center gap-1" ref={popoverRef}>
      <Tag className="h-3 w-3 shrink-0 text-tinta-suave/70" />
      {marcas.map((m) => {
        const cfg = MARCAS_CONDICION.find((x) => x.value === m.tipo)
        const detalle = [
          m.nota,
          m.marcado_por_nombre ? `Marcó ${m.marcado_por_nombre}` : null,
          m.marcado_en ? formatDateShort(m.marcado_en) : null,
        ].filter(Boolean).join(' · ')
        return (
          <span
            key={m.tipo}
            className={`inline-flex max-w-[180px] items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg?.chipClass ?? 'bg-papel text-tinta-suave'}`}
            title={detalle || cfg?.label}
          >
            <span className="truncate">
              {cfg?.label ?? m.tipo}
              {m.nota ? `: ${m.nota}` : ''}
            </span>
            {canMarcar && (
              <button
                type="button"
                onClick={(e) => handleRemove(e, m.tipo)}
                disabled={isPending}
                className="-mr-0.5 shrink-0 rounded-full p-0.5 transition-colors hover:bg-white disabled:opacity-60"
                title={`Quitar ${cfg?.label ?? m.tipo}`}
                aria-label={`Quitar ${cfg?.label ?? m.tipo}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        )
      })}

      {canMarcar && disponibles.length > 0 && (
        <button
          type="button"
          onClick={handleToggleOpen}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-dashed border-[#E5E7EB] px-2 py-0.5 text-[10px] font-medium text-tinta-suave transition-colors hover:border-advertencia hover:text-[#B45309] disabled:opacity-60"
          aria-label="Marcar condicion economica"
        >
          {isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
          {marcas.length === 0 ? 'Marcar condición' : ''}
        </button>
      )}

      {open && (
        <div
          onClick={frenarNavegacion}
          className="absolute left-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-lg"
        >
          <div className="border-b border-[#E5E7EB] p-2">
            <input
              type="text"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Detalle (opcional): 20% por volumen"
              aria-label="Detalle de la marca"
              maxLength={120}
              className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-xs text-tinta placeholder:text-tinta-suave focus:border-tinta/30 focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {disponibles.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={(e) => handleAdd(e, m.value, m.label)}
                className="block w-full truncate px-3 py-1.5 text-left text-xs text-tinta transition-colors hover:bg-papel"
              >
                {m.label}
              </button>
            ))}
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
  canMarcar = false,
  mostrarLlegada = false,
}: {
  negocio: NegocioResumen
  staffList?: StaffAsignable[]
  canAsignar?: boolean
  /** Rol gerencial: habilita poner/quitar marcas de condición desde la lista. */
  canMarcar?: boolean
  /**
   * Pinta desde cuándo el negocio está en su etapa.
   *
   * Lo pide la lista SOLO cuando NO está agrupada por día de llegada: con los
   * encabezados de grupo el dato ya está arriba y repetirlo en cada tarjeta es
   * ruido. Cuando la lista se ordena por atraso, en cambio, la fecha no aparece
   * en ningún otro lado.
   */
  mostrarLlegada?: boolean
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

  /**
   * Que un negocio salió del proceso lo dice su `estado`, no `cierre_motivo` — esa columna
   * está muerta y por qué lo está se explica en `motivo-cierre.ts`.
   *
   * Las dos preguntas son distintas y por eso son dos líneas:
   *   - `isCerrado`: ¿salió del proceso? Cualquier estado que no sea `abierto`. Con el
   *     criterio viejo (`cierre_motivo !== null`) daba **false en todo cierre real**, así
   *     que la tarjeta de un cerrado se pintaba con su pill de etapa, con la fecha de
   *     llegada y sin la de cierre: indistinguible de uno abierto.
   *   - `motivoCierre`: ¿cómo terminó? Solo sirve para ROTULAR, y su mapa es una lista
   *     cerrada de tres estados. Sin él el rótulo cae a "CERRADO", que es cierto igual —
   *     es lo que le toca a un `estado` que no reconocemos (hay 2 en `activo` en la base).
   */
  const isCerrado = negocio.estado !== null && negocio.estado !== 'abierto'
  const motivoCierre = motivoCierreDeEstado(negocio.estado)

  // Badge de origen. `es_meta_lead` sigue siendo el respaldo mientras el backfill
  // de la columna no esté aplicado: un negocio marcado por la integración de Meta
  // no debe perder su señal en la tarjeta por un tema de orden de despliegue.
  const origenValue = negocio.origen ?? (negocio.es_meta_lead ? 'meta' : null)
  const origenCfg = origenNegocioConfig(origenValue)
  const origenBadge = origenValue
    ? {
        value: origenValue,
        // Con alianza el badge nombra al aliado: "de dónde vino" sin la
        // contraparte concreta no le sirve a nadie.
        label: negocio.aliado_nombre
          ? `${origenCfg?.label ?? origenValue}: ${negocio.aliado_nombre}`
          : (origenCfg?.label ?? origenValue),
        chipClass: origenCfg?.chipClass ?? 'bg-papel text-tinta-suave',
        title: `Origen: ${origenCfg?.label ?? origenValue}${negocio.aliado_nombre ? ` — ${negocio.aliado_nombre}` : ''}`,
      }
    : null

  const stageKey = negocio.stage_actual as WorkflowStage | null
  const pillClass = isCerrado
    ? 'bg-papel text-tinta-suave'
    : stageKey && stageKey in STAGE_BADGE_CLASSES
      ? STAGE_BADGE_CLASSES[stageKey]
      : 'bg-papel text-tinta-suave'

  const stageLabel = isCerrado
    ? motivoCierre
      ? CIERRE_LABELS[motivoCierre].toUpperCase()
      : 'CERRADO'
    : (STAGE_LABELS[negocio.stage_actual ?? ''] ?? negocio.stage_actual?.toUpperCase())

  // ── Cita en la DIAN ────────────────────────────────────────────────────────
  // El valor es tiempo CIVIL de Bogotá ('2026-09-26' o '2026-09-26T07:00'), no un
  // instante: se lee con los helpers del campo, nunca con `new Date()`.
  const citaPartes = partesFechaHora(negocio.fecha_cita)
  const citaChip = citaPartes.dia
    ? // 'es-CO' devuelve "26 de sept" por el patrón CLDR, y ese "de" no se quita
      // con opciones de formato. En un chip corto solo estorba, sobre todo pegado
      // a la hora: "Cita 26 de sept · 09:30". Mismo aseo que hace `etiquetaDia`.
      `${(formatBogotaFechaCorta(citaPartes.dia) ?? citaPartes.dia).replace(/ de /g, ' ')}${
        citaPartes.hora ? ` · ${citaPartes.hora}` : ''
      }`
    : null
  // La marca roja se pinta en CUALQUIER orden de la lista, no solo dentro de la
  // vista de citas: lo que se pidió es atención inmediata, no una pestaña donde
  // haya que entrar. La calcula el servidor porque depende del reloj.
  const atencion = !isCerrado ? negocio.atencion_cita : null

  const CierreIcon = motivoCierre ? CIERRE_ICONS[motivoCierre] : null
  const cierreColor = motivoCierre ? CIERRE_COLORS[motivoCierre] : ''

  // Barra de ejecucion: solo en stages activos con presupuesto
  const showEjecucion =
    !isCerrado && negocio.stage_actual !== 'venta' && precio && precio > 0
  const pctEjecutado = showEjecucion ? Math.round((negocio.costos_ejecutados / precio) * 100) : 0
  const barColor =
    pctEjecutado > 90
      ? 'bg-alerta'
      : pctEjecutado > 70
        ? 'bg-advertencia'
        : 'bg-acento'

  return (
    <CardLink
      href={`/negocios/${negocio.id}`}
      className="block rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Atención inmediata: falta documentación y la cita está encima. Va ARRIBA
          de todo y ocupa su propia línea — como chip suelto se perdería entre los
          otros badges, que es exactamente el problema que esta marca viene a
          resolver (los avisos por correo ya nadie los abre). */}
      {atencion && (
        <div
          className="mb-2 flex items-center gap-1.5 rounded-lg bg-alerta px-2.5 py-1.5 text-[11px] font-semibold text-white"
          title={`${textoAtencionCita(atencion)}. Cita: ${fechaHoraEnLetras(negocio.fecha_cita) || 'sin fecha'}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{textoAtencionCita(atencion)}</span>
        </div>
      )}
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
                <span className="text-[11px] text-tinta-suave/40">›</span>
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
            {mostrarLlegada && !isCerrado && negocio.etapa_cambiada_at && (
              <span
                className="text-[10px] text-tinta-suave"
                title={`Está en esta etapa desde el ${formatDateShort(negocio.etapa_cambiada_at)}`}
              >
                aquí desde {formatDateShort(negocio.etapa_cambiada_at)}
              </span>
            )}
            {negocio.pausado && !isCerrado && (
              <span className="inline-flex items-center gap-1 rounded-full bg-advertencia/10 px-2 py-0.5 text-[10px] font-medium text-advertencia">
                <Pause className="h-2.5 w-2.5" />
                Pausado
              </span>
            )}
            {/* Fecha de la cita en la DIAN. Se lee sin abrir el negocio porque es
                lo que ordena el trabajo del día; la hora solo aparece cuando está
                registrada (los valores heredados de solo día no la tienen y no se
                les inventa una). */}
            {citaChip && !isCerrado && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-papel px-2 py-0.5 text-[10px] font-medium text-tinta"
                title={`Cita en la DIAN: ${fechaHoraEnLetras(negocio.fecha_cita)}`}
              >
                <CalendarClock className="h-2.5 w-2.5" />
                Cita {citaChip}
              </span>
            )}
            {/* Llegó al punto donde se pregunta la fecha de la cita y no la tiene:
                el cliente agendó y nadie reportó la fecha. Es el caso que se
                pierde, así que se nombra en la tarjeta y no solo en el encabezado
                del grupo (que solo existe en el orden por cita). */}
            {!citaChip && negocio.cita_pendiente && !isCerrado && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-advertencia/10 px-2 py-0.5 text-[10px] font-medium text-advertencia"
                title="El bloque de la cita ya está abierto y sigue sin fecha: falta que el cliente reporte cuándo se la asignó la DIAN."
              >
                <CalendarClock className="h-2.5 w-2.5" />
                Sin fecha de cita
              </span>
            )}
            {/* Atraso de etapa. Solo se pinta cuando la etapa TIENE sla_horas
                configurado y ya se pasó. Sin SLA: silencio (ni "a tiempo" ni
                "sin SLA") — hoy la mayoría de etapas no tiene SLA y un badge
                permanente sería ruido, no señal. */}
            {!isCerrado && negocio.sla_exceso_horas !== null && negocio.sla_exceso_horas > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-alerta/10 px-2 py-0.5 text-[10px] font-medium text-alerta"
                title={`Lleva ${Math.round(negocio.horas_habiles_en_etapa ?? 0)}h hábiles en esta etapa; el SLA es de ${negocio.etapa_sla_horas}h`}
              >
                <Clock className="h-2.5 w-2.5" />
                {formatAtraso(negocio.sla_exceso_horas)} de atraso
              </span>
            )}
            {/* Origen del negocio. Absorbe el antiguo badge "Meta": un negocio
                de Meta ahora es simplemente origen = meta, con su mismo color e
                ícono. Un solo badge para no repetir la misma información. */}
            {origenBadge && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${origenBadge.chipClass}`}
                title={origenBadge.title}
              >
                {origenBadge.value === 'meta' && <Megaphone className="h-2.5 w-2.5" />}
                {origenBadge.label}
              </span>
            )}
            {/* Servicio contratado (config-driven, ej. SOENA: completo / solo IVA /
                solo certificado UPME). Cambia el trabajo que hay que hacer y por
                dónde va el caso, así que se lee sin abrir el negocio. Un tinte
                único para los tres: distingue el eje "servicio" de los demás
                badges; el texto distingue el valor. Sin dato, no se pinta nada. */}
            {negocio.servicio_label && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-medium text-[#4338CA]"
                title={`Servicio contratado: ${negocio.servicio_label}`}
              >
                <FileCheck className="h-2.5 w-2.5" />
                {negocio.servicio_label}
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
            {/* Desenlaces que devolvieron el caso (SOENA: PQR rechazado por la DIAN).
                Tinte suave a propósito, NO relleno sólido como el reproceso: un rechazo
                de la DIAN es historia del caso, no una alarma con reloj — el rojo está
                reservado para la cita a menos de 36 h sin documentación. El conteo solo
                aparece a partir del segundo (ver `textoChipDesenlace`). */}
            {negocio.desenlaces.map((d) => (
              <span
                key={d.clave}
                className="inline-flex items-center gap-1 rounded-full bg-papel px-2 py-0.5 text-[10px] font-medium text-tinta-suave"
                title={tituloDesenlace(d)}
              >
                <History className="h-2.5 w-2.5" />
                {textoChipDesenlace(d)}
              </span>
            ))}
          </div>
          {/* Fila 2: contexto — L{N} Linea */}
          {negocio.linea_nombre && (
            <p className="mb-0.5 truncate text-[11px] text-tinta-suave">
              {negocio.linea_numero !== null && (
                <span className="mr-1 font-mono text-tinta-suave/70">L{negocio.linea_numero}</span>
              )}
              {negocio.linea_nombre}
            </p>
          )}
          <p className="text-sm font-semibold leading-tight text-tinta">
            {negocio.codigo && (
              <span className="shrink-0 font-mono">{negocio.codigo}{' — '}</span>
            )}
            <span>{negocio.nombre}</span>
            {negocio.cedula && (
              <span className="ml-1.5 font-mono text-[11px] font-normal text-tinta-suave">
                CC {negocio.cedula}
              </span>
            )}
          </p>
          {negocio.vehiculo_label || negocio.seccional_label ? (
            /* Variante config-driven (ej. SOENA): vehículo (izq) + seccional DIAN (der).
               El nombre del cliente ya va en la línea de título (código — nombre). */
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-tinta">
                {negocio.vehiculo_label ?? '—'}
              </span>
              {negocio.seccional_label && (
                <span className="shrink-0 truncate text-[10px] text-tinta-suave" title={negocio.seccional_label}>
                  {negocio.seccional_label}
                </span>
              )}
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-tinta-suave">
              {negocio.empresa_nombre ?? negocio.contacto_nombre ?? '—'}
            </p>
          )}
          {/* Radicado de certificación (config-driven, ej. SOENA) + copiar al portapapeles */}
          {negocio.radicado && (
            <div className="mt-0.5 flex items-center gap-1">
              <span className="truncate font-mono text-[11px] text-tinta-suave" title={`Radicado: ${negocio.radicado}`}>
                Rad. {negocio.radicado}
              </span>
              <button
                type="button"
                onClick={handleCopiarRadicado}
                className="shrink-0 rounded p-0.5 text-tinta-suave transition-colors hover:bg-papel hover:text-acento"
                title="Copiar radicado"
                aria-label="Copiar radicado"
              >
                {radicadoCopiado
                  ? <Check className="h-3 w-3 text-acento" />
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
          {/* Marcas de condición económica (eje aparte del origen) */}
          <MarcasInline
            negocioId={negocio.id}
            marcas={negocio.marcas}
            canMarcar={canMarcar}
          />
          {isCerrado && negocio.closed_at && (
            <p className="mt-1 text-[10px] text-tinta-suave">
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
                className="rounded p-0.5 text-tinta-suave transition-colors hover:bg-papel hover:text-tinta"
                aria-label="Abrir carpeta Drive"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            )}
            {precio !== null && precio !== undefined && (
              <p className="text-sm font-bold tabular-nums text-tinta">
                {fmt(precio)}
              </p>
            )}
          </div>
          {negocio.precio_aprobado && !isCerrado && (
            <span className="text-[9px] text-tinta-suave/70">aprobado</span>
          )}
        </div>
      </div>

      {/* Barra de ejecucion vs presupuesto */}
      {showEjecucion && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-tinta-suave">
              {fmtShort(negocio.costos_ejecutados)} ejecutado
            </span>
            <span
              className={`text-[10px] font-semibold tabular-nums ${
                pctEjecutado > 90
                  ? 'text-alerta'
                  : pctEjecutado > 70
                    ? 'text-advertencia'
                    : 'text-acento'
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
    </CardLink>
  )
}
