import 'server-only'

/**
 * Desenlace que devuelve el caso — la parte que habla con la base.
 *
 * Las REGLAS viven en `desenlace-retorno.ts` (módulo puro, con pruebas): qué declara la
 * etapa, cuándo la señal está viva, cuántos ciclos van y cómo queda el `data` archivado.
 * Aquí solo se resuelven contra el negocio concreto y se ejecuta.
 *
 * ── Por qué corre al LEER el negocio y no al avanzar ─────────────────────────────────
 * El motor de avance (`cambiarEtapaNegocioConGate`) mueve el caso y no expone ningún
 * punto de extensión posterior al movimiento. Colgarse de la LECTURA tiene una propiedad
 * que el enganche al avance no tendría: **es reintentable**. La señal de que hay trabajo
 * pendiente es la respuesta del desenlace viva en el bloque que la preguntó, y lo que la
 * consume es archivar ese bloque — que se hace de ÚLTIMO. Si la pasada se cae a la mitad
 * (se guardó la marca y no se archivó, o se archivó una casilla y no la otra), la
 * siguiente lectura del negocio la vuelve a completar, y el conteo NO se duplica porque
 * se deriva de los ciclos archivados, no de un contador que se incrementa.
 *
 * El caso no puede escaparse en el intervalo: el botón de avanzar vive en la ficha del
 * negocio, y abrir la ficha es exactamente lo que dispara esto.
 *
 * ⚠️ Es el mismo patrón perezoso que ya usan el auto-init de casillas, el de la propuesta
 * económica y la limpieza del campo huérfano de `cita_dian_confirmacion`, todos en
 * `getNegocioDetalle`. La diferencia con el guard `solo_si` —que este archivo documenta
 * como "limpieza que nunca corrió"— es de alcance: aquel colgaba de una etapa por la que
 * los casos ya habían pasado; este corre en la etapa donde el caso ESTÁ.
 *
 * No lanza nunca. Un fallo aquí no puede impedir que la ficha del negocio se abra, pero
 * tampoco puede quedar mudo: cada tropiezo va a consola.
 */

import { visiblePuedeNacerCompleto } from './bloque-visible-completo'
import { guardarMarcaAnidadaEnMetadata } from './marca-metadata'
import {
  archivarData,
  bloqueArchivable,
  construirMarcaDesenlace,
  conteoDeDesenlaces,
  desenlacesDelDestino,
  leerDesenlaces,
  senalViva,
  type DeclaracionDesenlace,
} from './desenlace-retorno'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

/** Clave FIJA bajo la que viven todas las marcas de desenlace en `negocios.metadata`. */
export const CLAVE_DESENLACES = 'desenlaces'

type BloqueInstancia = {
  id: string
  data: Record<string, unknown> | null
  estado: string | null
  bloque_configs: {
    slug: string | null
    estado: string | null
    es_gate: boolean | null
    config_extra: Record<string, unknown> | null
  } | null
}

export type EtapaParaDesenlace = {
  orden: number
  config_extra: Record<string, unknown> | null
}

export type ResultadoDesenlace = {
  marca: string
  conteo: number
  bloquesArchivados: number
}

/**
 * Consume los desenlaces pendientes de un negocio que ya está en la etapa destino.
 *
 * Devuelve `[]` sin tocar la base cuando ninguna etapa de la línea declara
 * `desenlace_retorno`: ese atajo es lo que mantiene el costo en CERO para los workspaces
 * que no usan esto, y `getNegocioDetalle` corre en cada apertura de ficha del producto.
 */
export async function aplicarDesenlacesDeRetorno(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string
  negocioId: string
  etapaActualOrden: number | null
  etapasLinea: readonly EtapaParaDesenlace[]
  /** Inyectable para poder fijar el instante en las pruebas. */
  ahoraISO?: string
}): Promise<ResultadoDesenlace[]> {
  const { supabase, workspaceId, negocioId, etapaActualOrden, etapasLinea } = params

  const declaradas = etapasLinea.flatMap(e => leerDesenlaces(e.config_extra))
  if (declaradas.length === 0) return []

  const candidatas = desenlacesDelDestino(declaradas, etapaActualOrden)
  if (candidatas.length === 0) return []

  const out: ResultadoDesenlace[] = []
  for (const decl of candidatas) {
    try {
      const r = await consumirDesenlace(supabase, workspaceId, negocioId, decl, params.ahoraISO)
      if (r) out.push(r)
    } catch (err) {
      console.error(`[desenlace] no se pudo consumir "${decl.marca}" del negocio ${negocioId}:`, err)
    }
  }
  return out
}

