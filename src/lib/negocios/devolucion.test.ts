import { describe, it, expect } from 'vitest'
import {
  debeMoverElCaso,
  devolucionHabilitada,
  esMotivoValido,
  leerDevolucion,
  limpiarDevolucion,
  origenDeCopiaHeredada,
  puedeDevolverBloque,
  LABEL_MOTIVO,
  MOTIVOS_DEVOLUCION,
} from './devolucion'

const MARCA_OK = {
  motivo: 'ilegible',
  nota: 'La segunda pagina esta borrosa',
  por: 'staff-1',
  por_nombre: 'Deisy',
  etapa: 'Cita',
  en: '2026-08-21T10:00:00.000Z',
  evento_id: 'ev-1',
}

describe('devolucionHabilitada', () => {
  it('exige el flag explicito en true', () => {
    expect(devolucionHabilitada({ devolucion_habilitada: true })).toBe(true)
  })

  // Un bloque que no lo declara NO admite devolucion: el boton aparecería en casillas
  // que ninguna area de origen atiende, y una devolucion que nadie recibe frena el caso
  // sin dueño.
  it('es falso para config vacia, ausente o con el flag apagado', () => {
    expect(devolucionHabilitada({})).toBe(false)
    expect(devolucionHabilitada(null)).toBe(false)
    expect(devolucionHabilitada(undefined)).toBe(false)
    expect(devolucionHabilitada({ devolucion_habilitada: false })).toBe(false)
  })

  // Una cadena "true" es el error tipico de una config escrita a mano en SQL. Aceptarla
  // dejaría el criterio dependiendo de como se tecleo el JSON.
  it('no acepta la cadena "true"', () => {
    expect(devolucionHabilitada({ devolucion_habilitada: 'true' })).toBe(false)
  })
})

describe('esMotivoValido', () => {
  it('acepta los cinco motivos del catalogo', () => {
    for (const m of MOTIVOS_DEVOLUCION) expect(esMotivoValido(m)).toBe(true)
  })

  it('rechaza cualquier cosa fuera del catalogo', () => {
    expect(esMotivoValido('otro')).toBe(false)
    expect(esMotivoValido('')).toBe(false)
    expect(esMotivoValido(null)).toBe(false)
    expect(esMotivoValido(3)).toBe(false)
  })

  // El catalogo y sus etiquetas se desincronizan en silencio si nadie lo comprueba: el
  // motivo se guardaria bien y la pantalla lo pintaria como `undefined`.
  it('todo motivo del catalogo tiene etiqueta', () => {
    for (const m of MOTIVOS_DEVOLUCION) {
      expect(typeof LABEL_MOTIVO[m]).toBe('string')
      expect(LABEL_MOTIVO[m].length).toBeGreaterThan(0)
    }
  })
})

describe('leerDevolucion', () => {
  it('lee una marca bien escrita', () => {
    const m = leerDevolucion({ _devolucion: MARCA_OK })
    expect(m?.motivo).toBe('ilegible')
    expect(m?.nota).toBe('La segunda pagina esta borrosa')
    expect(m?.por_nombre).toBe('Deisy')
    expect(m?.evento_id).toBe('ev-1')
  })

  it('devuelve null cuando no hay marca', () => {
    expect(leerDevolucion({})).toBeNull()
    expect(leerDevolucion(null)).toBeNull()
    expect(leerDevolucion({ _devolucion: null })).toBeNull()
  })

  // Pintar un banner de "devuelto" sobre un objeto a medias le diria al area de origen
  // que corrija algo que nadie devolvio.
  it('devuelve null ante una marca a medias', () => {
    expect(leerDevolucion({ _devolucion: { motivo: 'ilegible' } })).toBeNull()
    expect(leerDevolucion({ _devolucion: { en: '2026-08-21' } })).toBeNull()
    expect(leerDevolucion({ _devolucion: { motivo: 'inventado', en: '2026-08-21' } })).toBeNull()
    expect(leerDevolucion({ _devolucion: { motivo: 'ilegible', en: '' } })).toBeNull()
  })

  it('no confunde un arreglo con una marca', () => {
    expect(leerDevolucion({ _devolucion: [MARCA_OK] })).toBeNull()
  })

  it('normaliza los opcionales ausentes a null en vez de undefined', () => {
    const m = leerDevolucion({ _devolucion: { motivo: 'vencido', en: '2026-08-21T00:00:00Z' } })
    expect(m).not.toBeNull()
    expect(m?.nota).toBeNull()
    expect(m?.por_nombre).toBeNull()
    expect(m?.etapa).toBeNull()
    expect(m?.evento_id).toBeNull()
  })

  // Una nota vacia y una nota ausente significan lo mismo para quien lee la pantalla.
  it('trata la nota vacia como ausente', () => {
    const m = leerDevolucion({ _devolucion: { ...MARCA_OK, nota: '' } })
    expect(m?.nota).toBeNull()
  })
})

