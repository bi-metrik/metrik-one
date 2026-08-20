/**
 * "No aplican a este caso": las etapas que el proceso se saltó con razón.
 *
 * Sin esto, un caso que solo contrató devolución de IVA salta de E5 a E10 y en pantalla no
 * queda rastro de por qué. El equipo no puede distinguir un salto correcto de uno
 * equivocado, que es justo lo que la reversa de ruta existe para detectar: dos cosas que se
 * ven idénticas y significan lo contrario.
 *
 * Tres decisiones deliberadas:
 *
 * 1. **Nombra la respuesta, no solo las etapas.** "Cargue no aplica" obliga a ir a buscar
 *    el porqué; "porque en E4 Negociación se registró Solo devolución de IVA" se lee de una
 *    y dice dónde ir si está mal.
 *
 * 2. **No tiene botones.** No es una acción pendiente ni un problema: es el estado normal
 *    de un caso que tomó una vía legítima. Cambiar la vía se hace corrigiendo la respuesta
 *    en su etapa, y de eso se encarga la reversa de ruta, que sí propone y sí pregunta.
 *
 * 3. **Gris, no amarillo.** Un color de alerta le pondría urgencia a algo que está bien. El
 *    banner de reversa (ámbar, con botones) es el que avisa de lo que sí está mal, y los dos
 *    pueden aparecer en la misma pantalla: tienen que verse distintos a primera vista.
 */

import { SplitSquareHorizontal } from 'lucide-react'
import type { EtapaNoAplica } from '@/lib/negocios/ruta-descartada-negocio'

export function EtapasNoAplican({ etapas }: { etapas: EtapaNoAplica[] }) {
  if (etapas.length === 0) return null

  // Casi siempre es una sola decisión la que descarta todo un tramo, pero nada lo garantiza:
  // una línea con dos bifurcaciones produce dos motivos, y mezclarlos en una frase diría que
  // todas las etapas se descartaron por la misma respuesta.
  const porMotivo = new Map<string, { etapas: EtapaNoAplica[]; ref: EtapaNoAplica }>()
  for (const e of etapas) {
    const clave = `${e.decisionNumero}::${e.campoLabel}::${e.valorLabel}`
    const grupo = porMotivo.get(clave)
    if (grupo) grupo.etapas.push(e)
    else porMotivo.set(clave, { etapas: [e], ref: e })
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
      {[...porMotivo.values()].map(({ etapas: grupo, ref }) => (
        <div key={`${ref.decisionNumero}-${ref.valorLabel}`} className="flex items-start gap-2">
          <SplitSquareHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/80">No aplican a este caso: </span>
            {grupo.map((e, i) => (
              <span key={e.etapaId}>
                {i > 0 && <span className="opacity-50"> · </span>}
                <span className="font-mono opacity-70">E{e.numero}</span> {e.nombre}
              </span>
            ))}
            <span className="block opacity-80">
              En <span className="font-mono opacity-70">E{ref.decisionNumero}</span> {ref.decisionNombre} se
              respondió «{ref.valorLabel}» a {ref.campoLabel.toLowerCase().replace(/^¿|\?$/g, '')}.
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
