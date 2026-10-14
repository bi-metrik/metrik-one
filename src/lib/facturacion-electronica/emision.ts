/**
 * El motor que lleva UNA emisión (factura o nota crédito) de `pendiente` a `archivada`. Puro: todo
 * pasa por `RepoEmision` y `ClienteMuisca`, para probarlo sin base ni red.
 *
 * Estados (`facturas_electronicas.estado`):
 *
 *   pendiente  → falta mandarla (o reintentar después de un error transitorio)
 *   enviada    → Muisca la recibió y la DIAN no ha contestado (`DianNoDisponible`): se consulta
 *   emitida    → la DIAN la validó: hay número y CUFE. Faltan sus archivos en ONE
 *   archivada  → PDF/XML en el bucket y, en Production, visible para el cliente (`facturas_cobro`)
 *   rechazada  → la DIAN o la API la rechazó por su contenido. La revisa una persona (alerta)
 *   bloqueada  → no se puede mandar sin que alguien arregle algo: sin numeración, datos del comprador
 *                incompletos, token inválido, o el consecutivo lo ocupa otro documento (alerta)
 *
 * Una factura por pago, aunque el webhook o el cron se repitan:
 *   1. La fila es única por `llave` (cobro + modo): encolar dos veces deja una fila.
 *   2. Antes de trabajarla se RECLAMA (`reclamada_hasta`): dos procesos a la vez, uno la trabaja.
 *   3. El consecutivo se asigna UNA vez (RPC atómica) y se queda con la fila: un reintento manda el
 *      MISMO número. La doc de Muisca lo pide: «No cambies automáticamente el prefijo o el consecutivo»
 *      (https://doc.muisca.io/debo-reenviar-un-documento-rechazado-2370874m0.md).
 *   4. El intento se anota ANTES de llamar a Muisca. Si el proceso muere con la factura ya creada,
 *      el siguiente intento ve `intentos > 0` y PRIMERO busca el documento por prefijo y consecutivo:
 *      si existe lo adopta, no lo vuelve a crear.
 *   5. Con la DIAN caída, Muisca reintenta solo durante 3 horas; ONE no la vuelve a crear, solo
 *      consulta (https://doc.muisca.io/qu%C3%A9-pasa-cuando-la-dian-no-responde-2370880m0.md).
 *
 * El pago nunca depende de esto: la emisión corre DESPUÉS de registrar el pago, y ningún error de aquí
 * sube hasta el webhook.
 */

import type { ModoMuisca } from './config'
import type { ClienteMuisca, DocumentoMuisca, ResolucionMuisca, RespuestaMuisca, TipoDocumentoMuisca } from './muisca'

export type EstadoEmision = 'pendiente' | 'enviada' | 'emitida' | 'archivada' | 'rechazada' | 'bloqueada'

export interface Emision {
  id: string
  workspaceId: string
  cobroId: string
  tipo: TipoDocumentoMuisca
  modo: ModoMuisca
  estado: EstadoEmision
  prefijo: string | null
  consecutivo: number | null
  numero: string | null
  proveedorDocumentoId: string | null
  cufe: string | null
  fechaEmision: string | null
  intentos: number
  alertaMotivo: string | null
}

export interface Numeracion {
  prefijo: string
  consecutivo: number
}

/** Lo que ONE va a facturar, menos el número: el motor se lo pone cuando lo tiene. */
export interface Preparado {
  armar(n: Numeracion & { resolucion: ResolucionMuisca }): Record<string, unknown>
  /** Para reconocer el documento si hay que adoptarlo. */
  identificacionComprador: string
  monto: number
  /** La resolución que manda: la del prefijo de la factura (en una nota, la de la factura referida). */
  prefijoResolucion: string | ((n: Numeracion) => string)
}

export type MotivoAlerta =
  | 'rechazada'
  | 'sin_numeracion'
  | 'datos'
  | 'no_autorizado'
  | 'sin_resolucion'
  | 'consecutivo_ocupado'
  | 'reintentos'
  | 'archivos'

export interface RepoEmision {
  /** La fila, si nadie más la tiene. `null` = la está trabajando otro proceso. */
  reclamar(id: string): Promise<Emision | null>
  soltar(id: string): Promise<void>
  asignarConsecutivo(id: string): Promise<{ ok: true; numeracion: Numeracion } | { ok: false; motivo: 'sin_numeracion' | 'rango_agotado' | 'error'; detalle: string }>
  preparar(e: Emision): Promise<{ ok: true; preparado: Preparado } | { ok: false; problema: string }>
  guardar(id: string, cambios: CambiosEmision): Promise<void>
  /** Sube los archivos al bucket y devuelve sus rutas. */
  guardarArchivos(e: Emision, archivos: { pdf: Uint8Array | null; xml: Uint8Array | null }): Promise<{ pdfPath: string | null; pdfSha: string | null; xmlPath: string | null; xmlSha: string | null }>
  /** En Production, deja la factura visible para el cliente. Idempotente. */
  publicar(e: Emision, archivos: { pdfPath: string | null; pdfSha: string | null; xmlPath: string | null; xmlSha: string | null }): Promise<void>
  /** Avisa al equipo. El motor ya decidió que toca (una vez por motivo). */
  alertar(e: Emision, motivo: MotivoAlerta, detalle: string): Promise<void>
}

