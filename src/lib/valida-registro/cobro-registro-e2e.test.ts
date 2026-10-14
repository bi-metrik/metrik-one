/**
 * El recorrido entero del cobro automático, de punta a punta, con el código real de cada paso:
 *
 *   registro con tarjeta (`crearEspacioValida`: la casilla acepta Condiciones + Términos llenos)
 *     → aviso de 48 h (paso 7a, prueba acortada a 14 minutos como en un preview)
 *     → el día 7: activación (`activarPlanDelEspacio` con el texto del registro)
 *     → aceptación del registro sobre el contrato (`aceptarTerminosDelRegistro`, canal `registro`)
 *     → enrolamiento real (`enrolarContratosPorCiclo`: exige la aceptación)
 *     → el plan pasa a la tarjeta y se cobra la cuota 1 con ePayco (`cobrarCuotaConTarjeta`).
 *
 * Lo simulado, y dónde se prueba lo real:
 *   - la base: el doble de tablas (`test/tablas-doble.ts`). Las dos funciones de la base que el
 *     recorrido llama (`valida_activar_autogestion`, `enrolar_cobro_por_ciclo`) van como dobles que
 *     hacen lo mismo; la guarda del canal `registro` se emula en el insert (pone la hora, la IP y el
 *     correo desde el registro). Las tres se ejecutan de verdad en PGlite en `activacion-sql.test.ts`;
 *   - Valida (la prueba), ePayco, el PDF, Resend y el registro del pago (`procesarEventoPasarela`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { crearDoble, type Fila, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter, ResultadoCargo, SolicitudCargo, EventoPasarela } from '@/lib/suscripciones/pasarela/adapter'

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

const PERSONA = { id: 'u-ana', email: 'ana@acme.co' }
const METRIK = 'a21bfc88-1a60-48c3-afcd-144226aa2392' // COBRADOR_VALIDA.workspaceId
const REF_TARJETA = 'epayco:CLIENTE123abc:TOKEN456def'

// ── La base en memoria, compartida por el servidor y el cron ──────────────────────────────────
const tablas: Tablas = {
  valida_registros: [],
  workspaces: [{ id: METRIK, slug: 'metrik', config_extra: {} }],
  profiles: [],
  staff: [],
  fiscal_profiles: [],
  empresas: [],
  negocios: [],
  documentos_contractuales_versiones: [],
  servicios_contratados: [],
  aceptaciones_terminos: [],
  catalogo_servicios: [{ slug: 'valida-cda-licencia', nombre: 'Licencia Valida', modulo: 'valida_consulta', disparador_cobro: 'ciclo' }],
  catalogo_servicios_versiones: [{ slug: 'valida-cda-licencia', version: 1, definicion: { parametros: { dias_trial: { por_defecto: 0 } } } }],
  servicio_cobro_enrolamiento: [],
  planes_cobro: [],
  plan_cobro_cuotas: [],
  cobros: [],
  cobro_intentos_tarjeta: [],
}
const doble = crearDoble(tablas)
let secuencia = 0
const nuevoId = (p: string) => `${p}-${++secuencia}`

/** La guarda `aceptaciones_terminos_registro()`, emulada: la evidencia sale del registro. */
function conGuardaDelRegistro(from: (t: string) => unknown) {
  return (tabla: string) => {
    const q = from(tabla) as Record<string, unknown>
    if (tabla !== 'aceptaciones_terminos') return q
    const insertar = q.insert as (v: Fila) => unknown
    return {
      ...q,
      insert: (v: Fila) => {
        const reg = tablas.valida_registros.find((r) => r.id === v.valida_registro_id)
        if (v.canal !== 'registro' || !reg || !reg.terminos_sha256) throw new Error('la guarda de la base rechazaría la fila')
        const doc = tablas.documentos_contractuales_versiones.find((d) => d.id === v.documento_version_id)
        if (!doc || doc.texto_sha256 !== reg.terminos_sha256) throw new Error('no es el texto que se aceptó en el registro')
        if (!String(reg.aceptado_texto).includes(`Casilla: ${v.texto_aceptacion}`)) throw new Error('no es la casilla que se marcó')
        return insertar({
          ...v,
          respondido_at: reg.aceptado_at,
          ip: reg.ip,
          nombre_aceptante: reg.correo,
          calidad: 'autorizado',
          texto_aceptacion_sha256: sha(String(v.texto_aceptacion)),
        })
      },
    }
  }
}

