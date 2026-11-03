/**
 * Resumen diario por correo (spec 2026-10-26, §4.3). Las pruebas van sobre el correo que de verdad se manda.
 */
import { describe, expect, it } from 'vitest'
import { aliasWa, type FilaChatwoot, type FilaWa } from './conversaciones'
import { textoJuez } from './calificacion'
import {
  enviarResumenDia,
  llaveResumen,
  type CalificacionLeida,
  type CorreoResumen,
  type EnvioResumen,
  type EscalamientoLeido,
  type PuertoResumen,
} from './resumen'

const WS_SABOR = '11111111-1111-1111-1111-111111111111'
const WS_IMPERVIUN = '33333333-3333-3333-3333-333333333333'
const FECHA = '2026-10-25'
const hora = (hhmm: string) => new Date(Date.parse(`${FECHA}T${hhmm}:00.000Z`) + 5 * 3600 * 1000).toISOString()
const uso = (entrada: number, salida: number) => [{ modelo: 'claude-haiku-5-5', entrada, salida, razonamiento: 0, cache: 0, ms: 900, ok: true }]

function cw(p: Partial<FilaChatwoot> & { created_at: string }): FilaChatwoot {
  return {
    workspace_id: WS_SABOR, cuenta_id: 7, conversacion_id: 901, direccion: 'entrante', clase: 'escrito', texto: null,
    enmascarado: false, opciones: null, toque_id: null, turno_id: null, estado: null, traza: null, ...p,
  }
}

function wa(p: Partial<FilaWa> & { created_at: string }): FilaWa {
  return {
    workspace_id: WS_IMPERVIUN, phone: '573001234567', direccion: 'entrante', clase: 'escrito', texto: null, opciones: null,
    toque_id: null, turno_id: null, traza: null, ...p,
  }
}

const T_SABOR = 'bbbbbbbb-0000-0000-0000-000000000001'
const T_SABOR_2 = 'bbbbbbbb-0000-0000-0000-000000000002'

/** Sabor: un cliente que se presenta con nombre y celular, un candado que ataja, una reserva y un turno que no pudo. */
function filasSabor(): FilaChatwoot[] {
  return [
    cw({ created_at: hora('15:00'), texto: 'Hola, soy Mariana Restrepo, mi cel es 315 950 9103', turno_id: T_SABOR }),
    cw({ created_at: hora('15:00'), clase: 'audio', texto: 'quiero dos boletas para el viernes', turno_id: T_SABOR }),
    cw({
      created_at: hora('15:01'), direccion: 'saliente', clase: 'bot', estado: 'publicado', turno_id: T_SABOR, texto: 'Hola Mariana, te aparto dos.',
      traza: {
        tipo: 'modelo', bot: 'asistente-publico', rol: { clave: 'asesor_vendedor' }, uso: uso(10_000, 1_000),
        herramientas: [{ nombre: 'consultar_funciones', ok: true, datos: { reservas: [{ cliente: 'Carlos Gómez' }] } }],
        candados: [{ candado: 'precio_autorizado', detalle: 'precio dicho a Mariana Restrepo sin autorizar' }],
        ejecucion: { huella: 'h', resultado: 'ejecutada' },
      },
    }),
    cw({
      created_at: hora('15:05'), direccion: 'saliente', clase: 'bot', estado: 'publicado', turno_id: T_SABOR_2, texto: 'Tuve un problema.',
      traza: { tipo: 'modelo', bot: 'asistente-publico', rol: { clave: 'asesor_vendedor' }, uso: uso(5_000, 0), error: 'modelo caído' },
    }),
  ]
}

function filasImperviun(): FilaWa[] {
  return [
    wa({ created_at: hora('08:00'), texto: 'gasto 50.000 de almuerzo', turno_id: 'cccccccc-0000-0000-0000-000000000001' }),
    wa({
      created_at: hora('08:00'), direccion: 'saliente', clase: 'bot', texto: '¿Registro?', turno_id: 'cccccccc-0000-0000-0000-000000000001',
      traza: { tipo: 'modelo', bot: 'one', rol: { clave: 'mano_derecha' }, uso: uso(2_000, 200) },
    }),
  ]
}

