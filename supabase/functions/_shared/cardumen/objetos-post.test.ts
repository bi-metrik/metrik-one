/**
 * La via BUENA de regreso del modo `objetos`: el POST de la pagina continua la entrevista, y
 * la contencion que eso obliga en un endpoint PUBLICO Y SIN AUTENTICACION.
 *
 * Lo que se protege aqui:
 *   1. las CUATRO invariantes de seguridad de `objetos-post.ts`. Hasta este cambio un POST
 *      falso escribia una fila de basura; ahora haria que el bot MANDE UN MENSAJE DE WHATSAPP,
 *      o sea que la ingesta se vuelve un vector de envio no autorizado si alguna de estas
 *      cede. Cada una tiene su prueba y su mutacion corrida;
 *   2. la idempotencia entre las DOS vias de regreso, en LOS DOS ORDENES (POST→texto y
 *      texto→POST): ni un paso de mas, ni una fila de mas;
 *   3. que el avance por POST sea el MISMO que el del texto — misma aritmetica, mismos `bot`
 *      del guion, mismo cierre. Si se separaran en dos copias, una se quedaria atras.
 *
 * Datos sinteticos: ningun telefono ni texto sale de produccion.
 *
 * VISTO FALLAR (mutaciones, todas corridas una por una, restaurando entre cada una):
 *   - tomando el destino de `payload.participante` (que la pagina SI pone en el cuerpo) en vez
 *     de `fila.phone` cae `el destino sale de la SESION, no de lo que diga el cuerpo`. Es la
 *     mutacion realista de I2. ⚠️ La otra —mandar a `llave`, el token ya normalizado— NO la
 *     ve ninguna prueba, y no es un hueco del arnes: el lookup de la sesion es por igualdad
 *     exacta contra `phone`, asi que `llave` y `fila.phone` son el MISMO valor siempre. Esa
 *     igualdad es justamente la razon estructural por la que el cuerpo no puede nombrar un
 *     destinatario, y se deja dicha aqui en vez de fingir una mutacion que no existe;
 *   - quitando el `.eq('closed', false)` del lookup de la sesion cae `una sesion CERRADA no
 *     se revive`;
 *   - quitando el `esEstadoObjetos(fila.state)` cae `una sesion de chat (Navigate) no la
 *     continua un POST`;
 *   - quitando la comparacion `entrada.estudio !== estado.study_id` cae `un POST de OTRO
 *     estudio no mueve esta sesion`;
 *   - quitando el `pendiente.id !== entrada.objeto` cae `un objeto que NO es el pendiente no
 *     envia nada`, y con el la contencion que impide repetir un POST para mandar N mensajes;
 *   - quitando el chequeo de `estado.recibidos` cae `un link viejo reenviado no reenvia nada`;
 *   - dejando pasar el tope (`if (false) return {tipo:'tope'}`) o no guardando la sesion en
 *     esa rama cae `el conteo se guarda aunque el envio quede bloqueado`; arrancando el
 *     conteo de una ventana nueva en 0 en vez de 1 caen tres casos del tope;
 *   - quitando el `por_post` de `avanceDesdePaso` caen cuatro casos (entre ellos `POST y
 *     despues el texto`); quitando la rama `ya_atendido` de `decidirObjetos` caen dos;
 *   - volviendo a desduplicar por el id de sesion del payload (la llave vieja) cae `texto y
 *     despues el POST: UNA sola fila, y se queda el vector medido`.
 *
 * LO QUE NINGUNA PRUEBA DE AQUI PUEDE VER, y por eso queda escrito: que el handler de
 * `cardumen-ingesta` no delate en su respuesta si hubo continuacion y por que. Ese handler es
 * un `Deno.serve` y desde node no se colecta; se revisa leyendo `cardumen-ingesta/index.ts`,
 * que responde `{ ok, id, duplicado }` y manda el motivo solo al log.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Envios por WhatsApp ─────────────────────────────────────────────────────
// `objetos-flujo.ts` importa `wa-respond.ts` y `wa-transcribe.ts`, que tocan `Deno`. Se
// reemplazan los dos: lo que importa de un envio aqui es A QUIEN va y que dice.

type Envio = { tipo: 'texto' | 'cta' | 'botones' | 'lista'; phone: string; texto: string; url?: string }
const envios: Envio[] = []

vi.mock('../wa-respond.ts', () => ({
  sendTextMessage: vi.fn(async (phone: string, texto: string) => { envios.push({ tipo: 'texto', phone, texto }) }),
  sendCtaUrl: vi.fn(async (phone: string, texto: string, _cta: string, url: string) => {
    envios.push({ tipo: 'cta', phone, texto, url })
  }),
  sendButtons: vi.fn(async (phone: string, texto: string) => { envios.push({ tipo: 'botones', phone, texto }) }),
  sendNumberedMenu: vi.fn(async (phone: string, texto: string) => { envios.push({ tipo: 'lista', phone, texto }) }),
}))
vi.mock('../wa-transcribe.ts', () => ({ transcribeAudio: vi.fn(async () => ({ text: '' })) }))

import {
  MODO_OBJETO_SUELTO,
  TOPE_ENVIOS_POST,
  VENTANA_ENVIOS_POST_MS,
  contarEnvioPorPost,
  decidirContinuacionPost,
  leerEnvioDeObjeto,
  llaveDelPasoSuelto,
  telefonoDeToken,
} from './objetos-post'
import {
  ORIGEN_TEXTO,
  avanceDesdePaso,
  decidirObjetos,
  estadoInicialObjetos,
  leerSpecObjetos,
  type EstadoObjetos,
  type PasoReparto,
  type SpecObjetos,
} from './objetos'
import {
  continuarObjetosPorPost,
  continueObjetos,
  guardarPasoSueltoYContinuar,
} from './objetos-flujo'

// ---------------------------------------------------------------------------------------
// Guion de prueba: la forma del de adultos (dos `bot`, un relato, DOS repartos seguidos y un
// `bot` en medio), que es donde el avance se puede desincronizar.
// ---------------------------------------------------------------------------------------

const ESTUDIO = 'objetos-prueba'
const TEL = '570000000001'
const OTRO_TEL = '570000000002'

const BOT_REGLA = 'Cada uno reparte un total fijo: si subes uno, los demás ceden.'
const BOT_MARCO = 'Ahora salgamos de esa historia y hablemos de tu semana.'

const SPEC_CRUDO = {
  base_url: 'https://ejemplo.invalid/adultos',
  encuadre: 'Son unas preguntas cortas.',
  cierre: 'Eso era todo. Gracias.',
  pasos: [
    { tipo: 'relato', id: 'historia', pregunta: '¿Qué pasó?' },
    { tipo: 'bot', texto: BOT_REGLA },
    { tipo: 'reparto', id: 'quien_decidio', titulo: '¿Quién decidió?', opciones: 3 },
    { tipo: 'reparto', id: 'sentia_vs_esperaban', titulo: 'Lo que sentía', opciones: 3 },
    { tipo: 'bot', texto: BOT_MARCO },
    { tipo: 'reparto', id: 'semana', titulo: 'Tu semana', opciones: 3 },
  ],
}

const SPEC = leerSpecObjetos(SPEC_CRUDO) as SpecObjetos
const QUIEN = SPEC.pasos.find((p) => p.id === 'quien_decidio') as PasoReparto

/** Estado parado justo en `quien_decidio` (ya contesto `historia`). */
function enQuienDecidio(extra: Partial<EstadoObjetos> = {}): EstadoObjetos {
  return { ...estadoInicialObjetos(ESTUDIO), paso: 2, recibidos: ['historia'], ...extra }
}

