/**
 * El cambio de los Términos VALIDA · Plan CDA de la v1.3 a la v1.4 POR LA PLATAFORMA (decisión de
 * Mauricio del 2026-10-07, dictamen de Emilio), con la puerta y la acción REALES (`puerta.ts`,
 * `acciones.ts`, `entrada.ts`, `terminos.ts`, `entrada-aprobacion.ts`): se simulan solo las lecturas y
 * escrituras de la base.
 *
 * Lo que se fija, regla por regla del dictamen:
 *   1. No aceptar la v1.4 NUNCA pausa ni restringe: ni antes ni después de su vigencia, ni con la
 *      designación ilegible. La v1.3 aceptada sigue valiendo.
 *   2. El aviso lo ven TODOS desde la publicación (qué cambia, vigencia, documento, PDF y el derecho de
 *      la 13.1); la persona designada, y solo ella, la acepta con el mismo mecanismo y la misma
 *      constancia (persona, cédula, IP, huella del PDF); al aceptar, el aviso desaparece para todos.
 *   3. La vigencia es la registrada: 6-nov-2026 (publicación del 7-oct + 30 días).
 *   4. Cada primera vista del aviso queda como constancia (por usuario del cliente, nunca el soporte).
 */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { textoCasillaEntrada } from '@/lib/valida-api/entrada'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import {
  cubiertaPorAviso,
  documentoAceptable,
  modificacionesPorAceptar,
  textoDeclaracionTerminos,
  type VersionContratada,
} from '@/lib/valida-api/terminos'
import { textosAvisoModificacion } from './modificacion-terminos'

const WS = '962df864-4dd8-44ba-aac0-bf994f391931'
const OPERADORA = '8b4a2cf8-6a7f-4580-a835-5710b9dd2332'
const DESIGNADO = 'c66b9846-b3ba-4ee6-807c-9978bb70186b'
const SOPORTE = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'
const SC = '6347c678-3071-4cd1-8fe2-3cd67ecae2cd'
const PDF_V14 = 'd3d1f92a40351c40e8766e03244f5b32bc177664077a9ce337ac95bc80cf5c3d'

const V13: DocumentoContractual = {
  documentoId: '67f3a71c-715b-4fdb-a4bd-a3a8ceb327be',
  slug: 'terminos-suscripcion-valida-cda',
  titulo: 'Términos de Suscripción al Servicio VALIDA · Plan CDA',
  version: 'v1.3',
  textoMd: '# TÉRMINOS v1.3',
  pdfSha256: '18aedd2c070b9f820e1f08abc825fb0f0098c19c1ff06fdc07bc256dbe5cfda8',
  vigenteDesde: '2026-09-24',
  vigenteHasta: '2026-11-05',
  aceptadoAt: '2026-10-01T20:56:17Z',
  aceptadoPor: 'JAIRO ENRIQUE PEÑA BERNAL',
  aceptadoCalidad: 'representante_legal',
  aceptadoCanal: 'modulo',
  rigePorAviso: false,
  reemplazaId: null,
  publicadaAt: null,
}
const V14: DocumentoContractual = {
  ...V13,
  documentoId: '14141414-1414-4141-8141-141414141414',
  version: 'v1.4',
  textoMd: '# TÉRMINOS v1.4\n\n11.1. **Restricción por mora.** …',
  pdfSha256: PDF_V14,
  vigenteDesde: '2026-11-06',
  vigenteHasta: null,
  aceptadoAt: null,
  aceptadoPor: null,
  aceptadoCalidad: null,
  aceptadoCanal: null,
  rigePorAviso: true,
  reemplazaId: V13.documentoId,
  publicadaAt: '2026-10-07T15:00:00Z',
}
const V14_ACEPTADA: DocumentoContractual = { ...V14, aceptadoAt: '2026-10-08T14:00:00Z', aceptadoPor: 'JAIRO', aceptadoCanal: 'modulo' }

