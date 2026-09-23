/**
 * Quién ve y quién opera `/suscripcion` (pedido de Mauricio, 2026-09-23): SOLO la persona designada
 * del contrato. Se prueba la cadena real (`contextoSuscripcion` → menú, página y acciones) con las
 * lecturas simuladas, porque la regla vive en el servidor y lo que hay que fijar es que las tres
 * superficies la obedezcan:
 *
 *   - la persona designada ve el ítem, abre la página y sus acciones escriben;
 *   - un dueño que no es la persona designada, un administrador y un operador: sin ítem, 404 y cada
 *     acción rechazada SIN tocar nada;
 *   - un contrato sin persona designada: nadie;
 *   - un platform admin en «Ver como» la persona designada la ve en solo lectura (las acciones que
 *     escriben o miden se rechazan); mirando como un operador, no la ve.
 *
 * Datos de cda-pruebas (medidos por PostgREST el 2026-09-23): el designado es un dueño; hay otro
 * dueño (el soporte de MeTRIK) y un operador.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '475da39a-5aa5-4857-a3c2-0d21277d8d53'
const SC = 'ca4ed5e1-4c2c-4150-90ce-9b76a4bfc9e5'
const DESIGNADO = '76856b58-6220-40f0-ae59-e08933d8f8f6'
const OTRO_DUENO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'
const OPERADOR = 'de50ff2a-cc51-4dc7-99a9-a39c67cd04b7'
const ADMIN = '99999999-9999-4999-8999-999999999999'
const PLATFORM_ADMIN = OTRO_DUENO

interface Sesion {
  usuarioId: string
  role: string
  usuarioEfectivoId?: string
  impersonando?: boolean
}

const escenario: { sesion: Sesion; designadoId: string | null } = {
  sesion: { usuarioId: DESIGNADO, role: 'owner' },
  designadoId: DESIGNADO,
}

const espias = {
  comprarLicencia: vi.fn(async () => ({ ok: true as const })),
  liberarLicencia: vi.fn(async () => ({ ok: true as const, desdeCuota: 2 })),
  invitarUsuario: vi.fn(async () => ({ ok: true as const, correoEnviado: true })),
  retirarUsuario: vi.fn(async () => ({ ok: true as const, sesionCerrada: true })),
  cambiarRolUsuario: vi.fn(async () => ({ ok: true as const })),
  reenviarInvitacion: vi.fn(async () => ({ ok: true as const })),
  descartarSugerencia: vi.fn(async () => ({ ok: true as const })),
  pedirContactoSustenta: vi.fn(async () => ({ ok: true as const, yaExistia: false, nombre: 'Ana' })),
  registrarEventoSugerencia: vi.fn(async () => {}),
}

vi.mock('@/lib/valida-cda/puerta', () => ({
  entradaValidaCda: async () => {
    const s = escenario.sesion
    return {
      tipo: 'ok',
      workspaceId: WS,
      usuarioId: s.usuarioId,
      usuarioEfectivoId: s.usuarioEfectivoId ?? s.usuarioId,
      impersonando: s.impersonando === true,
      role: s.role,
      estado: { estado: 'aprobada' },
      hoy: '2026-09-23',
      servicioContratadoId: SC,
      plazoTerminos: null,
      enPlazo: false,
    }
  },
  moraValidaCda: async () => ({ tipo: 'no_aplica' }),
  puedeVerPagosCda: async () => false,
}))
vi.mock('@/lib/valida-api/terminos-servidor', () => ({
  designacionDelEspacio: async () => ({
    designadoId: escenario.designadoId,
    designadoNombre: escenario.designadoId ? 'Persona Designada' : null,
  }),
  documentosDelCliente: async () => ({ ok: true, documentos: [] }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      const data =
        tabla === 'servicios_contratados'
          ? {
              id: SC,
              estado: 'activo',
              vigente_desde: '2026-09-23',
              vigente_hasta: null,
              parametros: { licencias: 2 },
              empresa_id: 'e1',
              negocio_id: 'n1',
              workspace_id: 'metrik',
              comision: null,
              servicio_slug: 'valida-cda-licencia',
              empresas: { nombre: 'CDA Pruebas', razon_social: null },
            }
          : tabla === 'catalogo_servicios'
            ? [{ slug: 'valida-cda-licencia', nombre: 'Licencia CDA' }]
            : null
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok),
      }
      return q
    },
  }),
}))
vi.mock('@/lib/seccion-suscripcion/carga-servidor', () => ({
  leerEquipo: async () => ({
    licencias: { licencias: 2, adicionalesVigentes: [], valorAdicional: 50000 },
    usuarios: [],
    cupo: { licencias: 2, usados: 1, libres: 1 },
  }),
}))
vi.mock('@/lib/seccion-suscripcion/licencias-servidor', () => ({
  comprarLicencia: espias.comprarLicencia,
  liberarLicencia: espias.liberarLicencia,
  cotizarLicencia: async () => ({ ok: false, error: 'sin cotización en la prueba' }),
}))
vi.mock('@/lib/seccion-suscripcion/sustenta-servidor', () => ({
  descartarSugerencia: espias.descartarSugerencia,
  pedirContactoSustenta: espias.pedirContactoSustenta,
  registrarEventoSugerencia: espias.registrarEventoSugerencia,
  estadoSugerencia: async () => ({ mostrar: false, yaSolicitado: false }),
}))
vi.mock('@/lib/usuarios-espacio/servidor', () => ({
  invitarUsuario: espias.invitarUsuario,
  retirarUsuario: espias.retirarUsuario,
  cambiarRolUsuario: espias.cambiarRolUsuario,
  reenviarInvitacion: espias.reenviarInvitacion,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}))
// `cache()` de React deduplica por request; en la prueba cada caso es un request nuevo.
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T,>(f: T) => f }))

const { contextoSuscripcion, menuSuscripcion } = await import('@/lib/seccion-suscripcion/contexto-servidor')
const acciones = await import('./acciones')
const { default: SuscripcionPage } = await import('./page')

/** Cada acción de la sección con argumentos válidos: lo único que puede frenarlas es quién llama. */
const TODAS_LAS_ACCIONES: [string, () => Promise<unknown>][] = [
  ['comprarUsuarioAdicional', () => acciones.comprarUsuarioAdicional({ solicitudExpresa: true })],
  ['invitarAlEspacio', () => acciones.invitarAlEspacio({ correo: 'nueva@cda.co', nombre: 'Nueva Persona', rol: 'operator' })],
  ['retirarDelEspacio', () => acciones.retirarDelEspacio({ usuarioId: OPERADOR, dejarDePagarAdicional: true })],
  ['cambiarRolEnEspacio', () => acciones.cambiarRolEnEspacio({ usuarioId: OPERADOR, rol: 'admin' })],
  ['reenviarInvitacionEspacio', () => acciones.reenviarInvitacionEspacio({ usuarioId: OPERADOR })],
  ['descartarSustenta', () => acciones.descartarSustenta()],
  ['pedirContactoDeSustenta', () => acciones.pedirContactoDeSustenta({ origen: 'tarjeta' })],
]