function calificacionesSabor(): CalificacionLeida[] {
  return [{
    workspace_id: WS_SABOR, rol_clave: 'asesor_vendedor', conversacion: 'cw:7:901', resuelta: false, nota: 1,
    juez: textoJuez('claude-haiku-5-5', 3_000, 300),
    fallas: [
      { tipo: 'D3', turno: T_SABOR, evidencia: 'Le dijo a Persona 1 que el viernes cuesta 80.000' },
      { tipo: 'F9', turno: T_SABOR_2, evidencia: 'Persona 1 pidió hablar con alguien; Carlos no fue avisado' },
      { tipo: 'F9', turno: T_SABOR_2, evidencia: 'repitió la petición' },
    ],
  }]
}

const PRECIOS = [{ modelo: 'claude-haiku-5-5', entrada: 1, salida: 5, cache: null }]

function puerto(p: { wa?: FilaWa[]; chatwoot?: FilaChatwoot[]; escalamientos?: EscalamientoLeido[]; calificaciones?: CalificacionLeida[] } = {}): PuertoResumen {
  return {
    filasDelDia: async () => ({ wa: p.wa ?? [], chatwoot: p.chatwoot ?? [] }),
    escalamientos: async () => p.escalamientos ?? [],
    calificaciones: async () => p.calificaciones ?? [],
    workspaces: async (ids) => new Map(ids.map((id) => [id, id === WS_SABOR
      ? { nombre: 'Sabor & Experiencias (sabor)', conTexto: true }
      : { nombre: 'Imperviun (imperviun)', conTexto: false }])),
    precios: async () => PRECIOS,
  }
}

/** Un Resend de mentira que deduplica por `Idempotency-Key`, como el de verdad. */
function resendFalso() {
  const llamados: CorreoResumen[] = []
  const entregados = new Map<string, CorreoResumen>()
  const enviar: EnvioResumen = async (m) => {
    llamados.push(m)
    if (!entregados.has(m.idempotencyKey)) entregados.set(m.idempotencyKey, m)
    return { ok: true }
  }
  return { enviar, llamados, entregados }
}

