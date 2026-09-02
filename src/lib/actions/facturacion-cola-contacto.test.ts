/**
 * La cola pinta el correo y el teléfono QUE VAN A VIAJAR A SIIGO, no el crudo
 * del contacto.
 *
 * El defecto: `getColaFacturacion` armaba el borrador del cliente con la regla
 * correcta (`borradorCliente`: el contacto gana, el RUT es el respaldo) y después
 * construía la fila de la pantalla con `contacto.email` / `contacto.telefono`.
 * Cuando el contacto no tenía correo, la casilla salía vacía **aunque el RUT sí
 * lo trajera y aunque la factura se fuera a emitir a ese correo** — y el caso
 * tampoco aparecía con "email" entre sus faltantes. La pantalla se contradecía
 * sola y Diana salía a buscar un dato que el sistema ya tenía.
 *
 * MEDIDO CONTRA PRODUCCIÓN el 2026-09-02, sobre los 110 casos pendientes de la
 * cola de SOENA: **69 mostraban el correo vacío**, los 69 con `faltan_cliente`
 * sin "email", y **0 estaban de verdad sin correo**. Después del arreglo: 0 con
 * la casilla vacía.
 *
 * LAS QUE SE VIERON FALLAR contra `origin/main` (2026-09-02):
 *   - el correo del RUT se pinta cuando el contacto no lo tiene → email: null
 *   - el teléfono del RUT se pinta cuando el contacto no lo tiene → telefono: null
 *   - un "teléfono" que Siigo no acepta se pinta vacío        → '@handle'
 *   - el teléfono se pinta como viaja, sin indicativo          → '+57 3001234567'
 *
 * Las otras dos (el contacto gana sobre el RUT; sin correo en ninguna parte se
 * dice que falta) pasan también contra `main`: están para que el arreglo no
 * invierta la precedencia ni tape un faltante real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RUT_COMPLETO, WS, reiniciarDoble, sembrar, servicioFalso } from '../../../test/cola-facturacion-doble'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS,
    staffId: 'staff-diana',
    role: 'owner',
    areas: ['financiera'],
    supabase: null,
  }),
}))

// Sin red. Ninguna prueba de este archivo toca Siigo.
vi.mock('@/lib/siigo/client', () => ({
  siigoRequest: async () => ({ results: [] }),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { getColaFacturacion } from './facturacion-actions'

const sinRut = <K extends string>(...quitar: K[]) => {
  const r: Record<string, { value: unknown }> = { ...RUT_COMPLETO }
  for (const k of quitar) delete r[k]
  return r
}

beforeEach(reiniciarDoble)

const unCaso = async () => {
  const { data, error } = await getColaFacturacion()
  expect(error).toBeUndefined()
  return data!.casos[0]
}

describe('cola de facturación — el correo que se pinta es el que va a Siigo', () => {
  it('sin correo en el contacto, se pinta el del RUT', async () => {
    // Es el caso de V0408/V0409/V0410 en producción: comparten un contacto con
    // `email` en null mientras el RUT trae victorcofla@hotmail.com.
    sembrar({ casos: 1, contacto: () => ({ email: null, telefono: '3142557450' }) })
    const caso = await unCaso()

    expect(caso.email).toBe('victor@example.com')
    // Y la otra mitad de la contradicción: la pantalla no puede pintar vacío y a
    // la vez no listar "email" entre lo que falta.
    expect(caso.faltan_cliente).not.toContain('email')
  })

  it('el contacto gana sobre el RUT, que es el respaldo', async () => {
    // La precedencia es deliberada: el contacto lo mantiene vivo el comercial, el
    // RUT es una foto del documento. Pintar el borrador NO puede invertirla.
    sembrar({ casos: 1, contacto: () => ({ email: 'nuevo@empresa.co', telefono: null }) })
    expect((await unCaso()).email).toBe('nuevo@empresa.co')
  })

  it('sin correo en ninguna parte, la casilla va vacía Y el caso lo declara faltante', async () => {
    sembrar({
      casos: 1,
      contacto: () => ({ email: null, telefono: '3142557450' }),
      rut: () => sinRut('email'),
    })
    const caso = await unCaso()

    expect(caso.email).toBeNull()
    expect(caso.faltan_cliente).toContain('email')
  })
})

describe('cola de facturación — el teléfono que se pinta es el que va a Siigo', () => {
  it('sin teléfono en el contacto, se pinta el del RUT', async () => {
    sembrar({
      casos: 1,
      contacto: () => ({ email: null, telefono: null }),
      rut: () => ({ ...RUT_COMPLETO, telefono: { value: '3112544909' } }),
    })
    expect((await unCaso()).telefono).toBe('3112544909')
  })

  it('un usuario de Instagram guardado como teléfono se pinta VACÍO', async () => {
    // Medido en producción el 2026-09-02: 3 contactos de casos pendientes tienen
    // un handle (`@juandavidmoreno`, `@JohannaMBS`, `@beatrixes`) en la columna
    // `telefono`. Siigo nunca lo recibió —`telefonoParaSiigo` lo descarta— así
    // que pintarlo afirmaba un teléfono que no existe. Que quede vacío es lo que
    // hace que alguien lo escriba antes de emitir.
    sembrar({
      casos: 1,
      contacto: () => ({ email: null, telefono: '@juandavidmoreno' }),
      rut: () => ({ ...RUT_COMPLETO, telefono: { value: '3203413840' } }),
    })
    expect((await unCaso()).telefono).toBeNull()
  })

  it('se pinta el número nacional, sin el indicativo, igual que viaja', async () => {
    sembrar({ casos: 1, contacto: () => ({ email: null, telefono: '+57 3001234567' }) })
    expect((await unCaso()).telefono).toBe('3001234567')
  })
})
