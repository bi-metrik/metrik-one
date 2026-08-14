'use client'

/**
 * Registro del pago de una cuenta de cobro.
 *
 * Hasta hoy esta accion NO existia en el producto: cada pago se registraba a
 * mano por SQL desde mayo de 2026. El resultado visible eran cuentas saldadas
 * que seguian figurando como pendientes (CC-2026-05-001 de SOENA lleva sus
 * cobros pagados desde el 28-may y sigue en `enviada`).
 *
 * El caso PARCIAL no es un extra: es el frecuente. Una cuenta agrupa cobros de
 * varios negocios y el cliente rara vez paga el total de una. Por eso la
 * pantalla ofrece los dos caminos del modelo desde el inicio, no solo el
 * "pagada completa":
 *
 *   - Cobros cubiertos: el pago calza con uno o varios cobros ENTEROS. Se marcan
 *     esos, y la cuenta pasa a `pagada` solo si con eso quedan todos con fecha.
 *   - Abono parcial: el pago no cierra ningun cobro entero. La cuota programada
 *     baja al saldo y la porcion pagada entra como cobro manual, porque el
 *     indice unico parcial impide partir una cuota en dos cobros programados.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, AlertTriangle, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { registrarPagoCuentaCobro } from '@/lib/actions/cuentas-cobro-actions'
import { EVIDENCIA_MIN_CARACTERES } from '@/lib/cobros/registrar-pago-cuenta'

export type CobroDeCuentaUI = {
  id: string
  monto: number
  fecha: string | null
  numero_cuota: number | null
  negocio_label: string
}

interface Props {
  cuentaId: string
  numero: string
  cobros: CobroDeCuentaUI[]
}

function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

export default function RegistrarPagoDialog({ cuentaId, numero, cobros }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [modo, setModo] = useState<'cobros_completos' | 'abono_parcial'>('cobros_completos')
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [cobroParcial, setCobroParcial] = useState<string>('')
  const [montoParcial, setMontoParcial] = useState<string>('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [evidencia, setEvidencia] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const pendientes = useMemo(() => cobros.filter(c => !c.fecha), [cobros])
  const sumaSeleccion = useMemo(
    () => cobros.filter(c => seleccion.includes(c.id)).reduce((s, c) => s + c.monto, 0),
    [cobros, seleccion],
  )

  const cerrar = useCallback(() => {
    if (guardando) return
    setAbierto(false)
    setSeleccion([])
    setCobroParcial('')
    setMontoParcial('')
    setEvidencia('')
    setModo('cobros_completos')
  }, [guardando])

  useEffect(() => {
    if (!abierto) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [abierto, cerrar])

  function toggle(id: string) {
    setSeleccion(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  }

  const evidenciaCorta = evidencia.trim().length < EVIDENCIA_MIN_CARACTERES
  const puedeGuardar = !guardando && !evidenciaCorta && (
    modo === 'cobros_completos'
      ? seleccion.length > 0
      : Boolean(cobroParcial) && Number(montoParcial) > 0
  )

  function guardar() {
    if (!puedeGuardar) return
    setGuardando(true)
    startTransition(async () => {
      const base = { cuentaId, fecha, evidencia }
      const res = await registrarPagoCuentaCobro(
        modo === 'cobros_completos'
          ? { ...base, modo, cobrosIds: seleccion, monto: sumaSeleccion }
          : { ...base, modo, cobroId: cobroParcial, monto: Number(montoParcial) },
      )
      setGuardando(false)
      if (!res.success) { toast.error(res.error); return }
      toast.success(res.data.mensaje)
      cerrar()
      router.refresh()
    })
  }

  // Una cuenta sin cobros pendientes ya no admite pago. Ofrecerlo mandaría a una
  // pantalla que solo puede decir que no.
  if (pendientes.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:border-[#10B981] hover:text-[#10B981] transition-colors"
      >
        <Wallet className="h-3 w-3" /> Registrar pago
      </button>

      {abierto && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 select-none"
          onClick={cerrar}
        >
          <div
            className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-border shrink-0">
              <div>
                <h2 className="text-base font-bold">Registrar pago · {numero}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  La cuenta pasa a «pagada» solo cuando todos sus cobros quedan con fecha.
                  Un pago que cubre parte la deja abierta con el saldo anotado.
                </p>
              </div>
              <button
                type="button" onClick={cerrar} disabled={guardando}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40 shrink-0"
                aria-label="Cerrar"
              ><X className="h-4 w-4" /></button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Modo */}
              <div className="flex gap-4 text-sm flex-wrap">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio" name="modo" checked={modo === 'cobros_completos'}
                    onChange={() => setModo('cobros_completos')} disabled={guardando}
                  />
                  <span>El pago cubre cobros completos</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio" name="modo" checked={modo === 'abono_parcial'}
                    onChange={() => setModo('abono_parcial')} disabled={guardando}
                  />
                  <span>Abono parcial sobre un cobro</span>
                </label>
              </div>

              {modo === 'cobros_completos' ? (
                <div className="border border-border rounded-md overflow-hidden">
                  <div className="px-3 py-2 bg-muted/40 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Marca los cobros que el pago cubre por completo
                  </div>
                  {pendientes.map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-3 py-2 border-t border-border cursor-pointer hover:bg-muted/30">
                      <input
                        type="checkbox" checked={seleccion.includes(c.id)}
                        onChange={() => toggle(c.id)} disabled={guardando}
                      />
                      <span className="flex-1 text-sm">
                        {c.negocio_label}
                        {c.numero_cuota !== null && (
                          <span className="text-xs text-muted-foreground"> · cuota {c.numero_cuota}</span>
                        )}
                      </span>
                      <span className="font-mono text-sm">{formatCOP(c.monto)}</span>
                    </label>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/20">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Valor recibido</span>
                    <span className="font-mono text-sm font-bold">{formatCOP(sumaSeleccion)}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Úsalo cuando el pago no alcanza a cerrar ningún cobro entero. La cuota baja al saldo
                    pendiente y la parte pagada queda como cobro aparte; el total de la cuenta no cambia.
                  </p>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Cobro al que se abona</span>
                    <select
                      value={cobroParcial} onChange={e => setCobroParcial(e.target.value)} disabled={guardando}
                      className="px-2 py-1.5 border border-border rounded-md text-sm bg-background"
                    >
                      <option value="">Selecciona…</option>
                      {pendientes.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.negocio_label} · {formatCOP(c.monto)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Valor del abono</span>
                    <input
                      type="number" min={1} step={1} value={montoParcial}
                      onChange={e => setMontoParcial(e.target.value)} disabled={guardando}
                      placeholder="100000"
                      className="px-2 py-1.5 border border-border rounded-md text-sm bg-background"
                    />
                  </label>
                </div>
              )}

              <label className="flex flex-col gap-1 max-w-[220px]">
                <span className="text-xs text-muted-foreground">Fecha valor del crédito</span>
                <input
                  type="date" value={fecha} onChange={e => setFecha(e.target.value)} disabled={guardando}
                  className="px-2 py-1.5 border border-border rounded-md text-sm bg-background"
                />
              </label>

              <div className="space-y-1.5">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Evidencia del crédito entrante</span>
                  <textarea
                    value={evidencia} onChange={e => setEvidencia(e.target.value)} disabled={guardando}
                    rows={2}
                    placeholder="Ej: extracto Caja Social 14-ago, consignación de SOENA por $1.750.000, ref 8842."
                    className="px-2 py-1.5 border border-border rounded-md text-sm bg-background resize-y"
                  />
                </label>
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[#F59E0B]" />
                  <span>
                    Un comprobante de transferencia entre cuentas propias no prueba el ingreso del cliente:
                    describe el crédito entrante (extracto o comprobante del cliente).
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-border shrink-0">
              <button
                type="button" onClick={cerrar} disabled={guardando}
                className="px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted disabled:opacity-60"
              >Cancelar</button>
              <button
                type="button" onClick={guardar} disabled={!puedeGuardar}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#10B981] text-white hover:bg-[#059669] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {guardando
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Registrando…</>
                  : 'Registrar pago'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