/** El payload que manda la pagina en el modo objeto suelto (forma real de adultos.html). */
function payloadDePagina(objeto: string, vector = [0.6, 0.2, 0.2]) {
  return {
    sesion_id: `uuid-${Math.random().toString(36).slice(2)}`,
    instrumento: 'adultos',
    version: '2026-10-01',
    modo: MODO_OBJETO_SUELTO,
    objeto,
    participante: TEL,
    generado_en: new Date().toISOString(),
    respuesta: { id: objeto, tipo: 'auto_significacion', vector },
  }
}

// ---------------------------------------------------------------------------------------
// Base en memoria: aplica los filtros que usan los modulos (incluido `payload->>objeto`).
// ---------------------------------------------------------------------------------------

type Fila = Record<string, unknown>

function baseFalsa(opts: { sesiones?: Fila[]; respuestas?: Fila[]; estudios?: Fila[] } = {}) {
  const t = {
    cardumen_chat_sessions: opts.sesiones ?? [],
    cardumen_respuestas: opts.respuestas ?? [],
    cardumen_estudios: opts.estudios ?? [
      { estudio: ESTUDIO, nombre: 'Prueba', modo: 'objetos', spec: SPEC_CRUDO, url: null, activo: true },
    ],
  } as Record<string, Fila[]>
  let seq = 0

  const cliente = {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      const fuente = () => t[tabla] ?? []
      const match = () => fuente().filter((f) => filtros.every((p) => p(f)))
      const q = {
        select() { return q },
        eq(col: string, val: unknown) {
          if (col === 'payload->>objeto') filtros.push((f) => (f.payload as Fila | undefined)?.objeto === val)
          else filtros.push((f) => f[col] === val)
          return q
        },
        // `.limit(1)` es esperable Y encadenable con `.maybeSingle()`, igual que en PostgREST.
        limit() {
          const p = Promise.resolve({ data: match(), error: null }) as Promise<unknown> & { maybeSingle?: unknown }
          p.maybeSingle = () => Promise.resolve({ data: match()[0] ?? null, error: null })
          return p
        },
        maybeSingle() { return Promise.resolve({ data: match()[0] ?? null, error: null }) },
        insert(fila: Fila) {
          const creada = { id: `r${++seq}`, ...fila }
          t[tabla].push(creada)
          const r = {
            select() { return r },
            maybeSingle() { return Promise.resolve({ data: { id: creada.id }, error: null }) },
            then(res: (v: unknown) => unknown) { return Promise.resolve({ data: null, error: null }).then(res) },
          }
          return r
        },
        update(cambios: Fila) {
          const u = {
            eq(col: string, val: unknown) {
              for (const f of fuente()) if (f[col] === val) Object.assign(f, cambios)
              return Promise.resolve({ data: null, error: null })
            },
          }
          return u
        },
        upsert(fila: Fila) {
          const i = fuente().findIndex((f) => f.phone === fila.phone)
          if (i >= 0) t[tabla][i] = { ...t[tabla][i], ...fila }
          else t[tabla].push({ ...fila })
          return Promise.resolve({ data: null, error: null })
        },
      }
      return q
    },
  }
  return { cliente, t }
}

