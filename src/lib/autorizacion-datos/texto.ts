/**
 * Autorización de tratamiento de datos del cliente final, por link (decisión de Mauricio,
 * 2026-10-08; texto y reglas de Emilio en
 * `proyectos/trappvel/clarity/docs/entrega/legal/2026-10-08_autorizacion-datos-link-cliente.md`).
 *
 * Lo puro: el texto versionado, sus marcadores, las casillas, la huella de lo que se mostró y
 * los mensajes de envío. Sin red ni base, para probarlo sin nada alrededor.
 *
 * ── Dónde vive el texto ───────────────────────────────────────────────────
 *
 * En `autorizacion_datos_textos`, una fila por versión y por workspace. NO aquí. Lo único que
 * hay en este archivo es el MARCADOR: lo que se muestra mientras el workspace no ha publicado
 * su texto, y con el que nadie puede autorizar (el botón queda apagado). Una autorización sobre
 * un texto de relleno sería una prueba de nada.
 *
 * ── Quién es Responsable y quién Encargado ────────────────────────────────
 *
 * Responsable: la empresa del workspace (razón social + NIT del perfil fiscal, o `variables.
 * responsable` de la versión). Encargado: SIEMPRE de `variables.encargado` de la versión. No
 * se toma `ENCARGADO` de `compliance/vinculacion-publica.ts`: en el contrato de Trappvel el
 * Encargado es la persona natural que firmó el Anexo F, no la SAS (Emilio, riesgo R6). Si la
 * versión no lo declara, el texto queda incompleto y no se puede autorizar.
 */

// ─── Casillas ─────────────────────────────────────────────────────────────

export type ClaveCasilla = 'generales' | 'sensibles' | 'menores' | 'ofertas'

const CLAVES_CASILLA: readonly ClaveCasilla[] = ['generales', 'sensibles', 'menores', 'ofertas']

export function esClaveCasilla(v: unknown): v is ClaveCasilla {
  return typeof v === 'string' && (CLAVES_CASILLA as readonly string[]).includes(v)
}

export const NOMBRE_CASILLA: Record<ClaveCasilla, string> = {
  generales: 'Datos generales',
  sensibles: 'Datos sensibles',
  menores: 'Menores de edad',
  ofertas: 'Ofertas',
}

export type Casilla = { clave: ClaveCasilla; texto: string }

/** Lo que el titular marcó. `null` = la casilla no se le mostró. */
export type CasillasMarcadas = Partial<Record<ClaveCasilla, boolean | null>>

// ─── Medio por el que llegó el enlace ──────────────────────────────────────

export type Medio = 'correo' | 'whatsapp_reenviado' | 'otro'

/**
 * Por dónde llegó una autorización que se registra CON EVIDENCIA (vía «recibida por otro medio», Emilio 4.4): papel
 * firmado en la oficina, o el cliente respondiendo por correo o WhatsApp a un mensaje que traía el texto o el link.
 */
export type MedioEvidencia = 'papel' | 'correo' | 'whatsapp'

export const MEDIOS_EVIDENCIA: Record<MedioEvidencia, string> = {
  papel: 'Documento firmado en papel',
  correo: 'Respuesta del cliente por correo',
  whatsapp: 'Respuesta del cliente por WhatsApp',
}

export function esMedioEvidencia(v: unknown): v is MedioEvidencia {
  return v === 'papel' || v === 'correo' || v === 'whatsapp'
}

/**
 * La fecha en que el CLIENTE autorizó (no la de hoy): `AAAA-MM-DD`, no futura, desde 2026. Pura.
 */
export function fechaDeEvidenciaValida(v: unknown, hoyIso: string): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '2026-01-01' && v <= hoyIso
}

/** El parámetro corto de la URL (`?m=c`): el correo y el mensaje del bot llevan el suyo. */
export const PARAM_MEDIO: Record<Medio, string> = { correo: 'c', whatsapp_reenviado: 'w', otro: 'o' }

export function medioDesdeParam(v: unknown): Medio {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (s === 'c') return 'correo'
  if (s === 'w') return 'whatsapp_reenviado'
  return 'otro'
}

