import { describe, expect, it } from 'vitest'
import { escenarioOne } from './escenario'
import { modeloGuionado } from '../modelo-guionado'
import { lectorSeco, sembrarBorrados } from '../arnes/one'
import { reciboUberSintetico } from '../arnes/soportes/pdf-minimo'
import type { PedidoModelo } from '../tipos'

/**
 * Arnés ONE con Haiku, 2026-10-31 (PR #1374, corrida 1 de 3, caso `b-borrados-dos-pdf`): G1 $27.000, G2 $6.880 y G3
 * $20.389 en el historial pero borrados de la base; llegan los dos PDF de Uber y la persona dice «estos dos cárgalos como
 * gastos nuevos». El modelo propuso el $27.000 del historial (sin soporte), la persona dijo «Sí», y en el mismo mensaje
 * de la confirmación salió OTRA VEZ la propuesta de $27.000; el toque siguiente lo registró dos veces.
 *   - Que propusiera el $27.000 es interpretación del modelo: el Estado ya no lo invita («si mandó soportes y dice
 *     «estos», son los de esos soportes»).
 *   - Que la confirmación saliera con la misma propuesta debajo es una invariante: tras un hecho la persona no dijo nada
 *     nuevo, y repetir lo que su toque acaba de escribir no sale (`repite_lo_hecho`).
 * Lo que dice el guion es lo que hizo Haiku en esa corrida. Datos inventados.
 */

const NEGOCIOS = [
  { id: 'n-V1265', codigo: 'V1 26 5', nombre: 'Utilidad por obra', empresa: 'Vértice Impermeables', contacto: null, etapa: 'ejecucion', valor: 5_000_000 },
]
const PDF = { bytes: reciboUberSintetico(), mime: 'application/pdf' }
const textoDelTurno = (p: PedidoModelo) => String(p.mensajes[0].parts[0].text)
/** El número de soporte que el Estado le da a un archivo («#13 (PDF «recibo-uber.pdf»…»). */
const numeroDe = (p: PedidoModelo, nombre: string) => textoDelTurno(p).match(new RegExp(`#(\\d+) \\(PDF «${nombre.replace('.', '\\.')}»`))?.[1]
const ultimoResultado = (p: PedidoModelo) => JSON.stringify(p.mensajes.at(-1))