/** La sesion como la guarda el bot. `closed` por defecto en false: entrevista viva. */
const sesion = (estado: EstadoObjetos, phone = TEL, closed = false) => ({ phone, state: estado, closed })

const cuerpoPost = (objeto: string, token: string | null = TEL, estudio = ESTUDIO) => ({
  estudio,
  token,
  lang: 'es' as string | null,
  payload: payloadDePagina(objeto) as Record<string, unknown>,
})

beforeEach(() => { envios.length = 0 })

// =========================================================================================
// Lectura del envio
// =========================================================================================

describe('leerEnvioDeObjeto', () => {
  it('reconoce el envio de UN paso suelto y normaliza el id', () => {
    expect(leerEnvioDeObjeto({ modo: MODO_OBJETO_SUELTO, objeto: 'Quien Decidió' })).toEqual({ objeto: 'quien_decidio' })
  })

  it('un envio del instrumento COMPLETO no toca este camino', () => {
    // La fila del instrumento completo es la que esta en evaluacion con la metodologa: si
    // entrara aqui, un envio suyo intentaria continuar una entrevista que no existe.
    expect(leerEnvioDeObjeto({ respuestas: [{ id: 'historia' }] })).toBe(null)
    expect(leerEnvioDeObjeto({ modo: 'completo', objeto: 'quien_decidio' })).toBe(null)
    expect(leerEnvioDeObjeto({ modo: MODO_OBJETO_SUELTO })).toBe(null)
    expect(leerEnvioDeObjeto({ modo: MODO_OBJETO_SUELTO, objeto: '   ' })).toBe(null)
    expect(leerEnvioDeObjeto({ modo: MODO_OBJETO_SUELTO, objeto: 42 })).toBe(null)
  })
})

