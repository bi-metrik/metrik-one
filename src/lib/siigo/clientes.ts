// ============================================================
// Cliente (tercero) de Siigo a partir del expediente del negocio.
//
// Es el ÚNICO de los tres documentos que se crea solo, y por una razón concreta:
// un tercero NO es un documento contable. Crearlo dos veces no asienta nada, no
// consume numeración y no se le manda a nadie. La factura y el recibo sí asientan,
// así que los dispara una persona.
//
// El momento: cuando el negocio supera la etapa donde se captura el RUT
// (Documentación en SOENA). Antes de ahí el dato no existe; medido el 2026-08-09,
// después de ahí lo tiene prácticamente toda la cartera (8/8 en Cargue, 16/16 en
// Entrega, 90/92 en Cita, 39/39 en Notificación).
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { siigoRequest, SiigoError } from './client'
import { borradorCliente, emailPlausible, type BorradorCliente, type RutExtraido } from './mapeo'

/** Config opt-in por línea: `lineas_negocio.config_extra.siigo`. */
export interface SiigoLineaConfig {
  /**
   * A partir de qué `etapas_negocio.numero` el negocio ya tiene RUT y se puede
   * crear su tercero en Siigo. Sin este dato NO se crea nada: es la misma
   * decisión de la cola de facturación, que prefiere una bandeja vacía a
   * inventarse un criterio.
   */
  crear_cliente_desde_etapa_numero?: number
}

/**
 * ¿Corresponde crear el tercero al aterrizar en esta etapa? Puro y exportado
 * para poder probar la decisión sin mocks: es el gate que evita que un cambio
 * de configuración dispare llamadas a Siigo donde nadie las pidió.
 *
 * El `numero` es el orden VISIBLE de la etapa, no el `orden` interno: no
 * coinciden, y la configuración se declara con el visible (mismo criterio que
 * `facturacion.desde_etapa_numero`).
 */
export function debeCrearClienteSiigo(
  cfg: SiigoLineaConfig | null | undefined,
  etapaNumeroDestino: number | null | undefined,
): boolean {
  const desde = cfg?.crear_cliente_desde_etapa_numero
  // Sin configuración no se asume nada: ninguna línea ajena empieza a crear
  // terceros en un Siigo por el solo hecho de que exista esta función.
  if (typeof desde !== 'number') return false
  if (typeof etapaNumeroDestino !== 'number') return false
  return etapaNumeroDestino > desde
}

/**
 * ¿La marca que ya tiene el negocio sigue sirviendo, o quedó vieja?
 *
 * El atajo por marca existía para no volver a preguntarle a Siigo por un tercero
 * que ya se creó. El problema es que devolvía la identificación GUARDADA sin
 * mirarla, y por ahí se coló el daño de `nit_sin_dv` (#394): las marcas escritas
 * antes de ese arreglo guardaron la cédula SIN su último dígito, porque la
 * heurística lo adivinaba como DV (acierta por azar ~1 de cada 11). Como el atajo
 * salía antes de leer el RUT, arreglar la extracción no las alcanzó y la factura
 * siguió saliendo con la cédula mutilada.
 *
 * Medido el 2026-08-26 sobre SOENA: 21 marcas así, y FV-2-244 ya rechazada por la
 * DIAN — se facturó a 8081571 cuando el RUT dice 80815711, que es exactamente
 * "la información no coincide con el RUT".
 *
 * Comparar contra el RUT convierte ese backfill en autocorrección: el caso se
 * repara solo la próxima vez que alguien intente facturarlo.
 *
 * Sin identificación de hoy la marca MANDA: un RUT que se dañó después no puede
 * invalidar un tercero que ya existe en Siigo.
 */
export function marcaSigueValida(
  identificacionMarcada: string | null | undefined,
  identificacionDelRut: string | null | undefined,
): boolean {
  if (!identificacionMarcada) return false
  if (!identificacionDelRut) return true
  return identificacionMarcada === identificacionDelRut
}

export type ResultadoCliente =
  /** Creado ahora en Siigo. */
  | { estado: 'creado'; identificacion: string; siigo_id: string | null }
  /** Ya existía (por identificación) o ya lo habíamos registrado. */
  | { estado: 'ya_existia'; identificacion: string; siigo_id: string | null }
  /** Falta información del expediente. NO es un error: es trabajo pendiente. */
  | { estado: 'incompleto'; faltantes: string[] }
  /** Siigo respondió con error, o el workspace no está configurado. */
  | { estado: 'error'; mensaje: string }

