'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Zap, ArrowDownCircle, ArrowUpCircle, Info, ChevronDown, CheckCircle2 } from 'lucide-react'
import { formatCOP } from '@/lib/contacts/constants'
import { getRolePermissions } from '@/lib/roles'
import { toast } from 'sonner'
import type { ItemCausacion } from './actions'
import { causarMovimiento, getCausacionData, toggleDeducible } from './actions'

interface Props {
  items: ItemCausacion[]
  counts: { aprobados: number; causados: number }
  activeTab: 'aprobados' | 'causados'
  mes: string
  role?: string
}

const MESES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]

function mesLabel(mes: string) {
  const [y, m] = mes.split('-')
  return `${MESES[Number(m) - 1]} ${y}`
}

function formatFecha(fecha: string) {
  const [, m, d] = fecha.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1]}`
}

export default function CausacionClient({ items, counts, activeTab, mes, role }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Permisos del rol actual
  const perms = getRolePermissions(role ?? 'read_only')

  // Estado optimista para deducible (gastoId → boolean)
  const [deducibleState, setDeducibleState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const item of items) {
      if (item.tabla === 'gastos' && item.deducible !== null) {
        initial[item.id] = item.deducible
      }
    }
    return initial
  })
  const [togglePending, setTogglePending] = useState<string | null>(null)

  function getDeducible(item: ItemCausacion): boolean {
    if (item.id in deducibleState) return deducibleState[item.id]
    return item.deducible ?? false
  }

  function handleToggleDeducible(item: ItemCausacion) {
    const nuevoValor = !getDeducible(item)
    // Optimistic update
    setDeducibleState(prev => ({ ...prev, [item.id]: nuevoValor }))
    setTogglePending(item.id)
    startTransition(async () => {
      const res = await toggleDeducible(item.id, nuevoValor)
      setTogglePending(null)
      if (!res.success) {
        // Revert on error
        setDeducibleState(prev => ({ ...prev, [item.id]: !nuevoValor }))
        toast.error(res.error ?? 'Error al actualizar deducibilidad')
      }
    })
  }

  // Form state for causación
  const [formData, setFormData] = useState<Record<string, {
    cuenta_contable: string
    centro_costo: string
    notas_causacion: string
    retencion_aplicada: string
  }>>({})

  function navigate(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (key === 'tab' && value === 'aprobados') {
      params.delete('tab')
    } else {
      params.set(key, value)
    }
    router.push(`/causacion?${params.toString()}`)
  }

  function cambiarMes(delta: number) {
    const [y, m] = mes.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    navigate('mes', d.toISOString().slice(0, 7))
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      // Initialize form data if not present
      if (!formData[id]) {
        setFormData(prev => ({
          ...prev,
          [id]: { cuenta_contable: '', centro_costo: '', notas_causacion: '', retencion_aplicada: '' },
        }))
      }
    }
  }

  function updateForm(id: string, field: string, value: string) {
    setFormData(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }))
  }

  function handleCausar(item: ItemCausacion) {
    const form = formData[item.id]
    if (!form?.cuenta_contable.trim()) {
      toast.error('Cuenta contable es obligatoria')
      return
    }
    if (!form?.centro_costo.trim()) {
      toast.error('Centro de costo es obligatorio')
      return
    }

    startTransition(async () => {
      const res = await causarMovimiento({
        tabla: item.tabla,
        registroId: item.id,
        cuenta_contable: form.cuenta_contable,
        centro_costo: form.centro_costo,
        notas_causacion: form.notas_causacion || undefined,
        retencion_aplicada: form.retencion_aplicada ? Number(form.retencion_aplicada) : undefined,
      })
      if (res.success) {
        toast.success('Movimiento causado exitosamente')
        setExpandedId(null)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Causacion Contable</h1>
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
        <button onClick={() => cambiarMes(-1)} className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
          &larr;
        </button>
        <span className={`text-sm font-medium ${isPending ? 'opacity-50' : ''}`}>{mesLabel(mes)}</span>
        <button onClick={() => cambiarMes(1)} className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
          &rarr;
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-card p-1">
        <button
          onClick={() => navigate('tab', 'aprobados')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'aprobados'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Aprobados {counts.aprobados > 0 && `(${counts.aprobados})`}
        </button>
        <button
          onClick={() => navigate('tab', 'causados')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'causados'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Causados {counts.causados > 0 && `(${counts.causados})`}
        </button>
      </div>

      {/* Info banner — solo para owner/admin, no para el contador que ya tiene acceso */}
      {role !== 'contador' && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950/30">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
            Aqui puedes causar los movimientos aprobados asignando cuenta PUC y centro de costo. Tu contador tambien puede acceder directamente a este modulo.
          </p>
        </div>
      )}

      {/* Items list */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {activeTab === 'aprobados' ? (
            <>
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>No hay movimientos aprobados pendientes de causar</p>
              <p className="mt-1 text-xs">Los movimientos aparecen aqui despues de ser aprobados en Movimientos</p>
            </>
          ) : (
            <>
              <Zap className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>No hay movimientos causados en {mesLabel(mes)}</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const isExpanded = expandedId === item.id
            const form = formData[item.id]
            return (
              <div key={item.id} className="rounded-lg border bg-card overflow-hidden">
                {/* Card header */}
                <button
                  onClick={() => activeTab === 'aprobados' ? toggleExpand(item.id) : undefined}
                  className={`w-full px-3 py-2.5 text-left ${activeTab === 'aprobados' ? 'cursor-pointer hover:bg-accent/50 transition-colors' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    {item.tipo === 'ingreso' ? (
                      <ArrowDownCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                    ) : (
                      <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                    )}

                    <div className="min-w-0 flex-1">
                      {/* Line 1: Description + Amount */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium">{item.descripcion}</p>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${
                          item.tipo === 'ingreso'
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}>
                          {item.tipo === 'ingreso' ? '+' : '-'}{formatCOP(item.monto)}
                        </span>
                      </div>

                      {/* Line 2: Metadata */}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatFecha(item.fecha)}
                        {item.proyecto && ` · ${item.proyecto}`}
                        {item.categoria && ` · ${item.categoria.replace(/_/g, ' ')}`}
                        {item.created_by_name && ` · ${item.created_by_name}`}
                      </p>

                      {/* Causados tab: Show accounting badges */}
                      {activeTab === 'causados' && (
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          {item.cuenta_contable && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                              PUC: {item.cuenta_contable}
                            </span>
                          )}
                          {item.centro_costo && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                              CC: {item.centro_costo}
                            </span>
                          )}
                          {item.retencion_aplicada != null && item.retencion_aplicada > 0 && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                              Ret: {formatCOP(item.retencion_aplicada)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Deducible toggle — solo gastos, solo roles con permiso */}
                      {item.tabla === 'gastos' && perms.canToggleDeducible && (
                        <div className="mt-1.5 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={getDeducible(item)}
                            disabled={togglePending === item.id}
                            onClick={() => handleToggleDeducible(item)}
                            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:opacity-50 ${
                              getDeducible(item) ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${
                                getDeducible(item) ? 'translate-x-3' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <span className={`text-[10px] ${getDeducible(item) ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                            {getDeducible(item) ? 'Deducible' : 'No deducible'}
                          </span>
                        </div>
                      )}

                      {/* Expand indicator for aprobados */}
                      {activeTab === 'aprobados' && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          {isExpanded ? 'Ocultar formulario' : 'Click para causar'}
                        </div>
                      )}
                    </div>
                  </div>
                </button>

                {/* Expanded form (only for aprobados tab) */}
                {activeTab === 'aprobados' && isExpanded && form && (
                  <div className="border-t bg-muted/30 px-3 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Cuenta PUC *</label>
                        <input
                          type="text"
                          value={form.cuenta_contable}
                          onChange={e => updateForm(item.id, 'cuenta_contable', e.target.value)}
                          placeholder="Ej: 519595"
                          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Centro costo *</label>
                        <input
                          type="text"
                          value={form.centro_costo}
                          onChange={e => updateForm(item.id, 'centro_costo', e.target.value)}
                          placeholder="Ej: Operaciones"
                          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Retencion (opcional)</label>
                        <input
                          type="number"
                          value={form.retencion_aplicada}
                          onChange={e => updateForm(item.id, 'retencion_aplicada', e.target.value)}
                          placeholder="0"
                          min="0"
                          step="0.01"
                          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Notas (opcional)</label>
                        <input
                          type="text"
                          value={form.notas_causacion}
                          onChange={e => updateForm(item.id, 'notas_causacion', e.target.value)}
                          placeholder="Notas de causacion..."
                          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => handleCausar(item)}
                      disabled={isPending || !form.cuenta_contable.trim() || !form.centro_costo.trim()}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      <Zap className="h-4 w-4" />
                      {isPending ? 'Causando...' : 'Causar'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
