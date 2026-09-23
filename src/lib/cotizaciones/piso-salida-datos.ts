/**
 * El piso en la salida, leído de la base: la medición (`piso-salida.ts`) más la
 * excepción del dueño.
 *
 * ## La excepción
 *
 * Vive en `cotizacion_excepciones_margen`, una tabla SERVER-ONLY: sin grant a
 * `authenticated`, se escribe y se lee solo con el cliente de servicio, después de
 * comprobar el rol en el servidor. Con un grant, cualquier operadora podría fabricarse
 * una autorización por PostgREST sin pasar por la acción — y lo mismo si viviera en una
 * columna de `cotizaciones`, que la operadora edita todo el día.
 *
 * Una excepción vale mientras la huella de hoy sea la que se autorizó. Cuando deja de
 * coincidir se marca perdida (con la causa) y se anota en `activity_log`. La pérdida se
 * detecta en dos momentos: en `recalcularTotales` y en las acciones de las tarifas, que
 * corren después de cada cambio, y en cualquier salida (PDF, Enviar, Aprobar, gate) como
 * red. Si la tabla no existe todavía (SQL pendiente), no hay excepciones: todo lo que
 * esté bajo el piso sale como borrador, que es el lado seguro.
 */

import { motivoFaltaCosto } from './falta-costo'
import { createHash } from 'node:crypto'

import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { contextoDeCotizacion, leerItinerarios } from './itinerarios-datos'
import { causaDePerdida, medirSalida, mensajeDeSalida, pctTexto, type DetalleDeSalida, type MedicionDeSalida } from './piso-salida'
import { motivoSinRecomendada } from './tarifas'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export const TABLA_EXCEPCIONES = 'cotizacion_excepciones_margen'

export interface ExcepcionDeMargen {
  id: string
  autorizadaPorStaffId: string | null
  autorizadaPorNombre: string | null
  autorizadaAt: string
  motivo: string
  pisoPct: number
  huella: string
  detalle: DetalleDeSalida
  perdidaAt: string | null
  perdidaCausa: string | null
}

export interface SalidaDeCotizacion {
  /** La línea exige el piso en la salida (R6). `false` = nada cambia respecto a antes. */
  aplica: boolean
  medicion: MedicionDeSalida | null
  huella: string | null
  bajoPiso: boolean
  /** La excepción VIGENTE: existe y su huella es la de hoy. */
  excepcion: ExcepcionDeMargen | null
  /** La última excepción, si se perdió (ahora o antes), con la causa. */
  perdida: { excepcion: ExcepcionDeMargen; causa: string } | null
  /** Bajo el piso y sin excepción vigente: PDF con marca de agua, Enviar y Aprobar rechazan. */
  bloquea: boolean
  /** Por qué bloquea, para la operadora. Vacío cuando no bloquea. */
  mensaje: string
  /** Nombre de pila de quien puede autorizar, si el workspace tiene exactamente un dueño. */
  dueno: string | null
  /** `false` con el SQL pendiente: no se puede autorizar todavía. */
  excepcionesDisponibles: boolean
  /**
   * Una línea sin costo NI precio entra al total que sale (`falta-costo.ts`, decisión de
   * Mauricio del 2026-09-23): no se envía y el PDF sale como borrador incompleto. La firma
   * del dueño NO la levanta: autoriza un margen, no un precio al que le falta un servicio.
   * `null` = no falta ningún costo en lo que sale.
   */
  faltaCosto: string | null
}

const SIN_REGLA: SalidaDeCotizacion = {
  aplica: false,
  medicion: null,
  huella: null,
  bajoPiso: false,
  excepcion: null,
  perdida: null,
  bloquea: false,
  mensaje: '',
  dueno: null,
  excepcionesDisponibles: true,
  faltaCosto: null,
}

export function huellaDe(medicion: MedicionDeSalida): string {
  return createHash('sha256').update(medicion.firma).digest('hex')
}

/**
 * ¿Esta cotización puede salir? La pregunta única que hacen el PDF, los dos «Enviar»,
 * «Aprobar» y el gate de etapa.
 *
 * @param args.servicio Cómo obtener el cliente de servicio (`createServiceClient`). Se
 *   pide solo si la línea exige el piso: la tabla de excepciones no concede nada a
 *   `authenticated`, y el `workspace_id` que la acota sale de la sesión, nunca del
 *   navegador. Una cotización de otra línea no toca ni la tabla ni la llave de servicio.
 * @param args.registrarPerdida Si la excepción dejó de coincidir, marcarla perdida y
 *   anotarlo. `false` para las lecturas de pantalla, que no escriben.
 * @returns `null` si la cotización no se puede leer.
 */
