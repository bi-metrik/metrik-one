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
 *     correo desde el registro). Las tres se ejecutan de verdad en PGlite en
 *     `suscripciones-producto/migracion-sql.test.ts` (desde 20261016 la activación crea una
 *     SUSCRIPCIÓN, no empresa ni negocio en `metrik`);
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
  suscripciones_producto: [],
  suscripciones_producto_eventos: [],
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

/**
 * `valida_activar_autogestion`, lo que deja desde 20261016 (y desde 20261016170000 activa la fila en
 * prueba que nació en el registro, en vez de crear otra). La función real corre en
 * `suscripciones-producto/migracion-sql.test.ts`): la suscripción con la empresa declarada y la tarjeta
 * del registro, los Términos de ESA suscripción y el contrato colgado de ella. Ni empresa ni negocio.
 */
function activarEnLaBase(a: Record<string, unknown>) {
  const reg = tablas.valida_registros.find((r) => r.workspace_id === a.p_workspace_cliente && r.estado === 'creado')
  if (!reg) return { ok: false, error: 'sin_registro' }
  const vivo = tablas.servicios_contratados.find((c) => c.workspace_pagador_id === a.p_workspace_cliente)
  if (vivo) return { ok: true, resultado: 'ya_activo', contrato_id: vivo.id }
  const d = a.p_documento as Record<string, string>
  if (sha(d.texto_md) !== d.texto_sha256) return { ok: false, error: 'documento_invalido' }
  const conTarjeta = reg.metodo_pago_estado === 'registrado' && String(reg.metodo_pago_ref ?? '').startsWith('epayco:')
  // 20261016170000: la suscripción EN PRUEBA del registro pasa a activa; no se crea otra.
  const enPrueba = tablas.suscripciones_producto.find(
    (x) => x.workspace_cliente_id === a.p_workspace_cliente && x.producto === 'valida' && x.estado === 'prueba',
  )
  const suscripcion = {
    id: (enPrueba?.id as string | undefined) ?? nuevoId('suscripcion'),
    workspace_id: METRIK,
    producto: 'valida',
    workspace_cliente_id: a.p_workspace_cliente,
    nombre: `Valida — ${reg.razon_social}`,
    razon_social: reg.razon_social,
    tipo_documento: 'NIT',
    numero_documento: reg.identificacion,
    dv: reg.dv,
    correo_facturacion: reg.correo,
    estado: 'activa',
    origen_comercial: reg.origen,
    valida_registro_id: reg.id,
    metodo_pago_pasarela: conTarjeta ? 'epayco' : null,
    metodo_pago_ref: conTarjeta ? reg.metodo_pago_ref : null,
    datos_fiscales: {},
    metadata: { origen: 'valida_autogestion' },
  }
  const doc = { id: nuevoId('doc'), workspace_id: METRIK, empresa_id: null, suscripcion_id: suscripcion.id, alcance: 'cliente', ...d }
  const contrato = {
    id: nuevoId('contrato'),
    workspace_id: METRIK,
    empresa_id: null,
    negocio_id: null,
    suscripcion_id: suscripcion.id,
    servicio_slug: a.p_servicio_slug,
    servicio_version: 1,
    parametros: a.p_parametros,
    workspace_pagador_id: a.p_workspace_cliente,
    estado: 'activo',
    aceptante_designado_id: a.p_usuario,
  }
  if (enPrueba) Object.assign(enPrueba, suscripcion)
  else tablas.suscripciones_producto.push(suscripcion)
  tablas.documentos_contractuales_versiones.push(doc)
  tablas.servicios_contratados.push(contrato)
  return { ok: true, resultado: 'activado', contrato_id: contrato.id, suscripcion_id: suscripcion.id, documento_id: doc.id }
}

/** `enrolar_cobro_por_ciclo`: plan, cuotas y acta en una transacción. */
function enrolarEnLaBase(a: Record<string, unknown>) {
  const contrato = tablas.servicios_contratados.find((c) => c.id === a.p_servicio_contratado_id) as Fila
  const plan = a.p_plan as Record<string, unknown>
  const planId = nuevoId('plan')
  tablas.planes_cobro.push({ id: planId, workspace_id: contrato.workspace_id, negocio_id: contrato.negocio_id ?? null, suscripcion_id: contrato.suscripcion_id ?? null, ...plan })
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
  registrarClienteEpayco: async (p: { pagador: Record<string, unknown> }) => {
    clientesEpayco.push(p.pagador)
    return { ok: true, ref: REF_TARJETA }
  },
}))
const clientesEpayco: Record<string, unknown>[] = []
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

