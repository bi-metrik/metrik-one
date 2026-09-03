'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Scale, CheckCircle2, Loader2, X, ExternalLink,
  Search, Wallet, LayoutGrid, ArrowRightLeft, Undo2, ChevronRight, ChevronDown,
  Clock, FileText, AlertTriangle, Receipt, Check, Ban, Lock,
} from 'lucide-react'
import {
  aceptarRepartoComercial,
  rechazarRepartoComercial,
  type ConciliacionV2,
  type NegocioSaldo,
  type ReferenciaPago,
  type RefPorcion,
} from '@/lib/actions/conciliacion-actions'
import { anularCobro } from '@/lib/actions/pagos-externos'
import { MOTIVO_ANULACION_MIN } from '@/lib/cobros/anulacion'
import PagosExternosTab from './pagos-externos-tab'
import BusquedaInput from '@/components/busqueda-input'
import { telefonoCoincide } from '@/lib/busqueda/telefono'
import { RedistribuirModal } from './redistribuir-modal'
import { referenciaVisible } from '@/lib/cobros/referencia-externa'
import { imputarPago, escalonesDelNegocio } from '@/lib/upme/imputacion-pago'
import type { ColaFacturacion, CasoPorFacturar } from '@/lib/actions/facturacion-actions'
import { descartarDeFacturacion, restaurarEnFacturacion, emitirFacturaDeNegocio, emitirReciboDeNegocio } from '@/lib/actions/facturacion-actions'
import type { FacturaEnSiigo } from '@/lib/siigo/facturas'
import { casoListoParaFacturar, faltantesDelCaso } from '@/lib/facturacion/caso-listo'
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
      {tab === 'fuera_epayco' && <PagosExternosTab onDone={() => router.refresh()} />}
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
  const router = useRouter()
  const [q, setQ] = useState('')
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  /** Referencia que se está corrigiendo. null = el modal está cerrado. */
  const [redistribuyendo, setRedistribuyendo] = useState<ReferenciaPago | null>(null)
  /** Porción que se está anulando. null = nadie. */
  const [anulando, setAnulando] = useState<RefPorcion | null>(null)
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
                          <th className="py-1 text-right font-semibold sr-only">Anular</th>
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
                              {p.anulado ? (
                                // El monto de una fila anulada es 0: se muestra el que registró,
                                // tachado. Sumarlo sería resucitar la plata en pantalla.
                                <span className="font-semibold line-through" style={{ color: '#9CA3AF' }}>
                                  {fmtCOP(p.monto_registrado)}
                                </span>
                              ) : p.por_devolver ? (
                                <span className="inline-flex items-center gap-1 font-semibold" style={{ color: '#B45309' }}>
                                  <Undo2 className="h-3 w-3" /> {fmtCOP(Math.abs(p.monto))} por devolver
                                </span>
                              ) : (
                                <span className="font-semibold" style={{ color: '#1A1A1A' }}>{fmtCOP(p.monto)}</span>
                              )}
                            </td>
                            <td className="w-8 py-1.5 text-right">
                              {p.anulado ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold"
                                  style={{ color: '#9CA3AF' }}
                                  title={p.anulacion_motivo ?? undefined}
                                >
                                  <Ban className="h-3 w-3" /> Anulado
                                </span>
                              ) : p.anulable ? (
                                <button
                                  onClick={() => setAnulando(p)}
                                  title="Anular este cobro"
                                  className="inline-flex items-center rounded p-1 transition-colors hover:bg-[#FEF2F2]"
                                  style={{ color: '#DC2626' }}
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </button>
                              ) : (
                                // No se puede anular: el candado dice POR QUÉ. Esconder la razón
                                // deja al operador buscando un botón que no existe.
                                <span title={p.bloqueo_anulacion ?? undefined} style={{ color: '#D1D5DB' }}>
                                  <Lock className="inline h-3 w-3" />
                                </span>
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

                    {/* La corrección se hace desde aquí, que es donde se ve el error.
                        Antes solo existía deshacer un reparto ANTES de confirmarlo, y
                        para entonces nadie lo ha visto todavía. */}
                    <div className="mt-2 flex justify-end border-t pt-2" style={{ borderColor: '#F3F4F6' }}>
                      <button
                        onClick={() => setRedistribuyendo(r)}
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[#F5F4F2]"
                        style={{ borderColor: '#E5E7EB', color: '#1A1A1A' }}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" /> Corregir el reparto
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {redistribuyendo && (
        <RedistribuirModal
          referencia={redistribuyendo}
          onCerrar={() => setRedistribuyendo(null)}
          onListo={() => { setRedistribuyendo(null); router.refresh() }}
        />
      )}

      {anulando && (
        <ModalAnularPorcion
          porcion={anulando}
          onCerrar={() => setAnulando(null)}
          onListo={() => { setAnulando(null); router.refresh() }}
        />
      )}
    </section>
  )
}