const rpcs: string[] = []
const db = {
  from: conGuardaDelRegistro(doble.db.from.bind(doble.db)),
  storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  rpc: async (nombre: string, a: Record<string, unknown>) => {
    rpcs.push(nombre)
    if (nombre === 'valida_activar_autogestion') return { data: activarEnLaBase(a), error: null }
    if (nombre === 'enrolar_cobro_por_ciclo') return { data: enrolarEnLaBase(a), error: null }
    throw new Error(`rpc sin doble: ${nombre}`)
  },
}

/** `valida_activar_autogestion`, lo que deja (la función real corre en `activacion-sql.test.ts`). */
function activarEnLaBase(a: Record<string, unknown>) {
  const reg = tablas.valida_registros.find((r) => r.workspace_id === a.p_workspace_cliente && r.estado === 'creado')
  if (!reg) return { ok: false, error: 'sin_registro' }
  const vivo = tablas.servicios_contratados.find((c) => c.workspace_pagador_id === a.p_workspace_cliente)
  if (vivo) return { ok: true, resultado: 'ya_activo', contrato_id: vivo.id }
  const d = a.p_documento as Record<string, string>
  if (sha(d.texto_md) !== d.texto_sha256) return { ok: false, error: 'documento_invalido' }
  const empresa = { id: nuevoId('empresa'), workspace_id: METRIK, razon_social: reg.razon_social }
  const negocio = { id: nuevoId('negocio'), workspace_id: METRIK, empresa_id: empresa.id }
  const doc = { id: nuevoId('doc'), workspace_id: METRIK, empresa_id: empresa.id, alcance: 'cliente', ...d }
  const contrato = {
    id: nuevoId('contrato'),
    workspace_id: METRIK,
    empresa_id: empresa.id,
    negocio_id: negocio.id,
    servicio_slug: a.p_servicio_slug,
    servicio_version: 1,
    parametros: a.p_parametros,
    workspace_pagador_id: a.p_workspace_cliente,
    estado: 'activo',
    aceptante_designado_id: a.p_usuario,
  }
  tablas.empresas.push(empresa)
  tablas.negocios.push(negocio)
  tablas.documentos_contractuales_versiones.push(doc)
  tablas.servicios_contratados.push(contrato)
  return { ok: true, resultado: 'activado', contrato_id: contrato.id, negocio_id: negocio.id, documento_id: doc.id }
}

/** `enrolar_cobro_por_ciclo`: plan, cuotas y acta en una transacción. */
function enrolarEnLaBase(a: Record<string, unknown>) {
  const contrato = tablas.servicios_contratados.find((c) => c.id === a.p_servicio_contratado_id) as Fila
  const plan = a.p_plan as Record<string, unknown>
  const planId = nuevoId('plan')
  tablas.planes_cobro.push({ id: planId, workspace_id: contrato.workspace_id, negocio_id: contrato.negocio_id, ...plan })
  for (const [i, c] of (a.p_cuotas as Fila[]).entries()) {
    tablas.plan_cobro_cuotas.push({ id: nuevoId('cuota'), workspace_id: contrato.workspace_id, plan_cobro_id: planId, numero: i + 1, ...c })
  }
  tablas.servicio_cobro_enrolamiento.push({ servicio_contratado_id: contrato.id, plan_cobro_id: planId, ancla_at: a.p_ancla_at })
  return { resultado: 'creado', plan_cobro_id: planId }
}

