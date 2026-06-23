'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Scale, CheckCircle2, Loader2, X, Plus, Trash2, ExternalLink,
  Search, Wallet, LayoutGrid, ArrowRightLeft, Undo2, ChevronRight, ChevronDown,
} from 'lucide-react'
import {
  agregarPago,
  setPorcionReferencia,
  conciliarReferencia,
  type ConciliacionV2,
  type SobrepagoRef,
  type NegocioSaldo,
  type NegocioParaSplit,
  type ReferenciaPago,
} from '@/lib/actions/conciliacion-actions'

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

const VERDE = '#10B981'
const FONT = { fontFamily: 'var(--font-montserrat), Montserrat, sans-serif' }

type TabKey = 'por_conciliar' | 'saldos' | 'general'

export default function ConciliacionClient({ data }: { data: ConciliacionV2 }) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('general')
  const [addOpen, setAddOpen] = useState(false)

  // Negocios para el selector "Agregar pago": todos los abiertos (con o sin saldo).
  const negociosSelector = useMemo(() => {
    const map = new Map<string, { negocio_id: string; codigo: string | null; nombre: string | null }>()
    for (const s of [...data.saldos, ...data.conciliados]) {
      map.set(s.negocio_id, { negocio_id: s.negocio_id, codigo: s.codigo, nombre: s.nombre })
    }
    for (const s of data.sobrepagos) {
      if (!map.has(s.negocio_id)) map.set(s.negocio_id, { negocio_id: s.negocio_id, codigo: s.negocio_codigo, nombre: s.negocio_nombre })
    }
    return Array.from(map.values()).sort((a, b) => (a.codigo ?? '').localeCompare(b.codigo ?? ''))
  }, [data])

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'general', label: 'Vista general' },
    { key: 'por_conciliar', label: 'Por conciliar', count: data.metricas.por_conciliar },
    { key: 'saldos', label: 'Saldos', count: data.metricas.en_saldo },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6" style={FONT}>
      {/* ── Panel base (encabezado) ── */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5" style={{ color: VERDE }} />
            <h1 className="text-lg font-bold" style={{ color: '#1A1A1A' }}>Conciliación de pagos</h1>
          </div>
          <p className="mt-1 text-[13px]" style={{ color: '#6B7280' }}>
            {data.metricas.referencias_cargadas} referencia{data.metricas.referencias_cargadas === 1 ? '' : 's'} de pago cargada{data.metricas.referencias_cargadas === 1 ? '' : 's'} a ONE en este workspace.
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90"
          style={{ backgroundColor: VERDE }}
        >
          <Plus className="h-4 w-4" /> Agregar pago
        </button>
      </div>

      {/* ── Pestañas ── */}
      <div className="mb-5 flex flex-wrap gap-1 border-b" style={{ borderColor: '#E5E7EB' }}>
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold transition"
              style={{
                borderColor: active ? VERDE : 'transparent',
                color: active ? '#1A1A1A' : '#6B7280',
              }}
            >
              {t.label}
              {typeof t.count === 'number' && t.count > 0 && (
                <span
                  className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ backgroundColor: active ? '#D1FAE5' : '#F3F4F6', color: active ? '#047857' : '#6B7280' }}
                >
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'general' && <VistaGeneral data={data} onTab={setTab} />}
      {tab === 'por_conciliar' && <TabPorConciliar data={data} onDone={() => router.refresh()} />}
      {tab === 'saldos' && <TabSaldos data={data} />}

      {addOpen && (
        <AgregarPagoModal
          negocios={negociosSelector}
          onClose={() => setAddOpen(false)}
          onDone={() => { setAddOpen(false); router.refresh() }}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Pestaña 5 — VISTA GENERAL
// ════════════════════════════════════════════════════════════════════════════

function VistaGeneral({ data, onTab }: { data: ConciliacionV2; onTab: (t: TabKey) => void }) {
  const m = data.metricas
  const tiles: { label: string; value: number; tab: TabKey; icon: React.ReactNode }[] = [
    { label: 'Referencias cargadas', value: m.referencias_cargadas, tab: 'general', icon: <LayoutGrid className="h-4 w-4" /> },
    { label: 'Por conciliar', value: m.por_conciliar, tab: 'por_conciliar', icon: <Scale className="h-4 w-4" /> },
    { label: 'En saldo', value: m.en_saldo, tab: 'saldos', icon: <Wallet className="h-4 w-4" /> },
  ]
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <button
            key={t.label}
            onClick={() => onTab(t.tab)}
            className="rounded-lg border bg-white p-4 text-left transition hover:shadow-sm"
            style={{ borderColor: '#E5E7EB' }}
          >
            <div className="flex items-center gap-1.5" style={{ color: '#6B7280' }}>
              {t.icon}
              <span className="text-[11px] font-semibold uppercase tracking-wide">{t.label}</span>
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: '#1A1A1A' }}>
              {t.value}
            </div>
          </button>
        ))}
      </div>

      <RegistroReferencias referencias={data.referencias} />
    </div>
  )
}