export interface CambiosEmision {
  estado?: EstadoEmision
  intentos?: number
  proximoIntentoAt?: string
  ultimoError?: string | null
  proveedorDocumentoId?: string | null
  cufe?: string
  numero?: string
  fechaEmision?: string
  alertaMotivo?: MotivoAlerta
  enviado?: Record<string, unknown>
  respuesta?: Record<string, unknown>
  pdfPath?: string | null
  pdfSha256?: string | null
  xmlPath?: string | null
  xmlSha256?: string | null
}

export interface DepsEmision {
  repo: RepoEmision
  muisca: ClienteMuisca
  resolucion(prefijo: string): Promise<ResolucionMuisca | null>
  ahora(): Date
}

export interface ResultadoEmision {
  id: string
  estado: EstadoEmision | 'ocupada'
  detalle: string
}

/** Minutos hasta el siguiente intento, según cuántos van. Tope: 6 horas. */
const ESPERAS_MIN = [2, 5, 15, 30, 60, 120, 240, 360]
/** Un error transitorio se avisa al equipo a partir de este intento. */
export const INTENTOS_ANTES_DE_AVISAR = 3
/** La DIAN sin responder: Muisca reintenta 3 horas; pasadas ~6 consultas, se avisa. */
export const CONSULTAS_ANTES_DE_AVISAR = 6

function proximoIntento(intentos: number, ahora: Date): string {
  const min = ESPERAS_MIN[Math.min(Math.max(intentos, 1), ESPERAS_MIN.length) - 1]
  return new Date(ahora.getTime() + min * 60_000).toISOString()
}

function base64(b: string): Uint8Array | null {
  try {
    const s = b.includes(',') && b.startsWith('data:') ? b.slice(b.indexOf(',') + 1) : b
    return new Uint8Array(Buffer.from(s, 'base64'))
  } catch {
    return null
  }
}

export async function procesarEmision(id: string, deps: DepsEmision): Promise<ResultadoEmision> {
  const e = await deps.repo.reclamar(id)
  if (!e) return { id, estado: 'ocupada', detalle: 'Otro proceso la está trabajando.' }
  try {
    return await avanzar(e, deps)
  } finally {
    await deps.repo.soltar(id)
  }
}

async function alertarUnaVez(e: Emision, motivo: MotivoAlerta, detalle: string, deps: DepsEmision) {
  if (e.alertaMotivo === motivo) return
  await deps.repo.alertar(e, motivo, detalle)
  await deps.repo.guardar(e.id, { alertaMotivo: motivo })
  e.alertaMotivo = motivo
}

async function bloquear(e: Emision, motivo: MotivoAlerta, detalle: string, deps: DepsEmision): Promise<ResultadoEmision> {
  await deps.repo.guardar(e.id, { estado: 'bloqueada', ultimoError: detalle })
  await alertarUnaVez(e, motivo, detalle, deps)
  return { id: e.id, estado: 'bloqueada', detalle }
}

async function reprogramar(e: Emision, detalle: string, deps: DepsEmision, avisar: { motivo: MotivoAlerta; desde: number } | null): Promise<ResultadoEmision> {
  await deps.repo.guardar(e.id, { proximoIntentoAt: proximoIntento(e.intentos, deps.ahora()), ultimoError: detalle })
  if (avisar && e.intentos >= avisar.desde) {
    await alertarUnaVez(e, avisar.motivo, `${detalle} (${e.intentos} intentos)`, deps)
  }
  return { id: e.id, estado: e.estado, detalle }
}

