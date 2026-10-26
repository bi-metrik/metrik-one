'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { redactarTextoCliente } from '@/lib/ai/redactar-documento-cliente'
import {
  conAlertas,
  hayViajeQueRedactar,
  normalizarTexto,
  revisarEstilo,
  textoDesactualizado,
  textoVacio,
  type DocumentoCliente,
  type PanelTextoCliente,
  type TextoCliente,
} from '@/lib/cotizaciones/documento-cliente'
import { leerContextoTextoCliente, type ContextoTextoCliente } from '@/lib/cotizaciones/documento-cliente-datos'
import { normalizarTerminos } from '@/lib/cotizaciones/terminos-cotizacion'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import { PLANTILLA_POR_DEFECTO, plantillaUsaTextoDelCliente, usaMotorHtml } from '@/lib/pdf/plantillas-cotizacion'
import { conAnticipo, normalizarAnticipo } from '@/lib/cotizaciones/propuesta/anticipo'
import { getServerKey } from '@/lib/server-keys'
import { exigirPorPasos } from '@/lib/cotizaciones/por-pasos-datos'
import { INCLUYE_POR_ONE } from '@/lib/cotizaciones/incluye-por-one'
import { nombresDelViaje, parrafosViejos, type ZonaDeParrafo } from '@/lib/cotizaciones/parrafo-viejo'

/**
 * C6 · «Incluye» armado por ONE: la forma por pasos pide guardar (o redactar) con la marca
 * `incluye_origen = 'one'`. Se comprueba la pieza contra la base; con ella apagada no se marca.
 */
type OpcionesPorPasos = { porPasos?: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function marcaIncluyePorOne(supabase: any, cotizacionId: string, opciones?: OpcionesPorPasos): Promise<{ marca: boolean } | { fallo: Fallo }> {
  if (opciones?.porPasos !== true) return { marca: false }
  const guard = await exigirPorPasos(supabase, cotizacionId, 'incluye_por_one')
  return guard.ok ? { marca: true } : { fallo: { success: false, error: guard.error } }
}

/**
 * El texto para el cliente del documento de Trappvel: leerlo, redactarlo con ONE y
 * guardarlo revisado.
 *
 * Las reglas viven en `src/lib/cotizaciones/documento-cliente.ts`; este archivo solo
 * ejecuta. Tres cosas se deciden AQUÍ y no en el navegador, porque una server action
 * exportada es un endpoint alcanzable con cualquier id:
 *
 * · Que el workspace use la plantilla de Trappvel. Con otra plantilla nada de esto
 *   existe: ni panel, ni redacción, ni columna leída.
 * · Que la cotización sea un borrador, igual que sus líneas.
 * · La huella y la revisión: el navegador no manda ni la una ni la otra.
 *
 * Los términos y condiciones de la cotización viven en el mismo panel y se guardan con el
 * mismo botón (brief del 2026-09-23, C1 y C2), pero en su columna de siempre,
 * `terminos_condiciones`. «Redactar con ONE» no los toca: son reglas de la reserva, no
 * texto comercial.
 */

type Fallo = { success: false; error: string; requiereConfirmacion?: boolean }
type Exito = { success: true; panel: PanelTextoCliente }

/** Roles que ven la cotización pero no escriben en ella. */
const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])

const MENSAJE_SIN_COLUMNA =
  'El texto para el cliente todavía no está disponible: falta aplicar la migración de la base.'

function panelDe(
  ctx: ContextoTextoCliente,
  documento: DocumentoCliente | null,
  terminos: string | null = ctx.terminos,
  motorHtml = false,
  anticipo = ctx.anticipo,
): PanelTextoCliente {
  const desactualizado = textoDesactualizado(documento, ctx.huella)
  // D5 · qué párrafo quedó viejo: solo un texto de la forma por pasos guarda los nombres.
  const viejos = desactualizado && documento?.fuente_nombres ? parrafosViejos(documento, nombresDelViaje(ctx.viaje)) : null
  return {
    anticipo,
    imprimeAnticipo: motorHtml,
    columnaPresente: ctx.columnaPresente,
    documento,
    desactualizado,
    ...(viejos ? { parrafosViejos: viejos } : {}),
    hayViaje: hayViajeQueRedactar(ctx.viaje),
    editable: isEditable((ctx.estado ?? '') as EstadoCotizacion),
    terminos,
    terminosBase: ctx.configLinea.terminosBase,
  }
}

