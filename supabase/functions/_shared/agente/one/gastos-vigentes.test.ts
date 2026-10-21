import { describe, expect, it } from 'vitest'
import { escenarioOne } from './escenario'
import { modeloGuionado } from '../modelo-guionado'
import { cruzarConLaBase, gastosDeLaConversacion, registrosDeGastos } from './dominio'
import { lineasRegistros } from '../registros'
import type { PedidoModelo } from '../tipos'

/**
 * Caso real del 2026-10-21 (Mauricio, workspace propio): se registraron por el bot dos gastos de prueba (G1 $27.000 y
 * G2 $6.880, de Impervium), se borraron por SQL y horas después el bot dijo «hoy quedaron registrados dos gastos de
 * Impervium: G1 por $27.000 y G2 por $6.880… conviene corregirlo en la app». Lo sacó del historial sin mirar la base.
 * Ahora el Estado cruza los gastos de la conversación con la base y el bot propone él mismo la corrección. Datos
 * inventados (la empresa pasa a «Vértice»).
 */

const NEGOCIOS = [
  { id: 'n-v', codigo: 'V1 26 5', nombre: 'Impermeabilización bodega', empresa: 'Vértice Impermeables', contacto: null, etapa: 'ejecucion', valor: 5_000_000 },
]

const ID_PREVIO = '11111111-2222-4333-8444-555555555555'
const textoDelTurno = (p: PedidoModelo) => String(p.mensajes[0].parts[0].text)

/** Registra G1 ($27.000) y G2 ($6.880) en V1 26 5 con sus toques. */
async function dosGastos(siguen: Array<Parameters<typeof modeloGuionado>[0][number]>) {
  const modelo = modeloGuionado([
    { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'uber de ida' } } },
    { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'uber de vuelta' } } },
    ...siguen,
  ])
  const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
  await e.escribe('uber de 27000 al V1 26 5')
  await e.toca('Registrar')
  await e.escribe('y otro de 6880, la vuelta')
  await e.toca('Registrar')
  expect(e.puerto.gastos.map((g) => g.monto)).toEqual([27000, 6880])
  return e
}

describe('gastos de la conversación borrados en la base (caso real del 2026-10-21)', () => {
  it('el Estado dice que ya no están en ONE: el modelo no los ve como registrados', async () => {
    let visto = ''
    const e = await dosGastos([
      (p) => {
        visto = textoDelTurno(p)
        return { name: 'responder', args: { tema: 'gasto', texto: 'Esos dos gastos ya no están en ONE. ¿Los registro de nuevo?' } }
      },
    ])
    // Se borran por SQL (o en la app) horas después.
    e.puerto.borrarGasto('gasto-1')
    e.puerto.borrarGasto('gasto-2')
    e.reloj.avanzar(3 * 3600 * 1000)
    await e.escribe('¿qué gastos quedaron registrados hoy?')
    expect(visto).toContain('revisados en la base en este turno (el historial NO prueba que algo exista; esto sí): ninguno sigue en la base.')
    expect(visto).toContain('YA NO EXISTEN en la base (los borraron después): G1 (gasto de $27.000 · V1 26 5')
    expect(visto).toContain('G2 (gasto de $6.880 · V1 26 5')
    // El mensaje viejo del bot que dijo «registrado» lleva la nota del sistema.
    expect(visto).toContain('(nota del sistema: G1 ya no existe en la base)')
    expect(visto).toContain('(nota del sistema: G2 ya no existe en la base)')
  })

  it('borrado uno solo: el otro sigue como registrado, con el monto que tiene HOY en la base', async () => {
    let visto = ''
    const e = await dosGastos([
      (p) => {
        visto = textoDelTurno(p)
        return { name: 'responder', args: { tema: 'gasto', texto: 'ok' } }
      },
    ])
    e.puerto.borrarGasto('gasto-1')
    e.puerto.gastos[0].monto = 7000 // alguien lo corrigió en la app
    await e.escribe('¿cómo quedaron?')
    expect(visto).toContain('esto sí): G2 · gasto de $7.000 · V1 26 5')
    expect(visto).toContain('YA NO EXISTEN en la base (los borraron después): G1 (gasto de $27.000')
  })

  it('corregir_gasto o adjuntar_soporte sobre un gasto borrado: el núcleo lo ataja (registro_borrado), nada se escribe', async () => {
    const e = await dosGastos([
      { name: 'proponer', args: { accion: 'corregir_gasto', datos: { gasto: 'G1', monto: 25000 } } },
      { name: 'responder', args: { tema: 'gasto', texto: 'Ese gasto ya no está en ONE.' } },
      { name: 'proponer', args: { accion: 'adjuntar_soporte', datos: { gasto: 'G2', soporte: '#11' } } },
      { name: 'responder', args: { tema: 'gasto', texto: 'Ese gasto ya no está en ONE.' } },
    ])
    e.puerto.borrarGasto('gasto-1')
    e.puerto.borrarGasto('gasto-2')
    const escritas = e.puerto.escrituras.length
    await e.escribe('el de 27000 eran 25000')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['registro_borrado'])
    await e.foto()
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['registro_borrado'])
    expect(e.puerto.escrituras.length).toBe(escritas)
  })

  it('si la base no responde, no se afirma que están ni se propone sobre ellos', async () => {
    let visto = ''
    const e = await dosGastos([
      (p) => {
        visto = textoDelTurno(p)
        return { name: 'proponer', args: { accion: 'corregir_gasto', datos: { gasto: 'G1', monto: 25000 } } }
      },
      { name: 'responder', args: { tema: 'gasto', texto: 'No pude revisarlo ahora.' } },
    ])
    e.puerto.caida = true
    await e.escribe('el de 27000 eran 25000')
    expect(visto).toContain('Registros hechos en esta conversación: no pude revisar la base ahora. No afirmes que algo está registrado')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['gasto_no_leido'])
  })
})

