/**
 * El bolsillo de datos con el que el motor decide una ruta.
 *
 * Cuando una etapa bifurca, el motor lee un campo del negocio y lo compara con el valor de
 * cada condición del `routing`. Ese campo sale de fusionar el `data` de los bloques `datos`
 * de la etapa fuente. Hasta hoy la fusión era un `Object.assign` sobre TODOS los bloques,
 * **sin mirar si el bloque le aplica al caso**.
 *
 * Lo que costó (SOENA, 2026-09-01): V0431 saltó de Certificación directo a Anexos, saltándose
 * Segundo cobro, Cartera, **Entrega** y Cita. El routing de Cartera lee `requiere_cita_dian`,
 * que vive en el bloque `cita_dian_requerida` con `condition: servicio = solo_iva`. V0431 es
 * `completo`: el bloque no le aplica, no se le muestra y no lo puede responder — pero el
 * cargue histórico le había sembrado ahí un `false`, y el motor lo leyó igual. Un valor que
 * el equipo no puede ver ni corregir decidió por dónde seguía el caso.
 *
 * La regla que faltaba es la que el resto del sistema ya aplica: **un bloque que no aplica no
 * se muestra, no se puede responder, y por tanto tampoco decide**. `camposDecisionDelNegocio`
 * ya la usaba para saber si EXIGIR el dato; aquí se aplica al VALOR, que es lo que faltaba.
 *
 * ── Por qué vive aparte ──────────────────────────────────────────────────────────────────
 * La fusión la hacen DOS sitios del motor que tienen que coincidir exactamente: el avance de
 * etapa (`cambiarEtapaNegocioConGate`) y el salto encadenado por saldo, que también resuelve
 * routing. Eran dos copias del mismo bucle, así que arreglar una dejaba la otra desviando
 * casos — el mismo defecto que ya costó caro con el ranking calculado en dos funciones.
 *
 * ⚠️ La condición NO se evalúa aquí en TypeScript. La fuente única es la función SQL
 * `condicion_cumplida`, la misma que usan los gates y que replica el render: si esto tuviera
 * su propia lectura, un bloque podría aplicar para la pantalla y no aplicar para el motor.
 * Por eso el evaluador entra por parámetro.
 */

/** Un bloque de la etapa fuente, tal como llega del join `negocio_bloques` + `bloque_configs`. */
export interface BloqueParaRouting {
  /** `negocio_bloques.data`. En los bloques `datos` es plano: `{ slug: valor }`. */
  data: unknown
  /** `bloque_configs.config_extra` del bloque dueño (trae `condition` y `desactivado`). */
  config_extra?: Record<string, unknown> | null
  /** Tipo del `bloque_definition`. Solo `datos` alimenta el routing. */
  tipo?: string | null
}

/**
 * ¿La `condition` de este bloque se cumple para este negocio?
 *
 * Recibe la condición cruda del `config_extra`. Devuelve `false` también cuando la
 * evaluación falla: es la misma convención que `camposDecisionDelNegocio` (allí un error
 * de la RPC deja `aplica = false`), y así el gate y el routing siguen viendo lo mismo.
 */
export type EvaluadorCondicion = (condicion: Record<string, unknown>) => Promise<boolean>

/** Un bloque desactivado no se dibuja: tampoco puede decidir. */
export function bloqueDesactivado(configExtra: Record<string, unknown> | null | undefined): boolean {
  return configExtra?.desactivado === true
}

/**
 * Fusiona el `data` de los bloques que SÍ le aplican al caso, en el orden en que llegan.
 *
 * Un bloque descartado no aporta ninguna de sus llaves: sus campos quedan **ausentes**, que
 * es lo mismo que vacío para `esRespuesta` y para el `String(campos[field] ?? '')` del
 * routing. El efecto es que el caso cae al `default_etapa_orden`, que es la ruta deliberada
 * cuando no hay respuesta.
 *
 * La evaluación de condiciones se **cachea por condición** dentro de la misma llamada: dos
 * bloques con la misma `condition` cuestan una sola ida a la base, no una por campo.
 */
export async function camposDeRouting(
  bloques: readonly BloqueParaRouting[],
  evaluarCondicion: EvaluadorCondicion,
): Promise<Record<string, unknown>> {
  const campos: Record<string, unknown> = {}
  const cache = new Map<string, boolean>()

  for (const b of bloques) {
    if (b.tipo !== 'datos') continue
    if (bloqueDesactivado(b.config_extra)) continue
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) continue

    const condicion = b.config_extra?.condition as Record<string, unknown> | null | undefined
    if (condicion) {
      const clave = JSON.stringify(condicion)
      let cumple = cache.get(clave)
      if (cumple === undefined) {
        cumple = await evaluarCondicion(condicion)
        cache.set(clave, cumple)
      }
      if (!cumple) continue
    }

    Object.assign(campos, b.data as Record<string, unknown>)
  }

  return campos
}
