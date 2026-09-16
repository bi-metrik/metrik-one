/**
 * Firma de las rutas de sincronización del catálogo (`/api/catalogo/*`).
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §3.2 (entrega A2).
 *
 * Mismo formato que ONE ya usa hacia Valida (`X-One-Firma: t=<unix>,v1=<hmac hex>`), para no
 * inventar un tercer dialecto de firma en la casa.
 *
 * ## Qué cubre la firma, y por qué cada parte
 *
 * `HMAC-SHA256(secreto, "<t>.<METODO>.<ruta>.<sha256 del cuerpo>")`
 *
 * - **el timestamp** dentro del mensaje: sin él se puede reusar una firma vieja para siempre.
 *   La ventana de ±300 s acota la repetición, y el receptor lo compara contra su reloj;
 * - **el método y la ruta**: una firma de `GET /api/catalogo/huellas` no sirve para
 *   `POST /api/catalogo/versiones`. Sin esto, quien captura una lectura puede escribir;
 * - **el hash del cuerpo**, no el cuerpo: el mensaje queda de largo fijo y el `GET` (sin
 *   cuerpo) usa el hash de la cadena vacía, que es un valor definido, no un hueco.
 *
 * La comparación es en tiempo constante. Un valor ausente (sin cabecera, sin secreto) **nunca
 * autoriza**: es la guarda que ya costó caro en `credencialValida` de `meta-insights-sync`,
 * donde `undefined === undefined` dejaba entrar.
 *
 * Este módulo corre en Node (rutas de API) y lo replica la Action del cerebro en 20 líneas;
 * el formato está documentado arriba para que no haya que leer código para reproducirlo.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Ventana de aceptación del timestamp, en segundos, hacia adelante y hacia atrás. */
export const VENTANA_SEGUNDOS = 300

export const CABECERA_FIRMA = 'x-one-firma'

export interface PartesFirma {
  t: number
  v1: string
}

/** Lee `t=<unix>,v1=<hex>`. Devuelve null si no calza: un formato raro no es una firma. */
export function leerCabeceraFirma(valor: string | null | undefined): PartesFirma | null {
  if (!valor) return null
  let t: number | null = null
  let v1: string | null = null
  for (const parte of valor.split(',')) {
    const [k, ...resto] = parte.trim().split('=')
    const v = resto.join('=')
    if (k === 't') {
      if (!/^\d{1,15}$/.test(v)) return null
      t = Number(v)
    } else if (k === 'v1') {
      if (!/^[0-9a-f]{64}$/i.test(v)) return null
      v1 = v.toLowerCase()
    }
  }
  if (t === null || v1 === null) return null
  return { t, v1 }
}

export interface MensajeFirmado {
  metodo: string
  ruta: string
  /** Cuerpo crudo tal como viajó. Para `GET` es la cadena vacía. */
  cuerpo: string
  t: number
}

/** El mensaje que se firma. Documentado en la cabecera; no cambiar sin cambiar la Action. */
export function mensajeAFirmar({ metodo, ruta, cuerpo, t }: MensajeFirmado): string {
  const hash = createHash('sha256').update(cuerpo, 'utf8').digest('hex')
  return `${t}.${metodo.toUpperCase()}.${ruta}.${hash}`
}

/** Arma la cabecera completa. Lo usa la Action y las pruebas; ONE solo verifica. */
export function firmar(mensaje: MensajeFirmado, secreto: string): string {
  const v1 = createHmac('sha256', secreto).update(mensajeAFirmar(mensaje), 'utf8').digest('hex')
  return `t=${mensaje.t},v1=${v1}`
}

export type ResultadoFirma =
  | { ok: true }
  | { ok: false; motivo: 'sin_secreto' | 'sin_firma' | 'fuera_de_ventana' | 'no_coincide' }

/**
 * Verifica una petición. `ahoraSegundos` entra por parámetro para poder probar los bordes de
 * la ventana sin congelar el reloj del proceso.
 */
export function verificarFirma(
  args: Omit<MensajeFirmado, 't'> & {
    cabecera: string | null | undefined
    secreto: string | undefined | null
    ahoraSegundos: number
  },
): ResultadoFirma {
  // Sin secreto configurado NADA entra. Comparar contra `undefined` dejaría pasar una firma
  // vacía en un entorno sin configurar, que es el peor momento para dejar pasar algo.
  if (!args.secreto) return { ok: false, motivo: 'sin_secreto' }

  const partes = leerCabeceraFirma(args.cabecera)
  if (!partes) return { ok: false, motivo: 'sin_firma' }

  if (Math.abs(args.ahoraSegundos - partes.t) > VENTANA_SEGUNDOS) {
    return { ok: false, motivo: 'fuera_de_ventana' }
  }

  const esperado = createHmac('sha256', args.secreto)
    .update(mensajeAFirmar({ metodo: args.metodo, ruta: args.ruta, cuerpo: args.cuerpo, t: partes.t }), 'utf8')
    .digest('hex')

  const a = Buffer.from(esperado, 'hex')
  const b = Buffer.from(partes.v1, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, motivo: 'no_coincide' }
  return { ok: true }
}

/** Huella del archivo fuente. La misma que compara la revisión de deriva de §3.2. */
export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}
