import { describe, it, expect } from 'vitest'
import { validarDefinicion } from './definicion'
import { CLAVES_DE_MODULO } from '@/lib/modulos/catalogo'

const VALIDA: Record<string, unknown> = {
  tipo: 'servicio',
  slug: 'valida-api-bolsa',
  version: 1,
  nombre: 'Paquete de consultas Valida API',
  modulo: 'valida_api',
  disparador_cobro: 'consumo',
  tratamiento_iva: 'excluido',
  tratamiento_iva_fuente: 'decisiones/2026-09-16_suscripciones-sin-iva-cloud-computing-excluido',
  precios_lista_fuente: 'decisiones/2026-09-07_escalera-pricing-volumen-valida',
  parametros: {
    consultas: { tipo: 'entero', min: 1000 },
    precio: { tipo: 'cop' },
    vigencia_meses: { tipo: 'entero', por_defecto: 6 },
    avisos_consumo_pct: { tipo: 'lista', por_defecto: [80, 95] },
  },
  documentos: ['terminos-uso-valida@2.0'],
}

const errores = (cambios: Record<string, unknown>) => validarDefinicion({ ...VALIDA, ...cambios }).errores

describe('una definición completa pasa', () => {
  it('y devuelve la definición leída', () => {
    const r = validarDefinicion(VALIDA)
    expect(r.errores).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.definicion?.slug).toBe('valida-api-bolsa')
  })

  it('`activo` cae en true y `documentos` en lista vacía cuando no se escriben', () => {
    const sin = { ...VALIDA }
    delete sin.documentos
    const r = validarDefinicion(sin)
    expect(r.definicion?.activo).toBe(true)
    expect(r.definicion?.documentos).toEqual([])
  })
})

describe('IVA: nada nace con 19 % (decisión del 2026-09-15)', () => {
  it('`tratamiento_iva` es obligatorio: no hay valor por defecto que heredar', () => {
    // Ojo con el atajo `errores({...})`: borrar la clave de una copia y pasarla por ahí la
    // reintroduce con el spread, y la prueba pasaría sin probar nada.
    const sin = { ...VALIDA }
    delete sin.tratamiento_iva
    expect(validarDefinicion(sin).errores.join(' ')).toMatch(/tratamiento_iva/)
  })

  it('un `gravado` sin `iva_pct` se rechaza', () => {
    // Un porcentaje ausente que caiga a 19 es justo lo que la decisión prohíbe.
    expect(errores({ tratamiento_iva: 'gravado' }).join(' ')).toMatch(/iva_pct/)
  })

  it('un `gravado` con su tarifa escrita sí pasa', () => {
    expect(errores({ tratamiento_iva: 'gravado', iva_pct: 19 })).toEqual([])
  })

  it('`iva_pct` sobre un `excluido` se rechaza: no aplica y confunde', () => {
    expect(errores({ iva_pct: 19 }).join(' ')).toMatch(/no aplica/)
  })

  it('un tratamiento inventado se rechaza', () => {
    expect(errores({ tratamiento_iva: 'no_gravado' }).length).toBeGreaterThan(0)
  })
})

describe('la comisión NO vive en el catálogo (N3)', () => {
  for (const clave of ['comision', 'comision_pct', 'comision_monto']) {
    it(`\`${clave}\` en un archivo de catálogo se rechaza con el motivo`, () => {
      const e = errores({ [clave]: 20 })
      expect(e.join(' ')).toMatch(/cada negocio o contrato/)
    })
  }

  it('`precio` tampoco: el catálogo cita la decisión, no copia el número', () => {
    expect(errores({ precio: 1_400_000 }).join(' ')).toMatch(/precios_lista_fuente/)
  })
})

describe('el módulo sale del catálogo de módulos de A1', () => {
  it('acepta las llaves que existen', () => {
    for (const clave of CLAVES_DE_MODULO) {
      expect(errores({ modulo: clave }), clave).toEqual([])
    }
  })

  it('rechaza una llave que ningún módulo enciende', () => {
    expect(errores({ modulo: 'facturacion_electronica' }).join(' ')).toMatch(/modulo/)
  })
})

describe('parámetros', () => {
  const conParam = (p: unknown) => errores({ parametros: { x: p } })

  it('un `por_defecto` que el propio parámetro rechazaría no pasa', () => {
    // Un contrato que naciera con ese valor sería inválido desde el día uno.
    expect(conParam({ tipo: 'entero', min: 1000, por_defecto: 10 }).join(' ')).toMatch(/por debajo del min/)
    expect(conParam({ tipo: 'entero', max: 2, por_defecto: 10 }).join(' ')).toMatch(/por encima del max/)
  })

  it('un `por_defecto` de otro tipo no pasa', () => {
    expect(conParam({ tipo: 'entero', por_defecto: 'seis' }).join(' ')).toMatch(/número/)
    expect(conParam({ tipo: 'entero', por_defecto: 1.5 }).join(' ')).toMatch(/entero/)
    expect(conParam({ tipo: 'booleano', por_defecto: 'si' }).join(' ')).toMatch(/true o false/)
    expect(conParam({ tipo: 'lista', por_defecto: 80 }).join(' ')).toMatch(/lista/)
    expect(conParam({ tipo: 'texto', por_defecto: 3 }).join(' ')).toMatch(/texto/)
  })

  it('min mayor que max no pasa', () => {
    expect(conParam({ tipo: 'entero', min: 10, max: 2 }).join(' ')).toMatch(/mayor que max/)
  })

  it('una clave desconocida dentro de un parámetro no pasa (un typo no se ignora)', () => {
    expect(conParam({ tipo: 'entero', minimo: 3 }).length).toBeGreaterThan(0)
  })

  it('un tipo de parámetro inventado no pasa', () => {
    expect(conParam({ tipo: 'moneda' }).length).toBeGreaterThan(0)
  })

  it('el nombre del parámetro va en minúsculas con guion bajo', () => {
    expect(errores({ parametros: { 'Consultas-Mes': { tipo: 'entero' } } }).length).toBeGreaterThan(0)
  })
})

describe('forma del archivo', () => {
  it('`tipo` tiene que decir `servicio`: un .md cualquiera del cerebro rebota por lo que es', () => {
    expect(errores({ tipo: 'decision' }).join(' ')).toMatch(/tipo/)
  })

  it('una clave desconocida arriba no se ignora en silencio', () => {
    expect(errores({ inventada: 1 }).length).toBeGreaterThan(0)
  })

  it('el slug va en kebab-case', () => {
    expect(errores({ slug: 'Valida_API' }).join(' ')).toMatch(/minúsculas/)
  })

  it('la versión es un entero desde 1', () => {
    expect(errores({ version: 0 }).length).toBeGreaterThan(0)
    expect(errores({ version: 1.5 }).length).toBeGreaterThan(0)
  })

  it('un documento se cita como slug@1.0', () => {
    expect(errores({ documentos: ['terminos-uso-valida'] }).join(' ')).toMatch(/slug@1\.0/)
  })

  it('el frontmatter tiene que ser un mapa', () => {
    expect(validarDefinicion([1, 2]).errores.join(' ')).toMatch(/mapa de claves/)
    expect(validarDefinicion(null).errores.join(' ')).toMatch(/mapa de claves/)
  })

  it('devuelve TODOS los errores juntos, no el primero', () => {
    const r = validarDefinicion({ tipo: 'servicio', slug: 'X', version: 0 })
    expect(r.errores.length).toBeGreaterThan(2)
  })
})
