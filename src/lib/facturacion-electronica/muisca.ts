/**
 * Adaptador HTTP de Muisca (ALIADDO SAS, NIT 830099008, proveedor tecnológico habilitado por la DIAN).
 * Sin base y sin `server-only`: recibe `fetch` para probarlo con las respuestas de la documentación.
 *
 * Fuente: la documentación pública, leída el 2026-10-14 (https://doc.muisca.io/llms.txt). Endpoints:
 *
 *   POST /v2/documents/invoices                                    Crear factura electrónica
 *        https://doc.muisca.io/crear-factura-electr%C3%B3nica-42587102e0.md
 *   POST /v2/documents/invoices/credit-notes                       Crear nota crédito
 *        https://doc.muisca.io/crear-nota-cr%C3%A9dito-42587114e0.md
 *   GET  /v2/documents/invoices/{id}                               Consultar factura por ID
 *        https://doc.muisca.io/consultar-por-id-42587100e0.md
 *   GET  /v2/documents/invoices/find-by-prefix-and-consecutive     Consultar por prefijo y consecutivo
 *        https://doc.muisca.io/consultar-por-prefijo-y-consecutivo-42587101e0.md
 *   GET  /v2/documents/invoices/credit-notes/{id}                  Consultar nota crédito por ID
 *        https://doc.muisca.io/consultar-por-id-42587115e0.md
 *   GET  /v2/documents/invoices/credit-notes/find-by-prefix-and-consecutive
 *        https://doc.muisca.io/consultar-por-prefijo-y-consecutivo-42587116e0.md
 *   GET  /v2/resolutions/resolutions-dian                          Resoluciones de la organización
 *        https://doc.muisca.io/resoluciones-42587097e0.md
 *
 * Autenticación: `Authorization: Bearer <token>`; el token es de UNA organización
 * (https://doc.muisca.io/autenticaci%C3%B3n-2370864m0.md). Servidor: `https://api.muisca.io`
 * (bloque `servers` de cada OpenAPI). La FAQ de autenticación muestra otro host
 * (`nitro.aliaddo.net`): por eso la base es configurable.
 *
 * Códigos HTTP (https://doc.muisca.io/qu%C3%A9-significa-un-c%C3%B3digo-de-respuesta-http-2370881m0.md):
 * 400/413/422 = datos inválidos (corregir, no reintentar igual); 401/403 = token u organización;
 * 404 = no existe; 429/500/520 = reintentar de forma controlada. Un 200 NO es una factura válida:
 * hay que leer el estado ante la DIAN (`Status`).
 *
 * Lo que la doc NO dice y aquí se asume (está en el reporte del PR):
 *   · el cuerpo de un error 4xx/5xx: se guarda el texto tal cual (recortado);
 *   · los valores de `Status` distintos de «Aprobada»: «Rechazada» y `DianNoDisponible` salen de las
 *     FAQ; cualquier otro se trata como «en proceso» y se vuelve a consultar;
 *   · contra qué servidor se resuelven `UrlPdf` / `UrlXml…` (vienen relativas).
 */

export type TipoDocumentoMuisca = 'factura' | 'nota_credito'

export interface ResolucionMuisca {
  key: string
  prefix: string
  number: number
  rangeInitial: number
  rangeFinal: number
  validFrom: string
  validUntil: string
}

/** Estado del documento ante la DIAN, reducido a lo que ONE decide. */
export type EstadoDian = 'aprobada' | 'rechazada' | 'en_proceso'

export interface DocumentoMuisca {
  id: string
  /** CUFE (factura) o CUDE (nota). 96 hex en minúscula, o null si todavía no hay. */
  cufe: string | null
  /** «SETP994121930»: prefijo + consecutivo, como lo imprime la DIAN. */
  numero: string | null
  prefijo: string | null
  consecutivo: number | null
  estado: EstadoDian
  estadoOriginal: string | null
  motivos: string[]
  /** 'YYYY-MM-DD' de `IssuedAt`. */
  fechaEmision: string | null
  urlPdf: string | null
  urlXml: string | null
  pdfBase64: string | null
  xmlBase64: string | null
  identificacionCliente: string | null
  monto: number | null
}

export type RespuestaMuisca =
  | { tipo: 'documento'; documento: DocumentoMuisca }
  /** 400, 413, 422: el contenido no pasa. Reenviar lo mismo da lo mismo. */
  | { tipo: 'invalido'; http: number; mensaje: string }
  /** 401, 403: el token o la organización. Lo arregla una persona. */
  | { tipo: 'no_autorizado'; http: number; mensaje: string }
  | { tipo: 'no_encontrado' }
  /** 429, 5xx, red, tiempo agotado o respuesta ilegible: se puede reintentar. */
  | { tipo: 'transitorio'; http: number | null; mensaje: string }