describe('telefonoDeToken', () => {
  it('tolera el + que se gana o se pierde al viajar por la query', () => {
    expect(telefonoDeToken('+573159999999')).toBe('573159999999')
    expect(telefonoDeToken(' 573159999999 ')).toBe('573159999999')
  })

  it('no toca un token que no es un telefono (un BSUID de WhatsApp)', () => {
    // Si se le quitaran los no-digitos, el identificador se destruiria y la sesion no
    // resolveria nunca.
    expect(telefonoDeToken('CO.1234abcd')).toBe('CO.1234abcd')
    expect(telefonoDeToken(null)).toBe(null)
    expect(telefonoDeToken('  ')).toBe(null)
  })
})

describe('llaveDelPasoSuelto', () => {
  it('la llave es (estudio, token, objeto), no el id de sesion del payload', () => {
    expect(llaveDelPasoSuelto({ estudio: ESTUDIO, token: TEL, payload: payloadDePagina('semana') }))
      .toEqual({ estudio: ESTUDIO, token: TEL, objeto: 'semana' })
  })

  it('sin token no hay llave: una pagina abierta sin ?p= no se atribuye a nadie', () => {
    expect(llaveDelPasoSuelto({ estudio: ESTUDIO, token: null, payload: payloadDePagina('semana') })).toBe(null)
    expect(llaveDelPasoSuelto({ estudio: ESTUDIO, token: '  ', payload: payloadDePagina('semana') })).toBe(null)
  })
})

// =========================================================================================
// I1 y I2 — lo que impide que la ingesta sea un relay de WhatsApp
// =========================================================================================

