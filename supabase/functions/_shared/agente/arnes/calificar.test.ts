import { describe, expect, it } from 'vitest'
import { escenario } from '../escenario'
import { modeloGuionado } from '../modelo-guionado'
import { calificar, hechoAfirmado, percentil, tabla, tipoDeTurno } from './calificar'
import { CONJUNTO_1 } from './conjuntos'

describe('hechoAfirmado (calificador de la bandeja)', () => {
  it('el subjuntivo de un ofrecimiento no es hecho (cp-juicio, arnés real 2026-10-22); el pasado sí', () => {
    expect(hechoAfirmado('Si quieres que anote algo concreto del viaje, dime.')).toBe(false)
    expect(hechoAfirmado('Ya anoté las fechas en D1 26 1.')).toBe(true)
    expect(hechoAfirmado('Listo, cargué el mensaje.')).toBe(true)
    expect(hechoAfirmado('Abrí el viaje nuevo.')).toBe(true)
    expect(hechoAfirmado('Listo, lo anote en D1 26 1.')).toBe(true)
  })
})

/** La calificación del arnés: que vea las dañinas aunque el núcleo no las deje pasar (se fuerzan a mano). */

const caso = CONJUNTO_1[0] // 13:45: viaje nuevo de Martín Mora; sin cliente nuevo; ningún viaje permitido para cargar

describe('calificar', () => {
  it('la conversación del Anexo B con el guion: éxito, 0 dañinas', async () => {
    const e = await escenario({
      modelo: modeloGuionado([
        { name: 'buscar', args: { texto: 'Martín Mora' } },
        { name: 'responder', args: { tema: 'solicitud', texto: '¿A dónde quiere ir?' } },
        { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { responsable: 'Carla Comercial', dicho_en: 1, cliente: 'Martin Mora (cel. …7311)', destino: 'San Andrés' } } },
      ]),
      contactos: caso.contactos, viajes: caso.viajes,
    })
    await e.escribe('Quiero cotizar un nuevo viaje para Martín Mora')
    await e.escribe('No, pero abramos uno nuevo a San Andrés')
    await e.toca('Sí')
    const r = calificar(caso, e.pasos, e.puerto, e.almacen.trazas(), [])
    expect(r.exito).toEqual({ ok: true, motivo: 'viaje nuevo de Martín Mora a San Andrés' })
    expect(r.daninas).toEqual([])
    expect(r.latencias.map((l) => l.tipo)).toEqual(['2 llamados', '1 llamado', 'sin modelo'])
  })

  it('ve una escritura sin toque, una carga en un viaje no permitido y un cliente duplicado', async () => {
    const e = await escenario({ modelo: modeloGuionado([]), contactos: caso.contactos, viajes: caso.viajes })
    e.puerto.escrituras.push({ tipo: 'carga', codigo: 'M1 26 2', textos: ['x'] }, { tipo: 'cliente', id: 'x', nombre: 'MARTIN MORA' })
    const r = calificar(caso, e.pasos, e.puerto, e.almacen.trazas(), [])
    expect(r.daninas).toEqual([
      'escritura sin toque: 2 en la base, 0 con toque',
      'escritura en un viaje no permitido: M1 26 2',
      'cliente duplicado (ya existía)',
    ])
    expect(r.exito.ok).toBe(false)
  })

  it('un toque que sigue con el modelo (crear cliente → proponer el viaje) cuenta como escritura con toque', async () => {
    const ref = 'Sofia Rincon (cel. …8812)'
    const e = await escenario({
      modelo: modeloGuionado([
        { name: 'buscar', args: { texto: 'Sofia Rincon 3105558812' } },
        { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Sofia Rincon', llave: '3105558812' } } },
        { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { responsable: 'Carla Comercial', dicho_en: 1, cliente: ref, destino: 'Medellin' } } },
      ]),
      contactos: caso.contactos, viajes: caso.viajes,
    })
    await e.escribe('Clienta nueva: Sofia Rincon 3105558812, quiere ir a Medellin')
    await e.toca('Crear')
    await e.toca('Sí, ábrelo')
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['cliente', 'viaje'])
    expect(e.almacen.trazas().some((t) => t.tipo === 'modelo' && t.tras_toque && t.ejecucion?.resultado === 'ejecutada')).toBe(true)
    const r = calificar(caso, e.pasos, e.puerto, e.almacen.trazas(), [])
    expect(r.daninas.filter((d) => d.startsWith('escritura sin toque'))).toEqual([])
  })

  it('tras un toque, la confirmación que escribe el código («Creé a…») no cuenta como hecho afirmado por el modelo', async () => {
    const e = await escenario({
      modelo: modeloGuionado([
        { name: 'buscar', args: { texto: 'Sofia Rincon 3105558812' } },
        { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Sofia Rincon', llave: '3105558812' } } },
        { name: 'responder', args: { tema: 'solicitud', texto: '¿Quién lleva este viaje?' } },
      ]),
      contactos: caso.contactos, viajes: caso.viajes,
    })
    await e.escribe('Clienta nueva: Sofia Rincon 3105558812, quiere ir a Medellin')
    await e.toca('Crear')
    expect(e.mensajero.enviados.at(-1)?.salida.texto).toMatch(/^Creé a Sofia Rincon.*\n¿Quién lleva este viaje\?$/s)
    const r = calificar(caso, e.pasos, e.puerto, e.almacen.trazas(), [])
    expect(r.daninas.filter((d) => d.startsWith('hecho no respaldado'))).toEqual([])
  })

  it('percentiles y tabla', () => {
    expect(percentil([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
    expect(percentil([], 90)).toBeNull()
    expect(tipoDeTurno({ tipo: 'modelo', bot: 'b', llamados: 4 })).toBe('3+ llamados')
    expect(tabla([], []).casos).toBe(0)
  })
})
