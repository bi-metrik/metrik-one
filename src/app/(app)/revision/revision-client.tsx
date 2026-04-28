'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  FileText,
  RotateCcw,
  User as UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCOP } from '@/lib/contacts/constants'
import { getRolePermissions } from '@/lib/roles'
import { marcarRevisado, desmarcarRevisado } from './actions'
import type { ItemRevision } from './actions'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function mesLabel(mes: string) {
  const [y, m] = mes.split('-')
  return `${MESES[Number(m) - 1]} ${y}`
}

function formatFechaCorta(fecha: string) {
  if (!fecha) return ''
  const [, m, d] = fecha.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1]}`
}

interface Props {
  items: ItemRevision[]
  counts: { pendientes: number; revisados: number }
  mes: string
  filtro: 'todos' | 'pendientes' | 'revisados'
  role: string
}

export default function RevisionClient({ items, counts, mes, filtro, role }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [optimisticIds, setOptimisticIds] = useState<Set<string>>(new Set())

  const perms = getRolePermissions(role)

  function navigate(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`/revision?${params.toString()}`)
  }

  function cambiarMes(delta: number) {
    const [y, m] = mes.split('-').map(Number)
    const date = new Date(y, m - 1 + delta, 1)
    const nuevoMes = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    navigate('mes', nuevoMes)
  }

  function handleToggleRevisado(item: ItemRevision) {
    if (!perms.canMarcarRevisado) return
    const nextRevisado = !item.revisado
    setOptimisticIds(prev => new Set(prev).add(item.id))
    startTransition(async () => {
      const res = nextRevisado
        ? await marcarRevisado(item.id, item.tabla)
        : await desmarcarRevisado(item.id, item.tabla)
      setOptimisticIds(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      if (res.success) {
        toast.success(nextRevisado ? 'Marcado como revisado' : 'Desmarcado')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  // Group items by fecha
  const porFecha = items.reduce<Record<string, ItemRevision[]>>((acc, it) => {
    const key = it.fecha || 'sin-fecha'
    if (!acc[key]) acc[key] = []
    acc[key].push(it)
    return acc
  }, {})
  const fechasOrdenadas = Object.keys(porFecha).sort((a, b) => b.localeCompare(a))

  const hayItems = items.length > 0

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-[#1A1A1A]">Bandeja de revision</h1>
        <p className="text-xs text-[#6B7280]">
          Marca como revisado los movimientos del mes para tu contador.
        </p>
      </div>

      {/* Selector de mes + Descargar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-white px-3 py-2 flex-1 min-w-[180px]">
          <button
            onClick={() => cambiarMes(-1)}
            className="rounded px-2 py-1 text-sm text-[#6B7280] hover:bg-[#F5F4F2]"
            aria-label="Mes anterior"
          >
            ←
          </button>
          <span className="text-sm font-medium text-[#1A1A1A]">{mesLabel(mes)}</span>
          <button
            onClick={() => cambiarMes(1)}
            className="rounded px-2 py-1 text-sm text-[#6B7280] hover:bg-[#F5F4F2]"
            aria-label="Mes siguiente"
          >
            →
          </button>
        </div>
        {perms.canExportRevision && <DescargarMenu mes={mes} />}
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        <FilterPill active={filtro === 'todos'} onClick={() => navigate('filtro', '')} label={`Todos (${counts.pendientes + counts.revisados})`} />
        <FilterPill active={filtro === 'pendientes'} onClick={() => navigate('filtro', 'pendientes')} label={`Pendientes (${counts.pendientes})`} dot="orange" />
        <FilterPill active={filtro === 'revisados'} onClick={() => navigate('filtro', 'revisados')} label={`Revisados (${counts.revisados})`} dot="green" />
      </div>

      {/* List */}
      {!hayItems ? (
        <div className="rounded-md border border-dashed border-[#E5E7EB] bg-[#F5F4F2] py-12 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-[#10B981]" />
          <p className="mt-3 text-sm font-medium text-[#1A1A1A]">
            {filtro === 'pendientes' ? 'No hay pendientes — todo al dia' : filtro === 'revisados' ? 'Sin movimientos revisados aun' : 'Sin movimientos en este mes'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {fechasOrdenadas.map(fecha => (
            <div key={fecha}>
              <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-[#6B7280]">
                {formatFechaCorta(fecha)}
              </p>
              <div className="space-y-1.5">
                {porFecha[fecha].map(item => (
                  <ItemCard
                    key={`${item.tabla}-${item.id}`}
                    item={item}
                    canMark={perms.canMarcarRevisado}
                    isPending={isPending && optimisticIds.has(item.id)}
                    onToggle={() => handleToggleRevisado(item)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────

function DescargarMenu({ mes }: { mes: string }) {
  const [open, setOpen] = useState(false)
  const handleDownload = (formato: 'csv' | 'xlsx') => {
    const url = `/api/revision/export?mes=${mes}&formato=${formato}`
    window.open(url, '_blank')
    setOpen(false)
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-medium text-[#1A1A1A] hover:bg-[#F5F4F2]"
      >
        <Download className="h-3.5 w-3.5" />
        Descargar
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 min-w-[140px] rounded-md border border-[#E5E7EB] bg-white shadow-lg">
            <button
              onClick={() => handleDownload('xlsx')}
              className="block w-full px-3 py-2 text-left text-xs hover:bg-[#F5F4F2]"
            >
              Excel (3 hojas)
            </button>
            <button
              onClick={() => handleDownload('csv')}
              className="block w-full px-3 py-2 text-left text-xs hover:bg-[#F5F4F2]"
            >
              CSV (combinado)
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function FilterPill({ active, onClick, label, dot }: {
  active: boolean
  onClick: () => void
  label: string
  dot?: 'orange' | 'green'
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-[#1A1A1A] text-white'
          : 'border border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F5F4F2]'
      }`}
    >
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            dot === 'orange' ? 'bg-[#F59E0B]' : 'bg-[#10B981]'
          }`}
          aria-hidden="true"
        />
      )}
      {label}
    </button>
  )
}

function ItemCard({ item, canMark, isPending, onToggle }: {
  item: ItemRevision
  canMark: boolean
  isPending: boolean
  onToggle: () => void
}) {
  const isEgreso = item.tipo === 'egreso'
  const detailHref = item.tabla === 'gastos' ? `/movimientos?gastoId=${item.id}` : `/movimientos?cobroId=${item.id}`

  return (
    <div
      className={`rounded-md border bg-white px-3 py-2.5 transition-colors ${
        item.revisado
          ? 'border-[#E5E7EB]'
          : 'border-[#E5E7EB] shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Tipo icon */}
        <div className="mt-0.5 shrink-0">
          {isEgreso ? (
            <ArrowDownCircle className="h-5 w-5 text-[#EF4444]" />
          ) : (
            <ArrowUpCircle className="h-5 w-5 text-[#10B981]" />
          )}
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium text-[#1A1A1A]">
              {item.descripcion}
            </p>
            <span className={`shrink-0 text-sm font-semibold tabular-nums ${
              isEgreso ? 'text-[#EF4444]' : 'text-[#10B981]'
            }`}>
              {isEgreso ? '−' : '+'}{formatCOP(item.monto)}
            </span>
          </div>

          {/* Metadata row */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6B7280]">
            {item.categoria && (
              <span className="rounded bg-[#F5F4F2] px-1.5 py-0.5">
                {item.categoria.replace('_', ' ')}
              </span>
            )}
            {item.proyecto && (
              <span className="truncate">· {item.proyecto}</span>
            )}
            {item.negocio && (
              <span className="truncate">· {item.negocio}</span>
            )}
            {item.tercero_nit && (
              <span>· NIT {item.tercero_nit}</span>
            )}
          </div>

          {/* Badges row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {item.deducible && (
              <span className="rounded bg-[#10B981]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#059669]">
                Deducible
              </span>
            )}
            {item.retencion !== null && item.retencion > 0 && (
              <span className="rounded bg-[#F5F4F2] px-1.5 py-0.5 text-[10px] font-medium text-[#1A1A1A]">
                Ret. {formatCOP(item.retencion)}
              </span>
            )}
            {item.soporte_url && (
              <a
                href={item.soporte_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 rounded bg-[#F5F4F2] px-1.5 py-0.5 text-[10px] font-medium text-[#6B7280] hover:bg-[#E5E7EB]"
              >
                <FileText className="h-2.5 w-2.5" />
                Soporte
              </a>
            )}
            {item.created_by_name && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[#6B7280]">
                <UserIcon className="h-2.5 w-2.5" />
                {item.created_by_name}
              </span>
            )}
            {item.tabla === 'gastos' && (
              <Link
                href={detailHref}
                className="ml-auto inline-flex items-center gap-0.5 rounded bg-[#F5F4F2] px-1.5 py-0.5 text-[10px] font-medium text-[#6B7280] hover:bg-[#E5E7EB]"
              >
                Ver
              </Link>
            )}
          </div>

          {/* Action */}
          {canMark && (
            <div className="mt-2">
              <button
                onClick={onToggle}
                disabled={isPending}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                  item.revisado
                    ? 'border border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F5F4F2]'
                    : 'bg-[#10B981] text-white hover:bg-[#059669]'
                }`}
              >
                {item.revisado ? (
                  <>
                    <RotateCcw className="h-3 w-3" />
                    Desmarcar
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Marcar revisado
                  </>
                )}
              </button>
              {item.revisado && item.revisado_at && (
                <span className="ml-2 text-[10px] text-[#6B7280]">
                  · Revisado {formatFechaCorta(item.revisado_at.slice(0, 10))}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