async function avanzar(e: Emision, deps: DepsEmision): Promise<ResultadoEmision> {
  if (e.estado === 'archivada' || e.estado === 'rechazada' || e.estado === 'bloqueada') {
    return { id: e.id, estado: e.estado, detalle: 'Nada que hacer en este estado.' }
  }
  if (e.estado === 'emitida') return archivar(e, deps)

  // 1. Ya la tiene Muisca: solo se consulta.
  if (e.proveedorDocumentoId) {
    e.intentos += 1
    await deps.repo.guardar(e.id, { intentos: e.intentos })
    const r = await deps.muisca.consultarPorId(e.tipo, e.proveedorDocumentoId)
    return resolverRespuesta(e, r, deps)
  }

  // 2. El número: una vez, y se queda.
  if (e.consecutivo === null || e.prefijo === null) {
    const n = await deps.repo.asignarConsecutivo(e.id)
    if (!n.ok) {
      if (n.motivo === 'error') return reprogramar(e, n.detalle, deps, { motivo: 'reintentos', desde: INTENTOS_ANTES_DE_AVISAR })
      return bloquear(e, 'sin_numeracion', n.detalle, deps)
    }
    e.prefijo = n.numeracion.prefijo
    e.consecutivo = n.numeracion.consecutivo
    e.numero = `${e.prefijo}${e.consecutivo}`
  }
  const numeracion: Numeracion = { prefijo: e.prefijo, consecutivo: e.consecutivo }

  // 3. Lo que se factura (datos del comprador, monto, concepto).
  const p = await deps.repo.preparar(e)
  if (!p.ok) return bloquear(e, 'datos', p.problema, deps)
  const preparado = p.preparado

  // 4. Hubo un intento antes: ¿la factura ya existe en Muisca?
  if (e.intentos > 0) {
    const previa = await deps.muisca.buscarPorNumero(e.tipo, numeracion.prefijo, numeracion.consecutivo)
    // Una rechazada se corrige y se vuelve a mandar con el mismo número: no se adopta.
    if (previa.tipo === 'documento' && previa.documento.estado !== 'rechazada') {
      const d = previa.documento
      const otro =
        (d.identificacionCliente !== null && d.identificacionCliente.replace(/\D/g, '') !== preparado.identificacionComprador) ||
        (d.monto !== null && Math.round(d.monto) !== preparado.monto)
      if (otro) {
        return bloquear(
          e,
          'consecutivo_ocupado',
          `El ${e.numero} ya existe en Aliaddo con otro comprador o monto (${d.identificacionCliente ?? '?'}, $${d.monto ?? '?'}): no se reenvía.`,
          deps,
        )
      }
      e.intentos += 1
      await deps.repo.guardar(e.id, { intentos: e.intentos, proveedorDocumentoId: d.id })
      e.proveedorDocumentoId = d.id
      return resolverRespuesta(e, previa, deps)
    }
    if (previa.tipo === 'no_autorizado') return bloquear(e, 'no_autorizado', previa.mensaje, deps)
    if (previa.tipo === 'transitorio') {
      return reprogramar(e, `No se pudo confirmar si ${e.numero} ya existe: ${previa.mensaje}`, deps, { motivo: 'reintentos', desde: INTENTOS_ANTES_DE_AVISAR })
    }
    // 'no_encontrado' (o 'invalido' en la búsqueda): no existe, se manda.
  }

  // 5. La resolución de numeración, de la API (la clave técnica no se copia a mano).
  const prefijoRes = typeof preparado.prefijoResolucion === 'function' ? preparado.prefijoResolucion(numeracion) : preparado.prefijoResolucion
  const resolucion = await deps.resolucion(prefijoRes)
  if (!resolucion) {
    return bloquear(e, 'sin_resolucion', `La organización de Aliaddo no tiene una resolución con prefijo ${prefijoRes}.`, deps)
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = preparado.armar({ ...numeracion, resolucion })
  } catch (err) {
    return bloquear(e, 'datos', (err as Error).message, deps)
  }

  // 6. Se anota el intento ANTES de mandar (punto 4 del encabezado).
  e.intentos += 1
  await deps.repo.guardar(e.id, { intentos: e.intentos, numero: e.numero ?? undefined, enviado: cuerpo })
  const r = await deps.muisca.crear(e.tipo, cuerpo)
  return resolverRespuesta(e, r, deps)
}

function resumen(d: DocumentoMuisca): Record<string, unknown> {
  return { id: d.id, numero: d.numero, estado: d.estadoOriginal, motivos: d.motivos, cufe: d.cufe }
}