describe('enviarResumenDia', () => {
  it('un día sin actividad: el correo sale igual, con «sin actividad»', async () => {
    const r = resendFalso()
    const res = await enviarResumenDia(FECHA, { puerto: puerto(), enviar: r.enviar })
    expect(res).toMatchObject({ ok: true, conversaciones: 0 })
    expect(r.llamados).toHaveLength(1)
    const m = r.llamados[0]
    expect(m.to).toBe('mauricio.moreno@metrik.com.co')
    expect(m.subject).toBe('Asistentes · 2026-10-25 · sin actividad')
    expect(m.text).toContain('Sin actividad')
    expect(m.idempotencyKey).toBe('resumen-asistentes:2026-10-25')
  })

  it('dos workspaces: un solo correo con los dos', async () => {
    const r = resendFalso()
    await enviarResumenDia(FECHA, { puerto: puerto({ chatwoot: filasSabor(), wa: filasImperviun(), calificaciones: calificacionesSabor() }), enviar: r.enviar })
    expect(r.llamados).toHaveLength(1)
    const t = r.llamados[0].text
    expect(t).toContain('== Imperviun (imperviun) (solo métricas de trazas: sin calificación con texto) ==')
    expect(t).toContain('== Sabor & Experiencias (sabor) ==')
    expect(r.llamados[0].subject).toMatch(/^Asistentes · 2026-10-25 · 2 conversación\(es\) · \d+ por revisar$/)
  })

  it('un reintento manda la misma llave y Resend no repite el correo', async () => {
    const r = resendFalso()
    const p = puerto({ chatwoot: filasSabor() })
    await enviarResumenDia(FECHA, { puerto: p, enviar: r.enviar })
    await enviarResumenDia(FECHA, { puerto: p, enviar: r.enviar })
    expect(r.llamados.map((m) => m.idempotencyKey)).toEqual([llaveResumen(FECHA), llaveResumen(FECHA)])
    expect(r.entregados.size).toBe(1)
  })

  it('un cliente final con nombre en la conversación no aparece en el correo (ni su teléfono)', async () => {
    const r = resendFalso()
    await enviarResumenDia(FECHA, { puerto: puerto({ chatwoot: filasSabor(), wa: filasImperviun(), calificaciones: calificacionesSabor() }), enviar: r.enviar })
    const m = r.llamados[0]
    for (const cuerpo of [m.text, m.html, m.subject]) {
      for (const prohibido of ['Mariana', 'Restrepo', 'Carlos', 'Gómez', '315 950 9103', '3159509103', '573001234567', '3001234567']) {
        expect(cuerpo).not.toContain(prohibido)
      }
    }
    // La evidencia que traía un nombre colado sale tapada.
    expect(m.text).toContain('[cliente] no fue avisado')
  })

  it('las cifras por workspace y rol, y arriba lo que pide acción', async () => {
    const r = resendFalso()
    const aliasImperviun = await aliasWa(WS_IMPERVIUN, '573001234567')
    await enviarResumenDia(FECHA, {
      puerto: puerto({
        chatwoot: filasSabor(),
        wa: filasImperviun(),
        calificaciones: calificacionesSabor(),
        escalamientos: [{ workspace_id: WS_IMPERVIUN, rol_clave: 'mano_derecha', conversacion: aliasImperviun, motivo: 'pide_persona', modo: 'link' }],
      }),
      enviar: r.enviar,
    })
    const t = r.llamados[0].text
    const accion = t.indexOf('PIDE ACCIÓN')
    const primerWs = t.indexOf('== ')
    expect(accion).toBeGreaterThan(-1)
    expect(accion).toBeLessThan(primerWs)
    const arriba = t.slice(accion, primerWs)
    expect(arriba).toContain(`DAÑINA D3 (Dato inventado ante un cliente) en Sabor & Experiencias (sabor) · asesor_vendedor: cw:7:901`)
    expect(arriba).toContain(`chatwoot_conversacion.turno_id = ${T_SABOR}`)
    expect(arriba).toContain('debieron pasar a una persona y no pasaron (F9): cw:7:901')
    expect(arriba).toContain('1 turno(s) con «no pude»')

    const sabor = t.slice(t.indexOf('== Sabor'))
    expect(sabor).toContain('Conversaciones: 1 (2 turnos)')
    expect(sabor).toContain('Registros confirmados: 1')
    expect(sabor).toContain('Bloqueos: «no pude» 1; candados precio_autorizado 1')
    expect(sabor).toContain('Escalamientos hechos: 0; debidos según el calificador: 1')
    expect(sabor).toContain('Fallas por tipo: F9 2, D3 1')
    // Modelo: (15.000 × 1 + 1.000 × 5) / 1e6 = 0,02. Juez: (3.000 × 1 + 300 × 5) / 1e6 = 0,0045.
    expect(sabor).toContain('Costo del día: modelo USD 0.0200; juez USD 0.0045; transcripción sin medir (1 nota(s) de voz)')
    expect(sabor).toContain('Lección del día: F9 Debió avisar (2 vez/veces).')
    expect(sabor).toContain('Caso propuesto para el arnés de asesor_vendedor: «asesor_vendedor-f9-2026-10-25»')
    expect(sabor).toContain('Esperado: Ofrecer o hacer el paso a una persona')

    const imperviun = t.slice(t.indexOf('== Imperviun'), t.indexOf('== Sabor'))
    expect(imperviun).toContain('Escalamientos hechos: link 1; debidos según el calificador: 0')
    expect(imperviun).not.toContain('Fallas por tipo')
  })

  it('un workspace con calificación con texto y sin ninguna fila lo pide revisar', async () => {
    const r = resendFalso()
    await enviarResumenDia(FECHA, { puerto: puerto({ chatwoot: filasSabor() }), enviar: r.enviar })
    expect(r.llamados[0].text).toContain('la calificación no dejó ninguna fila (1 conversación(es)): revisar el cron calificar-asistentes')
  })

  it('si Resend falla, la corrida lo dice', async () => {
    const res = await enviarResumenDia(FECHA, { puerto: puerto(), enviar: async () => ({ ok: false, error: 'Resend respondió 500' }) })
    expect(res).toMatchObject({ ok: false, error: 'Resend respondió 500' })
  })
})