describe('contencion del endpoint publico', () => {
  it('⚠️ el destino sale de la SESION, no de lo que diga el cuerpo', async () => {
    // ESTA ES LA INVARIANTE QUE CIERRA EL AGUJERO, y el cuerpo trae MAS de un candidato a
    // destinatario: ademas del `token`, la pagina pone `payload.participante` (y podria poner
    // lo que quisiera). Aqui los dos apuntan a telefonos DISTINTOS y los dos tienen sesion
    // abierta, para que la prueba no se pueda pasar por casualidad: el token es TEL y
    // `participante` es OTRO_TEL. El mensaje tiene que salirle a TEL y a nadie mas.
    const { cliente } = baseFalsa({ sesiones: [sesion(enQuienDecidio()), sesion(enQuienDecidio(), OTRO_TEL)] })
    const cuerpo = cuerpoPost('quien_decidio')
    cuerpo.payload = { ...cuerpo.payload, participante: OTRO_TEL }
    const r = await continuarObjetosPorPost(cliente, cuerpo)
    expect(r).toBe('avanzo')
    expect(envios.map((e) => e.phone)).toEqual([TEL])
  })

  it('el token tolera el + que se gana o se pierde al viajar, y el destino sigue siendo el de la fila', async () => {
    const { cliente } = baseFalsa({ sesiones: [sesion(enQuienDecidio())] })
    expect(await continuarObjetosPorPost(cliente, cuerpoPost('quien_decidio', `+${TEL}`))).toBe('avanzo')
    expect(envios.map((e) => e.phone)).toEqual([TEL])
  })

  it('un telefono SIN sesion abierta no recibe nada (y el POST no revienta)', async () => {
    const { cliente } = baseFalsa({ sesiones: [] })
    expect(await continuarObjetosPorPost(cliente, cuerpoPost('quien_decidio', OTRO_TEL))).toBe('sin_sesion_abierta')
    expect(envios).toHaveLength(0)
  })

  it('una sesion CERRADA no se revive', async () => {
    // El cron cierra las entrevistas abandonadas de mas de 24h. Si un POST las reviviera,
    // cualquier link viejo volveria a hacer hablar al bot meses despues.
    const { cliente } = baseFalsa({ sesiones: [sesion(enQuienDecidio(), TEL, true)] })
    expect(await continuarObjetosPorPost(cliente, cuerpoPost('quien_decidio'))).toBe('sin_sesion_abierta')
    expect(envios).toHaveLength(0)
  })

  it('una sesion de chat (Navigate) no la continua un POST', async () => {
    // Misma tabla que la demo viva de Grupo Progreso. Sin el filtro por `state.modo`, un POST
    // le escribiria a alguien que esta en medio de OTRA conversacion.
    const { cliente } = baseFalsa({ sesiones: [{ phone: TEL, state: { study_id: 'navigate', step: 3 }, closed: false }] })
    expect(await continuarObjetosPorPost(cliente, cuerpoPost('quien_decidio'))).toBe('sin_sesion_abierta')
    expect(envios).toHaveLength(0)
  })

  it('sin token no se busca sesion ninguna', async () => {
    const { cliente } = baseFalsa({ sesiones: [sesion(enQuienDecidio())] })
    expect(await continuarObjetosPorPost(cliente, cuerpoPost('quien_decidio', null))).toBe('sin_token')
    expect(envios).toHaveLength(0)
  })
})

// =========================================================================================
// I3 — el objeto tiene que ser el paso pendiente de ESA sesion
// =========================================================================================

