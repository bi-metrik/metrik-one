/**
 * Que pestanas arma /tableros para un workspace.
 *
 * Vive aparte del componente porque la decision la toman DOS superficies: la
 * pantalla, que dibuja las pestanas, y `page.tsx`, que decide que datos pedir.
 * Escrita dos veces se desincronizan, y el sintoma seria una ronda de consultas
 * que alimenta una pestana que ya no se pinta (o al reves, una pestana vacia).
 */

export type TableroKey =
  | 'direccion'
  | 'rentabilidad_comercial'
  | 'comercial_negocios'
  | 'operaciones'
  | 'financiero'
  | 'comercial'
  | 'operativo'
  | 'cumplimiento'
  | 'calidad'

export interface PestanaTablero {
  key: TableroKey
  label: string
}

export type ModulosWorkspace = Record<string, boolean>

/**
 * Que datos llegaron del servidor. Un modulo encendido cuyo dato no llego (por
 * rol, o porque no hay nada que mostrar) NO dibuja pestana: una pestana que abre
 * en blanco se lee como un error del producto.
 */
export interface DatosTableros {
  /** Pestana Direccion: la replica del Sheet de JD. Gate propio, ver abajo. */
  direccion: boolean
  comercialNegocios: boolean
  procesoSeccional: boolean
  operacionesBono: boolean
  calidad: boolean
}

/** Las dos vistas de la pestana Operaciones. */
export type VistaOperaciones = 'casos' | 'personas'

// Va primera: es la vista con la que la direccion abre la pantalla, y de ahi baja al
// detalle de cada area en las siguientes.
const DIRECCION_TAB: PestanaTablero = { key: 'direccion', label: 'Dirección' }
const RENTABILIDAD_TAB: PestanaTablero = {
  key: 'rentabilidad_comercial',
  label: 'Rentabilidad Comercial',
}
const COMERCIAL_NEGOCIOS_TAB: PestanaTablero = { key: 'comercial_negocios', label: 'Comercial' }
// Operaciones reune las dos preguntas del area: donde estan atascados los casos
// (vista Casos) y como le fue a cada persona (vista Personas).
const OPERACIONES_TAB: PestanaTablero = { key: 'operaciones', label: 'Operaciones' }
const COMPLIANCE_TAB: PestanaTablero = { key: 'cumplimiento', label: 'Cumplimiento' }
const CALIDAD_TAB: PestanaTablero = { key: 'calidad', label: 'Recaudo y riesgo' }

/**
 * Las tres genericas. Miden el pipeline de oportunidades, los proyectos y los
 * movimientos del producto base.
 */
const GENERICAS: PestanaTablero[] = [
  { key: 'financiero', label: 'Financiero' },
  { key: 'comercial', label: 'Comercial' },
  { key: 'operativo', label: 'Operativo' },
]

/**
 * El workspace tiene tableros disenados para su operacion.
 *
 * Por que importa: las tres genericas leen `oportunidades`, `proyectos`,
 * `saldos_banco` y `fixed_expenses`, que en un workspace Clarity estan vacios o
 * miden otra cosa. Medido en SOENA: 0 filas en saldos_banco, 0 en
 * fixed_expenses, y el medidor de utilizacion de Operativo pinta 0% porque no
 * hay horas del mes, sobre los mismos 48 negocios que Operaciones ya muestra por
 * etapa. Un cero falso es peor que una pestana ausente: se lee como un dato.
 *
 * `rentabilidad_comercial` entra aqui porque ya las excluia por su cuenta (era
 * un `else if` contra `business`); nombrarlo en la misma regla no cambia a nadie
 * y deja una sola condicion en vez de dos.
 */
export function tieneTablerosPropios(mod: ModulosWorkspace): boolean {
  return Boolean(
    mod.rentabilidad_comercial ||
      mod.comercial_negocios ||
      mod.proceso_semanal ||
      mod.operaciones_bonos,
  )
}

/**
 * Vistas que ofrece la pestana Operaciones, en orden.
 *
 * Con una sola vista la pestana la muestra sin selector: un selector de un solo
 * boton promete una alternativa que no existe.
 */
export function vistasDeOperaciones(
  mod: ModulosWorkspace,
  datos: DatosTableros,
): VistaOperaciones[] {
  const vistas: VistaOperaciones[] = []
  if (mod.proceso_semanal && datos.procesoSeccional) vistas.push('casos')
  if (mod.operaciones_bonos && datos.operacionesBono) vistas.push('personas')
  return vistas
}

/**
 * Las pestanas visibles, en orden de lectura: primero cuanto se vendio, luego
 * donde esta atascado el trabajo y como le fue al equipo, y al final lo
 * transversal.
 *
 * Cada modulo propio tiene gate propio, al mismo nivel que Cumplimiento y
 * Recaudo y riesgo. Antes colgaban de `business`, que en la base tambien
 * gobierna el menu lateral, el boton flotante, Caja y Mi negocio: no se podia
 * apagar una pestana sin apagar media aplicacion.
 */
export function pestanasDeTableros(
  mod: ModulosWorkspace,
  datos: DatosTableros,
): PestanaTablero[] {
  const tabs: PestanaTablero[] = []

  if (mod.comercial_negocios && datos.direccion) tabs.push(DIRECCION_TAB)
  if (mod.rentabilidad_comercial) tabs.push(RENTABILIDAD_TAB)
  if (mod.comercial_negocios && datos.comercialNegocios) tabs.push(COMERCIAL_NEGOCIOS_TAB)
  if (vistasDeOperaciones(mod, datos).length > 0) tabs.push(OPERACIONES_TAB)
  if (mod.business && !tieneTablerosPropios(mod)) tabs.push(...GENERICAS)
  if (mod.compliance) tabs.push(COMPLIANCE_TAB)
  if (mod.calidad_llamadas && datos.calidad) tabs.push(CALIDAD_TAB)

  return tabs
}

/**
 * Si `page.tsx` debe consultar los datos de las tres genericas.
 *
 * Misma condicion que las dibuja. Sin esto se disparan tres rondas de consultas
 * cuyo resultado nadie pinta.
 */
export function necesitaDatosGenericos(mod: ModulosWorkspace): boolean {
  return Boolean(mod.business) && !tieneTablerosPropios(mod)
}
