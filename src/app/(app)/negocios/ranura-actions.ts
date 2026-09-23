'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getServerKey } from '@/lib/server-keys'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { detectarTipoDeCaptura } from '@/lib/ai/detectar-tipo-captura'
import { normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import {
  bloquesPorRanura,
  formaDesdeGrupo,
  grupoDeRanura,
  nombreAutomaticoDeRanura,
  nombreDeOpcion,
  ranurasDelTipo,
  esTipoRanura,
  siguienteNumeroDeOpcion,
  siguienteNumeroDeTipo,
  type TipoRanura,
} from '@/lib/cotizaciones/ranuras-cotizacion'
import { asignarRanura, crearRanura, ranuraDelGrupo } from '@/lib/cotizaciones/ranuras-datos'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { lugarDeOpcion } from '@/lib/cotizaciones/opcion-viaje'
import { etiquetaDeRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import { SIN_OPCIONES } from '@/lib/cotizaciones/ubicador-capturas'
import { aMayusculas } from '@/lib/negocios/mayusculas'

/**
 * La ranura desde la pantalla: crearla con su nombre, agregarle una opción hermana y
 * averiguar de qué es un pantallazo (Parte B y flujo de Noor, brief de captura del
 * 2026-09-23). Solo lo usa el flujo de viaje (`lineasPorTipo`): Termotech, Arca y WMC no
 * tienen un solo botón que llegue aquí.
 *
 * ## Lo que se protege
 *
 * Toda acción relee la cotización y exige que siga en borrador: una server action exportada
 * es un endpoint alcanzable aunque ningún botón la invoque, y una opción nueva en una
 * cotización ya enviada le cambiaría las tarifas a un documento que el cliente tiene.
 *
 * ⚠️ Nada de lo que tiene que ver con la FILA de la ranura puede tumbar la acción: si la
 * tabla no existe todavía, la opción se crea igual con su `grupo`, que es lo que decide el
 * total (`ranuras-datos.ts`).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

interface Contexto {
  supabase: Supabase
  workspaceId: string
  cotizacion: { id: string; negocio_id: string | null; oportunidad_id: string | null }
  items: Record<string, unknown>[]
}

async function contexto(cotizacionId: string): Promise<Contexto | { error: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  const { data: cot } = await (supabase as Supabase)
    .from('cotizaciones')
    .select('id, estado, negocio_id, oportunidad_id')
    .eq('id', cotizacionId)
    .maybeSingle()
  if (!cot) return { error: 'Cotización no encontrada' }
  if (!isEditable((cot.estado ?? 'borrador') as EstadoCotizacion)) {
    return { error: 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.' }
  }
  // `select('*')`: `ranura_id` la agrega `20260923233000` y nombrarla daría un 400 sin ella.
  const { data: filas, error: errItems } = await (supabase as Supabase)
    .from('items')
    .select('*')
    .eq('cotizacion_id', cotizacionId)
    .order('orden')
  if (errItems) return { error: errItems.message as string }
  return {
    supabase,
    workspaceId,
    cotizacion: { id: cot.id, negocio_id: cot.negocio_id ?? null, oportunidad_id: cot.oportunidad_id ?? null },
    items: (filas ?? []) as Record<string, unknown>[],
  }
}

function revalidar(c: Contexto['cotizacion']) {
  if (c.negocio_id) revalidatePath(`/negocios/${c.negocio_id}`)
  if (c.oportunidad_id) revalidatePath(`/pipeline/${c.oportunidad_id}`)
}

/**
 * Inserta una opción vacía de una ranura: sin costo, sin margen propio, hermana de las demás.
 *
 * ⚠️ `margen_porcentaje: null`, NUNCA 0 (`null` = usa el de la cotización; 0 = va a costo).
 * ⚠️ `opcion_de: null`: las opciones son hermanas. Con un titular, borrar la primera opción
 * se llevaba a las demás por el `on delete cascade`.
 */
async function insertarOpcion(
  c: Contexto,
  args: { grupo: string; nombre: string; unidad: string | null; cantidad: number },
): Promise<{ id: string } | { error: string }> {
  const orden = c.items.reduce((m, i) => Math.max(m, Number(i.orden) || 0), 0) + 1
  const { data, error } = await c.supabase
    .from('items')
    .insert({
      cotizacion_id: c.cotizacion.id,
      nombre: aMayusculas(args.nombre),
      grupo: args.grupo,
      opcion_de: null,
      unidad: args.unidad,
      cantidad: args.cantidad,
      subtotal: 0,
      orden,
      margen_porcentaje: null,
      precio_venta: 0,
      precio_manual: false,
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'No se pudo crear la opción' }
  return { id: (data as { id: string }).id }
}

/** Lo que la captura dijo del lugar, para nombrar la ranura. Todo opcional. */
export interface PistasDeLugar {
  lugar?: string | null
  origen?: string | null
  destino?: string | null
}

/**
 * Crea una ranura nueva con su primera opción («Hotel en Cancún» → «Opción 1»).
 *
 * El nombre se arma solo: el tipo y el lugar que leyó la captura, o el destino del negocio si
 * no leyó ninguno (`nombreAutomaticoDeRanura`). Es editable después, en el encabezado del
 * bloque o de la columna de la tabla. Si ya hay una ranura del tipo, la nueva es la segunda
 * («Hotel 2 en Cancún») y SUMA aparte: dos hoteles de un mismo viaje.
 */
export async function crearRanuraConOpcion(
  cotizacionId: string,
  tipo: TipoRanura,
  pistas: PistasDeLugar = {},
): Promise<{ success: true; itemId: string; grupo: string; etiqueta: string | null } | { success: false; error: string }> {
  if (!esTipoRanura(tipo)) return { success: false, error: 'Tipo de componente desconocido' }
  const c = await contexto(cotizacionId)
  if ('error' in c) return { success: false, error: c.error }

  const { viaje } = await leerViajeDelNegocio(c.supabase, c.cotizacion.negocio_id)
  const grupos = c.items.map(i => (i.grupo ?? null) as string | null)
  const numero = siguienteNumeroDeTipo(tipo, grupos)
  const nombresEnUso = bloquesPorRanura(c.items as { id: string; grupo?: string | null }[])
    .map(b => b.etiqueta)
    .filter((e): e is string => e !== null)
  const nombre = nombreAutomaticoDeRanura({
    tipo,
    lugar: pistas.lugar ?? viaje.destino,
    origen: pistas.origen ?? null,
    destino: pistas.destino ?? (tipo === 'vuelo' ? viaje.destino : null),
    numero,
    nombresEnUso,
  })
  // La forma que se guarda sale del grupo ya escrito: si el nombre traía «:», el grupo lo
  // cambia por un guion, y la fila tiene que decir exactamente lo mismo que el grupo.
  const grupo = grupoDeRanura({ tipo, numero, nombre })
  const forma = formaDesdeGrupo(grupo) ?? { tipo, numero, nombre }

  const creada = await insertarOpcion(c, { grupo, nombre: nombreDeOpcion(1), unidad: null, cantidad: 1 })
  if ('error' in creada) return { success: false, error: creada.error }

  const ranuraId = await crearRanura(c.supabase, { workspaceId: c.workspaceId, cotizacionId, forma })
  if (ranuraId) await asignarRanura(c.supabase, creada.id, ranuraId)

  revalidar(c.cotizacion)
  // El nombre visible de la ranura, para que la bandeja diga «Vuelo San Andrés–Providencia» y
  // no «Vuelo» mientras la lista de la pantalla todavía no la trae.
  return { success: true, itemId: creada.id, grupo, etiqueta: etiquetaDeRanura(grupo) }
}

/**
 * Agrega una opción HERMANA a una ranura que ya existe («Opción 3»).
 *
 * Nace vacía de costo y con un nombre de relleno que la lectura del pantallazo reemplaza por
 * el hotel o la aerolínea. Nunca copia el nombre de la vecina: con «RIU… (alternativa)» la
 * pantalla mostraba un hotel equivocado hasta que alguien pegara la captura. La unidad y la
 * cantidad sí salen de las opciones que ya tiene: son de la ranura, no del proveedor.
 */
export async function agregarOpcionARanura(
  cotizacionId: string,
  grupo: string,
): Promise<{ success: true; itemId: string; grupo: string } | { success: false; error: string; codigo?: string }> {
  const c = await contexto(cotizacionId)
  if ('error' in c) return { success: false, error: c.error }

  const clave = normalizarGrupo(grupo)
  if (!clave || !formaDesdeGrupo(clave)) return { success: false, error: 'Esa no es una ranura de esta cotización' }
  const opciones = c.items.filter(i => normalizarGrupo(i.grupo as string | null) === clave && i.es_ajuste !== true)
  // Con código: la bandeja lo reconoce y abre una ranura nueva en vez de mostrar el error.
  if (opciones.length === 0) return { success: false, error: 'Esa ranura ya no tiene opciones: créala de nuevo', codigo: SIN_OPCIONES }

  const n = siguienteNumeroDeOpcion(opciones.map(o => (o.nombre ?? null) as string | null))
  const modelo = opciones[0]
  const creada = await insertarOpcion(c, {
    grupo: clave,
    nombre: nombreDeOpcion(n),
    unidad: (modelo.unidad ?? null) as string | null,
    cantidad: Number(modelo.cantidad) || 1,
  })
  if ('error' in creada) return { success: false, error: creada.error }

  const ranuraId = await ranuraDelGrupo(c.supabase, {
    workspaceId: c.workspaceId,
    cotizacionId,
    grupo: clave,
    excluirItemId: creada.id,
  })
  if (ranuraId) await asignarRanura(c.supabase, creada.id, ranuraId)

  revalidar(c.cotizacion)
  return { success: true, itemId: creada.id, grupo: clave }
}

export interface RanuraConLugar {
  grupo: string
  etiqueta: string
  opciones: number
  lugar: string | null
  origen: string | null
  destino: string | null
}

/** Las ranuras del tipo, cada una con el primer lugar o ruta que alguna de sus opciones leyó. */
function ranurasConLugar(items: Record<string, unknown>[], tipo: TipoRanura): RanuraConLugar[] {
  const lineas = items as { id: string; grupo?: string | null; es_ajuste?: boolean | null; nombre?: string | null; tarifa_pax?: unknown; tramos?: unknown }[]
  return ranurasDelTipo(lineas, tipo).map(r => {
    const clave = normalizarGrupo(r.grupo)
    const lugares = lineas
      .filter(i => normalizarGrupo(i.grupo ?? null) === clave)
      .map(i => lugarDeOpcion({ nombre: i.nombre ?? null, grupo: i.grupo ?? null, tarifa_pax: i.tarifa_pax, tramos: i.tramos }))
    return {
      ...r,
      lugar: lugares.find(l => l.lugar)?.lugar ?? null,
      origen: lugares.find(l => l.origen)?.origen ?? null,
      destino: lugares.find(l => l.destino)?.destino ?? null,
    }
  })
}

export type ResultadoDeteccion =
  | {
      ok: true
      tipo: TipoRanura
      lugar: string | null
      origen: string | null
      destino: string | null
      /**
       * Las ranuras de ese tipo que ya tiene la cotización: dónde podría ir como otra opción.
       * Con el lugar o la ruta que leyeron sus opciones (P7): la bandeja agrupa con eso.
       */
      ranuras: RanuraConLugar[]
    }
  | { ok: false; codigo: 'SIN_TIPO' | 'CONTEXTO' | 'MODULO' | 'CONFIG' | 'IMAGEN' | 'LECTURA'; mensaje: string }

/**
 * ¿De qué es este pantallazo, y en qué ranura podría ir? (pasos 1 y 2 del flujo de Noor).
 *
 * No crea nada: la pantalla pregunta «¿Otra opción de Hotel en Cancún?» con esta respuesta, y
 * la opción se crea después con `agregarOpcionARanura` o `crearRanuraConOpcion`. Si la captura
 * no es reconocible, se dice, y la pantalla deja elegir el tipo a mano.
 */
export async function detectarCaptura(cotizacionId: string, dataUrl: string): Promise<ResultadoDeteccion> {
  // Lee con la llave de Gemini de MeTRIK: la puerta de Clarity va antes, igual que la lectura.
  if (!(await exigirModulo(REQUISITO.clarity)).ok) {
    return { ok: false, codigo: 'MODULO', mensaje: MENSAJE_MODULO_NO_ACTIVO }
  }
  const c = await contexto(cotizacionId)
  if ('error' in c) return { ok: false, codigo: 'CONTEXTO', mensaje: c.error }

  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl)
  if (!m) return { ok: false, codigo: 'IMAGEN', mensaje: 'La imagen no llegó en un formato legible. Vuelve a pegarla.' }
  const apiKey = getServerKey('gemini')
  if (!apiKey) return { ok: false, codigo: 'CONFIG', mensaje: 'Falta configurar la lectura de capturas. Avísale a MeTRIK.' }

  const r = await detectarTipoDeCaptura(Buffer.from(m[2], 'base64'), m[1], apiKey)
  if (!r.data) return { ok: false, codigo: 'LECTURA', mensaje: 'No se pudo mirar el pantallazo. Vuelve a intentarlo.' }
  if (!r.data.tipo) {
    return {
      ok: false,
      codigo: 'SIN_TIPO',
      mensaje: 'No se reconoce si es un vuelo, un hotel, una actividad o un traslado. Elige qué es, o pega la pantalla del detalle con su precio.',
    }
  }
  return {
    ok: true,
    tipo: r.data.tipo,
    lugar: r.data.lugar,
    origen: r.data.origen,
    destino: r.data.destino,
    ranuras: ranurasConLugar(c.items, r.data.tipo),
  }
}
