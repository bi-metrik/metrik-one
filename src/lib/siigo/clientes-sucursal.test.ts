/**
 * Siigo resuelve el tercero de un documento por identificación MÁS sucursal.
 *
 * El 2026-09-07 la facturación de V0345 fallaba con
 * `The customer doesn't exist: 52644999 (customer.identification)` mientras el
 * tercero existía perfectamente en Siigo — vive en la sucursal 1 y ONE preguntaba
 * por la 0. El mensaje es literalmente cierto para Siigo y completamente engañoso
 * para quien lo lee.
 *
 * Estas pruebas fijan las DOS mitades del arreglo, y ninguna sirve sin la otra:
 *
 *   1. `asegurarClienteSiigo` ya no bota el `branch_office` que el GET devuelve.
 *   2. Una marca que no lo trae NO toma el atajo, así que las 252 marcas viejas
 *      se reparan solas la próxima vez que alguien intente facturar ese caso.
 *
 * Las tres se vieron FALLAR contra el código de `main` (2026-09-07): sin el punto
 * 2, la primera devuelve `branch_office: null` porque el atajo sale antes de
 * preguntarle a Siigo, y la tercera no vuelve a marcar nada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0345'

/** Única fila de `negocios`. El doble lee y escribe aquí. */
let fila: { id: string; contacto_id: string | null; metadata: Record<string, unknown> }
/** Sucursal que devuelve el GET de Siigo para el tercero. */
let sucursalEnSiigo: number | undefined = 1
/** Cuántas veces se le preguntó a Siigo por el tercero. */
let getsAlCatalogo = 0

function servicioFalso() {
  return {
    from(tabla: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        single: async () => ({ data: { ...fila }, error: null }),
        maybeSingle: async () =>
          tabla === 'contactos'
            ? { data: { email: 'diana@example.com', telefono: '3001234567' }, error: null }
            : { data: { ...fila }, error: null },
        // El bloque del RUT: el borrador del cliente sale de aquí.
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({
            data: tabla === 'negocio_bloques'
              ? [{
                  data: {
                    campos: {
                      numero_identificacion: { value: '52644999' },
                      primer_nombre: { value: 'DIANA' },
                      primer_apellido: { value: 'SILVA' },
                      tipo_persona: { value: 'Natural' },
                      direccion: { value: 'CALLE 100 # 10-10' },
                      pais: { value: 'Colombia' },
                      departamento: { value: 'Bogotá D.C.' },
                      municipio: { value: 'Bogotá' },
                    },
                  },
                }]
              : [],
            error: null,
          }),
      }
      return chain
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./client', async () => {
  const real = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...real,
    siigoRequest: async (_ws: string, ruta: string) => {
      if (ruta.startsWith('/v1/customers?identification=')) {
        getsAlCatalogo += 1
        return {
          results: [{ id: '0f169773-d247-495f-a5d3-e8f66cf0b602', branch_office: sucursalEnSiigo }],
        }
      }
      throw new Error(`ruta inesperada en el doble: ${ruta}`)
    },
  }
})

/** La fusión de la marca ya tiene sus propias pruebas: aquí solo se persiste. */
vi.mock('@/lib/negocios/marca-metadata', () => ({
  guardarMarcaEnMetadata: async (
    _svc: unknown,
    _ws: string,
    _neg: string,
    clave: string,
    marca: unknown,
  ) => {
    fila.metadata = { ...fila.metadata, [clave]: marca }
    return { ok: true as const }
  },
}))

import { asegurarClienteSiigo } from './clientes'

beforeEach(() => {
  getsAlCatalogo = 0
  sucursalEnSiigo = 1
  fila = { id: NEG, contacto_id: 'con-1', metadata: {} }
})

describe('asegurarClienteSiigo — la sucursal del tercero deja de botarse', () => {
  it('un tercero de la sucursal 1 devuelve 1, y la marca la guarda', async () => {
    const r = await asegurarClienteSiigo(WS, NEG)

    expect(r).toMatchObject({ estado: 'ya_existia', identificacion: '52644999', branch_office: 1 })
    expect(fila.metadata.siigo_cliente).toMatchObject({ identificacion: '52644999', branch_office: 1 })
  })

  it('una marca SIN sucursal se rehace sola: pregunta a Siigo y se re-marca', async () => {
    // Es el estado de las 252 marcas que ya existían el 2026-09-07.
    fila.metadata = {
      siigo_cliente: {
        identificacion: '52644999',
        siigo_id: '0f169773-d247-495f-a5d3-e8f66cf0b602',
        at: '2026-03-31T00:00:00.000Z',
        origen: 'automatico',
      },
    }

    const r = await asegurarClienteSiigo(WS, NEG)

    expect(getsAlCatalogo).toBe(1)
    expect(r).toMatchObject({ branch_office: 1 })
    expect(fila.metadata.siigo_cliente).toMatchObject({ branch_office: 1 })
  })

  it('una marca CON sucursal toma el atajo y NO vuelve a preguntarle a Siigo', async () => {
    // La autocorrección cuesta un GET por caso, una sola vez. Si el atajo no
    // volviera a valer, cada emisión pagaría esa llamada para siempre.
    fila.metadata = {
      siigo_cliente: {
        identificacion: '52644999',
        siigo_id: '0f169773-d247-495f-a5d3-e8f66cf0b602',
        branch_office: 1,
        at: '2026-09-07T00:00:00.000Z',
        origen: 'automatico',
      },
    }

    const r = await asegurarClienteSiigo(WS, NEG)

    expect(getsAlCatalogo).toBe(0)
    expect(r).toMatchObject({ estado: 'ya_existia', branch_office: 1 })
  })

  it('si Siigo no dice la sucursal, la marca se queda SIN ella en vez de inventar un 0', async () => {
    // Escribir un 0 que Siigo no dijo es exactamente el supuesto que produjo el
    // fallo: el caso volvería a fallar y el atajo taparía la causa.
    sucursalEnSiigo = undefined

    const r = await asegurarClienteSiigo(WS, NEG)

    expect(r).toMatchObject({ branch_office: null })
    expect(fila.metadata.siigo_cliente).not.toHaveProperty('branch_office')
  })
})
