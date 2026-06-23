'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Scale, Split, CheckCircle2, AlertTriangle, Loader2, X, Plus, Trash2, ExternalLink, RotateCcw,
} from 'lucide-react'
import {
  repartirPago,
  conciliarNegocio,
  type FilaConciliacion,
  type NegocioParaSplit,
} from '@/lib/actions/conciliacion-actions'

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

const VERDE = '#10B981'

function DiferenciaBadge({ valor }: { valor: number }) {
  if (Math.abs(valor) <= 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> $0
      </span>
    )
  }
  if (valor > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        Falta {fmtCOP(valor)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
      Sobra {fmtCOP(Math.abs(valor))}
    </span>
  )
}

export default function ConciliacionClient({ filas }: { filas: FilaConciliacion[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [splitOpen, setSplitOpen] = useState(false)

  const porConciliar = useMemo(
    () => filas.filter((f) => !f.conciliado || Math.abs(f.diferencia) > 1),
    [filas],
  )
  const conciliados = useMemo(
    () => filas.filter((f) => f.conciliado && Math.abs(f.diferencia) <= 1),
    [filas],
  )

  const candidatosSplit: NegocioParaSplit[] = useMemo(
    () =>
      filas
        .filter((f) => f.diferencia > 0)
        .map((f) => ({
          negocio_id: f.negocio_id,
          codigo: f.codigo,
          nombre: f.nombre,
          empresa: f.empresa,
          precio: f.precio,
          cobrado: f.cobrado,
          diferencia: f.diferencia,
        })),
    [filas],
  )

  function handleConciliar(negocioId: string, conciliado: boolean) {
    startTransition(async () => {
      const res = await conciliarNegocio(negocioId, conciliado)
      if (res.success) {
        toast.success(conciliado ? 'Negocio conciliado' : 'Conciliación revertida')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6" style={{ fontFamily: 'var(--font-montserrat), Montserrat, sans-serif' }}>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5" style={{ color: VERDE }} />
            <h1 className="text-lg font-bold" style={{ color: '#1A1A1A' }}>Conciliación de pagos</h1>
          </div>
          <p className="mt-1 text-[13px]" style={{ color: '#6B7280' }}>
            Revisa la diferencia entre lo pagado y el valor del negocio. Reparte un pago entre varios
            negocios sin duplicar el monto y da el check cuando la diferencia quede en $0.
          </p>
        </div>
        <button
          onClick={() => setSplitOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90"
          style={{ backgroundColor: VERDE }}
        >
          <Split className="h-4 w-4" /> Repartir un pago
        </button>
      </div>

      {/* Por conciliar */}
      <section className="mb-8">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#6B7280' }}>
          Por conciliar ({porConciliar.length})
        </h2>
        {porConciliar.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-[13px]" style={{ borderColor: '#E5E7EB', color: '#6B7280' }}>
            Todo conciliado. No hay diferencias pendientes.
          </p>
        ) : (
          <TablaConciliacion filas={porConciliar} pending={pending} onConciliar={handleConciliar} permitirCheck />
        )}
      </section>

      {/* Conciliados */}
      {conciliados.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#6B7280' }}>
            Conciliados ({conciliados.length})
          </h2>
          <TablaConciliacion filas={conciliados} pending={pending} onConciliar={handleConciliar} permitirCheck />
        </section>
      )}

      {splitOpen && (
        <SplitModal
          candidatos={candidatosSplit}
          onClose={() => setSplitOpen(false)}
          onDone={() => {
            setSplitOpen(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Tabla ──────────────────────────────────────────────────────────────────────

function TablaConciliacion({
  filas,
  pending,
  onConciliar,
  permitirCheck,
}: {
  filas: FilaConciliacion[]
  pending: boolean
  onConciliar: (negocioId: string, conciliado: boolean) => void
  permitirCheck: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#E5E7EB' }}>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b" style={{ borderColor: '#E5E7EB', color: '#6B7280' }}>
            <th className="px-3 py-2 font-semibold">Negocio</th>
            <th className="px-3 py-2 font-semibold">Referencia</th>
            <th className="px-3 py-2 text-right font-semibold">Valor pagado</th>
            <th className="px-3 py-2 text-right font-semibold">Valor del negocio</th>
            <th className="px-3 py-2 text-right font-semibold">Diferencia</th>
            <th className="px-3 py-2 text-center font-semibold">Conciliado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const cuadrado = Math.abs(f.diferencia) <= 1
            return (
              <tr key={f.negocio_id} className="border-b last:border-0" style={{ borderColor: '#F3F4F6' }}>
                <td className="px-3 py-2">
                  <Link href={`/negocios/${f.negocio_id}`} className="group inline-flex items-center gap-1">
                    <span className="font-semibold" style={{ color: '#1A1A1A' }}>{f.codigo ?? '—'}</span>
                    <ExternalLink className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
                  </Link>
                  <div className="text-[11px]" style={{ color: '#6B7280' }}>
                    {f.empresa ?? f.nombre ?? ''}{f.etapa_nombre ? ` · ${f.etapa_nombre}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2" style={{ color: '#6B7280' }}>
                  {f.referencias.length === 0 ? (
                    <span className="italic">sin referencia</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {f.referencias.map((r) => (
                        <span key={r} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono">{r}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: '#1A1A1A' }}>{fmtCOP(f.cobrado)}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: '#1A1A1A' }}>{fmtCOP(f.precio)}</td>
                <td className="px-3 py-2 text-right"><DiferenciaBadge valor={f.diferencia} /></td>
                <td className="px-3 py-2 text-center">
                  {f.conciliado ? (
                    <button
                      disabled={pending || !permitirCheck}
                      onClick={() => onConciliar(f.negocio_id, false)}
                      title="Revertir conciliación"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Sí
                      <RotateCcw className="h-3 w-3 opacity-60" />
                    </button>
                  ) : (
                    <button
                      disabled={pending || !cuadrado}
                      onClick={() => onConciliar(f.negocio_id, true)}
                      title={cuadrado ? 'Dar el check de conciliación' : 'La diferencia debe quedar en $0 antes de conciliar'}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ borderColor: cuadrado ? VERDE : '#E5E7EB', color: cuadrado ? VERDE : '#9CA3AF' }}
                    >
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Conciliar
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Modal de reparto ─────────────────────────────────────────────────────────

type Linea = { negocio_id: string; monto: string }

function SplitModal({
  candidatos,
  onClose,
  onDone,
}: {
  candidatos: NegocioParaSplit[]
  onClose: () => void
  onDone: () => void
}) {
  const [referencia, setReferencia] = useState('')
  const [montoTotal, setMontoTotal] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([{ negocio_id: '', monto: '' }])
  const [tipoCobro, setTipoCobro] = useState('pago')
  const [pending, startTransition] = useTransition()

  const total = Number(montoTotal) || 0
  const sumaPorciones = lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0)
  const restante = total - sumaPorciones

  function setLinea(i: number, patch: Partial<Linea>) {
    setLineas((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLinea() {
    setLineas((ls) => [...ls, { negocio_id: '', monto: '' }])
  }
  function removeLinea(i: number) {
    setLineas((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)))
  }
  /** Autorrellena la porción con el saldo pendiente del negocio. */
  function fillSaldo(i: number, negocioId: string) {
    const cand = candidatos.find((c) => c.negocio_id === negocioId)
    const sugerido = cand ? Math.min(cand.diferencia, Math.max(0, total - (sumaPorciones - (Number(lineas[i].monto) || 0)))) : 0
    setLinea(i, { negocio_id: negocioId, monto: sugerido > 0 ? String(sugerido) : '' })
  }

  function handleSubmit() {
    const porciones = lineas
      .filter((l) => l.negocio_id && Number(l.monto) > 0)
      .map((l) => ({ negocio_id: l.negocio_id, monto: Number(l.monto) }))

    if (!referencia.trim()) return toast.error('Ingresa la referencia del pago')
    if (total <= 0) return toast.error('Ingresa el monto total del pago')
    if (porciones.length < 1) return toast.error('Asigna al menos una porción')
    if (new Set(porciones.map((p) => p.negocio_id)).size !== porciones.length) {
      return toast.error('No repitas el mismo negocio')
    }
    if (sumaPorciones - total > 1) return toast.error('La suma de las porciones excede el monto del pago')

    startTransition(async () => {
      const res = await repartirPago({
        referencia: referencia.trim(),
        monto_total: total,
        porciones,
        tipo_cobro: tipoCobro,
      })
      if (res.success) {
        toast.success(`Pago repartido entre ${porciones.length} negocios`)
        onDone()
      } else {
        toast.error(res.error)
      }
    })
  }

  const negociosDisponibles = (actualId: string) =>
    candidatos.filter((c) => c.negocio_id === actualId || !lineas.some((l) => l.negocio_id === c.negocio_id))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" style={{ fontFamily: 'var(--font-montserrat), Montserrat, sans-serif' }}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <div className="flex items-center gap-2">
            <Split className="h-4 w-4" style={{ color: VERDE }} />
            <h3 className="text-[15px] font-bold" style={{ color: '#1A1A1A' }}>Repartir un pago entre negocios</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" style={{ color: '#6B7280' }} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold" style={{ color: '#1A1A1A' }}>Referencia del pago</span>
              <input
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="ej. 12345678"
                className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:ring-2"
                style={{ borderColor: '#E5E7EB' }}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold" style={{ color: '#1A1A1A' }}>Monto total recibido</span>
              <input
                inputMode="numeric"
                value={montoTotal}
                onChange={(e) => setMontoTotal(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                className="w-full rounded-md border px-2.5 py-1.5 text-[13px] tabular-nums outline-none focus:ring-2"
                style={{ borderColor: '#E5E7EB' }}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold" style={{ color: '#1A1A1A' }}>Tipo de cobro</span>
            <select
              value={tipoCobro}
              onChange={(e) => setTipoCobro(e.target.value)}
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:ring-2"
              style={{ borderColor: '#E5E7EB' }}
            >
              <option value="pago">Pago</option>
              <option value="anticipo">Anticipo</option>
              <option value="saldo">Saldo</option>
              <option value="externo">Externo</option>
            </select>
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12px] font-semibold" style={{ color: '#1A1A1A' }}>Porciones por negocio</span>
              <button onClick={addLinea} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: VERDE }}>
                <Plus className="h-3.5 w-3.5" /> Agregar
              </button>
            </div>
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={l.negocio_id}
                    onChange={(e) => fillSaldo(i, e.target.value)}
                    className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-[12px] outline-none focus:ring-2"
                    style={{ borderColor: '#E5E7EB' }}
                  >
                    <option value="">Elige negocio…</option>
                    {negociosDisponibles(l.negocio_id).map((c) => (
                      <option key={c.negocio_id} value={c.negocio_id}>
                        {c.codigo ?? c.nombre} · falta {fmtCOP(c.diferencia)}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="numeric"
                    value={l.monto}
                    onChange={(e) => setLinea(i, { monto: e.target.value.replace(/[^\d]/g, '') })}
                    placeholder="monto"
                    className="w-28 rounded-md border px-2 py-1.5 text-right text-[12px] tabular-nums outline-none focus:ring-2"
                    style={{ borderColor: '#E5E7EB' }}
                  />
                  <button
                    onClick={() => removeLinea(i)}
                    disabled={lineas.length === 1}
                    className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Resumen de cuadre */}
          <div className="rounded-md p-3 text-[12px]" style={{ backgroundColor: '#F9FAFB' }}>
            <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Suma de porciones</span><span className="tabular-nums font-semibold">{fmtCOP(sumaPorciones)}</span></div>
            <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Monto del pago</span><span className="tabular-nums font-semibold">{fmtCOP(total)}</span></div>
            <div className="mt-1 flex justify-between border-t pt-1" style={{ borderColor: '#E5E7EB' }}>
              <span style={{ color: '#6B7280' }}>{restante < 0 ? 'Excede el pago' : 'Sin asignar'}</span>
              <span className={`tabular-nums font-bold ${restante < 0 ? 'text-red-600' : restante === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {fmtCOP(Math.abs(restante))}
              </span>
            </div>
            {restante < 0 && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
                <AlertTriangle className="h-3 w-3" /> Las porciones no pueden superar el monto del pago.
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] font-semibold" style={{ color: '#6B7280' }}>Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={pending || restante < 0}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: VERDE }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Split className="h-4 w-4" />}
            Repartir pago
          </button>
        </div>
      </div>
    </div>
  )
}
