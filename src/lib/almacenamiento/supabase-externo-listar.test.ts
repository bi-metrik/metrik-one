/**
 * `listarNegocio` recorre el prefijo del negocio en Storage. El doble de bucket APLICA
 * lo que hace la API real: un `list(dir)` devuelve solo el primer nivel, las carpetas
 * vienen con `id: null` y sin metadata, y pagina con `limit`/`offset`. Sin eso el
 * recorrido en anchura y la paginación no se pondrían a prueba.
 */
import { describe, expect, it } from 'vitest'
import { AlmacenamientoSupabaseExterno } from './supabase-externo'

const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const base = `negocios/${NEG}`

type Obj = { bytes: number; actualizado: string; mime: string }

function bucketDoble(objetos: Record<string, Obj>) {
  const llamadas: Array<{ dir: string; offset: number }> = []
  return {
    llamadas,
    list: async (dir: string, o: { limit: number; offset: number }) => {
      llamadas.push({ dir, offset: o.offset })
      const hijos = new Map<string, { carpeta: boolean; obj?: Obj }>()
      for (const [path, obj] of Object.entries(objetos)) {
        if (!path.startsWith(`${dir}/`)) continue
        const resto = path.slice(dir.length + 1)
        const [primero, ...mas] = resto.split('/')
        if (mas.length > 0) hijos.set(primero, { carpeta: true })
        else hijos.set(primero, { carpeta: false, obj })
      }
      const entradas = [...hijos.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, h]) =>
          h.carpeta
            ? { name, id: null, updated_at: null, created_at: null, metadata: null }
            : {
                name,
                id: `id-${name}`,
                updated_at: h.obj!.actualizado,
                created_at: h.obj!.actualizado,
                metadata: { size: h.obj!.bytes, mimetype: h.obj!.mime },
              },
        )
      return { data: entradas.slice(o.offset, o.offset + o.limit), error: null }
    },
  }
}

function almacenCon(objetos: Record<string, Obj>) {
  const bucket = bucketDoble(objetos)
  const a = new AlmacenamientoSupabaseExterno('trappvel', 'https://ejemplo.supabase.co', 'llave-de-prueba')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(a as any).sb = { storage: { from: () => bucket } }
  return { a, bucket }
}

const obj = (bytes = 10): Obj => ({ bytes, actualizado: '2026-09-14T20:00:00Z', mime: 'application/pdf' })

describe('AlmacenamientoSupabaseExterno.listarNegocio', () => {
  it('recorre subcarpetas de varios niveles y devuelve tamaño, fecha y tipo', async () => {
    const { a } = almacenCon({
      [`${base}/5-documentos-del-viajero/pasaporte.pdf`]: obj(1234),
      [`${base}/1-legal/propuestas/propuesta-v1.pdf`]: obj(),
      [`${base}/suelto.pdf`]: obj(),
    })
    const r = await a.listarNegocio(NEG)
    expect(r.truncado).toBe(false)
    expect(r.archivos.map((x) => x.path).sort()).toEqual([
      `${base}/1-legal/propuestas/propuesta-v1.pdf`,
      `${base}/5-documentos-del-viajero/pasaporte.pdf`,
      `${base}/suelto.pdf`,
    ])
    expect(r.archivos.find((x) => x.path.endsWith('pasaporte.pdf'))).toMatchObject({
      bytes: 1234,
      actualizado: '2026-09-14T20:00:00Z',
      mime: 'application/pdf',
    })
  })

  it('no entra a las subidas pendientes ni cuenta el marcador de carpeta vacía', async () => {
    const { a, bucket } = almacenCon({
      [`${base}/_pendientes/bloque-1.pdf`]: obj(),
      [`${base}/2-legal/.emptyFolderPlaceholder`]: obj(0),
      [`${base}/2-legal/contrato.pdf`]: obj(),
    })
    const r = await a.listarNegocio(NEG)
    expect(r.archivos.map((x) => x.path)).toEqual([`${base}/2-legal/contrato.pdf`])
    expect(bucket.llamadas.some((l) => l.dir.endsWith('_pendientes'))).toBe(false)
  })

  it('pagina: una carpeta con más de 100 objetos se lee entera', async () => {
    const muchos: Record<string, Obj> = {}
    for (let i = 0; i < 230; i++) muchos[`${base}/4-reservas/r-${String(i).padStart(3, '0')}.pdf`] = obj()
    const { a, bucket } = almacenCon(muchos)
    const r = await a.listarNegocio(NEG)
    expect(r.archivos).toHaveLength(230)
    expect(r.truncado).toBe(false)
    expect(bucket.llamadas.filter((l) => l.dir.endsWith('4-reservas')).map((l) => l.offset)).toEqual([0, 100, 200])
  })

  it('un negocio sin nada en Storage devuelve lista vacía, no error', async () => {
    const { a } = almacenCon({ [`negocios/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d/x.pdf`]: obj() })
    expect(await a.listarNegocio(NEG)).toEqual({ archivos: [], truncado: false })
  })

  it('un error de Storage se propaga: nunca se disfraza de repositorio vacío', async () => {
    const a = new AlmacenamientoSupabaseExterno('trappvel', 'https://ejemplo.supabase.co', 'llave-de-prueba')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(a as any).sb = { storage: { from: () => ({ list: async () => ({ data: null, error: { message: 'boom' } }) }) } }
    await expect(a.listarNegocio(NEG)).rejects.toThrow('No se pudo listar')
  })
})