describe('decidirContinuacionPost', () => {
  const ahora = new Date('2026-10-07T12:00:00Z')

  it('el paso pendiente avanza y arrastra los `bot` que vengan detras', () => {
    const d = decidirContinuacionPost(SPEC, enQuienDecidio(), { estudio: ESTUDIO, objeto: 'quien_decidio', ahora })
    expect(d.tipo).toBe('avanza')
    if (d.tipo !== 'avanza') return
    expect(d.siguiente.id).toBe('sentia_vs_esperaban')
    expect(d.estado.recibidos).toContain('quien_decidio')
    expect(d.estado.por_post).toEqual(['quien_decidio'])
  })

  it('⚠️ un objeto que NO es el pendiente no envia nada', () => {
    // Sin esto, un POST valido se podria repetir con otro id y cada repeticion seria un
    // mensaje: la contencion de I3 es lo que lo vuelve "una vez por paso" y nada mas.
    const d = decidirContinuacionPost(SPEC, enQuienDecidio(), { estudio: ESTUDIO, objeto: 'semana', ahora })
    expect(d.tipo).toBe('no_corresponde')
    if (d.tipo !== 'no_corresponde') return
    expect(d.motivo).toBe('no_es_el_pendiente')
    expect(d.pendiente.id).toBe('quien_decidio')
  })

  it('⚠️ un POST de OTRO estudio no mueve esta sesion', () => {
    const d = decidirContinuacionPost(SPEC, enQuienDecidio(), { estudio: 'otro-estudio', objeto: 'quien_decidio', ahora })
    expect(d.tipo).toBe('no_corresponde')
    if (d.tipo !== 'no_corresponde') return
    expect(d.motivo).toBe('otro_estudio')
  })

  it('un link viejo reenviado no reenvia nada: la secuencia no retrocede ni repite', () => {
    const estado = enQuienDecidio({ paso: 3, recibidos: ['historia', 'quien_decidio'] })
    const d = decidirContinuacionPost(SPEC, estado, { estudio: ESTUDIO, objeto: 'quien_decidio', ahora })
    expect(d.tipo).toBe('no_corresponde')
    if (d.tipo !== 'no_corresponde') return
    expect(d.motivo).toBe('ya_recibido')
  })

  it('el ultimo paso cierra, y los `bot` que queden salen antes del cierre', () => {
    const estado = enQuienDecidio({ paso: 5, recibidos: ['historia', 'quien_decidio', 'sentia_vs_esperaban'] })
    const d = decidirContinuacionPost(SPEC, estado, { estudio: ESTUDIO, objeto: 'semana', ahora })
    expect(d.tipo).toBe('cierra')
  })

  it('una secuencia agotada no envia nada', () => {
    const estado = enQuienDecidio({ paso: 99 })
    expect(decidirContinuacionPost(SPEC, estado, { estudio: ESTUDIO, objeto: 'semana', ahora }).tipo).toBe('sin_paso')
  })

  it('el avance por POST es EL MISMO que el del texto (una sola aritmetica)', () => {
    // Si se separaran en dos copias, una se quedaria atras — y el sintoma seria un `bot` del
    // guion perdido, que es error de medicion, no estetica.
    const estado = enQuienDecidio()
    const porPost = decidirContinuacionPost(SPEC, estado, { estudio: ESTUDIO, objeto: 'quien_decidio', ahora })
    const porTexto = decidirObjetos(SPEC, estado, { texto: 'Listo quien_decidio 60-20-20' })
    expect(porPost.tipo).toBe('avanza')
    expect(porTexto?.tipo).toBe('avanza')
    if (porPost.tipo !== 'avanza' || porTexto?.tipo !== 'avanza') return
    expect(porPost.siguiente.id).toBe(porTexto.siguiente.id)
    expect(porPost.textos).toEqual(porTexto.textos)
    expect(porPost.estado.paso).toBe(porTexto.estado.paso)
  })

  it('el `bot` del cambio de marco viaja con el avance por POST', () => {
    // Es la frase sin la cual `semana` mide la situacion puntual y no la semana.
    const estado = enQuienDecidio({ paso: 3, recibidos: ['historia', 'quien_decidio'] })
    const d = decidirContinuacionPost(SPEC, estado, { estudio: ESTUDIO, objeto: 'sentia_vs_esperaban', ahora })
    expect(d.tipo).toBe('avanza')
    if (d.tipo !== 'avanza') return
    expect(d.textos).toEqual([BOT_MARCO])
  })
})

// =========================================================================================
// I4 — tope por telefono y ventana
// =========================================================================================

