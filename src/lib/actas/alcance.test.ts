import { describe, expect, it } from 'vitest'
import {
  aliasDistintivos,
  evidenciaDeNegocio,
  parseIntervenciones,
  recortarPreludio,
} from './alcance'
import type { NegocioDirectorio } from './cliente'

const negocio = (id: string, codigo: string, nombre: string): NegocioDirectorio => ({
  id,
  codigo,
  nombre,
  estado: 'abierto',
  stageActual: 'ejecucion',
})

// Los cuatro negocios abiertos reales de AFI. Es el caso que rompio la cascada
// por etapa: la reunion de ALMA cayo en Clarity Express por ser el unico en
// ejecucion.
const AFI = [
  negocio('n1', 'A1 26 1', 'One Compliance Concesión ALMA'),
  negocio('n2', 'A1 26 2', 'Clarity Express AFI'),
  negocio('n3', 'A1 26 3', 'Valida AFI'),
  negocio('n4', 'A1 26 4', 'Licencias Valida CDA (via AFI)'),
]

describe('recortarPreludio', () => {
  it('recorta el monologo grabado antes de que entre la contraparte', () => {
    const cuerpo = [
      'Mauricio Moreno: perro, quedé pensativo por las cuentas de cobro',
      'Mauricio Moreno: y como con harta cosa, huevón',
      'Mauricio Moreno: quedé turbuleto con todo',
      'Mauricio Moreno: y lo del examen se me pasó',
      'Mauricio Moreno: después me hizo sentir mal no haberme acordado',
      'Yessica Vasquez: Hola, mi Mao.',
      'Mauricio Moreno: Hola, buenos días.',
    ].join('\n')

    const r = recortarPreludio(parseIntervenciones(cuerpo))

    expect(r.recortadas).toBe(5)
    expect(r.intervenciones[0].hablante).toBe('Yessica Vasquez')
  })

  it('no recorta el saludo de quien abre la sala', () => {
    const cuerpo = ['contacto trappvel: Hola, Mauro.', 'Mauricio Moreno: Alejandra, ¿cómo vas?'].join('\n')
    expect(recortarPreludio(parseIntervenciones(cuerpo)).recortadas).toBe(0)
  })

  it('deja la transcripcion intacta si nunca habla un segundo', () => {
    const solo = parseIntervenciones('Mauricio Moreno: probando\nMauricio Moreno: probando')
    expect(recortarPreludio(solo)).toEqual({ intervenciones: solo, recortadas: 0 })
  })
})

describe('aliasDistintivos', () => {
  it('quita el nombre de la empresa y lo que comparten dos negocios', () => {
    const alias = aliasDistintivos(AFI, 'AFI International Group')

    // 'valida' esta en dos negocios: no distingue ninguno de los dos.
    expect(alias.get('n3')).toEqual([])
    expect(alias.get('n4')).toEqual(['licencias'])
    expect(alias.get('n1')).toEqual(expect.arrayContaining(['compliance', 'concesion', 'alma']))
    expect(alias.get('n2')).toEqual(expect.arrayContaining(['clarity', 'express']))
  })

  it('descarta palabras cortas que empatan por casualidad', () => {
    // 'One' (3 letras) no puede ser la senal de un negocio en una conversacion
    // en espanol.
    expect(aliasDistintivos(AFI, 'AFI International Group').get('n1')).not.toContain('one')
  })
})

describe('evidenciaDeNegocio', () => {
  it('encuentra el negocio nombrado en voz alta', () => {
    const e = evidenciaDeNegocio('Bueno, revisemos la parte de alma, ¿no?', AFI, 'AFI International Group')
    expect(e).toHaveLength(1)
    expect(e[0].negocio.codigo).toBe('A1 26 1')
  })

  it('no confunde el verbo con el nombre del producto', () => {
    // 'validemos' / 'validación' no son menciones de Valida, y ademas Valida no
    // tiene alias distintivo frente a Licencias Valida CDA.
    const e = evidenciaDeNegocio('si quieres validemos con otra razón social', AFI, 'AFI International Group')
    expect(e).toEqual([])
  })

  it('reporta los dos negocios cuando suenan los dos, sin elegir', () => {
    const e = evidenciaDeNegocio(
      'la entrega de alma quedó lista; de licencias hablamos el jueves, licencias otra vez',
      AFI,
      'AFI International Group',
    )
    expect(e.map((x) => x.negocio.codigo)).toEqual(['A1 26 4', 'A1 26 1'])
    expect(e[0].menciones).toBe(2)
  })
})