interface NegocioParaCliente {
  id: string
  contacto_id: string | null
  metadata: Record<string, unknown> | null
}

/** Marca que queda en `negocios.metadata.siigo_cliente`. */
interface MarcaCliente {
  identificacion: string
  siigo_id: string | null
  at: string
  origen: 'automatico' | 'manual'
}

/**
 * Arma el borrador del cliente leyendo el RUT del expediente y el contacto.
 * Mismo criterio que la cola de facturación: el email y el teléfono del contacto
 * ganan sobre los del RUT, porque el contacto lo mantiene vivo el comercial y el
 * RUT es una foto del documento.
 */
async function borradorDelNegocio(
  negocioId: string,
  contactoId: string | null,
): Promise<{ borrador: ReturnType<typeof borradorCliente> }> {
  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloques, error: errBloques } = await (svc as any)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', 'rut')

  // Un error de consulta NO puede leerse como "no hay RUT": eso mandaría el caso a
  // la lista de incompletos con un motivo falso.
  if (errBloques) throw new Error(`No se pudo leer el RUT del negocio: ${errBloques.message}`)

  type Bl = { data: { campos?: Record<string, { value?: unknown }> } | null }
  const rut: RutExtraido = {}
  for (const b of ((bloques ?? []) as Bl[])) {
    for (const [k, v] of Object.entries(b.data?.campos ?? {})) {
      if (v?.value != null && v.value !== '') (rut as Record<string, string>)[k] = String(v.value)
    }
  }

  let contacto: { email: string | null; telefono: string | null } = { email: null, telefono: null }
  if (contactoId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: c } = await (svc as any)
      .from('contactos').select('email, telefono').eq('id', contactoId).maybeSingle()
    if (c) contacto = { email: c.email ?? null, telefono: c.telefono ?? null }
  }

  return { borrador: borradorCliente(rut, contacto) }
}

/** ¿Existe ya el tercero en Siigo? Se pregunta por identificación, que es su llave. */
async function buscarEnSiigo(
  workspaceId: string,
  identificacion: string,
  maxEspera429Ms: number,
): Promise<string | null> {
  const res = await siigoRequest<{ results?: Array<{ id?: string }> }>(
    workspaceId,
    `/v1/customers?identification=${encodeURIComponent(identificacion)}`,
    { maxEspera429Ms },
  )
  const primero = res.results?.[0]
  return primero ? (primero.id ?? null) : null
}

/**
 * Crea el tercero del negocio en Siigo si hace falta. Idempotente por diseño:
 * primero mira la marca que dejamos, luego le pregunta a Siigo, y solo entonces
 * crea. Nunca crea con datos a medias.
 */
export async function asegurarClienteSiigo(
  workspaceId: string,
  negocioId: string,
  origen: MarcaCliente['origen'] = 'automatico',
  /**
   * Cuánto aguantar si Siigo responde que se pasó el límite de peticiones. Por
   * defecto no se espera (falla limpio); un barrido de cientos de casos sí pasa
   * un valor, porque ahí la pausa es parte del trabajo.
   */
  maxEspera429Ms = 0,
): Promise<ResultadoCliente> {
  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negRaw, error: errNeg } = await (svc as any)
    .from('negocios')
    .select('id, contacto_id, metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (errNeg || !negRaw) return { estado: 'error', mensaje: 'Negocio no encontrado' }
  const negocio = negRaw as NegocioParaCliente

  const yaMarcado = (negocio.metadata?.siigo_cliente ?? null) as MarcaCliente | null

  // `borradorDelNegocio` LANZA si la consulta del RUT falla (para no confundir un
  // error de base con "no hay RUT"). Se atrapa aquí y no más arriba: esta función
  // promete devolver un `ResultadoCliente`, y quien la llame desde un botón manual
  // no tiene por qué envolverla en su propio try.
  let borrador: Awaited<ReturnType<typeof borradorDelNegocio>>
  try {
    borrador = await borradorDelNegocio(negocioId, negocio.contacto_id)
  } catch (e) {
    // Un caso YA marcado no se convierte en error porque hoy no se pueda releer
    // su RUT: eso ya estaba resuelto y la marca sigue siendo la respuesta.
    if (yaMarcado?.identificacion) {
      return { estado: 'ya_existia', identificacion: yaMarcado.identificacion, siigo_id: yaMarcado.siigo_id }
    }
    return { estado: 'error', mensaje: (e as Error).message }
  }
  const { payload, faltantes } = borrador.borrador

  // La marca vale mientras siga coincidiendo con el RUT; si no, se rehace el
  // camino completo (buscar en Siigo por la identificación buena, crear si no
  // está, y re-marcar). Ver `marcaSigueValida`.
  if (yaMarcado && marcaSigueValida(yaMarcado.identificacion, payload.identification)) {
    return { estado: 'ya_existia', identificacion: yaMarcado.identificacion, siigo_id: yaMarcado.siigo_id }
  }

  // Lo que ONE no pudo resolver se declara, no se rellena. El caso aparece en la
  // cola de facturación con esta misma lista y alguien la completa.
  if (faltantes.length > 0) return { estado: 'incompleto', faltantes }

  try {
    const existente = await buscarEnSiigo(workspaceId, payload.identification, maxEspera429Ms)
    if (existente !== null) {
      await marcar(workspaceId, negocioId, negocio.metadata, {
        identificacion: payload.identification,
        siigo_id: existente,
        at: new Date().toISOString(),
        origen,
      })
      return { estado: 'ya_existia', identificacion: payload.identification, siigo_id: existente }
    }

    const creado = await siigoRequest<{ id?: string }>(workspaceId, '/v1/customers', {
      method: 'POST',
      body: payload satisfies BorradorCliente,
      maxEspera429Ms,
    })

    await marcar(workspaceId, negocioId, negocio.metadata, {
      identificacion: payload.identification,
      siigo_id: creado.id ?? null,
      at: new Date().toISOString(),
      origen,
    })
    return { estado: 'creado', identificacion: payload.identification, siigo_id: creado.id ?? null }
  } catch (e) {
    const mensaje = e instanceof SiigoError ? e.message : (e as Error).message
    return { estado: 'error', mensaje }
  }
}