const VERSION_V14: VersionContratada = {
  documentoId: V14.documentoId,
  workspaceCobradorId: 'a21bfc88-1a60-48c3-afcd-144226aa2392',
  titulo: V14.titulo,
  version: 'v1.4',
  textoSha256: createHash('sha256').update(V14.textoMd, 'utf8').digest('hex'),
  pdfSha256: PDF_V14,
  empresaNombre: 'CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S.',
  empresaNit: '900158425-0',
  negocioId: '717b2c2c-c265-4cb3-a483-3383b104a412',
}

const CONTRATO = { servicio_contratado_id: SC, modulo: 'valida_consulta', estado: 'activo', es_pagador: true, vigente_desde: '2026-09-23' }
const CUOTA = {
  cuota_id: '55555555-5555-4555-8555-555555555555',
  numero: 3,
  tipo: 'cuota',
  monto: '150000',
  fecha_vencimiento: '2026-11-10',
  concepto: 'Suscripción VALIDA · Starter',
  enlace_pago_url: null,
  enlace_pago_expira: null,
  factura_numero: null,
  factura_pdf_path: null,
  factura_xml_path: null,
}

const escenario: {
  usuario: string
  perfil: { role: string; workspaceId: string; platformAdmin: boolean } | null
  impersonando: boolean
  documentos: DocumentoContractual[]
  designacion: { designadoId: string | null; designadoNombre: string | null } | 'error'
  hoy: string
  cuotas: unknown[]
  cobros: unknown[]
} = {
  usuario: OPERADORA,
  perfil: null,
  impersonando: false,
  documentos: [],
  designacion: { designadoId: DESIGNADO, designadoNombre: 'Jairo Enrique Peña Bernal' },
  hoy: '2026-10-07',
  cuotas: [],
  cobros: [],
}
const escrituras: { tabla: string; op: 'insert' | 'upsert'; filas: unknown; opciones?: unknown }[] = []

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/dates/bogota', async (original) => ({
  ...(await original<typeof import('@/lib/dates/bogota')>()),
  todayBogotaISO: (d?: Date) => (d ? d.toISOString().slice(0, 10) : escenario.hoy),
}))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  REQUISITO: { validaConsulta: { modulos: ['valida'] } },
  exigirModulo: async () => ({ ok: true, workspaceId: WS }),
}))
vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: { id: escenario.usuario, email: 'x@y.co' } }),
}))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    role: 'operator',
    userId: escenario.usuario,
    impersonating: escenario.impersonando,
    supabase: {
      rpc: async (nombre: string) => ({
        data: nombre === 'mis_servicios' ? [CONTRATO] : nombre === 'mis_cuotas_de_servicio' ? escenario.cuotas : escenario.cobros,
        error: null,
      }),
    },
  }),
}))
vi.mock('@/lib/valida-api/contexto', () => ({
  origenPeticion: async () => ({ ip: '190.24.1.10', userAgent: 'Mozilla/5.0' }),
}))
vi.mock('@/lib/valida-api/terminos-servidor', () => ({
  documentosDelCliente: async () => ({ ok: true, documentos: escenario.documentos }),
  perfilReal: async () => escenario.perfil,
  designacionDelEspacio: async () => escenario.designacion,
  versionContratada: async (_ws: string, id: string) => (id === V14.documentoId ? VERSION_V14 : null),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        then: (ok: (v: unknown) => unknown) => ok({ data: [], error: null }),
        insert: async (filas: unknown) => {
          escrituras.push({ tabla, op: 'insert', filas })
          return { error: null }
        },
        upsert: async (filas: unknown, opciones: unknown) => {
          escrituras.push({ tabla, op: 'upsert', filas, opciones })
          return { error: null }
        },
      }
      return q
    },
  }),
}))
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T,>(f: T) => f }))

const { entradaValidaCda, validaCdaPermiteConsultar, validaCdaPermiteOperar } = await import('./puerta')
const { aprobarEntradaValidaCda } = await import('./acciones')
const { registrarVistaAvisoModificacion } = await import('./aviso-modificacion-servidor')

const OPERADORA_PERFIL = { role: 'operator', workspaceId: WS, platformAdmin: false }
const DESIGNADO_PERFIL = { role: 'owner', workspaceId: WS, platformAdmin: false }

