'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownCircle, ArrowUpCircle, FileText, Filter, X, Smartphone, Building2, FolderOpen, SlidersHorizontal, Clock, CheckCircle2, ShieldCheck, ShieldX, XCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { formatCOP } from '@/lib/contacts/constants'
import { CATEGORIAS_GASTO } from '@/lib/pipeline/constants'
import { toast } from 'sonner'
import { getRolePermissions } from '@/lib/roles'
import type { Movimiento } from './actions'
import { marcarComoPagado, aprobarMovimiento, rechazarMovimiento } from './actions'

// D142: Categorías deducibles para régimen ordinario
const CATEGORIAS_DEDUCIBLES = ['materiales', 'transporte', 'servicios_profesionales', 'viaticos', 'software', 'impuestos_seguros', 'mano_de_obra']

function esCategoriaDeducible(categoria: string | null): boolean {
  if (!categoria) return false
  return CATEGORIAS_DEDUCIBLES.includes(categoria)
}

interface Props {
  movimientos: Movimiento[]
  totales: { ingresos: number; egresos: number; deducible: number }
  filtroTipo: string
  filtroMes: string
  filtroCat: string
  filtroProy: string
  filtroTipoProy: string
  filtroEstadoPago: string
  filtroEstadoCausacion: string
  regimenFiscal: string | null
  proyectos: { id: string; nombre: string; tipo: string }[]
  role: string
}

const MESES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]

