'use client'

import { useEffect, useState, useTransition } from 'react'
import { X, Loader2, Plus, Trash2, ArrowRightLeft, Wallet } from 'lucide-react'
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
 * Modal de registro de pago del COMERCIAL — con reparto opcional entre varios
 * negocios. El comercial PROPONE el pago/reparto; la financiera lo valida y concilia
 * (control de dos personas). Escribe SIEMPRE por `repartirPagoComercial` (1 porción =
 * pago simple; N porciones = reparto).
 *
 * Dos modos de entrada, según `negocioFijado`:
 *   - Desde el bloque de pagos de un negocio → `negocioFijado` fija la 1ª porción a
 *     ese negocio (no se puede cambiar ni quitar). El reparto a OTROS negocios es
 *     opcional: si solo hay la porción fija, es un pago simple.
 *   - Desde el FAB global → sin `negocioFijado`, el comercial elige el/los negocios.
 *
 * El picker de negocios (getNegociosParaPagoFab) es la materialización de la regla
 * dura: solo negocios existentes y abiertos. Fuentes: ePayco + Otra (manual/externo,
 * Davivienda entra como texto libre bajo "otra").
 */
export default function DistribuirPagoModal({
  onClose,
  onDone,
  negocioFijado,
  referenciaInicial,
  totalInicial,
  contextoEpayco = false,
}: {
  onClose: () => void
  onDone: () => void
  /** Cuando viene del bloque de pagos: fija la 1ª porción a este negocio. */
  negocioFijado?: { negocio_id: string; codigo: string | null; nombre: string | null }
  /** Referencia ePayco ya consultada (bloque de Pagos): se pre-llena y bloquea. */
  referenciaInicial?: string
  /** Monto real del pago (monto_bruto de ePayco): se pre-llena y bloquea → el
   *  balanceador funciona de una. */
  totalInicial?: number
  /** Abierto desde el bloque de Pagos ePayco: fuente fija ePayco, ref/total en
   *  solo-lectura (ya validados por la consulta). */
  contextoEpayco?: boolean
}) {
  const [negocios, setNegocios] = useState<NegocioParaPagoFab[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [fuente, setFuente] = useState<'epayco' | 'otra'>('epayco')
  const [fuenteNombre, setFuenteNombre] = useState('')
  const [referencia, setReferencia] = useState(referenciaInicial ?? '')
  const [total, setTotal] = useState(totalInicial != null ? String(totalInicial) : '')
  const [fecha, setFecha] = useState('')
  // Con negocioFijado la 1ª porción arranca fijada a ese negocio (monto libre).
  const [porciones, setPorciones] = useState<PorcionUI[]>([
    { negocio_id: negocioFijado?.negocio_id ?? '', monto: '' },
  ])
  const [pending, startTransition] = useTransition()

  const esEpayco = fuente === 'epayco'
  const fijadoActivo = !!negocioFijado

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
  // Reparto BALANCEADOR (solo con negocio origen fijado): el origen (índice 0)
  // queda con el saldo = total − suma(los negocios que se abren). Arranca en el
  // 100% y NUNCA queda en $0 (regla de Mauricio). Lo que se abre se teclea; el
  // origen se calcula solo.
  const sumRepartido = fijadoActivo
    ? porciones.slice(1).reduce((s, p) => s + (Number(p.monto) || 0), 0)
    : porciones.reduce((s, p) => s + (Number(p.monto) || 0), 0)
  const montoOrigen = fijadoActivo ? totalNum - sumRepartido : 0
  // El origen no puede quedar en 0 o negativo (solo aplica con total conocido).
  const origenEnCero = fijadoActivo && totalNum > 0 && montoOrigen <= 0
  // Hay reparto cuando, además del origen fijado, se abrió al menos otro negocio.
  const repartoActivo = fijadoActivo && porciones.slice(1).some((p) => p.negocio_id)
  // "Sin asignar" (solo se muestra fuera del reparto): total − lo tecleado.
  const sinAsignar = totalNum - porciones.reduce((s, p) => s + (Number(p.monto) || 0), 0)
  // Es "reparto" (varios negocios) cuando hay 2+ porciones con negocio.
  const esReparto = porciones.filter((p) => p.negocio_id).length > 1

  function setPorcion(i: number, patch: Partial<PorcionUI>) {
    setPorciones((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function addPorcion() {
    setPorciones((prev) => [...prev, { negocio_id: '', monto: '' }])
  }
  function removePorcion(i: number) {
    // La porción fijada (índice 0 con negocioFijado) no se puede quitar.
    if (fijadoActivo && i === 0) return
    setPorciones((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  // Negocios ya elegidos en otras filas (para no ofrecer el mismo dos veces).
  // Con negocioFijado, el negocio fijo también se excluye del resto de selectores.
  function disponiblesPara(i: number): NegocioParaPagoFab[] {
    const usados = new Set(porciones.filter((_, idx) => idx !== i).map((p) => p.negocio_id).filter(Boolean))
    if (fijadoActivo && i !== 0) usados.add(negocioFijado!.negocio_id)
    return negocios.filter((n) => !usados.has(n.negocio_id))
  }

  function handleSubmit() {
    if (!referencia.trim()) return toast.error('Ingresa la referencia del pago')
    if (!esEpayco && totalNum <= 0) return toast.error('Ingresa el total del pago')
    if (fuente === 'otra' && !fuenteNombre.trim()) return toast.error('Indica el nombre de la fuente')

    let limpias: { negocio_id: string; monto: number }[]
    if (repartoActivo) {
      // REPARTO con ORIGEN BALANCEADOR: el origen queda con el saldo (total − repartido),
      // arranca en 100% y NUNCA queda en $0. Los demás se teclean.
      if (totalNum <= 0) return toast.error('Ingresa el total del pago para repartir entre negocios')
      if (origenEnCero) return toast.error('El negocio original no puede quedar en $0. Reduce lo repartido.')
      const otros = porciones
        .slice(1)
        .filter((p) => p.negocio_id && Number(p.monto) > 0)
        .map((p) => ({ negocio_id: p.negocio_id, monto: Number(p.monto) }))
      if (otros.length === 0) return toast.error('Asigna un monto a los negocios que abriste')
      limpias = [{ negocio_id: negocioFijado!.negocio_id, monto: montoOrigen }, ...otros]
    } else {
      // PAGO SIMPLE / FAB: comportamiento previo intacto (se envía lo tecleado).
      limpias = porciones
        .filter((p) => p.negocio_id && Number(p.monto) > 0)
        .map((p) => ({ negocio_id: p.negocio_id, monto: Number(p.monto) }))
      if (limpias.length === 0) return toast.error('Asigna al menos un negocio con monto')
      if (fijadoActivo && !limpias.some((p) => p.negocio_id === negocioFijado!.negocio_id)) {
        return toast.error(`Asigna un monto al negocio ${negocioFijado!.codigo ?? ''}`)
      }
      if (totalNum > 0 && sinAsignar < -1) return toast.error('La suma de las porciones supera el total del pago')
    }

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
        toast.success(
          limpias.length > 1
            ? 'Reparto propuesto. El área financiera lo confirmará.'
            : 'Pago registrado. El área financiera lo confirmará.',
        )
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
            {fijadoActivo ? <Wallet className="h-4 w-4" style={{ color: VERDE }} /> : <ArrowRightLeft className="h-4 w-4" style={{ color: VERDE }} />}
            <h3 className="text-[15px] font-bold" style={{ color: '#1A1A1A' }}>
              {contextoEpayco ? 'Repartir pago entre negocios' : fijadoActivo ? 'Registrar pago' : 'Distribuir pago entre negocios'}
            </h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" style={{ color: '#6B7280' }} /></button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <p className="text-[11px] leading-relaxed" style={{ color: '#6B7280' }}>
            {fijadoActivo
              ? 'Registra el pago de este negocio. Si un mismo pago cubre varios negocios, reparte el resto abajo. El área financiera lo confirma.'
              : 'Propón cómo se reparte un solo pago entre varios negocios. El área financiera lo valida contra el dinero real y concilia.'}
          </p>

          {!contextoEpayco && (
          <Field label="Fuente del pago">
            <div className="grid grid-cols-2 gap-2">
              {(['epayco', 'otra'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFuente(f)}
                  className="rounded-md border px-2 py-1.5 text-[12px] font-semibold transition"
                  style={fuente === f
                    ? { borderColor: VERDE, color: VERDE, backgroundColor: '#ECFDF5' }
                    : { borderColor: '#E5E7EB', color: '#6B7280' }}
                >
                  {f === 'epayco' ? 'ePayco' : 'Otra (manual)'}
                </button>
              ))}
            </div>
          </Field>
          )}

          {!contextoEpayco && fuente === 'otra' && (
            <Field label="Nombre de la fuente">
              <input value={fuenteNombre} onChange={(e) => setFuenteNombre(e.target.value)} placeholder="ej. Davivienda, Bancolombia, Nequi, efectivo…" className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
            </Field>
          )}

          <Field label={esEpayco ? 'Referencia ePayco (ref_payco)' : 'Referencia / comprobante'}>
            <input
              value={referencia}
              onChange={(e) => setReferencia(esEpayco ? e.target.value.replace(/[^\d]/g, '') : e.target.value)}
              inputMode={esEpayco ? 'numeric' : 'text'}
              placeholder={esEpayco ? 'ej. 123456789' : 'ej. comprobante o nº de transacción'}
              disabled={contextoEpayco}
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none disabled:bg-[#F9FAFB] disabled:text-[#6B7280]"
              style={{ borderColor: '#E5E7EB' }}
            />
            {esEpayco && <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>{contextoEpayco ? 'Referencia ya validada en ePayco. Reparte el monto entre los negocios abajo.' : 'Se valida con ePayco: solo se registra si está Aceptada. El total se toma del pago real.'}</p>}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={esEpayco ? 'Total (auto desde ePayco)' : 'Total del pago'}>
              <input
                value={total}
                onChange={(e) => setTotal(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                disabled={contextoEpayco}
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
              <span className="text-[12px] font-semibold" style={{ color: '#1A1A1A' }}>
                {fijadoActivo ? 'Monto del pago' : 'Reparto por negocio'}
              </span>
              {totalNum > 0 && (repartoActivo ? (
                <span className="text-[11px]" style={{ color: origenEnCero ? '#DC2626' : '#6B7280' }}>
                  {origenEnCero ? '⚠ El origen no puede quedar en $0' : <>Queda en {negocioFijado!.codigo ?? 'origen'}: <span className="font-semibold tabular-nums">{fmtCOP(montoOrigen)}</span></>}
                </span>
              ) : (
                <span className="text-[11px]" style={{ color: sinAsignar < -1 ? '#DC2626' : '#6B7280' }}>
                  Sin asignar: <span className="font-semibold tabular-nums">{fmtCOP(sinAsignar)}</span>
                </span>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 px-1 py-1.5 text-[13px]" style={{ color: '#6B7280' }}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando negocios…
              </div>
            ) : loadError ? (
              <p className="text-[12px]" style={{ color: '#DC2626' }}>{loadError}</p>
            ) : (
              <div className="space-y-2">
                {porciones.map((p, i) => {
                  const esFilaFija = fijadoActivo && i === 0
                  return (
                    <div key={i} className="flex items-center gap-2">
                      {esFilaFija ? (
                        <div className="min-w-0 flex-1 rounded-md border bg-[#F9FAFB] px-2 py-1.5 text-[12px] font-semibold" style={{ borderColor: '#E5E7EB', color: '#1A1A1A' }}>
                          {negocioFijado!.codigo ?? negocioFijado!.nombre ?? 'Este negocio'}
                          {negocioFijado!.nombre && negocioFijado!.codigo ? <span className="ml-1 font-normal" style={{ color: '#6B7280' }}>· {negocioFijado!.nombre}</span> : null}
                        </div>
                      ) : (
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
                      )}
                      {esFilaFija && repartoActivo ? (
                        <div
                          className="w-28 rounded-md border px-2 py-1.5 text-right text-[12px] font-semibold tabular-nums"
                          style={{ borderColor: origenEnCero ? '#FCA5A5' : '#A7F3D0', backgroundColor: origenEnCero ? '#FEF2F2' : '#ECFDF5', color: origenEnCero ? '#DC2626' : '#065F46' }}
                          title="Saldo del negocio original — se calcula solo (total menos lo repartido) y no puede quedar en $0"
                        >
                          {fmtCOP(Math.max(0, montoOrigen))}
                        </div>
                      ) : (
                        <input
                          value={p.monto}
                          onChange={(e) => setPorcion(i, { monto: e.target.value.replace(/[^\d]/g, '') })}
                          inputMode="numeric"
                          placeholder="monto"
                          className="w-28 rounded-md border px-2 py-1.5 text-right text-[12px] tabular-nums outline-none"
                          style={{ borderColor: '#E5E7EB' }}
                        />
                      )}
                      <button
                        onClick={() => removePorcion(i)}
                        disabled={porciones.length <= 1 || esFilaFija}
                        title={esFilaFija ? 'El negocio de este bloque no se puede quitar' : 'Quitar esta línea'}
                        className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
                      </button>
                    </div>
                  )
                })}
                <button
                  onClick={addPorcion}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold"
                  style={{ color: VERDE }}
                >
                  <Plus className="h-3.5 w-3.5" /> {fijadoActivo ? '¿El pago cubre otro negocio? Repartir' : 'Agregar negocio'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] font-semibold" style={{ color: '#6B7280' }}>Cancelar</button>
          <button onClick={handleSubmit} disabled={pending || loading || origenEnCero} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: VERDE }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : esReparto ? <ArrowRightLeft className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
            {esReparto ? 'Proponer reparto' : 'Registrar pago'}
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