/** ePayco de mentira. Con una lista, cada cargo responde el siguiente (el último se repite). */
function epaycoDePrueba(resultados: ResultadoCargo | ResultadoCargo[]) {
  const lista = Array.isArray(resultados) ? resultados : [resultados]
  const cargos: SolicitudCargo[] = []
  const adapter = {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
    cobrar: async (s: SolicitudCargo) => {
      cargos.push(s)
      return lista[Math.min(cargos.length, lista.length) - 1]
    },
    consultar: async () => lista[lista.length - 1],
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
      tarjeta: { token: 'XCX92PZqBKfmcWFbA', nombres: 'Diana Estefany', apellidos: 'Sierra Martinez', tipoDocumento: 'CC', documento: '1.020.304.050', celular: '3001234567' },
    })
    expect(alta).toMatchObject({ tipo: 'ok' })
    const reg = tablas.valida_registros[0]
    expect(reg).toMatchObject({
      estado: 'creado',
      // «ACME S.A.S.» → `acme`: el slug sale sin la forma societaria (2026-10-20).
      slug_creado: 'acme',
      condiciones_version: 'condiciones-2.1+aviso-1.5+terminos-auto-2.1',
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
    // Transacción 390341460 (2026-10-19, «Rechazada eControl»): el cliente de ePayco y el cargo llevan
    // el documento y el nombre del TITULAR de la tarjeta, no el NIT ni la razón social de la empresa.
    // Prueba 390432324 (2026-10-19): partir el nombre en la primera palabra mandaba «Diana» / «Estefany
    // Sierra Martinez». Nombres y apellidos llegan en dos campos y así van a ePayco y al cargo.
    expect(clientesEpayco.at(-1)).toMatchObject({ tipoDocumento: 'CC', documento: '1020304050', nombre: 'Diana Estefany', apellido: 'Sierra Martinez' })
    expect(ePayco.cargos[0].cliente).toMatchObject({ tipoDocumento: 'CC', documento: '1020304050', nombre: 'Diana Estefany', apellido: 'Sierra Martinez' })
    expect(tablas.workspaces.find((w) => w.id === reg.workspace_id)?.config_extra).toMatchObject({
      valida_pagador: {
        celular: '3001234567',
        titular: { nombre: 'Diana Estefany Sierra Martinez', nombres: 'Diana Estefany', apellidos: 'Sierra Martinez', tipo_documento: 'CC', documento: '1020304050' },
      },
    })
    expect(pagos).toHaveLength(1)
    expect(rpcs).toEqual(['valida_activar_autogestion', 'enrolar_cobro_por_ciclo'])

    // Desde 20261016: el cliente vive en su SUSCRIPCIÓN, no en el CRM de `metrik`. Contrato, plan,
    // cobro y aceptación cuelgan de ella; ni empresa en el directorio ni negocio.
    const sus = tablas.suscripciones_producto[0]
    expect(tablas.suscripciones_producto).toHaveLength(1)
    expect(sus).toMatchObject({ workspace_cliente_id: reg.workspace_id, razon_social: 'ACME S.A.S.', metodo_pago_ref: REF_TARJETA })
    // Es LA MISMA fila que nació en prueba al registrarse (su línea «prueba» de la bitácora), ahora activa.
    expect(sus.estado).toBe('activa')
    expect(tablas.suscripciones_producto_eventos).toContainEqual(expect.objectContaining({ suscripcion_id: sus.id, tipo: 'prueba' }))
    expect(tablas.negocios).toHaveLength(0)
    expect(tablas.empresas).toHaveLength(0)
    expect(tablas.servicios_contratados[0]).toMatchObject({ negocio_id: null, empresa_id: null, suscripcion_id: sus.id })
    expect(tablas.planes_cobro[0]).toMatchObject({ negocio_id: null, suscripcion_id: sus.id })
    expect(tablas.cobros[0]).toMatchObject({ negocio_id: null, suscripcion_id: sus.id, numero_cuota: 1 })
    expect(tablas.aceptaciones_terminos[0]).toMatchObject({ negocio_id: null, suscripcion_id: sus.id })
    expect(doc).toMatchObject({ empresa_id: null, suscripcion_id: sus.id })
    // La suscripción dice desde cuándo rigen sus Términos (la hora de la casilla).
    expect(sus.terminos_aceptados_at).toBe(reg.aceptado_at)

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
    const { procesarCobrosTrasPrueba, cobrarAlConfirmar, ofertaCobroAlConfirmar } = await import('./cobro-prueba-servidor')
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
      tarjeta: { token: 'XCX92PZqBKfmcWFbA', nombres: 'Diana Estefany', apellidos: 'Sierra Martinez', tipoDocumento: 'CC', documento: '1.020.304.050', celular: '3001234567' },
    })
    expect(alta).toMatchObject({ tipo: 'ok' })
    const reg = tablas.valida_registros[0]
    expect(reg).toMatchObject({ condiciones_version: 'condiciones-2.1+aviso-1.5+terminos-auto-2.1', cobro_estado: 'programado' })

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

    // Minuto 3 de la prueba (de 14): agotó las 10, ve la pantalla y confirma. Se cobra YA, sin aviso previo.
    const oferta = await ofertaCobroAlConfirmar(deps, { workspaceId: String(reg.workspace_id), usuarioId: PERSONA.id, agotada: true })
    if (!oferta.disponible) throw new Error(`sin oferta: ${oferta.motivo}`)
    expect(oferta.detalle).toBe(
      'Activa tu plan ahora: se cobran $150.000 a tu tarjeta terminada en 0326 por el primer mes, y después cada mes en esta misma fecha hasta que te retires.',
    )
    const r = await cobrarAlConfirmar(
      { ...deps, ahoraMs: inicio + 3 * 60_000 },
      { workspaceId: String(reg.workspace_id), usuarioId: PERSONA.id, agotada: true, ip: '181.50.1.3', huella: oferta.huella },
    )
    expect(r).toEqual({ tipo: 'cobrado', ultimos4: '0326' })
    expect(reg.cobro_estado).toBe('cobrado')
    expect(reg.cobro_aviso_enviado_at ?? null).toBeNull()
    expect(String(reg.cobro_confirmado_texto)).toContain('se cobran $150.000 a tu tarjeta terminada en 0326')
    expect(ePayco.cargos).toHaveLength(1)
    expect(ePayco.cargos[0]).toMatchObject({ monto: 150_000, numeroCuota: 1, medioPago: { token_ref: REF_TARJETA } })
    expect(tablas.cobro_intentos_tarjeta).toHaveLength(1)
    expect(tablas.aceptaciones_terminos).toHaveLength(1)
    expect(pagos).toHaveLength(1)
    // La consulta 11 también deja una suscripción, no un negocio.
    expect(tablas.negocios).toHaveLength(0)
    expect(tablas.suscripciones_producto).toHaveLength(1)
    expect(tablas.cobros[0]).toMatchObject({ negocio_id: null, suscripcion_id: tablas.suscripciones_producto[0].id })
    expect(tablas.suscripciones_producto[0].estado).toBe('activa')
    expect(tablas.suscripciones_producto_eventos).toContainEqual(expect.objectContaining({ suscripcion_id: tablas.suscripciones_producto[0].id, tipo: 'prueba' }))

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

