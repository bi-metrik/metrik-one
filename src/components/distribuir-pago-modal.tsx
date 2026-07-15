'use client'

import { useEffect, useState, useTransition } from 'react'
import { X, Loader2, Plus, Trash2, ArrowRightLeft } from 'lucide-react'
import { toast } from 'sonner'
import { repartirPagoComercial } from '@/lib/actions/conciliacion-actions'
import { getNegociosParaPagoFab, type NegocioParaPagoFab } from '@/lib/actions/fab-pago-actions'

const VERDE = '#10B981'
const FONT = { fontFamily: 'var(--font-montserrat), Montserrat, sans-serif' }

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

interface PorcionUI {
  negocio_id: string
  monto: string
}

/**
 * Modal "Distribuir pago entre negocios" — el COMERCIAL propone el reparto de UN
 * pago entre varios negocios. La financiera lo valida y concilia. Reusable desde el
 * FAB global y desde el detalle del negocio. Escribe por `repartirPagoComercial`.
 *
 * El picker de negocios (getNegociosParaPagoFab) es la materialización de la regla
 * dura: solo negocios existentes y abiertos.
 */
export default function DistribuirPagoModal({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  const [negocios, setNegocios] = useState<NegocioParaPagoFab[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [fuente, setFuente] = useState<'epayco' | 'davivienda' | 'otra'>('epayco')
  const [fuenteNombre, setFuenteNombre] = useState('')
  const [referencia, setReferencia] = useState('')
  const [total, setTotal] = useState('')
  const [fecha, setFecha] = useState('')
  const [porciones, setPorciones] = useState<PorcionUI[]>([{ negocio_id: '', monto: '' }])
  const [pending, startTransition] = useTransition()

  const esEpayco = fuente === 'epayco'

  useEffect(() => {
    let cancel = false
    getNegociosParaPagoFab().then((res) => {
      if (cancel) return
      if (res.error) setLoadError(res.error)
      else setNegocios(res.negocios)
      setLoading(false)
    })
    return () => { cancel = true }
  }, [])

  const totalNum = Number(total) || 0
  const sumaAsignada = porciones.reduce((s, p) => s + (Number(p.monto) || 0), 0)
  const sinAsignar = totalNum - sumaAsignada

  function setPorcion(i: number, patch: Partial<PorcionUI>) {
    setPorciones((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function addPorcion() {
    setPorciones((prev) => [...prev, { negocio_id: '', monto: '' }])
  }
  function removePorcion(i: number) {
    setPorciones((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  // Negocios ya elegidos en otras filas (para no ofrecer el mismo dos veces).
  function disponiblesPara(i: number): NegocioParaPagoFab[] {
    const usados = new Set(porciones.filter((_, idx) => idx !== i).map((p) => p.negocio_id).filter(Boolean))
    return negocios.filter((n) => !usados.has(n.negocio_id))
  }

  function handleSubmit() {
    if (!referencia.trim()) return toast.error('Ingresa la referencia del pago')
    if (!esEpayco && totalNum <= 0) return toast.error('Ingresa el total del pago')
    if (fuente === 'otra' && !fuenteNombre.trim()) return toast.error('Indica el nombre de la fuente')

    const limpias = porciones
      .filter((p) => p.negocio_id && Number(p.monto) > 0)
      .map((p) => ({ negocio_id: p.negocio_id, monto: Number(p.monto) }))
    if (limpias.length === 0) return toast.error('Asigna al menos un negocio con monto')
    // Con total conocido (manual, o ePayco con total explícito), la suma no puede
    // exceder el total. En ePayco-auto (total=0) el server valida contra el pago real.
    if (totalNum > 0 && sinAsignar < -1) return toast.error('La suma de las porciones supera el total del pago')

    const tipoFuente: 'epayco' | 'manual' = esEpayco ? 'epayco' : 'manual'

    startTransition(async () => {
      const res = await repartirPagoComercial({
        referencia: referencia.trim(),
        // ePayco sin total → 0: el server lo resuelve del pago real (monto_bruto).
        monto_total: totalNum,
        porciones: limpias,
        fuente: tipoFuente,
        fecha: fecha || undefined,
      })
      if (res.success) {
        toast.success('Reparto propuesto. El área financiera lo confirmará.')
        onDone()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" style={FONT}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" style={{ color: VERDE }} />
            <h3 className="text-[15px] font-bold" style={{ color: '#1A1A1A' }}>Distribuir pago entre negocios</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" style={{ color: '#6B7280' }} /></button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <p className="text-[11px] leading-relaxed" style={{ color: '#6B7280' }}>
            Propón cómo se reparte un solo pago entre varios negocios. El área financiera lo valida contra el dinero real y concilia.
          </p>

          <Field label="Fuente del pago">
            <div className="grid grid-cols-3 gap-2">
              {(['epayco', 'davivienda', 'otra'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFuente(f)}
                  className="rounded-md border px-2 py-1.5 text-[12px] font-semibold transition"
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
            {esEpayco && <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>Se valida con ePayco: solo se registra si está Aceptada. El total se toma del pago real.</p>}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={esEpayco ? 'Total (auto desde ePayco)' : 'Total del pago'}>
              <input
                value={total}
                onChange={(e) => setTotal(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder={esEpayco ? 'opcional' : '0'}
                className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none"
                style={{ borderColor: '#E5E7EB' }}
              />
            </Field>
            <Field label="Fecha">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
            </Field>
          </div>

          {/* Repetidor de porciones */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold" style={{ color: '#1A1A1A' }}>Reparto por negocio</span>
              {totalNum > 0 && (
                <span className="text-[11px]" style={{ color: sinAsignar < -1 ? '#DC2626' : '#6B7280' }}>
                  Sin asignar: <span className="font-semibold tabular-nums">{fmtCOP(sinAsignar)}</span>
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 px-1 py-1.5 text-[13px]" style={{ color: '#6B7280' }}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando negocios…
              </div>
            ) : loadError ? (
              <p className="text-[12px]" style={{ color: '#DC2626' }}>{loadError}</p>
            ) : (
              <div className="space-y-2">
                {porciones.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={p.negocio_id}
                      onChange={(e) => setPorcion(i, { negocio_id: e.target.value })}
                      className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-[12px] outline-none"
                      style={{ borderColor: '#E5E7EB' }}
                    >
                      <option value="">Elige negocio…</option>
                      {disponiblesPara(i).map((n) => (
                        <option key={n.negocio_id} value={n.negocio_id}>
                          {(n.codigo ?? n.nombre ?? '')}{n.empresa ? ` · ${n.empresa}` : (n.nombre ? ` · ${n.nombre}` : '')}
                        </option>
                      ))}
                    </select>
                    <input
                      value={p.monto}
                      onChange={(e) => setPorcion(i, { monto: e.target.value.replace(/[^\d]/g, '') })}
                      inputMode="numeric"
                      placeholder="monto"
                      className="w-28 rounded-md border px-2 py-1.5 text-right text-[12px] tabular-nums outline-none"
                      style={{ borderColor: '#E5E7EB' }}
                    />
                    <button
                      onClick={() => removePorcion(i)}
                      disabled={porciones.length <= 1}
                      title="Quitar esta línea"
                      className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addPorcion}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold"
                  style={{ color: VERDE }}
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar negocio
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] font-semibold" style={{ color: '#6B7280' }}>Cancelar</button>
          <button onClick={handleSubmit} disabled={pending || loading} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: VERDE }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            Proponer reparto
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold" style={{ color: '#374151' }}>{label}</span>
      {children}
    </label>
  )
}
