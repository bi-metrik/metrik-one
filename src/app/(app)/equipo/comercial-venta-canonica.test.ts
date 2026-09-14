/**
 * Contrato entre la hoja por persona de /equipo y la definicion canonica de venta.
 *
 * El defecto que esto fija (QA en pantalla del 2026-09-14, PR #626): el KPI `Ventas`, el
 * pill `Vendidos en {mes}` y la tabla de la hoja salian de `get_comercial_perfil_soena`,
 * que contaba como venta "el negocio con al menos un cobro" (`MIN(v_cobro_valor.fecha)`).
 * El panel que abre esa misma cifra sale de `v_venta_mes_comercial`, que desde
 * `20260903120000` cuenta tambien la venta en cero de un convenio: sin cobro, sin
 * honorario aprobado, y venta igual por decision de Mauricio. Jessica, agosto: KPI 31,
 * panel 32 (V0429). Julio: 33 contra 34 (V0066). La tarjeta del leaderboard, que sale de
 * `get_comercial_resumen_soena` y abre el mismo panel, arrastraba lo mismo.
 *
 * Y el segundo: "Pendiente de recaudo" decia "Inventario a hoy, no depende del mes" y
 * restaba el honorario recaudado DEL MES, asi que cambiaba con el mes.
 *
 * ⚠️ Por que es una prueba sobre el TEXTO de la migracion y no sobre su resultado: la
 * logica vive en SQL y este repo no tiene una base contra la cual correr pruebas. Lo que
 * se fija aca es lo que no puede volver (la definicion vieja de venta, el pendiente con
 * el recaudo del periodo). El resultado se ensayo aparte, corriendo el cuerpo viejo y el
 * nuevo en Postgres sobre una foto de solo lectura de produccion: con el viejo salen al
 * peso las cifras del QA (31, 33, $105.585.123 / $96.153.295 / $92.918.495), con el
 * nuevo 32, 34 y $9.309.846 en todos los meses, y la lista coincide caso por caso con la
 * del panel. Detalle en el PR.
 *
 * Mira la ULTIMA migracion que define cada funcion, asi que tambien protege contra una
 * reescritura futura que copie el cuerpo viejo. Si una reescritura legitima cambia la
 * forma (otro alias, otra vista canonica), se actualiza esta prueba a conciencia.
 *
 * ⚠️ Mutacion corrida: sin la migracion `20260915030000` (la ultima definicion vuelve a
 * ser `20260902220053`) caen las cinco pruebas.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase/migrations')

/** Cuerpo (sin comentarios de linea) de la ultima definicion de `fn` en las migraciones. */
function ultimaDefinicion(fn: string): { archivo: string; cuerpo: string } {
  const cabecera = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, 'gi')
  const archivos = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const archivo of archivos.reverse()) {
    const sql = readFileSync(join(DIR, archivo), 'utf8')
    const matches = [...sql.matchAll(cabecera)]
    if (matches.length === 0) continue
    const desde = matches[matches.length - 1].index ?? 0
    const abre = sql.indexOf('$function$', desde)
    const cierra = sql.indexOf('$function$', abre + '$function$'.length)
    if (abre < 0 || cierra < 0) throw new Error(`${archivo}: no se encontro el cuerpo de ${fn}`)
    const cuerpo = sql.slice(abre + '$function$'.length, cierra).replace(/--[^\n]*/g, '')
    return { archivo, cuerpo }
  }
  throw new Error(`Ninguna migracion define ${fn}`)
}

describe('la hoja por persona cuenta las ventas como el panel', () => {
  it('el perfil toma la venta de v_venta_mes_comercial, no del primer cobro', () => {
    const { archivo, cuerpo } = ultimaDefinicion('get_comercial_perfil_soena')
    expect(cuerpo, archivo).toMatch(/from\s+v_venta_mes_comercial\b/i)
    // La definicion vieja: sin cobro no hay venta. Deja afuera la venta en cero.
    expect(cuerpo, archivo).not.toMatch(/min\s*\(\s*cv\.fecha\s*\)/i)
  })

  it('el KPI, el pill y la tabla del perfil salen de esa misma fecha de venta', () => {
    const { archivo, cuerpo } = ultimaDefinicion('get_comercial_perfil_soena')
    // `es_venta_periodo` alimenta los tres (KPI `num_ventas` y `negocios[].es_venta`). Si
    // volviera a leer el CTE de cobros (`cn`), la venta en cero saldria del conteo.
    const expr = cuerpo.match(/,([^,]*?fecha_venta\s+is\s+not\s+null[\s\S]*?)as\s+es_venta_periodo/i)
    expect(expr, `${archivo}: no se encontro es_venta_periodo`).not.toBeNull()
    expect(expr![1]).not.toMatch(/\bcn\./)
  })

  it('el resumen (leaderboard y /equipo) cuenta igual, y la venta en cero no bonifica', () => {
    const { archivo, cuerpo } = ultimaDefinicion('get_comercial_resumen_soena')
    expect(cuerpo, archivo).toMatch(/from\s+v_venta_mes_comercial\b/i)
    expect(cuerpo, archivo).not.toMatch(/min\s*\(\s*cv\.fecha\s*\)/i)
    // `bonificable` sale de la vista, donde la venta en cero va en FALSE. Leido de
    // `v_negocio_bonificable` la contaria como bonificable en el ranking.
    expect(cuerpo, archivo).not.toMatch(/v_negocio_bonificable/i)
  })
})

describe('el pendiente de recaudo no depende del mes', () => {
  it('se calcula contra TODO lo recaudado, no contra lo recaudado en el periodo', () => {
    const { archivo, cuerpo } = ultimaDefinicion('get_comercial_perfil_soena')
    const pendiente = cuerpo.match(/as\s+tarifa_recaudada\s*,([\s\S]*?)as\s+pendiente_honorario/i)
    expect(pendiente, `${archivo}: no se encontro pendiente_honorario`).not.toBeNull()
    expect(pendiente![1]).toMatch(/honorario_total/)
    // `cn.honorario` es la suma FILTRADA por el periodo: la que hacia moverse la cifra.
    expect(pendiente![1]).not.toMatch(/\bcn\.honorario\b(?!_)/)

    // Y `honorario_total` no puede traer un FILTER por periodo escondido.
    const total = cuerpo.match(/as\s+tarifa\s*,([\s\S]*?)as\s+honorario_total/i)
    expect(total, `${archivo}: no se encontro honorario_total`).not.toBeNull()
    expect(total![1]).not.toMatch(/\bfilter\b/i)
    expect(total![1]).not.toMatch(/p_anio|p_mes/i)
  })

  it('solo cuenta los casos abiertos: un caso perdido no es plata por recaudar', () => {
    const { archivo, cuerpo } = ultimaDefinicion('get_comercial_perfil_soena')
    const pendiente = cuerpo.match(/as\s+tarifa_recaudada\s*,([\s\S]*?)as\s+pendiente_honorario/i)
    expect(pendiente, archivo).not.toBeNull()
    expect(pendiente![1]).toMatch(/estado\s*=\s*'abierto'/i)
  })
})