function formatFechaCort(fecha: string) {
  const [, m, d] = fecha.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1]}`
}

function mesLabel(mes: string) {
  const [y, m] = mes.split('-')
  return `${MESES[Number(m) - 1]} ${y}`
}

// D142: Determine tag type for a gasto based on category + soporte
function getDeducibleTag(mov: Movimiento, regimen: string | null): 'deducible' | 'falta_soporte' | null {
  if (mov.tipo !== 'egreso') return null
  if (regimen === 'simple') return null
  if (!esCategoriaDeducible(mov.categoria)) return null
  return mov.soporte_url ? 'deducible' : 'falta_soporte'
}

// D246: Causación badge config
const CAUSACION_BADGES: Record<string, { label: string; className: string } | null> = {
  PENDIENTE: { label: 'Pendiente', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  APROBADO: { label: 'Aprobado', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  RECHAZADO: { label: 'Rechazado', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  CAUSADO: null, // No badge for CAUSADO (final state)
}

export default function MovimientosClient({
  movimientos, totales, filtroTipo, filtroMes,
  filtroCat, filtroProy, filtroTipoProy, filtroEstadoPago,
  filtroEstadoCausacion, regimenFiscal, proyectos, role,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const neto = totales.ingresos - totales.egresos
  const [isPending, startTransition] = useTransition()

  const perms = getRolePermissions(role)

  // Soporte image lightbox
  const [soporteModal, setSoporteModal] = useState<{ url: string; descripcion: string } | null>(null)

  // Marcar como pagado dialog
  const [pagoModal, setPagoModal] = useState<{ id: string; descripcion: string; monto: number; fecha: string } | null>(null)
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split('T')[0])

  // D246: Rechazo dialog
  const [rechazoModal, setRechazoModal] = useState<{ tabla: 'gastos' | 'cobros'; id: string; descripcion: string } | null>(null)
  const [rechazoMotivo, setRechazoMotivo] = useState('')

  // Filters panel
  const [showFilters, setShowFilters] = useState(false)

  // Count active filters (excluding 'todos')
  const activeFilterCount = [filtroCat, filtroProy, filtroTipoProy, filtroEstadoPago, filtroEstadoCausacion].filter(f => f !== 'todos').length

  // Auto-open filters if any are active
  useEffect(() => {
    if (activeFilterCount > 0) setShowFilters(true)
  }, [activeFilterCount])

  // D142: Tooltips first-time state
  const [tooltipDeducible, setTooltipDeducible] = useState(false)
  const [tooltipFaltaSoporte, setTooltipFaltaSoporte] = useState(false)

  useEffect(() => {
    const seenDeducible = localStorage.getItem('metrik_tooltip_deducible_visto')
    const seenFaltaSoporte = localStorage.getItem('metrik_tooltip_falta_soporte_visto')

    if (!seenDeducible && regimenFiscal !== 'simple') {
      const hasDeducible = movimientos.some(m => getDeducibleTag(m, regimenFiscal) === 'deducible')
      if (hasDeducible) setTooltipDeducible(true)
    }
    if (!seenFaltaSoporte && regimenFiscal !== 'simple') {
      const hasFaltaSoporte = movimientos.some(m => getDeducibleTag(m, regimenFiscal) === 'falta_soporte')
      if (hasFaltaSoporte) setTooltipFaltaSoporte(true)
    }
  }, [movimientos, regimenFiscal])

  const dismissTooltipDeducible = useCallback(() => {
    setTooltipDeducible(false)
    localStorage.setItem('metrik_tooltip_deducible_visto', 'true')
  }, [])

  const dismissTooltipFaltaSoporte = useCallback(() => {
    setTooltipFaltaSoporte(false)
    localStorage.setItem('metrik_tooltip_falta_soporte_visto', 'true')
  }, [])

  function navigate(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'todos') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    router.push(`/movimientos?${params.toString()}`)
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('cat')
    params.delete('proy')
    params.delete('tipoProy')
    params.delete('estadoPago')
    params.delete('estadoCausacion')
    router.push(`/movimientos?${params.toString()}`)
  }

  // Month navigation
  function cambiarMes(delta: number) {
    const [y, m] = filtroMes.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    navigate('mes', d.toISOString().slice(0, 7))
  }

  // Marcar como pagado handler
  function handleMarcarPagado() {
    if (!pagoModal) return
    startTransition(async () => {
      const res = await marcarComoPagado(pagoModal.id, fechaPago)
      if (res.success) {
        toast.success('Gasto marcado como pagado')
        setPagoModal(null)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  // D246: Aprobar handler
  function handleAprobar(tabla: 'gastos' | 'cobros', id: string) {
    startTransition(async () => {
      const res = await aprobarMovimiento(tabla, id)
      if (res.success) {
        toast.success('Movimiento aprobado')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  // D246: Rechazar handler
  function handleRechazar() {
    if (!rechazoModal) return
    if (!rechazoMotivo.trim()) {
      toast.error('El motivo es obligatorio')
      return
    }
    startTransition(async () => {
      const res = await rechazarMovimiento(rechazoModal.tabla, rechazoModal.id, rechazoMotivo)
      if (res.success) {
        toast.success('Movimiento rechazado')
        setRechazoModal(null)
        setRechazoMotivo('')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  // Group movimientos by date
  const porFecha = movimientos.reduce<Record<string, Movimiento[]>>((acc, mov) => {
    if (!acc[mov.fecha]) acc[mov.fecha] = []
    acc[mov.fecha].push(mov)
    return acc
  }, {})

  const fechasOrdenadas = Object.keys(porFecha).sort((a, b) => b.localeCompare(a))

  const showDeducibleCard = regimenFiscal === 'ordinario' && totales.deducible > 0

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Mis Movimientos</h1>
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
        <button onClick={() => cambiarMes(-1)} className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
          &larr;
        </button>
        <span className="text-sm font-medium">{mesLabel(filtroMes)}</span>
        <button onClick={() => cambiarMes(1)} className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
          &rarr;
        </button>
      </div>

      {/* Summary cards */}
      <div className={`grid gap-2 ${showDeducibleCard ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ingresos</p>
          <p className="text-sm font-semibold text-green-600 dark:text-green-400">
            {formatCOP(totales.ingresos)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Egresos</p>
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            {formatCOP(totales.egresos)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Neto</p>
          <p className={`text-sm font-semibold ${neto >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {neto >= 0 ? '+' : ''}{formatCOP(neto)}
          </p>
        </div>
        {showDeducibleCard && (
          <div className="rounded-lg border bg-card p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Deducible</p>
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              {formatCOP(totales.deducible)}
            </p>
          </div>
        )}
      </div>

      {/* Filter tabs + Filtros button */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-lg border bg-card p-1">
          {(['todos', 'ingresos', 'egresos'] as const).map(t => (
            <button
              key={t}
              onClick={() => navigate('tipo', t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filtroTipo === t
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'todos' ? 'Todos' : t === 'ingresos' ? 'Ingresos' : 'Egresos'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`relative flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            activeFilterCount > 0
              ? 'border-primary bg-primary/5 text-primary'
              : 'bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {activeFilterCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Advanced filters panel */}
      {showFilters && (
        <div className="rounded-lg border bg-card p-3 space-y-2">
          {/* Row 1: Categoría + Proyecto */}
          <div className="grid grid-cols-2 gap-2">
            <select
              value={filtroCat}
              onChange={e => navigate('cat', e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-xs"
            >
              <option value="todos">Todas las categorias</option>
              {CATEGORIAS_GASTO.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>

            <select
              value={filtroProy}
              onChange={e => navigate('proy', e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-xs"
            >
              <option value="todos">Todos los proyectos</option>
              <option value="empresa">Empresa (sin proyecto)</option>
              {proyectos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.nombre}{p.tipo === 'interno' ? ' · Int' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Row 2: Tipo proyecto + Estado pago + Estado contable */}
          <div className="grid grid-cols-3 gap-2">
            <select
              value={filtroTipoProy}
              onChange={e => navigate('tipoProy', e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-xs"
            >
              <option value="todos">Todos los tipos</option>
              <option value="cliente">Externo (cliente)</option>
              <option value="interno">Interno</option>
              <option value="empresa">Empresa</option>
            </select>

            <select
              value={filtroEstadoPago}
              onChange={e => navigate('estadoPago', e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-xs"
            >
              <option value="todos">Todo estado pago</option>
              <option value="pagado">Pagados</option>
              <option value="pendiente">Pendientes</option>
            </select>

            {/* D246: Estado contable filter */}
            <select
              value={filtroEstadoCausacion}
              onChange={e => navigate('estadoCausacion', e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-xs"
            >
              <option value="todos">Estado contable</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="APROBADO">Aprobado</option>
              <option value="CAUSADO">Causado</option>
              <option value="RECHAZADO">Rechazado</option>
            </select>
          </div>

          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* D142: Tooltip educativo — Deducible (primera vez) */}
      {tooltipDeducible && (
        <div className="relative rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/30">
          <button onClick={dismissTooltipDeducible} className="absolute top-2 right-2 rounded p-0.5 hover:bg-green-100 dark:hover:bg-green-900/50">
            <X className="h-3.5 w-3.5 text-green-700 dark:text-green-300" />
          </button>
          <p className="text-xs font-semibold text-green-800 dark:text-green-200 mb-1">Que significa &quot;Deducible&quot;?</p>
          <p className="text-[11px] text-green-700 dark:text-green-300 leading-relaxed">
            Marcamos como deducible los gastos que tienen soporte fiscal (factura) en categorias que normalmente son deducibles de tu renta. Este es un estimado. Confirma siempre con tu contador antes de declarar.
          </p>
          <button onClick={dismissTooltipDeducible} className="mt-2 rounded-md bg-green-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-green-700">
            Entendido
          </button>
        </div>
      )}

      {/* D142: Tooltip educativo — Falta soporte (primera vez) */}
      {tooltipFaltaSoporte && !tooltipDeducible && (
        <div className="relative rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <button onClick={dismissTooltipFaltaSoporte} className="absolute top-2 right-2 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/50">
            <X className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
          </button>
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">Por que &quot;Falta soporte&quot;?</p>
          <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
            Este gasto podria ser deducible, pero no tiene factura adjunta. Sin factura electronica, la DIAN no lo acepta como deduccion. Tip: Toma foto del recibo o edita el gasto para agregar soporte.
          </p>
          <button onClick={dismissTooltipFaltaSoporte} className="mt-2 rounded-md bg-amber-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-amber-700">
            Entendido
          </button>
        </div>
      )}

      {/* Movimientos list */}
      {movimientos.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Filter className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>No hay movimientos en {mesLabel(filtroMes)}</p>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="mt-2 text-xs text-primary underline">
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {fechasOrdenadas.map(fecha => (
            <div key={fecha}>
              {/* Date header */}
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {formatFechaCort(fecha)}
              </p>
              <div className="space-y-1">
                {porFecha[fecha].map(mov => {
                  const tag = getDeducibleTag(mov, regimenFiscal)
                  const hasSoporteImage = mov.soporte_url && !mov.soporte_url.startsWith('wamid.')
                  const causacionBadge = CAUSACION_BADGES[mov.estado_causacion]
                  return (
                    <div
                      key={mov.id}
                      className="rounded-lg border bg-card px-3 py-2.5"
                    >
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        {mov.tipo === 'ingreso' ? (
                          <ArrowDownCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                        ) : (
                          <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                        )}

                        {/* Content column */}
                        <div className="min-w-0 flex-1">
                          {/* Line 1: Description + Amount */}
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-medium">{mov.descripcion}</p>
                            <span className={`shrink-0 text-sm font-semibold tabular-nums ${
                              mov.tipo === 'ingreso'
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}>
                              {mov.tipo === 'ingreso' ? '+' : '-'}{formatCOP(mov.monto)}
                            </span>
                          </div>

                          {/* Line 2: Proyecto + Categoria */}
                          {(mov.proyecto || mov.categoria) && (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {mov.proyecto}
                              {mov.proyecto && mov.categoria && ' · '}
                              {mov.categoria && (
                                <span className="capitalize">{mov.categoria.replace(/_/g, ' ')}</span>
                              )}
                            </p>
                          )}

                          {/* Line 3: Badges + User initials + Soporte */}
                          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                            {/* D246: Causación badge */}
                            {causacionBadge && (
                              <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${causacionBadge.className}`}>
                                {mov.estado_causacion === 'PENDIENTE' && <Clock className="h-2.5 w-2.5" />}
                                {mov.estado_causacion === 'APROBADO' && <ShieldCheck className="h-2.5 w-2.5" />}
                                {mov.estado_causacion === 'RECHAZADO' && <XCircle className="h-2.5 w-2.5" />}
                                {causacionBadge.label}
                              </span>
                            )}

                            {/* D246: Rechazo motivo tooltip */}
                            {mov.estado_causacion === 'RECHAZADO' && mov.rechazo_motivo && (
                              <span className="text-[10px] text-muted-foreground italic truncate max-w-[120px]" title={mov.rechazo_motivo}>
                                {mov.rechazo_motivo}
                              </span>
                            )}

                            {/* Tipo gasto badge */}
                            {mov.tipo === 'egreso' && mov.tipo_gasto && (
                              <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${
                                mov.tipo_gasto === 'directo'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                                  : mov.tipo_gasto === 'empresa'
                                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                              }`}>
                                {mov.tipo_gasto === 'directo' && <FolderOpen className="h-2.5 w-2.5" />}
                                {mov.tipo_gasto === 'empresa' && <Building2 className="h-2.5 w-2.5" />}
                                {mov.tipo_gasto === 'directo' ? 'Proyecto' : mov.tipo_gasto === 'empresa' ? 'Empresa' : 'Fijo'}
                              </span>
                            )}

                            {/* D119: Pendiente pago badge */}
                            {mov.estado_pago === 'pendiente' && (
                              <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                                <Clock className="h-2.5 w-2.5" />
                                Pend. pago
                              </span>
                            )}

                            {/* D119: Marcar como pagado button */}
                            {mov.estado_pago === 'pendiente' && (
                              <button
                                onClick={() => {
                                  setPagoModal({ id: mov.id, descripcion: mov.descripcion, monto: mov.monto, fecha: mov.fecha })
                                  setFechaPago(new Date().toISOString().split('T')[0])
                                }}
                                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60 transition-colors"
                                title="Marcar como pagado"
                              >
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Pagado
                              </button>
                            )}

                            {/* Deducible / Falta soporte tags */}
                            {tag === 'deducible' && (
                              <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                                Deducible
                              </span>
                            )}
                            {tag === 'falta_soporte' && (
                              <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                Falta soporte
                              </span>
                            )}

                            {/* Canal WhatsApp indicator */}
                            {mov.canal_registro === 'whatsapp' && (
                              <Smartphone className="h-3 w-3 text-green-500" />
                            )}

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* D246: Aprobar / Rechazar buttons (owner/admin + PENDIENTE only) */}
                            {perms.canApproveCausacion && mov.estado_causacion === 'PENDIENTE' && (
                              <>
                                <button
                                  onClick={() => handleAprobar(mov.tabla, mov.id)}
                                  disabled={isPending}
                                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 transition-colors disabled:opacity-50"
                                  title="Aprobar movimiento"
                                >
                                  <ShieldCheck className="h-2.5 w-2.5" />
                                  Aprobar
                                </button>
                                <button
                                  onClick={() => {
                                    setRechazoModal({ tabla: mov.tabla, id: mov.id, descripcion: mov.descripcion })
                                    setRechazoMotivo('')
                                  }}
                                  disabled={isPending}
                                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 transition-colors disabled:opacity-50"
                                  title="Rechazar movimiento"
                                >
                                  <ShieldX className="h-2.5 w-2.5" />
                                </button>
                              </>
                            )}

                            {/* User initials */}
                            {mov.created_by_initials && (
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground"
                                title={mov.created_by_name ?? undefined}
                              >
                                {mov.created_by_initials}
                              </span>
                            )}

                            {/* Soporte indicator */}
                            {hasSoporteImage ? (
                              <button
                                onClick={() => setSoporteModal({ url: mov.soporte_url!, descripcion: mov.descripcion })}
                                className="inline-flex h-5 w-5 items-center justify-center rounded bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition-colors"
                                title="Ver soporte"
                              >
                                <FileText className="h-3 w-3" />
                              </button>
                            ) : mov.soporte_url ? (
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber-50 text-amber-500 dark:bg-amber-900/30 dark:text-amber-400"
                                title="Soporte (foto no disponible)"
                              >
                                <FileText className="h-3 w-3" />
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Soporte image lightbox */}
      <Dialog open={!!soporteModal} onOpenChange={() => setSoporteModal(null)}>
        <DialogContent className="max-w-md p-2 sm:max-w-lg">
          <DialogTitle className="sr-only">Soporte</DialogTitle>
          {soporteModal && (
            <div className="space-y-2">
              <p className="truncate px-2 pt-2 text-sm font-medium">{soporteModal.descripcion}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={soporteModal.url}
                alt="Soporte fotográfico"
                className="w-full rounded-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* D119: Marcar como pagado dialog */}
      <Dialog open={!!pagoModal} onOpenChange={() => setPagoModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="text-base font-semibold">
            Marcar gasto como pagado
          </DialogTitle>
          {pagoModal && (
            <div className="space-y-4">
              <div className="space-y-1 text-sm">
                <p><span className="text-muted-foreground">Gasto:</span> {pagoModal.descripcion} — {formatCOP(pagoModal.monto)}</p>
                <p><span className="text-muted-foreground">Causado:</span> {pagoModal.fecha}</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Fecha de pago</label>
                <input
                  type="date"
                  value={fechaPago}
                  onChange={e => setFechaPago(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setPagoModal(null)}
                  className="flex-1 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleMarcarPagado}
                  disabled={isPending}
                  className="flex-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {isPending ? 'Guardando...' : 'Confirmar pago'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* D246: Rechazo dialog */}
      <Dialog open={!!rechazoModal} onOpenChange={() => { setRechazoModal(null); setRechazoMotivo('') }}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="text-base font-semibold">
            Rechazar movimiento
          </DialogTitle>
          {rechazoModal && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {rechazoModal.descripcion}
              </p>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Motivo del rechazo *</label>
                <textarea
                  value={rechazoMotivo}
                  onChange={e => setRechazoMotivo(e.target.value)}
                  placeholder="Explica por qué se rechaza este movimiento..."
                  rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setRechazoModal(null); setRechazoMotivo('') }}
                  className="flex-1 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRechazar}
                  disabled={isPending || !rechazoMotivo.trim()}
                  className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isPending ? 'Rechazando...' : 'Rechazar'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
