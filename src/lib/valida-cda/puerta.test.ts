/**
 * La puerta de términos de Valida para los CDA, con las reglas REALES (`entrada.ts`,
 * `entrada-servidor.ts`): se simulan solo las lecturas de la base.
 *
 * Lo que se fija:
 *   - un espacio con Valida y SIN contrato de Valida (AFI, metrik, y los CDA mientras no se carguen
 *     sus contratos) queda `libre`: la puerta nace inerte y no le cambia nada a nadie;
 *   - con contrato, el módulo no opera hasta que la persona designada acepte;
 *   - un operador no firma y sabe a quién espera; la designada sí firma;
 *   - no poder leer algo cierra, nunca abre.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'

const WS = 'b58e4b68-8bed-48b6-85f8-01995f64ffe6'
const OPERADOR = '6cf5dc0d-b908-4cdb-87ee-0adfa427283d'
const DESIGNADA = '11111111-1111-4111-8111-111111111111'
const SC = '44444444-4444-4444-8444-444444444444'

const DOC: DocumentoContractual = {
  documentoId: '33333333-3333-4333-8333-333333333333',
  slug: 'terminos-suscripcion-valida-cda',
  titulo: 'Términos de Suscripción VALIDA · Licencia CDA',
  version: 'v1.1',
  textoMd: '# TÉRMINOS',
  pdfSha256: 'a'.repeat(64),
  vigenteDesde: '2026-09-23',
  vigenteHasta: null,
  aceptadoAt: null,
  aceptadoPor: null,
  aceptadoCalidad: null,
  aceptadoCanal: null,
}
const DOC_ACEPTADO: DocumentoContractual = { ...DOC, aceptadoAt: '2026-09-24T14:00:00Z', aceptadoPor: 'Alba', aceptadoCanal: 'modulo' }

const CONTRATO_CDA = {
  servicio_contratado_id: SC,
  modulo: 'valida_consulta',
  estado: 'activo',
  es_pagador: true,
  vigente_desde: '2026-09-23',
}

const escenario: {
  modulo: { ok: true; workspaceId: string } | { ok: false; error: string }
  usuario: string | null
  servicios: { data: unknown[] | null; error: { message: string; code?: string } | null }
  documentos: DocumentoContractual[] | null
  perfil: { role: string; workspaceId: string; platformAdmin: boolean } | null
  designacion: { designadoId: string | null; designadoNombre: string | null } | 'error'
  hoy: string
  cuotas: { data: unknown[] | null; error: { message: string; code?: string } | null }
  cobros: { data: unknown[] | null; error: { message: string; code?: string } | null }
} = {
  modulo: { ok: true, workspaceId: WS },
  usuario: OPERADOR,
  servicios: { data: [], error: null },
  documentos: [DOC],
  perfil: null,
  designacion: { designadoId: DESIGNADA, designadoNombre: 'Alba Yurany Rosas Escandón' },
  hoy: '2026-09-23',
  cuotas: { data: [], error: null },
  cobros: { data: [], error: null },
}

/** La primera cuota real de los CDA: $150.000, vence el 30-sep. */
const CUOTA_1 = {
  cuota_id: '55555555-5555-4555-8555-555555555555',
  numero: 1,
  tipo: 'cuota',
  monto: '150000',
  fecha_vencimiento: '2026-09-30',
  concepto: 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026',
  enlace_pago_url: null,
  enlace_pago_expira: null,
  factura_numero: null,
  factura_pdf_path: null,
  factura_xml_path: null,
}

vi.mock('@/lib/dates/bogota', () => ({ todayBogotaISO: () => escenario.hoy }))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  REQUISITO: { validaConsulta: { modulos: ['valida'] } },
  exigirModulo: async () => escenario.modulo,
}))
vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: escenario.usuario ? { id: escenario.usuario, email: 'x@y.co' } : null }),
}))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    role: 'operator',
    supabase: {
      rpc: async (nombre: string) =>
        nombre === 'mis_servicios' ? escenario.servicios : nombre === 'mis_cuotas_de_servicio' ? escenario.cuotas : escenario.cobros,
    },
  }),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/valida-api/terminos-servidor', () => ({
  documentosDelCliente: async () =>
    escenario.documentos ? { ok: true, documentos: escenario.documentos } : { ok: false, motivo: 'base' },
  perfilReal: async () => escenario.perfil,
  designacionDelEspacio: async () => escenario.designacion,
  versionContratada: async () => null,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, then: (ok: (v: unknown) => unknown) => ok({ data: [], error: null }) }
      return q
    },
  }),
}))

