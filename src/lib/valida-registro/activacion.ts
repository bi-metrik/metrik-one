import { terminosPlanListos } from './terminos-plan'

/**
 * La llave de la activación autogestionada del plan de Valida (`18-recorrido-baja-friccion.md` §2.2,
 * PR 6) y los datos fijos del cobrador. Puro.
 *
 * APAGADA por defecto. Abre solo con las dos cosas, también en preview:
 *   1. `VALIDA_ACTIVACION_ABIERTA=1` (la enciende Mauricio en Vercel);
 *   2. los Términos del plan escritos (`terminosPlanListos()`): sin texto aprobado no hay qué aceptar,
 *      y un contrato sin términos deja `/valida` cerrado («todavía no están registrados»).
 * Con la llave apagada, `/valida/activar` explica el plan y deja escribir a MeTRIK; no crea nada.
 */
export function activacionAbierta(env: Record<string, string | undefined> = process.env, listos: boolean = terminosPlanListos()): boolean {
  return env.VALIDA_ACTIVACION_ABIERTA === '1' && listos
}

/**
 * Dónde nace la venta: el espacio `metrik` (METRIK IA S.A.S.), la línea Valida y la etapa Cobro.
 * Los mismos ids de las cargas de los CDA (`proyectos/metrik/valida/migrations/2026-09-23_cdas-directos-metrik.sql`).
 */
export const COBRADOR_VALIDA = {
  workspaceId: 'a21bfc88-1a60-48c3-afcd-144226aa2392',
  lineaValida: '7d9f8994-a843-4032-a632-a6286ec61d94',
  etapaCobro: '6a957798-acc2-48db-966e-0f0fd08cdf6c',
} as const

/**
 * La ficha del catálogo del plan. Precio único (decisión F): la misma de los CDA. Sus parámetros de
 * cobro (precio, días de trial en 0, límite del mes) los lleva el CONTRATO (`parametrosDelPlan`), así
 * que no hace falta publicar otra versión de la ficha para activar.
 */
export const FICHA_PLAN_VALIDA = 'valida-cda-licencia'

/**
 * Hasta cuándo la cuenta consulta sin haber aceptado los Términos del plan: el último día de la
 * prueba, o hoy si ya terminó. Activar no corta lo que quedaba de la prueba; después de ese día, sin
 * aceptación, `/valida` se pausa como a cualquier CDA.
 */
export function plazoTerminos(pruebaVenceEn: string | null, hoyBogota: string): string {
  if (!pruebaVenceEn || Number.isNaN(Date.parse(pruebaVenceEn))) return hoyBogota
  const dia = new Date(Date.parse(pruebaVenceEn) - 5 * 3_600_000).toISOString().slice(0, 10)
  return dia > hoyBogota ? dia : hoyBogota
}

export type ErrorActivacion =
  | 'cerrada'
  | 'sin_sesion'
  | 'no_es_autogestion'
  | 'no_es_duena'
  | 'sin_registro'
  | 'usuario_ajeno'
  | 'ficha_invalida'
  | 'documento_invalido'
  | 'parametros_invalidos'
  | 'nit_con_contrato'
  | 'terminos_incompletos'
  | 'cobro_al_terminar_prueba'
  | 'pdf'
  | 'error'

/** Lo que ve la persona por cada error. No revela si un NIT es cliente nuestro (§5). */
export function textoErrorActivacion(e: ErrorActivacion): string {
  switch (e) {
    case 'cerrada':
      return 'La activación en línea abre pronto. Escríbenos a mauricio.moreno@metrik.com.co y la hacemos contigo.'
    case 'sin_sesion':
      return 'Tu sesión terminó. Vuelve a entrar con tu correo.'
    case 'no_es_autogestion':
    case 'no_es_duena':
    case 'usuario_ajeno':
      return 'Solo la persona que abrió la prueba puede activar el plan de la empresa.'
    case 'cobro_al_terminar_prueba':
      return 'Tu plan se activa solo al terminar la prueba, con el cobro a la tarjeta que registraste. No tienes que hacer nada; si no quieres seguir, cancela la prueba antes de esa fecha.'
    case 'nit_con_contrato':
      return 'No pudimos activar el plan en línea para esta empresa. Escríbenos a mauricio.moreno@metrik.com.co y lo revisamos contigo.'
    default:
      return 'No pudimos activar el plan. Nada quedó a medias; intenta de nuevo en un momento.'
  }
}