// ── Registro general de pagos por referencia (dentro de Vista general) ────────

function RegistroReferencias({ referencias }: { referencias: ReferenciaPago[] }) {
  const [q, setQ] = useState('')
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const query = q.trim().toLowerCase()

  const filtradas = useMemo(() => {
    if (!query) return referencias
    return referencias.filter((r) =>
      [r.external_ref, r.fuente, ...r.porciones.flatMap((p) => [p.negocio_codigo, p.negocio_nombre])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query)),
    )
  }, [referencias, query])

  function toggle(ref: string) {
    setAbiertas((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#6B7280' }}>
          <LayoutGrid className="h-3.5 w-3.5" /> Registro de pagos por referencia ({referencias.length})
        </h2>
      </div>
      <p className="mb-3 text-[11px]" style={{ color: '#9CA3AF' }}>
        Cada referencia de pago cargada al workspace, con el detalle de cuánto de ese valor quedó cargado a cada negocio.
      </p>

      <div className="mb-3 flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: '#E5E7EB' }}>
        <Search className="h-4 w-4" style={{ color: '#9CA3AF' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Busca por referencia, fuente o negocio…"
          className="w-full text-[13px] outline-none"
          style={{ color: '#1A1A1A' }}
        />
      </div>

      {filtradas.length === 0 ? (
        <Empty>{query ? 'Sin resultados para la búsqueda.' : 'Aún no hay pagos cargados a este workspace.'}</Empty>
      ) : (
        <div className="space-y-2">
          {filtradas.map((r) => {
            const open = abiertas.has(r.external_ref)
            const multi = r.negocios_ids.length > 1
            const porDevolver = r.porciones.filter((p) => p.por_devolver)
            return (
              <div key={r.external_ref} className="rounded-lg border" style={{ borderColor: '#E5E7EB' }}>
                <button
                  onClick={() => toggle(r.external_ref)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {open ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: '#9CA3AF' }} /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: '#9CA3AF' }} />}
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px]">{r.external_ref}</span>
                    {r.fuente && <FuenteBadge fuente={r.fuente} small />}
                    {multi && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <ArrowRightLeft className="h-3 w-3" /> Repartido · {r.negocios_ids.length}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: '#1A1A1A' }}>{fmtCOP(r.valor_pagado)}</span>
                </button>

                {open && (
                  <div className="border-t px-3 py-2" style={{ borderColor: '#F3F4F6' }}>
                    <table className="w-full text-left text-[12px]">
                      <thead>
                        <tr style={{ color: '#9CA3AF' }}>
                          <th className="py-1 font-semibold">Negocio</th>
                          <th className="py-1 font-semibold">Etapa</th>
                          <th className="py-1 text-right font-semibold">Cargado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.porciones.map((p) => (
                          <tr key={p.cobro_id} className="border-t" style={{ borderColor: '#F3F4F6' }}>
                            <td className="py-1.5">
                              {p.negocio_id ? (
                                <Link href={`/negocios/${p.negocio_id}`} className="group inline-flex items-center gap-1">
                                  <span className="font-semibold" style={{ color: '#1A1A1A' }}>{p.negocio_codigo ?? '—'}</span>
                                  <span style={{ color: '#6B7280' }}>{p.negocio_nombre ?? ''}</span>
                                  <ExternalLink className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
                                </Link>
                              ) : (
                                <span className="italic" style={{ color: '#9CA3AF' }}>Sin negocio</span>
                              )}
                            </td>
                            <td className="py-1.5" style={{ color: '#6B7280' }}>{p.etapa_nombre ?? '—'}</td>
                            <td className="py-1.5 text-right tabular-nums">
                              {p.por_devolver ? (
                                <span className="inline-flex items-center gap-1 font-semibold" style={{ color: '#B45309' }}>
                                  <Undo2 className="h-3 w-3" /> {fmtCOP(Math.abs(p.monto))} por devolver
                                </span>
                              ) : (
                                <span className="font-semibold" style={{ color: '#1A1A1A' }}>{fmtCOP(p.monto)}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {porDevolver.length === 0 && r.porciones.length > 1 && (
                      <p className="mt-1.5 text-right text-[11px]" style={{ color: '#9CA3AF' }}>
                        Total cargado: <span className="font-semibold tabular-nums" style={{ color: '#1A1A1A' }}>{fmtCOP(r.valor_pagado)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Pestaña 1 — POR CONCILIAR (solo sobrepagos)
// ════════════════════════════════════════════════════════════════════════════

function TabPorConciliar({ data, onDone }: { data: ConciliacionV2; onDone: () => void }) {
  if (data.sobrepagos.length === 0 && data.porDevolver.length === 0) {
    return <Empty>No hay referencias con sobrepago por conciliar.</Empty>
  }

  return (
    <div className="space-y-4">
      {data.sobrepagos.map((s) => (
        <SobrepagoCard key={s.external_ref} sobrepago={s} candidatos={data.negociosConSaldo} onDone={onDone} />
      ))}

      {/* Sub-listado de devoluciones pendientes */}
      {data.porDevolver.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#6B7280' }}>
            <Undo2 className="h-3.5 w-3.5" /> Por devolver al cliente ({data.porDevolver.length})
          </h2>
          <div className="rounded-lg border" style={{ borderColor: '#E5E7EB' }}>
            <table className="w-full text-left text-[13px]">
              <tbody>
                {data.porDevolver.map((p) => (
                  <tr key={p.cobro_id} className="border-b last:border-0" style={{ borderColor: '#F3F4F6' }}>
                    <td className="px-3 py-2">
                      <Link href={`/negocios/${p.negocio_id}`} className="font-semibold" style={{ color: '#1A1A1A' }}>{p.negocio_codigo ?? '—'}</Link>
                      <span className="ml-1 text-[12px]" style={{ color: '#6B7280' }}>{p.negocio_nombre ?? ''}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: '#B45309' }}>{fmtCOP(Math.abs(p.monto))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>
            Trazable, sin impacto contable todavía.
          </p>
        </section>
      )}
    </div>
  )
}

// ── Tarjeta de un sobrepago: reparto editable inline + conciliar ──────────────

function SobrepagoCard({
  sobrepago: s,
  candidatos,
  onDone,
}: {
  sobrepago: SobrepagoRef
  candidatos: NegocioParaSplit[]
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [nuevoNegocio, setNuevoNegocio] = useState('')
  const [nuevoMonto, setNuevoMonto] = useState('')

  const cuadrado = s.remanente <= 1
  const idsAsignados = new Set(s.asignaciones.map((a) => a.negocio_id))
  // Candidatos: negocios con saldo, que no sean el origen ni ya estén asignados.
  const disponibles = candidatos.filter((c) => c.negocio_id !== s.negocio_id && !idsAsignados.has(c.negocio_id))

  function guardarPorcion(negocioId: string, monto: number) {
    startTransition(async () => {
      const res = await setPorcionReferencia({ external_ref: s.external_ref, negocio_id: negocioId, monto })
      if (res.success) onDone()
      else toast.error(res.error)
    })
  }

  function agregar() {
    if (!nuevoNegocio) return toast.error('Elige el negocio')
    const monto = Number(nuevoMonto)
    if (!monto || monto <= 0) return toast.error('Ingresa el monto a asignar')
    if (monto > s.remanente + 1) return toast.error('No puedes asignar más que el remanente')
    startTransition(async () => {
      const res = await setPorcionReferencia({ external_ref: s.external_ref, negocio_id: nuevoNegocio, monto })
      if (res.success) { setNuevoNegocio(''); setNuevoMonto(''); onDone() }
      else toast.error(res.error)
    })
  }

  function elegirNuevo(id: string) {
    setNuevoNegocio(id)
    const cand = disponibles.find((c) => c.negocio_id === id)
    const sugerido = cand ? Math.min(cand.diferencia, s.remanente) : s.remanente
    setNuevoMonto(sugerido > 0 ? String(sugerido) : '')
  }

  return (
    <div className="rounded-lg border" style={{ borderColor: cuadrado ? '#A7F3D0' : '#FECACA' }}>
      {/* Encabezado: referencia + pago + remanente */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: '#F3F4F6' }}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px]">{s.external_ref}</span>
          {s.fuente && <FuenteBadge fuente={s.fuente} small />}
          <span className="text-[12px]" style={{ color: '#6B7280' }}>
            Pagó <span className="font-semibold tabular-nums" style={{ color: '#1A1A1A' }}>{fmtCOP(s.valor_pagado)}</span>
          </span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide" style={{ color: '#6B7280' }}>Remanente</div>
          {cuadrado ? (
            <div className="inline-flex items-center gap-1 text-[15px] font-bold text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> $0
            </div>
          ) : (
            <div className="text-[15px] font-bold tabular-nums" style={{ color: '#DC2626' }}>{fmtCOP(s.remanente)}</div>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {/* Asignaciones agrupadas por negocio (editables) */}
        <div className="space-y-1.5">
          {s.asignaciones.map((a) => (
            <div key={a.negocio_id ?? 'sin'} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Link href={`/negocios/${a.negocio_id}`} className="group inline-flex items-center gap-1 text-[13px]">
                  <span className="font-semibold" style={{ color: '#1A1A1A' }}>{a.codigo ?? '—'}</span>
                  <span className="truncate" style={{ color: '#6B7280' }}>{a.nombre ?? ''}</span>
                  <ExternalLink className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
                </Link>
                {a.es_origen && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ color: '#6B7280' }}>Origen</span>
                )}
              </div>
              <input
                key={`${a.negocio_id}-${a.monto}`}
                defaultValue={a.monto}
                onBlur={(e) => {
                  const v = Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)
                  if (v !== a.monto) guardarPorcion(a.negocio_id as string, v)
                }}
                inputMode="numeric"
                disabled={pending}
                className="w-32 rounded-md border px-2 py-1 text-right text-[13px] tabular-nums outline-none disabled:opacity-50"
                style={{ borderColor: '#E5E7EB' }}
              />
              {!a.es_origen && (
                <button
                  onClick={() => guardarPorcion(a.negocio_id as string, 0)}
                  disabled={pending}
                  title="Quitar esta asignación (el monto vuelve al remanente)"
                  className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Agregar un negocio nuevo al reparto */}
        {!cuadrado && (
          <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: '#F3F4F6' }}>
            <select
              value={nuevoNegocio}
              onChange={(e) => elegirNuevo(e.target.value)}
              disabled={pending}
              className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-[12px] outline-none disabled:opacity-50"
              style={{ borderColor: '#E5E7EB' }}
            >
              <option value="">Asignar remanente a otro negocio…</option>
              {disponibles.map((c) => (
                <option key={c.negocio_id} value={c.negocio_id}>{c.codigo ?? c.nombre} · falta {fmtCOP(c.diferencia)}</option>
              ))}
            </select>
            <input
              value={nuevoMonto}
              onChange={(e) => setNuevoMonto(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="monto"
              disabled={pending}
              className="w-32 rounded-md border px-2 py-1.5 text-right text-[12px] tabular-nums outline-none disabled:opacity-50"
              style={{ borderColor: '#E5E7EB' }}
            />
            <button
              onClick={agregar}
              disabled={pending || !nuevoNegocio}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: VERDE }}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Asignar
            </button>
          </div>
        )}

        {/* Conciliar (solo en remanente $0) */}
        <div className="flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: '#F3F4F6' }}>
          <span className="text-[11px]" style={{ color: '#9CA3AF' }}>
            {cuadrado ? 'Todo el pago quedó repartido. Ya puedes conciliar.' : 'Reparte el remanente hasta $0 para poder conciliar.'}
          </span>
          <button
            disabled={pending || !cuadrado}
            onClick={() => startTransition(async () => {
              const res = await conciliarReferencia(s.external_ref, s.negocio_id)
              if (res.success) { toast.success('Referencia conciliada'); onDone() }
              else toast.error(res.error)
            })}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: cuadrado ? VERDE : '#E5E7EB', color: cuadrado ? VERDE : '#9CA3AF' }}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Conciliar
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Pestaña 2 — SALDOS (con búsqueda)
// ════════════════════════════════════════════════════════════════════════════

type SaldoFiltro = 'sobrante' | 'faltante' | 'cero'

function TabSaldos({ data }: { data: ConciliacionV2 }) {
  const [q, setQ] = useState('')
  // Por defecto visibles los sobrantes; faltantes y en cero se activan al picar.
  const [filtros, setFiltros] = useState<Record<SaldoFiltro, boolean>>({ sobrante: true, faltante: false, cero: false })
  const query = q.trim().toLowerCase()

  // Totales (siempre sobre TODO el universo, no dependen del filtro).
  const totales = useMemo(() => {
    let sobrante = 0
    let faltante = 0
    for (const n of data.saldos) {
      if (n.saldo < -1) sobrante += Math.abs(n.saldo)
      else if (n.saldo > 1) faltante += n.saldo
    }
    return { sobrante, faltante, diferencia: faltante - sobrante }
  }, [data])

  const universo = useMemo<NegocioSaldo[]>(() => {
    const out: NegocioSaldo[] = []
    if (filtros.sobrante) out.push(...data.saldos.filter((n) => n.saldo < -1))
    if (filtros.faltante) out.push(...data.saldos.filter((n) => n.saldo > 1))
    if (filtros.cero) out.push(...data.conciliados)
    return out
  }, [data, filtros])

  const filtradas = useMemo(() => {
    if (!query) return universo
    return universo.filter((n) =>
      [n.codigo, n.nombre, n.empresa, ...n.referencias.map((r) => r.external_ref)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query)),
    )
  }, [universo, query])

  const toggle = (k: SaldoFiltro) => setFiltros((f) => ({ ...f, [k]: !f[k] }))

  const cards: { label: string; value: number; color: string; hint: string }[] = [
    { label: 'Sobrante (sin definir)', value: totales.sobrante, color: '#DC2626', hint: 'Pagos de más por distribuir' },
    { label: 'Faltante (cartera)', value: totales.faltante, color: '#B45309', hint: 'Saldo por cobrar' },
    { label: 'Diferencia neta', value: totales.diferencia, color: '#1A1A1A', hint: 'Faltante − sobrante' },
  ]

  const chips: { key: SaldoFiltro; label: string; on: string; text: string }[] = [
    { key: 'sobrante', label: 'Sobrantes', on: '#FEE2E2', text: '#DC2626' },
    { key: 'faltante', label: 'Faltantes', on: '#FEF3C7', text: '#B45309' },
    { key: 'cero', label: 'En cero', on: '#D1FAE5', text: '#047857' },
  ]

  return (
    <div>
      {/* Tarjetas de resumen */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border bg-white p-3" style={{ borderColor: '#E5E7EB' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>{c.label}</div>
            <div className="mt-1 text-[15px] font-bold tabular-nums sm:text-[18px]" style={{ color: c.color }}>{fmtCOP(c.value)}</div>
            <div className="mt-0.5 text-[10px]" style={{ color: '#9CA3AF' }}>{c.hint}</div>
          </div>
        ))}
      </div>

      {/* Filtros rápidos */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chips.map((c) => {
          const active = filtros[c.key]
          return (
            <button
              key={c.key}
              onClick={() => toggle(c.key)}
              className="rounded-full border px-3 py-1 text-[12px] font-semibold transition"
              style={active
                ? { backgroundColor: c.on, color: c.text, borderColor: c.on }
                : { backgroundColor: 'white', color: '#6B7280', borderColor: '#E5E7EB' }}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {/* Búsqueda */}
      <div className="mb-3 flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: '#E5E7EB' }}>
        <Search className="h-4 w-4" style={{ color: '#9CA3AF' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Busca por negocio o referencia (dentro del filtro activo)…"
          className="w-full text-[13px] outline-none"
          style={{ color: '#1A1A1A' }}
        />
      </div>

      {filtradas.length === 0 ? (
        <Empty>{query ? 'Sin resultados para la búsqueda.' : 'Nada que mostrar con los filtros activos.'}</Empty>
      ) : (
        <div className="space-y-2">
          {filtradas.map((n) => (
            <div key={n.negocio_id} className="rounded-lg border p-3" style={{ borderColor: '#E5E7EB' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/negocios/${n.negocio_id}`} className="group inline-flex items-center gap-1">
                    <span className="font-semibold" style={{ color: '#1A1A1A' }}>{n.codigo ?? '—'}</span>
                    <span className="text-[12px]" style={{ color: '#6B7280' }}>{n.empresa ?? n.nombre ?? ''}</span>
                    <ExternalLink className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
                  </Link>
                  <div className="mt-0.5 text-[11px]" style={{ color: '#9CA3AF' }}>
                    {n.etapa_nombre ?? ''}{n.responsable ? ` · ${n.responsable}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {Math.abs(n.saldo) <= 1 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> Pagado
                    </span>
                  ) : n.saldo > 0 ? (
                    <>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: '#6B7280' }}>Falta</div>
                      <div className="text-[14px] font-bold tabular-nums" style={{ color: '#B45309' }}>{fmtCOP(n.saldo)}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: '#6B7280' }}>Sobra</div>
                      <div className="text-[14px] font-bold tabular-nums" style={{ color: '#DC2626' }}>{fmtCOP(Math.abs(n.saldo))}</div>
                    </>
                  )}
                  <div className="mt-0.5 text-[10px]" style={{ color: '#9CA3AF' }}>
                    {fmtCOP(n.cobrado)} / {fmtCOP(n.precio)}
                  </div>
                </div>
              </div>
              {n.referencias.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2" style={{ borderColor: '#F3F4F6' }}>
                  {n.referencias.map((r) => (
                    <span key={r.external_ref} className="inline-flex items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-[11px]" style={{ color: '#6B7280' }}>
                      <span className="font-mono">{r.external_ref}</span>
                      {r.fuente && <FuenteBadge fuente={r.fuente} small />}
                      <span className="tabular-nums">{fmtCOP(r.monto)}</span>
                      {r.fecha && <span style={{ color: '#9CA3AF' }}>· {r.fecha}</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Modal — Agregar pago (panel base)
// ════════════════════════════════════════════════════════════════════════════

function AgregarPagoModal({
  negocios,
  onClose,
  onDone,
}: {
  negocios: { negocio_id: string; codigo: string | null; nombre: string | null }[]
  onClose: () => void
  onDone: () => void
}) {
  const [negocioId, setNegocioId] = useState('')
  const [fuente, setFuente] = useState<'epayco' | 'davivienda' | 'otra'>('epayco')
  const [fuenteNombre, setFuenteNombre] = useState('')
  const [referencia, setReferencia] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState('')
  const [pending, startTransition] = useTransition()

  const esEpayco = fuente === 'epayco'

  function handleSubmit() {
    if (!negocioId) return toast.error('Elige el negocio')
    if (!referencia.trim()) return toast.error('Ingresa la referencia del pago')
    if (!esEpayco && (!Number(monto) || Number(monto) <= 0)) return toast.error('Ingresa el monto del pago')
    if (fuente === 'otra' && !fuenteNombre.trim()) return toast.error('Indica el nombre de la fuente')

    startTransition(async () => {
      const res = await agregarPago({
        negocio_id: negocioId,
        fuente,
        fuente_nombre: fuente === 'otra' ? fuenteNombre.trim() : undefined,
        referencia: referencia.trim(),
        monto: esEpayco ? undefined : Number(monto),
        fecha: fecha || undefined,
      })
      if (res.success) {
        toast.success('Pago registrado')
        onDone()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" style={FONT}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4" style={{ color: VERDE }} />
            <h3 className="text-[15px] font-bold" style={{ color: '#1A1A1A' }}>Agregar pago</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" style={{ color: '#6B7280' }} /></button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <Field label="Negocio">
            <select value={negocioId} onChange={(e) => setNegocioId(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }}>
              <option value="">Elige negocio…</option>
              {negocios.map((n) => (
                <option key={n.negocio_id} value={n.negocio_id}>{n.codigo ?? n.nombre} · {n.nombre ?? ''}</option>
              ))}
            </select>
          </Field>

          <Field label="Fuente del pago">
            <div className="grid grid-cols-3 gap-2">
              {(['epayco', 'davivienda', 'otra'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFuente(f)}
                  className="rounded-md border px-2 py-1.5 text-[12px] font-semibold capitalize transition"
                  style={fuente === f
                    ? { borderColor: VERDE, color: VERDE, backgroundColor: '#ECFDF5' }
                    : { borderColor: '#E5E7EB', color: '#6B7280' }}
                >
                  {f === 'epayco' ? 'ePayco' : f === 'davivienda' ? 'Davivienda' : 'Otra'}
                </button>
              ))}
            </div>
          </Field>

          {fuente === 'otra' && (
            <Field label="Nombre de la fuente">
              <input value={fuenteNombre} onChange={(e) => setFuenteNombre(e.target.value)} placeholder="ej. Bancolombia, Nequi, efectivo…" className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
            </Field>
          )}

          <Field label={esEpayco ? 'Referencia ePayco (ref_payco)' : 'Referencia / comprobante'}>
            <input
              value={referencia}
              onChange={(e) => setReferencia(esEpayco ? e.target.value.replace(/[^\d]/g, '') : e.target.value)}
              inputMode={esEpayco ? 'numeric' : 'text'}
              placeholder={esEpayco ? 'ej. 123456789' : 'ej. comprobante o nº de transacción'}
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
            {esEpayco && <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>Se valida con ePayco: solo se registra si está Aceptada.</p>}
          </Field>

          {!esEpayco && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Monto">
                <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="0" className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none" style={{ borderColor: '#E5E7EB' }} />
              </Field>
              <Field label="Fecha">
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
              </Field>
            </div>
          )}

        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] font-semibold" style={{ color: '#6B7280' }}>Cancelar</button>
          <button onClick={handleSubmit} disabled={pending} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: VERDE }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Registrar pago
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Primitivos ───────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold" style={{ color: '#1A1A1A' }}>{label}</span>
      {children}
    </label>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed px-4 py-8 text-center text-[13px]" style={{ borderColor: '#E5E7EB', color: '#6B7280' }}>
      {children}
    </p>
  )
}

function FuenteBadge({ fuente, small }: { fuente: string; small?: boolean }) {
  const label = fuente === 'epayco' ? 'ePayco' : fuente === 'externo' ? 'Externo' : fuente.charAt(0).toUpperCase() + fuente.slice(1)
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${small ? 'px-1.5 py-0 text-[9px]' : 'px-2 py-0.5 text-[10px]'}`}
      style={{ backgroundColor: '#EEF2FF', color: '#4F46E5' }}
    >
      {label}
    </span>
  )
}
