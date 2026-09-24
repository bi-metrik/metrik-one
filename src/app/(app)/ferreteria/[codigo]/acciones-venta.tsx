'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { VentaDetalle } from '@/lib/ferreteria/datos'
import { ETIQUETA_PASO, PASOS_VENTA, pasoDeVenta } from '@/lib/ferreteria/reglas'
import { alinearNegocioVentaAction, marcarVentaEntregadaAction, registrarPagoVentaAction } from '../actions'

/**
 * El estado de una venta y lo que se puede hacer con ella: entregarla, registrar el pago de una
 * contra entrega, o poner al día su negocio si un avance anterior quedó a medias.
 *
 * El paso que se pinta es el del NEGOCIO en ONE, no el de la venta: si los dos no coinciden, lo
 * dice y ofrece alinearlos, en vez de mostrar un estado que el negocio no tiene.
 */
export function EstadoVenta({ venta }: { venta: VentaDetalle }) {
  const esperado = pasoDeVenta(venta)
  const n = venta.negocio
  if (!n) return <span className="text-xs text-muted-foreground">Sin negocio</span>
  const paso = n.paso ?? esperado
  return (
    <span className="whitespace-nowrap text-xs">
      <Link href={`/negocios/${n.id}`} className="underline underline-offset-2">
        {ETIQUETA_PASO[paso]}
      </Link>
      {!n.abierto && <span className="text-muted-foreground"> · cerrado</span>}
      {n.codigo && <span className="text-muted-foreground"> · {n.codigo}</span>}
    </span>
  )
}

export function AccionesVenta({ venta, hoy }: { venta: VentaDetalle; hoy: string }) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  const [fechaPago, setFechaPago] = useState(hoy)
  const n = venta.negocio
  if (!n) return null

  // La venta va ADELANTE de su negocio: un avance anterior se cortó a mitad (el negocio no pasó
  // de etapa o no se cerró). Se ofrece terminarlo; nunca se retrocede un negocio desde aquí.
  const esperado = pasoDeVenta(venta)
  const negocioAtrasado =
    n.paso !== null &&
    (PASOS_VENTA.indexOf(esperado) > PASOS_VENTA.indexOf(n.paso) || (esperado === 'pagado' && n.abierto))

  function correr(accion: () => Promise<{ ok: true; mensaje?: string } | { ok: false; error: string }>) {
    iniciar(async () => {
      const r = await accion()
      if (r.ok) {
        toast.success(r.mensaje ?? 'Listo.')
        router.refresh()
      } else toast.error(r.error)
    })
  }

  const boton = 'h-7 whitespace-nowrap rounded-md border px-2 text-xs disabled:opacity-50'

  if (negocioAtrasado) {
    return (
      <button type="button" className={boton} disabled={pendiente} onClick={() => correr(() => alinearNegocioVentaAction(venta.id))}>
        Poner al día el negocio
      </button>
    )
  }

  if (!n.abierto) return null

  if (!venta.entregada_at) {
    return (
      <button type="button" className={boton} disabled={pendiente} onClick={() => correr(() => marcarVentaEntregadaAction(venta.id))}>
        Marcar entregada
      </button>
    )
  }

  if (venta.forma_pago === 'contra_entrega' && !venta.fecha_primer_pago) {
    return (
      <span className="flex items-center gap-1">
        <input
          type="date"
          className="h-7 rounded-md border bg-background px-1 text-xs"
          value={fechaPago}
          min={venta.fecha_venta}
          max={hoy}
          onChange={(e) => setFechaPago(e.target.value)}
          aria-label="Fecha del pago"
        />
        <button type="button" className={boton} disabled={pendiente} onClick={() => correr(() => registrarPagoVentaAction(venta.id, fechaPago))}>
          Registrar pago
        </button>
      </span>
    )
  }
  return null
}
