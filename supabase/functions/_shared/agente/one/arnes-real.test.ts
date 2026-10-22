import { describe, expect, it } from 'vitest'
import { escenarioOne } from './escenario'
import { modeloGuionado } from '../modelo-guionado'
import { listaDeDestinoDelModelo, OPCION_EMPRESA } from './dominio'
import type { ArchivoAdjunto, Lector } from './lectura-adjunto'

/**
 * Lo que mostró el arnés con el modelo real (Haiku 5.5) el 2026-10-21, reproducido con un guion. Datos inventados.
 */

const NEGOCIOS = [
  { id: 'n-e', codigo: 'E1 26 1', nombre: 'Calle 10A', empresa: 'Eon Pruebas', contacto: null, etapa: 'ejecucion', valor: 1 },
  { id: 'n-s', codigo: 'S1 26 1', nombre: 'Otra obra', empresa: 'Sur Pruebas', contacto: null, etapa: 'venta', valor: 1 },
  { id: 'n-v', codigo: 'V1 26 5', nombre: 'Impermeabilización bodega', empresa: 'Vértice Impermeables', contacto: null, etapa: 'ejecucion', valor: 1 },
]

describe('r-t-base: el modelo armó su propia lista con «Gasto de empresa» primero y el «1» terminó en empresa', () => {
  it('esa lista no sale: el modelo llama preguntar_destino, «Gasto de empresa» queda al final y el «1» es el primer negocio', async () => {
    const modelo = modeloGuionado([
      { name: 'responder', args: { tema: 'gasto', texto: '¿De cuánto fue el monto?' } },
      // Lo que hizo el modelo real: su propia lista, con empresa primero.
      { name: 'responder', args: { tema: 'gasto', texto: '¿A cuál negocio va?', opciones: [{ titulo: OPCION_EMPRESA }, { titulo: 'E1 26 1' }, { titulo: 'S1 26 1' }] } },
      (p) => {
        expect(JSON.stringify(p.mensajes.at(-1))).toContain('llama `preguntar_destino`')
        return { name: 'preguntar_destino', args: { para: 'gasto', texto: '¿A cuál negocio va el gasto de $295.000?' } }
      },
      (p) => {
        expect(String(p.mensajes[0].parts[0].text)).toContain('1) E1 26 1')
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 295000, negocio: 'E1 26 1', categoria: 'otros' } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('Registrar gasto')
    const t = await e.escribe('295.000')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['respuesta_del_dominio'])
    const ops = 'opciones' in t[0] ? t[0].opciones.map((o) => o.titulo) : []
    expect(ops[0]).toBe('E1 26 1')
    expect(ops.at(-1)).toBe(OPCION_EMPRESA)
    const r = await e.elige(1)
    expect(r.como).toBe('[toque: E1 26 1]')
    await e.toca('Registrar')
    expect(e.puerto.gastos.map((g) => g.negocio)).toEqual(['E1 26 1'])
  })

  it('listaDeDestinoDelModelo: con «Gasto de empresa» no sale; elegir entre negocios de una búsqueda sí', () => {
    expect(listaDeDestinoDelModelo({ tipo: 'botones', texto: '¿Cuál?', opciones: [{ id: 'a', titulo: 'Gasto de empresa' }, { id: 'b', titulo: 'E1 26 1' }] })).toContain('preguntar_destino')
    expect(listaDeDestinoDelModelo({ tipo: 'botones', texto: '¿Cuál?', opciones: [{ id: 'a', titulo: 'V1 26 5' }, { id: 'b', titulo: 'V1 26 6' }] })).toBeNull()
    expect(listaDeDestinoDelModelo({ tipo: 'texto', texto: 'hola' })).toBeNull()
  })
})

describe('s-choque-monto: corregir con el soporte que ya es del mismo gasto', () => {
  it('el #n propio no traba la corrección: se corrige el monto y el soporte sigue', async () => {
    const pdf: ArchivoAdjunto = { bytes: new Uint8Array([37, 80, 68, 70]), mime: 'application/pdf' }
    const lector: Lector = async () => ({ legible: true, monto: 6880, fecha: '2026-10-21', comercio: 'Uber', nit: null, descripcion: 'viaje' })
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte', soporte: '#1' } } },
      // Lo que hizo el modelo real: corregir con el mismo #1 (que ya es el soporte de G1).
      { name: 'proponer', args: { accion: 'corregir_gasto', datos: { gasto: 'G1', monto: 6880, soporte: '#1' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    await e.documento('recibo-uber.pdf', 'gasto de 27000 de transporte al vértice', { archivo: pdf })
    await e.toca('Registrar')
    const t = await e.escribe('No, lo correcto es 6.880, el del recibo')
    expect(e.trazas().at(-1)!.candados ?? []).toEqual([])
    expect(t[0].texto).toContain('queda en $6.880')
    await e.toca('Cambiar')
    expect(e.puerto.gastos.map((g) => [g.monto, g.soporte])).toEqual([[6880, true]])
  })
})