/** ¿La plantilla del workspace imprime texto del cliente? ¿Tiene el motor `html` encendido? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function plantillaDelWorkspace(supabase: any, workspaceId: string): Promise<{ texto: boolean; motorHtml: boolean }> {
  const { data } = await supabase
    .from('workspaces')
    .select('cotizacion_template_slug, config_extra')
    .eq('id', workspaceId)
    .maybeSingle()
  const fila = data as { cotizacion_template_slug?: string | null; config_extra?: unknown } | null
  const slug = fila?.cotizacion_template_slug ?? PLANTILLA_POR_DEFECTO
  return { texto: plantillaUsaTextoDelCliente(slug), motorHtml: usaMotorHtml(slug, fila?.config_extra) }
}

/**
 * Todo lo que tiene que cumplirse para ESCRIBIR el texto, en un solo lugar. Devuelve el
 * contexto leído o el motivo exacto por el que no.
 */
async function contextoParaEscribir(cotizacionId: string) {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) {
    return { fallo: { success: false, error: String(error ?? 'No autenticado') } as Fallo }
  }
  if (role && ROLES_SIN_ESCRITURA.has(role)) {
    return { fallo: { success: false, error: 'Tu rol puede ver la cotización pero no editar su texto.' } as Fallo }
  }
  const plantilla = await plantillaDelWorkspace(supabase, workspaceId)
  if (!plantilla.texto) {
    return { fallo: { success: false, error: 'La plantilla de este workspace no imprime texto para el cliente.' } as Fallo }
  }
  const ctx = await leerContextoTextoCliente(supabase, cotizacionId)
  if (!ctx) return { fallo: { success: false, error: 'Cotización no encontrada' } as Fallo }
  if (!ctx.columnaPresente) return { fallo: { success: false, error: MENSAJE_SIN_COLUMNA } as Fallo }
  if (!isEditable((ctx.estado ?? '') as EstadoCotizacion)) {
    return {
      fallo: {
        success: false,
        error: 'Esta cotización ya no es un borrador: su texto no se cambia. Duplícala para escribir otro.',
      } as Fallo,
    }
  }
  // `documento_cliente` no está en los tipos generados hasta regenerar `database.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, workspaceId, staffId, ctx, motorHtml: plantilla.motorHtml }
}

function revalidar(ctx: ContextoTextoCliente) {
  if (ctx.negocioId) revalidatePath(`/negocios/${ctx.negocioId}/cotizacion/${ctx.cotizacionId}`)
}

/**
 * El panel del editor. `null` si la plantilla del workspace no usa texto para el cliente
 * o si la cotización no se puede leer: en los dos casos el editor no muestra nada.
 */
export async function getTextoCliente(cotizacionId: string): Promise<PanelTextoCliente | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null
  const plantilla = await plantillaDelWorkspace(supabase, workspaceId)
  if (!plantilla.texto) return null
  const ctx = await leerContextoTextoCliente(supabase, cotizacionId)
  if (!ctx) return null
  return panelDe(ctx, ctx.documento, ctx.terminos, plantilla.motorHtml)
}

/**
 * Redacta el texto con ONE y lo guarda como BORRADOR (sin `revisado_en`): el PDF no lo
 * imprime hasta que una persona lo guarde.
 *
 * Si ya hay un texto revisado, no lo pisa salvo que se pida explícitamente
 * (`reemplazarRevisado`). La comprobación va también en el UPDATE, no solo en la lectura:
 * si alguien guarda un texto revisado mientras el modelo redacta, el borrador no lo borra.
 */
