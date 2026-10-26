'use client'

import { useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { pesos, textoSaldo } from '@/lib/funciones/reglas'
import type { ReservaVista } from '@/lib/funciones/datos'
import { cancelarReservaAction, confirmarPagoManualAction, regenerarLinkSaldoAction, registrarSaldoCobradoAction } from './actions'

type Props = {
  funcionId: string
  reserva: Pick<ReservaVista, 'id' | 'estado' | 'nombre' | 'personas' | 'abono_unitario' | 'permite_pago_total' | 'saldo'>
}

/**
 * Los botones de una reserva en la lista del día y en el detalle de la función:
 *   · «Pago verificado» (transferencia revisada a mano), diciendo si pagó el total o solo la reserva (P14b);
 *   · [Saldo cobrado] con el QR de Bold en el evento y «Link del saldo» (uno nuevo; el anterior vence), P14c;
 *   · cancelar.
 * La base decide todo (montos, plazo, permisos); aquí solo se pregunta y se muestra el resultado.
 */
export function AccionesReserva({ funcionId, reserva: r }: Props) {
  const [pendiente, empezar] = useTransition()
  const router = useRouter()
  const saldo = textoSaldo(r.saldo, r.estado)
  // La clave del cobro en curso: se genera al abrir el diálogo y se repite si el envío falla y se reintenta con el
  // mismo monto (la base devuelve el mismo pago). Un monto distinto es otro cobro: clave nueva. Se borra al salir bien.
  const cobro = useRef<{ clave: string; monto: number } | null>(null)
  const nombre = r.nombre ?? 'esta reserva'

  const correr = <T,>(f: () => Promise<{ ok: boolean; error?: string; dato?: T }>, ok: (dato?: T) => string) =>
    empezar(async () => {
      const x = await f()
      if (x.ok) {
        toast.success(ok(x.dato))
        router.refresh()
      } else toast.error(x.error ?? 'No se pudo.')
    })

  const verificar = (modalidad: 'total' | 'abono', etiqueta: string) => {
    if (confirm(`¿El pago de ${nombre} ya está verificado (transferencia revisada) y fue ${etiqueta}?`)) {
      correr(() => confirmarPagoManualAction(funcionId, r.id, modalidad), () => 'Pago verificado: reserva confirmada.')
    }
  }

  const cobrarSaldo = () => {
    // El botón está deshabilitado mientras envía; esto cubre el clic que entra antes del re-render.
    if (!r.saldo || pendiente) return
    const pedido = prompt(`Saldo cobrado con el QR de Bold para ${nombre}. Monto en pesos (el saldo es ${pesos(r.saldo.saldo)}):`, String(r.saldo.saldo))
    if (pedido === null) return
    const monto = Number(pedido.replace(/[^\d]/g, ''))
    if (!cobro.current || cobro.current.monto !== monto) cobro.current = { clave: crypto.randomUUID(), monto }
    const { clave } = cobro.current
    empezar(async () => {
      const x = await registrarSaldoCobradoAction(funcionId, r.id, monto, clave)
      if (x.ok) {
        cobro.current = null
        toast.success(`Saldo cobrado: ${pesos(monto)}.`)
        router.refresh()
      } else toast.error(x.error ?? 'No se pudo. Intenta de nuevo: no se cobra dos veces.')
    })
  }

  const linkSaldo = () => {
    if (!confirm(`¿Generar un link nuevo del saldo de ${nombre}? Si había uno, deja de valer.`)) return
    correr(
      () => regenerarLinkSaldoAction(funcionId, r.id),
      (d) => {
        if (d?.url) void navigator.clipboard?.writeText(d.url)
        return d ? `Link del saldo por ${pesos(d.monto)} copiado.` : 'Link del saldo listo.'
      },
    )
  }

  const boton = 'rounded border px-2 py-0.5 text-xs disabled:opacity-50'
  return (
    <span className="inline-flex flex-wrap gap-1 print:hidden">
      {r.estado === 'apartada' && r.permite_pago_total && (
        <button type="button" disabled={pendiente} onClick={() => verificar('total', 'por el total')} className={`${boton} border-[#10B981] text-[#059669] hover:bg-emerald-50`}>
          Pagó el total
        </button>
      )}
      {r.estado === 'apartada' && r.abono_unitario !== null && (
        <button
          type="button"
          disabled={pendiente}
          onClick={() => verificar('abono', `solo la reserva (${pesos(r.abono_unitario! * r.personas)})`)}
          className={`${boton} border-[#10B981] text-[#059669] hover:bg-emerald-50`}
        >
          Pagó la reserva
        </button>
      )}
      {saldo?.cobrar && (
        <>
          <button type="button" disabled={pendiente} onClick={cobrarSaldo} className={`${boton} border-[#10B981] text-[#059669] hover:bg-emerald-50`}>
            Saldo cobrado
          </button>
          <button type="button" disabled={pendiente} onClick={linkSaldo} className={`${boton} border-[#E5E7EB] text-[#6B7280] hover:bg-gray-50`}>
            Link del saldo
          </button>
          {r.saldo?.link?.url && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(r.saldo!.link!.url!)
                toast.success('Link del saldo copiado.')
              }}
              className={`${boton} border-[#E5E7EB] text-[#6B7280] hover:bg-gray-50`}
            >
              Copiar link
            </button>
          )}
        </>
      )}
      <button
        type="button"
        disabled={pendiente}
        onClick={() => {
          if (confirm(`¿Cancelar la reserva de ${r.nombre ?? 'esta persona'}? Libera su cupo.`)) {
            correr(() => cancelarReservaAction(funcionId, r.id), () => 'Reserva cancelada.')
          }
        }}
        className={`${boton} border-[#E5E7EB] text-[#6B7280] hover:bg-gray-50`}
      >
        Cancelar
      </button>
    </span>
  )
}