beforeEach(() => {
  escenario.usuario = OPERADORA
  escenario.perfil = OPERADORA_PERFIL
  escenario.impersonando = false
  escenario.documentos = [V13, V14]
  escenario.designacion = { designadoId: DESIGNADO, designadoNombre: 'Jairo Enrique Peña Bernal' }
  escenario.hoy = '2026-10-07'
  escenario.cuotas = []
  escenario.cobros = []
  escrituras.length = 0
})

describe('1. no aceptar la v1.4 nunca pausa ni restringe', () => {
  it('el 7-oct (publicación): la v1.3 aceptada rige, todos operan y consultan', async () => {
    const e = await entradaValidaCda()
    expect(e.tipo === 'ok' && e.estado).toEqual({ estado: 'aprobada' })
    expect(await validaCdaPermiteOperar()).toEqual({ ok: true })
    expect(await validaCdaPermiteConsultar()).toEqual({ ok: true })
  })

  it('el 6-nov y después (la v1.4 ya rige y la v1.3 se retiró), sin aceptarla: opera y consulta igual', async () => {
    for (const hoy of ['2026-11-06', '2026-11-20', '2027-01-15']) {
      escenario.hoy = hoy
      const e = await entradaValidaCda()
      expect(e.tipo === 'ok' && e.estado, hoy).toEqual({ estado: 'aprobada' })
      expect(await validaCdaPermiteOperar(), hoy).toEqual({ ok: true })
      expect(await validaCdaPermiteConsultar(), hoy).toEqual({ ok: true })
    }
  })

  it('sin poder leer quién la firma: el aviso sigue, la firma no, y Valida opera', async () => {
    escenario.designacion = 'error'
    const e = await entradaValidaCda()
    if (e.tipo !== 'ok') throw new Error('se esperaba ok')
    expect(e.estado).toEqual({ estado: 'aprobada' })
    expect(e.modificaciones.map((d) => d.version)).toEqual(['v1.4'])
    expect(e.modificacion).toEqual({ estado: 'no_disponible' })
    expect(await validaCdaPermiteConsultar()).toEqual({ ok: true })
  })

  it('la restricción de los 5 días rige por el aviso, acepten o no: es la MORA la que restringe, no la falta de firma', async () => {
    escenario.cuotas = [CUOTA]
    escenario.hoy = '2026-11-16'
    const r = await validaCdaPermiteConsultar()
    expect(!r.ok && r.error).toContain('restringidas desde el 16-nov')
    escenario.cobros = [{ monto: '150000', estado: 'pagado' }]
    expect(await validaCdaPermiteConsultar()).toEqual({ ok: true })
  })

  it('una v1.4 por aviso sobre una v1.3 que NO se aceptó no es una modificación: es la entrada de siempre', async () => {
    escenario.documentos = [{ ...V13, aceptadoAt: null, aceptadoPor: null, aceptadoCanal: null }, V14]
    escenario.hoy = '2026-11-20'
    const e = await entradaValidaCda()
    if (e.tipo !== 'ok') throw new Error('se esperaba ok')
    expect(e.estado.estado).toBe('pendiente')
    expect(e.modificaciones).toEqual([])
    expect((await validaCdaPermiteOperar()).ok).toBe(false)
  })
})

