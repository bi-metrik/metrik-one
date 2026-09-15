/**
 * El aviso de sobrepago contra una base que ESCRIBE.
 *
 * La idempotencia solo se puede probar si lo que se crea queda: con un doble de solo
 * lectura, "no repitió porque ya existía" y "no repitió porque nunca creó" se ven igual.
 * Por eso `crear_notificacion_equipo` inserta de verdad en la tabla falsa, reparte por
 * `staff_areas` como la función real, y no inserta si ya hay un pendiente con esa clave.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>
const tablas: Record<string, Fila[]> = {}
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []
let fallarLecturaDe: string | null = null

function valorDe(fila: Fila, columna: string): unknown {
  const [cabeza, ...resto] = columna.split('.')
  if (resto.length === 0) {
    const partes = cabeza.split(/->>?/)
    let v: unknown = fila[partes[0]]
    for (const p of partes.slice(1)) v = (v as Fila | null | undefined)?.[p]
    return v
  }
  return valorDe((fila[cabeza] ?? {}) as Fila, resto.join('.'))
}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros.push((f) => String(valorDe(f, c)) === String(v)); return q },
    in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(valorDe(f, c))); return q },
    like: (c: string, patron: string) => {
      const re = new RegExp('^' + patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$')
      filtros.push((f) => re.test(String(valorDe(f, c) ?? '')))
      return q
    },
    filas: () => (tablas[tabla] ?? []).filter((f) => filtros.every((fn) => fn(f))),
    maybeSingle: async () => ({ data: q.filas()[0] ?? null, error: null }),
    then: (resolve: (r: { data: Fila[] | null; error: { message: string } | null }) => unknown) =>
      resolve(fallarLecturaDe === tabla ? { data: null, error: { message: 'boom' } } : { data: q.filas(), error: null }),
  }
  return q
}

const servicioFalso = {
  from: (t: string) => consulta(t),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    rpcs.push({ fn, args })
    if (fn === 'crear_notificacion_equipo') {
      const notifs = (tablas.notificaciones ??= [])
      if (notifs.some((n) => n.grupo_clave === args.p_grupo_clave && n.estado === 'pendiente')) return { data: 0, error: null }
      const staffIds = (tablas.staff_areas ?? []).filter((a) => a.area === args.p_area).map((a) => a.staff_id)
      const perfiles = (tablas.staff ?? []).filter((s) => staffIds.includes(s.id)).map((s) => s.profile_id)
      for (const p of perfiles) {
        notifs.push({
          workspace_id: args.p_workspace_id, destinatario_id: p, tipo: args.p_tipo, estado: 'pendiente',
          contenido: args.p_contenido, grupo_clave: args.p_grupo_clave, deep_link: args.p_deep_link,
          entidad_tipo: args.p_entidad_tipo, entidad_id: args.p_entidad_id,
        })
      }
      return { data: perfiles.length, error: null }
    }
    if (fn === 'resolver_grupo_notificaciones') {
      for (const n of tablas.notificaciones ?? []) {
        if (n.grupo_clave === args.p_grupo_clave && n.estado === 'pendiente') n.estado = 'completada'
      }
      return { data: 1, error: null }
    }
    return { data: null, error: null }
  },
  auth: {
    admin: {
      getUserById: async (id: string) => ({ data: { user: { email: `${id}@soena.test` } }, error: null }),
    },
  },
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => servicioFalso }))

import { avisarSobrepagoSiCorresponde } from './aviso-sobrepago-servidor'

const WS = 'ws-soena'
const NEG = 'neg-v0442'
const fetchFalso = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }))

function sembrar(opts: { configLinea?: Fila | null; pagos?: number[] } = {}) {
  for (const k of Object.keys(tablas)) delete tablas[k]
  rpcs.length = 0
  fallarLecturaDe = null
  tablas.negocios = [{
    id: NEG, workspace_id: WS, codigo: 'V0442', nombre: 'NORA ANETH PAVA RIPOLL',
    precio_aprobado: 637_500, precio_estimado: null,
    lineas_negocio: { config_extra: opts.configLinea === undefined
      ? { aviso_sobrepago: { activo: true, areas: ['financiera'], email: true } }
      : opts.configLinea },
    workspaces: { slug: 'soena', config_extra: {} },
  }]
  tablas.cobros = (opts.pagos ?? [1_356_500]).map((monto) => ({
    workspace_id: WS, negocio_id: NEG, monto, tipo_cobro: 'externo', split_json: null,
  }))
  tablas.negocio_conciliacion = []
  tablas.negocio_bloques = [
    { negocio_id: NEG, data: { tarifa_confirmada: true, tarifa_upme_confirmada: 701_812 },
      bloque_configs: { slug: 'confirmar_tarifa', config_extra: { tarifa_confirmacion: { enabled: true } } } },
    { negocio_id: NEG, data: { servicio: 'completo' },
      bloque_configs: { slug: 'servicio_contratado', config_extra: {} } },
  ]
  tablas.staff = [
    { id: 'st-diana', profile_id: 'diana' },
    { id: 'st-leidy', profile_id: 'leidy' },
    { id: 'st-deisy', profile_id: 'deisy' },
  ]
  tablas.staff_areas = [
    { staff_id: 'st-diana', area: 'financiera' },
    { staff_id: 'st-leidy', area: 'financiera' },
    { staff_id: 'st-deisy', area: 'operaciones' },
  ]
  tablas.notificaciones = []
}

const creaciones = () => rpcs.filter((r) => r.fn === 'crear_notificacion_equipo')

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test'
  process.env.NEXT_PUBLIC_BASE_DOMAIN = 'metrikone.co'
  fetchFalso.mockClear()
  vi.stubGlobal('fetch', fetchFalso)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('avisarSobrepagoSiCorresponde', () => {
  it('sin la config, no crea nada ni manda correo', async () => {
    sembrar({ configLinea: {} })
    expect(await avisarSobrepagoSiCorresponde(WS, NEG)).toEqual({ avisado: false, motivo: 'apagado' })
    expect(rpcs).toHaveLength(0)
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('V0442: avisa a la financiera por campana y por correo, con enlace a sobrantes', async () => {
    sembrar()
    const r = await avisarSobrepagoSiCorresponde(WS, NEG)
    expect(r).toEqual({ avisado: true, exceso: 17_188, areas: ['financiera'], correos: 2 })

    const notifs = tablas.notificaciones
    expect(notifs.map((n) => n.destinatario_id).sort()).toEqual(['diana', 'leidy'])
    expect(notifs[0].deep_link).toBe('/conciliacion?pestana=saldos&saldo=sobrante')
    // Nada colgado del negocio: el aviso no aparece en su pantalla.
    expect(notifs[0].entidad_tipo).toBeNull()
    expect(notifs[0].entidad_id).toBeNull()
    expect(String(notifs[0].contenido)).toContain('17.188')

    expect(fetchFalso).toHaveBeenCalledTimes(1)
    const cuerpo = JSON.parse((fetchFalso.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(cuerpo.to.sort()).toEqual(['diana@soena.test', 'leidy@soena.test'])
    expect(cuerpo.html).toContain('https://soena.metrikone.co/conciliacion?pestana=saldos&saldo=sobrante')
  })

  it('el mismo sobrepago no se vuelve a avisar en el siguiente avance', async () => {
    sembrar()
    await avisarSobrepagoSiCorresponde(WS, NEG)
    expect(await avisarSobrepagoSiCorresponde(WS, NEG)).toEqual({ avisado: false, motivo: 'ya_avisado' })
    expect(creaciones()).toHaveLength(1)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('que la financiera lo marque atendido no hace que se repita', async () => {
    sembrar()
    await avisarSobrepagoSiCorresponde(WS, NEG)
    for (const n of tablas.notificaciones) n.estado = 'completada'
    expect(await avisarSobrepagoSiCorresponde(WS, NEG)).toEqual({ avisado: false, motivo: 'ya_avisado' })
    expect(creaciones()).toHaveLength(1)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('si entra otro pago y el sobrante cambia, avisa la cifra nueva y retira la vieja', async () => {
    sembrar()
    await avisarSobrepagoSiCorresponde(WS, NEG)
    tablas.cobros.push({ workspace_id: WS, negocio_id: NEG, monto: 50_000, tipo_cobro: 'externo', split_json: null })

    const r = await avisarSobrepagoSiCorresponde(WS, NEG)
    expect(r).toMatchObject({ avisado: true, exceso: 67_188 })
    const pendientes = tablas.notificaciones.filter((n) => n.estado === 'pendiente')
    expect(new Set(pendientes.map((n) => n.grupo_clave)).size).toBe(1)
    expect(String(pendientes[0].grupo_clave)).toContain(':exceso:67188:')
  })

  it('sin sobrepago no hace nada', async () => {
    sembrar({ pagos: [637_500 + 701_812] })
    expect(await avisarSobrepagoSiCorresponde(WS, NEG)).toEqual({ avisado: false, motivo: 'sin_sobrepago' })
    expect(rpcs).toHaveLength(0)
  })

  it('sin email: true, sale la campana y no el correo', async () => {
    sembrar({ configLinea: { aviso_sobrepago: { activo: true } } })
    expect(await avisarSobrepagoSiCorresponde(WS, NEG)).toMatchObject({ avisado: true, correos: 0 })
    expect(tablas.notificaciones).toHaveLength(2)
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('si no puede leer la plata no afirma nada, y nunca lanza', async () => {
    sembrar()
    fallarLecturaDe = 'cobros'
    expect(await avisarSobrepagoSiCorresponde(WS, NEG)).toEqual({ avisado: false, motivo: 'error' })
    expect(tablas.notificaciones).toHaveLength(0)

    expect(await avisarSobrepagoSiCorresponde(null, NEG)).toEqual({ avisado: false, motivo: 'sin_datos' })
  })

  it('un área sin nadie no deja el aviso marcado como enviado: se reintenta después', async () => {
    sembrar()
    tablas.staff_areas = []
    expect(await avisarSobrepagoSiCorresponde(WS, NEG)).toEqual({ avisado: false, motivo: 'sin_destinatarios' })
    tablas.staff_areas = [{ staff_id: 'st-diana', area: 'financiera' }]
    expect(await avisarSobrepagoSiCorresponde(WS, NEG)).toMatchObject({ avisado: true, correos: 1 })
  })
})
