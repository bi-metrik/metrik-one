import { describe, expect, it, vi } from 'vitest'
import { CONFIG_POR_DEFECTO } from './config'
import { aliasConversacionWa, alertarSiCaido, alertarSinBanco, caidaDelTurno, clavesCaida, correoCaida, correoSinBanco, motivoCorto } from './caida'
import type { PuertosCaida } from './caida'
import { TEL_PRUEBA, WS_PRUEBA, escenario } from './escenario'
import { modeloGemini } from './modelo-gemini'
import { escenarioPublico, WS_PUBLICO } from './publico/escenario'
import { llaveTexto } from './publico/tipos'
import { enviarCorreoInterno } from '../correo-interno'
import type { CorreoInterno, ResultadoCorreo } from '../correo-interno'
import type { Modelo, Traza, UsoLlamado } from './tipos'

// El correo inmediato si se caen los modelos (spec 2026-10-26 asistentes-roles-y-funciones, §4.1). Sin red: los
// modelos y Resend son falsos, los candados viven en el almacén de memoria con el reloj de la prueba. Datos inventados.

const uso = (modelo: string, ok: boolean, motivo?: string): UsoLlamado => ({ modelo, entrada: 0, salida: 0, razonamiento: 0, cache: 0, ms: 5, ok, ...(motivo ? { motivo } : {}) })
const principal = CONFIG_POR_DEFECTO.principal
const respaldo = CONFIG_POR_DEFECTO.respaldo!
const http = (status: number, cuerpo = '{"error":"x"}') => async () => new Response(cuerpo, { status })
const deGemini = (texto: string) => async () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ functionCall: { name: 'responder', args: { texto } } }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
}), { status: 200 })

/** Resend falso: guarda lo enviado; `fallar` hace que responda 500 (o que lance). */
function resend(o: { fallar?: number | 'lanza' } = {}) {
  const enviados: CorreoInterno[] = []
  let fallas = o.fallar === 'lanza' ? Infinity : (o.fallar ?? 0)
  const enviar = vi.fn(async (m: CorreoInterno): Promise<ResultadoCorreo> => {
    if (fallas > 0) {
      fallas--
      if (o.fallar === 'lanza') throw new Error('Resend no contesta')
      return { ok: false, error: 'Resend respondió 500', status: 500 }
    }
    enviados.push(m)
    return { ok: true }
  })
  return { enviados, enviar }
}

/** El escenario de WhatsApp (la bandeja) con el correo de caída conectado como en `wa-agente.ts`. */
async function waConCorreo(modelo: Modelo, r = resend()) {
  const e = await escenario({ modelo })
  const puertos: PuertosCaida = {
    tomarCandado: (k, s) => e.almacen.tomarCandado(k, s),
    soltarCandado: (k) => e.almacen.soltarCandado(k),
    sinRespuesta: async () => 1,
    enviarCorreo: r.enviar,
  }
  const resultados: string[] = []
  e.deps.despuesDelTurno = async (traza, turno) => {
    resultados.push(await alertarSiCaido(puertos, traza, {
      workspaceId: WS_PRUEBA, workspaceNombre: 'trappvel-prueba', canal: 'bandeja',
      conversacion: await aliasConversacionWa(WS_PRUEBA, TEL_PRUEBA), turnoId: turno.turnoId, ahoraMs: e.reloj.ahora(),
    }))
  }
  return { e, r, resultados }
}

const cae = (principalStatus: number, respaldoStatus: number | null) => modeloGemini({
  llave: 'k', principal, respaldo: respaldoStatus === null ? null : respaldo, corteMs: 5_000, haiku: false,
  fetch: http(principalStatus), ...(respaldoStatus === null ? {} : { fetchRespaldo: http(respaldoStatus) }),
})

