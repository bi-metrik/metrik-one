/**
 * La política de contenido (CSP) de `/valida/empezar`, la única página de ONE donde se escribe una
 * tarjeta (PCI SAQ A-EP). Los datos de la tarjeta van del navegador a ePayco con ePayco.js; lo que
 * protege esta política es que NINGÚN otro script de terceros corra en la página y pueda leer los
 * campos antes. Solo se permiten jQuery (lo pide ePayco.js) y ePayco.js, cada uno por su archivo
 * exacto, y la conexión solo va a ONE, a Supabase Auth y a la API de tokenización de ePayco.
 *
 * Lo usa `next.config.ts` (por eso este archivo no importa nada con `@/`) y el componente
 * `tarjeta-epayco.tsx`, para que las direcciones del script y las de la política no se separen.
 *
 * ⚠️ `script-src` lleva `'unsafe-inline'`: el layout raíz pinta en línea el aviso de conexión
 * (`lib/red/aviso-conexion.ts`) y el script del tema (next-themes), y Next pinta en línea los datos
 * de la página. Con un nonce o un hash, el navegador ignoraría `'unsafe-inline'` y esos scripts sin
 * nonce dejarían de correr; darles el nonce obliga a leer los encabezados en el layout raíz, lo que
 * vuelve dinámica toda la aplicación. Lo que sí queda cerrado es la carga de scripts de OTROS
 * orígenes, que es por donde entra el robo de tarjetas en una página como esta.
 */

/** jQuery 3.7.1 oficial (ePayco.js usa `$.ajax`). */
export const SCRIPT_JQUERY = 'https://code.jquery.com/jquery-3.7.1.min.js'
/** Integridad publicada por jQuery para ese archivo (https://releases.jquery.com/jquery/). */
export const INTEGRIDAD_JQUERY = 'sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo='
/** ePayco.js, de la documentación de tokenización (https://docs.epayco.com/docs/tokenizacion-de-clientes). */
export const SCRIPT_EPAYCO = 'https://checkout.epayco.co/epayco.min.js'
/** Adonde ePayco.js manda la tarjeta (`token/encrypt` y `token/tokenize`, leído del propio script). */
export const API_EPAYCO = 'https://api.secure.payco.co'

/** La ruta que lleva la política. */
export const RUTA_REGISTRO_VALIDA = '/valida/empezar'

/**
 * La página del espacio donde un CDA registra la tarjeta del pago automático (Términos v1.5, 2.4). Lleva
 * la MISMA política, con lo que pinta el armazón del espacio: el logo del espacio (Supabase Storage) y la
 * sesión en vivo de Supabase (websocket).
 */
export const RUTA_TARJETA_CDA = '/suscripcion/tarjeta'

function origen(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Arma el encabezado. `supabaseUrl` es `NEXT_PUBLIC_SUPABASE_URL` (el registro pide y verifica el
 * código del correo desde el navegador). En desarrollo, Next necesita `eval` y el websocket de la
 * recarga en caliente.
 */
export function politicaRegistroValida(supabaseUrl: string | undefined, desarrollo = false, espacio = false): string {
  const supabase = origen(supabaseUrl)
  const script = ["'self'", "'unsafe-inline'", SCRIPT_JQUERY, SCRIPT_EPAYCO]
  if (desarrollo) script.push("'unsafe-eval'")
  const conexion = ["'self'", API_EPAYCO]
  if (supabase) conexion.push(supabase)
  if (espacio && supabase) conexion.push(supabase.replace(/^https:/, 'wss:'))
  if (desarrollo) conexion.push('ws:')
  const imagenes = ["'self'", 'data:', 'blob:']
  if (espacio && supabase) imagenes.push(supabase)
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    `connect-src ${conexion.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imagenes.join(' ')}`,
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}
