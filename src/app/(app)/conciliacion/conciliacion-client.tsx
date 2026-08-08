'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Scale, CheckCircle2, Loader2, X, ExternalLink,
  Search, Wallet, LayoutGrid, ArrowRightLeft, Undo2, ChevronRight, ChevronDown,
  Landmark, Clock, FileText, AlertTriangle,
} from 'lucide-react'
import {
  aceptarRepartoComercial,
  rechazarRepartoComercial,
  getNegociosParaPagoFueraEpayco,
  registrarPagoFueraEpayco,
  type ConciliacionV2,
  type NegocioParaPagoFueraEpayco,
  type NegocioSaldo,
  type ReferenciaPago,
} from '@/lib/actions/conciliacion-actions'
import { MAX_LARGO_REF_EXTERNA, referenciaVisible } from '@/lib/cobros/referencia-externa'
import type { ColaFacturacion, CasoPorFacturar } from '@/lib/actions/facturacion-actions'
import { descartarDeFacturacion, restaurarEnFacturacion } from '@/lib/actions/facturacion-actions'
import { saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'
import { etiquetaAntiguedad } from '@/lib/negocios/antiguedad'

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

const VERDE = '#10B981'
const FONT = { fontFamily: 'var(--font-montserrat), Montserrat, sans-serif' }

type TabKey = 'bandeja' | 'saldos' | 'general' | 'fuera_epayco' | 'facturacion'

/**
 * Panel de conciliación de la FINANCIERA — SOLO aceptar o rechazar lo que el
 * comercial ya distribuyó. La financiera NO agrega pagos ePayco ni distribuye (eso
 * vive en el bloque de pagos del negocio). Pestañas:
 *   - Bandeja: repartos propuestos por el comercial, pendientes de confirmar →
 *     Aceptar (conciliar) / Rechazar (devolver al comercial con nota).
 *   - Saldos: vista de solo lectura de la cartera (falta/sobra por negocio).
 *   - Vista general: registro read-only de todas las referencias de pago.
 *   - Pago fuera de ePayco: captura excepcional de un ingreso que cayó a una cuenta
 *     bancaria. NO es conciliación — por eso vive en su propia pestaña, aislada de
 *     la bandeja de aceptar/rechazar.
 */
export default function ConciliacionClient({ data, cola }: { data: ConciliacionV2; cola: ColaFacturacion | null }) {
  const router = useRouter()

  // Repartos propuestos por el comercial, pendientes de confirmar.
  const pendientes = useMemo(
    () => data.referencias.filter((r) => r.propuesto_por_comercial && !r.algun_conciliado),
    [data],
  )

  const [tab, setTab] = useState<TabKey>(pendientes.length > 0 ? 'bandeja' : 'general')

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'bandeja', label: 'Por confirmar', count: pendientes.length },
    { key: 'saldos', label: 'Saldos', count: data.metricas.en_saldo },
    { key: 'general', label: 'Vista general' },
    { key: 'fuera_epayco', label: 'Pago fuera de ePayco' },
    ...(cola ? [{ key: 'facturacion' as TabKey, label: 'Por facturar', count: cola.totales.listos + cola.totales.incompletos }] : []),
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6" style={FONT}>
      {/* ── Encabezado ── */}
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5" style={{ color: VERDE }} />
          <h1 className="text-lg font-bold" style={{ color: '#1A1A1A' }}>Tesorería</h1>
        </div>
        <p className="mt-1 text-[13px]" style={{ color: '#6B7280' }}>
          Facturación, confirmación de pagos y saldos. Los pagos los registra el comercial desde el
          bloque de pagos de cada negocio; aquí se confirman.
        </p>
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

      {tab === 'bandeja' && <TabBandeja pendientes={pendientes} onDone={() => router.refresh()} />}
      {tab === 'saldos' && <TabSaldos data={data} />}
      {tab === 'general' && <VistaGeneral data={data} onTab={setTab} />}
      {tab === 'fuera_epayco' && <TabPagoFueraEpayco onDone={() => router.refresh()} />}
      {tab === 'facturacion' && cola && <TabFacturacion cola={cola} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BANDEJA — repartos del comercial pendientes de confirmar
// ════════════════════════════════════════════════════════════════════════════

function TabBandeja({ pendientes, onDone }: { pendientes: ReferenciaPago[]; onDone: () => void }) {
  if (pendientes.length === 0) {
    return <Empty>No hay pagos por confirmar. Cuando el comercial registre un pago, aparecerá aquí.</Empty>
  }
  return (
    <div className="space-y-4">
      {pendientes.map((r) => (
        <RepartoCard key={r.external_ref} ref_={r} onDone={onDone} />
      ))}
    </div>
  )
}

function RepartoCard({ ref_: r, onDone }: { ref_: ReferenciaPago; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [rechazando, setRechazando] = useState(false)
  const [nota, setNota] = useState('')

  const porcionesReales = r.porciones.filter((p) => !p.por_devolver)
  const esReparto = porcionesReales.length > 1

  function aceptar() {
    startTransition(async () => {
      const res = await aceptarRepartoComercial(r.external_ref)
      if (res.success) { toast.success('Pago conciliado'); onDone() }
      else toast.error(res.error)
    })
  }

  function rechazar() {
    startTransition(async () => {
      const res = await rechazarRepartoComercial(r.external_ref, nota.trim() || undefined)
      if (res.success) { toast.success('Reparto devuelto al comercial'); onDone() }
      else toast.error(res.error)
    })
  }

  return (
    <div className="rounded-lg border" style={{ borderColor: '#C7D2FE' }}>
      {/* Encabezado: referencia + total + badge propuesto */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: '#F3F4F6' }}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px]" title={r.external_ref}>{referenciaVisible(r.external_ref)}</span>
          {r.fuente && <FuenteBadge fuente={r.fuente} small />}
          {esReparto && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              <ArrowRightLeft className="h-3 w-3" /> Reparto · {porcionesReales.length}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
            Propuesto por el comercial
          </span>
        </div>
        <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: '#1A1A1A' }}>
          {fmtCOP(r.total_declarado ?? r.valor_pagado)}
        </span>
      </div>

      {/* Desglose por negocio (read-only) */}
      <div className="px-4 py-3">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr style={{ color: '#9CA3AF' }}>
              <th className="py-1 font-semibold">Negocio</th>
              <th className="py-1 font-semibold">Etapa</th>
              <th className="py-1 text-right font-semibold">Asignado</th>
            </tr>
          </thead>
          <tbody>
            {porcionesReales.map((p) => (
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
                <td className="py-1.5 text-right font-semibold tabular-nums" style={{ color: '#1A1A1A' }}>{fmtCOP(p.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.sin_asignar > 1 && (
          <p className="mt-1.5 text-right text-[11px] font-semibold" style={{ color: '#B45309' }}>
            Sin asignar: {fmtCOP(r.sin_asignar)}
          </p>
        )}
      </div>

      {/* Acciones: Aceptar / Rechazar */}
      {!rechazando ? (
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: '#F3F4F6' }}>
          <button
            onClick={() => setRechazando(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50"
            style={{ borderColor: '#E5E7EB', color: '#DC2626' }}
          >
            <X className="h-3.5 w-3.5" /> Rechazar
          </button>
          <button
            onClick={aceptar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: VERDE }}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Aceptar
          </button>
        </div>
      ) : (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: '#F3F4F6' }}>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Nota para el comercial (opcional)</span>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="ej. la referencia no cuadra con el banco…"
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setRechazando(false); setNota('') }}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ color: '#6B7280' }}
            >
              Cancelar
            </button>
            <button
              onClick={rechazar}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#DC2626' }}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Devolver al comercial
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// VISTA GENERAL — registro read-only de referencias
// ════════════════════════════════════════════════════════════════════════════

function VistaGeneral({ data, onTab }: { data: ConciliacionV2; onTab: (t: TabKey) => void }) {
  const m = data.metricas
  const pendientes = data.referencias.filter((r) => r.propuesto_por_comercial && !r.algun_conciliado).length
  const tiles: { label: string; value: number; tab: TabKey; icon: React.ReactNode }[] = [
    { label: 'Referencias cargadas', value: m.referencias_cargadas, tab: 'general', icon: <LayoutGrid className="h-4 w-4" /> },
    { label: 'Por confirmar', value: pendientes, tab: 'bandeja', icon: <Scale className="h-4 w-4" /> },
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
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {open ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: '#9CA3AF' }} /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: '#9CA3AF' }} />}
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px]" title={r.external_ref}>{referenciaVisible(r.external_ref)}</span>
                    {r.fuente && <FuenteBadge fuente={r.fuente} small />}
                    {multi && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <ArrowRightLeft className="h-3 w-3" /> Repartido · {r.negocios_ids.length}
                      </span>
                    )}
                    {r.propuesto_por_comercial && !r.algun_conciliado && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                        Propuesto por el comercial · pendiente de confirmar
                      </span>
                    )}
                    {r.algun_conciliado && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> Conciliado
                      </span>
                    )}
                    {r.sin_asignar > 1 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        Sin asignar {fmtCOP(r.sin_asignar)}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: '#1A1A1A' }}>{fmtCOP(r.total_declarado ?? r.valor_pagado)}</span>
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
// SALDOS — vista de solo lectura de la cartera
// ════════════════════════════════════════════════════════════════════════════

