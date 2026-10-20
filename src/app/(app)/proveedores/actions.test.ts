/**
 * Las acciones de «Proveedores» sobre el doble de Supabase (Mauricio, 2026-10-18): la ficha es el
 * perfil de #1202, se crea sin duplicar, los datos se revisan en el servidor, los tarifarios solo se
 * registran si el archivo subido es de ese proveedor, y las cuentas bancarias son del área
 * financiera y las verifica otra persona. Nada sale a la red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const sesion = vi.hoisted(() => ({ role: 'owner' as string, areas: [] as string[], staffId: '' }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: sesion.staffId, userId: 'u-1', role: sesion.role, areas: sesion.areas, error: null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
const subida = vi.hoisted(() => ({ confirma: true }))
vi.mock('@/lib/proveedores/almacen', () => ({
  urlDeSubida: async (_ws: string, p: string, clase: string, ext: string) => ({ ok: true, ruta: `ruta/${p}/${clase}.${ext}`, token: 't' }),
  confirmarSubida: async (_ws: string, p: string, clase: string, ruta: string) =>
    subida.confirma ? { ok: true, ref: `one://fotos-catalogo/${ruta}`, bytes: 1000, mime: 'application/pdf' } : { ok: false, error: 'No encontramos el archivo subido. Vuelve a subirlo.' },
  enlaceDeArchivo: async () => 'https://firmada.example/x',
  borrarArchivo: async () => {},
  descargarArchivo: async (_ws: string, _p: string, clase: string, ref: string) => (clase === 'tarifarios' && ref ? { datos: new Uint8Array([37, 80, 68, 70]), mime: 'application/pdf' } : null),
}))
// El motor corre con un modelo SIMULADO: ninguna prueba llama al modelo de verdad.
const motor = vi.hoisted(() => ({ respuesta: '{}', llamadas: [] as string[][], revienta: false }))
vi.mock('@/lib/proveedores/motor', async (original) => {
  const real = await original<typeof import('@/lib/proveedores/motor')>()
  const { MockLanguageModelV4 } = await import('ai/test')
  return {
    ...real,
    correrMotor: (p: Parameters<typeof real.correrMotor>[0]) => {
      motor.llamadas.push(p.archivos.map((a) => a.nombre))
      if (motor.revienta) throw new Error('excepción inesperada')
      const modelo = new MockLanguageModelV4({
        modelId: 'modelo-simulado',
        doGenerate: async () => ({
          content: [{ type: 'text', text: motor.respuesta }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: [],
        }),
      })
      return real.correrMotor({ ...p, modelo })
    },
  }
})
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  enlacesDeCatalogo: async (_ws: string, refs: string[]) => new Map(refs.map((r) => [r, `https://firmada.example/${r.split('/').pop()}`])),
}))

const WS = '11111111-2222-4333-8444-555555555555'
const OTRO_WS = '99999999-2222-4333-8444-555555555555'
const ANA = 'a0000000-0000-4000-8000-000000000001'
const BETO = 'b0000000-0000-4000-8000-000000000002'
const CAROL = 'c0000000-0000-4000-8000-000000000003'
const HOTEL = 'd0000000-0000-4000-8000-000000000001'
const MAYORISTA = 'd0000000-0000-4000-8000-000000000002'
const IBEROSTAR = 'd0000000-0000-4000-8000-000000000003'

import { claveDeFoto } from '@/lib/fotos/clave'
import { fotosParaTarjetas } from '../fotos/actions'
import { cerrarCargaExtraccion, confirmarCiudad, elegirTarifarioDeFicha, extraerTarifario, guardarExtraccion, leerExtraccion, usarSugerenciasDeExtraccion, crearProveedor, guardarCuenta, guardarDatos, leerCuentas, leerFicha, leerProveedores, marcarTarifasPedidas, pedirSubida, registrarTarifario, verificarCuenta } from './actions'

const perfil = (id: string, tipo: string, nombre: string, ciudad: string | null, extra: Fila = {}): Fila => ({
  id, workspace_id: WS, tipo, clave: claveDeFoto(tipo === 'proveedor' ? 'hotel' : (tipo as 'hotel'), nombre, ciudad), nombre, ciudad,
  tipo_proveedor: tipo === 'proveedor' ? 'mayorista' : tipo, etiquetas: [], tarifas_mayorista: false, responsable_tarifas_id: null, comprado_via_id: null, origen: 'cotizacion', origen_ref: null, ...extra,
})

function sembrar(plantilla = 'trappvel') {
  base.secuencia = 0
  base.tablas = {
    workspaces: [{ id: WS, cotizacion_template_slug: plantilla, config_extra: {} }],
    staff: [
      { id: ANA, workspace_id: WS, full_name: 'Ana', is_active: true },
      { id: BETO, workspace_id: WS, full_name: 'Beto', is_active: true },
      { id: CAROL, workspace_id: OTRO_WS, full_name: 'Carol', is_active: true },
    ],
    fotos_perfiles: [
      perfil(HOTEL, 'hotel', 'Catalonia Puerta del Sol', 'Madrid', { comprado_via_id: MAYORISTA, responsable_tarifas_id: ANA }),
      perfil(MAYORISTA, 'proveedor', 'Mayorista Uno', null),
      perfil(IBEROSTAR, 'hotel', 'Iberostar Selection Bávaro', 'Punta Cana'),
    ],
    fotos_perfiles_alias: [],
    fotos_catalogo: [
      // Un hotel de antes, solo con fotos (sin fila de perfil).
      { id: 'f1', workspace_id: WS, tipo: 'hotel', clave: claveDeFoto('hotel', 'H10 Metropolitan', 'Barcelona'), nombre: 'H10 Metropolitan', ciudad: 'Barcelona', ref: `one://fotos-catalogo/${WS}/hotel/${'a'.repeat(16)}.jpg`, origen: 'asesora', revisada: true, principal: true, posicion: 1 },
    ],
    proveedor_tarifarios: [
      { id: 't1', workspace_id: WS, proveedor_id: MAYORISTA, ref: null, nombre_archivo: 'Tarifas 2025.pdf', vigente_desde: '2025-01-01', vigente_hasta: '2025-12-31', vigencia_inferida: true, subido_at: '2025-01-02T00:00:00Z' },
    ],
    proveedor_cuentas: [],
    proveedor_cuentas_historial: [],
    proveedor_extracciones: [],
  }
}

beforeEach(() => {
  sesion.role = 'owner'
  sesion.areas = []
  sesion.staffId = ANA
  subida.confirma = true
  sembrar()
})

describe('la lista', () => {
  it('sin propuesta de viaje la ruta no existe', async () => {
    sembrar('estandar')
    const r = await leerProveedores()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no tiene/)
  })

  it('semáforo (con el respaldo del mayorista), miniatura y el hotel que solo tenía fotos recibe su ficha', async () => {
    const r = await leerProveedores()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const catalonia = r.proveedores.find((p) => p.id === HOTEL)!
    expect(catalonia).toMatchObject({ semaforo: 'vencido', hasta: '2025-12-31', delMayorista: true, responsableId: ANA })
    expect(r.proveedores.find((p) => p.id === IBEROSTAR)?.semaforo).toBe('sin_tarifario')
    const h10 = r.proveedores.find((p) => p.nombre === 'H10 Metropolitan')
    expect(h10?.miniatura).toMatch(/^https:\/\/firmada\.example\//)
    expect(base.tablas.fotos_perfiles).toHaveLength(4)
  })
})

describe('crear sin duplicar', () => {
  it('el mismo hotel con otro nombre abre el que ya está (y guarda el alias)', async () => {
    const r = await crearProveedor({ nombre: 'Hotel Catalonia Puerta del Sol', tipoProveedor: 'hotel', ciudad: 'Madrid' })
    expect(r).toEqual({ ok: true, id: HOTEL, yaExistia: true })
    expect(base.tablas.fotos_perfiles_alias).toHaveLength(1)
    expect(base.tablas.fotos_perfiles).toHaveLength(3)
  })

  it('uno que solo se parece pregunta; «es otro» lo crea con origen manual', async () => {
    const r = await crearProveedor({ nombre: 'Iberostar Selection Bávaro Suites', tipoProveedor: 'hotel', ciudad: 'Punta Cana' })
    expect(r).toEqual({ ok: true, duda: { id: IBEROSTAR, nombre: 'Iberostar Selection Bávaro', ciudad: 'Punta Cana' } })
    expect(base.tablas.fotos_perfiles).toHaveLength(3)
    const f = await crearProveedor({ nombre: 'Iberostar Selection Bávaro Suites', tipoProveedor: 'hotel', ciudad: 'Punta Cana', forzar: true })
    expect(f).toMatchObject({ ok: true, yaExistia: false })
    expect(base.tablas.fotos_perfiles.at(-1)).toMatchObject({ tipo: 'hotel', tipo_proveedor: 'hotel', origen: 'manual' })
  })

  it('un mayorista va al espacio sin fotos; el mismo nombre otra vez abre el mismo', async () => {
    const a = await crearProveedor({ nombre: 'Transportes Ruta', tipoProveedor: 'transporte', ciudad: 'Cartagena' })
    expect(a).toMatchObject({ ok: true, yaExistia: false })
    expect(base.tablas.fotos_perfiles.at(-1)).toMatchObject({ tipo: 'proveedor', tipo_proveedor: 'transporte' })
    const b = await crearProveedor({ nombre: 'transportes  ruta', tipoProveedor: 'transporte', ciudad: 'Cartagena' })
    expect(b).toMatchObject({ ok: true, yaExistia: true })
  })

  it('un rol de solo lectura no crea', async () => {
    sesion.role = 'read_only'
    expect(await crearProveedor({ nombre: 'X', tipoProveedor: 'hotel', ciudad: null })).toMatchObject({ ok: false })
  })
})

describe('datos de la ficha', () => {
  it('guarda normalizado; el responsable es del equipo; se compra solo a través de un mayorista', async () => {
    const r = await guardarDatos(IBEROSTAR, { nombre: 'Iberostar Selection Bávaro', tipoProveedor: 'hotel', ciudad: 'Punta Cana', celular: '300 123 4567', etiquetas: ['Luna de Miel', 'lujo'], responsableId: BETO, compradoViaId: MAYORISTA, estrellas: 5 })
    expect(r).toEqual({ ok: true, alias: false })
    expect(base.tablas.fotos_perfiles_alias).toEqual([])
    expect(base.tablas.fotos_perfiles.find((p) => p.id === IBEROSTAR)).toMatchObject({ celular: '+573001234567', celular_original: '300 123 4567', etiquetas: ['luna de miel', 'lujo'], responsable_tarifas_id: BETO, comprado_via_id: MAYORISTA, estrellas: 5, updated_by: ANA })
    expect(await guardarDatos(IBEROSTAR, { nombre: 'X', tipoProveedor: 'hotel', responsableId: CAROL })).toMatchObject({ ok: false, error: expect.stringMatching(/equipo/) })
    expect(await guardarDatos(IBEROSTAR, { nombre: 'X', tipoProveedor: 'hotel', compradoViaId: HOTEL })).toMatchObject({ ok: false, error: expect.stringMatching(/mayorista/) })
    expect(await guardarDatos(IBEROSTAR, { nombre: '', tipoProveedor: 'hotel' })).toMatchObject({ ok: false })
  })

  it('cambiar la ciudad no mueve la llave: guarda el alias con la llave nueva (una vez)', async () => {
    const claveVieja = claveDeFoto('hotel', 'Iberostar Selection Bávaro', 'Punta Cana')
    const r = await guardarDatos(IBEROSTAR, { nombre: 'Iberostar Selection Bávaro', tipoProveedor: 'hotel', ciudad: 'Higüey', departamento: 'La Altagracia', destino: 'Internacional - República Dominicana', pais: 'DO' })
    expect(r).toEqual({ ok: true, alias: true })
    const fila = base.tablas.fotos_perfiles.find((p) => p.id === IBEROSTAR)
    expect(fila).toMatchObject({ clave: claveVieja, ciudad: 'Higüey', departamento: 'La Altagracia', destino: 'Internacional - República Dominicana', pais: 'DO' })
    expect(base.tablas.fotos_perfiles_alias).toEqual([
      expect.objectContaining({ workspace_id: WS, perfil_id: IBEROSTAR, tipo: 'hotel', clave: claveDeFoto('hotel', 'Iberostar Selection Bávaro', 'Higüey'), ciudad: 'Higüey', created_by: ANA }),
    ])
    // Guardar otra vez lo mismo no duplica el alias.
    expect(await guardarDatos(IBEROSTAR, { nombre: 'Iberostar Selection Bávaro', tipoProveedor: 'hotel', ciudad: 'Higüey', pais: 'DO' })).toEqual({ ok: true, alias: false })
    expect(base.tablas.fotos_perfiles_alias).toHaveLength(1)
  })

  it('si la llave nueva ya es de otra ficha, no guarda (serían dos fichas del mismo proveedor)', async () => {
    const r = await guardarDatos(IBEROSTAR, { nombre: 'Catalonia Puerta del Sol', tipoProveedor: 'hotel', ciudad: 'Madrid' })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/otra ficha/) })
    expect(base.tablas.fotos_perfiles.find((p) => p.id === IBEROSTAR)).toMatchObject({ nombre: 'Iberostar Selection Bávaro', ciudad: 'Punta Cana' })
    expect(base.tablas.fotos_perfiles_alias).toEqual([])
  })

  it('un proveedor sin fotos (mayorista) cambia de ciudad sin alias', async () => {
    expect(await guardarDatos(MAYORISTA, { nombre: 'Mayorista Uno', tipoProveedor: 'mayorista', ciudad: 'Bogotá' })).toEqual({ ok: true, alias: false })
    expect(base.tablas.fotos_perfiles_alias).toEqual([])
  })

  it('confirmar la ciudad quita la nota «Ciudad por confirmar» y la ficha queda completa', async () => {
    const f = base.tablas.fotos_perfiles.find((p) => p.id === IBEROSTAR) as Fila
    Object.assign(f, { pais: 'DO', notas: 'Ciudad por confirmar\nPide tarifas por correo' })
    const antes = await leerFicha(IBEROSTAR)
    expect(antes.ok && antes.ficha.faltas.map((x) => x.texto)).toEqual(['La ciudad está por confirmar'])
    expect(antes.ok && antes.ficha.ciudadPorConfirmar).toBe(true)
    expect(await confirmarCiudad(IBEROSTAR)).toEqual({ ok: true })
    expect(f.notas).toBe('Pide tarifas por correo')
    const despues = await leerFicha(IBEROSTAR)
    expect(despues.ok && despues.ficha.faltas).toEqual([])
    sesion.role = 'read_only'
    expect(await confirmarCiudad(IBEROSTAR)).toMatchObject({ ok: false })
  })

  it('un departamento por ciudad no se confirma: ni el botón ni la acción del servidor', async () => {
    const f = base.tablas.fotos_perfiles.find((p) => p.id === IBEROSTAR) as Fila
    for (const ciudad of ['Boyaca', 'CUNDINAMARCA', 'Quindío']) {
      Object.assign(f, { ciudad, pais: 'CO', notas: 'Ciudad por confirmar' })
      const r = await leerFicha(IBEROSTAR)
      expect(r.ok && r.ficha.ciudadEsDepartamento).toBe(true)
      expect(r.ok && r.ficha.faltas.map((x) => x.texto)).toEqual([`«${ciudad}» es un departamento: escribe el municipio`])
      expect(await confirmarCiudad(IBEROSTAR)).toMatchObject({ ok: false, error: expect.stringMatching(/departamento: escribe el municipio/) })
      expect(f.notas).toBe('Ciudad por confirmar')
    }
    // Con el municipio, sí.
    Object.assign(f, { ciudad: 'Tunja' })
    const r = await leerFicha(IBEROSTAR)
    expect(r.ok && r.ficha.ciudadEsDepartamento).toBe(false)
    expect(await confirmarCiudad(IBEROSTAR)).toEqual({ ok: true })
    expect(f.notas).toBeNull()
  })

  it('guardar un departamento en «Ciudad» avisa y la ficha sigue por clasificar', async () => {
    const r = await guardarDatos(IBEROSTAR, { nombre: 'Hotel Ficticio', tipoProveedor: 'hotel', ciudad: 'Boyacá', pais: 'CO' })
    expect(r).toMatchObject({ ok: true, aviso: expect.stringMatching(/«Boyacá» es un departamento: escribe el municipio.*por clasificar/) })
    const ficha = await leerFicha(IBEROSTAR)
    expect(ficha.ok && ficha.ficha.faltas.map((x) => x.campo)).toEqual(['ciudad'])
    // Fuera de Colombia el mismo nombre no se juzga.
    expect(await guardarDatos(IBEROSTAR, { nombre: 'Hotel Ficticio', tipoProveedor: 'hotel', ciudad: 'Boyacá', pais: 'PE' })).not.toHaveProperty('aviso')
    const lista = await leerProveedores()
    expect(lista.ok && lista.proveedores.find((p) => p.id === IBEROSTAR)?.ciudadEsDepartamento).toBe(false)
    await guardarDatos(IBEROSTAR, { nombre: 'Hotel Ficticio', tipoProveedor: 'hotel', ciudad: 'Cundinamarca', pais: 'CO' })
    const lista2 = await leerProveedores()
    expect(lista2.ok && lista2.proveedores.find((p) => p.id === IBEROSTAR)?.ciudadEsDepartamento).toBe(true)
    expect(lista2.ok && lista2.proveedores.find((p) => p.id === HOTEL)?.ciudadEsDepartamento).toBe(false)
  })

  it('la lista marca las fichas por clasificar', async () => {
    const r = await leerProveedores()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const porId = new Map(r.proveedores.map((p) => [p.id, p.faltas]))
    expect(porId.get(HOTEL)).toEqual(['Falta el país'])
    expect(porId.get(MAYORISTA)).toEqual(['Falta la ciudad (el municipio donde duerme o se presta el servicio)', 'Falta el país'])
  })

  it('marcar las tarifas como pedidas anota fecha y persona', async () => {
    expect(await marcarTarifasPedidas(HOTEL)).toEqual({ ok: true })
    expect(base.tablas.fotos_perfiles.find((p) => p.id === HOTEL)).toMatchObject({ tarifas_solicitadas_por: ANA, tarifas_solicitadas_at: expect.any(String) })
  })

  it('la ficha trae los tarifarios del mayorista como respaldo', async () => {
    const r = await leerFicha(HOTEL)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ficha.via).toMatchObject({ id: MAYORISTA, nombre: 'Mayorista Uno' })
    expect(r.ficha.via?.tarifarios[0]).toMatchObject({ nombreArchivo: 'Tarifas 2025.pdf', tieneArchivo: false, inferida: true, estado: 'vencido' })
    expect(r.verCuentas).toBe(true)
    expect(await leerFicha('no-es-un-id')).toMatchObject({ ok: false })
  })
})

describe('tarifarios', () => {
  it('solo se registra si el archivo subido es de ese proveedor; queda con quien lo subió', async () => {
    expect(await pedirSubida(HOTEL, 'tarifarios', 'application/zip', 10)).toMatchObject({ ok: false })
    expect(await pedirSubida(HOTEL, 'tarifarios', 'application/pdf', 30_000_000)).toMatchObject({ ok: false })
    expect(await pedirSubida(HOTEL, 'tarifarios', 'application/pdf', 1000)).toMatchObject({ ok: true })
    subida.confirma = false
    expect(await registrarTarifario(HOTEL, { ruta: 'x', nombreArchivo: 'T.pdf', desde: '2026-01-01', hasta: '2026-12-31' })).toMatchObject({ ok: false })
    expect(base.tablas.proveedor_tarifarios).toHaveLength(1)
    subida.confirma = true
    expect(await registrarTarifario(HOTEL, { ruta: 'x', nombreArchivo: 'T.pdf', desde: '2026-12-31', hasta: '2026-01-01' })).toMatchObject({ ok: false, error: expect.stringMatching(/antes/) })
    expect(await registrarTarifario(HOTEL, { ruta: 'x', nombreArchivo: 'Tarifas 2026.pdf', desde: '2026-01-01', hasta: '2026-12-31', temporada: 'Alta' })).toEqual({ ok: true })
    expect(base.tablas.proveedor_tarifarios.at(-1)).toMatchObject({ proveedor_id: HOTEL, workspace_id: WS, subido_por: ANA, vigente_hasta: '2026-12-31', temporada: 'Alta', vigencia_inferida: false })
  })
})

describe('cuentas bancarias', () => {
  it('sin área financiera no se ven ni se cargan', async () => {
    sesion.role = 'operator'
    sesion.areas = ['comercial']
    expect(await leerCuentas(HOTEL)).toMatchObject({ ok: false, error: expect.stringMatching(/financiera/) })
    expect(await guardarCuenta(HOTEL, null, { banco: 'B', tipoCuenta: 'ahorros', numero: '123456', titular: 'T' })).toMatchObject({ ok: false })
    expect(await pedirSubida(HOTEL, 'cuentas', 'application/pdf', 100)).toMatchObject({ ok: false })
    sesion.areas = ['financiera']
    expect(await leerCuentas(HOTEL)).toMatchObject({ ok: true })
  })

  it('nace pendiente; quien la cargó no la verifica; otra persona sí', async () => {
    expect(await guardarCuenta(HOTEL, null, { banco: 'Bancolombia', tipoCuenta: 'ahorros', numero: '123-456789-00', titular: 'Hotel SAS', titularDocumento: '900123456' })).toEqual({ ok: true })
    const cuenta = base.tablas.proveedor_cuentas[0]
    // El doble no corre el default de la base: el estado inicial lo pone la tabla.
    cuenta.estado = 'pendiente'
    cuenta.id = 'e0000000-0000-4000-8000-000000000001'
    cuenta.retirada_at = null
    expect(cuenta).toMatchObject({ workspace_id: WS, proveedor_id: HOTEL, cargada_por: ANA })
    expect(await verificarCuenta(cuenta.id as string)).toMatchObject({ ok: false, error: expect.stringMatching(/otra persona/) })
    sesion.staffId = BETO
    expect(await verificarCuenta(cuenta.id as string)).toEqual({ ok: true })
    expect(cuenta).toMatchObject({ estado: 'verificada', verificada_por: BETO })
  })

  it('una cuenta de otro espacio no se lee aunque cuelgue del mismo id de proveedor', async () => {
    base.tablas.proveedor_cuentas.push({ id: 'e0000000-0000-4000-8000-000000000009', workspace_id: OTRO_WS, proveedor_id: HOTEL, banco: 'Ajeno', tipo_cuenta: 'ahorros', numero: '999', titular: 'X', estado: 'pendiente', cargada_por: CAROL, retirada_at: null })
    const r = await leerCuentas(HOTEL)
    expect(r.ok && r.cuentas).toEqual([])
  })
})

describe('la tarjeta de la cotización', () => {
  it('trae la ficha con sus tarifarios y los del mayorista', async () => {
    const r = await fotosParaTarjetas([{ tipo: 'hotel', nombre: 'Catalonia Puerta del Sol', ciudad: 'Madrid' }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tarjetas[0].proveedor).toEqual({
      id: HOTEL,
      nombre: 'Catalonia Puerta del Sol',
      tarifarios: [],
      via: { id: MAYORISTA, nombre: 'Mayorista Uno', tarifarios: [{ desde: '2025-01-01', hasta: '2025-12-31' }] },
      faltas: ['Falta el país'],
      ivaDeclarado: null,
    })
  })
})

describe('la tarjeta: una sola vigencia y la ficha fijada en la línea', () => {
  it('con una extracción revisada, el aviso usa su vigencia confirmada (la del tarifario queda de respaldo)', async () => {
    // El mayorista tiene un tarifario de 2025, y una extracción revisada que vale todo 2027.
    base.tablas.proveedor_extracciones.push(
      { id: 'x1', workspace_id: WS, proveedor_id: MAYORISTA, estado: 'revisada', created_at: '2026-10-19T10:00:00Z', vigencia_desde: '2027-01-01', vigencia_hasta: '2027-12-31' },
      // Un borrador más nuevo no cambia la vigencia, y la de otro espacio no se lee.
      { id: 'x2', workspace_id: WS, proveedor_id: MAYORISTA, estado: 'borrador', created_at: '2026-10-20T10:00:00Z', vigencia_desde: null, vigencia_hasta: null },
      { id: 'x3', workspace_id: OTRO_WS, proveedor_id: HOTEL, estado: 'revisada', created_at: '2026-10-21T10:00:00Z', vigencia_desde: '2030-01-01', vigencia_hasta: '2030-12-31' },
    )
    const r = await fotosParaTarjetas([{ tipo: 'hotel', nombre: 'Catalonia Puerta del Sol', ciudad: 'Madrid' }])
    expect(r.ok && r.tarjetas[0].proveedor).toMatchObject({ id: HOTEL, tarifarios: [], via: { id: MAYORISTA, tarifarios: [{ desde: '2027-01-01', hasta: '2027-12-31' }] } })
  })

  it('la ficha que la línea fijó manda sobre la que se reconoce por el nombre', async () => {
    const r = await fotosParaTarjetas([
      { tipo: 'hotel', nombre: 'Catalonia Puerta del Sol', ciudad: 'Madrid' },
      { tipo: 'hotel', nombre: 'Catalonia Puerta del Sol', ciudad: 'Madrid', proveedorId: IBEROSTAR },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tarjetas.find((t) => !t.proveedorId)?.proveedor?.id).toBe(HOTEL)
    expect(r.tarjetas.find((t) => t.proveedorId === IBEROSTAR)?.proveedor).toMatchObject({ id: IBEROSTAR, nombre: 'Iberostar Selection Bávaro' })
    // Una ficha de otro espacio no se lee aunque la pidan por id.
    base.tablas.fotos_perfiles.push({ ...perfil('d0000000-0000-4000-8000-0000000000ff', 'hotel', 'Ajeno', 'Madrid'), workspace_id: OTRO_WS })
    const otra = await fotosParaTarjetas([{ tipo: 'hotel', nombre: 'Catalonia Puerta del Sol', ciudad: 'Madrid', proveedorId: 'd0000000-0000-4000-8000-0000000000ff' }])
    expect(otra.ok && otra.tarjetas.find((t) => t.proveedorId)?.proveedor).toBeNull()
  })
})

describe('extracciones del motor', () => {
  const json = JSON.stringify({
    esquema_version: '0.2',
    expediente: { archivos: [{ archivo: 'tar0_TARIFAS 2027.pdf', decision: 'usar' }], pedir_actualizacion: ['Temporada media sin fechas'] },
    tarifario: { canal: 'neta', moneda: 'COP', impuestos: { iva_declarado: true, iva_incluido: false }, temporadas: [{}], tarifas: [{}, {}] },
    datos_ficha: { ciudad: 'Madrid' },
  })

  it('se guarda en el espacio con quien la subió; la ficha ve el resumen y usa lo que no sabía', async () => {
    expect(await leerExtraccion(HOTEL)).toMatchObject({ ok: true, extraccion: null })
    expect(await guardarExtraccion(HOTEL, '{"esquema_version":"9.9","expediente":{}}')).toMatchObject({ ok: false })
    expect(await guardarExtraccion(HOTEL, json, { instruccion: 'v8', modelo: 'modelo-de-prueba' })).toEqual({ ok: true, avisos: ['Vigencia por confirmar al cargar.'] })
    expect(base.tablas.proveedor_extracciones[0]).toMatchObject({ workspace_id: WS, proveedor_id: HOTEL, esquema_version: '0.2', instruccion_version: 'v8', creada_por: ANA, archivos: ['tar0_TARIFAS 2027.pdf'] })
    base.tablas.proveedor_extracciones[0].estado = 'borrador'
    base.tablas.proveedor_extracciones[0].created_at = '2026-10-19T10:00:00Z'
    const r = await leerExtraccion(HOTEL)
    expect(r.ok && r.extraccion?.resumen).toMatchObject({ tarifas: 2, temporadas: 1, pedir: ['Temporada media sin fechas'] })
    expect(r.ok && r.extraccion?.sugerencias).toEqual({ tarifaCanal: 'neta', ivaDeclarado: true, ivaIncluido: false })
    expect(await usarSugerenciasDeExtraccion(HOTEL)).toEqual({ ok: true })
    expect(base.tablas.fotos_perfiles.find((p) => p.id === HOTEL)).toMatchObject({ tarifa_canal: 'neta', iva_declarado: true, iva_incluido: false })
  })

  it('no pisa lo que una persona ya anotó en la ficha', async () => {
    Object.assign(base.tablas.fotos_perfiles.find((p) => p.id === HOTEL) as Fila, { tarifa_canal: 'comisionable', iva_declarado: false })
    await guardarExtraccion(HOTEL, json)
    Object.assign(base.tablas.proveedor_extracciones[0], { estado: 'borrador', created_at: '2026-10-19T10:00:00Z' })
    const r = await leerExtraccion(HOTEL)
    expect(r.ok && r.extraccion?.sugerencias).toEqual({ tarifaCanal: null, ivaDeclarado: null, ivaIncluido: false })
  })

  it('una extracción de otro espacio no se lee', async () => {
    base.tablas.proveedor_extracciones.push({ id: 'x9', workspace_id: OTRO_WS, proveedor_id: HOTEL, estado: 'borrador', created_at: '2026-10-19T10:00:00Z', expediente: {}, tarifario: null, archivos: [] })
    expect(await leerExtraccion(HOTEL)).toMatchObject({ ok: true, extraccion: null, uso: { fichasConExtraccion: [] } })
  })
})

describe('motor v13: carga, cadena y extracción desde ONE', () => {
  const CADENA = HOTEL
  /** Un PDF ficticio de una cadena con tres hoteles, sin vigencia escrita (L40). */
  const extraccion = (vigencia: Record<string, unknown> = { desde: null, hasta: null, texto: 'Tarifas temporada actual', fuente: 'ninguna', requiere_confirmacion: true }) =>
    JSON.stringify({
      esquema_version: '0.3',
      expediente: { archivos: [{ archivo: 'tar0_Tarifas cadena.pdf', decision: 'usar' }], pedir_actualizacion: ['pedir la vigencia del tarifario'] },
      tarifario: {
        moneda: 'COP',
        vigencia,
        tarifas: [
          { establecimiento: 'Cadena Ficticia Centro', categoria: 'Estándar', precio: 300000, moneda: 'COP' },
          { establecimiento: 'Cadena Ficticia Playa', categoria: 'Estándar', precio: 350000, moneda: 'COP' },
          { establecimiento: 'Cadena Ficticia Cancún', categoria: 'Estándar', precio: 180, moneda: 'COP' },
        ],
      },
    })
  const sembrarExtraccion = async (json = extraccion()) => {
    expect(await guardarExtraccion(CADENA, json)).toMatchObject({ ok: true })
    const x = base.tablas.proveedor_extracciones[base.tablas.proveedor_extracciones.length - 1]
    Object.assign(x, { id: 'e0000000-0000-4000-8000-000000000001', estado: 'borrador', created_at: '2026-10-19T10:00:00Z', monedas: {} })
    return x
  }

  it('sin vigencia, la carga no se cierra hasta que la persona escribe las fechas; entonces cuenta para cotizar', async () => {
    const x = await sembrarExtraccion()
    let r = await leerExtraccion(CADENA)
    expect(r.ok && r.extraccion).toMatchObject({ estado: 'borrador', vigenciaPorConfirmar: true, vigenciaConfirmada: null })
    expect(r.ok && r.uso?.cotiza).toEqual({ ok: false, motivo: expect.stringMatching(/no se ha cerrado/) })

    expect(await cerrarCargaExtraccion(x.id as string, {})).toMatchObject({ ok: false, error: expect.stringMatching(/escribe la vigencia/) })
    expect(x.estado).toBe('borrador')
    expect(await cerrarCargaExtraccion(x.id as string, { desde: '2027-01-01', hasta: '2027-12-31', monedas: { establecimientos: { 'Cadena Ficticia Cancún': 'USD' } } })).toEqual({ ok: true })
    expect(x).toMatchObject({ estado: 'revisada', vigencia_desde: '2027-01-01', vigencia_hasta: '2027-12-31', vigencia_por: 'persona', revisada_por: ANA, monedas: { establecimientos: { 'Cadena Ficticia Cancún': 'USD' } } })

    // Tres hoteles en el PDF: la ficha tiene que elegir el suyo.
    r = await leerExtraccion(CADENA)
    expect(r.ok && r.uso?.cotiza).toEqual({ ok: false, motivo: expect.stringMatching(/varios establecimientos/) })
    expect(await elegirTarifarioDeFicha(CADENA, { establecimiento: 'Cadena Ficticia Centro' })).toEqual({ ok: true })
    r = await leerExtraccion(CADENA)
    expect(r.ok && r.uso).toMatchObject({ establecimiento: 'Cadena Ficticia Centro', cotiza: { ok: true, tarifas: 1 } })
  })

  it('una segunda ficha usa el mismo PDF de cadena con su propio establecimiento', async () => {
    const x = await sembrarExtraccion(extraccion({ desde: '2027-01-01', hasta: '2027-12-31', texto: 'Vigencia 2027', fuente: 'contenido', requiere_confirmacion: false }))
    expect(await cerrarCargaExtraccion(x.id as string, {})).toEqual({ ok: true })
    expect(x).toMatchObject({ vigencia_desde: '2027-01-01', vigencia_hasta: '2027-12-31', vigencia_por: 'motor' })

    // La otra ficha ve la de la cadena como opción…
    let r = await leerExtraccion(IBEROSTAR)
    expect(r.ok && r.uso?.fichasConExtraccion).toEqual([{ id: CADENA, nombre: 'Catalonia Puerta del Sol' }])
    expect(await elegirTarifarioDeFicha(IBEROSTAR, { tarifarioDeId: IBEROSTAR })).toMatchObject({ ok: false })
    expect(await elegirTarifarioDeFicha(IBEROSTAR, { tarifarioDeId: CADENA, establecimiento: 'Hotel que no está' })).toMatchObject({ ok: false, error: expect.stringMatching(/no es un establecimiento/) })
    expect(await elegirTarifarioDeFicha(IBEROSTAR, { tarifarioDeId: CADENA, establecimiento: 'Cadena Ficticia Playa' })).toEqual({ ok: true })
    r = await leerExtraccion(IBEROSTAR)
    expect(r.ok && r.extraccion?.deOtraFicha).toEqual({ id: CADENA, nombre: 'Catalonia Puerta del Sol' })
    expect(r.ok && r.uso).toMatchObject({ tarifarioDe: { id: CADENA }, establecimiento: 'Cadena Ficticia Playa', cotiza: { ok: true, tarifas: 1 } })
  })

  it('una extracción nueva sin revisar no tapa la revisada: la cotización sigue con sus precios y la ficha avisa', async () => {
    const x = await sembrarExtraccion(extraccion({ desde: '2027-01-01', hasta: '2027-12-31', texto: 'Vigencia 2027', fuente: 'contenido', requiere_confirmacion: false }))
    expect(await cerrarCargaExtraccion(x.id as string, {})).toEqual({ ok: true })
    expect(await elegirTarifarioDeFicha(CADENA, { establecimiento: 'Cadena Ficticia Centro' })).toEqual({ ok: true })
    let r = await leerExtraccion(CADENA)
    expect(r.ok && r.uso).toMatchObject({ cotiza: { ok: true, tarifas: 1 }, nuevaPorRevisar: null })
    // Otra corrida del motor, más nueva, queda en borrador.
    expect(await guardarExtraccion(CADENA, extraccion())).toMatchObject({ ok: true })
    Object.assign(base.tablas.proveedor_extracciones[base.tablas.proveedor_extracciones.length - 1], { id: 'e0000000-0000-4000-8000-000000000002', estado: 'borrador', created_at: '2026-10-20T10:00:00Z', monedas: {} })
    r = await leerExtraccion(CADENA)
    // La ficha muestra la nueva para revisarla…
    expect(r.ok && r.extraccion).toMatchObject({ id: 'e0000000-0000-4000-8000-000000000002', estado: 'borrador' })
    // …pero para cotizar cuenta la revisada, y lo dice.
    expect(r.ok && r.uso).toMatchObject({ cotiza: { ok: true, tarifas: 1 }, nuevaPorRevisar: { revisadaAt: '2026-10-19T10:00:00Z' } })
  })

  it('una extracción de otro espacio no se cierra desde aquí', async () => {
    base.tablas.proveedor_extracciones.push({ id: 'e0000000-0000-4000-8000-000000000009', workspace_id: OTRO_WS, proveedor_id: HOTEL, estado: 'borrador', tarifario: null, expediente: {}, archivos: [] })
    expect(await cerrarCargaExtraccion('e0000000-0000-4000-8000-000000000009', { desde: '2027-01-01', hasta: '2027-12-31' })).toMatchObject({ ok: false })
    expect(base.tablas.proveedor_extracciones[0].estado).toBe('borrador')
  })

  it('«Extraer con el motor» manda los tarifarios con archivo y guarda con modelo e instrucción v13', async () => {
    base.tablas.proveedor_tarifarios.push(
      { id: 't2', workspace_id: WS, proveedor_id: CADENA, ref: `one://fotos-catalogo/${WS}/proveedores/${CADENA}/tarifarios/${'b'.repeat(32)}.pdf`, nombre_archivo: 'Tarifas cadena.pdf', mime: 'application/pdf', subido_at: '2026-10-01T00:00:00Z' },
      { id: 't3', workspace_id: WS, proveedor_id: CADENA, ref: null, nombre_archivo: 'Importado sin archivo.pdf', mime: null, subido_at: '2026-10-02T00:00:00Z' },
    )
    motor.llamadas = []
    motor.respuesta = extraccion()
    expect(await extraerTarifario(CADENA)).toEqual({ ok: true, avisos: ['Vigencia por confirmar al cargar.'] })
    expect(motor.llamadas).toEqual([['tar0_Tarifas cadena.pdf']])
    expect(base.tablas.proveedor_extracciones[0]).toMatchObject({ workspace_id: WS, proveedor_id: CADENA, esquema_version: '0.3', modelo: 'modelo-simulado', instruccion_version: 'v13', creada_por: ANA })

    // Una salida que la torre rechaza no se guarda.
    motor.respuesta = JSON.stringify({ esquema_version: '0.3', expediente: { archivos: [] }, tarifario: { tarifas: [{ precio: 1 }] } })
    expect(await extraerTarifario(CADENA)).toMatchObject({ ok: false, error: expect.stringMatching(/sin moneda/) })
    expect(base.tablas.proveedor_extracciones).toHaveLength(1)
  })

  it('si la extracción revienta, la acción responde con un mensaje y no guarda', async () => {
    base.tablas.proveedor_tarifarios.push({ id: 't2', workspace_id: WS, proveedor_id: CADENA, ref: `one://fotos-catalogo/${WS}/proveedores/${CADENA}/tarifarios/${'b'.repeat(32)}.pdf`, nombre_archivo: 'Tarifas cadena.pdf', mime: 'application/pdf', subido_at: '2026-10-01T00:00:00Z' })
    motor.revienta = true
    try {
      expect(await extraerTarifario(CADENA)).toEqual({ ok: false, error: 'La extracción no se pudo completar. Vuelve a intentarlo en un rato.' })
    } finally {
      motor.revienta = false
    }
    expect(base.tablas.proveedor_extracciones).toHaveLength(0)
  })

  it('sin tarifarios con archivo no llama al motor; un rol de solo lectura tampoco', async () => {
    motor.llamadas = []
    expect(await extraerTarifario(IBEROSTAR)).toMatchObject({ ok: false, error: expect.stringMatching(/sube al menos uno/) })
    sesion.role = 'read_only'
    expect(await extraerTarifario(CADENA)).toMatchObject({ ok: false })
    expect(motor.llamadas).toEqual([[]])
  })
})