describe('dos PDF y gastos borrados en el historial (b-borrados-dos-pdf)', () => {
  it('el Estado no invita a recargar lo borrado sin soporte, y tras «Sí» la misma propuesta no vuelve a salir', async () => {
    let estadoTurno2 = ''
    let rechazo = ''
    const modelo = modeloGuionado([
      (p) => ({ name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, categoria: 'transporte', descripcion: 'Uber de ida', negocio: 'V1 26 5', soporte: numeroDe(p, 'recibo-uber.pdf') } } }),
      (p) => {
        estadoTurno2 = textoDelTurno(p)
        // Lo que hizo Haiku: el $27.000 del historial, sin soporte.
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, categoria: 'transporte', descripcion: 'transportes', negocio: 'V1 26 5' } } }
      },
      // «Sí» registró el $27.000; tras el hecho, Haiku volvió a proponer lo mismo.
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, categoria: 'transporte', descripcion: 'transportes', negocio: 'V1 26 5', empresa: false } } },
      (p) => {
        rechazo = ultimoResultado(p)
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, categoria: 'transporte', descripcion: 'Uber de ida', negocio: 'V1 26 5', soporte: numeroDe(p, 'recibo-uber.pdf') } } }
      },
      (p) => ({ name: 'proponer', args: { accion: 'gasto', datos: { monto: 20389, categoria: 'transporte', descripcion: 'Uber de vuelta', negocio: 'V1 26 5', soporte: numeroDe(p, 'recibo-uber-vuelta.pdf') } } }),
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector: lectorSeco })
    sembrarBorrados(e, [
      { monto: 27000, negocio: 'V1 26 5', descripcion: 'transportes' },
      { monto: 6880, negocio: 'V1 26 5', descripcion: 'Uber de ida' },
      { monto: 20389, negocio: 'V1 26 5', descripcion: 'Uber de vuelta' },
    ], NEGOCIOS)

    await e.juntos([{ documento: 'recibo-uber.pdf', archivo: PDF }, { documento: 'recibo-uber-vuelta.pdf', archivo: PDF, despuesMs: 2000 }])
    await e.escribe('Estos dos cárgalos como gastos nuevos, vuélvelos a cargar')
    expect(estadoTurno2).toContain('YA NO EXISTEN en la base')
    expect(estadoTurno2).toContain('si mandó soportes (fotos o PDF) y dice «estos», son los de esos soportes, no los de esta lista')
    expect(estadoTurno2).toContain('Si no queda claro cuáles, pregunta antes de proponer.')

    const tras = await e.escribe('Sí')
    expect(tras[0].texto).toContain('✅ Gasto de $27.000 registrado')
    // Debajo de la confirmación va lo que sigue (el PDF de la ida), no el eco del $27.000.
    expect(tras[0].texto).toContain('💰 Gasto de $6.880')
    expect(tras[0].texto).not.toContain('💰 Gasto de $27.000')
    expect(rechazo).toContain('eso es justo lo que se acaba de registrar')
    // El turno de seguir dice QUÉ se registró (con su soporte), no solo el monto.
    expect(textoDelTurno(modelo.pedidos.at(-1)!)).toContain('Lo que se registró: 💰 Gasto de $27.000 · Transporte y movilidad · 📁 V1 26 5')
    expect(textoDelTurno(modelo.pedidos.at(-1)!)).toContain('no vuelvas a proponer eso')
    expect(e.trazas().at(-1)!.candados).toEqual([expect.objectContaining({ candado: 'repite_lo_hecho' })])

    await e.toca('Registrar')
    // Con la ida ya registrada otra vez, el Estado lo dice junto a su borrado (G2), para que no la vuelva a proponer.
    expect(textoDelTurno(modelo.pedidos.at(-1)!)).toMatch(/G2 \(gasto de \$6\.880 · V1 26 5[^)]*; ya se volvió a registrar: G\d+\)/)
    expect(textoDelTurno(modelo.pedidos.at(-1)!)).not.toMatch(/G3 \([^)]*ya se volvió a registrar/)
    await e.toca('Registrar')
    expect(e.puerto.gastos.map((g) => [g.monto, g.soporte])).toEqual([[27000, false], [6880, true], [20389, true]])
    expect(modelo.restantes()).toBe(0)
  })

  it('tras «Sí», la ida repetida con el mismo recibo: el candado dice que ya quedó, y sigue con la vuelta', async () => {
    // Corrida 2 de 3 del PR #1388 (intento 2): Haiku volvió a proponer la ida con su #n de memoria; «pregunta si hay otro
    // soporte» lo llevó a preguntar por ese recibo en vez de proponer la vuelta, y los toques cayeron en «Eso ya quedó hecho».
    let rechazo = ''
    let nIda = ''
    const modelo = modeloGuionado([
      (p) => {
        nIda = numeroDe(p, 'recibo-uber.pdf')!
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, categoria: 'transporte', descripcion: 'Uber de ida, Carrera 7 a Calle 26', negocio: 'V1 26 5', soporte: nIda } } }
      },
      // El #n de la ida, dicho de memoria en el turno que sigue al hecho (ya no sale en la lista de soportes sin usar).
      () => ({ name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, categoria: 'transporte', descripcion: 'Uber de ida', negocio: 'V1 26 5', soporte: `#${nIda}` } } }),
      (p) => {
        rechazo = ultimoResultado(p)
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 20389, categoria: 'transporte', descripcion: 'Uber de vuelta', negocio: 'V1 26 5', soporte: numeroDe(p, 'recibo-uber-vuelta.pdf') } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector: lectorSeco })
    await e.juntos([{ documento: 'recibo-uber.pdf', archivo: PDF }, { documento: 'recibo-uber-vuelta.pdf', archivo: PDF, despuesMs: 2000 }])
    const tras = await e.escribe('Sí')
    expect(rechazo).toContain('ya es el soporte de otro gasto (el de $6.880, ya registrado). Si es ese mismo gasto, ya quedó: no lo propongas otra vez')
    expect(tras[0].texto).toContain('✅ Gasto de $6.880 registrado')
    expect(tras[0].texto).toContain('💰 Gasto de $20.389')
    await e.toca('Registrar')
    expect(e.puerto.gastos.map((g) => [g.monto, g.soporte])).toEqual([[6880, true], [20389, true]])
  })

  it('tras «Sí», la ida repetida SIN soporte y con otra descripción también es un eco; un recibo distinto del mismo monto no', async () => {
    let rechazo = ''
    const modelo = modeloGuionado([
      (p) => ({ name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, categoria: 'transporte', descripcion: 'Uber de ida, Carrera 7 a Calle 26', negocio: 'V1 26 5', soporte: numeroDe(p, 'recibo-uber.pdf') } } }),
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, categoria: 'transporte', descripcion: 'Uber de ida', negocio: 'V1 26 5' } } },
      (p) => {
        rechazo = ultimoResultado(p)
        // Otro recibo, mismo monto: no es eco, sale.
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, categoria: 'transporte', descripcion: 'Uber de vuelta', negocio: 'V1 26 5', soporte: numeroDe(p, 'recibo-uber-vuelta.pdf') } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector: lectorSeco })
    await e.juntos([{ documento: 'recibo-uber.pdf', archivo: PDF }, { documento: 'recibo-uber-vuelta.pdf', archivo: PDF, despuesMs: 2000 }])
    const tras = await e.escribe('Sí')
    expect(rechazo).toContain('eso es justo lo que se acaba de registrar')
    expect(tras[0].texto).toContain('📝 Uber de vuelta')
    expect(tras[0].texto).toContain('📎 Soporte: recibo-uber-vuelta.pdf')
  })
})