describe('consulta 11 → confirma → la tarjeta rechaza → conserva la prueba → el día 7 se cobra (intento 1)', () => {
  it('el rechazo de la confirmación no cierra el registro y el cobro del día 7 sigue en pie, una sola vez', async () => {
    for (const filas of Object.values(tablas)) filas.length = 0
    tablas.workspaces.push({ id: METRIK, slug: 'metrik', config_extra: {} })
    tablas.catalogo_servicios.push({ slug: 'valida-cda-licencia', nombre: 'Licencia Valida', modulo: 'valida_consulta', disparador_cobro: 'ciclo' })
    tablas.catalogo_servicios_versiones.push({ slug: 'valida-cda-licencia', version: 1, definicion: { parametros: { dias_trial: { por_defecto: 0 } } } })
    pagos.length = 0

    const { crearEspacioValida } = await import('./registro-servidor')
    const { procesarCobrosTrasPrueba, cobrarAlConfirmar, ofertaCobroAlConfirmar } = await import('./cobro-prueba-servidor')
    const { cobrarCuotaConTarjeta } = await import('./cobro-token-servidor')
    const { enrolarContratosPorCiclo } = await import('@/lib/cobros/enrolar-ciclo-servidor')
    const { condicionesVigentes, versionAceptada } = await import('./condiciones')
    const { pasarelaBold } = await import('@/lib/suscripciones/pasarela/bold')
    const { dvParaNit } = await import('./datos')

    const inicio = Date.now()
    const alta = await crearEspacioValida({
      razonSocial: 'GAMA S.A.S.',
      nit: '901234569',
      dv: dvParaNit('901234569'),
      acepta: true,
      condicionesVersion: versionAceptada(condicionesVigentes()),
      recomendadoAfi: false,
      codigoAfi: null,
      ref: null,
      utm: {},
      ip: '181.50.1.4',
      tarjeta: { token: 'XCX92PZqBKfmcWFbA', nombres: 'Diana Estefany', apellidos: 'Sierra Martinez', tipoDocumento: 'CC', documento: '1.020.304.050', celular: '3001234567' },
    })
    expect(alta).toMatchObject({ tipo: 'ok' })
    const reg = tablas.valida_registros[0]
    const programado = reg.cobro_programado_at

    const ePayco = epaycoDePrueba([
      { estado: 'rechazado', externalRef: 'epayco-1', codigo: 'rechazada', mensaje: 'Fondos insuficientes', reintentable: false },
      { estado: 'aprobado', externalRef: 'epayco-2', fecha: '2026-10-20', monto: 150_000 },
    ])
    const correos: { idempotencyKey: string }[] = []
    const deps = {
      db: db as never,
      env: ENV_PREVIEW,
      enviarCorreo: async (m: { idempotencyKey: string }) => {
        correos.push(m)
        return { ok: true as const, id: 'resend-1' }
      },
      urlCuenta: (slug: string) => `https://${slug}.metrikone.co/valida`,
      ultimos4: async () => '0326',
      enrolar: (d: Parameters<typeof enrolarContratosPorCiclo>[0]) =>
        enrolarContratosPorCiclo({ ...d, adapterPara: (p) => (p === 'bold' ? pasarelaBold : p === 'epayco' ? ePayco.adapter : null) }),
      cobrarCuota: (d: Parameters<typeof cobrarCuotaConTarjeta>[0], p: Parameters<typeof cobrarCuotaConTarjeta>[1]) =>
        cobrarCuotaConTarjeta({ ...d, adapterPara: (x) => (x === 'epayco' ? ePayco.adapter : null) }, p),
    }

    const oferta = await ofertaCobroAlConfirmar(deps, { workspaceId: String(reg.workspace_id), usuarioId: PERSONA.id, agotada: true })
    if (!oferta.disponible) throw new Error(`sin oferta: ${oferta.motivo}`)
    const r = await cobrarAlConfirmar(
      { ...deps, ahoraMs: inicio + 3 * 60_000 },
      { workspaceId: String(reg.workspace_id), usuarioId: PERSONA.id, agotada: true, ip: '181.50.1.4', huella: oferta.huella },
    )
    expect(r).toMatchObject({ tipo: 'rechazado', ultimos4: '0326' })
    // Conserva la prueba: programado, con el mismo plazo; el plan volvió al enlace; sin correo de cobro.
    expect(reg).toMatchObject({ cobro_estado: 'programado', cobro_programado_at: programado })
    expect(reg.cobro_confirmacion_rechazada_at).toBeTruthy()
    expect(tablas.planes_cobro[0].pasarela).toBe('bold')
    expect(correos).toEqual([])
    expect((await ofertaCobroAlConfirmar(deps, { workspaceId: String(reg.workspace_id), usuarioId: PERSONA.id, agotada: true })).disponible).toBe(false)

    // Minuto 9: el aviso de 48 h (escalado). Minuto 15: el cobro del día 7, intento 1 de la cuota 1.
    expect((await procesarCobrosTrasPrueba({ ...deps, ahoraMs: inicio + 9 * 60_000 })).avisos).toBe(1)
    const dia7 = await procesarCobrosTrasPrueba({ ...deps, ahoraMs: inicio + 15 * 60_000 })
    expect(dia7).toMatchObject({ cobrados: 1, aRevisar: [], errores: [] })
    expect(reg.cobro_estado).toBe('cobrado')
    expect(ePayco.cargos).toHaveLength(2)
    expect(tablas.cobro_intentos_tarjeta.map((i) => [i.intento, i.resultado])).toEqual([
      [0, 'rechazado'],
      [1, 'aprobado'],
    ])
    // Y nada más: otra corrida no cobra.
    await procesarCobrosTrasPrueba({ ...deps, ahoraMs: inicio + 16 * 60_000 })
    expect(ePayco.cargos).toHaveLength(2)
  })
})