type SaldoFiltro = 'sobrante' | 'faltante' | 'cero'

function TabSaldos({ data }: { data: ConciliacionV2 }) {
  const [q, setQ] = useState('')
  const [filtros, setFiltros] = useState<Record<SaldoFiltro, boolean>>({ sobrante: true, faltante: false, cero: false })
  const query = q.trim().toLowerCase()

  const totales = useMemo(() => {
    let sobrante = 0
    let faltante = 0
    for (const n of data.saldos) {
      // Misma vara que el servidor: un residuo de redondeo no es ni sobrante ni
      // faltante. Con el umbral de $1 propio, la pestaña contradecía al panel.
      if (saldoCuadrado(n.saldo)) continue
      if (n.saldo < 0) sobrante += Math.abs(n.saldo)
      else faltante += n.saldo
    }
    return { sobrante, faltante, diferencia: faltante - sobrante }
  }, [data])

  const universo = useMemo<NegocioSaldo[]>(() => {
    const out: NegocioSaldo[] = []
    if (filtros.sobrante) out.push(...data.saldos.filter((n) => n.saldo < 0 && !saldoCuadrado(n.saldo)))
    if (filtros.faltante) out.push(...data.saldos.filter((n) => n.saldo > 0 && !saldoCuadrado(n.saldo)))
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
      <p className="mb-3 text-[11px]" style={{ color: '#9CA3AF' }}>
        Vista de solo lectura de la cartera. Para registrar o repartir un pago, entra al bloque de pagos del negocio.
      </p>

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
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px]" style={{ color: '#9CA3AF' }}>
                    <span>{n.etapa_nombre ?? ''}{n.responsable ? ` · ${n.responsable}` : ''}</span>
                    {n.dias_desde_creacion != null && (
                      <span
                        className="inline-flex items-center gap-1"
                        // Se nombra la referencia del contador en el tooltip: "24 días" a
                        // secas invita a leerlo como días de mora, y no lo son.
                        title={`El negocio se creó hace ${etiquetaAntiguedad(n.dias_desde_creacion)}. No es la antigüedad de la deuda: cuenta desde que nació el caso, no desde que se aprobó la propuesta.`}
                      >
                        <span aria-hidden>·</span>
                        <Clock className="h-3 w-3" />
                        {etiquetaAntiguedad(n.dias_desde_creacion)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {saldoCuadrado(n.saldo) ? (
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
                  <div
                    className="mt-0.5 text-[10px]"
                    style={{ color: '#9CA3AF' }}
                    title={
                      n.tarifa_upme > 0
                        ? `Honorario ${fmtCOP(n.precio)} + tarifa UPME ${fmtCOP(n.tarifa_upme)}`
                        : undefined
                    }
                  >
                    {fmtCOP(n.cobrado)} / {fmtCOP(n.valor_a_recaudar)}
                  </div>
                </div>
              </div>
              {n.referencias.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2" style={{ borderColor: '#F3F4F6' }}>
                  {n.referencias.map((r) => (
                    <span key={r.external_ref} className="inline-flex items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-[11px]" style={{ color: '#6B7280' }}>
                      <span className="font-mono" title={r.external_ref}>{referenciaVisible(r.external_ref)}</span>
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
// PAGO FUERA DE ePAYCO — captura excepcional del área financiera
// ════════════════════════════════════════════════════════════════════════════

/**
 * Registro de un pago que NO entró por la pasarela: cayó a Davivienda u otra cuenta.
 * Formulario mínimo — negocio, valor, fecha, cuenta y referencia OPCIONAL (número de
 * consignación o comprobante, para trazabilidad). Sin referencia el registro NO se
 * bloquea: el sistema genera una interna. NO reparte y NO concilia: es solo la captura
 * del ingreso contra el negocio. Deliberadamente separado de la bandeja de
 * aceptar/rechazar repartos.
 */
function TabPagoFueraEpayco({ onDone }: { onDone: () => void }) {
  const hoyBogota = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

  const [negocios, setNegocios] = useState<NegocioParaPagoFueraEpayco[]>([])
  const [cargando, setCargando] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [negocioId, setNegocioId] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyBogota)
  const [fuente, setFuente] = useState<'davivienda' | 'otra'>('davivienda')
  const [referencia, setReferencia] = useState('')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancel = false
    getNegociosParaPagoFueraEpayco().then((res) => {
      if (cancel) return
      if (res.error) setLoadError(res.error)
      else setNegocios(res.negocios)
      setCargando(false)
    })
    return () => { cancel = true }
  }, [])

  const seleccionado = useMemo(
    () => negocios.find((n) => n.negocio_id === negocioId) ?? null,
    [negocios, negocioId],
  )

  const query = q.trim().toLowerCase()
  const resultados = useMemo(() => {
    if (!query) return []
    return negocios
      .filter((n) => [n.codigo, n.nombre, n.empresa].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query)))
      .slice(0, 8)
  }, [negocios, query])

  function registrar() {
    if (!negocioId) return toast.error('Elige el negocio al que cae el pago')
    const valor = Number(monto)
    if (!Number.isFinite(valor) || valor <= 0) return toast.error('Ingresa el valor del pago')

    startTransition(async () => {
      const res = await registrarPagoFueraEpayco({
        negocio_id: negocioId,
        monto: valor,
        fecha: fecha || undefined,
        fuente,
        referencia: referencia.trim() || undefined,
      })
      if (res.success) {
        toast.success('Pago registrado')
        setNegocioId(''); setQ(''); setMonto(''); setFecha(hoyBogota); setFuente('davivienda'); setReferencia('')
        onDone()
      } else {
        toast.error(res.error)
      }
    })
  }

  const cuentas: { key: 'davivienda' | 'otra'; label: string }[] = [
    { key: 'davivienda', label: 'Davivienda' },
    { key: 'otra', label: 'Otra cuenta' },
  ]

  return (
    <div className="max-w-xl">
      <div className="mb-4 rounded-lg border px-4 py-3" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
        <div className="flex items-center gap-1.5">
          <Landmark className="h-4 w-4" style={{ color: '#B45309' }} />
          <h2 className="text-[13px] font-bold" style={{ color: '#92400E' }}>Registro excepcional</h2>
        </div>
        <p className="mt-1 text-[12px]" style={{ color: '#92400E' }}>
          Solo para el dinero que entró a una cuenta bancaria y no por ePayco. Se registra
          el valor contra el negocio y queda marcado como pago fuera de ePayco. No reparte
          ni concilia: eso se hace en la pestaña &quot;Por confirmar&quot;.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border bg-white p-4" style={{ borderColor: '#E5E7EB' }}>
        {/* Negocio */}
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Negocio</span>
          {cargando ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: '#6B7280' }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando negocios…
            </div>
          ) : loadError ? (
            <p className="text-[12px]" style={{ color: '#DC2626' }}>{loadError}</p>
          ) : seleccionado ? (
            <div className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5" style={{ borderColor: VERDE, backgroundColor: '#ECFDF5' }}>
              <span className="min-w-0 truncate text-[13px]">
                <span className="font-semibold" style={{ color: '#1A1A1A' }}>{seleccionado.codigo ?? '—'}</span>
                <span style={{ color: '#6B7280' }}> · {seleccionado.empresa ?? seleccionado.nombre ?? ''}</span>
              </span>
              <button
                onClick={() => { setNegocioId(''); setQ('') }}
                className="shrink-0 rounded p-0.5 hover:bg-white"
                aria-label="Cambiar negocio"
              >
                <X className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: '#E5E7EB' }}>
                <Search className="h-4 w-4" style={{ color: '#9CA3AF' }} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Busca por código, empresa o nombre…"
                  className="w-full text-[13px] outline-none"
                  style={{ color: '#1A1A1A' }}
                />
              </div>
              {query && (
                resultados.length === 0 ? (
                  <p className="mt-1.5 text-[12px]" style={{ color: '#9CA3AF' }}>Sin resultados.</p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {resultados.map((n) => (
                      <button
                        key={n.negocio_id}
                        onClick={() => setNegocioId(n.negocio_id)}
                        className="block w-full rounded-md border px-2.5 py-1.5 text-left text-[13px] transition hover:bg-gray-50"
                        style={{ borderColor: '#E5E7EB' }}
                      >
                        <span className="font-semibold" style={{ color: '#1A1A1A' }}>{n.codigo ?? '—'}</span>
                        <span style={{ color: '#6B7280' }}> · {n.empresa ?? n.nombre ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </label>

        {/* Valor + fecha */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Valor</span>
            <input
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="ej. 1500000"
              className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
            {Number(monto) > 0 && (
              <p className="mt-1 text-right text-[11px] font-semibold" style={{ color: VERDE }}>{fmtCOP(Number(monto))}</p>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>Fecha del pago</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ borderColor: '#E5E7EB' }}
            />
          </label>
        </div>

        {/* Cuenta */}
        <div>
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>¿A qué cuenta entró?</span>
          <div className="grid grid-cols-2 gap-2">
            {cuentas.map((c) => (
              <button
                key={c.key}
                onClick={() => setFuente(c.key)}
                className="rounded-md border px-2 py-1.5 text-[12px] font-semibold transition"
                style={fuente === c.key
                  ? { borderColor: VERDE, color: VERDE, backgroundColor: '#ECFDF5' }
                  : { borderColor: '#E5E7EB', color: '#6B7280' }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Referencia — opcional. Si no la tienes a mano, el sistema genera una interna. */}
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#374151' }}>
            Referencia <span className="font-normal" style={{ color: '#9CA3AF' }}>(opcional)</span>
          </span>
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value.slice(0, MAX_LARGO_REF_EXTERNA))}
            placeholder="N.º de consignación o comprobante"
            maxLength={MAX_LARGO_REF_EXTERNA}
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
            style={{ borderColor: '#E5E7EB' }}
          />
          <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>
            Si no la tienes a mano, déjala vacía: el sistema genera una referencia interna.
            Un mismo comprobante no se puede registrar dos veces.
          </p>
        </label>

        <div className="flex justify-end">
          <button
            onClick={registrar}
            disabled={pending || cargando}
            className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: VERDE }}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Registrar pago
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Primitivos ───────────────────────────────────────────────────────────────

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

// ── Pestaña: Por facturar ─────────────────────────────────────────────────────

/**
 * Cola de facturación del área financiera. Es la ÚNICA superficie desde la que
 * se factura: el negocio tendrá un botón, pero lleva aquí (decisión de Mauricio,
 * 2026-08-06, para que no existan dos vías de escritura del mismo documento).
 *
 * Esta versión LEE: muestra qué se puede facturar y qué le falta a cada caso.
 * La emisión contra Siigo se conecta después, sobre esta misma lista.
 */
type VistaFact = 'pendientes' | 'descartados' | 'facturados'

function TabFacturacion({ cola }: { cola: ColaFacturacion }) {
  const router = useRouter()
  const [vista, setVista] = useState<VistaFact>('pendientes')

  if (cola.desde_etapa_numero == null) {
    return (
      <div className="rounded-lg border p-6 text-center" style={{ borderColor: '#E5E7EB' }}>
        <FileText className="mx-auto h-8 w-8" style={{ color: '#D1D5DB' }} />
        <p className="mt-2 text-[13px] font-semibold" style={{ color: '#1A1A1A' }}>Facturación sin configurar</p>
        <p className="mt-1 text-[12px]" style={{ color: '#6B7280' }}>
          Falta definir desde qué etapa se habilita facturar. Mientras no esté, esta bandeja no
          asume ningún criterio: prefiere estar vacía a llenarse de casos que nadie mandó facturar.
        </p>
      </div>
    )
  }

  const facturados = cola.casos.filter(c => c.ya_facturado)
  const descartados = cola.casos.filter(c => !c.ya_facturado && c.descartado != null)
  const pendientes = cola.casos.filter(c => !c.ya_facturado && c.descartado == null)
  const visibles = vista === 'facturados' ? facturados : vista === 'descartados' ? descartados : pendientes

  return (
    <div>
      {/* Resumen */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Listos para facturar', value: String(cola.totales.listos), destaque: true },
          { label: 'Les falta un dato', value: String(cola.totales.incompletos) },
          { label: 'Descartados', value: String(cola.totales.descartados) },
          { label: 'Valor listo', value: fmtCOP(cola.totales.valor_listo) },
        ].map(t => (
          <div key={t.label} className="rounded-lg border px-3 py-2" style={{ borderColor: '#E5E7EB' }}>
            <div className="text-[11px]" style={{ color: '#6B7280' }}>{t.label}</div>
            <div className="text-[15px] font-bold" style={{ color: t.destaque ? VERDE : '#1A1A1A' }}>{t.value}</div>
          </div>
        ))}
      </div>

      {!cola.siigo_configurado && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2"
             style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#B45309' }} />
          <p className="text-[12px]" style={{ color: '#92400E' }}>
            Este espacio todavía no tiene la conexión contable configurada. La lista se puede
            revisar, pero no se puede emitir nada.
          </p>
        </div>
      )}

      {cola.descarte_abierto && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12px]"
             style={{ borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', color: '#6B7280' }}>
          <strong style={{ color: '#1A1A1A' }}>Puesta al día:</strong> puedes descartar los casos que ya
          se facturaron por fuera o que no van a facturarse. Se pueden devolver a la cola en cualquier
          momento. Esta opción está disponible hasta el {cola.descarte_hasta}.
        </div>
      )}

      {/* Selector de vista */}
      <div className="mb-3 flex flex-wrap gap-1">
        {([
          { k: 'pendientes' as VistaFact, label: `Pendientes (${pendientes.length})` },
          { k: 'descartados' as VistaFact, label: `Descartados (${descartados.length})` },
          { k: 'facturados' as VistaFact, label: `Ya facturados (${facturados.length})` },
        ]).map(o => (
          <button
            key={o.k}
            onClick={() => setVista(o.k)}
            className="rounded-full border px-3 py-1 text-[12px] font-medium transition"
            style={{
              borderColor: vista === o.k ? VERDE : '#E5E7EB',
              backgroundColor: vista === o.k ? '#D1FAE5' : 'transparent',
              color: vista === o.k ? '#047857' : '#6B7280',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="rounded-lg border p-6 text-center" style={{ borderColor: '#E5E7EB' }}>
          <p className="text-[13px]" style={{ color: '#6B7280' }}>
            {vista === 'facturados' ? 'Ningún caso registra factura todavía.'
              : vista === 'descartados' ? 'No has descartado ningún caso.'
              : 'No hay casos por facturar.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibles.map(c => (
            <FilaPorFacturar
              key={c.negocio_id}
              caso={c}
              descarteAbierto={cola.descarte_abierto}
              onCambio={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilaPorFacturar({
  caso, descarteAbierto, onCambio,
}: { caso: CasoPorFacturar; descarteAbierto: boolean; onCambio: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false)
  const [motivo, setMotivo] = useState('')

  const confirmarDescarte = () => {
    startTransition(async () => {
      const r = await descartarDeFacturacion(caso.negocio_id, motivo)
      if (r.error) { toast.error(r.error); return }
      toast.success(`${caso.codigo ?? 'Caso'} descartado de la cola`)
      setPidiendoMotivo(false); setMotivo(''); onCambio()
    })
  }

  const restaurar = () => {
    startTransition(async () => {
      const r = await restaurarEnFacturacion(caso.negocio_id)
      if (r.error) { toast.error(r.error); return }
      toast.success(`${caso.codigo ?? 'Caso'} devuelto a la cola`)
      onCambio()
    })
  }

  // Un caso está listo cuando puede emitirse la factura del honorario. El recibo
  // del recaudo UPME se reporta aparte: es otro documento y otra plata (de un
  // tercero), así que su falta NO debe frenar la factura.
  const listo = caso.faltan_factura.length === 0 && caso.faltan_cliente.length === 0
  const faltas = [...new Set([...caso.faltan_cliente, ...caso.faltan_factura])]

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: listo ? '#A7F3D0' : '#E5E7EB' }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/negocios/${caso.negocio_id}`} className="text-[13px] font-semibold hover:underline"
                  style={{ color: '#1A1A1A' }}>
              {caso.codigo ?? 'sin código'}
            </Link>
            <span className="truncate text-[13px]" style={{ color: '#1A1A1A' }}>{caso.nombre ?? ''}</span>
            {caso.ya_facturado && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ backgroundColor: '#D1FAE5', color: '#047857' }}>Facturado</span>
            )}
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: '#6B7280' }}>
            {[caso.cliente, caso.identificacion, caso.etapa].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[14px] font-bold" style={{ color: '#1A1A1A' }}>
            {caso.honorario == null ? 'sin precio' : fmtCOP(caso.honorario)}
          </div>
          {caso.valor_upme != null && (
            <div className="text-[11px]" style={{ color: '#6B7280' }}>
              recaudo UPME {fmtCOP(caso.valor_upme)}
            </div>
          )}
        </div>
      </div>

      {!caso.ya_facturado && faltas.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium" style={{ color: '#B45309' }}>Falta:</span>
          {faltas.map(f => (
            <span key={f} className="rounded-full px-2 py-0.5 text-[10px]"
                  style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>{f}</span>
          ))}
        </div>
      )}

      {!caso.ya_facturado && listo && caso.faltan_recibo.length > 0 && (
        <div className="mt-2 text-[11px]" style={{ color: '#6B7280' }}>
          La factura del honorario puede salir. El recibo del recaudo UPME no: falta{' '}
          {caso.faltan_recibo.join(', ')}.
        </div>
      )}

      {/* Descartado: se dice quién y por qué, y se puede deshacer */}
      {caso.descartado && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5"
             style={{ backgroundColor: '#F9FAFB' }}>
          <span className="text-[11px]" style={{ color: '#6B7280' }}>
            Descartado{caso.descartado.por ? ` por ${caso.descartado.por}` : ''}
            {caso.descartado.motivo ? ` · ${caso.descartado.motivo}` : ''}
          </span>
          <button
            onClick={restaurar}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:opacity-50"
            style={{ borderColor: '#E5E7EB', color: '#1A1A1A' }}
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
            Devolver a la cola
          </button>
        </div>
      )}

      {/* Descartar: solo mientras la ventana de puesta al día siga abierta */}
      {!caso.ya_facturado && !caso.descartado && descarteAbierto && (
        pidiendoMotivo ? (
          <div className="mt-2 rounded-md border p-2" style={{ borderColor: '#E5E7EB' }}>
            <input
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Motivo (opcional): ya facturado por fuera, no aplica…"
              className="w-full rounded-md border px-2 py-1 text-[12px] focus:outline-none"
              style={{ borderColor: '#E5E7EB' }}
              autoFocus
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={confirmarDescarte}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-white transition disabled:opacity-50"
                style={{ backgroundColor: '#B45309' }}
              >
                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Confirmar descarte
              </button>
              <button
                onClick={() => { setPidiendoMotivo(false); setMotivo('') }}
                className="rounded-md border px-2 py-1 text-[11px] font-medium"
                style={{ borderColor: '#E5E7EB', color: '#6B7280' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => setPidiendoMotivo(true)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition"
              style={{ borderColor: '#E5E7EB', color: '#6B7280' }}
            >
              <X className="h-3 w-3" />
              Descartar factura
            </button>
          </div>
        )
      )}
    </div>
  )
}
