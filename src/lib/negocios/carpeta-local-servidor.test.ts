import { describe, it, expect } from 'vitest'
import { guardarCarpetaLocal } from './carpeta-local-servidor'

/**
 * La escritura de la carpeta contra un doble de `negocios` que PERSISTE y APLICA los
 * filtros `.eq()`, y que mueve `updated_at` en cada update como el trigger
 * `negocios_updated_at`. Con un doble de solo lectura, "no pisó la otra clave" y "ni
 * siquiera escribió" se verían igual.
 */

type Fila = { id: string; workspace_id: string; metadata: Record<string, unknown>; updated_at: string }

function doble(fila: Fila, opciones: { antesDeCadaUpdate?: (f: Fila) => void; errorAlLeer?: boolean } = {}) {
  let reloj = 0
  const estado = { lecturas: 0, updates: 0 }
  const cumple = (filtros: Array<[string, unknown]>) =>
    filtros.every(([col, val]) => (fila as unknown as Record<string, unknown>)[col] === val)

  const client = {
    from(tabla: string) {
      if (tabla !== 'negocios') throw new Error(`tabla inesperada: ${tabla}`)
      return {
        select() {
          const filtros: Array<[string, unknown]> = []
          const q = {
            eq(col: string, val: unknown) { filtros.push([col, val]); return q },
            async maybeSingle() {
              estado.lecturas++
              if (opciones.errorAlLeer) return { data: null, error: { message: 'timeout' } }
              if (!cumple(filtros)) return { data: null, error: null }
              return { data: { metadata: structuredClone(fila.metadata), updated_at: fila.updated_at }, error: null }
            },
          }
          return q
        },
        update(patch: { metadata: Record<string, unknown> }) {
          const filtros: Array<[string, unknown]> = []
          const q = {
            eq(col: string, val: unknown) { filtros.push([col, val]); return q },
            async select() {
              // Otro proceso escribe entre la lectura de quien guarda y su update.
              opciones.antesDeCadaUpdate?.(fila)
              if (!cumple(filtros)) return { data: [], error: null }
              estado.updates++
              fila.metadata = structuredClone(patch.metadata)
              fila.updated_at = `t-escrito-${++reloj}` // el trigger lo mueve siempre
              return { data: [{ id: fila.id }], error: null }
            },
          }
          return q
        },
      }
    },
  }
  return { client, estado }
}

const nueva = (metadata: Record<string, unknown>): Fila => ({
  id: 'n-1',
  workspace_id: 'ws-1',
  metadata,
  updated_at: 't-0',
})

describe('guardarCarpetaLocal', () => {
  it('escribe la carpeta y conserva las demás claves', async () => {
    const fila = nueva({ siigo_cliente: { identificacion: '123' } })
    const { client } = doble(fila)
    const r = await guardarCarpetaLocal(client, 'ws-1', 'n-1', 'proyectos/soena/ve/')
    expect(r).toEqual({ ok: true, anterior: null })
    expect(fila.metadata).toEqual({ siigo_cliente: { identificacion: '123' }, carpeta_local: 'proyectos/soena/ve/' })
  })

  it('borrar quita la clave, también cuando lo guardado era un texto vacío', async () => {
    const fila = nueva({ carpeta_local: '', reproceso: { activo: true } })
    const { client, estado } = doble(fila)
    const r = await guardarCarpetaLocal(client, 'ws-1', 'n-1', null)
    expect(r.ok).toBe(true)
    expect(estado.updates).toBe(1)
    expect('carpeta_local' in fila.metadata).toBe(false)
    expect(fila.metadata).toEqual({ reproceso: { activo: true } })
  })

  it('una escritura ajena en el medio NO se pierde: se relee y se fusiona sobre ella', async () => {
    const fila = nueva({ reproceso: { activo: true } })
    let ajenaHecha = false
    const { client, estado } = doble(fila, {
      antesDeCadaUpdate: f => {
        if (ajenaHecha) return
        ajenaHecha = true
        f.metadata = { ...f.metadata, siigo_factura: { numero: 'FV-2-244' } }
        f.updated_at = 't-ajena'
      },
    })
    const r = await guardarCarpetaLocal(client, 'ws-1', 'n-1', 'proyectos/soena/ve/')
    expect(r.ok).toBe(true)
    expect(estado.lecturas).toBe(2)
    expect(fila.metadata).toEqual({
      reproceso: { activo: true },
      siigo_factura: { numero: 'FV-2-244' },
      carpeta_local: 'proyectos/soena/ve/',
    })
  })

  it('si el negocio no deja de cambiar, se rinde sin escribir encima', async () => {
    const fila = nueva({ reproceso: { activo: true } })
    let n = 0
    const { client, estado } = doble(fila, {
      antesDeCadaUpdate: f => { f.updated_at = `t-ajena-${++n}` },
    })
    const r = await guardarCarpetaLocal(client, 'ws-1', 'n-1', 'proyectos/soena/ve/')
    expect(r.ok).toBe(false)
    expect(estado.updates).toBe(0)
    expect(fila.metadata).toEqual({ reproceso: { activo: true } })
  })

  it('si no pudo leer la metadata de ahora, no escribe', async () => {
    const fila = nueva({ reproceso: { activo: true } })
    const { client, estado } = doble(fila, { errorAlLeer: true })
    const r = await guardarCarpetaLocal(client, 'ws-1', 'n-1', 'proyectos/soena/ve/')
    expect(r).toEqual({ ok: false, error: 'timeout' })
    expect(estado.updates).toBe(0)
  })

  it('el mismo valor no escribe (ni mueve updated_at)', async () => {
    const fila = nueva({ carpeta_local: 'proyectos/soena/ve/' })
    const { client, estado } = doble(fila)
    const r = await guardarCarpetaLocal(client, 'ws-1', 'n-1', 'proyectos/soena/ve/')
    expect(r).toEqual({ ok: true, anterior: 'proyectos/soena/ve/' })
    expect(estado.updates).toBe(0)
    expect(fila.updated_at).toBe('t-0')
  })

  it('no toca un negocio de otro workspace', async () => {
    const fila = nueva({})
    const { client, estado } = doble(fila)
    const r = await guardarCarpetaLocal(client, 'ws-OTRO', 'n-1', 'proyectos/soena/ve/')
    expect(r).toEqual({ ok: false, error: 'Negocio no encontrado' })
    expect(estado.updates).toBe(0)
  })
})
