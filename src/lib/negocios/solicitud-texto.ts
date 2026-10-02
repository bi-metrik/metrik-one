/**
 * La solicitud de viaje sin formulario: lo que la pantalla y las server actions comparten.
 *
 * El motor vive en Deno (`supabase/functions/_shared/solicitud-texto.ts`) y `tsconfig.json`
 * excluye `supabase/functions`: estos tipos son el contrato de la función `solicitud-texto`
 * escrito del lado de la web. Si cambia uno, cambia el otro (lo cuida
 * `solicitud-texto-contrato.test.ts`, que lee las dos fuentes).
 *
 * Diseño: `proyectos/trappvel/clarity/docs/diseno/noor-solicitud-sin-formulario-2026-10-02.md`.
 */

export type QuienEscribio = 'cliente' | 'notas'

export type GrupoFila = 'nuevo' | 'choca' | 'ya_estaba'

export interface FilaResumen {
  slug: string
  label: string
  legible: string
  frase: string
  grupo: GrupoFila
  actual?: string
}

export interface PreguntaGuardian {
  slug: string
  texto: string
}

export interface ContactoWeb {
  id: string
  nombre: string | null
  telefono: string | null
  viajes: Array<{ id: string; nombre: string }>
}

export type ContactoDecision =
  | { tipo: 'unico'; contacto: ContactoWeb }
  | { tipo: 'varios'; opciones: ContactoWeb[]; nombre: string }
  | { tipo: 'ninguno'; nombre: string; telefono: string | null }

export type AvisoEntender =
  | { tipo: 'sin_solicitud'; texto: string }
  | { tipo: 'dos_viajes'; texto: string }
  | { tipo: 'cruce'; texto: string }
  | { tipo: 'nada_nuevo'; texto: string }

export type RespuestaEntender =
  | { ok: false; error: string; mensaje: string }
  | {
    ok: true
    entendimientoId: string
    aviso: AvisoEntender | null
    resumen: string
    filas: FilaResumen[]
    preguntas: PreguntaGuardian[]
    negocio: { id: string; nombre: string } | null
    contacto: ContactoDecision | null
  }

export type ContactoElegido =
  | { tipo: 'existente'; id: string }
  | { tipo: 'nuevo'; nombre: string; telefono?: string | null }

export type NegocioElegido = { tipo: 'existente'; id: string } | { tipo: 'nuevo' }

export type RespuestaCargar =
  | { ok: false; error: string; mensaje: string }
  | { ok: true; negocioId: string; cargados: number; faltanMinimo: number; mensaje: string }

/** Los textos de la pantalla que no salen del motor (Noor, §2). */
export const TEXTOS = {
  rotulo: 'Pega o escribe lo que te contó el cliente',
  placeholder: 'Un correo, un chat o tus notas de la llamada. Ej.: Lucía, Lisboa en marzo, 10 días, ella y el papá de 72.',
  quien: '¿Quién lo escribió?',
  elCliente: 'El cliente',
  misNotas: 'Son mis notas',
  ayuda: 'Tus comentarios sobre el cliente no se guardan.',
  entender: 'Entender',
  leyendo: 'Leyendo…',
  hayAlgoNuevo: '¿Hay algo nuevo? Pégalo aquí',
  nuevaSolicitud: 'Nueva solicitud',
  corregirTexto: 'Corregir el texto',
  descartar: 'Descartar',
  reintentar: 'Reintentar',
  esUnViaje: 'Es un viaje, cárgalo igual',
  cargarAquiIgual: 'Cargar aquí igual',
  listaParaCotizar: 'Lista para cotizar.',
  pasarACotizacion: 'Pasar a cotización',
  loQueDijo: 'Lo que dijo el cliente',
  noEsElla: 'No es ella',
  esOtroCliente: 'Es otro cliente',
  clienteNuevo: 'Cliente nuevo',
  eseViaje: 'Ese viaje',
  unoNuevo: 'Uno nuevo',
  crearYCargar: 'Crear el viaje y cargar',
  errorModelo: 'No pude leerlo ahora. Tu texto sigue aquí: inténtalo otra vez.',
} as const

/** «Cargar 4 datos» / «Cargar 1 dato». */
export function textoBotonCargar(n: number): string {
  return n === 1 ? 'Cargar 1 dato' : `Cargar ${n} datos`
}

/** «Para cotizar falta: 3». */
export function textoFaltan(n: number): string {
  return `Para cotizar falta: ${n}`
}

/** «Confirmar los 5 sugeridos». */
export function textoConfirmarTodos(n: number): string {
  return `Confirmar los ${n} sugeridos`
}

/** «Para la cotización final: 4 de 9 · Ver». */
export function textoDeseable(completos: number, total: number): string {
  return `Para la cotización final: ${completos} de ${total}`
}

/** «Más datos (7)». */
export function textoMasDatos(n: number): string {
  return `Más datos (${n})`
}

/** «Lucía tiene abierto LISBOA MAR. ¿Es ese viaje o uno nuevo?». */
export function textoViajeAbierto(nombreCliente: string, viaje: string): string {
  return `${nombreCliente} tiene abierto ${viaje}. ¿Es ese viaje o uno nuevo?`
}

/** «Cliente: Lucía Prado (ya está en ONE)». */
export function textoClienteUnico(nombre: string): string {
  return `Cliente: ${nombre} (ya está en ONE)`
}

/** El primer nombre en tipo oración («LUCÍA PRADO» → «Lucía»). */
export function primerNombre(nombre: string | null | undefined): string {
  const p = String(nombre ?? '').trim().split(/\s+/)[0] ?? ''
  return p ? p.charAt(0).toLocaleUpperCase('es-CO') + p.slice(1).toLocaleLowerCase('es-CO') : ''
}

/** Un nombre del directorio en tipo título («LUCÍA PRADO» → «Lucía Prado»). */
export function nombrePropio(nombre: string | null | undefined): string {
  return String(nombre ?? '').trim().toLocaleLowerCase('es-CO').replace(/(^|\s)(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('es-CO'))
}