export async function redactarDocumentoCliente(
  cotizacionId: string,
  opciones?: { reemplazarRevisado?: boolean } & OpcionesPorPasos,
): Promise<Exito | Fallo> {
  const r = await contextoParaEscribir(cotizacionId)
  if ('fallo' in r) return r.fallo as Fallo
  const { supabase, workspaceId, ctx, motorHtml } = r
  const reemplazar = opciones?.reemplazarRevisado === true
  const m = await marcaIncluyePorOne(supabase, cotizacionId, opciones)
  if ('fallo' in m) return m.fallo

  if (ctx.documento?.revisado_en && !reemplazar) {
    return {
      success: false,
      requiereConfirmacion: true,
      error: 'Ya hay un texto revisado. Redactar otro lo reemplaza por un borrador que habrá que volver a revisar.',
    }
  }
  if (!hayViajeQueRedactar(ctx.viaje)) {
    return {
      success: false,
      error: 'Todavía no hay viaje que describir: faltan el destino o las líneas (vuelos, hoteles, traslados).',
    }
  }

  const apiKey = getServerKey('gemini')
  if (!apiKey) return { success: false, error: 'La redacción con ONE no está configurada en el servidor.' }

  let redactado: { texto: TextoCliente; modelo: string }
  try {
    redactado = await redactarTextoCliente(ctx.viaje, apiKey, { ejemplos: ctx.configLinea.ejemplos })
  } catch (e) {
    console.error('[redactarDocumentoCliente]', e)
    return { success: false, error: 'ONE no pudo redactar el texto esta vez. Inténtalo de nuevo.' }
  }

  // El validador de estilo MARCA el borrador; no lo corrige. Quien revisa ve qué mirar.
  // Con «Incluye» armado por ONE, la lista del modelo no se guarda: la arma ONE al imprimir, y
  // un borrador nuevo no trae líneas propias.
  const documento: DocumentoCliente = {
    ...redactado.texto,
    ...(m.marca || ctx.documento?.incluye_origen === INCLUYE_POR_ONE ? { incluye: [], incluye_origen: INCLUYE_POR_ONE } : {}),
    // D5 · la forma por pasos guarda con qué servicios se escribió, para marcar el párrafo viejo.
    ...(m.marca ? { fuente_nombres: nombresDelViaje(ctx.viaje) } : {}),
    origen: 'ia',
    modelo: redactado.modelo,
    redactado_en: new Date().toISOString(),
    fuente_hash: ctx.huella,
    revisado_por: null,
    revisado_por_nombre: null,
    revisado_en: null,
    ...conAlertas(revisarEstilo(redactado.texto)),
  }

  let q = supabase
    .from('cotizaciones')
    // El anticipo comparte la columna: el borrador nuevo lo conserva (`anticipo.ts`).
    .update({ documento_cliente: conAnticipo(documento, ctx.anticipo) })
    .eq('id', cotizacionId)
    .eq('workspace_id', workspaceId)
  if (!reemplazar) q = q.is('documento_cliente->>revisado_en', null)
  const { data, error } = await q.select('id')
  if (error) {
    console.error('[redactarDocumentoCliente] update', error)
    return { success: false, error: 'No se pudo guardar el borrador.' }
  }
  if (!data || data.length === 0) {
    return {
      success: false,
      error: 'Alguien guardó un texto revisado mientras ONE redactaba. Recarga la página para verlo.',
    }
  }

  revalidar(ctx)
  return { success: true, panel: panelDe(ctx, documento, ctx.terminos, motorHtml) }
}

/**
 * Guarda el texto que una persona leyó y corrigió. Guardar ES revisar: desde aquí el PDF
 * lo imprime. La huella se toma de las líneas de AHORA, que son las que la persona tenía
 * delante al guardar.
 *
 * Un texto vaciado del todo borra la columna: sin texto, el documento vuelve a ser el de
 * siempre.
 *
 * `terminos`, si llega, se guarda en el MISMO update, en `terminos_condiciones`: un solo
 * botón para todo el bloque. Es la copia de ESTA cotización; si el texto base de la línea
 * cambia después, lo guardado aquí no cambia. Sin el parámetro, la columna no se toca.
 */
export async function guardarDocumentoCliente(
  cotizacionId: string,
  texto: TextoCliente,
  terminos?: string | null,
  /**
   * C6 · la forma por pasos: `texto.incluye` son solo las líneas PROPIAS de la asesora, y el
   * documento queda con la marca `incluye_origen = 'one'` (el PDF arma lo demás).
   */
  opciones?: OpcionesPorPasos,
): Promise<Exito | Fallo> {
  const r = await contextoParaEscribir(cotizacionId)
  if ('fallo' in r) return r.fallo as Fallo
  const { supabase, workspaceId, staffId, ctx, motorHtml } = r
  const m = await marcaIncluyePorOne(supabase, cotizacionId, opciones)
  if ('fallo' in m) return m.fallo

  const limpio = normalizarTexto(texto)
  let documento: DocumentoCliente | null = null

  if (!textoVacio(limpio)) {
    let nombre: string | null = null
    if (staffId) {
      const { data: st } = await supabase.from('staff').select('full_name').eq('id', staffId).maybeSingle()
      nombre = (st as { full_name?: string | null } | null)?.full_name?.trim() || null
    }
    const previo = ctx.documento
    const deIa = previo?.origen === 'ia'
    documento = {
      ...limpio,
      origen: deIa ? 'ia' : 'persona',
      modelo: deIa ? previo.modelo : null,
      redactado_en: deIa ? previo.redactado_en : null,
      fuente_hash: ctx.huella,
      revisado_por: staffId ?? null,
      revisado_por_nombre: nombre,
      revisado_en: new Date().toISOString(),
      // Lo que la persona decidió dejar, para que quede dicho; nunca se corrige solo.
      ...conAlertas(revisarEstilo(limpio)),
      ...(m.marca || ctx.documento?.incluye_origen === INCLUYE_POR_ONE ? { incluye_origen: INCLUYE_POR_ONE } : {}),
      // D5 · los servicios con que se revisó (la forma por pasos).
      ...(m.marca ? { fuente_nombres: nombresDelViaje(ctx.viaje) } : {}),
    }
  }

  // Un texto vaciado no se lleva el anticipo: la columna queda con él solo (`anticipo.ts`).
  const cambios: Record<string, unknown> = { documento_cliente: conAnticipo(documento, ctx.anticipo) }
  const conTerminos = terminos !== undefined
  const terminosLimpios = conTerminos ? normalizarTerminos(terminos) : ctx.terminos
  if (conTerminos) cambios.terminos_condiciones = terminosLimpios

  const { data, error } = await supabase
    .from('cotizaciones')
    .update(cambios)
    .eq('id', cotizacionId)
    .eq('workspace_id', workspaceId)
    .select('id')
  if (error) {
    console.error('[guardarDocumentoCliente] update', error)
    return { success: false, error: 'No se pudo guardar el texto.' }
  }
  if (!data || data.length === 0) return { success: false, error: 'No se pudo guardar el texto.' }

  revalidar(ctx)
  return { success: true, panel: panelDe(ctx, documento, terminosLimpios, motorHtml) }
}

