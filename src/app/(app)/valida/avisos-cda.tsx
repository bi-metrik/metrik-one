import Link from 'next/link'
import { AlertTriangle, CalendarClock, PauseCircle } from 'lucide-react'
import {
  mensajeSuspendidoPorMora,
  textoAvisoMora,
  textoAvisoPlazo,
  type EstadoMora,
} from '@/lib/valida-cda/plazos'

/**
 * Los avisos de `/valida` de un CDA. La pausa por mora (sin montos) la ven TODOS los usuarios del
 * espacio; el plazo de los términos, la mora dentro de los 30 días y la franja de una línea que lleva
 * a Suscripción, solo la persona designada del contrato (`puedeVerSuscripcion`), que es quien la
 * maneja.
 *
 * Los textos salen de `plazos.ts`, los mismos que devuelven las acciones del servidor: la pantalla y
 * el rechazo no pueden decir fechas distintas.
 *
 * Sin estado ni efectos: se pintan en el servidor.
 */

/** Términos pendientes, pero dentro del plazo: Valida opera y avisa hasta cuándo. */
export function AvisoPlazoTerminos({
  plazoHasta,
  puedeAceptar,
  designadoNombre,
}: {
  plazoHasta: string
  /** Quien entra es la persona designada y puede aceptar ahora. */
  puedeAceptar: boolean
  designadoNombre: string | null
}) {
  return (
    <section
      data-aviso-plazo-terminos
      className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 hidden h-5 w-5 shrink-0 sm:block" />
        <div className="space-y-1">
          <p className="font-semibold">{textoAvisoPlazo(plazoHasta)}</p>
          {!puedeAceptar && designadoNombre && <p>La persona designada es {designadoNombre}.</p>}
        </div>
      </div>
      {puedeAceptar && (
        <Link
          href="/valida?terminos=1"
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-acento px-4 py-2 text-sm font-semibold text-white"
        >
          Leer y aceptar los Términos
        </Link>
      )}
    </section>
  )
}

/** Cuota vencida, dentro de los 30 días que tolera la cláusula 11.1. */
export function AvisoMora({ mora }: { mora: Extract<EstadoMora, { estado: 'en_mora' }> }) {
  return (
    <section
      data-aviso-mora
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="font-semibold">{textoAvisoMora(mora)}</p>
    </section>
  )
}

/** Más de 30 días de mora: en lugar de las consultas. */
export function PausaPorMora({
  mora,
  vePagos,
}: {
  mora: Extract<EstadoMora, { estado: 'suspendido' }>
  vePagos: boolean
}) {
  return (
    <section data-pausa-mora className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <PauseCircle className="mt-0.5 hidden h-5 w-5 shrink-0 text-amber-800 sm:block" />
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-tinta">Valida está pausada</h2>
          <p className="text-sm text-tinta">{mensajeSuspendidoPorMora(mora)}</p>
          {vePagos ? (
            <p className="text-sm text-tinta-suave">
              En{' '}
              <Link href="/suscripcion?tab=pagos" className="font-semibold text-acento">
                Suscripción
              </Link>{' '}
              está la cuota vencida, con su enlace de pago cuando MeTRIK lo haya enviado.
            </p>
          ) : (
            <p className="text-sm text-tinta-suave">
              La persona designada por tu empresa puede ver y pagar la cuota.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * Una línea para quien maneja la suscripción cuando hay algo que hacer («Tu cuota vence el 30-sep ·
 * Pagar»). El pago y sus detalles viven en `/suscripcion`; aquí solo se avisa y se lleva allá.
 */
export function FranjaSuscripcion({ texto }: { texto: string }) {
  return (
    <Link
      href="/suscripcion"
      data-franja-suscripcion
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-2.5 text-sm text-tinta"
    >
      <span>{texto}</span>
      <span className="shrink-0 font-semibold text-acento">Pagar</span>
    </Link>
  )
}