describe('caidaDelTurno: ¿fallaron todos los modelos configurados?', () => {
  it('principal y respaldo caídos: los dos con su motivo, sin el cuerpo del proveedor', () => {
    const t: Pick<Traza, 'error' | 'uso'> = { error: 'modelo: http 529; respaldo: http 403', uso: [uso('claude-haiku-5-5', false, 'http 529: {"overloaded"}'), uso('gemini-3.5-flash-lite', false, 'http 403: PERMISSION_DENIED')] }
    expect(caidaDelTurno(t)).toEqual([{ modelo: 'claude-haiku-5-5', motivo: 'http 529' }, { modelo: 'gemini-3.5-flash-lite', motivo: 'http 403' }])
  })
  it('solo cuenta el llamado que falló: lo de un llamado anterior que contestó no entra', () => {
    const t = { error: 'modelo: corte; respaldo: http 500', uso: [uso('a', true), uso('b', false, 'cancelado: respondió el principal'), uso('a', false, 'corte'), uso('b', false, 'http 500: x')] }
    expect(caidaDelTurno(t)).toEqual([{ modelo: 'a', motivo: 'corte' }, { modelo: 'b', motivo: 'http 500' }])
  })
  it('un rechazo o una respuesta sin llamada NO es caída: el modelo contestó', () => {
    expect(caidaDelTurno({ error: 'modelo: refusal', uso: [uso('h', false, 'refusal')] })).toBeNull()
    // El público le pega lo que falló al pasar a persona.
    expect(caidaDelTurno({ error: 'modelo: refusal; nota: 500', uso: [uso('h', false, 'refusal')] })).toBeNull()
    expect(caidaDelTurno({ error: 'modelo: sin llamada (SAFETY); respaldo: http 403', uso: [uso('h', false, 'sin llamada (SAFETY)'), uso('g', false, 'http 403')] })).toBeNull()
  })
  it('el público: falla del único modelo, y el corte total sin ningún intento terminado', () => {
    expect(caidaDelTurno({ error: 'falla: http 529; nota: x', uso: [uso('claude-haiku-5-5', false, 'http 529: x')] })).toEqual([{ modelo: 'claude-haiku-5-5', motivo: 'http 529' }])
    expect(caidaDelTurno({ error: 'falla: corte_total', uso: [] })?.[0].motivo).toMatch(/corte total/)
  })
  it('otros finales no son caída: el tope de tiempo con el modelo contestando, un turno sin error', () => {
    expect(caidaDelTurno({ error: 'tope de tiempo del turno', uso: [uso('a', true)] })).toBeNull()
    expect(caidaDelTurno({ error: 'falla: tope de tiempo del turno', uso: [uso('a', true)] })).toBeNull()
    expect(caidaDelTurno({ error: null, uso: [uso('a', false, 'http 529'), uso('b', true)] })).toBeNull()
    expect(caidaDelTurno(null)).toBeNull()
  })
  it('motivoCorto deja el código', () => {
    expect(motivoCorto('http 403: {"error":{"message":"API key not valid"}}')).toBe('http 403')
    expect(motivoCorto(undefined)).toBe('sin motivo')
  })
})