describe('2. el aviso, para todos, y la aceptación de la persona designada', () => {
  it('la operadora ve el aviso con quién acepta, y no puede firmar', async () => {
    const e = await entradaValidaCda()
    if (e.tipo !== 'ok') throw new Error('se esperaba ok')
    expect(e.modificaciones.map((d) => d.documentoId)).toEqual([V14.documentoId])
    expect(e.modificacion?.estado === 'pendiente' && e.modificacion.aceptante).toEqual({ puede: false, razon: 'no_designado' })
    expect(e.modificacion?.estado === 'pendiente' && e.modificacion.designadoNombre).toBe('Jairo Enrique Peña Bernal')
  })

  it('el aviso dice qué cambia, la vigencia, el derecho de la 13.1 y la publicación', () => {
    const t = textosAvisoModificacion(V14, '2026-10-07')
    expect(t.titulo).toBe('Cambian los Términos de tu suscripción a Valida (versión 1.4)')
    expect(t.queCambia).toContain('Desde el 6 de noviembre de 2026')
    expect(t.queCambia).toContain('cinco (5) días calendario')
    expect(t.queCambia).toContain('reportes ya generados se pueden ver y descargar')
    expect(t.queCambia).toContain('enlace de pago')
    expect(t.vigencia).toContain('rige desde el 6 de noviembre de 2026')
    expect(t.vigencia).toContain('lo acepte o no tu empresa')
    expect(t.derecho).toContain('sin penalidad antes del 6 de noviembre de 2026')
    expect(t.derecho).toContain('reembolso a prorrata')
    expect(t.publicado).toBe('Aviso publicado en la plataforma el 7 de octubre de 2026.')
    // Desde la vigencia el derecho ya no se puede ejercer: no se ofrece.
    expect(textosAvisoModificacion(V14, '2026-11-06').derecho).toBeNull()
  })

  it('la persona designada la acepta con la misma constancia de la entrada', async () => {
    escenario.usuario = DESIGNADO
    escenario.perfil = DESIGNADO_PERFIL
    const e = await entradaValidaCda()
    if (e.tipo !== 'ok' || e.modificacion?.estado !== 'pendiente') throw new Error('se esperaba la modificación')
    expect(e.modificacion.aceptante).toEqual({ puede: true })

    const datos = { nombre: 'Jairo Enrique Peña Bernal', cedula: '17654321', calidad: 'representante_legal' as const }
    const declaracion = textoDeclaracionTerminos(VERSION_V14, datos, 'valida_cda')
    const casilla = textoCasillaEntrada({ documentos: [V14], firmaPor: [VERSION_V14.empresaNombre], producto: 'valida_cda' })
    const r = await aprobarEntradaValidaCda({
      leyoHastaElFinal: true,
      casillaMostrada: casilla,
      firma: { ...datos, declaraciones: [{ documentoId: V14.documentoId, texto: declaracion }] },
    })
    expect(r).toEqual({ ok: true, yaEstaba: false })

    const contrato = escrituras.find((w) => w.tabla === 'aceptaciones_terminos')
    expect(contrato?.op).toBe('insert')
    expect(contrato?.filas).toEqual([
      expect.objectContaining({
        canal: 'modulo',
        documento_version_id: V14.documentoId,
        documento_version: 'v1.4',
        documento_sha256: PDF_V14,
        usuario_id: DESIGNADO,
        cedula_aceptante: '17654321',
        ip: '190.24.1.10',
        texto_aceptacion: declaracion,
      }),
    ])
    expect(declaracion).toContain(PDF_V14)
    expect(declaracion).toContain('Ley 527 de 1999')
    const usuario = escrituras.find((w) => w.tabla === 'documentos_aceptaciones_usuario')
    expect(usuario?.filas).toEqual(
      expect.arrayContaining([expect.objectContaining({ documento_slug: V14.slug, documento_version: 'v1.4', documento_sha256: PDF_V14 })]),
    )
  })

  it('la operadora no la acepta aunque mande la firma por POST', async () => {
    const r = await aprobarEntradaValidaCda({ leyoHastaElFinal: true, casillaMostrada: 'x', firma: null })
    expect(r.ok).toBe(false)
    expect(escrituras.filter((w) => w.tabla === 'aceptaciones_terminos')).toEqual([])
  })

  it('aceptada la v1.4, el aviso desaparece para TODOS y no queda nada que firmar', async () => {
    escenario.documentos = [V13, V14_ACEPTADA]
    for (const usuario of [OPERADORA, DESIGNADO]) {
      escenario.usuario = usuario
      const e = await entradaValidaCda()
      expect(e.tipo === 'ok' && e.modificaciones, usuario).toEqual([])
      expect(e.tipo === 'ok' && e.modificacion, usuario).toBeNull()
    }
    escenario.usuario = DESIGNADO
    expect(await aprobarEntradaValidaCda({ leyoHastaElFinal: true, casillaMostrada: 'x' })).toEqual({ ok: true, yaEstaba: true })
  })
})

