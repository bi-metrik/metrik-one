/**
 * El paso 6a del cron contra un doble que LEE y ESCRIBE: lo que importa aquí no es el cálculo (eso
 * lo fija `enrolar-ciclo.test.ts`) sino de dónde salen los datos, y en particular las dos cosas que
 * un cálculo perfecto no salva:
 *
 *   · el ancla es la aceptación MÁS VIEJA del contrato (un `MAX` correría el trial hacia adelante);
 *   · dos corridas el mismo día dejan UN plan, no dos.
 *
 * El doble de la RPC hace lo mismo que `enrolar_cobro_por_ciclo`: mira el acta, mira si el negocio
 * ya tiene plan, y escribe las tres cosas. Lo que la base garantiza de verdad (el CHECK del ancla,
 * la llave primaria, la inmutabilidad del acta) se prueba contra Postgres en
 * `enrolamiento-sql.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { crearDoble, type Fila, type Tablas } from '../../../test/tablas-doble'
import { enrolarContratosPorCiclo, diasTrialDeFicha } from './enrolar-ciclo-servidor'

const WS = 'ws-metrik'
const NEGOCIO = 'n-fabri'
const CONTRATO = 'c-radar'

function tablasBase(extra: Partial<Tablas> = {}): Tablas {
  return {
    catalogo_servicios: [
      { slug: 'radar-secop-licencia', nombre: 'Licencia Radar SECOP', modulo: 'radar_secop', disparador_cobro: 'ciclo' },
      // Un servicio por ciclo de OTRO módulo: no se debe ni leer.
      { slug: 'valida-cda-licencia', nombre: 'Licencia Valida por CDA', modulo: 'valida_consulta', disparador_cobro: 'ciclo' },
    ],
    catalogo_servicios_versiones: [
      {
        slug: 'radar-secop-licencia',
        version: 1,
        definicion: { parametros: { dias_trial: { tipo: 'entero', por_defecto: 5 } } },
      },
    ],
    servicios_contratados: [
      {
        id: CONTRATO,
        workspace_id: WS,
        negocio_id: NEGOCIO,
        estado: 'activo',
        servicio_slug: 'radar-secop-licencia',
        servicio_version: 1,
        parametros: { precio_mensual: 15_000 },
      },
    ],
    servicio_cobro_enrolamiento: [],
    planes_cobro: [],
    plan_cobro_cuotas: [],
    aceptaciones_terminos: [
      { id: 'a1', negocio_id: NEGOCIO, estado: 'aceptado', respondido_at: '2026-09-29T14:30:00Z' },
    ],
    workspaces: [{ id: WS, config_extra: { cobros: { pasarela_en_linea: 'bold' } } }],
    ...extra,
  }
}

/** Un doble con `rpc`, que escribe lo mismo que la función de la base. */
function dobleConRpc(tablas: Tablas) {
  const { db, tablas: t } = crearDoble(tablas)
  const llamadas: { args: Record<string, unknown> }[] = []
  let secuencia = 0
  const rpc = async (nombre: string, args: Record<string, unknown>) => {
    if (nombre !== 'enrolar_cobro_por_ciclo') throw new Error(`rpc inesperada: ${nombre}`)
    llamadas.push({ args })
    const contratoId = args.p_servicio_contratado_id as string
    const contrato = (t.servicios_contratados ?? []).find((c) => c.id === contratoId)
    if (!contrato) return { data: null, error: { message: 'contrato inexistente' } }
    const acta = (t.servicio_cobro_enrolamiento ?? []).find((a) => a.servicio_contratado_id === contratoId)
    if (acta) return { data: { resultado: 'ya_estaba', plan_cobro_id: acta.plan_cobro_id }, error: null }
    const previo = (t.planes_cobro ?? []).find(
      (p) => p.workspace_id === contrato.workspace_id && p.negocio_id === contrato.negocio_id,
    )
    if (previo) return { data: { resultado: 'plan_existente', plan_cobro_id: previo.id }, error: null }

    const plan = args.p_plan as Record<string, unknown>
    const cuotas = args.p_cuotas as Fila[]
    const planId = `plan-${++secuencia}`
    ;(t.planes_cobro ??= []).push({ id: planId, workspace_id: contrato.workspace_id, negocio_id: contrato.negocio_id, activo: false, ...plan })
    for (const c of cuotas) {
      ;(t.plan_cobro_cuotas ??= []).push({ id: `cuota-${planId}-${c.numero}`, plan_cobro_id: planId, workspace_id: contrato.workspace_id, ...c })
    }
    ;(t.servicio_cobro_enrolamiento ??= []).push({
      servicio_contratado_id: contratoId,
      workspace_id: contrato.workspace_id,
      negocio_id: contrato.negocio_id,
      plan_cobro_id: planId,
      ancla_at: args.p_ancla_at,
      dias_trial: args.p_dias_trial,
    })
    return { data: { resultado: 'creado', plan_cobro_id: planId }, error: null }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake = { from: (x: string) => (db as any).from(x), rpc } as any
  return { db: fake, tablas: t, llamadas }
}

const conPasarela = { adapterPara: () => ({ crearEnlacePago: async () => null }) as never }

describe('el paso 6a enrola el contrato del Radar', () => {
  it('crea un plan, sus 12 cuotas y el acta, con la cuota 1 el día en que termina el trial', async () => {
    const d = dobleConRpc(tablasBase())
    const r = await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })

    expect(r.candidatos).toBe(1)
    expect(r.creados).toHaveLength(1)
    expect(r.creados[0].finTrial).toBe('2026-10-04')
    expect(r.errores).toEqual([])
    expect(d.tablas.planes_cobro).toHaveLength(1)
    expect(d.tablas.plan_cobro_cuotas).toHaveLength(12)
    expect(d.tablas.plan_cobro_cuotas?.[0]).toMatchObject({ numero: 1, monto: 15_000, fecha_vencimiento: '2026-10-04' })
    // El plan nace apagado: `activo` es el interruptor del emisor de CUENTAS de cobro, y el Radar
    // se cobra por enlace. El paso 6 (el enlace) no mira `activo`.
    expect(d.tablas.planes_cobro?.[0].activo).toBe(false)
    expect(d.tablas.planes_cobro?.[0].pasarela).toBe('bold')
  })

  it('el ancla es la aceptación MÁS VIEJA: aceptar una versión nueva no corre el trial', async () => {
    const d = dobleConRpc(
      tablasBase({
        aceptaciones_terminos: [
          { id: 'a2', negocio_id: NEGOCIO, estado: 'aceptado', respondido_at: '2026-10-20T10:00:00Z' },
          { id: 'a1', negocio_id: NEGOCIO, estado: 'aceptado', respondido_at: '2026-09-29T14:30:00Z' },
        ],
      }),
    )
    const r = await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })
    expect(r.creados[0].finTrial).toBe('2026-10-04')
    expect(d.llamadas[0].args.p_ancla_at).toBe('2026-09-29T14:30:00Z')
  })

  it('una aceptación que NO quedó aceptada no ancla nada', async () => {
    const d = dobleConRpc(
      tablasBase({
        aceptaciones_terminos: [{ id: 'a1', negocio_id: NEGOCIO, estado: 'pendiente', respondido_at: null }],
      }),
    )
    const r = await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })
    expect(r.creados).toEqual([])
    expect(r.descartes).toEqual({ sin_aceptacion: 1 })
    expect(d.llamadas).toEqual([])
  })
})

