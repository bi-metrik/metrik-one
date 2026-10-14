/**
 * Configuración de la facturación electrónica automática con Aliaddo (Muisca / Nitro). Pura: lee
 * de un objeto de entorno que se le pasa, para probarla sin tocar `process.env`.
 *
 * APAGADA por defecto. Sin `FACTURACION_ELECTRONICA_HABILITADA=1` nada se encola, nada se envía y
 * el cron no hace nada: un pago se registra igual que hoy.
 *
 * Las llaves y el modo van en variables de entorno (las carga Mauricio en Vercel; los agentes no
 * tocan Vercel). La numeración (prefijo, siguiente consecutivo, tope) NO va aquí: vive en la tabla
 * `facturacion_numeracion`, porque se consume de a uno y tiene que ser atómica.
 *
 * Guardas de entorno, como las de ePayco:
 *   · `Production` (documentos con efecto legal) solo corre en el despliegue de producción de
 *     Vercel. Los previews usan la base de PRODUCCIÓN: un preview en `Production` emitiría facturas
 *     reales desde una rama.
 *   · El despliegue de producción solo corre en `Production`. En `Test` o `Habilitation`, cada pago
 *     real recibiría un documento sin efecto legal y el cliente se quedaría sin factura.
 *
 * Doc del modo: https://doc.muisca.io/modos-de-ambiente-de-facturaci%C3%B3n-2370912m0.md
 * Doc del testSetId: https://doc.muisca.io/id-set-de-pruebas-dian-2370910m0.md
 */

export type ModoMuisca = 'Test' | 'Habilitation' | 'Production'

const MODOS_MUISCA: readonly ModoMuisca[] = ['Test', 'Habilitation', 'Production']

/** Los nombres de las variables. Un solo lugar, para el reporte y para `.env.local.example`. */
export const ENV_FACTURACION = {
  /** '1' enciende todo. Cualquier otro valor (o ausente) = apagado. */
  habilitada: 'FACTURACION_ELECTRONICA_HABILITADA',
  /** Token Bearer de la organización en Nitro (Integración → Ver tokens). Secreto. */
  token: 'ALIADDO_TOKEN',
  /** `Test`, `Habilitation` o `Production`, con esas mayúsculas. Sin valor por defecto. */
  modo: 'ALIADDO_MODO',
  /** Base de la API. Por defecto la que publica la doc: https://api.muisca.io */
  apiUrl: 'ALIADDO_API_URL',
  /** UUID del set de pruebas que asigna la DIAN. Obligatorio en `Habilitation`. */
  testSetId: 'ALIADDO_TEST_SET_ID',
  /**
   * Base para descargar el PDF y el XML. La consulta devuelve `UrlPdf` como ruta RELATIVA
   * («1394/transactions/2026/2/invoices/fv….pdf») y la doc no dice contra qué servidor: hay que
   * pedírselo a Aliaddo. Sin esta variable la factura se emite igual y los archivos quedan pendientes.
   */
  archivosUrl: 'ALIADDO_ARCHIVOS_URL',
  /** El espacio de ONE que factura (hoy `metrik`). Un cobro de otro espacio no se factura aquí. */
  emisorWorkspaceId: 'ALIADDO_EMISOR_WORKSPACE_ID',
  /**
   * 'YYYY-MM-DD'. El barrido del cron solo encola cobros PAGADOS desde ese día. Sin ella el barrido
   * no corre (solo se factura lo que entra por el webhook), para que encender no facture pagos viejos
   * que ya se facturaron a mano en el facturador gratuito de la DIAN.
   */
  desde: 'FACTURACION_ELECTRONICA_DESDE',
} as const

const API_URL_POR_DEFECTO = 'https://api.muisca.io'

export interface ConfigFacturacion {
  token: string
  modo: ModoMuisca
  apiUrl: string
  testSetId: string | null
  archivosUrl: string | null
  emisorWorkspaceId: string
  desde: string | null
}

export type LecturaConfig =
  | { ok: true; config: ConfigFacturacion }
  | { ok: false; motivo: 'apagada' | 'incompleta' | 'modo_no_permitido'; detalle: string }

type Entorno = Record<string, string | undefined>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA = /^\d{4}-\d{2}-\d{2}$/

const limpio = (v: string | undefined) => {
  const t = v?.trim()
  return t ? t : null
}

/** ¿Está encendida? Barato: no valida nada más. Sirve para salir temprano en el webhook. */
export function facturacionEncendida(env: Entorno): boolean {
  return limpio(env[ENV_FACTURACION.habilitada]) === '1'
}

export function leerConfigFacturacion(env: Entorno): LecturaConfig {
  if (!facturacionEncendida(env)) {
    return { ok: false, motivo: 'apagada', detalle: `${ENV_FACTURACION.habilitada} no es 1.` }
  }
  const faltan: string[] = []
  const token = limpio(env[ENV_FACTURACION.token])
  if (!token) faltan.push(ENV_FACTURACION.token)
  const modoCrudo = limpio(env[ENV_FACTURACION.modo])
  const modo = MODOS_MUISCA.includes(modoCrudo as ModoMuisca) ? (modoCrudo as ModoMuisca) : null
  if (!modo) faltan.push(`${ENV_FACTURACION.modo} (Test | Habilitation | Production)`)
  const emisor = limpio(env[ENV_FACTURACION.emisorWorkspaceId])
  if (!emisor || !UUID.test(emisor)) faltan.push(`${ENV_FACTURACION.emisorWorkspaceId} (uuid)`)
  const testSetId = limpio(env[ENV_FACTURACION.testSetId])
  if (modo === 'Habilitation' && (!testSetId || !UUID.test(testSetId))) {
    faltan.push(`${ENV_FACTURACION.testSetId} (uuid, obligatorio en Habilitation)`)
  }
  const desde = limpio(env[ENV_FACTURACION.desde])
  if (desde && !FECHA.test(desde)) faltan.push(`${ENV_FACTURACION.desde} (YYYY-MM-DD)`)
  if (faltan.length > 0 || !token || !modo || !emisor) {
    return { ok: false, motivo: 'incompleta', detalle: `Falta o no sirve: ${faltan.join(', ')}.` }
  }

  const enProduccion = env.VERCEL_ENV === 'production'
  if (modo === 'Production' && !enProduccion) {
    return {
      ok: false,
      motivo: 'modo_no_permitido',
      detalle: 'Production solo corre en el despliegue de producción: un preview usa la base real y emitiría facturas reales.',
    }
  }
  if (enProduccion && modo !== 'Production') {
    return {
      ok: false,
      motivo: 'modo_no_permitido',
      detalle: `El despliegue de producción no emite en ${modo}: los pagos reales quedarían con documentos sin efecto legal.`,
    }
  }

  return {
    ok: true,
    config: {
      token,
      modo,
      apiUrl: (limpio(env[ENV_FACTURACION.apiUrl]) ?? API_URL_POR_DEFECTO).replace(/\/+$/, ''),
      testSetId: modo === 'Habilitation' ? testSetId : null,
      archivosUrl: limpio(env[ENV_FACTURACION.archivosUrl])?.replace(/\/+$/, '') ?? null,
      emisorWorkspaceId: emisor,
      desde,
    },
  }
}
