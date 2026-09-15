/**
 * A qué pestaña y con qué filtro abre Tesorería cuando se llega por un enlace.
 *
 * Existe por el aviso de sobrepago (`lib/cobros/aviso-sobrepago.ts`): la campana y el
 * correo mandan a la lista de sobrantes, no al negocio. Sin leer la URL la pantalla abría
 * en "Por confirmar" o en "Vista general", o sea en una lista que no contiene lo que el
 * aviso prometió mostrar.
 *
 * Se resuelve en el SERVIDOR (`page.tsx`) y entra como estado inicial: si lo leyera el
 * cliente, el servidor pintaría otra pestaña y la hidratación la descartaría.
 *
 * Solo acepta valores conocidos. Un parámetro desconocido no cambia nada.
 *
 * Puro: no toca DB ni red.
 */

export const PESTANAS_CONCILIACION = ['bandeja', 'saldos', 'general', 'fuera_epayco', 'facturacion', 'recibos'] as const
export type PestanaConciliacion = (typeof PESTANAS_CONCILIACION)[number]

export const FILTROS_SALDO = ['sobrante', 'faltante', 'cero'] as const
export type FiltroSaldo = (typeof FILTROS_SALDO)[number]

export interface DestinoInicial {
  pestana: PestanaConciliacion | null
  saldo: FiltroSaldo | null
}

type Parametro = string | string[] | undefined

function primero(v: Parametro): string | null {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s.trim() : null
}

function uno<T extends string>(permitidos: readonly T[], v: Parametro): T | null {
  const s = primero(v)
  return s && (permitidos as readonly string[]).includes(s) ? (s as T) : null
}

export function destinoInicialConciliacion(
  searchParams: { pestana?: Parametro; saldo?: Parametro } | null | undefined,
): DestinoInicial {
  return {
    pestana: uno(PESTANAS_CONCILIACION, searchParams?.pestana),
    saldo: uno(FILTROS_SALDO, searchParams?.saldo),
  }
}