// `cache()` de React deduplica por request; en la prueba cada caso es un request nuevo.
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T,>(f: T) => f }))

const { entradaValidaCda, terminosValidaPermitenOperar, validaCdaPermiteOperar, MENSAJE_TERMINOS_PENDIENTES } =
  await import('./puerta')

beforeEach(() => {
  escenario.modulo = { ok: true, workspaceId: WS }
  escenario.usuario = OPERADOR
  escenario.servicios = { data: [CONTRATO_CDA], error: null }
  escenario.documentos = [DOC]
  escenario.perfil = { role: 'operator', workspaceId: WS, platformAdmin: false }
  escenario.designacion = { designadoId: DESIGNADA, designadoNombre: 'Alba Yurany Rosas Escandón' }
  escenario.hoy = '2026-09-23'
  escenario.cuotas = { data: [CUOTA_1], error: null }
  escenario.cobros = { data: [], error: null }
})

describe('a quién aplica', () => {
  it('sin contrato de Valida (AFI, metrik, un CDA sin cargar) queda libre y opera como siempre', async () => {
    escenario.servicios = { data: [], error: null }
    expect(await entradaValidaCda()).toEqual({ tipo: 'libre' })
    expect(await terminosValidaPermitenOperar()).toEqual({ ok: true })
  })

  it('un contrato de OTRO módulo (Valida API) no le pone términos a Valida', async () => {
    escenario.servicios = { data: [{ ...CONTRATO_CDA, modulo: 'valida_api' }], error: null }
    expect(await entradaValidaCda()).toEqual({ tipo: 'libre' })
  })

  it('un contrato cancelado o terminado ya no pide términos', async () => {
    for (const estado of ['cancelado', 'terminado']) {
      escenario.servicios = { data: [{ ...CONTRATO_CDA, estado }], error: null }
      expect(await entradaValidaCda()).toEqual({ tipo: 'libre' })
    }
  })

  it('sin el módulo, o sin sesión, no hay puerta que abrir', async () => {
    escenario.modulo = { ok: false, error: 'modulo_no_activo' }
    expect((await entradaValidaCda()).tipo).toBe('sin_modulo')
    escenario.modulo = { ok: false, error: 'no_autenticado' }
    expect((await entradaValidaCda()).tipo).toBe('sin_sesion')
    expect((await terminosValidaPermitenOperar()).ok).toBe(false)
  })
})

describe('con contrato', () => {
  it('con los términos pendientes, nadie opera', async () => {
    expect(await terminosValidaPermitenOperar()).toEqual({ ok: false, error: MENSAJE_TERMINOS_PENDIENTES })
  })

  it('el operador ve a quién espera, y no puede firmar', async () => {
    const e = await entradaValidaCda()
    expect(e.tipo).toBe('ok')
    if (e.tipo !== 'ok' || e.estado.estado !== 'pendiente') throw new Error('se esperaba pendiente')
    expect(e.estado.aceptante).toEqual({ puede: false, razon: 'no_designado' })
    expect(e.estado.designadoNombre).toBe('Alba Yurany Rosas Escandón')
    expect(e.servicioContratadoId).toBe(SC)
  })

  it('la persona designada sí puede firmar', async () => {
    escenario.usuario = DESIGNADA
    const e = await entradaValidaCda()
    expect(e.tipo === 'ok' && e.estado.estado === 'pendiente' && e.estado.aceptante).toEqual({ puede: true })
  })

  it('sin persona designada en el contrato, ni el dueño firma', async () => {
    escenario.designacion = { designadoId: null, designadoNombre: null }
    escenario.perfil = { role: 'owner', workspaceId: WS, platformAdmin: false }
    const e = await entradaValidaCda()
    expect(e.tipo === 'ok' && e.estado.estado === 'pendiente' && e.estado.aceptante).toEqual({
      puede: false,
      razon: 'sin_designado',
    })
  })

  it('con el contrato aceptado, todos operan sin firmar nada propio', async () => {
    escenario.documentos = [DOC_ACEPTADO]
    expect(await terminosValidaPermitenOperar()).toEqual({ ok: true })
  })
})