// ── Lo de afuera ──────────────────────────────────────────────────────────────────────────────
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: PERSONA }) }))
vi.mock('./pdf-terminos', () => ({ pdfTerminos: async (t: string) => Buffer.from(`PDF ${sha(t)}`) }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => undefined }))
const pagos: EventoPasarela[] = []
vi.mock('@/lib/cobros/pago-en-linea', () => ({
  procesarEventoPasarela: async (e: EventoPasarela) => {
    pagos.push(e)
    const cobro = tablas.cobros.find((c) => c.id === (e.crudo as { cobroId: string }).cobroId)
    if (cobro) cobro.fecha = '2026-10-20'
    return { resultado: 'registrado', detalle: 'Pago registrado.', cobroId: cobro?.id ?? null }
  },
}))
vi.mock('@/lib/cobros/pago-en-linea-servidor', () => ({ repoPagoEnLinea: () => ({}) }))
vi.mock('@/lib/suscripciones/pasarela/epayco', async (original) => ({
  ...(await original<typeof import('@/lib/suscripciones/pasarela/epayco')>()),
  registrarClienteEpayco: async () => ({ ok: true, ref: REF_TARJETA }),
}))
// La prueba la emite Valida; aquí, lo que deja en el registro (con el cobro programado de verdad).
vi.mock('./prueba-servidor', async () => {
  const { momentoDelCobro, entornoDeCobro } = await import('./cobro-prueba')
  return {
    emitirPruebaDelEspacio: async (d: { workspaceId: string; registroId: string; conCobro?: boolean }) => {
      const ahora = Date.now()
      const venceEn = new Date(ahora + 7 * 86_400_000).toISOString()
      const ws = tablas.workspaces.find((w) => w.id === d.workspaceId) as Fila
      ws.config_extra = { ...(ws.config_extra as object), valida_prueba: { cliente_id: 'cli-1', consultas: 10, vence_en: venceEn } }
      const reg = tablas.valida_registros.find((r) => r.id === d.registroId) as Fila
      Object.assign(reg, {
        valida_cliente_id: 'cli-1',
        prueba_vence_en: venceEn,
        ...(d.conCobro ? { cobro_estado: 'programado', cobro_programado_at: momentoDelCobro({ venceEn, aperturaMs: ahora }), cobro_entorno: entornoDeCobro() } : {}),
      })
      return { tipo: 'ok', venceEn, consultas: 10 }
    },
  }
})

