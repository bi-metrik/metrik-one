/**
 * Retorno al punto de decisión: las REGLAS, en un solo sitio.
 *
 * Cuando alguien corrige, desde el historial, un campo que DECIDE la ruta del caso, y el
 * caso ya pasó el punto donde ese campo se evalúa, el dato queda bien y el negocio sigue
 * en la rama equivocada. Corregir sin devolver es peor que no corregir: deja el sistema
 * diciendo dos cosas distintas sobre el mismo caso.
 *
 * Esto NO reemplaza el reproceso (`reproceso-actions.ts`). El reproceso rehace un tramo
 * completo porque un tercero rechazó el trabajo (la UPME emite un certificado malo);
 * aquí no se rechazó nada, solo se decidió con un dato equivocado, así que se archiva y
 * vacía **solo lo que dependía de esa decisión**. Comparte el destino declarado por
 * configuración, el archivado en `data._ciclos`, la marca en el negocio y la notificación.
 *
 * ── Todo declarado por configuración ────────────────────────────────────────────────
 * La etapa que EVALÚA el routing declara de qué campo es punto de retorno:
 *
 *   etapas_negocio.config_extra.punto_de_decision = [
 *     { campo: 'requiere_cita_dian',
 *       aviso: '…',                              // opcional, reemplaza el texto por defecto
 *       depende: { etapas: [12, 13], bloques: ['x'] } }   // etapas por `numero`, bloques por slug
 *   ]
 *
 * Sin esa declaración el comportamiento es idéntico al de hoy para todos los workspaces.
 * No hay una sola lista de campos de SOENA dentro de `src/`.
 *
 * ── Por qué vive aparte ─────────────────────────────────────────────────────────────
 * Las mismas reglas las aplican el servidor (al guardar la corrección) y la consulta que
 * alimenta el aviso de la pantalla. Si cada lado las implementara por su cuenta, el aviso
 * diría una cosa y el sistema haría otra — el mismo defecto que ya costó caro con el
 * ranking calculado en dos funciones.
 */

import type { RoutingEtapa } from './dato-de-decision'

/** Una etapa declara que es punto de retorno de un campo decisor. */
export interface DeclaracionRetorno {
  /** Slug del campo que gobierna la bifurcación de esta etapa. */
  campo: string
  /** Texto del aviso. Si falta, se redacta uno con el nombre de la etapa. */
  aviso?: string | null
  /** Qué se archiva y vacía al volver. Vacío = no se archiva nada, solo se devuelve. */
  depende?: {
    /** Etapas por su `numero` (el identificador ESTABLE, no el `orden` interno). */
    etapas?: number[]
    /** Bloques por su `slug` estable. Nunca por nombre: renombrar rompería la referencia. */
    bloques?: string[]
  }
}

export interface EtapaRetorno {
  id: string
  nombre: string
  orden: number
  numero: number
  routing?: RoutingEtapa | null
}

/**
 * Lee las declaraciones de una etapa. Solo formas bien escritas cuentan: devolver un caso
 * a otra etapa es demasiado caro para hacerlo por una config a medio escribir.
 */
export function leerDeclaraciones(
  configExtra: Record<string, unknown> | null | undefined,
): DeclaracionRetorno[] {
  const crudo = configExtra?.punto_de_decision
  if (!Array.isArray(crudo)) return []
  const out: DeclaracionRetorno[] = []
  for (const d of crudo) {
    if (!d || typeof d !== 'object') continue
    const campo = (d as Record<string, unknown>).campo
    if (typeof campo !== 'string' || campo.trim() === '') continue
    const dep = (d as Record<string, unknown>).depende as Record<string, unknown> | undefined
    const aviso = (d as Record<string, unknown>).aviso
    out.push({
      campo,
      aviso: typeof aviso === 'string' && aviso.trim() !== '' ? aviso : null,
      depende: {
        etapas: Array.isArray(dep?.etapas)
          ? (dep!.etapas as unknown[]).filter((n): n is number => typeof n === 'number')
          : [],
        bloques: Array.isArray(dep?.bloques)
          ? (dep!.bloques as unknown[]).filter((s): s is string => typeof s === 'string' && s !== '')
          : [],
      },
    })
  }
  return out
}

/**
 * Destinos posibles al salir de una etapa: el default más cada rama condicional.
 *
 * Sigue el mismo criterio canónico de `flujo.ts` — routing que se apunta a sí mismo cierra,
 * y sin routing sigue la siguiente por orden ASCENDENTE, nunca `orden + 1` (el `orden` no
 * es contiguo). La diferencia es que aquí interesan TODAS las salidas, no solo la de por
 * defecto: para saber si un caso está aguas abajo hay que recorrer las ramas.
 */
export function destinosDeEtapa(etapa: EtapaRetorno, etapas: readonly EtapaRetorno[]): number[] {
  const routing = etapa.routing
  if (!routing) {
    const siguiente = [...etapas].sort((a, b) => a.orden - b.orden).find(e => e.orden > etapa.orden)
    return siguiente ? [siguiente.orden] : []
  }
  const destinos = new Set<number>()
  if (typeof routing.default_etapa_orden === 'number') destinos.add(routing.default_etapa_orden)
  for (const regla of routing.conditional ?? []) {
    if (typeof regla?.etapa_orden === 'number') destinos.add(regla.etapa_orden)
  }
  // Apuntarse a sí misma es la forma de declarar "el proceso cierra aquí": no es una salida.
  destinos.delete(etapa.orden)
  return [...destinos]
}

