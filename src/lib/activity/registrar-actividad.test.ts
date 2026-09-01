import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registrarActividad, actualizarActividad, type FilaActividad } from './registrar-actividad'

/**
 * Doble consciente de TABLA y de CHECK.
 *
 * No es un mock que devuelve `{ error: null }`: reproduce el rechazo real de Postgres
 * (`23514 new row for relation "activity_log" violates check constraint
 * "activity_log_tipo_check"`) para los tipos que no están en la lista que se le pasa,
 * y registra contra qué tabla se llamó. Un doble que aceptara cualquier fila no
 * probaría nada — el defecto original es precisamente que la fila rebotaba y el código
 * no se enteraba.
 */
function clienteFalso(opts: {
  tiposPermitidos?: string[]
  /** Fuerza un rechazo distinto al del CHECK (p. ej. la FK de `autor_id`). */
  errorForzado?: { code: string; message: string }
  /** Simula un cliente que revienta en vez de devolver `{ error }`. */
  lanza?: boolean
}) {
  const registro = {
    tablas: [] as string[],
    filasInsertadas: [] as Record<string, unknown>[],
    actualizaciones: [] as { id: string; cambios: Record<string, unknown> }[],
  }

  const cliente = {
    from(tabla: string) {
      registro.tablas.push(tabla)
      if (opts.lanza) throw new Error('conexión caída')
      return {
        insert(fila: Record<string, unknown>) {
          registro.filasInsertadas.push(fila)
          const rechazo =
            opts.errorForzado ??
            (opts.tiposPermitidos && !opts.tiposPermitidos.includes(String(fila.tipo))
              ? {
                  code: '23514',
                  message:
                    'new row for relation "activity_log" violates check constraint "activity_log_tipo_check"',
                }
              : null)
          return {
            select() {
              return {
                async maybeSingle() {
                  // Postgres rechaza la fila ENTERA: no devuelve id.
                  return rechazo
                    ? { data: null, error: rechazo }
                    : { data: { id: 'log-1' }, error: null }
                },
              }
            },
          }
        },
        update(cambios: Record<string, unknown>) {
          return {
            async eq(_col: string, id: string) {
              registro.actualizaciones.push({ id, cambios })
              return { error: opts.errorForzado ?? null }
            },
          }
        },
      }
    },
  }

  return { cliente, registro }
}

const FILA: FilaActividad = {
  workspace_id: 'ws-soena',
  entidad_tipo: 'negocio',
  entidad_id: 'neg-v0429',
  tipo: 'propuesta_aprobada',
  autor_id: 'staff-1',
  contenido: 'Propuesta económica v1 aprobada — Plan 2',
}