describe('correo de caída en WhatsApp (núcleo + cola)', () => {
  it('principal 529 y respaldo 403: un correo con los dos motivos, y la persona recibe el «no pude»', async () => {
    const { e, r } = await waConCorreo(cae(529, 403))
    const salidas = await e.escribe('cotízame Cartagena para 4')
    expect(salidas.at(-1)?.texto).toMatch(/No pude revisarlo ahora/)
    expect(r.enviados).toHaveLength(1)
    const c = r.enviados[0]
    expect(c.to).toBe('mauricio.moreno@metrik.com.co')
    expect(c.subject).toBe('Asistente caído: trappvel-prueba · bandeja-solicitudes')
    expect(c.text).toContain(`${principal.modelo}: http 529`)
    expect(c.text).toContain(`${respaldo.modelo}: http 403`)
    expect(c.text).toMatch(/Hora \(Bogotá\): \d{4}-\d\d-\d\d \d\d:\d\d/)
    expect(c.text).toContain('Conversaciones sin respuesta del modelo en la última hora: 1.')
    const turno = e.trazas().at(-1)
    expect(c.text).toMatch(/turno [0-9a-f-]{36}/)
    expect(e.almacen.filas.some((f) => f.turno_id && c.text.includes(f.turno_id))).toBe(true)
    expect(turno?.error).toMatch(/^modelo:/)
    expect(c.idempotencyKey).toMatch(new RegExp(`^agente-caido/${WS_PRUEBA}/\\d+$`))
  })

  it('diez turnos caídos en 30 minutos: un solo correo', async () => {
    const { e, r, resultados } = await waConCorreo(cae(529, 403))
    for (let i = 0; i < 10; i++) await e.escribe(`mensaje ${i}`, { despuesMs: 150_000 })
    expect(resultados.filter((x) => x === 'sin_caida')).toHaveLength(0)
    expect(r.enviados).toHaveLength(1)
  })

  it('si sigue caído: un recordatorio por hora; tras volver, un incidente nuevo avisa ya', async () => {
    const { e, r, resultados } = await waConCorreo(cae(529, 403))
    // 2 h 10 min de caída, un turno cada 10 minutos.
    for (let i = 0; i < 14; i++) await e.escribe(`m ${i}`, { despuesMs: 10 * 60_000 })
    expect(resultados.filter((x) => x === 'enviado')).toHaveLength(1)
    expect(resultados.filter((x) => x === 'recordatorio')).toHaveLength(2)
    expect(r.enviados.slice(1).every((c) => c.text.startsWith('SIGUE CAÍDO'))).toBe(true)
    // Dos horas sin caídas (vuelve) y cae otra vez: correo nuevo de inmediato.
    e.reloj.avanzar(2 * 3600_000)
    await e.escribe('otra vez')
    expect(resultados.at(-1)).toBe('enviado')
    expect(r.enviados.at(-1)?.text.startsWith('El asistente se quedó sin modelo')).toBe(true)
  })

  it('principal cae y respaldo contesta: ningún correo', async () => {
    const m = modeloGemini({ llave: 'k', principal, respaldo, corteMs: 5_000, haiku: false, fetch: http(529), fetchRespaldo: deGemini('Listo, ya lo reviso.') })
    const { e, r, resultados } = await waConCorreo(m)
    await e.escribe('hola')
    expect(e.trazas().at(-1)?.uso?.some((u) => u.ok)).toBe(true)
    expect(resultados).toEqual(['sin_caida'])
    expect(r.enviados).toHaveLength(0)
  })

  it('sin llave de respaldo y el principal caído: correo con el único modelo', async () => {
    const { e, r } = await waConCorreo(cae(503, null))
    await e.escribe('hola')
    expect(r.enviados).toHaveLength(1)
    expect(r.enviados[0].text).toContain(`${principal.modelo}: http 503`)
    expect(r.enviados[0].text).not.toContain(respaldo.modelo)
  })

  it('Resend falla (500 o lanza): el turno no se cae y el próximo turno caído lo intenta otra vez', async () => {
    for (const fallar of [1, 'lanza'] as const) {
      const { e, r, resultados } = await waConCorreo(cae(529, 403), resend({ fallar }))
      const salidas = await e.escribe('hola')
      expect(salidas.at(-1)?.texto).toMatch(/No pude revisarlo ahora/)
      expect(resultados[0]).toBe('fallo_envio')
      expect(e.almacen.filas.filter((f) => f.turno_id).length).toBeGreaterThan(0)
      await e.escribe('¿hola?', { despuesMs: 60_000 })
      if (fallar === 1) {
        expect(resultados[1]).toBe('enviado')
        expect(r.enviados).toHaveLength(1)
      } else {
        expect(resultados[1]).toBe('fallo_envio')
      }
    }
  })

  it('el cuerpo nunca trae el texto del cliente ni el teléfono', async () => {
    const { e, r } = await waConCorreo(cae(529, 403))
    await e.reenvia('Hola, soy Marta Ruiz, mi celular es 3115550199 y mi cédula 52123456')
    await e.escribe('cárgale el viaje a Marta Ruiz, celular 3115550199')
    expect(r.enviados).toHaveLength(1)
    const todo = JSON.stringify(r.enviados[0])
    for (const x of ['Marta', 'Ruiz', '3115550199', '52123456', TEL_PRUEBA, 'cárgale']) expect(todo).not.toContain(x)
    expect(r.enviados[0].text).toMatch(/conversación wa-[0-9a-f]{10}/)
  })
})