/**
 * Etapas alcanzables desde una etapa, recorriendo TODAS las ramas del routing.
 *
 * Hace falta porque **el `orden` NO ordena el recorrido**. Medido en SOENA VE: Anexos
 * (orden 18) enruta a Generación (orden 13), así que "orden mayor" no significa "más
 * adelante". Comparar órdenes devolvería casos hacia adelante creyendo que los devuelve
 * hacia atrás.
 *
 * Devuelve órdenes, no ids, porque el routing habla en órdenes.
 */
export function etapasAguasAbajo(etapas: readonly EtapaRetorno[], origenOrden: number): Set<number> {
  const porOrden = new Map(etapas.map(e => [e.orden, e]))
  const vistas = new Set<number>()
  const cola = [origenOrden]
  while (cola.length > 0) {
    const actual = porOrden.get(cola.shift()!)
    if (!actual) continue
    for (const destino of destinosDeEtapa(actual, etapas)) {
      if (vistas.has(destino)) continue
      vistas.add(destino)
      cola.push(destino)
    }
  }
  vistas.delete(origenOrden)
  return vistas
}

/**
 * ¿Este bloque se puede archivar y vaciar al volver?
 *
 * Tres negativas, cada una por un incidente distinto:
 *
 * 1. **Heredado readonly** (`source_etapa_orden`): apunta al dato de su bloque origen, que
 *    vive en una etapa que NO se está rehaciendo. Vaciarlo borraría información ajena.
 *    En SOENA VE son 25 bloques, `requiere_devolucion_iva` entre ellos con 5 copias.
 *    (Estructuralmente ya quedan fuera porque los heredados tienen `slug` nulo y la
 *    declaración referencia por slug, pero eso es una coincidencia del esquema, no una
 *    garantía: si mañana un heredado tuviera slug, este guard sigue siendo el que manda.)
 *
 * 2. **`conservar_en_reproceso`**: documentos que siguen sirviendo y no hay por qué volver
 *    a pedirle al cliente (el certificado bancario dura 30 días). Mismo criterio que el
 *    reproceso; si aquí dijera otra cosa, dos mecanismos vecinos tratarían el mismo bloque
 *    de forma distinta.
 *
 * 3. **⚠️ Bloques que MUEVEN PLATA.** Un bloque de pagos vaciado se vuelve a llenar, y al
 *    volver a llenarse dispara los auto-cobros. `autoCrearCobrosMulti` es idempotente por
 *    (referencia, monto) y `autoCrearCobros` actualiza el anticipo existente, así que hoy
 *    no duplicaría; pero la idempotencia es una propiedad de esas funciones, no del
 *    mecanismo, y el dinero no vive en `data` sino en la tabla `cobros`: archivar el bloque
 *    NO revierte el cobro, deja la pantalla en desacuerdo con la plata. Un bloque de dinero
 *    no se archiva NUNCA, esté o no declarado. La regla la aplica el código, no la config.
 */
export function bloqueArchivable(configExtra: Record<string, unknown> | null | undefined): boolean {
  const ce = configExtra ?? {}
  if (ce.source_etapa_orden !== undefined) return false
  if (ce.conservar_en_reproceso === true) return false
  if (ce.es_pagos_epayco === true || ce.es_pago_externo === true) return false
  const triggers = (ce.triggers ?? []) as Array<{ action?: string }>
  if (Array.isArray(triggers) && triggers.some(t => t?.action === 'auto_cobros' || t?.action === 'auto_cobros_multi')) {
    return false
  }
  return true
}

/**
 * ¿Hay que devolver el caso al punto de decisión?
 *
 * Tres condiciones, todas necesarias:
 *
 * 1. **El caso NO está en la etapa de decisión.** Si sigue ahí, el motor todavía no ha
 *    decidido: corregir el dato basta.
 *
 * 2. **El caso PASÓ por esa etapa.** `paso` se mide por hechos (tiene casillas de esa
 *    etapa, que solo nacen al entrar), no por comparar órdenes. Medido en SOENA el
 *    2026-08-03: de los 116 casos que están en Cita, solo **8** pasaron por Entrega — los
 *    otros 108 llegaron directo desde Cobro o entraron ahí en el cargue histórico.
 *    Devolverlos a Entrega los mandaría a una etapa que nunca recorrieron.
 *
 * 3. **La etapa actual está aguas abajo de la de decisión**, siguiendo el routing real.
 *    Cubre el caso del negocio que ya fue devuelto hacia atrás por otra vía: volverá a
 *    pasar por el punto de decisión solo, sin que nadie lo mueva.
 */
export function debeRetornar(input: {
  etapaActualOrden: number
  etapaActualId: string
  decisionEtapaId: string
  decisionEtapaOrden: number
  pasoPorLaEtapa: boolean
  aguasAbajo: Set<number>
}): boolean {
  if (input.etapaActualId === input.decisionEtapaId) return false
  if (!input.pasoPorLaEtapa) return false
  return input.aguasAbajo.has(input.etapaActualOrden)
}

/**
 * El aviso, en palabras del equipo. La etapa puede reemplazarlo entero con `aviso`.
 */
export function mensajeAviso(decl: DeclaracionRetorno, etapaNombre: string, label?: string | null): string {
  if (decl.aviso) return decl.aviso
  const pregunta = label?.trim() || decl.campo
  return `"${pregunta}" define la ruta del caso: cambiarlo lo devuelve a ${etapaNombre} para volver a decidir.`
}