// ─── Configuración del workspace ───────────────────────────────────────────

/**
 * `workspaces.config_extra.autorizacion_datos`. Todo apagado por defecto: sin la llave, el
 * workspace no manda correos solos ni muestra la casilla de ofertas.
 */
export interface ConfigAutorizacion {
  /** Manda el correo con el link al crear un viaje (si el contacto tiene correo y no autorizó). */
  correoAlCrear: boolean
  /** Muestra la casilla de ofertas (si la versión la trae). */
  ofertas: boolean
  /** Vía «autorización recibida por otro medio», con evidencia obligatoria. */
  registroConEvidencia: boolean
  /** Días que el link sirve para autorizar. */
  diasEnlace: number
  /** El correo automático no se repite al mismo contacto antes de estos días. */
  diasReenvioCorreo: number
  /** A dónde responde el cliente el correo (el de la agencia, no uno de MéTRIK). */
  responderA: string | null
}

export const CONFIG_POR_DEFECTO: ConfigAutorizacion = {
  correoAlCrear: false,
  ofertas: false,
  registroConEvidencia: false,
  diasEnlace: 60,
  diasReenvioCorreo: 7,
  responderA: null,
}

function entero(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : def
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function leerConfigAutorizacion(configExtra: unknown): ConfigAutorizacion {
  const raw = (configExtra as { autorizacion_datos?: unknown } | null)?.autorizacion_datos
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return CONFIG_POR_DEFECTO
  const c = raw as Record<string, unknown>
  const responder = typeof c.responder_a === 'string' ? c.responder_a.trim() : ''
  return {
    // Solo `true` literal enciende: un «"true"» de texto es un error de carga, no una decisión.
    correoAlCrear: c.correo_al_crear === true,
    ofertas: c.ofertas === true,
    registroConEvidencia: c.registro_con_evidencia === true,
    diasEnlace: entero(c.dias_enlace, CONFIG_POR_DEFECTO.diasEnlace, 2, 365),
    diasReenvioCorreo: entero(c.dias_reenvio_correo, CONFIG_POR_DEFECTO.diasReenvioCorreo, 1, 90),
    responderA: CORREO.test(responder) ? responder : null,
  }
}

// ─── El texto versionado ───────────────────────────────────────────────────

export interface MensajesEnvio {
  correoAsunto: string
  correoCuerpo: string
  whatsapp: string
  instruccionComercial: string
}

/**
 * Los de la pieza 3 de Emilio. La versión los puede reemplazar (`mensajes`); lo que no traiga
 * sale de aquí. No tienen consecuencia legal propia: el texto que se autoriza es el de la página.
 */
export const MENSAJES_POR_DEFECTO: MensajesEnvio = {
  correoAsunto: '[AGENCIA]: autorice el uso de sus datos para preparar su viaje',
  correoCuerpo: [
    'Hola, [NOMBRE_CLIENTE]:',
    'Gracias por escribirnos. Para preparar su cotización necesitamos su autorización para usar sus datos personales. Toma un minuto:',
    '[LINK]',
    'Ahí verá qué datos usamos, para qué y cómo ejercer sus derechos. Si tiene dudas, responda este correo o hable con su asesor.',
    'Equipo de [AGENCIA]',
  ].join('\n\n'),
  whatsapp: [
    'Hola [NOMBRE_CLIENTE], soy [NOMBRE_COMERCIAL] de [AGENCIA].',
    'Para preparar su cotización necesitamos que autorice el uso de sus datos en este enlace (1 minuto): [LINK]',
    'Cualquier duda me escribe por aquí.',
  ].join('\n'),
  instruccionComercial:
    'Mándale esto a [NOMBRE_CLIENTE] en tu primera respuesta, antes de pedirle más datos. Mientras no autorice, el viaje no pasa a Cotización.',
}

export interface TextoAutorizacion {
  /** null solo en el marcador. */
  id: string | null
  version: string
  mayor: number
  menor: number
  titulo: string
  cuerpoMd: string
  detalleMd: string | null
  casillas: Casilla[]
  variables: Record<string, string>
  mensajes: MensajesEnvio
  plantillaSha256: string | null
  esMarcador: boolean
}

/**
 * Lo que se ve mientras el workspace no publica su texto. Dice que es un marcador en el título y
 * en el cuerpo, y no se puede autorizar con él (`puedeAutorizar`).
 */
export const TEXTO_MARCADOR: TextoAutorizacion = {
  id: null,
  version: 'marcador-sin-publicar',
  mayor: 0,
  menor: 0,
  titulo: '[TEXTO MARCADOR] Autorización para el uso de sus datos',
  cuerpoMd: [
    '**Este texto es un marcador.** [AGENCIA] todavía no ha publicado el texto de su autorización de datos, así que este enlace no se puede firmar.',
    'Cuando se publique, aquí aparecerá quién es responsable de sus datos ([RESPONSABLE]), quién los maneja por su encargo, qué datos se usan, para qué, y cómo ejercer sus derechos.',
  ].join('\n\n'),
  detalleMd: null,
  casillas: [{ clave: 'generales', texto: '[TEXTO MARCADOR] Casilla de datos generales.' }],
  variables: {},
  mensajes: MENSAJES_POR_DEFECTO,
  plantillaSha256: null,
  esMarcador: true,
}

function textoNoVacio(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** De la fila de `autorizacion_datos_textos` al texto. `null` si la fila no tiene forma. */
export function filaATexto(fila: Record<string, unknown> | null | undefined): TextoAutorizacion | null {
  if (!fila) return null
  const id = textoNoVacio(fila.id)
  const version = textoNoVacio(fila.version)
  const titulo = textoNoVacio(fila.titulo)
  const cuerpoMd = textoNoVacio(fila.cuerpo_md)
  const mayor = Number(fila.mayor)
  const menor = Number(fila.menor)
  if (!id || !version || !titulo || !cuerpoMd || !Number.isInteger(mayor) || !Number.isInteger(menor)) return null

  const casillas: Casilla[] = []
  for (const c of Array.isArray(fila.casillas) ? fila.casillas : []) {
    const clave = (c as { clave?: unknown })?.clave
    const texto = textoNoVacio((c as { texto?: unknown })?.texto)
    if (esClaveCasilla(clave) && texto && !casillas.some(x => x.clave === clave)) casillas.push({ clave, texto })
  }
  if (!casillas.some(c => c.clave === 'generales')) return null

  const variables: Record<string, string> = {}
  const rawVar = fila.variables
  if (rawVar && typeof rawVar === 'object' && !Array.isArray(rawVar)) {
    for (const [k, v] of Object.entries(rawVar)) if (typeof v === 'string' && v.trim()) variables[k] = v.trim()
  }
  const rawMsg = (fila.mensajes && typeof fila.mensajes === 'object' ? fila.mensajes : {}) as Record<string, unknown>
  const mensajes: MensajesEnvio = {
    correoAsunto: textoNoVacio(rawMsg.correo_asunto) ?? MENSAJES_POR_DEFECTO.correoAsunto,
    correoCuerpo: textoNoVacio(rawMsg.correo_cuerpo) ?? MENSAJES_POR_DEFECTO.correoCuerpo,
    whatsapp: textoNoVacio(rawMsg.whatsapp) ?? MENSAJES_POR_DEFECTO.whatsapp,
    instruccionComercial: textoNoVacio(rawMsg.instruccion_comercial) ?? MENSAJES_POR_DEFECTO.instruccionComercial,
  }

  return {
    id,
    version,
    mayor,
    menor,
    titulo,
    cuerpoMd,
    detalleMd: textoNoVacio(fila.detalle_md),
    casillas,
    variables,
    mensajes,
    plantillaSha256: textoNoVacio(fila.plantilla_sha256),
    esMarcador: false,
  }
}

/** Las casillas que se muestran, en el orden de la versión. Ofertas, solo si el workspace la activa. */
export function casillasVisibles(texto: TextoAutorizacion, config: Pick<ConfigAutorizacion, 'ofertas'>): Casilla[] {
  return texto.casillas.filter(c => c.clave !== 'ofertas' || config.ofertas)
}

// ─── Marcadores ────────────────────────────────────────────────────────────

export interface Marcadores {
  nombreCliente: string
  agencia: string
  responsable: string | null
  encargado: string | null
  canalDatos: string | null
  urlDetalle: string | null
  version: string
  link?: string | null
  nombreComercial?: string | null
}

/**
 * Los valores de los marcadores. El Responsable es «razón social, NIT …» (pieza 1, tabla de
 * plantillas); la versión lo puede fijar en `variables.responsable`.
 */
export function marcadoresDe(
  texto: TextoAutorizacion,
  marca: { nombreComercial: string | null; razonSocial: string | null; nit: string | null; nombre: string },
  extra: { nombreCliente: string; urlDetalle?: string | null; link?: string | null; nombreComercial?: string | null },
): Marcadores {
  const agencia = texto.variables.agencia ?? marca.nombreComercial ?? marca.nombre
  const responsableFiscal = marca.razonSocial
    ? `${marca.razonSocial}${marca.nit ? `, NIT ${marca.nit}` : ''}`
    : null
  return {
    nombreCliente: nombrePropio(extra.nombreCliente),
    agencia,
    responsable: texto.variables.responsable ?? responsableFiscal,
    encargado: texto.variables.encargado ?? null,
    canalDatos: texto.variables.canal_datos ?? null,
    urlDetalle: extra.urlDetalle ?? null,
    version: texto.version,
    link: extra.link ?? null,
    nombreComercial: extra.nombreComercial ?? null,
  }
}

/** «MAURICIO MORENO» → «Mauricio Moreno». El directorio guarda en mayúscula. */
export function nombrePropio(s: string): string {
  return s.trim().toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
}

const TABLA_MARCADORES: Array<[string, keyof Marcadores]> = [
  ['NOMBRE_CLIENTE', 'nombreCliente'],
  ['AGENCIA', 'agencia'],
  ['RESPONSABLE', 'responsable'],
  ['ENCARGADO', 'encargado'],
  ['CANAL_DATOS', 'canalDatos'],
  ['URL_DETALLE', 'urlDetalle'],
  ['VERSION', 'version'],
  ['LINK', 'link'],
  ['NOMBRE_COMERCIAL', 'nombreComercial'],
]

/** Llena los marcadores que tienen valor. Los que no, quedan escritos: `faltantes` los ve. */
export function llenar(plantilla: string, m: Marcadores): string {
  let s = plantilla
  for (const [marca, campo] of TABLA_MARCADORES) {
    const v = m[campo]
    if (typeof v === 'string' && v.trim()) s = s.split(`[${marca}]`).join(v.trim())
  }
  return s
}

/**
 * Lo que impide autorizar: un marcador sin llenar o un dato pendiente de Emilio (`⟦…⟧`). Un texto
 * con «[ENCARGADO]» literal nombra a nadie, y con eso la autorización es defectuosa.
 */
export function faltantes(textoLleno: string): string[] {
  const out = new Set<string>()
  for (const [marca] of TABLA_MARCADORES) if (textoLleno.includes(`[${marca}]`)) out.add(marca)
  for (const m of textoLleno.matchAll(/⟦([^⟧]{1,120})⟧/g)) out.add(m[1].trim())
  return [...out]
}

// ─── Lo que se muestra y su huella ─────────────────────────────────────────

/**
 * El texto visible, en un solo string canónico: título, cuerpo, casillas visibles y la línea de
 * versión. Es lo que entra al sha256 de la aceptación (Emilio, regla 4: «todo el texto visible,
 * incluidas las casillas»). El detalle completo se cita por la versión y su `plantilla_sha256`.
 */
export function textoVisible(texto: TextoAutorizacion, m: Marcadores, casillas: Casilla[]): string {
  return [
    llenar(texto.titulo, m),
    llenar(texto.cuerpoMd, m),
    ...casillas.map(c => `[ ] ${llenar(c.texto, m)}`),
    `Versión ${texto.version}`,
  ].map(s => s.replace(/\r\n/g, '\n').trim()).join('\n\n')
}

export type MotivoNoAutorizable = 'marcador' | 'incompleto'

/** ¿Se puede autorizar con este texto? */
export function puedeAutorizar(texto: TextoAutorizacion, m: Marcadores, casillas: Casilla[]): { ok: true } | { ok: false; motivo: MotivoNoAutorizable; faltan: string[] } {
  if (texto.esMarcador || !texto.id) return { ok: false, motivo: 'marcador', faltan: [] }
  // El detalle completo también cuenta: es parte de lo que se autoriza (pieza 1b).
  const faltan = faltantes([textoVisible(texto, m, casillas), texto.detalleMd ? llenar(texto.detalleMd, m) : ''].join('\n\n'))
  return faltan.length ? { ok: false, motivo: 'incompleto', faltan } : { ok: true }
}

/**
 * Lo que marcó el titular, normalizado: cada casilla visible en true/false; las no visibles en
 * null. Una clave que no se mostró no se acepta aunque venga en el formulario.
 */
export function normalizarCasillas(enviadas: Record<string, unknown>, visibles: Casilla[]): CasillasMarcadas {
  const out: CasillasMarcadas = {}
  for (const k of CLAVES_CASILLA) out[k] = null
  for (const c of visibles) out[c.clave] = enviadas[c.clave] === true || enviadas[c.clave] === 'on' || enviadas[c.clave] === 'true'
  return out
}

// ─── Markdown mínimo ───────────────────────────────────────────────────────

export type Segmento = { texto: string; negrita: boolean }
export type BloqueMd =
  | { tipo: 'titulo'; segmentos: Segmento[] }
  | { tipo: 'parrafo'; segmentos: Segmento[] }
  | { tipo: 'lista'; items: Segmento[][] }
  | { tipo: 'nota'; segmentos: Segmento[] }

function segmentos(linea: string): Segmento[] {
  const out: Segmento[] = []
  const partes = linea.split('**')
  partes.forEach((p, i) => { if (p) out.push({ texto: p, negrita: i % 2 === 1 }) })
  return out
}

/**
 * Párrafos, `## títulos`, listas con `- ` y `<small>…</small>`. Nada de HTML: el texto lo carga la
 * sesión principal por SQL y no debe poder inyectar marcado en una página pública.
 */
export function bloquesMd(md: string): BloqueMd[] {
  const out: BloqueMd[] = []
  for (const bruto of md.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lineas = bruto.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lineas.length) continue
    if (lineas.every(l => /^[-*] /.test(l))) {
      out.push({ tipo: 'lista', items: lineas.map(l => segmentos(l.replace(/^[-*] /, ''))) })
      continue
    }
    const unido = lineas.join(' ')
    const titulo = /^#{1,3} (.+)$/.exec(unido)
    if (titulo) { out.push({ tipo: 'titulo', segmentos: segmentos(titulo[1]) }); continue }
    const nota = /^<small>(.*)<\/small>$/.exec(unido)
    if (nota) { out.push({ tipo: 'nota', segmentos: segmentos(nota[1]) }); continue }
    out.push({ tipo: 'parrafo', segmentos: segmentos(unido.replace(/<[^>]*>/g, '')) })
  }
  return out
}

// ─── URL ───────────────────────────────────────────────────────────────────

export const TOKEN_FORMA = /^[A-Za-z0-9_-]{32,64}$/

export function urlAutorizacion(slug: string, baseDomain: string, token: string, medio?: Medio): string {
  const base = baseDomain.trim().replace(/\/+$/, '')
  const esLocal = base.startsWith('localhost')
  const host = esLocal ? base : `${slug}.${base}`
  const m = medio ? `?m=${PARAM_MEDIO[medio]}` : ''
  return `${esLocal ? 'http' : 'https'}://${host}/autorizacion/${token}${m}`
}