describe('no poder leer cierra, nunca abre', () => {
  it('si no se pueden leer los contratos', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    escenario.servicios = { data: null, error: { message: 'caída' } }
    expect(await entradaValidaCda()).toEqual({ tipo: 'no_disponible' })
    expect((await terminosValidaPermitenOperar()).ok).toBe(false)
    log.mockRestore()
  })

  it('si no se pueden leer los documentos', async () => {
    escenario.documentos = null
    expect((await terminosValidaPermitenOperar()).ok).toBe(false)
  })

  it('si no se puede leer quién firma', async () => {
    escenario.designacion = 'error'
    const e = await entradaValidaCda()
    expect(e.tipo === 'ok' && e.estado).toEqual({ estado: 'no_disponible' })
    expect((await terminosValidaPermitenOperar()).ok).toBe(false)
  })
})

describe('plazo para aceptar (terminos_plazo_hasta)', () => {
  const conPlazo = (plazo: string | null) => {
    escenario.servicios = { data: [{ ...CONTRATO_CDA, terminos_plazo_hasta: plazo }], error: null }
  }

  it('el 30-sep, con plazo hasta el 30-sep y términos pendientes, todos operan (con aviso)', async () => {
    conPlazo('2026-09-30')
    escenario.hoy = '2026-09-30'
    const e = await entradaValidaCda()
    expect(e.tipo === 'ok' && e.enPlazo).toBe(true)
    expect(e.tipo === 'ok' && e.plazoTerminos).toBe('2026-09-30')
    expect(await terminosValidaPermitenOperar()).toEqual({ ok: true })
    expect(await validaCdaPermiteOperar()).toEqual({ ok: true })
  })

  it('el 1-oct, sin la aceptación, se pausa como hoy', async () => {
    conPlazo('2026-09-30')
    escenario.hoy = '2026-10-01'
    const e = await entradaValidaCda()
    expect(e.tipo === 'ok' && e.enPlazo).toBe(false)
    expect(await validaCdaPermiteOperar()).toEqual({ ok: false, error: MENSAJE_TERMINOS_PENDIENTES })
  })

  it('sin plazo (null) se pausa de inmediato', async () => {
    conPlazo(null)
    expect(await validaCdaPermiteOperar()).toEqual({ ok: false, error: MENSAJE_TERMINOS_PENDIENTES })
  })

  it('el plazo no abre lo que no se pudo verificar: fail-closed intacto', async () => {
    conPlazo('2026-09-30')
    escenario.designacion = 'error'
    expect((await validaCdaPermiteOperar()).ok).toBe(false)
    escenario.designacion = { designadoId: DESIGNADA, designadoNombre: null }
    escenario.documentos = null
    expect((await validaCdaPermiteOperar()).ok).toBe(false)
  })

  it('el plazo no abre unos términos sin registrar', async () => {
    conPlazo('2026-09-30')
    escenario.documentos = []
    const e = await entradaValidaCda()
    expect(e.tipo === 'ok' && e.estado.estado).toBe('sin_documentos')
    expect((await validaCdaPermiteOperar()).ok).toBe(false)
  })
})

describe('mora de más de 30 días (cláusula 11.1)', () => {
  beforeEach(() => {
    escenario.documentos = [DOC_ACEPTADO]
  })

  it('30-oct: cuota del 30-sep vencida, todavía opera', async () => {
    escenario.hoy = '2026-10-30'
    expect(await validaCdaPermiteOperar()).toEqual({ ok: true })
  })

  it('31-oct: se pausa, y el mensaje dice desde cuándo', async () => {
    escenario.hoy = '2026-10-31'
    const r = await validaCdaPermiteOperar()
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('pausada desde el 31-oct')
  })

  it('31-oct con la cuota pagada: opera', async () => {
    escenario.hoy = '2026-10-31'
    escenario.cobros = { data: [{ monto: '150000', estado: 'pagado' }], error: null }
    expect(await validaCdaPermiteOperar()).toEqual({ ok: true })
  })

  it('sin poder leer las cuotas NO se pausa: pausar exige la prueba de la deuda', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    escenario.hoy = '2026-12-31'
    escenario.cuotas = { data: null, error: { message: 'caída' } }
    expect(await validaCdaPermiteOperar()).toEqual({ ok: true })
    log.mockRestore()
  })

  it('un espacio que no paga el contrato (beneficiario) no tiene mora que medir', async () => {
    escenario.hoy = '2026-12-31'
    escenario.servicios = { data: [{ ...CONTRATO_CDA, es_pagador: false }], error: null }
    expect(await validaCdaPermiteOperar()).toEqual({ ok: true })
  })

  it('sin contrato de Valida (AFI, metrik) nada cambia', async () => {
    escenario.hoy = '2026-12-31'
    escenario.servicios = { data: [], error: null }
    expect(await validaCdaPermiteOperar()).toEqual({ ok: true })
  })
})