/**
 * Anular UNA porción de una referencia, desde donde se ve el error.
 *
 * Vive en conciliación y no en la pantalla del negocio a propósito: anular es una
 * operación del área financiera (decisión de Mauricio, 2026-08-18), y el guard del
 * servidor (`ctxPagosExternos`) ya lo exige. Ponerla en el negocio la habría dejado a la
 * vista de comerciales y operativos que igual reciben un "no puedes".
 *
 * No es lo mismo que "Corregir el reparto": ahí la plata se MUEVE entre negocios y la
 * referencia sigue cuadrando. Aquí la plata no debía estar, y deja de contar.
 */
function ModalAnularPorcion({
  porcion, onCerrar, onListo,
}: { porcion: RefPorcion; onCerrar: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()
  const corto = motivo.trim().length < MOTIVO_ANULACION_MIN

  function anular() {
    if (corto) return toast.error(`Escribe el motivo (mínimo ${MOTIVO_ANULACION_MIN} caracteres)`)
    startTransition(async () => {
      const res = await anularCobro(porcion.cobro_id, motivo)
      if (res.success) { toast.success('Cobro anulado'); onListo() }
      else toast.error(res.error)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" style={FONT}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-bold" style={{ color: '#1A1A1A' }}>Anular cobro</h3>
          <button onClick={onCerrar} style={{ color: '#9CA3AF' }}><X className="h-4 w-4" /></button>
        </div>

        <p className="text-[12px]" style={{ color: '#B91C1C' }}>
          Anular <strong>{fmtCOP(porcion.monto_registrado)}</strong>
          {porcion.negocio_codigo ? <> de <strong>{porcion.negocio_codigo}</strong></> : null}. La fila
          se conserva con tu nombre, la fecha y el motivo; el negocio deja de contar esa plata y,
          si algún paso se había habilitado solo por ese saldo, se vuelve a exigir.
        </p>

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-semibold" style={{ color: '#7F1D1D' }}>Motivo</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="ej. se cargó dos veces la misma consignación"
            className="w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none"
            style={{ borderColor: '#FCA5A5' }}
          />
        </label>

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onCerrar} className="rounded-md border bg-white px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: '#E5E7EB', color: '#6B7280' }}>
            Cancelar
          </button>
          <button onClick={anular} disabled={pending || corto}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: '#DC2626' }}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Anular cobro
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SALDOS — vista de solo lectura de la cartera
// ════════════════════════════════════════════════════════════════════════════

type SaldoFiltro = 'sobrante' | 'faltante' | 'cero'

/**
 * Las dos bolsas de la fila, separadas: el HONORARIO (que sí es cartera de SOENA) y la
 * TARIFA UPME (plata de terceros que SOENA recauda y gira).
 *
 * Antes esta línea era un solo par, `cobrado / valor_a_recaudar`, que sumaba las dos.
 * El número está bien para el SOBRANTE — un cliente que paga honorario y tarifa en un
 * solo recaudo no pagó de más — pero leído en la pestaña de cartera dice que el cliente
 * le debe la tarifa a SOENA, y no se la debe: la tarifa es un gate para avanzar de
 * etapa, no un resultado financiero (decisión de Mauricio, 2026-08-18).
 *
 * ⚠️ Esto es SOLO presentación. `valor_a_recaudar` sigue igual y sigue siendo la vara
 * del sobrepago: medido contra producción el 2026-08-18, sacarle la tarifa inventaba
 * **42 sobrepagos por $27.848.113** en negocios abiertos. Es la regresión del #214.
 *
 * El recaudo se parte con `imputarPago`, la ÚNICA regla de imputación del sistema desde
 * el #314: honorario primero, después la tarifa. Acá no se escribe ninguna resta nueva.
 * El excedente no se pinta: ya lo dice el "Sobra" de la misma fila.
 *
 * ⚠️ El plan no viaja en la fila, así que se imputa como pago único. Es lo mismo que
 * hace el resto del panel, que arma su modelo con `aprobado_plan: null`.
 */
function DesgloseRecaudo({
  honorario,
  tarifa,
  cobrado,
}: {
  honorario: number
  tarifa: number
  cobrado: number
}) {
  const imputado = imputarPago({
    pago: cobrado,
    escalones: escalonesDelNegocio(honorario, tarifa, null),
  })
  const alHonorario = imputado.a_tramo1 + imputado.a_tramo2
  return (
    <div className="mt-0.5 text-[10px]" style={{ color: '#9CA3AF' }}>
      <div title="Honorario de SOENA. Esto es lo que sí es cartera.">
        Honorario {fmtCOP(alHonorario)} / {fmtCOP(honorario)}
      </div>
      {tarifa > 0 && (
        <div title="Tarifa UPME: plata de terceros que SOENA recauda y gira. No es cartera; solo condiciona el avance de etapa.">
          Tarifa UPME {fmtCOP(imputado.a_tarifa)} / {fmtCOP(tarifa)} · pasante
        </div>
      )}
    </div>
  )
}

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
    // El faltante SIEMPRE se midió contra el honorario (ver `saldoConciliacion`); lo que
    // faltaba era decirlo en la pantalla, que dejaba pensar que la tarifa entra a la cartera.
    { label: 'Faltante (cartera)', value: totales.faltante, color: '#B45309', hint: 'Honorario por cobrar · sin tarifa UPME' },
    { label: 'Diferencia neta', value: totales.diferencia, color: '#1A1A1A', hint: 'Faltante − sobrante' },
  ]

  const chips: { key: SaldoFiltro; label: string; on: string; text: string }[] = [
    { key: 'sobrante', label: 'Sobrantes', on: '#FEE2E2', text: '#DC2626' },
    { key: 'faltante', label: 'Faltantes', on: '#FEF3C7', text: '#B45309' },
    { key: 'cero', label: 'En cero', on: '#D1FAE5', text: '#047857' },
  ]

  return (
    <div>
      <p className="mb-1 text-[11px]" style={{ color: '#9CA3AF' }}>
        Vista de solo lectura de la cartera, ordenada de más viejo a más reciente. Para registrar o repartir un pago, entra al bloque de pagos del negocio.
      </p>
      {/*
        Las dos pantallas miden cosas distintas a propósito y por eso dan cifras
        distintas. Sin este renglón la diferencia se lee como un error de una de
        las dos, que es justo lo que hay que evitar.
      */}
      <p className="mb-3 text-[11px]" style={{ color: '#9CA3AF' }}>
        Acá entra <strong>todo negocio con precio aprobado</strong>, incluidos los que no tienen
        ningún pago registrado: la pregunta es qué casos no cuadran. El <strong>¿Cuánto me
        deben?</strong> de Números es más bajo porque solo cuenta los ya vendidos, o sea los que
        recibieron al menos un pago.
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
                  {/* La plata que espera TU visto bueno. Sin nombrarla, la fila diría
                      "faltan $X" sobre un pago que ya está registrado, y mandaría a
                      buscar algo que no se ha perdido: lo que falta es confirmarlo. */}
                  {n.pendiente_de_confirmar > 0 && (
                    <div
                      className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                      title="El comercial repartió este pago y todavía no lo has confirmado. Hasta entonces no cuenta como recaudo y el caso no avanza de etapa."
                    >
                      <Clock className="h-3 w-3" />
                      {fmtCOP(n.pendiente_de_confirmar)} sin confirmar
                    </div>
                  )}
                  <DesgloseRecaudo
                    honorario={n.precio}
                    tarifa={n.tarifa_upme}
                    cobrado={n.cobrado}
                  />
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

// El registro de pagos fuera de la pasarela vive en `./pagos-externos-tab.tsx`. Salio de
// este archivo el 2026-08-11 al dejar de ser un formulario suelto: ahora lleva listado de
// lo ya registrado, alerta de referencia sobre-asignada, soporte obligatorio y anulacion.

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

/**
 * Filtra la cola por lo tecleado. El teléfono va aparte de la comparación de
 * texto: el mismo número está guardado con indicativo, con paréntesis o pelado,
 * así que compararlo como cadena no encuentra casi nada (`lib/busqueda/telefono`).
 */
export function filtrarCasos(casos: CasoPorFacturar[], term: string): CasoPorFacturar[] {
  if (!term) return casos
  return casos.filter(c => {
    const hay = [c.codigo, c.nombre, c.cliente, c.identificacion, c.etapa,
      c.factura_numero, c.recibo_numero]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(term) || telefonoCoincide(c.telefono, term)
  })
}

function TabFacturacion({ cola }: { cola: ColaFacturacion }) {
  const router = useRouter()
  const [vista, setVista] = useState<VistaFact>('pendientes')
  const [q, setQ] = useState('')

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

  // La búsqueda se aplica ANTES de separar por vista, así que los tres contadores
  // del selector cuentan lo mismo que se va a listar. Los tiles de arriba siguen
  // siendo la foto de la cola completa: son el estado del trabajo, no del filtro.
  const term = q.trim().toLowerCase()
  const encontrados = filtrarCasos(cola.casos, term)
  const facturados = encontrados.filter(c => c.ya_facturado)
  const descartados = encontrados.filter(c => !c.ya_facturado && c.descartado != null)
  const pendientes = encontrados.filter(c => !c.ya_facturado && c.descartado == null)
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

      {/* Búsqueda — misma barra que la vista general de negocios */}
      <div className="mb-3">
        <BusquedaInput
          value={q}
          onChange={setQ}
          placeholder="Buscar por código, cliente, celular, cédula o etapa…"
          ariaLabel="Buscar casos por facturar"
        />
        {term && (
          <p className="mt-1.5 text-[11px]" style={{ color: '#6B7280' }}>
            {encontrados.length} de {cola.casos.length} casos
          </p>
        )}
      </div>

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
            {term ? `Sin resultados para "${q.trim()}" en esta vista.`
              : vista === 'facturados' ? 'Ningún caso registra factura todavía.'
              : vista === 'descartados' ? 'No has descartado ningún caso.'
              : 'No hay casos por facturar.'}
          </p>
          {term && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="mt-2 text-[12px] font-medium underline"
              style={{ color: VERDE }}
            >
              Limpiar búsqueda
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visibles.map(c => (
            <FilaPorFacturar
              key={c.negocio_id}
              caso={c}
              descarteAbierto={cola.descarte_abierto}
              siigoConfigurado={cola.siigo_configurado}
              productos={cola.productos}
              onCambio={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilaPorFacturar({
  caso, descarteAbierto, siigoConfigurado, productos, onCambio,
}: {
  caso: CasoPorFacturar
  descarteAbierto: boolean
  siigoConfigurado: boolean
  productos: ColaFacturacion['productos']
  onCambio: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false)
  const [motivo, setMotivo] = useState('')
  // Tres pasos a propósito: revisar la prefactura, confirmar, emitir. Una factura
  // electrónica aceptada por la DIAN no se deshace, así que el clic no puede
  // quedar a un solo movimiento de distancia.
  const [revisando, setRevisando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [duplicados, setDuplicados] = useState<FacturaEnSiigo[] | null>(null)
  const [justificacion, setJustificacion] = useState('')
  // Los datos que la financiera puede corregir antes de emitir. Arrancan con lo
  // que ONE tiene: la pantalla no es un formulario en blanco, es una revisión.
  const [email, setEmail] = useState(caso.email ?? '')
  const [telefono, setTelefono] = useState(caso.telefono ?? '')
  const [productoCode, setProductoCode] = useState(caso.concepto.code)

  /**
   * Solo viaja lo que de verdad cambió. Mandar el valor original en cada emisión
   * haría que abrir la pantalla reescribiera el contacto en Siigo sin que nadie lo
   * hubiera pedido.
   */
  const datosEditados = () => ({
    ...(email.trim() && email.trim() !== (caso.email ?? '') ? { email: email.trim() } : {}),
    ...(telefono.trim() && telefono.trim() !== (caso.telefono ?? '') ? { telefono: telefono.trim() } : {}),
    ...(productoCode && productoCode !== caso.concepto.code ? { productoCode } : {}),
  })

  const emitir = (justificacionDuplicado?: string) => {
    startTransition(async () => {
      const r = await emitirFacturaDeNegocio(caso.negocio_id, {
        justificacionDuplicado,
        datos: datosEditados(),
      })
      if (r.duplicados) { setDuplicados(r.duplicados); setConfirmando(false); return }
      if (!r.ok) { toast.error(r.error ?? 'No se pudo emitir'); return }
      // Si el PDF no quedó en el negocio hay que decirlo: la factura salió igual,
      // pero el expediente queda incompleto y en silencio nadie lo notaría.
      if (r.archivada === false) {
        toast.warning(`Factura ${r.numero} emitida, pero el PDF no quedó cargado en el negocio`)
      } else {
        toast.success(`Factura ${r.numero} emitida y archivada en el negocio`)
      }
      setRevisando(false); setConfirmando(false); setDuplicados(null); setJustificacion('')
      onCambio()
    })
  }

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

  // El criterio y la lista de faltantes salen del mismo módulo que usa el
  // servidor para contar la bandeja: dos copias se desincronizan en silencio.
  const listo = casoListoParaFacturar(caso)
  const faltas = faltantesDelCaso(caso)

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
                    style={{ backgroundColor: '#D1FAE5', color: '#047857' }}>
                {caso.factura_numero ?? 'Facturado'}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: '#6B7280' }}>
            {[caso.cliente, caso.identificacion, caso.etapa].filter(Boolean).join(' · ')}
          </div>
          {/* El concepto es lo que el cliente lee en la factura: se ve ANTES de
              emitir, no después. Cuando sale del default se advierte, porque
              entonces no refleja lo que el cliente contrató sino un supuesto. */}
          {!caso.ya_facturado && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span style={{ color: '#6B7280' }}>Concepto:</span>
              <span className="font-medium" style={{ color: '#1A1A1A' }}>
                {caso.concepto.nombre ?? `código ${caso.concepto.code}`}
              </span>
              {caso.concepto.porDefecto && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px]"
                      style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
                      title="Nadie declaró qué contrató el cliente: este concepto es el de por defecto.">
                  por defecto
                </span>
              )}
            </div>
          )}
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

      {/* ── El dinero recibido: recibo de caja, nunca factura ───────────── */}
      {/* Va aparte de la factura por decisión de Mauricio (2026-09-03): son dos
          documentos independientes. La factura se emite por el honorario pactado;
          el recibo acusa la plata que entregó el cliente. Mezclarlos en un botón
          invitaría a facturar plata que todavía no es ingreso. */}
      {siigoConfigurado && !caso.descartado && (
        <ReciboUpme caso={caso} onCambio={onCambio} />
      )}

      {/* ── Prefactura y emisión ─────────────────────────────────────────── */}
      {!caso.ya_facturado && !caso.descartado && listo && siigoConfigurado && (
        <div className="mt-2">
          {!revisando ? (
            <div className="flex justify-end">
              <button
                onClick={() => setRevisando(true)}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition"
                style={{ backgroundColor: VERDE }}
              >
                <FileText className="h-3.5 w-3.5" />
                Revisar y facturar
              </button>
            </div>
          ) : (
            <div className="rounded-md border p-3" style={{ borderColor: '#A7F3D0', backgroundColor: '#F0FDF4' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#047857' }}>
                Así saldría la factura
              </div>

              <dl className="mt-2 space-y-1 text-[12px]">
                {[
                  // Cliente e identificación NO se editan aquí: salen del RUT del
                  // expediente y cambiarlos es facturarle a otro, que es una
                  // decisión distinta y con su propio soporte documental.
                  ['Cliente', caso.cliente ?? '—'],
                  ['Identificación', caso.identificacion ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt style={{ color: '#6B7280' }}>{k}</dt>
                    <dd className="text-right" style={{ color: '#1A1A1A' }}>{v}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t pt-1" style={{ borderColor: '#A7F3D0' }}>
                  <dt style={{ color: '#6B7280' }}>Base</dt>
                  <dd style={{ color: '#1A1A1A' }}>{caso.base_gravable == null ? '—' : fmtCOP(caso.base_gravable)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: '#6B7280' }}>IVA</dt>
                  <dd style={{ color: '#1A1A1A' }}>
                    {caso.honorario == null || caso.base_gravable == null
                      ? '—' : fmtCOP(caso.honorario - caso.base_gravable)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 text-[13px] font-bold">
                  <dt style={{ color: '#1A1A1A' }}>Total</dt>
                  <dd style={{ color: '#1A1A1A' }}>{caso.honorario == null ? '—' : fmtCOP(caso.honorario)}</dd>
                </div>
              </dl>

              {/* ── Lo que la financiera puede corregir antes de emitir ──────────
                  Es el principio de siempre (ONE sugiere, la financiera edita) en
                  el único momento en que todavía aplica: después de radicar, una
                  factura electrónica no se corrige, se anula.

                  ⚠️ El correo NO es cosmético: es la dirección a la que Siigo manda
                  la factura. Diana lo pidió con un caso concreto (2026-08-19) —
                  cuando está mal, la factura sale bien y no llega a nadie. */}
              <div className="mt-3 space-y-1.5 border-t pt-2" style={{ borderColor: '#A7F3D0' }}>
                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#047857' }}>
                  Datos editables
                </div>

                <label className="block">
                  <span className="text-[11px]" style={{ color: '#6B7280' }}>Concepto</span>
                  {/* Sin catálogo no se ofrece cambiarlo: una lista inventada haría
                      facturar bajo un código que Siigo puede no tener. */}
                  {productos.length > 0 ? (
                    <select
                      value={productoCode}
                      onChange={e => setProductoCode(e.target.value)}
                      disabled={isPending}
                      className="mt-0.5 w-full rounded-md border bg-white px-2 py-1 text-[12px] focus:outline-none disabled:opacity-50"
                      style={{ borderColor: '#A7F3D0', color: '#1A1A1A' }}
                    >
                      {productos.some(pr => pr.code === caso.concepto.code) ? null : (
                        <option value={caso.concepto.code}>
                          {caso.concepto.nombre ?? `código ${caso.concepto.code}`}
                        </option>
                      )}
                      {productos.map(pr => (
                        <option key={pr.code} value={pr.code}>{pr.nombre}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="mt-0.5 text-[12px]" style={{ color: '#1A1A1A' }}>
                      {caso.concepto.nombre ?? `código ${caso.concepto.code}`}
                    </div>
                  )}
                </label>

                <label className="block">
                  <span className="text-[11px]" style={{ color: '#6B7280' }}>
                    Correo (a este le llega la factura)
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={isPending}
                    placeholder="Sin correo registrado"
                    className="mt-0.5 w-full rounded-md border bg-white px-2 py-1 text-[12px] focus:outline-none disabled:opacity-50"
                    style={{ borderColor: '#A7F3D0', color: '#1A1A1A' }}
                  />
                </label>

                <label className="block">
                  <span className="text-[11px]" style={{ color: '#6B7280' }}>Teléfono</span>
                  <input
                    type="tel"
                    value={telefono}
                    onChange={e => setTelefono(e.target.value)}
                    disabled={isPending}
                    placeholder="Sin teléfono registrado"
                    className="mt-0.5 w-full rounded-md border bg-white px-2 py-1 text-[12px] focus:outline-none disabled:opacity-50"
                    style={{ borderColor: '#A7F3D0', color: '#1A1A1A' }}
                  />
                </label>

                {(email.trim() !== (caso.email ?? '') || telefono.trim() !== (caso.telefono ?? '')) && (
                  <p className="text-[10.5px]" style={{ color: '#6B7280' }}>
                    El correo y el teléfono quedan corregidos también en el contacto del negocio,
                    no solo en esta factura.
                  </p>
                )}
              </div>

              {/* Siigo ya tiene una factura de este servicio para el cliente */}
              {duplicados && (
                <div className="mt-3 rounded-md border p-2" style={{ borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }}>
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: '#B91C1C' }} />
                    <div className="text-[12px]" style={{ color: '#991B1B' }}>
                      <strong>Este cliente ya tiene factura de este servicio.</strong>{' '}
                      {duplicados.map(d => d.name).join(', ')}
                      {duplicados[0]?.date ? ` (${duplicados[0].date})` : ''}. Si aun así hay que
                      facturar, escribe por qué: queda registrado.
                    </div>
                  </div>
                  <input
                    value={justificacion}
                    onChange={e => setJustificacion(e.target.value)}
                    placeholder="Por qué se factura de nuevo"
                    className="mt-2 w-full rounded-md border px-2 py-1 text-[12px] focus:outline-none"
                    style={{ borderColor: '#FCA5A5' }}
                    autoFocus
                  />
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!confirmando && !duplicados && (
                  <button
                    onClick={() => setConfirmando(true)}
                    className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition"
                    style={{ backgroundColor: VERDE }}
                  >
                    Facturar electrónicamente
                  </button>
                )}

                {confirmando && (
                  <>
                    <span className="text-[12px]" style={{ color: '#991B1B' }}>
                      Se radica ante la DIAN y no se puede deshacer.
                    </span>
                    <button
                      onClick={() => emitir()}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
                      style={{ backgroundColor: '#B91C1C' }}
                    >
                      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Sí, facturar
                    </button>
                  </>
                )}

                {duplicados && (
                  <button
                    onClick={() => emitir(justificacion)}
                    disabled={isPending || justificacion.trim().length === 0}
                    className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
                    style={{ backgroundColor: '#B91C1C' }}
                  >
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Facturar de todos modos
                  </button>
                )}

                <button
                  onClick={() => {
                    setRevisando(false); setConfirmando(false); setDuplicados(null); setJustificacion('')
                    setEmail(caso.email ?? ''); setTelefono(caso.telefono ?? ''); setProductoCode(caso.concepto.code)
                  }}
                  disabled={isPending}
                  className="rounded-md border px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
                  style={{ borderColor: '#E5E7EB', color: '#6B7280' }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
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


/**
 * Emisión del recibo de caja: la confirmación de que el cliente entregó dinero.
 *
 * ⚠️ **El valor es editable y esa es la decisión de diseño, no un descuido.** Desde
 * Tesorería nadie ve el comprobante de pago, y los casos que entraron por el cargue
 * masivo NO lo tienen: nacieron antes de que existiera ese punto de control. Medido el
 * 2026-08-12: de 171 casos con el bloque, solo 18 traen el valor extraído. Si el campo
 * fuera de solo lectura, el 89% de los casos no podría emitir su recibo.
 *
 * Desde el 2026-09-03 el recibo cuelga del COBRO y acusa cualquier entrega de dinero,
 * no solo la tarifa UPME. Por eso el campo puede quedarse **vacío**: sin valor escrito
 * se emite por el monto del pago registrado, que es el dato exacto. Se escribe solo
 * para corregirlo contra el soporte.
 */
function ReciboUpme({ caso, onCambio }: { caso: CasoPorFacturar; onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState<string>('')
  const [justificacion, setJustificacion] = useState('')
  const [duplicados, setDuplicados] = useState<Array<{ numero: string; fecha: string; valor: number }> | null>(null)
  const [pendiente, startTransition] = useTransition()

  const escrito = valor.replace(/[^\d]/g, '')
  const monto = Number(escrito)
  // Vacío es válido: se emite por el monto del pago. Escrito, tiene que ser > 0.
  const montoValido = escrito === '' || (Number.isFinite(monto) && monto > 0)

  // Todos los pagos acusados: no hay nada que emitir.
  if (caso.pagos_sin_recibo === 0) {
    if (!caso.recibo_numero) return null
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: '#047857' }}>
        <Check className="h-3.5 w-3.5" />
        Pagos con recibo de caja · último <strong>{caso.recibo_numero}</strong>
      </div>
    )
  }

  function emitir() {
    startTransition(async () => {
      const r = await emitirReciboDeNegocio(caso.negocio_id, {
        // Vacío = el monto del pago registrado, que es el dato exacto.
        valorPagado: escrito === '' ? undefined : monto,
        justificacionDuplicado: justificacion.trim() || undefined,
      })
      if (r.ok) {
        toast.success(
          r.archivada
            ? `Recibo ${r.numero} emitido y archivado en el negocio.`
            : `Recibo ${r.numero} emitido. El PDF no se pudo archivar: revísalo.`,
        )
        setAbierto(false)
        onCambio()
        return
      }
      if (r.duplicados) { setDuplicados(r.duplicados); return }
      toast.error(r.error)
    })
  }

  if (!abierto) {
    return (
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: '#6B7280' }}>
          {caso.pagos_sin_recibo === 1
            ? '1 pago sin recibo de caja'
            : `${caso.pagos_sin_recibo} pagos sin recibo de caja`}
          {caso.recibo_numero && ` · último emitido ${caso.recibo_numero}`}
        </span>
        <button
          onClick={() => setAbierto(true)}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[#F5F4F2]"
          style={{ borderColor: '#E5E7EB', color: '#1A1A1A' }}
        >
          <Receipt className="h-3.5 w-3.5" /> Emitir recibo
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-md border p-3" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFAFA' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>
        Recibo de caja · dinero recibido
      </div>
      <p className="mt-1 text-[11px]" style={{ color: '#6B7280' }}>
        No es una factura: acusa la plata que entregó el cliente. La factura va aparte, por
        el honorario pactado.
      </p>

      <label className="mt-2 block">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: '#6B7280' }}>
          Valor recibido (opcional)
        </span>
        <input
          value={valor}
          onChange={e => setValor(e.target.value)}
          disabled={pendiente}
          inputMode="numeric"
          placeholder="Ej: 733236"
          className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-[13px] tabular-nums disabled:opacity-50"
          style={{ borderColor: '#E5E7EB', color: '#1A1A1A' }}
        />
        <span className="text-[10px]" style={{ color: '#6B7280' }}>
          Déjalo vacío para emitir por el monto del pago registrado. Escríbelo solo si el
          soporte dice otra cosa.
        </span>
      </label>

      {duplicados && (
        <div className="mt-2 rounded-md border p-2" style={{ borderColor: '#F0C060', backgroundColor: '#FFF8E6' }}>
          <div className="flex items-start gap-1.5 text-[11px]" style={{ color: '#7A4A00' }}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              Siigo ya tiene {duplicados.length === 1 ? 'un recibo' : `${duplicados.length} recibos`} de
              este cliente por ese mismo valor: {duplicados.map(d => `${d.numero} (${fmtCOP(d.valor)})`).join(', ')}.
              Si aun así hay que emitirlo, escribe por qué.
            </div>
          </div>
          <textarea
            value={justificacion}
            onChange={e => setJustificacion(e.target.value)}
            rows={2}
            placeholder="Por qué se emite de todos modos…"
            className="mt-2 w-full rounded border px-2 py-1 text-[12px]"
            style={{ borderColor: '#F0C060' }}
          />
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => { setAbierto(false); setDuplicados(null) }}
          disabled={pendiente}
          className="rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-white disabled:opacity-50"
          style={{ borderColor: '#E5E7EB', color: '#1A1A1A' }}
        >
          Cancelar
        </button>
        <button
          onClick={emitir}
          disabled={pendiente || !montoValido || (duplicados != null && justificacion.trim().length < 10)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
          style={{ backgroundColor: VERDE }}
        >
          {pendiente && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Emitir recibo
        </button>
      </div>
    </div>
  )
}
