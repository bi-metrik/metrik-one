/**
 * Lo que la hoja por persona de /equipo pinta cuando la pantalla se segmenta por mes.
 *
 * Es una prueba de RENDER porque lo que se corrige es un hecho de pantalla: la tarjeta
 * mostraba "Ventas (total)" (el historico completo) al lado de un cumplimiento de meta
 * calculado contra la meta DEL MES. Con Jessica Tejada eso daba 4925%. Aca se fija que
 * la tarjeta habla de un solo periodo: un unico numero de ventas, el mes en el titulo,
 * y el enlace al perfil llevandose el mes elegido.
 *
 * `renderToStaticMarkup` en el entorno `node` de vitest alcanza para el primer render,
 * que es donde vive todo lo que se afirma aca. Mismo patron que
 * `conciliacion/tarjeta-retenido-render.test.ts`.
 *
 * ⚠️ Mutaciones corridas el 2026-09-09; cada una tumba una prueba distinta:
 *   volver a poner la fila "Ventas (total)" en la tarjeta ..... 1 prueba
 *   quitar el mes del titulo .................................. 1
 *   el enlace al perfil sin `?mes=` ........................... 1
 *   los bloques de inventario sin su nota ..................... 1
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import EquipoComercialPersonasClient from './equipo-comercial-personas-client'
import type { ComercialResumenRow, ComercialMesResponse, ComercialVendedorMes } from './comercial-types'

/**
 * Fila del resumen tal como llega de `get_comercial_resumen_soena` con periodo: las
 * ventas y el honorario ya son DEL MES; el inventario (negocios abiertos, valor
 * aprobado) sigue siendo de hoy, porque la RPC no lo filtra por periodo.
 */
function fila(over: Partial<ComercialResumenRow> = {}): ComercialResumenRow {
  return {
    responsable_id: 'staff-1',
    nombre: 'JESSICA TEJADA',
    position: 'Comercial',
    es_lider: false,
    sin_responsable: false,
    negocios_total: 40,
    negocios_abiertos: 12,
    en_venta: 3,
    en_ejecucion: 6,
    en_cobro: 3,
    cerrados: 28,
    num_ventas: 4,
    num_bonificables: 3,
    valor_aprobado: 20_000_000,
    valor_aprobado_con_iva: 23_800_000,
    honorario_recaudado: 8_000_000,
    tarifa_recaudada: 0,
    ...over,
  }
}

function ventaMes(over: Partial<ComercialVendedorMes> = {}): ComercialVendedorMes {
  return {
    responsable_id: 'staff-1',
    nombre: 'JESSICA TEJADA',
    sin_responsable: false,
    es_lider: false,
    num_ventas: 4,
    valor_sin_iva: 6_500_000,
    valor_con_iva: 7_735_000,
    primer_pago: 3_000_000,
    segundo_pago: 1_000_000,
    casos_completos: 3,
    tasa_casos_completos: 75,
    bonificables: 3,
    participacion_pct: 40,
    meta_num_ventas: 4,
    meta_valor: null,
    ...over,
  }
}

const mesData: ComercialMesResponse = {
  anio: 2026,
  mes: 9,
  // Los KPIs agregados no los usa esta pantalla (viven en Tableros): la tarjeta solo
  // toma `porVendedor` para el valor vendido.
  kpis: {} as ComercialMesResponse['kpis'],
  porDia: [],
  porDiaVendedor: [],
  porVendedor: [ventaMes()],
}

const pintar = (
  resumen: ComercialResumenRow[] = [fila()],
  metas: [string, number][] = [['staff-1', 4]],
) =>
  renderToStaticMarkup(
    React.createElement(EquipoComercialPersonasClient, {
      resumen,
      mesData,
      anio: 2026,
      mes: 9,
      metasPorVendedor: metas,
    }),
  )

describe('la hoja por persona, segmentada por mes', () => {
  it('el titulo dice de que mes habla', () => {
    // Se mira el H1, no la pagina entera: el mes tambien sale en el subtitulo, y una
    // prueba que solo buscara el texto pasaria con el titulo mudo.
    expect(pintar()).toMatch(/<h1[^>]*>[^<]*Septiembre 2026/)
  })

  it('no muestra el mismo numero de ventas dos veces con dos nombres', () => {
    const html = pintar()
    expect(html).not.toContain('Ventas (total)')
    // Una sola etiqueta "Ventas" por persona. Si vuelve la fila del acumulado, son dos.
    expect(html.match(/>Ventas</g) ?? []).toHaveLength(1)
  })

  it('el cumplimiento se calcula contra las ventas DEL MISMO periodo', () => {
    // 4 ventas del mes contra meta 4 = 100%. Con el resumen historico (197 ventas
    // contra la meta del mes) esta misma tarjeta mostraba 4925%.
    expect(pintar()).toContain('100%')
    const historico = pintar([fila({ num_ventas: 197 })])
    expect(historico).toContain('4925%')
  })

  it('el enlace al perfil se lleva el mes elegido', () => {
    expect(pintar()).toContain('/equipo/comercial/staff-1?mes=2026-09')
  })
})

describe('los bloques que NO se mueven con el mes', () => {
  it('los casos de los lideres se declaran como inventario de hoy', () => {
    const html = pintar([fila(), fila({ responsable_id: 'staff-2', nombre: 'LIDER UNO', es_lider: true })])
    expect(html).toContain('Casos que llevan los lideres')
    expect(html).toContain('no depende del mes seleccionado')
    expect(html).toContain('activos hoy')
  })

  it('el bucket sin responsable tambien lo dice', () => {
    const html = pintar([
      fila(),
      fila({ responsable_id: null, nombre: '(sin responsable)', sin_responsable: true }),
    ])
    expect(html).toContain('Sin responsable')
    expect(html).toContain('inventario a hoy, no depende del mes seleccionado')
  })
})