describe('correo de caída en Chatwoot (Sabor, sin modelo de respaldo)', () => {
  const unico = (r: { ok: false; motivo: string } | 'refusal'): Modelo => ({
    llamar: async () => {
      const motivo = r === 'refusal' ? 'refusal' : r.motivo
      return { ok: false, motivo, usos: [uso('claude-haiku-5-5', false, r === 'refusal' ? 'refusal' : `${motivo}: {"type":"overloaded_error"}`)] }
    },
  })
  async function chatwootConCorreo(modelo: Modelo) {
    const e = await escenarioPublico({ modelo })
    const r = resend()
    const resultados: string[] = []
    e.deps.alertaCaida = async (traza, turnoId) => {
      resultados.push(await alertarSiCaido({
        tomarCandado: (k, s) => e.almacen.tomarCandado(k, s), soltarCandado: (k) => e.almacen.soltarCandado(k), enviarCorreo: r.enviar,
      }, traza, { workspaceId: WS_PUBLICO, workspaceNombre: 'sabor-prueba', canal: 'chatwoot', conversacion: `cw:${llaveTexto(e.llave)}`, turnoId, ahoraMs: e.reloj.ahora() }))
    }
    return { e, r, resultados }
  }

  it('el único modelo cae: correo, y la conversación pasa a una persona como hoy', async () => {
    const { e, r } = await chatwootConCorreo(unico({ ok: false, motivo: 'http 529' }))
    await e.escribe('Hola, soy Ana Gómez (3009998877), ¿tienen cupo el viernes?')
    const conv = llaveTexto(e.llave)
    expect(e.chatwoot.notas.some((n) => n.conv === conv && /motivo: falla/.test(n.texto))).toBe(true)
    expect(e.chatwoot.estados.get(conv)).toBe('open')
    expect(r.enviados).toHaveLength(1)
    const c = r.enviados[0]
    expect(c.subject).toBe('Asistente caído: sabor-prueba · asistente-publico')
    expect(c.text).toContain('claude-haiku-5-5: http 529')
    expect(c.text).toContain('pasó a una persona en Chatwoot')
    expect(c.text).toContain(`conversación cw:${conv}`)
    expect(c.text).toContain('chatwoot_conversacion')
    const todo = JSON.stringify(c)
    for (const x of ['Ana', 'Gómez', '3009998877', 'viernes']) expect(todo).not.toContain(x)
  })

  it('un rechazo pasa a persona pero no manda correo (el modelo contestó)', async () => {
    const { e, r, resultados } = await chatwootConCorreo(unico('refusal'))
    await e.escribe('hola')
    expect(e.chatwoot.estados.get(llaveTexto(e.llave))).toBe('open')
    expect(resultados).toEqual(['sin_caida'])
    expect(r.enviados).toHaveLength(0)
  })

  it('si el correo lanza, el turno igual se cierra y pasa a persona', async () => {
    const e = await escenarioPublico({ modelo: unico({ ok: false, motivo: 'http 529' }) })
    e.deps.alertaCaida = async () => { throw new Error('se cayó el gancho') }
    await e.escribe('hola')
    expect(e.chatwoot.estados.get(llaveTexto(e.llave))).toBe('open')
    expect(e.almacen.filas.every((f) => f.direccion !== 'entrante' || f.turno_id)).toBe(true)
  })
})