const ENV_PREVIEW = {
  VERCEL_ENV: 'preview',
  VALIDA_REGISTRO_ABIERTO: '1',
  VALIDA_COBRO_TRAS_PRUEBA: '1',
  VALIDA_COBRO_PRUEBA_MINUTOS: '14',
  EPAYCO_HABILITADO: '1',
  EPAYCO_PUBLIC_KEY_METRIK: 'llave-publica-de-prueba',
}
const envAntes: Record<string, string | undefined> = {}
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV_PREVIEW)) {
    envAntes[k] = process.env[k]
    process.env[k] = v
  }
})
afterAll(() => {
  for (const [k, v] of Object.entries(envAntes)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

function epaycoDePrueba(resultado: ResultadoCargo) {
  const cargos: SolicitudCargo[] = []
  const adapter = {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
    cobrar: async (s: SolicitudCargo) => {
      cargos.push(s)
      return resultado
    },
    consultar: async () => resultado,
  } as unknown as PasarelaAdapter
  return { adapter, cargos }
}

describe('registro → 14 minutos → cobro de la tarjeta con el plan activado', () => {
  it('el día 7 cobra la cuota 1 una sola vez, con los Términos aceptados en el registro', async () => {
    const { crearEspacioValida } = await import('./registro-servidor')
    const { procesarCobrosTrasPrueba } = await import('./cobro-prueba-servidor')
    const { cobrarCuotaConTarjeta } = await import('./cobro-token-servidor')
    const { enrolarContratosPorCiclo } = await import('@/lib/cobros/enrolar-ciclo-servidor')
    const { condicionesVigentes, versionAceptada, TEXTO_CASILLA_CON_COBRO } = await import('./condiciones')
    const { pasarelaBold } = await import('@/lib/suscripciones/pasarela/bold')
    const { dvParaNit } = await import('./datos')

    // 1. El registro, con la casilla v1.2 (acepta Condiciones, cobro de cada mes y Términos).
    const condiciones = condicionesVigentes()
    expect(condiciones.conCobro).toBe(true)
    const inicio = Date.now()
    const alta = await crearEspacioValida({
      razonSocial: 'ACME S.A.S.',
      nit: '901234567',
      dv: dvParaNit('901234567'),
      acepta: true,
      condicionesVersion: versionAceptada(condiciones),
      recomendadoAfi: false,
      codigoAfi: null,
      ref: null,
      utm: {},
      ip: '181.50.1.2',
      tarjeta: { token: 'XCX92PZqBKfmcWFbA', titular: 'Ana Pérez', celular: '3001234567' },
    })
    expect(alta).toMatchObject({ tipo: 'ok' })
    const reg = tablas.valida_registros[0]
    expect(reg).toMatchObject({
      estado: 'creado',
      condiciones_version: 'condiciones-2.1+aviso-1.3+terminos-auto-2.1',
      terminos_version: 'v2.1',
      metodo_pago_ref: REF_TARJETA,
      cobro_estado: 'programado',
      cobro_entorno: 'preview',
      ip: '181.50.1.2',
    })
    // La huella cubre TODO lo aceptado, y los Términos de la empresa están dentro, llenos.
    const aceptado = String(reg.aceptado_texto)
    expect(reg.condiciones_sha256).toBe(sha(aceptado))
    expect(reg.terminos_sha256).toBe(sha(String(reg.terminos_texto)))
    expect(aceptado).toContain(`Casilla: ${TEXTO_CASILLA_CON_COBRO}`)
    expect(aceptado).toContain(String(reg.terminos_texto))
    expect(String(reg.terminos_texto)).toContain('| Razón social (declarada en el registro) | ACME S.A.S. |')
    expect(String(reg.terminos_texto)).toContain('| Recomendado por AFI (cláusula 15) | no |')
    // El cobro, nunca antes del plazo que dice la Orden.
    expect(Date.parse(String(reg.cobro_programado_at))).toBeGreaterThanOrEqual(inicio + 14 * 60_000)

    const correos: { subject: string }[] = []
    const ePayco = epaycoDePrueba({ estado: 'aprobado', externalRef: 'epayco-777', fecha: '2026-10-20', monto: 150_000 })
    const deps = {
      db: db as never,
      env: ENV_PREVIEW,
      enviarCorreo: async (m: { subject: string }) => {
        correos.push(m)
        return { ok: true as const, id: 'resend-1' }
      },
      urlCuenta: (slug: string) => `https://${slug}.metrikone.co/valida`,
      enrolar: (d: Parameters<typeof enrolarContratosPorCiclo>[0]) =>
        enrolarContratosPorCiclo({ ...d, adapterPara: (p) => (p === 'bold' ? pasarelaBold : p === 'epayco' ? ePayco.adapter : null) }),
      cobrarCuota: (d: Parameters<typeof cobrarCuotaConTarjeta>[0], p: Parameters<typeof cobrarCuotaConTarjeta>[1]) =>
        cobrarCuotaConTarjeta({ ...d, adapterPara: (x) => (x === 'epayco' ? ePayco.adapter : null) }, p),
    }

    // 2. Minuto 9: el aviso (48 h escaladas a 4 minutos). No cobra.
    const r1 = await procesarCobrosTrasPrueba({ ...deps, ahoraMs: inicio + 9 * 60_000 })
    expect(r1.avisos).toBe(1)
    expect(ePayco.cargos).toHaveLength(0)
    expect(correos[0].subject).toContain('Tu prueba de Valida termina')

    // 3. Minuto 15: activación → aceptación del registro → plan → cobro de la tarjeta.
    const r2 = await procesarCobrosTrasPrueba({ ...deps, ahoraMs: inicio + 15 * 60_000 })
    expect(r2).toMatchObject({ cobrados: 1, esperandoTerminos: 0, aRevisar: [], reintentar: [], errores: [] })
    expect(reg.cobro_estado).toBe('cobrado')

    // El documento del contrato es EXACTAMENTE el texto aceptado en el registro.
    const doc = tablas.documentos_contractuales_versiones[0]
    expect(doc).toMatchObject({ slug: 'terminos-uso-valida-autogestion', version: 'v2.1', texto_md: reg.terminos_texto, texto_sha256: reg.terminos_sha256 })
    // La aceptación del registro, colgada del contrato, con la hora en que se marcó la casilla.
    expect(tablas.aceptaciones_terminos).toHaveLength(1)
    expect(tablas.aceptaciones_terminos[0]).toMatchObject({
      canal: 'registro',
      estado: 'aceptado',
      valida_registro_id: reg.id,
      usuario_id: PERSONA.id,
      workspace_cliente_id: reg.workspace_id,
      documento_version_id: doc.id,
      texto_documento_sha256: reg.terminos_sha256,
      texto_aceptacion: TEXTO_CASILLA_CON_COBRO,
      respondido_at: reg.aceptado_at,
      ip: '181.50.1.2',
      nombre_aceptante: 'ana@acme.co',
    })
    // El contrato nació con la persona del registro como designada y cobra tras la prueba.
    expect(tablas.servicios_contratados[0]).toMatchObject({ aceptante_designado_id: PERSONA.id, parametros: expect.objectContaining({ cobro_tras_prueba: true }) })
    // El plan: enrolado con el ancla del cobro, pasado a la tarjeta, cuota 1 cobrada a la tarjeta.
    expect(tablas.planes_cobro).toHaveLength(1)
    expect(tablas.planes_cobro[0].pasarela).toBe('epayco')
    expect(ePayco.cargos).toHaveLength(1)
    expect(ePayco.cargos[0]).toMatchObject({ monto: 150_000, numeroCuota: 1, medioPago: { token_ref: REF_TARJETA, pasarela: 'epayco' } })
    expect(pagos).toHaveLength(1)
    expect(rpcs).toEqual(['valida_activar_autogestion', 'enrolar_cobro_por_ciclo'])

    // 4. El cron vuelve a correr: nada se cobra dos veces.
    await procesarCobrosTrasPrueba({ ...deps, ahoraMs: inicio + 16 * 60_000 })
    expect(ePayco.cargos).toHaveLength(1)
    expect(tablas.aceptaciones_terminos).toHaveLength(1)
  })
})

describe('registro → consulta 11 → confirma → cobro YA; el cron del día 7 no vuelve a cobrar', () => {
  it('cobra la cuota 1 al confirmar, con el intento reclamado en cobro_intentos_tarjeta, una sola vez', async () => {
    // La base, vacía otra vez (el recorrido anterior dejó su espacio y su NIT).
    for (const filas of Object.values(tablas)) filas.length = 0
    tablas.workspaces.push({ id: METRIK, slug: 'metrik', config_extra: {} })
    tablas.catalogo_servicios.push({ slug: 'valida-cda-licencia', nombre: 'Licencia Valida', modulo: 'valida_consulta', disparador_cobro: 'ciclo' })
    tablas.catalogo_servicios_versiones.push({ slug: 'valida-cda-licencia', version: 1, definicion: { parametros: { dias_trial: { por_defecto: 0 } } } })
    pagos.length = 0

    const { crearEspacioValida } = await import('./registro-servidor')
    const { procesarCobrosTrasPrueba, cobrarAlConfirmar } = await import('./cobro-prueba-servidor')
    const { cobrarCuotaConTarjeta } = await import('./cobro-token-servidor')
    const { enrolarContratosPorCiclo } = await import('@/lib/cobros/enrolar-ciclo-servidor')
    const { condicionesVigentes, versionAceptada } = await import('./condiciones')
    const { pasarelaBold } = await import('@/lib/suscripciones/pasarela/bold')
    const { dvParaNit } = await import('./datos')

    const inicio = Date.now()
    const alta = await crearEspacioValida({
      razonSocial: 'BETA S.A.S.',
      nit: '901234568',
      dv: dvParaNit('901234568'),
      acepta: true,
      condicionesVersion: versionAceptada(condicionesVigentes()),
      recomendadoAfi: false,
      codigoAfi: null,
      ref: null,
      utm: {},
      ip: '181.50.1.3',
      tarjeta: { token: 'XCX92PZqBKfmcWFbA', titular: 'Ana Pérez', celular: '3001234567' },
    })
    expect(alta).toMatchObject({ tipo: 'ok' })
    const reg = tablas.valida_registros[0]
    expect(reg).toMatchObject({ condiciones_version: 'condiciones-2.1+aviso-1.3+terminos-auto-2.1', cobro_estado: 'programado' })

    const ePayco = epaycoDePrueba({ estado: 'aprobado', externalRef: 'epayco-888', fecha: '2026-10-15', monto: 150_000 })
    const deps = {
      db: db as never,
      env: ENV_PREVIEW,
      enviarCorreo: async () => ({ ok: true as const, id: 'resend-1' }),
      urlCuenta: (slug: string) => `https://${slug}.metrikone.co/valida`,
      ultimos4: async () => '0326',
      enrolar: (d: Parameters<typeof enrolarContratosPorCiclo>[0]) =>
        enrolarContratosPorCiclo({ ...d, adapterPara: (p) => (p === 'bold' ? pasarelaBold : p === 'epayco' ? ePayco.adapter : null) }),
      cobrarCuota: (d: Parameters<typeof cobrarCuotaConTarjeta>[0], p: Parameters<typeof cobrarCuotaConTarjeta>[1]) =>
        cobrarCuotaConTarjeta({ ...d, adapterPara: (x) => (x === 'epayco' ? ePayco.adapter : null) }, p),
    }

    // Minuto 3 de la prueba (de 14): agotó las 10 y confirma. Se cobra YA, sin aviso previo.
    const r = await cobrarAlConfirmar({ ...deps, ahoraMs: inicio + 3 * 60_000 }, { workspaceId: String(reg.workspace_id), usuarioId: PERSONA.id, agotada: true, ip: '181.50.1.3' })
    expect(r).toEqual({ tipo: 'cobrado', ultimos4: '0326' })
    expect(reg.cobro_estado).toBe('cobrado')
    expect(reg.cobro_aviso_enviado_at ?? null).toBeNull()
    expect(String(reg.cobro_confirmado_texto)).toContain('se cobran $150.000 a tu tarjeta terminada en 0326')
    expect(ePayco.cargos).toHaveLength(1)
    expect(ePayco.cargos[0]).toMatchObject({ monto: 150_000, numeroCuota: 1, medioPago: { token_ref: REF_TARJETA } })
    expect(tablas.cobro_intentos_tarjeta).toHaveLength(1)
    expect(tablas.aceptaciones_terminos).toHaveLength(1)
    expect(pagos).toHaveLength(1)

    // El aviso y el día 7 del cron: nada más se cobra, ni se avisa de un cobro que ya se hizo.
    const aviso = await procesarCobrosTrasPrueba({ ...deps, ahoraMs: inicio + 9 * 60_000 })
    const dia7 = await procesarCobrosTrasPrueba({ ...deps, ahoraMs: inicio + 15 * 60_000 })
    expect(aviso.avisos).toBe(0)
    expect(dia7).toMatchObject({ cobrados: 0, aRevisar: [], errores: [] })
    // Ni la cuota 1 por el camino de las cuotas: el intento ya está reclamado.
    expect(await cobrarCuotaConTarjeta({ db: db as never, adapterPara: (x) => (x === 'epayco' ? ePayco.adapter : null) }, { cobradorId: METRIK, cuotaId: String(tablas.plan_cobro_cuotas[0].id) })).toMatchObject({
      tipo: expect.stringMatching(/^(pagada|ya_intentado)$/),
    })
    expect(ePayco.cargos).toHaveLength(1)
  })
})