function ningunaEscritura() {
  for (const [nombre, espia] of Object.entries(espias)) expect(espia, nombre).not.toHaveBeenCalled()
}

async function abrirPagina(): Promise<'404' | 'abre'> {
  try {
    await SuscripcionPage({ searchParams: Promise.resolve({}) })
    return 'abre'
  } catch (e) {
    if (e instanceof Error && e.message === 'NEXT_NOT_FOUND') return '404'
    throw e
  }
}

beforeEach(() => {
  escenario.sesion = { usuarioId: DESIGNADO, role: 'owner' }
  escenario.designadoId = DESIGNADO
  for (const espia of Object.values(espias)) espia.mockClear()
})

describe('la persona designada', () => {
  it('ve el ítem del menú, abre la página y opera', async () => {
    const ctx = await contextoSuscripcion()
    expect(ctx.tipo).toBe('ok')
    expect(ctx.tipo === 'ok' && ctx.soloLectura).toBe(false)
    expect(await menuSuscripcion()).not.toBeNull()
    expect(await abrirPagina()).toBe('abre')

    // Control de las pruebas de rechazo: la misma acción, con quien sí puede, escribe.
    expect(await acciones.comprarUsuarioAdicional({ solicitudExpresa: true })).toEqual({ ok: true, licencias: 3 })
    expect(espias.comprarLicencia).toHaveBeenCalledTimes(1)
    await acciones.registrarEventoSustenta('vista')
    expect(espias.registrarEventoSugerencia).toHaveBeenCalledTimes(1)
  })
})

describe('nadie más del espacio', () => {
  const casos: [string, Sesion][] = [
    ['un dueño que no es la persona designada', { usuarioId: OTRO_DUENO, role: 'owner' }],
    ['un administrador', { usuarioId: ADMIN, role: 'admin' }],
    ['un operador', { usuarioId: OPERADOR, role: 'operator' }],
  ]

  for (const [quien, sesion] of casos) {
    it(`${quien}: sin ítem, 404 y cada acción rechazada sin escribir`, async () => {
      escenario.sesion = sesion
      expect((await contextoSuscripcion()).tipo).toBe('no_aplica')
      expect(await menuSuscripcion()).toBeNull()
      expect(await abrirPagina()).toBe('404')
      for (const [nombre, llamar] of TODAS_LAS_ACCIONES) {
        expect(await llamar(), nombre).toEqual({ ok: false, error: 'No tienes acceso a la suscripción de este espacio.' })
      }
      expect(await acciones.cotizarUsuarioAdicional()).toEqual({
        ok: false,
        error: 'No tienes acceso a la suscripción de este espacio.',
      })
      await acciones.registrarEventoSustenta('vista')
      ningunaEscritura()
    })
  }

  it('un contrato sin persona designada: ni el dueño la ve', async () => {
    escenario.designadoId = null
    expect((await contextoSuscripcion()).tipo).toBe('no_aplica')
    expect(await menuSuscripcion()).toBeNull()
    expect(await abrirPagina()).toBe('404')
  })
})

describe('el platform admin en «Ver como»', () => {
  it('mirando como la persona designada la ve, en solo lectura: nada escribe ni mide', async () => {
    escenario.sesion = { usuarioId: PLATFORM_ADMIN, role: 'owner', usuarioEfectivoId: DESIGNADO, impersonando: true }
    const ctx = await contextoSuscripcion()
    expect(ctx.tipo).toBe('ok')
    expect(ctx.tipo === 'ok' && ctx.soloLectura).toBe(true)
    expect(await menuSuscripcion()).not.toBeNull()
    expect(await abrirPagina()).toBe('abre')

    for (const [nombre, llamar] of TODAS_LAS_ACCIONES) {
      expect(await llamar(), nombre).toEqual({
        ok: false,
        error: 'Estás viendo la suscripción como otra persona: es solo lectura.',
      })
    }
    await acciones.registrarEventoSustenta('vista')
    ningunaEscritura()
  })

  it('mirando como un operador no la ve, igual que el operador', async () => {
    escenario.sesion = { usuarioId: PLATFORM_ADMIN, role: 'operator', usuarioEfectivoId: OPERADOR, impersonando: true }
    expect((await contextoSuscripcion()).tipo).toBe('no_aplica')
    expect(await menuSuscripcion()).toBeNull()
    expect(await abrirPagina()).toBe('404')
  })
})
