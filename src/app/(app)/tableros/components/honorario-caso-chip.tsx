/**
 * El estado del honorario de UN caso del panel de ventas, en una sola insignia.
 *
 * El defecto que esto cierra: un caso SIN honorario aprobado (la venta en cero de un
 * convenio, V0066 o V0429 en SOENA) llega con `caso_completo = true`, porque la vista
 * compara su recaudo contra cero y 0 >= 0. El panel le pintaba "Honorario cubierto" con
 * $0 al lado, y a la vez "Sin honorario aprobado": dos insignias que se contradicen, y la
 * verde es falsa, porque no hay ningun honorario que cubrir.
 *
 * Por eso la pregunta "¿tiene honorario aprobado?" va PRIMERO: sin honorario no se afirma
 * que este cubierto. El caso se sigue contando como venta, y el indicador "Honorario
 * cubierto" del tablero lo sigue sumando (no hay nada pendiente); lo que cambia es que la
 * insignia dice la verdad sobre el caso.
 *
 * Vive aparte de `ventas-drawer.tsx` para poder pintarse en una prueba sin arrastrar las
 * server actions que el panel importa.
 */
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ComercialVentaCaso } from '../../equipo/comercial-types'

const GRIS = 'var(--tinta-suave)'
const VERDE = 'var(--acento)'
const OCRE = '#92400E'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

export function HonorarioCasoChip({
  caso,
}: {
  caso: Pick<ComercialVentaCaso, 'sin_honorario_aprobado' | 'caso_completo' | 'recaudado'>
}) {
  if (caso.sin_honorario_aprobado) {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
        style={{ backgroundColor: '#FEF3C7', color: OCRE }}
        title="Este caso no tiene honorario aprobado: cuenta como venta, pero no hay honorario que cubrir ni que recaudar. El indicador «Honorario cubierto» lo suma porque no queda nada pendiente."
      >
        <AlertTriangle className="h-2.5 w-2.5" /> Sin honorario aprobado
      </span>
    )
  }
  if (caso.caso_completo) {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
        style={{ backgroundColor: 'var(--acento-tinte)', color: VERDE }}
      >
        <CheckCircle2 className="h-2.5 w-2.5" /> Honorario cubierto
      </span>
    )
  }
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
      style={{ backgroundColor: 'var(--papel)', color: GRIS }}
      title="Recaudado del honorario, sin IVA"
    >
      {fmtCOP(caso.recaudado)} recaudado
    </span>
  )
}