describe('idempotencia', () => {
  it('dos corridas el mismo día dejan UN plan y UNA llamada que escribe', async () => {
    const d = dobleConRpc(tablasBase())
    await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })
    const segunda = await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })

    // La segunda corrida ni llega a la RPC: el acta ya está y la decisión pura lo descarta.
    expect(segunda.creados).toEqual([])
    expect(segunda.descartes).toEqual({ ya_enrolado: 1 })
    expect(d.tablas.planes_cobro).toHaveLength(1)
    expect(d.tablas.plan_cobro_cuotas).toHaveLength(12)
    expect(d.llamadas).toHaveLength(1)
  })

  it('si el acta se perdiera, el plan que quedó sigue frenando: no se duplican cuotas', async () => {
    // El caso que mordió con el emisor de cuentas: la idempotencia no puede depender de UNA fila.
    // Aquí se borra el acta a mano y el plan del negocio es el que frena. La tercera barrera (la de
    // la base, que responde `plan_existente` aunque la selección falle) vive en
    // `enrolamiento-sql.test.ts`, donde se puede hacer fallar de verdad.
    const d = dobleConRpc(tablasBase())
    await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })
    d.tablas.servicio_cobro_enrolamiento = []

    const segunda = await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })
    expect(segunda.creados).toEqual([])
    expect(segunda.descartes).toEqual({ plan_existente: 1 })
    expect(d.llamadas).toHaveLength(1)
    expect(d.tablas.planes_cobro).toHaveLength(1)
    expect(d.tablas.plan_cobro_cuotas).toHaveLength(12)
  })
})

describe('lo que no toca', () => {
  it('un contrato de otro módulo no entra ni a la lista de candidatos', async () => {
    const d = dobleConRpc(
      tablasBase({
        servicios_contratados: [
          {
            id: 'c-cda',
            workspace_id: WS,
            negocio_id: 'n-cda',
            estado: 'activo',
            servicio_slug: 'valida-cda-licencia',
            servicio_version: 1,
            parametros: { precio_mensual: 150_000 },
          },
        ],
      }),
    )
    const r = await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })
    expect(r.candidatos).toBe(0)
    expect(r.creados).toEqual([])
    expect(d.tablas.planes_cobro).toEqual([])
  })

  it('sin pasarela en línea configurada no se enrola nada', async () => {
    const d = dobleConRpc(tablasBase({ workspaces: [{ id: WS, config_extra: {} }] }))
    const r = await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })
    expect(r.descartes).toEqual({ sin_pasarela: 1 })
    expect(d.tablas.planes_cobro).toEqual([])
  })

  it('sin `dias_trial` en el contrato toma el de la ficha guardada de ESA versión', async () => {
    const d = dobleConRpc(
      tablasBase({
        catalogo_servicios_versiones: [
          { slug: 'radar-secop-licencia', version: 1, definicion: { parametros: { dias_trial: { por_defecto: 15 } } } },
        ],
      }),
    )
    const r = await enrolarContratosPorCiclo({ db: d.db, ...conPasarela })
    // 15 días, no 5: el contrato no dijo nada y la ficha de su versión manda.
    expect(r.creados[0].finTrial).toBe('2026-10-14')
  })
})

describe('diasTrialDeFicha', () => {
  it('lee `por_defecto` y devuelve null cuando la ficha no lo declara', () => {
    expect(diasTrialDeFicha({ parametros: { dias_trial: { por_defecto: 5 } } })).toBe(5)
    expect(diasTrialDeFicha({ parametros: { precio_mensual: { por_defecto: 20_000 } } })).toBeNull()
    expect(diasTrialDeFicha({ parametros: { dias_trial: { tipo: 'entero' } } })).toBeNull()
    expect(diasTrialDeFicha(null)).toBeNull()
  })
})