/** Guarda la marca en el negocio sin pisar el resto de `metadata`. */
async function marcar(
  workspaceId: string,
  negocioId: string,
  metadataActual: Record<string, unknown> | null,
  marca: MarcaCliente,
): Promise<void> {
  const svc = createServiceClient()
  const metadata = { ...(metadataActual ?? {}), siigo_cliente: marca }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc as any)
    .from('negocios').update({ metadata }).eq('id', negocioId).eq('workspace_id', workspaceId)
  // No se traga el error: sin la marca, el siguiente avance vuelve a preguntarle a
  // Siigo (que responderá "ya existe", así que no duplica), pero eso es una llamada
  // de más repetida en cada avance y nadie la vería.
  if (error) console.error('[siigo] no se pudo marcar el negocio con su tercero:', error.message)
}

/**
 * Disparador que cuelga del avance de etapa. Devuelve `null` cuando no aplica,
 * para que quien llama distinga "no correspondía" de "corrió y pasó algo".
 *
 * NUNCA lanza: el negocio YA avanzó cuando esto corre, y un fallo con Siigo no
 * puede deshacer ni ensuciar ese avance. Lo que salga mal queda en el timeline y
 * el caso sigue visible en la cola con lo que le falta.
 */
export async function crearClienteSiigoAlAvanzar(
  workspaceId: string,
  negocioId: string,
  lineaId: string | null,
  etapaNumeroDestino: number | null,
  staffId: string | null,
): Promise<ResultadoCliente | null> {
  try {
    if (!lineaId || etapaNumeroDestino == null) return null

    const svc = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: linea } = await (svc as any)
      .from('lineas_negocio').select('config_extra').eq('id', lineaId).maybeSingle()
    const cfg = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as SiigoLineaConfig | undefined
    if (!debeCrearClienteSiigo(cfg, etapaNumeroDestino)) return null

    const r = await asegurarClienteSiigo(workspaceId, negocioId, 'automatico')

    // Solo se anota lo que cambió algo o lo que hay que atender. Anotar
    // "ya existía" en cada avance llenaría el timeline de ruido.
    if (r.estado === 'creado') {
      await anotar(workspaceId, negocioId, staffId, `Cliente creado en Siigo (${r.identificacion})`)
    } else if (r.estado === 'incompleto') {
      await anotar(workspaceId, negocioId, staffId, `No se pudo crear el cliente en Siigo, falta: ${r.faltantes.join(', ')}`)
    } else if (r.estado === 'error') {
      await anotar(workspaceId, negocioId, staffId, `Error al crear el cliente en Siigo: ${r.mensaje}`)
    }
    return r
  } catch (e) {
    // Última red: ni siquiera un fallo inesperado puede romper el avance.
    console.error('[siigo] crearClienteSiigoAlAvanzar', e)
    return { estado: 'error', mensaje: (e as Error).message }
  }
}