export interface OpcionesClienteMuisca {
  token: string
  apiUrl: string
  /** Base para las rutas relativas de `UrlPdf` / `UrlXml…`. Sin ella no se descargan archivos. */
  archivosUrl?: string | null
  fetch?: typeof fetch
  /** Por defecto 25 s: la creación espera la validación de la DIAN (hasta 4 intentos inmediatos). */
  timeoutMs?: number
}

const RE_CUFE = /^[0-9a-f]{96}$/
const RE_CUFE_QR = /CUFE:([0-9a-fA-F]{96})/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Crudo = Record<string, any>

/** Lee un campo en PascalCase (lo que muestra la doc) o en camelCase (por si acaso). */
function campo(o: Crudo, nombre: string): unknown {
  if (nombre in o) return o[nombre]
  const camel = nombre[0].toLowerCase() + nombre.slice(1)
  return camel in o ? o[camel] : undefined
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function numero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Sin tildes y en minúscula, para comparar estados. */
const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function estadoDian(status: string | null, entregaDian: string | null): EstadoDian {
  const s = plano(status ?? '')
  const e = plano(entregaDian ?? '')
  if (s.includes('rechaz') || e === 'invalid' || e === 'rejected') return 'rechazada'
  if (s.startsWith('aprobad') || e === 'valid') return 'aprobada'
  return 'en_proceso'
}

/** El CUFE: `Cufe` (respuesta de creación), `Cuv` (consulta) o el que trae el QR. */
function cufeDe(o: Crudo): string | null {
  for (const c of ['Cufe', 'Cuv', 'Cude']) {
    const v = texto(campo(o, c))?.toLowerCase()
    if (v && RE_CUFE.test(v)) return v
  }
  const qr = texto(campo(o, 'Qr'))
  const m = qr ? RE_CUFE_QR.exec(qr) : null
  return m ? m[1].toLowerCase() : null
}

export function leerDocumento(o: Crudo): DocumentoMuisca | null {
  const id = texto(campo(o, 'Id'))
  if (!id) return null
  const status = texto(campo(o, 'Status'))
  const motivos = campo(o, 'StatusReasons')
  const rechazo = texto(campo(o, 'RejectReason'))
  const emitida = texto(campo(o, 'IssuedAt'))
  return {
    id,
    cufe: cufeDe(o),
    numero: texto(campo(o, 'Sequence')),
    prefijo: texto(campo(o, 'Prefix')),
    consecutivo: numero(campo(o, 'Consecutive')),
    estado: estadoDian(status, texto(campo(o, 'DianDeliveryStatus'))),
    estadoOriginal: status,
    motivos: [
      ...(Array.isArray(motivos) ? motivos.filter((m): m is string => typeof m === 'string') : []),
      ...(rechazo ? [rechazo] : []),
    ],
    fechaEmision: emitida && /^\d{4}-\d{2}-\d{2}/.test(emitida) ? emitida.slice(0, 10) : null,
    urlPdf: texto(campo(o, 'UrlPdf')),
    urlXml: texto(campo(o, 'UrlXmlAttachedDocument')) ?? texto(campo(o, 'UrlXmlDocument')),
    pdfBase64: texto(campo(o, 'UrlPdfEncoded')),
    xmlBase64: texto(campo(o, 'UrlXmlEncoded')),
    identificacionCliente: texto(campo(o, 'CustomerIdentification')),
    monto: numero(campo(o, 'Amount')),
  }
}

function leerResolucion(o: Crudo): ResolucionMuisca | null {
  const key = texto(campo(o, 'Key'))
  const prefix = texto(campo(o, 'Prefix'))
  const n = numero(campo(o, 'Number'))
  const desde = numero(campo(o, 'RangeInitial'))
  const hasta = numero(campo(o, 'RangeFinal'))
  const vDesde = texto(campo(o, 'ValidFrom'))
  const vHasta = texto(campo(o, 'ValidUntil'))
  if (!key || !prefix || n === null || desde === null || hasta === null || !vDesde || !vHasta) return null
  return {
    key,
    prefix,
    number: n,
    rangeInitial: desde,
    rangeFinal: hasta,
    validFrom: vDesde.slice(0, 10),
    validUntil: vHasta.slice(0, 10),
  }
}

const RUTA: Record<TipoDocumentoMuisca, string> = {
  factura: '/v2/documents/invoices',
  nota_credito: '/v2/documents/invoices/credit-notes',
}

export interface ClienteMuisca {
  crear(tipo: TipoDocumentoMuisca, cuerpo: Record<string, unknown>): Promise<RespuestaMuisca>
  consultarPorId(tipo: TipoDocumentoMuisca, id: string): Promise<RespuestaMuisca>
  buscarPorNumero(tipo: TipoDocumentoMuisca, prefijo: string, consecutivo: number): Promise<RespuestaMuisca>
  /** Las resoluciones de numeración de la organización del token. */
  resoluciones(): Promise<{ ok: true; resoluciones: ResolucionMuisca[] } | { ok: false; mensaje: string }>
  /** El archivo de una URL del documento (relativa o absoluta). `null` si no se puede. */
  descargar(url: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; mensaje: string }>
}

function clasificarHttp(status: number, cuerpo: string): RespuestaMuisca {
  const mensaje = `HTTP ${status}: ${cuerpo.slice(0, 500)}`
  if (status === 404) return { tipo: 'no_encontrado' }
  if (status === 401 || status === 403) return { tipo: 'no_autorizado', http: status, mensaje }
  if (status === 400 || status === 413 || status === 422) return { tipo: 'invalido', http: status, mensaje }
  return { tipo: 'transitorio', http: status, mensaje }
}

export function clienteMuisca(op: OpcionesClienteMuisca): ClienteMuisca {
  const f = op.fetch ?? fetch
  const base = op.apiUrl.replace(/\/+$/, '')
  const timeoutMs = op.timeoutMs ?? 25_000

  async function llamar(metodo: 'GET' | 'POST', ruta: string, cuerpo?: object): Promise<{ status: number; texto: string } | { error: string }> {
    try {
      const r = await f(`${base}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${op.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })
      return { status: r.status, texto: await r.text() }
    } catch (e) {
      return { error: (e as Error)?.name === 'TimeoutError' ? `sin respuesta en ${timeoutMs} ms` : String((e as Error)?.message ?? e) }
    }
  }

  async function documento(metodo: 'GET' | 'POST', ruta: string, cuerpo?: object): Promise<RespuestaMuisca> {
    const r = await llamar(metodo, ruta, cuerpo)
    if ('error' in r) return { tipo: 'transitorio', http: null, mensaje: r.error }
    if (r.status < 200 || r.status >= 300) return clasificarHttp(r.status, r.texto)
    let json: unknown
    try {
      json = JSON.parse(r.texto)
    } catch {
      return { tipo: 'transitorio', http: r.status, mensaje: `Respuesta que no es JSON: ${r.texto.slice(0, 200)}` }
    }
    const doc = json && typeof json === 'object' ? leerDocumento(json as Crudo) : null
    // La búsqueda por número sin resultado puede venir como 200 vacío: es «no existe».
    if (!doc) {
      return metodo === 'GET' ? { tipo: 'no_encontrado' } : { tipo: 'transitorio', http: r.status, mensaje: 'Respuesta sin Id de documento.' }
    }
    return { tipo: 'documento', documento: doc }
  }

  return {
    crear: (tipo, cuerpo) => documento('POST', RUTA[tipo], cuerpo),
    consultarPorId: (tipo, id) => documento('GET', `${RUTA[tipo]}/${encodeURIComponent(id)}`),
    buscarPorNumero: (tipo, prefijo, consecutivo) =>
      documento(
        'GET',
        `${RUTA[tipo]}/find-by-prefix-and-consecutive?prefix=${encodeURIComponent(prefijo)}&consecutive=${encodeURIComponent(String(consecutivo))}`,
      ),

    async resoluciones() {
      const r = await llamar('GET', '/v2/resolutions/resolutions-dian')
      if ('error' in r) return { ok: false, mensaje: r.error }
      if (r.status < 200 || r.status >= 300) return { ok: false, mensaje: `HTTP ${r.status}: ${r.texto.slice(0, 300)}` }
      try {
        const json = JSON.parse(r.texto) as unknown
        // La doc muestra UN objeto; se acepta también una lista.
        const filas = Array.isArray(json) ? json : [json]
        const resoluciones = filas
          .map((x) => (x && typeof x === 'object' ? leerResolucion(x as Crudo) : null))
          .filter((x): x is ResolucionMuisca => x !== null)
        return { ok: true, resoluciones }
      } catch {
        return { ok: false, mensaje: 'Las resoluciones no vinieron en JSON.' }
      }
    },

    async descargar(url) {
      const absoluta = /^https?:\/\//i.test(url) ? url : op.archivosUrl ? `${op.archivosUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}` : null
      if (!absoluta) return { ok: false, mensaje: 'La URL del archivo es relativa y no hay ALIADDO_ARCHIVOS_URL.' }
      // El token solo viaja al host de la API: los archivos pueden estar en un almacenamiento de
      // terceros (los PDF de ejemplo de la doc están en Backblaze), y ahí no tiene nada que hacer.
      const mismoHost = (() => {
        try {
          return new URL(absoluta).host === new URL(base).host
        } catch {
          return false
        }
      })()
      try {
        const r = await f(absoluta, {
          headers: mismoHost ? { Authorization: `Bearer ${op.token}` } : {},
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
        })
        if (!r.ok) return { ok: false, mensaje: `HTTP ${r.status} al descargar.` }
        return { ok: true, bytes: new Uint8Array(await r.arrayBuffer()) }
      } catch (e) {
        return { ok: false, mensaje: String((e as Error)?.message ?? e) }
      }
    },
  }
}