describe('el bot propone la corrección en vez de mandar a la app', () => {
  it('un gasto de otro momento (id de gastos_recientes) sin revisar se corrige por aquí con su toque', async () => {
    const modelo = modeloGuionado([
      { name: 'gastos_recientes', args: { dias: 1 } },
      (p) => {
        // Lo que devolvió gastos_recientes trae el id del gasto (el modelo lo usa tal cual).
        expect(JSON.stringify(p.mensajes)).toContain(ID_PREVIO)
        return { name: 'proponer', args: { accion: 'corregir_gasto', datos: { gasto: ID_PREVIO, monto: 25000 } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    e.puerto.gastos.push({ id: ID_PREVIO, fecha: '2026-10-21', monto: 27000, categoria: 'transporte', descripcion: 'uber', negocio: 'V1 26 5', negocioId: 'n-v', soporte: false })
    const t = await e.escribe('el uber de hoy no era 27000, eran 25000')
    expect(t[0].texto).toContain('✏️ El gasto de $27.000 · V1 26 5 queda en $25.000')
    await e.toca('Cambiar')
    expect(e.puerto.escrituras).toEqual([expect.objectContaining({ tipo: 'correccion', monto_antes: 27000, monto: 25000 })])
  })

  it('el reglamento ONE ya no manda a la app lo que el bot puede proponer', async () => {
    const { fichasOne } = await import('./reglamento')
    const f = fichasOne('Empresa')
    expect(f.find((x) => x.clave === 'g.no_mandar_a_la_app')?.hacer).toContain('no le digas que lo corrija en la app')
    expect(f.find((x) => x.clave === 'inv.gastos_vigentes')?.hacer).toContain('ya no está')
    expect(f.find((x) => x.clave === 'alc.app')?.cuando).toContain('`corregir_gasto`')
  })
})

describe('cruzarConLaBase (pura)', () => {
  const deAqui = [
    { ref: 'G1', id: 'a', monto: 27000, negocio: 'V1 26 5', etiqueta: 'V1 26 5 · Vértice', soporte: false },
    { ref: 'G2', id: 'b', monto: 6880, negocio: 'V1 26 5', etiqueta: 'V1 26 5 · Vértice', soporte: true },
  ]
  it('separa los que siguen de los borrados; de los que siguen manda la base', () => {
    const c = cruzarConLaBase(deAqui, [{ id: 'b', fecha: '2026-10-21', monto: 7000, categoria: 'transporte', descripcion: '', negocio: 'V1 26 5', soporte: false, revisado: true }])
    expect(c.revisada).toBe(true)
    expect(c.borrados.map((g) => g.ref)).toEqual(['G1'])
    expect(c.vigentes).toEqual([expect.objectContaining({ ref: 'G2', monto: 7000, soporte: true, revisado: true })])
    expect(lineasRegistros(registrosDeGastos(c))[0]).toContain('G2 · gasto de $7.000 · V1 26 5 · Vértice · con soporte · ya revisado por contabilidad')
    expect(lineasRegistros(registrosDeGastos(c))[1]).toContain('G1 (gasto de $27.000 · V1 26 5 · Vértice)')
  })
  it('sin base: quedan como dice la traza, marcados como no revisados', () => {
    const c = cruzarConLaBase(deAqui, 'error')
    expect(c).toEqual({ vigentes: deAqui, borrados: [], revisada: false })
    expect(registrosDeGastos(c)).toBe('error')
    expect(lineasRegistros('error')[0]).toContain('no pude revisar la base ahora')
  })
  it('gastosDeLaConversacion sigue leyendo solo trazas (la base la cruza el dominio)', () => {
    expect(gastosDeLaConversacion([])).toEqual([])
  })
})

describe('el verificador del núcleo no deja salir «ya están registrados» de un gasto borrado', () => {
  it('la frase del caso real («G1 … ya están registrados, no los toco») no sale; la corregida sí', async () => {
    const e = await dosGastos([
      { name: 'responder', args: { tema: 'gasto', texto: 'G1 por $27.000 y G2 por $6.880 ya están registrados, no los toco.' } },
      { name: 'responder', args: { tema: 'gasto', texto: 'G1 y G2 ya no están en ONE: los borraron. ¿Los registro de nuevo?' } },
    ])
    e.puerto.borrarGasto('gasto-1')
    e.puerto.borrarGasto('gasto-2')
    const t = await e.escribe('¿y los de impervium?')
    const traza = e.trazas().at(-1)!
    expect(traza.verificador!.map((v) => v.motivo).join(' ')).toContain('dice que G1 está registrado, pero ya no existe en la base')
    expect(t[0].texto).toBe('G1 y G2 ya no están en ONE: los borraron. ¿Los registro de nuevo?')
    expect(traza.registros).toEqual([{ alias: 'G1', estado: 'borrado' }, { alias: 'G2', estado: 'borrado' }])
  })
})

describe('el soporte de un gasto borrado vuelve a quedar libre', () => {
  it('registrar de nuevo con la misma foto: no dice «ya es el soporte de otro gasto»', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte', soporte: '#1' } } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte', soporte: '#1' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.foto('uber de 27000 al V1 26 5')
    await e.toca('Registrar')
    e.puerto.borrarGasto('gasto-1')
    const t = await e.escribe('vuélvelo a cargar')
    expect(e.trazas().at(-1)!.candados ?? []).toEqual([])
    expect(t[0].texto).toContain('📷 Con la foto #1 como soporte')
  })
})
