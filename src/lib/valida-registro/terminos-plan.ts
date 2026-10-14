/**
 * Los Términos del plan pagado que acepta una cuenta autogestionada de Valida al activar
 * (`18-recorrido-baja-friccion.md` §2.2 paso 8, PR 6). Puro.
 *
 * ⚠️ EL TEXTO NO ESTÁ AQUÍ TODAVÍA, a propósito. Los Términos de Uso v2.0 de la variante que
 * corresponde (sin la cláusula 0.2 de AFI) son de Emilio y siguen en borrador
 * (`proyectos/metrik/valida/docs/crecimiento-mrr/08-plantillas-legales/`). Mientras el marcador siga
 * en la plantilla, `terminosPlanListos()` es false y la activación en línea NO abre, ni en preview.
 * Ingeniería no redacta texto legal.
 *
 * Cuando Mauricio apruebe el texto:
 *   1. pegarlo tal cual en `PLANTILLA`, con sus campos `{campo}`;
 *   2. llenar en `camposDeLaOrden` cada campo que use (los que el registro y el RUT no traen, como
 *      el domicilio o el representante legal, se le piden a la persona en la pantalla);
 *   3. subir `version`.
 * `llenarPlantilla` se niega a devolver un texto con un campo sin llenar: la activación no puede
 * registrar unos términos con huecos.
 *
 * Por empresa (alcance `cliente` en `documentos_contractuales_versiones`), NO como plantilla genérica
 * del módulo: un documento `plantilla` de `valida_consulta` lo verían TODOS los espacios con contrato
 * de Valida (`20260929030000_documentos_alcance_plantilla.sql`), y la entrada de los 4 CDA de hoy
 * les pediría aceptarlo para seguir consultando.
 */

export const MARCADOR_TERMINOS_PENDIENTES = /\[TEXTO (EMILIO|LUCÍA|LUCIA)\b/

export const TERMINOS_PLAN = {
  slug: 'terminos-uso-valida-autogestion',
  version: 'v2.0',
  titulo: 'Términos de Uso de VALIDA',
  plantilla:
    '[TEXTO EMILIO: Términos de Uso de VALIDA v2.0 para la cuenta autogestionada, variante sin la cláusula 0.2 de AFI. ' +
    'Campos esperados: {razon_social}, {nit}, {correo_notificaciones}, {precio_cifra}, {usuarios_incluidos}, ' +
    '{consultas_incluidas}, {fecha_orden}.]',
} as const

export function terminosPlanListos(plantilla: string = TERMINOS_PLAN.plantilla): boolean {
  return !MARCADOR_TERMINOS_PENDIENTES.test(plantilla)
}

const CAMPO = /\{([a-z_]+)\}/g

/** Los campos `{campo}` que usa una plantilla, sin repetir y en orden de aparición. */
export function camposDePlantilla(plantilla: string): string[] {
  return [...new Set([...plantilla.matchAll(CAMPO)].map((m) => m[1]))]
}

export type ResultadoLlenado = { ok: true; texto: string } | { ok: false; faltan: string[] }

/** Llena la plantilla. Si queda un solo campo sin valor, no devuelve texto: devuelve cuáles faltan. */
export function llenarPlantilla(plantilla: string, campos: Record<string, string | null | undefined>): ResultadoLlenado {
  const faltan = camposDePlantilla(plantilla).filter((c) => !campos[c] || !String(campos[c]).trim())
  if (faltan.length > 0) return { ok: false, faltan }
  return { ok: true, texto: plantilla.replace(CAMPO, (_, c: string) => String(campos[c]).trim()) }
}

const FECHA_LARGA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
const PESOS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/** NIT con puntos y DV: 900.123.456-7. */
export function nitLegible(nit: string, dv: string | null): string {
  const conPuntos = nit.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return dv ? `${conPuntos}-${dv}` : conPuntos
}

/** Los campos de la Orden que el sistema conoce al activar. */
export function camposDeLaOrden(p: {
  razonSocial: string
  nit: string
  dv: string | null
  correo: string
  precioMensual: number
  licencias: number
  limiteMes: number
  ahora: Date
}): Record<string, string> {
  return {
    razon_social: p.razonSocial,
    nit: nitLegible(p.nit, p.dv),
    correo_notificaciones: p.correo,
    precio_cifra: `$${PESOS.format(p.precioMensual)}`,
    usuarios_incluidos: String(p.licencias),
    consultas_incluidas: PESOS.format(p.limiteMes),
    fecha_orden: FECHA_LARGA.format(p.ahora),
  }
}