describe('registrarActividad', () => {
  let errores: string[]
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errores = []
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errores.push(args.map(String).join(' '))
    })
  })
  afterEach(() => spy.mockRestore())

  it('un tipo que el CHECK rechaza NO desaparece: se reporta con entidad, tipo y motivo', async () => {
    // El CHECK viejo de producción: los 7 valores que admitía antes de este PR.
    const { cliente, registro } = clienteFalso({
      tiposPermitidos: [
        'comentario',
        'cambio',
        'sistema',
        'cambio_etapa',
        'cambio_estado',
        'solicitud_conciliacion',
        'conciliacion_atendida',
      ],
    })

    const r = await registrarActividad(cliente, FILA, 'aprobarVersionPropuesta')

    expect(r.ok).toBe(false)
    expect(registro.tablas).toEqual(['activity_log'])

    // Lo que hace diagnosticable el fallo desde los logs de producción. Sin esto el
    // rechazo se ve exactamente igual que el caso sano, que es el defecto original.
    expect(errores).toHaveLength(1)
    expect(errores[0]).toContain('aprobarVersionPropuesta')
    expect(errores[0]).toContain('negocio:neg-v0429')
    expect(errores[0]).toContain('propuesta_aprobada')
    expect(errores[0]).toContain('23514')
    expect(errores[0]).toContain('activity_log_tipo_check')
  })

  it('el rechazo NO tumba la operación de negocio que lo originó', async () => {
    const { cliente } = clienteFalso({ tiposPermitidos: ['cambio'] })

    // La prueba es que la llamada resuelve en vez de lanzar: quien la invoca (aprobar
    // la propuesta, registrar el pago) sigue su camino. Revertir el trabajo real
    // porque no se pudo anotar sería peor que la anotación faltante.
    await expect(
      registrarActividad(cliente, FILA, 'aprobarVersionPropuesta'),
    ).resolves.toMatchObject({ ok: false })
  })

  it('un cliente que LANZA tampoco tumba la operación, y también se reporta', async () => {
    const { cliente } = clienteFalso({ lanza: true })

    const r = await registrarActividad(cliente, FILA, 'ensureNegocioDriveFolder')

    expect(r.ok).toBe(false)
    expect(errores[0]).toContain('conexión caída')
    expect(errores[0]).toContain('ensureNegocioDriveFolder')
  })

  it('un autor_id que no existe en staff también se ve — no solo el CHECK', async () => {
    // Segundo fallo mudo real: `activity_log.autor_id` es FK a `staff(id)`, y los
    // inserts de platform admin pasaban un `profiles.id`. Ampliar el CHECK no habría
    // arreglado eso; el helper lo hace visible.
    const { cliente } = clienteFalso({
      errorForzado: {
        code: '23503',
        message: 'insert or update on table "activity_log" violates foreign key constraint "activity_log_autor_id_fkey"',
      },
    })

    const r = await registrarActividad(cliente, { ...FILA, tipo: 'platform_admin_enter' }, 'switchWorkspace')

    expect(r.ok).toBe(false)
    expect(errores[0]).toContain('23503')
    expect(errores[0]).toContain('activity_log_autor_id_fkey')
  })

  it('cuando la fila entra, devuelve su id para quien lo necesite', async () => {
    const { cliente, registro } = clienteFalso({ tiposPermitidos: ['propuesta_aprobada'] })

    const r = await registrarActividad(cliente, FILA, 'aprobarVersionPropuesta')

    expect(r).toEqual({ ok: true, id: 'log-1' })
    expect(errores).toHaveLength(0)
    // El id lo consumen las menciones de un comentario y la traza de correcciones.
    expect(registro.filasInsertadas[0]).toMatchObject({ tipo: 'propuesta_aprobada' })
  })

  it('escribe la fila tal cual, sin inventar ni perder columnas', async () => {
    const { cliente, registro } = clienteFalso({ tiposPermitidos: ['cambio'] })

    await registrarActividad(
      cliente,
      {
        workspace_id: 'ws',
        entidad_tipo: 'negocio',
        entidad_id: 'n1',
        tipo: 'cambio',
        campo_modificado: 'precio_aprobado',
        valor_anterior: '100',
        valor_nuevo: '200',
        autor_id: null,
      },
      'corregirAprobacion',
    )

    expect(registro.filasInsertadas[0]).toEqual({
      workspace_id: 'ws',
      entidad_tipo: 'negocio',
      entidad_id: 'n1',
      tipo: 'cambio',
      campo_modificado: 'precio_aprobado',
      valor_anterior: '100',
      valor_nuevo: '200',
      autor_id: null,
    })
  })
})

describe('actualizarActividad', () => {
  let errores: string[]
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errores = []
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errores.push(args.map(String).join(' '))
    })
  })
  afterEach(() => spy.mockRestore())

  it('refresca el evento y reporta si no pudo', async () => {
    const ok = clienteFalso({})
    await expect(
      actualizarActividad(ok.cliente, 'log-9', { valor_nuevo: '200' }, 'correcciones'),
    ).resolves.toEqual({ ok: true })
    expect(ok.registro.actualizaciones).toEqual([
      { id: 'log-9', cambios: { valor_nuevo: '200' } },
    ])

    const malo = clienteFalso({ errorForzado: { code: '42501', message: 'permission denied' } })
    const r = await actualizarActividad(malo.cliente, 'log-9', { contenido: 'x' }, 'correcciones')
    expect(r.ok).toBe(false)
    expect(errores[0]).toContain('log-9')
    expect(errores[0]).toContain('permission denied')
  })
})