describe('las piezas', () => {
  it('las claves del candado: una por ventana de 30 minutos', () => {
    const t = Date.parse('2026-10-29T15:10:00Z')
    expect(clavesCaida('ws', t).actual).toBe(clavesCaida('ws', t + 19 * 60_000).actual)
    expect(clavesCaida('ws', t).actual).not.toBe(clavesCaida('ws', t + 21 * 60_000).actual)
    expect(clavesCaida('ws', t).actual).toMatch(/^agente:caido:ws:\d+$/)
  })

  it('el asunto lleva el rol cuando la traza lo trae (spec §2.9)', async () => {
    const d = { workspaceId: 'w', workspaceNombre: 'imperviun', canal: 'one' as const, conversacion: 'wa-x', turnoId: 't', ahoraMs: Date.parse('2026-10-29T15:10:00Z') }
    const r = resend()
    await alertarSiCaido({ tomarCandado: async () => true, enviarCorreo: r.enviar }, {
      bot: 'one', rol: { clave: 'operario_obra' }, error: 'modelo: http 529', uso: [uso('a', false, 'http 529')],
    } as Traza, d)
    expect(r.enviados[0].subject).toBe('Asistente caído: imperviun · operario_obra')
    expect(correoCaida({ datos: d, asistente: 'one', modelos: [], sinRespuesta: null, recordatorio: false }).text).toContain('Hora (Bogotá): 2026-10-29 10:10')
  })

  it('el alias de WhatsApp es estable y no deja ver el teléfono', async () => {
    const a = await aliasConversacionWa('ws', '+57 311 555 0199')
    expect(a).toBe(await aliasConversacionWa('ws', '573115550199'))
    expect(a).not.toContain('0199')
  })

  it('enviarCorreoInterno: remitente, destino, llave de idempotencia; nunca lanza', async () => {
    const pedidos: Array<{ url: string; init: RequestInit }> = []
    const f = (async (url: string, init: RequestInit) => { pedidos.push({ url, init }); return new Response('{"id":"x"}', { status: 200 }) }) as unknown as typeof fetch
    const m = { to: 'mauricio.moreno@metrik.com.co', subject: 's', text: 't', html: '<p>t</p>', idempotencyKey: 'k-1' }
    expect(await enviarCorreoInterno(m, { llave: 're_x', fetch: f })).toEqual({ ok: true })
    expect(pedidos[0].url).toBe('https://api.resend.com/emails')
    expect((pedidos[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('k-1')
    expect(JSON.parse(String(pedidos[0].init.body))).toMatchObject({ from: 'MéTRIK ONE <noreply@metrikone.co>', to: ['mauricio.moreno@metrik.com.co'] })
    const f500 = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    expect(await enviarCorreoInterno(m, { llave: 're_x', fetch: f500 })).toMatchObject({ ok: false, status: 500 })
    const lanza = (async () => { throw new Error('red') }) as unknown as typeof fetch
    expect(await enviarCorreoInterno(m, { llave: 're_x', fetch: lanza })).toEqual({ ok: false, error: 'red' })
    expect(await enviarCorreoInterno(m, { llave: '' })).toEqual({ ok: false, error: 'sin RESEND_API_KEY' })
  })

  it('un 409 de Resend (la llave ya se usó) cuenta como enviado: no se reintenta', async () => {
    const tomados = new Set<string>()
    const p: PuertosCaida = {
      tomarCandado: async (k) => (tomados.has(k) ? false : (tomados.add(k), true)),
      soltarCandado: async (k) => { tomados.delete(k) },
      enviarCorreo: async () => ({ ok: false, error: 'Resend respondió 409', status: 409 }),
    }
    const d = { workspaceId: 'w', workspaceNombre: 'w', canal: 'one' as const, conversacion: 'wa-x', turnoId: 't', ahoraMs: Date.parse('2026-10-29T15:10:00Z') }
    const t = { bot: 'one', error: 'modelo: http 529', uso: [uso('a', false, 'http 529')] } as Traza
    expect(await alertarSiCaido(p, t, d)).toBe('enviado')
    expect(await alertarSiCaido(p, t, d)).toBe('ya_avisado')
  })
})

describe('versión sin banco (encargo 2026-10-30)', () => {
  const datos = { workspaceId: 'ws-1', workspaceNombre: 'dimpro', canal: 'chatwoot' as const, conversacion: 'cw:1:2', turnoId: null, ahoraMs: Date.UTC(2026, 9, 30, 19) }
  const puertos = () => {
    const tomadas = new Set<string>()
    const enviados: Array<{ subject: string; idempotencyKey?: string }> = []
    const p: PuertosCaida = {
      tomarCandado: async (k) => (tomadas.has(k) ? false : (tomadas.add(k), true)),
      soltarCandado: async (k) => { tomadas.delete(k) },
      enviarCorreo: async (c) => { enviados.push(c); return { ok: true as const } },
    }
    return { p, enviados, tomadas }
  }

  it('un correo por workspace al día, con su llave de idempotencia', async () => {
    const { p, enviados } = puertos()
    expect(await alertarSinBanco(p, datos)).toBe('enviado')
    expect(await alertarSinBanco(p, { ...datos, conversacion: 'cw:1:3' })).toBe('ya_avisado')
    expect(await alertarSinBanco(p, { ...datos, ahoraMs: datos.ahoraMs + 24 * 3600 * 1000 })).toBe('enviado')
    expect(enviados.map((e) => e.subject)).toEqual(['Asistente sin banco: dimpro', 'Asistente sin banco: dimpro'])
    expect(enviados[0].idempotencyKey).toMatch(/^agente-sin-banco\/ws-1\/\d+$/)
  })

  it('si el envío falla suelta el candado para que el próximo turno lo intente', async () => {
    const { p, tomadas } = puertos()
    p.enviarCorreo = async () => ({ ok: false as const, error: 'caído', status: 500 })
    expect(await alertarSinBanco(p, datos)).toBe('fallo_envio')
    expect(tomadas.size).toBe(0)
  })

  it('el correo dice qué pasa y cómo se arregla, sin teléfono', () => {
    const c = correoSinBanco({ datos })
    expect(c.text).toContain('version_sin_banco')
    expect(c.text).toContain('--k 3')
    expect(c.text).toContain('cw:1:2')
  })
})