describe('«Activar plan» (el tercer camino) también crea una suscripción y su plan cobra por ella', () => {
  it('activarPlanValida → suscripción; al aceptar, asegurarCobroDelEspacio enrola el plan de la suscripción y lo pasa a la tarjeta', async () => {
    for (const filas of Object.values(tablas)) filas.length = 0
    tablas.workspaces.push({ id: METRIK, slug: 'metrik', config_extra: {} })
    tablas.catalogo_servicios.push({ slug: 'valida-cda-licencia', nombre: 'Licencia Valida', modulo: 'valida_consulta', disparador_cobro: 'ciclo' })
    tablas.catalogo_servicios_versiones.push({ slug: 'valida-cda-licencia', version: 1, definicion: { parametros: { dias_trial: { por_defecto: 0 } } } })
    pagos.length = 0
    rpcs.length = 0

    const { crearEspacioValida } = await import('./registro-servidor')
    const { activarPlanValida, asegurarCobroDelEspacio } = await import('./activacion-servidor')
    const { condicionesVigentes, versionAceptada } = await import('./condiciones')
    const { dvParaNit } = await import('./datos')

    const alta = await crearEspacioValida({
      razonSocial: 'DELTA S.A.S.',
      nit: '901234570',
      dv: dvParaNit('901234570'),
      acepta: true,
      condicionesVersion: versionAceptada(condicionesVigentes()),
      recomendadoAfi: true,
      codigoAfi: null,
      ref: null,
      utm: {},
      ip: '181.50.1.5',
      tarjeta: { token: 'XCX92PZqBKfmcWFbA', nombres: 'Diana Estefany', apellidos: 'Sierra Martinez', tipoDocumento: 'CC', documento: '1.020.304.050', celular: '3001234567' },
    })
    expect(alta).toMatchObject({ tipo: 'ok' })
    const reg = tablas.valida_registros[0]
    // El botón no activa un registro con cobro programado (cobraría antes de los 7 días): este registro
    // es el de antes de la tarjeta (sin cobro programado) con sus Términos aceptados.
    reg.cobro_estado = null
    const perfil = tablas.profiles.find((p) => p.id === PERSONA.id)
    if (perfil) perfil.role = 'owner'
    else tablas.profiles.push({ id: PERSONA.id, workspace_id: reg.workspace_id, role: 'owner' })

    const antes = process.env.VALIDA_ACTIVACION_ABIERTA
    process.env.VALIDA_ACTIVACION_ABIERTA = '1'
    try {
      const r = await activarPlanValida({ rut: null })
      expect(r).toEqual({ ok: true, destino: '/valida?terminos=1' })
    } finally {
      if (antes === undefined) delete process.env.VALIDA_ACTIVACION_ABIERTA
      else process.env.VALIDA_ACTIVACION_ABIERTA = antes
    }
    expect(rpcs).toEqual(['valida_activar_autogestion'])
    expect(tablas.negocios).toHaveLength(0)
    expect(tablas.empresas).toHaveLength(0)
    const sus = tablas.suscripciones_producto[0]
    expect(tablas.suscripciones_producto).toHaveLength(1)
    expect(sus).toMatchObject({ workspace_cliente_id: reg.workspace_id, razon_social: 'DELTA S.A.S.', estado: 'activa' })
    expect(tablas.suscripciones_producto_eventos).toContainEqual(expect.objectContaining({ suscripcion_id: sus.id, tipo: 'prueba' }))
    expect(tablas.servicios_contratados[0]).toMatchObject({ suscripcion_id: sus.id, negocio_id: null })

    // La persona acepta los Términos en /valida (canal módulo, aquí ya sembrado sobre la suscripción):
    // el plan nace YA, colgado de la suscripción, y pasa a la tarjeta.
    tablas.aceptaciones_terminos.push({
      id: 'acept-1', canal: 'modulo', estado: 'aceptado', suscripcion_id: sus.id, negocio_id: null, respondido_at: new Date().toISOString(),
    })
    // ePayco apagado en este paso: el cargo de la cuota 1 ya se probó arriba, y aquí no debe salir a la red.
    const epaycoAntes = process.env.EPAYCO_HABILITADO
    delete process.env.EPAYCO_HABILITADO
    const fetchAntes = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('sin red en la prueba')
    }) as typeof fetch
    try {
      await asegurarCobroDelEspacio(String(reg.workspace_id))
    } finally {
      process.env.EPAYCO_HABILITADO = epaycoAntes
      globalThis.fetch = fetchAntes
    }
    expect(rpcs).toEqual(['valida_activar_autogestion', 'enrolar_cobro_por_ciclo'])
    expect(tablas.planes_cobro).toHaveLength(1)
    expect(tablas.planes_cobro[0]).toMatchObject({ suscripcion_id: sus.id, negocio_id: null, pasarela: 'epayco' })
  })
})
