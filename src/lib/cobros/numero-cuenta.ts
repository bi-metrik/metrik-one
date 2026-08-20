/**
 * Correlativo CC-YYYY-MM-NNN de las cuentas de cobro — UNA sola fuente.
 *
 * Habia dos: `generar-cuentas-cobro.ts` pedia el numero al RPC
 * `generate_cuenta_cobro_numero` y `emitir-cuota-explicita.ts` lo calculaba por
 * su cuenta con un max()+1 sobre las filas ya emitidas. Dos calculos para la
 * misma serie es una colision esperando: basta que uno cambie de criterio (o que
 * el RPC pase a llevar contador propio) para que los dos entreguen el mismo
 * numero y el segundo insert reviente contra el unique de `numero`.
 *
 * Aqui el RPC manda. El max()+1 local queda SOLO como red de seguridad si el RPC
 * no responde, para no insertar un `CC-YYYY-MM-PREVIEW` literal en la tabla.
 *
 * El RPC de produccion (verificado 2026-08-20) hace exactamente
 * `MAX(consecutivo)+1` sobre `cuentas_cobro_emitidas` filtrando workspace + anio
 * + mes, bajo `pg_advisory_xact_lock`. No lleva contador desacoplado: no "gasta"
 * numeros, y llamarlo en dry-run no escribe nada.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const RE_NUMERO = /^CC-(\d{4})-(\d{2})-(\d+)$/

/** `CC-2026-08-004` a partir de sus partes. */
export function formatNumeroCuenta(anio: number, mes: number, consecutivo: number): string {
  return `CC-${anio}-${String(mes).padStart(2, '0')}-${String(consecutivo).padStart(3, '0')}`
}

/** Consecutivo (el NNN) de un numero canonico. `null` si no tiene la forma esperada. */
export function consecutivoDeNumero(numero: string | null | undefined): number | null {
  if (!numero) return null
  const m = numero.match(RE_NUMERO)
  return m ? parseInt(m[3], 10) : null
}

/** Corre un numero canonico N posiciones. Se usa SOLO para previsualizar en dry-run. */
export function desplazarNumero(numero: string, offset: number): string {
  if (offset === 0) return numero
  const m = numero.match(RE_NUMERO)
  if (!m) return numero
  const ancho = Math.max(m[3].length, 3)
  return `CC-${m[1]}-${m[2]}-${String(parseInt(m[3], 10) + offset).padStart(ancho, '0')}`
}

/** max(consecutivo)+1 sobre una lista de numeros ya emitidos. Ignora los que no calzan. */
export function siguienteConsecutivo(numeros: (string | null | undefined)[]): number {
  let max = 0
  for (const n of numeros) {
    const c = consecutivoDeNumero(n)
    if (c !== null && c > max) max = c
  }
  return max + 1
}

/**
 * Siguiente numero de la serie del periodo. Lo resuelve el RPC; si el RPC falla,
 * cae al max()+1 sobre las filas del periodo.
 *
 * `offset` desplaza el numero SIN reservarlo: es para que un dry-run que
 * previsualiza varias cuentas del mismo mes no imprima el mismo numero N veces.
 * En emision real siempre va en 0 — cada insert mueve el max de verdad.
 */
export async function siguienteNumeroCuenta(
  supabase: SupabaseClient,
  workspaceId: string,
  anio: number,
  mes: number,
  offset = 0,
): Promise<string> {
  const { data, error } = await supabase.rpc('generate_cuenta_cobro_numero', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })

  if (!error && typeof data === 'string' && consecutivoDeNumero(data) !== null) {
    return desplazarNumero(data, offset)
  }

  const { data: filas } = await supabase
    .from('cuentas_cobro_emitidas')
    .select('numero')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
    .eq('mes', mes)

  const numeros = ((filas ?? []) as { numero: string | null }[]).map((f) => f.numero)
  return formatNumeroCuenta(anio, mes, siguienteConsecutivo(numeros) + offset)
}