/**
 * `activity_log.tipo` DEBE estar en el CHECK o el insert falla en silencio (ya
 * pasó cuatro veces en este repo). 'sistema' está en el catálogo.
 * `autor_id` es FK a staff(id), NO a profiles.
 */
async function anotar(
  workspaceId: string,
  negocioId: string,
  staffId: string | null,
  contenido: string,
): Promise<void> {
  if (!staffId) return
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc as any).from('activity_log').insert({
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'sistema',
    autor_id: staffId,
    contenido,
  })
  if (error) console.error('[siigo] no se pudo anotar en activity_log:', error.message)
}

/** Datos que la financiera puede corregir en la pantalla de revisión. */
export interface ContactoEditado {
  email?: string
  telefono?: string
}

/**
 * Corrige el email y el teléfono del cliente ANTES de emitir la factura.
 *
 * Diana lo pidió con un caso concreto: el correo que ONE tiene guardado es el que
 * Siigo usa para mandar la factura electrónica, y si está mal la factura sale bien
 * y no llega a nadie. Corregirlo después no sirve: la factura ya se fue.
 *
 * Se escribe en el CONTACTO de ONE, no en una copia pegada al negocio. Es el mismo
 * dato que el comercial mantiene vivo, y una corrección hecha aquí tiene que valer
 * también para el siguiente documento del mismo cliente. (Medido el 2026-08-21: los
 * 288 negocios de SOENA tienen contacto, así que no hay caso que se quede sin dónde
 * escribir; si apareciera uno, se dice y no se emite.)
 *
 * Un campo vacío es "no lo toques", nunca "bórralo": esta pantalla existe para
 * completar datos antes de facturar, y no es el lugar desde donde se vacía el CRM.
 *
 * Si el tercero YA existe en Siigo hay que empujarle el cambio: allá el correo vive
 * en su propia copia, y sin el PUT la factura seguiría saliendo al correo viejo.
 */
export async function corregirContactoParaFactura(
  workspaceId: string,
  negocioId: string,
  datos: ContactoEditado,
  maxEspera429Ms = 0,
): Promise<{ ok: true; cambiado: boolean } | { ok: false; mensaje: string }> {
  const email = (datos.email ?? '').trim()
  const telefono = (datos.telefono ?? '').trim()
  if (!email && !telefono) return { ok: true, cambiado: false }
  if (email && !emailPlausible(email)) {
    return { ok: false, mensaje: `"${email}" no parece un correo válido` }
  }

  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negRaw, error: errNeg } = await (svc as any)
    .from('negocios')
    .select('id, contacto_id, metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (errNeg || !negRaw) return { ok: false, mensaje: 'Negocio no encontrado' }
  const negocio = negRaw as NegocioParaCliente

  if (!negocio.contacto_id) {
    return { ok: false, mensaje: 'El negocio no tiene contacto: corrige el dato desde el negocio antes de facturar' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errCon } = await (svc as any)
    .from('contactos')
    .update({ ...(email ? { email } : {}), ...(telefono ? { telefono } : {}) })
    .eq('id', negocio.contacto_id)
    .eq('workspace_id', workspaceId)
  if (errCon) return { ok: false, mensaje: `No se pudo guardar el contacto: ${errCon.message}` }

  const marca = (negocio.metadata?.siigo_cliente ?? null) as MarcaCliente | null
  if (!marca?.siigo_id) {
    // El tercero todavía no existe en Siigo: lo creará `asegurarClienteSiigo`
    // enseguida, y ya lo leerá corregido.
    return { ok: true, cambiado: true }
  }

  try {
    const { borrador } = await borradorDelNegocio(negocioId, negocio.contacto_id)
    if (borrador.faltantes.length > 0) {
      return { ok: false, mensaje: `Falta ${borrador.faltantes.join(', ')} para actualizar el tercero` }
    }
    await siigoRequest(workspaceId, `/v1/customers/${marca.siigo_id}`, {
      method: 'PUT',
      body: borrador.payload satisfies BorradorCliente,
      maxEspera429Ms,
    })
    return { ok: true, cambiado: true }
  } catch (e) {
    const mensaje = e instanceof SiigoError ? e.message : (e as Error).message
    return { ok: false, mensaje: `El dato quedó en ONE, pero Siigo no aceptó el cambio del tercero: ${mensaje}` }
  }
}
