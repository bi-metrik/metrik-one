/**
 * De aquí sale el precio de lista de un servicio y los parámetros con los que se cobra.
 * Un valor mal leído es un cobro equivocado, así que estas pruebas se reparten en dos mitades:
 * lo que TIENE que leer bien, y lo que TIENE que rechazar en vez de adivinar.
 */
import { describe, it, expect } from 'vitest'
import { ErrorFrontmatter, leerFrontmatter, separarFrontmatter } from './frontmatter'

const ARCHIVO = `---
tipo: servicio
slug: valida-api-bolsa
version: 1
nombre: Paquete de consultas Valida API
modulo: valida_api
disparador_cobro: consumo
tratamiento_iva: excluido              # decisión del 2026-09-15
precios_lista_fuente: decisiones/2026-09-07_escalera-pricing-volumen-valida
parametros:
  consultas:                  { tipo: entero, min: 1000 }
  precio:                     { tipo: cop }
  vigencia_meses:             { tipo: entero, por_defecto: 6 }
  avisos_consumo_pct:         { tipo: lista, por_defecto: [80, 95] }
documentos: [terminos-uso-valida@2.0, politica-datos-valida@1.5]
---

Cuerpo en markdown, que no se lee.
`

describe('lo que lee bien', () => {
  const fm = leerFrontmatter(ARCHIVO)

  it('escalares: texto, entero y el texto que parece versión', () => {
    expect(fm.slug).toBe('valida-api-bolsa')
    expect(fm.version).toBe(1)
    expect(fm.nombre).toBe('Paquete de consultas Valida API')
  })

  it('el comentario al final de una línea no entra al valor', () => {
    expect(fm.tratamiento_iva).toBe('excluido')
  })

  it('el bloque anidado con mapas en línea', () => {
    expect(fm.parametros).toEqual({
      consultas: { tipo: 'entero', min: 1000 },
      precio: { tipo: 'cop' },
      vigencia_meses: { tipo: 'entero', por_defecto: 6 },
      avisos_consumo_pct: { tipo: 'lista', por_defecto: [80, 95] },
    })
  })

  it('la lista en línea de primer nivel', () => {
    expect(fm.documentos).toEqual(['terminos-uso-valida@2.0', 'politica-datos-valida@1.5'])
  })

  it('el cuerpo del markdown no entra', () => {
    expect(Object.keys(fm)).not.toContain('Cuerpo en markdown, que no se lee.')
  })

  it('booleanos y decimales', () => {
    const fm2 = leerFrontmatter('---\na: true\nb: false\nc: 1.5\nd: -3\n---\n')
    expect(fm2).toEqual({ a: true, b: false, c: 1.5, d: -3 })
  })

  it('una cadena entrecomillada se respeta aunque parezca número', () => {
    const fm2 = leerFrontmatter('---\nnit: "900123456"\ntexto: \'a # b\'\n---\n')
    expect(fm2.nit).toBe('900123456')
    expect(fm2.texto).toBe('a # b')
  })

  it('un entero con cero a la izquierda queda como texto, no como número', () => {
    // `01` como 1 sería inventar una interpretación: un consecutivo o un código no es un número.
    expect(leerFrontmatter('---\ncodigo: 013\n---\n').codigo).toBe('013')
  })

  it('una lista vacía en línea es una lista vacía', () => {
    expect(leerFrontmatter('---\ndocumentos: []\n---\n').documentos).toEqual([])
  })

  it('un mapa vacío declarado en línea sí pasa', () => {
    expect(leerFrontmatter('---\nparametros: {}\n---\n').parametros).toEqual({})
  })

  it('un BOM al principio no rompe el delimitador', () => {
    expect(leerFrontmatter('\uFEFF---\na: 1\n---\n')).toEqual({ a: 1 })
  })
})

describe('lo que rechaza en vez de adivinar', () => {
  const rechaza = (texto: string, fragmento: RegExp) => {
    let e: unknown
    try {
      leerFrontmatter(texto)
    } catch (err) {
      e = err
    }
    expect(e, `esperaba que rechazara: ${JSON.stringify(texto)}`).toBeInstanceOf(ErrorFrontmatter)
    expect((e as Error).message).toMatch(fragmento)
  }

  it('un archivo sin frontmatter', () => rechaza('# solo markdown\n', /no empieza con el delimitador/))
  it('un frontmatter sin cerrar', () => rechaza('---\na: 1\n', /no se cierra/))
  it('una lista con guiones', () => rechaza('---\ndocs:\n  - a\n  - b\n---\n', /no con guiones/))
  it('dos niveles de anidamiento', () =>
    rechaza('---\na:\n  b:\n    c: 1\n---\n', /solo anida un nivel/))
  it('una clave repetida arriba', () => rechaza('---\na: 1\na: 2\n---\n', /clave repetida/))
  it('una clave repetida dentro del bloque', () =>
    rechaza('---\np:\n  a: { x: 1 }\n  a: { x: 2 }\n---\n', /clave repetida/))
  it('una clave repetida dentro de un mapa en línea', () =>
    rechaza('---\na: { x: 1, x: 2 }\n---\n', /clave repetida/))
  it('sangría con tabulador', () => rechaza('---\np:\n\ta: { x: 1 }\n---\n', /tabulador/))
  it('sangría que no calza con la del bloque', () =>
    rechaza('---\np:\n  a: { x: 1 }\n    b: { x: 2 }\n---\n', /sangría de 4/))
  it('sangría sin una clave que la abra', () =>
    rechaza('---\n  a: 1\n---\n', /sin una clave que la abra/))
  it('una línea que no es clave: valor', () => rechaza('---\nsuelta\n---\n', /no es clave: valor/))
  it('una lista sin cerrar', () => rechaza('---\na: [1, 2\n---\n', /sin cerrar/))
  it('un mapa en línea sin cerrar', () => rechaza('---\na: { x: 1\n---\n', /sin cerrar/))
  it('una comilla sin cerrar dentro de una lista', () =>
    rechaza('---\na: ["abc, 2]\n---\n', /sin cerrar/))
  it('una cadena multilínea con |', () => rechaza('---\na: |\n  hola\n---\n', /no admite "\|"/))
  it('un ancla de YAML', () => rechaza('---\na: &ancla 1\n---\n', /no admite "&"/))
  it('un null explícito', () => rechaza('---\na: null\n---\n', /omití la clave/))
  it('un bloque sangrado que quedó sin hijos', () =>
    rechaza('---\nparametros:\nslug: x\n---\n', /quedó sin contenido/))
  it('una clave vacía', () => rechaza('---\n: 1\n---\n', /clave vacía/))
})

describe('separarFrontmatter', () => {
  it('devuelve el bloque crudo y desde qué línea del archivo empieza', () => {
    expect(separarFrontmatter('---\na: 1\nb: 2\n---\ncuerpo\n')).toEqual({
      crudo: 'a: 1\nb: 2',
      primeraLinea: 2,
    })
  })

  it('el número de línea del error apunta al archivo, no al bloque', () => {
    // `b` está en la línea 3 del archivo (1: ---, 2: a, 3: b).
    let e: unknown
    try {
      leerFrontmatter('---\na: 1\nb: null\n---\n')
    } catch (err) {
      e = err
    }
    expect((e as ErrorFrontmatter).linea).toBe(3)
  })
})
