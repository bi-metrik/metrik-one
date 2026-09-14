'use client'

import { CheckCircle, ChevronRight, Loader2, Lock, AlertTriangle } from 'lucide-react'
import { formatearSaldo } from '@/lib/negocios/confirmacion-avance'
import { saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'
import type { OfrecimientoAvance } from '@/lib/negocios/avance-tras-pago'

/**
 * Lo que se ve justo después de registrar un pago: en qué quedó la cuenta y, si el caso
 * ya puede seguir, el avance a un clic.
 *
 * Presentacional puro: no llama al servidor ni decide nada. La decisión la trae
 * `ofrecimiento` (de `ofrecimientoDeAvance`) y el movimiento lo dispara `onAvanzar`, que
 * el modal resuelve con `cambiarEtapaNegocioConGate`. Vive aparte del modal justamente
 * para poder renderizarlo en una prueba sin doblar una sola server action.
 *
 * ⚠️ El botón dice "Avanzar de etapa", NO "Avanzar a X". Es la misma decisión que se tomó
 * en la ficha del negocio (PR #33): el destino real lo resuelve el routing del servidor y
 * puede no ser el siguiente por orden, así que prometerlo en el botón engaña. El destino
 * por defecto se muestra al lado, como referencia, y el nombre de la etapa a la que el
 * caso REALMENTE llegó se pinta después, con lo que devolvió el servidor.
 */
export default function PanelTrasPago({
  ofrecimiento,
  saldo,
  etapaLlegada,
  avanzando,
  onAvanzar,
}: {
  ofrecimiento: OfrecimientoAvance
  /** Saldo del cliente con signo: `> 0` falta, `< 0` sobra. */
  saldo: number
  /** Etapa a la que el caso ya llegó, si el avance se ejecutó. */
  etapaLlegada: string | null
  avanzando: boolean
  onAvanzar: () => void
}) {
  return (
    <div className="space-y-3.5">
      <div
        className="flex items-start gap-2 rounded-md border px-3 py-2.5"
        style={{ borderColor: 'var(--acento)', backgroundColor: 'var(--acento-tinte)' }}
      >
        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--acento)' }} />
        <div className="min-w-0 text-[13px] leading-relaxed" style={{ color: 'var(--tinta)' }}>
          <p className="font-semibold">Pago registrado</p>
          <p style={{ color: 'var(--tinta-suave)' }}>{textoDeSaldo(saldo)}</p>
        </div>
      </div>

      {etapaLlegada ? (
        // El servidor ya movió el caso y dice DÓNDE quedó. Puede no ser el destino que
        // el panel mostró: el routing bifurca y el salto por saldo encadena etapas.
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--tinta)' }}>
          El caso avanzó a <span className="font-semibold">{etapaLlegada}</span>.
        </p>
      ) : (
        <Ofrecimiento ofrecimiento={ofrecimiento} avanzando={avanzando} onAvanzar={onAvanzar} />
      )}
    </div>
  )
}

function Ofrecimiento({
  ofrecimiento,
  avanzando,
  onAvanzar,
}: {
  ofrecimiento: OfrecimientoAvance
  avanzando: boolean
  onAvanzar: () => void
}) {
  if (ofrecimiento.tipo === 'avanzar') {
    return (
      <div className="space-y-2">
        <p className="text-[12px]" style={{ color: 'var(--tinta-suave)' }}>
          Con esto el caso ya puede seguir. Sigue en el flujo:{' '}
          <span className="font-semibold" style={{ color: 'var(--tinta)' }}>
            {ofrecimiento.etapaDestinoNombre}
          </span>
        </p>
        <button
          onClick={onAvanzar}
          disabled={avanzando}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--acento)' }}
        >
          {avanzando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
          Avanzar de etapa
        </button>
      </div>
    )
  }

  if (ofrecimiento.tipo === 'retenido') {
    return (
      <div
        className="rounded-md border px-3 py-2.5 text-[12px] leading-relaxed"
        style={{ borderColor: '#FCD34D', backgroundColor: '#FFFBEB', color: '#78350F' }}
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          El caso todavía no puede avanzar
        </p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          {ofrecimiento.motivos.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </div>
    )
  }

  if (ofrecimiento.tipo === 'sin_permiso') {
    // Se dice, en vez de dibujar un botón que el servidor va a rechazar. Quien registra
    // la plata muchas veces no es quien mueve el caso, y eso no es un error suyo.
    return (
      <p
        className="flex items-start gap-1.5 text-[12px] leading-relaxed"
        style={{ color: 'var(--tinta-suave)' }}
      >
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Esta etapa no la avanza tu área. El caso queda listo para que lo mueva quien la lleva.
      </p>
    )
  }

  // `no_aplica`: negocio cerrado o pausado, o última etapa de la línea. No hay nada que
  // ofrecer y tampoco nada que explicar: el pago quedó registrado, que era el trabajo.
  return null
}

/**
 * Cómo queda la cuenta del cliente, en una línea.
 *
 * El "cuadrado" NO es el cero exacto: es el mismo piso de materialidad con el que
 * `saldoCuadrado` juzga a todos los gates del producto. Sin él, un cliente que redondeó
 * al pagar vería "faltan $120" encima de un caso que el motor ya da por saldado.
 */
export function textoDeSaldo(saldo: number): string {
  if (saldoCuadrado(saldo)) return 'La cuenta del cliente queda cuadrada.'
  if (saldo > 0) return `Faltan ${formatearSaldo(saldo)} del honorario.`
  return `Sobran ${formatearSaldo(-saldo)} sobre el valor a recaudar.`
}
