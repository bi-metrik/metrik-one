import { describe, expect, it } from 'vitest'
import { claveCompacta, codigosDelTexto, codigosSueltos, lecturasDeCodigo, resolverCodigo, resolverSueltos } from './bandeja/codigo'
import { escenario } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import { propuestaVigente } from './nucleo'

/**
 * Prueba del 2026-10-09 (número de prueba; datos inventados aquí): el comercial escribió «m1261» y el núcleo no lo
 * reconoció como M1 26 1 (el candado `viaje_nombrado` exigía los espacios). Ahora un token con la FORMA de un código,
 * pegado o con otro separador, da sus lecturas con espacios y vale solo la que existe en la base. No se adivina un
 * viaje por texto libre: «el de miami» sigue sin nombrar nada.
 */

describe('las lecturas de un código escrito de otra forma (puro)', () => {
  it('pegado: todas las lecturas con la forma {empresa} {AA} {n}', () => {
    expect(lecturasDeCodigo('m1261')).toEqual(['M 12 61', 'M1 26 1'])
    expect(lecturasDeCodigo('M12263')).toEqual(['M 12 263', 'M1 22 63', 'M12 26 3'])
  })
  it('con otro separador: respeta dónde cortaron', () => {
    expect(lecturasDeCodigo('M1-26-1')).toEqual(['M1 26 1'])
    expect(lecturasDeCodigo('m1.26.1')).toEqual(['M1 26 1'])
    expect(lecturasDeCodigo('M1 26 1')).toEqual(['M1 26 1'])
    expect(lecturasDeCodigo('P-26-1')).toEqual(['P 26 1'])
  })
  it('ni la empresa ni el consecutivo empiezan en 0; sin dígitos no hay código', () => {
    expect(lecturasDeCodigo('M2601')).toEqual(['M2 60 1'])
    expect(lecturasDeCodigo('M')).toEqual([])
    expect(lecturasDeCodigo('MX261')).toEqual([])
  })
  it('los sueltos de un texto: no lo que ya trae espacios, ni una palabra con dígitos, ni «a 2026»', () => {
    expect(codigosSueltos('anótalo en m1261 por favor')).toEqual(['M1261'])
    expect(codigosSueltos('anótalo en M1 26 1')).toEqual([])
    expect(codigosSueltos('el vuelo AV9420 sale a 2026 horas')).toEqual([])
    expect(codigosSueltos('es el m1-26-1, no el D1.26.2')).toEqual(['M1-26-1', 'D1.26.2'])
  })
  it('la llave compacta', () => {
    expect(claveCompacta('m1-26 1')).toBe('M1261')
  })
})

describe('contra los códigos que existen', () => {
  const existen = (hay: string[]) => async (c: string[]) => hay.filter((x) => c.includes(x))

  it('una sola lectura existe: es esa; con espacios no consulta', async () => {
    let consultas = 0
    const contar = (hay: string[]) => async (c: string[]) => { consultas++; return hay.filter((x) => c.includes(x)) }
    expect(await resolverCodigo('m1261', contar(['M1 26 1', 'M1 26 2']))).toEqual({ codigo: 'M1 26 1' })
    expect(await resolverCodigo('M1 26 1', contar([]))).toEqual({ codigo: 'M1 26 1' })
    expect(consultas).toBe(1)
  })
  it('dos lecturas existen: no se elige', async () => {
    expect(await resolverCodigo('m1261', existen(['M1 26 1', 'M 12 61']))).toEqual({ varios: ['M 12 61', 'M1 26 1'] })
  })
  it('ninguna existe, o la base no contesta', async () => {
    expect(await resolverCodigo('m1269', existen(['M1 26 1']))).toBeNull()
    expect(await resolverCodigo('m1261', async () => 'error' as const)).toBe('error')
  })
  it('los sueltos de varios mensajes, de una consulta; solo los de una lectura', async () => {
    const r = await resolverSueltos(['en m1261', 'y en d1262', 'nada aquí'], existen(['M1 26 1', 'D1 26 2', 'D 12 62']))
    expect(r).toEqual({ M1261: 'M1 26 1' })
    expect(codigosDelTexto('anota en m1261 y en D1 26 2', r)).toEqual(['M1 26 1', 'D1 26 2'])
    // Si la base no contesta, ninguno (el candado sigue cerrado).
    expect(await resolverSueltos(['en m1261'], async () => 'error' as const)).toEqual({})
  })
})

const MARTIN = { id: 'c-martin', nombre: 'MARTIN MORA', celular: '3001237311' }
const VIAJES = [1, 2].map((n) => ({ id: `v-${n}`, codigo: `M1 26 ${n}`, contactoId: 'c-martin', nombre: `VIAJE ${n}`, destino: 'Miami', abierto: true, datos: {} }))

describe('«m1261» nombra M1 26 1 en la conversación', () => {
  it('el modelo propone anotar con el código pegado o con espacios: el candado lo deja pasar y escribe en M1 26 1', async () => {
    for (const dado of ['m1261', 'M1 26 1']) {
      const modelo = modeloGuionado([
        { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: dado, texto: 'buscan hoteles 4 estrellas' } } },
      ])
      const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
      const s = await e.escribe('anota en m1261 que buscan hoteles 4 estrellas')
      expect(s[0].tipo).toBe('botones')
      expect(s[0].texto).toContain('¿Lo anoto en M1 26 1 · VIAJE 1?')
      expect(propuestaVigente(e.almacen.filas)?.sobre).toBe('M1 26 1')
      await e.toca('Anotar')
      expect(e.puerto.escrituras.filter((x) => x.tipo === 'carga').map((x) => x.codigo)).toEqual(['M1 26 1'])
    }
  })

  it('ver_viaje con el código pegado lee el viaje; el estado lo lista como nombrado', async () => {
    const modelo = modeloGuionado([
      { name: 'ver_viaje', args: { codigo: 'm1261' } },
      { name: 'responder', args: { tema: 'viaje', texto: 'M1 26 1 va a Miami.' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    const s = await e.escribe('qué tiene el m1261?')
    expect(s).toEqual([{ tipo: 'texto', texto: 'M1 26 1 va a Miami.' }])
    const t = e.trazas().at(-1)!
    expect(t.herramientas?.[0]).toMatchObject({ nombre: 'ver_viaje', ok: true, sobre: 'M1 26 1' })
    expect(t.verificador).toEqual([])
  })

  it('un código pegado que no nombró el comercial sigue sin pasar, y lo que no tiene forma de código no nombra nada', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: 'm1262', texto: 'buscan hoteles 4 estrellas' } } },
      { name: 'responder', args: { tema: 'viaje', texto: '¿A qué viaje lo anoto?' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    const s = await e.escribe('anota en el de miami que buscan hoteles 4 estrellas')
    expect(s).toEqual([{ tipo: 'texto', texto: '¿A qué viaje lo anoto?' }])
    expect(e.trazas().at(-1)!.candados?.map((c) => c.candado)).toEqual(['viaje_nombrado'])
  })
})
