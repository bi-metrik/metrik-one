/**
 * El piso de materialidad del dinero: UNA vara para todo el sistema.
 *
 * Un residuo de unos pesos no es un descuadre, es el redondeo con el que la gente paga. Pero
 * "unos pesos" tenía tres definiciones distintas conviviendo, y cada control juzgaba la misma
 * diferencia con la suya:
 *
 *   - el gate `saldo_cero` toleraba $1.000 (este piso, decidido por Carmen)
 *   - el salto automático de una etapa de cobro exigía CERO absoluto
 *   - `descuadreConciliacion` toleraba $1
 *
 * La franja entre esas varas es una trampa: un caso con $120 de más pasaba el gate de la etapa
 * pero no el salto que debía evitarle la etapa entera, así que aterrizaba en Cobro a conciliar
 * una plata que sus propios gates ya daban por cuadrada. Medido en SOENA el 2026-08-06: V0276
 * ($120 sobre $1.051.880) varado, V0274 ($688) en camino. Ninguno tenía nada que resolver.
 *
 * Decisión de Mauricio (2026-08-06): el piso aplica a TODO el sistema. Cambiarlo es decisión
 * de CFO y se hace acá, en un solo lugar.
 *
 * ⚠️ Lo que la tolerancia hace y lo que NO hace. Solo destraba la COMPARACIÓN de un control:
 * nunca genera un cobro, nunca reconoce ingreso, nunca toca `precio_aprobado` ni el P&L. El
 * residuo sigue existiendo en los datos y sigue siendo visible en el panel de conciliación;
 * lo único que cambia es que deja de retener el caso.
 *
 * Vive en `lib/negocios` (genérico del producto) y no en `lib/upme` (modelo de dinero de
 * SOENA), porque lo consume el motor de avance, que no sabe nada de tarifas UPME.
 * `modelo-dinero.ts` lo re-exporta para no romper a quien ya lo importaba de allá.
 */
export const TOLERANCIA_SALDO_COP = 1000

/**
 * ¿Este saldo cuenta como cuadrado?
 *
 * Mide el VALOR ABSOLUTO: tolera lo mismo por faltante que por sobrepago. Un residuo de
 * redondeo no cambia de naturaleza según hacia qué lado cayó.
 *
 * Puro: no toca DB ni red.
 */
export function saldoCuadrado(saldo: number, tolerancia: number = TOLERANCIA_SALDO_COP): boolean {
  if (!Number.isFinite(saldo)) return false
  const margen = Number.isFinite(tolerancia) && tolerancia >= 0 ? tolerancia : 0
  return Math.abs(saldo) <= margen
}