describe('3. la vigencia es la registrada: 6-nov-2026', () => {
  it('la puerta toma la fecha de la v1.4 del contrato', async () => {
    const e = await entradaValidaCda()
    expect(e.tipo === 'ok' && e.restriccionDesde).toBe('2026-11-06')
  })

  it('cuota vencida el 15-oct: el 5-nov consulta, el 6-nov se restringe', async () => {
    escenario.cuotas = [{ ...CUOTA, fecha_vencimiento: '2026-10-15' }]
    escenario.hoy = '2026-11-05'
    expect(await validaCdaPermiteConsultar()).toEqual({ ok: true })
    escenario.hoy = '2026-11-06'
    expect((await validaCdaPermiteConsultar()).ok).toBe(false)
  })
})

describe('4. la constancia del preaviso', () => {
  it('la primera vista de un usuario del cliente se registra, sin pisar la anterior', async () => {
    await registrarVistaAvisoModificacion(await entradaValidaCda())
    expect(escrituras).toEqual([
      {
        tabla: 'avisos_modificacion_vistos',
        op: 'upsert',
        filas: [
          {
            documento_version_id: V14.documentoId,
            workspace_id: WS,
            usuario_id: OPERADORA,
            ip: '190.24.1.10',
            user_agent: 'Mozilla/5.0',
          },
        ],
        opciones: { onConflict: 'documento_version_id,usuario_id', ignoreDuplicates: true },
      },
    ])
  })

  it('el soporte de MeTRIK, o alguien en «Ver como», no cuenta como el cliente enterándose', async () => {
    escenario.usuario = SOPORTE
    escenario.perfil = { role: 'owner', workspaceId: WS, platformAdmin: true }
    await registrarVistaAvisoModificacion(await entradaValidaCda())
    escenario.usuario = OPERADORA
    escenario.perfil = OPERADORA_PERFIL
    escenario.impersonando = true
    await registrarVistaAvisoModificacion(await entradaValidaCda())
    expect(escrituras).toEqual([])
  })

  it('sin modificación por aceptar no se registra nada', async () => {
    escenario.documentos = [V13, V14_ACEPTADA]
    await registrarVistaAvisoModificacion(await entradaValidaCda())
    expect(escrituras).toEqual([])
  })
})

describe('las reglas puras de una versión por aviso', () => {
  it('la cobertura sigue la cadena: una v1.5 por aviso sobre la v1.4 por aviso sobre la v1.3 aceptada', () => {
    const v15 = { ...V14, documentoId: '15151515-1515-4151-8151-151515151515', version: 'v1.5', reemplazaId: V14.documentoId }
    expect(cubiertaPorAviso(v15, [V13, V14, v15])).toBe(true)
    expect(cubiertaPorAviso(v15, [{ ...V13, aceptadoAt: null }, V14, v15])).toBe(false)
    // Sin la versión que modifica a la vista, no hay cobertura (no se adivina).
    expect(cubiertaPorAviso(v15, [v15])).toBe(false)
    // Una versión de entrada nunca está «cubierta».
    expect(cubiertaPorAviso(V13, [V13])).toBe(false)
  })

  it('una versión por aviso publicada se acepta antes de regir; una de entrada futura, no; una retirada, tampoco', () => {
    expect(documentoAceptable(V14, '2026-10-07')).toBe(true)
    expect(documentoAceptable({ ...V14, rigePorAviso: false, publicadaAt: null }, '2026-10-07')).toBe(false)
    expect(documentoAceptable({ ...V14, publicadaAt: null }, '2026-10-07')).toBe(false)
    expect(documentoAceptable({ ...V14, vigenteHasta: '2026-10-31' }, '2026-11-01')).toBe(false)
  })

  it('se ofrece una sola vez por versión aunque la RPC la repita, y no se ofrece la ya aceptada', () => {
    expect(modificacionesPorAceptar([V13, V14, V14], '2026-10-07').map((d) => d.version)).toEqual(['v1.4'])
    expect(modificacionesPorAceptar([V13, V14, V14_ACEPTADA], '2026-10-07')).toEqual([])
  })
})