export async function evaluarSalida(
  supabase: Supabase,
  args: {
    servicio: () => Supabase
    workspaceId: string
    cotizacionId: string
    staffId?: string | null
    registrarPerdida?: boolean
  },
): Promise<SalidaDeCotizacion | null> {
  const ctx = await contextoDeCotizacion(supabase, args.cotizacionId)
  if (!ctx) return null
  if (!ctx.pisoEnLaSalida) return SIN_REGLA

  const servicio = args.servicio()
  const filas = await leerItinerarios(supabase, args.cotizacionId)
  const medicion = medirSalida(ctx, filas)
  const huella = huellaDe(medicion)

  const { ultima, disponible } = await leerUltimaExcepcion(servicio, args.workspaceId, args.cotizacionId)

  let excepcion: ExcepcionDeMargen | null = null
  let perdida: SalidaDeCotizacion['perdida'] = null
  if (ultima && ultima.perdidaAt === null) {
    if (ultima.huella === huella) {
      excepcion = ultima
    } else {
      const causa = causaDePerdida(ultima.detalle, medicion.detalle)
      perdida = { excepcion: ultima, causa }
      if (args.registrarPerdida) {
        await registrarPerdida(supabase, servicio, {
          workspaceId: args.workspaceId,
          negocioId: ctx.negocioId,
          staffId: args.staffId ?? null,
          excepcion: ultima,
          causa,
          codigo: await codigoDe(supabase, args.cotizacionId),
        })
      }
    }
  } else if (ultima) {
    perdida = { excepcion: ultima, causa: ultima.perdidaCausa ?? 'Cambió un precio, un costo o un margen.' }
  }

  const bajoPiso = medicion.bajoPiso.length > 0
  const bloquea = bajoPiso && excepcion === null
  const dueno = bajoPiso ? await nombreDelDueno(servicio, args.workspaceId) : null

  return {
    aplica: true,
    medicion,
    huella,
    bajoPiso,
    excepcion,
    perdida,
    bloquea,
    mensaje: bloquea ? mensajeDeSalida(medicion.bajoPiso, medicion.pisoPct, dueno) : '',
    dueno,
    excepcionesDisponibles: disponible,
    faltaCosto: motivoFaltaCosto(medicion.conteo.faltantes),
  }
}

/**
 * La red de `recalcularTotales` y de las acciones de tarifas: si la cotización tiene una
 * excepción vigente y lo que acaba de cambiar la invalida, se marca perdida AHORA, con
 * quien hizo el cambio como autor. Sin excepción vigente es UNA consulta y sale.
 *
 * Nunca lanza: corre después de un cambio que ya se guardó.
 */