describe('tope de envios por POST', () => {
  const t0 = new Date('2026-10-07T12:00:00Z')

  it('el primer envio abre la ventana', () => {
    const c = contarEnvioPorPost(estadoInicialObjetos(ESTUDIO), t0)
    expect(c).toEqual({ permitido: true, envios: 1, ventana: t0.toISOString() })
  })

  it(`permite ${TOPE_ENVIOS_POST} en la ventana y bloquea el siguiente`, () => {
    // El guion mas largo tiene CUATRO repartos: una entrevista honesta nunca llega al tope.
    const base = { ...estadoInicialObjetos(ESTUDIO), post_ventana: t0.toISOString() }
    const ultimo = contarEnvioPorPost({ ...base, post_envios: TOPE_ENVIOS_POST - 1 }, t0)
    expect(ultimo.permitido).toBe(true)
    const pasado = contarEnvioPorPost({ ...base, post_envios: TOPE_ENVIOS_POST }, t0)
    expect(pasado.permitido).toBe(false)
    // Satura: si creciera sin limite, el estado guardaria un numero cada vez mas grande.
    expect(pasado.envios).toBe(TOPE_ENVIOS_POST + 1)
  })

  it('pasada la ventana se abre una nueva y el conteo vuelve a uno', () => {
    const viejo = { ...estadoInicialObjetos(ESTUDIO), post_envios: 99, post_ventana: t0.toISOString() }
    const despues = new Date(t0.getTime() + VENTANA_ENVIOS_POST_MS + 1)
    expect(contarEnvioPorPost(viejo, despues)).toEqual({ permitido: true, envios: 1, ventana: despues.toISOString() })
  })

  it('una ventana con basura, o en el futuro, no desarma el tope', () => {
    const t = (post_ventana: string) => contarEnvioPorPost({ ...estadoInicialObjetos(ESTUDIO), post_envios: 99, post_ventana }, t0)
    expect(t('no es una fecha').permitido).toBe(true)   // ventana nueva, conteo en 1
    expect(t('no es una fecha').envios).toBe(1)
    // Una ventana con fecha futura (reloj movido, estado tocado a mano) tampoco deja pasar 99.
    expect(t(new Date(t0.getTime() + 60_000).toISOString()).envios).toBe(1)
  })

  it('⚠️ el conteo se guarda aunque el envio quede bloqueado', async () => {
    // Si no se guardara, cada intento rechazado reabriria la ventana y el tope seria
    // decorativo: bastaria insistir.
    const estado = enQuienDecidio({ post_envios: TOPE_ENVIOS_POST, post_ventana: new Date().toISOString() })
    const { cliente, t } = baseFalsa({ sesiones: [sesion(estado)] })
    expect(await continuarObjetosPorPost(cliente, cuerpoPost('quien_decidio'))).toBe('tope')
    expect(envios).toHaveLength(0)
    const guardada = t.cardumen_chat_sessions[0].state as EstadoObjetos
    expect(guardada.post_envios).toBe(TOPE_ENVIOS_POST + 1)
    // Y el paso NO avanzo: un envio bloqueado no consume el reparto.
    expect(guardada.recibidos).not.toContain('quien_decidio')
  })
})

// =========================================================================================
// Las dos vias de regreso, en LOS DOS ORDENES
// =========================================================================================

