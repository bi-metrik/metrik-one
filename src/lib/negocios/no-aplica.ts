/**
 * Cuando un caso NO le aplica al proceso, el proceso tiene que decirlo.
 *
 * ── Qué se estaba rompiendo ──────────────────────────────────────────────────────────
 * En la línea de devolución de IVA de SOENA, todos los bloques de Documentación llevan
 * `condition: tipo_persona = natural`. Si el solicitante se marca `juridica` —que es la
 * respuesta correcta, porque a una persona jurídica esa devolución no le aplica— los
 * bloques **simplemente no aparecen**: el negocio se queda mudo en Propuesta, sin nada que
 * completar y sin nada que explique por qué. Medido el 2026-09-18: **V0261, V0320 y
 * V0426**, los tres abiertos y los tres parados en Propuesta.
 *
 * Lo que hace un comercial delante de una pantalla vacía es exactamente lo que pasó en
 * V0497/V0498: volver atrás, marcar «natural» para que el flujo lo deje avanzar, y cargar
 * en el bloque del RUT el papel que sí tiene, que es la Cámara de Comercio. O sea que la
 * pantalla muda **no es un detalle de UX: es la causa del dato inventado**. Un bloque
 * oculto sin explicación empuja a mentirle al formulario.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────────────
 * La LÍNEA declara en qué casos no aplica y por qué (`config_extra.no_aplica`). Es la
 * línea y no la etapa porque «no aplica» es una propiedad del caso completo, no del paso
 * en el que esté parado.
 *
 * ⚠️ La condición NO se reevalúa aquí en TypeScript. Se resuelve con la MISMA función SQL
 * que usan los gates, el routing y el render (`condicion_cumplida`), que entra por
 * parámetro. Una segunda lectura del mismo `condition` es la lista paralela que ya costó
 * caro con las seccionales: la pantalla podría decir «no aplica» sobre un caso al que el
 * motor sí le está pidiendo documentos.
 *
 * ⚠️ Esto **avisa, no cierra**. Cerrar un negocio tiene motivo, autor y consecuencias
 * financieras; decidirlo automáticamente sobre una respuesta que alguien puede corregir
 * en el siguiente clic sería peor que el silencio de hoy. El aviso dice qué hacer y la
 * persona lo hace.
 */

/** Una razón declarada por la que un caso no le aplica al proceso. */
export interface ReglaNoAplica {
  /** Misma forma que el `condition` de un bloque: la resuelve `condicion_cumplida`. */
  condition: Record<string, unknown>
  /** Titular, en la voz del proceso: «Este caso no aplica para devolución de IVA». */
  titulo: string
  /** Por qué. Una o dos frases; es lo que evita que alguien "corrija" la respuesta. */
  mensaje: string
  /** Qué hacer ahora. Sin esto el aviso deja al operador igual de atascado. */
  que_hacer?: string
}

export interface AvisoNoAplica {
  titulo: string
  mensaje: string
  que_hacer: string | null
}

function esRegla(v: unknown): v is ReglaNoAplica {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.condition === 'object' && r.condition !== null &&
    typeof r.titulo === 'string' && r.titulo.trim().length > 0 &&
    typeof r.mensaje === 'string' && r.mensaje.trim().length > 0
  )
}

/**
 * Las reglas declaradas por la línea. Una línea que no declara nada devuelve `[]`, y
 * entonces no se evalúa ninguna condición ni se pinta ningún aviso.
 */
export function reglasNoAplica(
  configExtraLinea: Record<string, unknown> | null | undefined,
): ReglaNoAplica[] {
  const crudo = configExtraLinea?.no_aplica
  if (!Array.isArray(crudo)) return []
  return crudo.filter(esRegla)
}

export type EvaluadorCondicion = (condicion: Record<string, unknown>) => Promise<boolean>

/**
 * La primera regla que se cumple, o `null`.
 *
 * Primera y no «todas»: dos avisos simultáneos compiten por la misma atención y el
 * operador no sabría cuál atender. El orden del arreglo es el orden de precedencia, y eso
 * lo decide quien configura la línea.
 */
export async function avisoNoAplica(
  reglas: ReglaNoAplica[],
  cumple: EvaluadorCondicion,
): Promise<AvisoNoAplica | null> {
  for (const r of reglas) {
    let ok = false
    try {
      ok = await cumple(r.condition)
    } catch {
      // Un evaluador que falla NO inventa un «no aplica»: afirmar de más sobre un caso
      // vivo es peor que callar. Mismo criterio que `camposDeRouting`.
      ok = false
    }
    if (ok) {
      return {
        titulo: r.titulo,
        mensaje: r.mensaje,
        que_hacer: r.que_hacer?.trim() ? r.que_hacer : null,
      }
    }
  }
  return null
}
