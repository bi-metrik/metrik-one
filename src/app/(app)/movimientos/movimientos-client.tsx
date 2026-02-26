'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownCircle, ArrowUpCircle, FileText, Filter, X, Smartphone, Building2, FolderOpen } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { formatCOP } from '@/lib/contacts/constants'
import type { Movimiento } from './actions'

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
  regimenFiscal: string | null
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

export default function MovimientosClient({ movimientos, totales, filtroTipo, filtroMes, regimenFiscal }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const neto = totales.ingresos - totales.egresos

  // Soporte image lightbox
  const [soporteModal, setSoporteModal] = useState<{ url: string; descripcion: string } | null>(null)

  // D142: Tooltips first-time state
  const [tooltipDeducible, setTooltipDeducible] = useState(false)
  const [tooltipFaltaSoporte, setTooltipFaltaSoporte] = useState(false)

  useEffect(() => {
    // Check if user has already seen tooltips
    const seenDeducible = localStorage.getItem('metrik_tooltip_deducible_visto')
    const seenFaltaSoporte = localStorage.getItem('metrik_tooltip_falta_soporte_visto')

    // Show tooltip on first encounter
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
    params.set(key, value)
    router.push(`/movimientos?${params.toString()}`)
  }

  // Month navigation
  function cambiarMes(delta: number) {
    const [y, m] = filtroMes.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    navigate('mes', d.toISOString().slice(0, 7))
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
        {/* D142: Fourth card — Deducible (only régimen ordinario) */}
        {showDeducibleCard && (
          <div className="rounded-lg border bg-card p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Deducible</p>
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              {formatCOP(totales.deducible)}
            </p>
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border bg-card p-1">
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
                          <div className="mt-1.5 flex items-center gap-1.5">
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
    </div>
  )
}
