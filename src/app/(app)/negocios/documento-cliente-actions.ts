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
import { PLANTILLA_POR_DEFECTO, plantillaUsaTextoDelCliente } from '@/lib/pdf/plantillas-cotizacion'
import { getServerKey } from '@/lib/server-keys'

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
): PanelTextoCliente {
  return {
    columnaPresente: ctx.columnaPresente,
    documento,
    desactualizado: textoDesactualizado(documento, ctx.huella),
    hayViaje: hayViajeQueRedactar(ctx.viaje),
    editable: isEditable((ctx.estado ?? '') as EstadoCotizacion),
    terminos,
    terminosBase: ctx.configLinea.terminosBase,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function usaTextoDelCliente(supabase: any, workspaceId: string): Promise<boolean> {
  const { data } = await supabase
    .from('workspaces')
    .select('cotizacion_template_slug')
    .eq('id', workspaceId)
    .maybeSingle()
  const slug = (data as { cotizacion_template_slug?: string | null } | null)?.cotizacion_template_slug
  return plantillaUsaTextoDelCliente(slug ?? PLANTILLA_POR_DEFECTO)
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
  if (!(await usaTextoDelCliente(supabase, workspaceId))) {
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
  return { supabase: supabase as any, workspaceId, staffId, ctx }
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
  if (!(await usaTextoDelCliente(supabase, workspaceId))) return null
  const ctx = await leerContextoTextoCliente(supabase, cotizacionId)
  if (!ctx) return null
  return panelDe(ctx, ctx.documento)
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
  opciones?: { reemplazarRevisado?: boolean },
): Promise<Exito | Fallo> {
  const r = await contextoParaEscribir(cotizacionId)
  if ('fallo' in r) return r.fallo as Fallo
  const { supabase, workspaceId, ctx } = r
  const reemplazar = opciones?.reemplazarRevisado === true

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
  const documento: DocumentoCliente = {
    ...redactado.texto,
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
    .update({ documento_cliente: documento })
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
  return { success: true, panel: panelDe(ctx, documento) }
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
): Promise<Exito | Fallo> {
  const r = await contextoParaEscribir(cotizacionId)
  if ('fallo' in r) return r.fallo as Fallo
  const { supabase, workspaceId, staffId, ctx } = r

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
    }
  }

  const cambios: Record<string, unknown> = { documento_cliente: documento }
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
  return { success: true, panel: panelDe(ctx, documento, terminosLimpios) }
}