describe('idempotencia entre el POST y el texto de emergencia', () => {
  it('POST y despues el texto: no avanza dos pasos ni deja dos filas', async () => {
    const { cliente, t } = baseFalsa({ sesiones: [sesion(enQuienDecidio())] })

    // 1. Llega el POST (la via buena): se guarda el vector medido y el bot manda el que sigue.
    const r = await guardarPasoSueltoYContinuar(cliente, cuerpoPost('quien_decidio'), {
      estudio: ESTUDIO, token: TEL, objeto: 'quien_decidio',
    })
    expect(r?.continuacion).toBe('avanzo')
    expect(envios).toHaveLength(1)
    const trasPost = t.cardumen_chat_sessions[0].state as EstadoObjetos
    expect(trasPost.paso).toBe(3)

    // 2. La persona toca igual el enlace de emergencia y el texto llega despues.
    envios.length = 0
    await continueObjetos(cliente, TEL, trasPost, { texto: 'Listo quien_decidio 60-20-20' })

    // Silencio: el bot ya dijo lo que tenia que decir.
    expect(envios).toHaveLength(0)
    // Una sola fila, y es la del POST (sin la marca del texto).
    expect(t.cardumen_respuestas).toHaveLength(1)
    expect((t.cardumen_respuestas[0].payload as Fila).origen).not.toBe(ORIGEN_TEXTO)
    // Y la sesion sigue en el mismo paso: no se salto `sentia_vs_esperaban`.
    expect((t.cardumen_chat_sessions[0].state as EstadoObjetos).paso).toBe(3)
  })

  it('texto y despues el POST: UNA sola fila, y se queda el vector medido', async () => {
    const { cliente, t } = baseFalsa({ sesiones: [sesion(enQuienDecidio())] })

    // 1. El POST no sale (sin red) y la persona vuelve por el enlace de emergencia.
    await continueObjetos(cliente, TEL, enQuienDecidio(), { texto: 'Listo quien_decidio 60-20-20' })
    expect(envios).toHaveLength(1)
    expect(t.cardumen_respuestas).toHaveLength(1)
    expect((t.cardumen_respuestas[0].payload as Fila).origen).toBe(ORIGEN_TEXTO)

    // 2. El POST llega tarde (reintento, red que vuelve).
    envios.length = 0
    const r = await guardarPasoSueltoYContinuar(cliente, cuerpoPost('quien_decidio'), {
      estudio: ESTUDIO, token: TEL, objeto: 'quien_decidio',
    })

    // No manda nada (el texto ya avanzo) y NO deja una segunda fila del mismo reparto.
    expect(r?.duplicado).toBe(true)
    expect(r?.continuacion).toBe('no_corresponde')
    expect(envios).toHaveLength(0)
    expect(t.cardumen_respuestas).toHaveLength(1)
    // La fila quedo con el payload MEDIDO: el aproximado del texto no se queda con el lugar.
    const payload = t.cardumen_respuestas[0].payload as Fila
    expect(payload.origen).toBeUndefined()
    expect((payload.respuesta as Fila).vector).toEqual([0.6, 0.2, 0.2])
  })

  it('el texto de un paso que el POST ya atendio no se guarda ni se contesta', () => {
    const estado = enQuienDecidio({ paso: 3, recibidos: ['historia', 'quien_decidio'], por_post: ['quien_decidio'] })
    const d = decidirObjetos(SPEC, estado, { texto: 'Listo quien_decidio 60-20-20' })
    expect(d?.tipo).toBe('ya_atendido')
  })

  it('sin la marca del POST, el mismo texto SI acusa (el camino de emergencia sigue vivo)', () => {
    // El contraste es lo que prueba que `ya_atendido` no esta tapando el comportamiento viejo:
    // un link viejo reabierto, sin POST de por medio, sigue acusando y reenviando el pendiente.
    const estado = enQuienDecidio({ paso: 3, recibidos: ['historia', 'quien_decidio'] })
    const d = decidirObjetos(SPEC, estado, { texto: 'Listo quien_decidio 60-20-20' })
    expect(d?.tipo).toBe('fuera_de_secuencia')
  })

  it('el POST marca `por_post` y el texto NO', () => {
    expect(avanceDesdePaso(SPEC, enQuienDecidio(), QUIEN, true).estado.por_post).toEqual(['quien_decidio'])
    expect(avanceDesdePaso(SPEC, enQuienDecidio(), QUIEN).estado.por_post).toEqual([])
  })
})

// =========================================================================================
// La secuencia entera por la via nueva
// =========================================================================================

describe('la entrevista completa, continuada por el POST', () => {
  it('tres repartos seguidos llegan al cierre sin perder ningun `bot`', async () => {
    const { cliente, t } = baseFalsa({ sesiones: [sesion(enQuienDecidio())] })
    const dichos: string[] = []

    for (const objeto of ['quien_decidio', 'sentia_vs_esperaban', 'semana']) {
      const estado = t.cardumen_chat_sessions[0].state as EstadoObjetos
      expect(estado, objeto).toBeTruthy()
      const r = await guardarPasoSueltoYContinuar(cliente, cuerpoPost(objeto), {
        estudio: ESTUDIO, token: TEL, objeto,
      })
      expect(r?.continuacion, objeto).toBe(objeto === 'semana' ? 'cerro' : 'avanzo')
      for (const e of envios) dichos.push(e.texto)
      envios.length = 0
    }

    // El `bot` del cambio de marco salio, una sola vez, antes de `semana`.
    expect(dichos.filter((d) => d.includes(BOT_MARCO))).toHaveLength(1)
    // Y la sesion quedo cerrada, con los tres repartos recibidos.
    expect(t.cardumen_chat_sessions[0].closed).toBe(true)
    const final = t.cardumen_chat_sessions[0].state as EstadoObjetos
    expect(final.por_post).toEqual(['quien_decidio', 'sentia_vs_esperaban', 'semana'])
    expect(t.cardumen_respuestas).toHaveLength(3)
  })
})
