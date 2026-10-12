'use server'

/**
 * Server action de «Pegar conversación» en el bloque de la solicitud. Ver `pegar-conversacion.ts`.
 *
 * Permiso: el mismo de editar el bloque (`guardEditarBloque`), revalidado aquí; el botón en pantalla es solo UX.
 * El modelo es el del bot (`GEMINI_ENTENDIMIENTO_MODEL`, mismo pedido en `_shared/lectura-gemini.ts`).
 *
 * Datos personales: el chat NO se guarda. Va al modelo (como hoy los mensajes del bot) y de él quedan solo las frases
 * cortas que sostienen cada valor (la marca de sugerido o de conflicto, para que la comercial vea de dónde salió) y, en
 * la actividad del negocio, quién lo pegó (el autor), cuándo (la fecha de la fila) y una huella SHA-256 del texto. Un
 * chat trae datos de terceros y de menores que nadie autorizó a guardar en ONE; con la huella se puede reconocer el
 * mismo texto si alguien lo vuelve a presentar, sin conservarlo.
 */

import { createHash } from 'node:crypto'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { resolverDestinoCompartido } from '@/lib/negocios/casilla-compartida'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { getServerKey } from '@/lib/server-keys'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { declaraNiveles } from '@/lib/negocios/niveles-solicitud'
import {
  cargarChatEnBloque, mensajesDelChat, normalizarChat, textoActividadChat, viajeParaModelo,
  MAX_ENTRADA_CARACTERES, type ResumenChat,
} from '@/lib/negocios/pegar-conversacion'
import { esquemaCarga, instruccionesCarga } from '../../../supabase/functions/_shared/agente/bandeja/extraccion.ts'
import { mensajesDeTextos } from '../../../supabase/functions/_shared/agente/bandeja/carga.ts'
import { textoParaModelo } from '../../../supabase/functions/_shared/wa-guardianes.ts'
import { leerConGemini, MODELO_ENTENDIMIENTO_POR_DEFECTO } from '../../../supabase/functions/_shared/lectura-gemini.ts'
import type { CampoEntendible } from '../../../supabase/functions/_shared/wa-entendimiento-reglas.ts'
import { aplanarBloques } from '@/lib/negocios/niveles-solicitud'

export type ResultadoPegarConversacion =
  | { error: string }
  | { error: null; resumen: ResumenChat; valores: Record<string, unknown> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(c: unknown): any { return c }

type Fila = Record<string, unknown>
const relUno = (v: unknown): Fila | null => (Array.isArray(v) ? (v[0] as Fila | undefined) ?? null : (v as Fila | null) ?? null)

export async function pegarConversacion(negocioBloqueId: string, texto: string): Promise<ResultadoPegarConversacion> {
  if (typeof negocioBloqueId !== 'string' || typeof texto !== 'string') return { error: 'Pedido inválido' }
  if (texto.length > MAX_ENTRADA_CARACTERES) return { error: 'El chat es demasiado largo. Pega solo la parte de este viaje.' }
  const limpio = normalizarChat(texto)
  const { mensajes, total, recortado } = mensajesDelChat(limpio)
  if (!mensajes.length) return { error: 'No hay texto que leer.' }

  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso' }

  const { data: nb, error: errNb } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id, bloque_configs(config_extra), negocios(codigo, nombre, contactos(nombre))')
    .eq('id', negocioBloqueId)
    .maybeSingle()
  if (errNb || !nb) return { error: 'No se pudo leer el bloque' }
  const fields = ((relUno(nb.bloque_configs)?.config_extra as Fila | null)?.fields ?? []) as CampoEntendible[]
  if (!Array.isArray(fields) || !declaraNiveles(fields)) return { error: 'Este bloque no recibe conversaciones' }
  const neg = relUno(nb.negocios)
  const viaje = viajeParaModelo({
    codigo: (neg?.codigo as string | null) ?? null,
    nombre: (neg?.nombre as string | null) ?? null,
    cliente: (relUno(neg?.contactos)?.nombre as string | null) ?? null,
  })

  const destinoId = await resolverDestinoCompartido(supabase, negocioBloqueId)
  const leer = async () => {
    const { data: fila } = await db(supabase).from('negocio_bloques').select('data, updated_at').eq('id', destinoId).maybeSingle()
    return fila ? { data: ((fila.data ?? {}) as Fila), marca: (fila.updated_at as string | null) ?? null } : null
  }
  let actual = await leer()
  if (!actual) return { error: 'No se pudo leer el bloque' }

  const hoyISO = todayBogotaISO()
  const { valores: yaTiene } = aplanarBloques([{ fields, data: actual.data }])
  const lectura = await leerConGemini({
    apiKey: getServerKey('gemini'),
    modelo: (process.env.GEMINI_ENTENDIMIENTO_MODEL || '').trim() || MODELO_ENTENDIMIENTO_POR_DEFECTO,
    instrucciones: instruccionesCarga(fields, hoyISO, yaTiene, {}, { viaje }),
    texto: `Mensajes:\n${textoParaModelo(mensajesDeTextos(mensajes))}`,
    esquema: esquemaCarga(fields, { chat: true }),
  })
  if (lectura.error || lectura.json === null) {
    // Solo el código del error: el texto del chat no va a los logs.
    console.error('[pegar-conversacion] el modelo no respondió:', (lectura.error ?? 'sin lectura').slice(0, 60))
    return { error: 'No pude leer la conversación. Intenta de nuevo en un momento.' }
  }

  const huella = createHash('sha256').update(limpio).digest('hex')
  const corta = huella.slice(0, 16)
  const armar = (data: Fila) => cargarChatEnBloque({
    fields, data, raw: lectura.json, mensajes, total, recortado, hoyISO, ahoraIso: new Date().toISOString(), huella: corta,
  })

  // Escritura con la marca de `updated_at` (como `escribirBloque` del bot): si alguien guardó mientras el modelo leía,
  // se relee y se vuelve a fusionar una vez; lo que la persona escribió gana.
  let carga = armar(actual.data)
  for (let intento = 0; carga.data && intento < 2; intento++) {
    let q = db(supabase).from('negocio_bloques').update({ data: carga.data, updated_at: new Date().toISOString() }).eq('id', destinoId)
    q = actual.marca ? q.eq('updated_at', actual.marca) : q.is('updated_at', null)
    const { data: hecho, error: errEsc } = await q.select('id')
    if (errEsc) return { error: `No se pudo guardar: ${(errEsc as { message: string }).message}` }
    if ((hecho ?? []).length > 0) break
    if (intento === 1) return { error: 'Alguien guardó este bloque mientras leía el chat. Intenta de nuevo.' }
    actual = await leer()
    if (!actual) return { error: 'No se pudo leer el bloque' }
    carga = armar(actual.data)
  }

  await registrarActividad(supabase, {
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: nb.negocio_id as string,
    tipo: 'cambio_sistema',
    autor_id: staffId ?? null,
    contenido: textoActividadChat(corta, carga, fields),
  }, 'pegarConversacion')

  return { error: null, resumen: carga.resumen, valores: carga.valores }
}