/**
 * El anticipo para apartar (decisión de Mauricio del 2026-10-14, punto 3): un monto y una línea
 * que la asesora asigna a mano en esta cotización. `null` o monto vacío lo quita.
 *
 * Solo escribe `documento_cliente.anticipo`: el texto y su revisión quedan como estaban. No
 * registra ningún pago ni toca la etapa del negocio (riesgo N4 de Hana): es lo que el PDF dice.
 */
export async function guardarAnticipoPropuesta(cotizacionId: string, raw: unknown): Promise<Exito | Fallo> {
  const r = await contextoParaEscribir(cotizacionId)
  if ('fallo' in r) return r.fallo as Fallo
  const { supabase, workspaceId, ctx, motorHtml } = r
  if (!motorHtml) return { success: false, error: 'La propuesta de este workspace no imprime anticipo.' }
  const n = normalizarAnticipo(raw)
  if (!n.ok) return { success: false, error: n.error }

  // Se relee la columna entera: el anticipo se pone sobre lo que haya, sin tocar el texto.
  const { data: fila } = await supabase
    .from('cotizaciones')
    .select('documento_cliente')
    .eq('id', cotizacionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const actual = (fila as { documento_cliente?: unknown } | null)?.documento_cliente
  const base = actual && typeof actual === 'object' && !Array.isArray(actual) ? (actual as Record<string, unknown>) : null
  const nuevo = conAnticipo(base, n.anticipo)
  const { data, error } = await supabase
    .from('cotizaciones')
    .update({ documento_cliente: nuevo && Object.keys(nuevo).length > 0 ? nuevo : null })
    .eq('id', cotizacionId)
    .eq('workspace_id', workspaceId)
    .select('id')
  if (error) {
    console.error('[guardarAnticipoPropuesta] update', error)
    return { success: false, error: 'No se pudo guardar el anticipo.' }
  }
  if (!data || data.length === 0) return { success: false, error: 'No se pudo guardar el anticipo.' }

  revalidar(ctx)
  return { success: true, panel: panelDe(ctx, ctx.documento, ctx.terminos, motorHtml, n.anticipo) }
}

/**
 * H4 (verificación D, D5) · «Actualizar con ONE» de UN párrafo: ONE redacta con el viaje de ahora y
 * devuelve SOLO ese párrafo (el titular, la presentación o «Antes de viajar»). No guarda nada: el
 * panel lo pone en el formulario y la asesora lo lee y guarda, como todo (guardar es revisar).
 *
 * Solo la forma por pasos (`exigirPorPasos`).
 */
export async function actualizarParrafoConOne(
  cotizacionId: string,
  zona: ZonaDeParrafo,
): Promise<{ success: true; zona: ZonaDeParrafo; texto: string | string[] } | Fallo> {
  if (zona !== 'titular' && zona !== 'intro' && zona !== 'antes') return { success: false, error: 'Ese párrafo no se redacta con ONE.' }
  const r = await contextoParaEscribir(cotizacionId)
  if ('fallo' in r) return r.fallo as Fallo
  const guard = await exigirPorPasos(r.supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  if (!hayViajeQueRedactar(r.ctx.viaje)) {
    return { success: false, error: 'Todavía no hay viaje que describir: faltan el destino o las líneas (vuelos, hoteles, traslados).' }
  }
  const apiKey = getServerKey('gemini')
  if (!apiKey) return { success: false, error: 'La redacción con ONE no está configurada en el servidor.' }
  try {
    const { texto } = await redactarTextoCliente(r.ctx.viaje, apiKey, { ejemplos: r.ctx.configLinea.ejemplos })
    const nuevo = zona === 'titular' ? (texto.titular ?? '') : zona === 'intro' ? (texto.intro ?? '') : texto.antes_de_viajar
    return { success: true, zona, texto: nuevo }
  } catch (e) {
    console.error('[actualizarParrafoConOne]', e)
    return { success: false, error: 'ONE no pudo redactar ese párrafo esta vez. Inténtalo de nuevo.' }
  }
}