async function consumirDesenlace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  negocioId: string,
  decl: DeclaracionDesenlace,
  ahoraInyectada?: string,
): Promise<ResultadoDesenlace | null> {
  // ── La señal ──────────────────────────────────────────────────────────────
  // El slug es único por línea (lo verifica `audit_block_slug_refs`), así que acotar por
  // negocio + slug alcanza: no hace falta resolver la línea.
  const senal = await leerBloquePorSlug(supabase, negocioId, decl.bloque)
  if (!senal) return null
  if (!senalViva(decl, senal.data)) return null

  const ahora = ahoraInyectada ?? new Date().toISOString()
  const conteo = conteoDeDesenlaces(senal.data, decl.marca)

  // ── La referencia que queda en la marca ───────────────────────────────────
  // Se lee ANTES de archivar nada: el radicado del PQR rechazado vive en un bloque que
  // este mismo mecanismo está a punto de vaciar.
  let referencia: string | null = null
  if (decl.referencia) {
    const bloqueRef =
      decl.referencia.bloque === decl.bloque
        ? senal
        : await leerBloquePorSlug(supabase, negocioId, decl.referencia.bloque)
    const v = (bloqueRef?.data ?? {})[decl.referencia.campo]
    referencia = v === null || v === undefined || v === '' ? null : String(v)
  }

  // ── La marca ──────────────────────────────────────────────────────────────
  // Va PRIMERO y por `guardarMarcaAnidadaEnMetadata`, que relee la metadata justo antes
  // del update: un update armado sobre la copia que `getNegocioDetalle` leyó al empezar
  // pisaría en silencio lo que otro proceso escribiera en el medio (costó 12 negocios
  // con el tercero de Siigo corrupto el 2026-09-02).
  const guardada = await guardarMarcaAnidadaEnMetadata(
    supabase,
    workspaceId,
    negocioId,
    CLAVE_DESENLACES,
    decl.marca,
    construirMarcaDesenlace({ decl, conteo, ahoraISO: ahora, referencia }),
  )
  if (!guardada.ok) {
    // Sin marca no se archiva: archivar consume la señal y el rechazo se perdería sin
    // dejar rastro, que es justo lo que la marca existe para evitar. La próxima lectura
    // reintenta con la señal intacta.
    console.error(`[desenlace] no se pudo marcar "${decl.marca}" en ${negocioId}: ${guardada.mensaje}`)
    return null
  }

  // ── El archivado ──────────────────────────────────────────────────────────
  // Los dependientes primero y la SEÑAL de último: mientras la señal viva, una pasada
  // interrumpida se puede completar. Al revés, el caso quedaría en el bucle sin ninguna
  // forma de detectarlo.
  let archivados = 0
  for (const slug of decl.archivar) {
    if (slug === decl.bloque) continue
    if (await archivarBloque(supabase, negocioId, slug, decl, conteo, ahora)) archivados++
  }
  if (await archivarBloque(supabase, negocioId, decl.bloque, decl, conteo, ahora, senal)) archivados++

  return { marca: decl.marca, conteo, bloquesArchivados: archivados }
}

async function leerBloquePorSlug(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  slug: string,
): Promise<BloqueInstancia | null> {
  const { data, error } = await db(supabase)
    .from('negocio_bloques')
    .select('id, data, estado, bloque_configs!inner(slug, estado, es_gate, config_extra)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', slug)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error(`[desenlace] no se pudo leer el bloque "${slug}" de ${negocioId}:`, error)
    return null
  }
  return (data ?? null) as BloqueInstancia | null
}

/**
 * Archiva una casilla: su contenido pasa a `_ciclos` y queda `pendiente` para volver a
 * preguntarse.
 *
 * ⚠️ `bloqueArchivable` manda sobre la declaración. Un bloque heredado, uno marcado
 * `conservar_en_reproceso` o cualquiera que mueva plata NO se vacía aunque alguien lo
 * declare: el criterio lo aplica el código, no la configuración. Es el mismo guard del
 * retorno al punto de decisión, compartido a propósito para que dos mecanismos vecinos
 * no traten el mismo bloque de forma distinta.
 */
async function archivarBloque(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  slug: string,
  decl: DeclaracionDesenlace,
  ciclo: number,
  ahora: string,
  yaLeido?: BloqueInstancia,
): Promise<boolean> {
  const inst = yaLeido ?? (await leerBloquePorSlug(supabase, negocioId, slug))
  if (!inst) return false

  const cfg = inst.bloque_configs
  if (!bloqueArchivable(cfg?.config_extra)) return false

  const { data, teniaContenido } = archivarData(inst.data, {
    ciclo,
    archivadoAt: ahora,
    marca: decl.marca,
    campo: decl.campo,
  })
  if (!teniaContenido) return false

  // Misma regla que el auto-init de la etapa: un `visible` que es gate y tiene campos
  // obligatorios sin valor NO nace resuelto. En un bloque `editable` esto da falso y la
  // casilla queda `pendiente`, que es lo que retiene el caso hasta que alguien responda.
  const nace =
    cfg?.estado === 'visible' &&
    visiblePuedeNacerCompleto(cfg?.config_extra ?? null, {}, cfg?.es_gate === true)

  const { error } = await db(supabase)
    .from('negocio_bloques')
    .update({
      data,
      estado: nace ? 'completo' : 'pendiente',
      completado_at: nace ? ahora : null,
      updated_at: ahora,
    })
    .eq('id', inst.id)
  if (error) {
    console.error(`[desenlace] no se pudo archivar el bloque "${slug}" de ${negocioId}:`, error)
    return false
  }
  return true
}