async function resolverRespuesta(e: Emision, r: RespuestaMuisca, deps: DepsEmision): Promise<ResultadoEmision> {
  switch (r.tipo) {
    case 'documento': {
      const d = r.documento
      if (d.estado === 'aprobada' && d.cufe) {
        const numero = d.numero ?? e.numero ?? undefined
        const fecha = d.fechaEmision ?? deps.ahora().toISOString().slice(0, 10)
        await deps.repo.guardar(e.id, {
          estado: 'emitida',
          proveedorDocumentoId: d.id,
          cufe: d.cufe,
          numero,
          fechaEmision: fecha,
          intentos: 0,
          ultimoError: null,
          respuesta: resumen(d),
          proximoIntentoAt: deps.ahora().toISOString(),
        })
        Object.assign(e, { estado: 'emitida', proveedorDocumentoId: d.id, cufe: d.cufe, numero: numero ?? null, fechaEmision: fecha, intentos: 0 })
        return archivar(e, deps)
      }
      if (d.estado === 'rechazada') {
        const detalle = `La DIAN rechazó ${d.numero ?? e.numero}: ${d.motivos.join(' · ') || d.estadoOriginal || 'sin motivo'}`
        await deps.repo.guardar(e.id, { estado: 'rechazada', proveedorDocumentoId: d.id, ultimoError: detalle, respuesta: resumen(d) })
        await alertarUnaVez(e, 'rechazada', detalle, deps)
        return { id: e.id, estado: 'rechazada', detalle }
      }
      // En proceso (DIAN no disponible u otro estado intermedio): Muisca la tiene, se consulta luego.
      await deps.repo.guardar(e.id, { estado: 'enviada', proveedorDocumentoId: d.id, respuesta: resumen(d) })
      e.estado = 'enviada'
      e.proveedorDocumentoId = d.id
      return reprogramar(e, `Esperando a la DIAN (${d.estadoOriginal ?? 'sin estado'}).`, deps, { motivo: 'reintentos', desde: CONSULTAS_ANTES_DE_AVISAR })
    }
    case 'invalido': {
      const detalle = `Aliaddo no aceptó ${e.numero}: ${r.mensaje}`
      await deps.repo.guardar(e.id, { estado: 'rechazada', ultimoError: detalle })
      await alertarUnaVez(e, 'rechazada', detalle, deps)
      return { id: e.id, estado: 'rechazada', detalle }
    }
    case 'no_autorizado':
      return bloquear(e, 'no_autorizado', `Aliaddo rechazó el token: ${r.mensaje}`, deps)
    case 'no_encontrado':
      // Consultar por id y que no exista: se vuelve a mandar con el mismo número (la búsqueda por
      // número del paso 4 evita el duplicado si en realidad sí está).
      await deps.repo.guardar(e.id, { estado: 'pendiente', proveedorDocumentoId: null, ultimoError: 'Aliaddo no encontró el documento por su id.' })
      e.estado = 'pendiente'
      e.proveedorDocumentoId = null
      return reprogramar(e, 'Aliaddo no encontró el documento por su id.', deps, { motivo: 'reintentos', desde: INTENTOS_ANTES_DE_AVISAR })
    case 'transitorio':
      return reprogramar(e, r.mensaje, deps, { motivo: 'reintentos', desde: INTENTOS_ANTES_DE_AVISAR })
  }
}

/** La factura ya vale. Trae sus archivos a ONE y, en Production, la deja visible para el cliente. */
async function archivar(e: Emision, deps: DepsEmision): Promise<ResultadoEmision> {
  if (!e.proveedorDocumentoId) {
    return reprogramar(e, 'Emitida sin id de Aliaddo: no hay de dónde traer los archivos.', deps, { motivo: 'archivos', desde: 1 })
  }
  e.intentos += 1
  await deps.repo.guardar(e.id, { intentos: e.intentos })
  const r = await deps.muisca.consultarPorId(e.tipo, e.proveedorDocumentoId)
  if (r.tipo !== 'documento') {
    const detalle = r.tipo === 'no_encontrado' ? 'Aliaddo no encontró el documento emitido.' : r.mensaje
    return reprogramar(e, `Archivos pendientes: ${detalle}`, deps, { motivo: 'archivos', desde: INTENTOS_ANTES_DE_AVISAR })
  }
  const d = r.documento
  const traer = async (enLinea: string | null, url: string | null) => {
    if (enLinea) return base64(enLinea)
    if (!url) return null
    const x = await deps.muisca.descargar(url)
    return x.ok ? x.bytes : null
  }
  const pdf = await traer(d.pdfBase64, d.urlPdf)
  const xml = await traer(d.xmlBase64, d.urlXml)
  if (!pdf && !xml) {
    return reprogramar(e, 'Archivos pendientes: no se pudo traer ni el PDF ni el XML.', deps, { motivo: 'archivos', desde: INTENTOS_ANTES_DE_AVISAR })
  }
  const rutas = await deps.repo.guardarArchivos(e, { pdf, xml })
  await deps.repo.publicar(e, rutas)
  await deps.repo.guardar(e.id, {
    estado: 'archivada',
    pdfPath: rutas.pdfPath,
    pdfSha256: rutas.pdfSha,
    xmlPath: rutas.xmlPath,
    xmlSha256: rutas.xmlSha,
    ultimoError: null,
  })
  return { id: e.id, estado: 'archivada', detalle: `${e.numero} emitida y archivada.` }
}
