'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'
import { formatoPesos } from '@/lib/ferreteria/reglas'
import { direccionEnvio } from '@/lib/ferreteria/wompi-envio'
import type { FilaPagoWompi, RegistroPago } from '@/lib/ferreteria/wompi-pagos'
import { asignarPagoWompiAction } from './actions'

const ETIQUETA_REGISTRO: Record<RegistroPago, string> = {
  recibido: 'Recibido',
  procesando: 'Registrando',
  registrada: 'Venta registrada',
  pendiente_asignar: 'Sin publicación',
  solo_guardado: 'Solo guardado',
  error: 'No se registró',
}

const TONO_REGISTRO: Record<RegistroPago, string> = {
  recibido: 'text-muted-foreground',
  procesando: 'text-muted-foreground',
  registrada: 'text-emerald-700',
  pendiente_asignar: 'text-amber-700',
  solo_guardado: 'text-muted-foreground',
  error: 'text-red-600',
}

/** Un aprobado de producción que ONE no pudo amarrar: lo resuelve una persona. */
export function pagoPorAsignar(p: Pick<FilaPagoWompi, 'estado_wompi' | 'entorno' | 'registro'>): boolean {
  return p.estado_wompi === 'APPROVED' && p.entorno === 'prod' && (p.registro === 'pendiente_asignar' || p.registro === 'error')
}

/**
 * Pagos que Wompi le avisó a ONE (links de pago de Dimpro). Un pago aprobado con código de
 * publicación se vuelve venta solo; uno sin código queda aquí para asignarlo a mano.
 */
export function PagosWompi({ pagos, puedeEditar }: { pagos: FilaPagoWompi[]; puedeEditar: boolean }) {
  const porAsignar = pagos.filter(pagoPorAsignar)
  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Wompi avisa aquí cada pago de los links de Dimpro. Un pago aprobado cuyo link trae el código de la publicación (MP-xx) queda
        registrado como venta anticipada, con su negocio en ONE. Si el link no trae código, o el código no es una publicación, el pago
        espera aquí a que lo asignes. Los rechazados y anulados solo se guardan.
      </p>
      {porAsignar.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {porAsignar.length} pago(s) aprobado(s) sin venta: asígnalos a su publicación.
        </p>
      )}
      {pagos.length === 0 ? (
        <p className="rounded-md border p-6 text-sm text-muted-foreground">Todavía no ha llegado ningún pago de Wompi.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Recibido</th>
                <th className="px-3 py-2">Wompi</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Publicación</th>
                <th className="px-3 py-2">Comprador</th>
                <th className="px-3 py-2">Envío</th>
                <th className="px-3 py-2">En ONE</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{formatBogotaFechaHora(p.pagado_at ?? p.recibido_at) ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-medium">{p.estado_wompi}{p.entorno === 'test' ? ' · sandbox' : ''}</div>
                    <div className="text-muted-foreground">{p.transaccion_id}</div>
                    {p.metodo_pago && <div className="text-muted-foreground">{p.metodo_pago}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{p.monto != null ? formatoPesos(Number(p.monto)) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{p.sku ?? <span className="text-xs text-muted-foreground">sin código</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="text-sm">{p.comprador_nombre ?? '—'}</div>
                    {p.comprador_documento && <div>{p.comprador_documento}</div>}
                    {p.comprador_telefono && <div>{p.comprador_telefono}</div>}
                    {p.comprador_email && <div className="text-muted-foreground">{p.comprador_email}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.envio ? (
                      <>
                        <div>{direccionEnvio(p.envio) ?? 'con envío'}</div>
                        {p.envio.telefono && <div className="text-muted-foreground">{p.envio.telefono}</div>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">sin envío</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className={`font-medium ${TONO_REGISTRO[p.registro]}`}>{ETIQUETA_REGISTRO[p.registro]}</div>
                    {p.motivo && <div className="max-w-xs text-muted-foreground">{p.motivo}</div>}
                    {puedeEditar && pagoPorAsignar(p) && <AsignarPago pagoId={p.id} sugerido={p.sku} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AsignarPago({ pagoId, sugerido }: { pagoId: string; sugerido: string | null }) {
  const [codigo, setCodigo] = useState(sugerido ?? '')
  const [pendiente, iniciar] = useTransition()
  return (
    <form
      className="mt-1 flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (!codigo.trim()) return
        iniciar(async () => {
          const r = await asignarPagoWompiAction(pagoId, codigo)
          if (r.ok) toast.success(r.mensaje ?? 'Venta registrada.')
          else toast.error(r.error)
        })
      }}
    >
      <input
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        placeholder="MP-xx"
        aria-label="Código de la publicación"
        className="h-7 w-20 rounded border bg-background px-1.5 text-xs"
      />
      <button type="submit" disabled={pendiente || !codigo.trim()} className="h-7 rounded bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
        {pendiente ? '…' : 'Asignar'}
      </button>
    </form>
  )
}
