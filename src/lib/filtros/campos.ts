// ============================================================
// Filtros secundarios de las listas — qué se dibuja y qué está puesto
// ============================================================
// La barra de filtros colapsa los desplegables detrás de un botón. Eso solo es
// seguro si el usuario ve SIEMPRE qué está filtrando: un filtro escondido y
// activo produce una lista corta sin explicación. Las dos reglas que sostienen
// esa promesa viven aquí, puras y probadas, en vez de dentro del JSX.

export type OpcionFiltro = {
  value: string
  label: string
  /** Cuántos casos caen en esta opción. Se muestra en el desplegable, no en el chip. */
  count?: number
}

export type CampoFiltro = {
  /** Id estable del campo — nombra el control y su etiqueta. */
  clave: string
  /** Nombre corto del campo ("Seccional"). Encabeza el chip cuando está activo. */
  etiqueta: string
  valor: string
  /** Valor de "sin filtrar" ('todas' / 'todos'). Un campo en su default no está activo. */
  porDefecto: string
  /** Texto de la opción neutra dentro del desplegable ("Todas las seccionales DIAN"). */
  etiquetaTodos: string
  opciones: OpcionFiltro[]
  onChange: (valor: string) => void
}

/**
 * Campos que vale la pena dibujar: los que tienen algo entre qué elegir.
 *
 * Un desplegable sin opciones no separa nada y solo suma alto de pantalla. Cada
 * lista decide qué cuenta como "sin opciones" (ej. negocios manda la lista vacía
 * cuando hay un solo origen distinto) y aquí se respeta esa decisión.
 */
export function camposVisibles(campos: CampoFiltro[]): CampoFiltro[] {
  return campos.filter((c) => c.opciones.length > 0)
}

/**
 * Campos que están filtrando ahora mismo, en el orden en que se declararon.
 *
 * Un campo cuyo valor quedó fuera de sus opciones (enlace viejo, opción que ya no
 * existe en los datos) SIGUE contando como activo: está recortando la lista de
 * verdad, y esconderlo dejaría al usuario sin la X para quitarlo.
 */
export function camposActivos(campos: CampoFiltro[]): CampoFiltro[] {
  return camposVisibles(campos).filter((c) => c.valor !== c.porDefecto)
}

/** Etiqueta del valor elegido para el chip. Si la opción ya no existe, el valor crudo. */
export function etiquetaValor(campo: CampoFiltro): string {
  return campo.opciones.find((o) => o.value === campo.valor)?.label ?? campo.valor
}