export async function revisarExcepcionTrasCambio(
  supabase: Supabase,
  args: { servicio: () => Supabase; workspaceId: string; cotizacionId: string; staffId?: string | null },
): Promise<void> {
  try {
    const { ultima } = await leerUltimaExcepcion(args.servicio(), args.workspaceId, args.cotizacionId)
    if (!ultima || ultima.perdidaAt !== null) return
    await evaluarSalida(supabase, { ...args, registrarPerdida: true })
  } catch (e) {
    console.error('[piso-salida] no se pudo revisar la excepción tras el cambio:', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Escribe la pérdida. El `update` va condicionado a `perdida_at is null`: si dos
 * pestañas la detectan a la vez, solo una la anota.
 */
async function registrarPerdida(
  supabase: Supabase,
  servicio: Supabase,
  args: {
    workspaceId: string
    negocioId: string | null
    staffId: string | null
    excepcion: ExcepcionDeMargen
    causa: string
    codigo: string
  },
): Promise<void> {
  const { data, error } = await servicio
    .from(TABLA_EXCEPCIONES)
    .update({ perdida_at: new Date().toISOString(), perdida_causa: args.causa })
    .eq('id', args.excepcion.id)
    .eq('workspace_id', args.workspaceId)
    .is('perdida_at', null)
    .select('id')
  if (error) {
    console.error('[piso-salida] no se pudo marcar la excepción como perdida:', error.message)
    return
  }
  if (!Array.isArray(data) || data.length === 0) return
  if (!args.negocioId) return

  const quien = args.excepcion.autorizadaPorNombre ?? 'el dueño'
  await registrarActividad(supabase, {
    workspace_id: args.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: args.negocioId,
    tipo: 'cambio_sistema',
    autor_id: args.staffId,
    campo_modificado: 'excepcion_margen',
    valor_anterior: 'autorizada',
    valor_nuevo: 'perdida',
    contenido: recortarParaLog(
      `Se perdió la autorización de ${quien} para enviar ${args.codigo} bajo el margen mínimo ` +
      `(${pctTexto(args.excepcion.pisoPct)}). Causa: ${args.causa} Hay que volver a pedirla.`,
    ),
  }, 'piso-salida.registrarPerdida')
}

/**
 * `activity_log.contenido` tiene `CHECK (char_length(contenido) <= 280)`: un texto más
 * largo tumba el INSERT entero y el evento no queda. Se recorta con puntos suspensivos;
 * el detalle completo vive en `cotizacion_excepciones_margen`.
 */
export function recortarParaLog(texto: string, max = 280): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`
}

/**
 * Para las acciones que mandan algo al cliente («Enviar», «Aprobar», y el `estado` por el
 * endpoint genérico): `null` si puede salir, o el motivo en lenguaje de operadora. Si la
 * excepción acaba de perderse, lo anota.
 *
 * Dos reglas, en este orden:
 *  1. **La Recomendada manda el documento** (2026-09-22): con tarifas, la Recomendada
 *     tiene que existir, ser una sola e ir en la propuesta (`motivoSinRecomendada`). Va
 *     primero porque sin ella el total del documento es un supuesto y medir su margen no
 *     dice nada. Aplica a TODA línea con tarifas, no solo a la que exige el piso: la
 *     leyenda «el total corresponde a la opción recomendada» la imprime cualquiera. Sin
 *     tarifas (`[]`) es una consulta y no dice nada (R6).
 *  2. Ninguna línea sin costo en el total que sale (`falta-costo.ts`), solo donde la línea
 *     exige el piso en la salida.
 *  3. El margen mínimo en la salida (`evaluarSalida`), solo donde la línea lo exige.
 */
export async function motivoParaNoSalir(
  supabase: Supabase,
  args: { servicio: () => Supabase; workspaceId: string; cotizacionId: string; staffId?: string | null },
): Promise<string | null> {
  const sinRecomendada = motivoSinRecomendada((await leerItinerarios(supabase, args.cotizacionId)) ?? [])
  if (sinRecomendada) return sinRecomendada

  const salida = await evaluarSalida(supabase, { ...args, registrarPerdida: true })
  if (!salida) return null
  // Antes que el margen: con un servicio en cero, el margen tampoco dice nada.
  if (salida.faltaCosto) return salida.faltaCosto
  return salida.bloquea ? salida.mensaje : null
}

/**
 * La última excepción de la cotización, vigente o perdida.
 *
 * `disponible: false` cuando la tabla no existe (SQL pendiente). Cualquier otro error
 * también cae a «sin excepción», que es el lado seguro, pero se reporta: silenciar un
 * 42501 dejaría a Edgar autorizando y viendo la marca de agua sin saber por qué.
 */
export async function leerUltimaExcepcion(
  servicio: Supabase,
  workspaceId: string,
  cotizacionId: string,
): Promise<{ ultima: ExcepcionDeMargen | null; disponible: boolean }> {
  const { data, error } = await servicio
    .from(TABLA_EXCEPCIONES)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('cotizacion_id', cotizacionId)
    .order('autorizada_at', { ascending: false })
    .limit(1)
  if (error) {
    if (faltaLaTabla(error)) return { ultima: null, disponible: false }
    console.error('[piso-salida] no se pudo leer la excepción de margen:', error.message)
    return { ultima: null, disponible: true }
  }
  const fila = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null | undefined
  if (!fila) return { ultima: null, disponible: true }

  let nombre: string | null = null
  const staffId = (fila.autorizada_por_staff_id ?? null) as string | null
  if (staffId) {
    const { data: staff } = await servicio.from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombre = primerNombre((staff as { full_name?: string | null } | null)?.full_name ?? null)
  }

  return {
    disponible: true,
    ultima: {
      id: fila.id as string,
      autorizadaPorStaffId: staffId,
      autorizadaPorNombre: nombre,
      autorizadaAt: fila.autorizada_at as string,
      motivo: (fila.motivo ?? '') as string,
      pisoPct: Number(fila.piso_pct),
      huella: fila.huella as string,
      detalle: fila.detalle as DetalleDeSalida,
      perdidaAt: (fila.perdida_at ?? null) as string | null,
      perdidaCausa: (fila.perdida_causa ?? null) as string | null,
    },
  }
}

/** 42P01 de Postgres o PGRST205 de PostgREST: la tabla todavía no está. */
export function faltaLaTabla(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return (error.message ?? '').includes(TABLA_EXCEPCIONES)
    && /does not exist|could not find/i.test(error.message ?? '')
}

/**
 * El nombre de pila del dueño, para el mensaje («Pídele a Edgar…»). Solo si hay
 * EXACTAMENTE uno: con dos, nombrar a uno sería decirle a la operadora a quién no
 * pedírselo. Un platform admin de MeTRIK que entró al workspace no cuenta.
 */
export async function nombreDelDueno(servicio: Supabase, workspaceId: string): Promise<string | null> {
  const { data, error } = await servicio
    .from('profiles')
    .select('full_name, platform_admin')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
  if (error || !Array.isArray(data)) return null
  const duenos = (data as { full_name: string | null; platform_admin: boolean | null }[])
    .filter(p => p.platform_admin !== true)
  return duenos.length === 1 ? primerNombre(duenos[0].full_name) : null
}

function primerNombre(completo: string | null): string | null {
  const limpio = (completo ?? '').trim()
  return limpio === '' ? null : limpio.split(/\s+/)[0]
}

async function codigoDe(supabase: Supabase, cotizacionId: string): Promise<string> {
  const { data } = await supabase
    .from('cotizaciones')
    .select('codigo, consecutivo')
    .eq('id', cotizacionId)
    .maybeSingle()
  const fila = data as { codigo?: string | null; consecutivo?: string | null } | null
  return fila?.codigo || fila?.consecutivo || 'la cotización'
}
