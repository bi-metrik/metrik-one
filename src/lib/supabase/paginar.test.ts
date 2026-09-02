/**
 * `traerTodo` — el recorrido por páginas de PostgREST.
 *
 * Lo que estas pruebas cuidan es el modo de fallo, no la funcionalidad feliz:
 * PostgREST recorta en 1.000 filas devolviendo 200 y sin error, así que un
 * recorrido mal cerrado no se rompe, MIENTE. Cada prueba de aquí corresponde a
 * una forma concreta de volver a mentir.
 *
 * VISTAS FALLAR contra cinco mutaciones (2026-09-02), cada una tumbó pruebas:
 *   - cortar con `filas.length === 0` en vez de `< tamaño`  → caen 2
 *   - no acotar el tamaño de página al tope del servidor     → cae 1
 *   - devolver lo acumulado en vez de lanzar ante error      → caen 2
 *   - no validar una página sobredimensionada                → cae 1
 *   - ignorar el techo de filas                              → cae 1
 */
import { describe, it, expect } from 'vitest'
import { traerTodo, TAMANO_PAGINA_POSTGREST } from './paginar'

/**
 * Doble del servidor: tiene `total` filas y **recorta como PostgREST**, o sea que
 * nunca devuelve más de `maxRows` aunque le pidan un rango mayor. Sin esa parte el
 * doble no reproduce el defecto que se está arreglando.
 */
function servidorFalso(total: number, maxRows = TAMANO_PAGINA_POSTGREST) {
  const llamadas: Array<[number, number]> = []
  const pagina = async (desde: number, hasta: number) => {
    llamadas.push([desde, hasta])
    const pedidas = hasta - desde + 1
    const filas = Array.from({ length: total }, (_, i) => ({ id: i }))
      .slice(desde, desde + Math.min(pedidas, maxRows))
    return { data: filas, error: null }
  }
  return { pagina, llamadas }
}

describe('traerTodo — recorrido', () => {
  it('trae TODAS las filas cuando el lote excede el tamaño de página', async () => {
    const { pagina, llamadas } = servidorFalso(1115)
    const filas = await traerTodo(pagina, { etiqueta: 'prueba' })
    expect(filas).toHaveLength(1115)
    expect(filas[1114]).toEqual({ id: 1114 })
    expect(llamadas).toEqual([[0, 999], [1000, 1999]])
  })

  it('un lote que cae JUSTO en el límite pide la página siguiente', async () => {
    // El caso que un `if (filas.length === 0)` deja pasar y un `<=` rompe: con
    // 2.000 filas exactas, la segunda página viene llena y hay que pedir una
    // tercera para saber que se acabó.
    const { pagina, llamadas } = servidorFalso(2000)
    const filas = await traerTodo(pagina, { etiqueta: 'prueba' })
    expect(filas).toHaveLength(2000)
    expect(llamadas).toHaveLength(3)
    expect(llamadas[2]).toEqual([2000, 2999])
  })

  it('un lote por debajo del tamaño de página se resuelve en una sola llamada', async () => {
    const { pagina, llamadas } = servidorFalso(37)
    expect(await traerTodo(pagina, { etiqueta: 'prueba' })).toHaveLength(37)
    expect(llamadas).toHaveLength(1)
  })

  it('un resultado vacío no entra en bucle', async () => {
    const { pagina, llamadas } = servidorFalso(0)
    expect(await traerTodo(pagina, { etiqueta: 'prueba' })).toEqual([])
    expect(llamadas).toHaveLength(1)
  })

  it('no conserva duplicados ni huecos: las filas salen en orden y completas', async () => {
    const { pagina } = servidorFalso(2500)
    const filas = await traerTodo<{ id: number }>(pagina, { etiqueta: 'prueba' })
    expect(filas.map(f => f.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i))
  })
})

describe('traerTodo — no puede truncar en silencio', () => {
  it('pedir páginas MÁS grandes que el tope del servidor no engaña al recorrido', async () => {
    // Esta es la trampa que reintroduce el bug: si se pidieran 5.000 y el servidor
    // devolviera 1.000, una comparación ingenua leería "vino menos de lo que pedí,
    // se acabó" y perdería el resto. El tamaño se acota al tope real.
    const { pagina, llamadas } = servidorFalso(2500, 1000)
    const filas = await traerTodo(pagina, { etiqueta: 'prueba', tamanoPagina: 5000 })
    expect(filas).toHaveLength(2500)
    expect(llamadas[0]).toEqual([0, 999])
  })

  it('un error de la consulta LANZA y no devuelve lo que alcanzó a juntar', async () => {
    let n = 0
    const pagina = async (desde: number, hasta: number) => {
      n += 1
      if (n === 2) return { data: null, error: { message: 'timeout' } }
      const filas = Array.from({ length: hasta - desde + 1 }, (_, i) => ({ id: desde + i }))
      return { data: filas, error: null }
    }
    await expect(traerTodo(pagina, { etiqueta: 'cobros' })).rejects.toThrow(/\[cobros\].*timeout/)
  })

  it('pasarse del techo LANZA en vez de devolver una lista a medias', async () => {
    const { pagina } = servidorFalso(5000)
    await expect(
      traerTodo(pagina, { etiqueta: 'bloques', techoFilas: 2000 }),
    ).rejects.toThrow(/techo de 2000 filas/)
  })

  it('una página que devuelve más filas de las pedidas LANZA', async () => {
    // Implementación rota de la función de página (por ejemplo, olvidar `.range`).
    // Sin este guard el recorrido acumularía duplicados sin decir nada.
    const pagina = async () => ({
      data: Array.from({ length: 1500 }, (_, i) => ({ id: i })),
      error: null,
    })
    await expect(traerTodo(pagina, { etiqueta: 'rut' })).rejects.toThrow(/no está respetando el rango/)
  })

  it('el mensaje de error nombra la consulta, para no tener que adivinar cuál falló', async () => {
    const pagina = async () => ({ data: null, error: { message: 'rls' } })
    await expect(
      traerTodo(pagina, { etiqueta: 'facturacion/contactos' }),
    ).rejects.toThrow(/\[facturacion\/contactos\]/)
  })
})
