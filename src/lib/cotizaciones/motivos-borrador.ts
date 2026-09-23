/**
 * Por qué un PDF de cotización sale como BORRADOR, en UN solo sitio.
 *
 * Un PDF sale como borrador (marca de agua, sin guardarse ni registrarse) por cinco motivos:
 * pantallazos de otros pasajeros, una cotización con tarifas sin la Recomendada en la
 * propuesta (de ella sale el TOTAL, decisión del 2026-09-22), margen bajo el mínimo sin la
 * firma del dueño, una línea cuyo IVA no se puede calcular, o el IVA dentro del precio con
 * una plantilla que no lo sabe imprimir. Hasta el 2026-09-23 la marca decía siempre «margen bajo el mínimo»: los dos del
 * IVA salían con un motivo que no era el suyo.
 *
 * De aquí salen la lista de motivos, su texto llano y la línea de la marca. La usan la
 * marca de agua (`marca-borrador.ts`), el aviso del PDF (`cotizacion-pdf-actions.ts`) y los
 * avisos del editor que ya decían «sale como borrador»: si se escribiera aparte en cada
 * uno, la pantalla y el documento terminarían diciendo cosas distintas.
 *
 * ⚠️ Esto NO decide CUÁNDO un PDF es borrador: recibe las condiciones ya decididas y solo
 * las nombra. `motivosDeBorrador(c).length > 0` es exactamente el OR de todas.
 *
 * Puro y sin `pdf-lib`: lo importan componentes de cliente.
 */

export type MotivoDeBorrador =
  | 'pantallazos'
  | 'recomendada'
  | 'incompleto'
  | 'margen'
  | 'iva_sin_calcular'
  | 'iva_incluido_sin_plantilla'

/**
 * El orden en que se dicen. Primero los pantallazos: con el precio de otros pasajeros, el
 * margen y el IVA tampoco dicen nada. Después la Recomendada: sin ella el TOTAL del documento
 * es un supuesto, y eso no es un problema de margen. El primero es el «principal» cuando no
 * caben todos.
 */
export const ORDEN_DE_MOTIVOS: readonly MotivoDeBorrador[] = [
  'pantallazos',
  'recomendada',
  'incompleto',
  'margen',
  'iva_sin_calcular',
  'iva_incluido_sin_plantilla',
]

const ETIQUETAS: Record<MotivoDeBorrador, string> = {
  pantallazos: 'pantallazos por actualizar',
  recomendada: 'falta la tarifa Recomendada',
  incompleto: 'borrador incompleto: falta un costo',
  margen: 'margen bajo el mínimo',
  iva_sin_calcular: 'IVA sin calcular',
  iva_incluido_sin_plantilla: 'IVA incluido sin plantilla',
}

/** El motivo en texto llano, tal como lo imprime la marca. */
export function etiquetaDeMotivo(motivo: MotivoDeBorrador): string {
  return ETIQUETAS[motivo]
}

export interface CondicionesDeBorrador {
  pantallazos: boolean
  /** Con tarifas: no hay una sola Recomendada marcada «va en propuesta» (`motivoSinRecomendada`). */
  sinRecomendada: boolean
  /**
   * Una línea sin costo ni precio entra al total que sale (`falta-costo.ts`): el cliente
   * recibiría un precio sin ese servicio. Opcional: ausente = no aplica.
   */
  faltaCosto?: boolean
  margen: boolean
  ivaSinCalcular: boolean
  ivaIncluidoSinPlantilla: boolean
}

/** Los motivos que aplican, en `ORDEN_DE_MOTIVOS`. Vacío = el PDF no es borrador. */
export function motivosDeBorrador(c: CondicionesDeBorrador): MotivoDeBorrador[] {
  const aplica: Record<MotivoDeBorrador, boolean> = {
    pantallazos: c.pantallazos,
    recomendada: c.sinRecomendada,
    incompleto: c.faltaCosto === true,
    margen: c.margen,
    iva_sin_calcular: c.ivaSinCalcular,
    iva_incluido_sin_plantilla: c.ivaIncluidoSinPlantilla,
  }
  return ORDEN_DE_MOTIVOS.filter(m => aplica[m])
}

/**
 * Hasta cuántos motivos se escriben enteros en la marca. Con más, el principal y «y N más»:
 * todos juntos pasan de cien caracteres y a lo ancho de una página no se leen. El
 * aviso de la pantalla los dice todos.
 */
export const MOTIVOS_ENTEROS_EN_LA_MARCA = 2

/** La segunda línea de la marca: los motivos y «no enviar». */
export function lineaDeMotivos(motivos: readonly MotivoDeBorrador[]): string {
  if (motivos.length === 0) throw new Error('Un borrador necesita al menos un motivo')
  const cuerpo = motivos.length <= MOTIVOS_ENTEROS_EN_LA_MARCA
    ? motivos.map(etiquetaDeMotivo).join(' · ')
    : `${etiquetaDeMotivo(motivos[0])} y ${motivos.length - 1} más`
  return `${cuerpo} · no enviar`
}

/** El texto completo de la marca, en una línea (también el título del PDF). */
export function textoDeMarca(motivos: readonly MotivoDeBorrador[]): string {
  return `BORRADOR · ${lineaDeMotivos(motivos)}`
}

/**
 * El aviso de pantalla al descargar un borrador: la misma marca que lleva el documento y,
 * después, el detalle de cada motivo en el mismo orden (qué línea, qué margen, qué hacer).
 * Un motivo sin detalle se nombra solo en la marca.
 */
export function avisoDeBorrador(
  motivos: readonly MotivoDeBorrador[],
  detalle: Partial<Record<MotivoDeBorrador, string | null>>,
): string {
  const detalles = motivos.map(m => detalle[m]).filter((d): d is string => !!d)
  return [
    `PDF de borrador, con la marca «${textoDeMarca(motivos)}»: no se puede enviar.`,
    ...detalles,
  ].join(' ')
}