describe('limpiarDevolucion', () => {
  it('quita la marca y conserva el resto del data', () => {
    const data = { _devolucion: MARCA_OK, drive_url: 'https://x', campos: { a: 1 } }
    const limpio = limpiarDevolucion(data)
    expect(limpio._devolucion).toBeUndefined()
    expect(limpio.drive_url).toBe('https://x')
    expect(limpio.campos).toEqual({ a: 1 })
  })

  // `procesarDocumento` sigue usando el objeto original para su update: mutarlo dejaria
  // el borrado dependiendo del orden de las lineas.
  it('no muta el objeto recibido', () => {
    const data = { _devolucion: MARCA_OK, drive_url: 'https://x' }
    limpiarDevolucion(data)
    expect(data._devolucion).toBeDefined()
  })

  it('sobre data vacia o nula devuelve un objeto vacio', () => {
    expect(limpiarDevolucion(null)).toEqual({})
    expect(limpiarDevolucion(undefined)).toEqual({})
  })
})

describe('puedeDevolverBloque', () => {
  it('los roles de mando pueden devolver sin estar en el caso', () => {
    expect(puedeDevolverBloque('owner', false)).toBe(true)
    expect(puedeDevolverBloque('admin', false)).toBe(true)
    expect(puedeDevolverBloque('supervisor', false)).toBe(true)
  })

  // Este es el caso que motiva el frente: operaciones detecta el error en un documento
  // cuyo bloque es de comercial. `guardEditarBloque` lo dejaria por fuera.
  it('un operativo asignado al caso puede devolver', () => {
    expect(puedeDevolverBloque('operator', true)).toBe(true)
  })

  it('quien no trabaja el caso no puede devolver', () => {
    expect(puedeDevolverBloque('operator', false)).toBe(false)
    expect(puedeDevolverBloque('read_only', false)).toBe(false)
    expect(puedeDevolverBloque('contador', false)).toBe(false)
  })

  it('sin rol resuelto manda el ser responsable', () => {
    expect(puedeDevolverBloque(null, true)).toBe(true)
    expect(puedeDevolverBloque(undefined, undefined)).toBe(false)
  })
})

describe('origenDeCopiaHeredada', () => {
  it('devuelve el slug del original cuando la copia es readonly', () => {
    expect(origenDeCopiaHeredada({
      readonly: true,
      heredado: true,
      source_bloque_slug: 'certificado_bancario',
      source_etapa_orden: 18,
    })).toBe('certificado_bancario')
  })

  it('el bloque original no tiene origen: se devuelve sobre si mismo', () => {
    expect(origenDeCopiaHeredada({ devolucion_habilitada: true })).toBeNull()
  })

  it('readonly sin slug no dice a donde redirigir, y no se adivina', () => {
    expect(origenDeCopiaHeredada({ readonly: true, source_etapa_orden: 18 })).toBeNull()
    expect(origenDeCopiaHeredada({ readonly: true, source_bloque_slug: '' })).toBeNull()
  })

  it('un slug sin readonly tampoco alcanza', () => {
    expect(origenDeCopiaHeredada({ source_bloque_slug: 'certificado_bancario' })).toBeNull()
  })

  it('tolera config vacia', () => {
    expect(origenDeCopiaHeredada(null)).toBeNull()
    expect(origenDeCopiaHeredada(undefined)).toBeNull()
  })
})

describe('debeMoverElCaso', () => {
  // El caso real: Generacion (numero 16) devuelve el certificado bancario, que vive en
  // Anexos (numero 15). Por `orden` seria 13 contra 18 y no se moveria nada.
  it('desde Generacion hacia Anexos: mueve', () => {
    expect(debeMoverElCaso(16, 15)).toBe(true)
  })

  it('desde Seguimiento hacia Anexos: mueve', () => {
    expect(debeMoverElCaso(18, 15)).toBe(true)
  })

  it('ya esta en la etapa del origen: no mueve, solo reabre', () => {
    expect(debeMoverElCaso(15, 15)).toBe(false)
  })

  it('el caso va mas atras que el origen: no se empuja hacia adelante', () => {
    expect(debeMoverElCaso(5, 15)).toBe(false)
  })

  it('sin numero resuelto no se mueve nada', () => {
    expect(debeMoverElCaso(null, 15)).toBe(false)
    expect(debeMoverElCaso(16, null)).toBe(false)
    expect(debeMoverElCaso(undefined, undefined)).toBe(false)
  })
})
