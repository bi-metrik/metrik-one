/**
 * Modo `objetos` de Cardumen: lectura del spec, parseo del texto de vuelta y avance de la
 * secuencia.
 *
 * Lo que se protege aqui son tres cosas que se rompen en silencio:
 *   1. que el texto que escribe la persona en WhatsApp se entienda aunque venga torcido (el
 *      prellenado de `wa.me` es EDITABLE y el teclado del celular corrige solo);
 *   2. que la sesion de objetos NO la atienda el motor de chat — misma tabla que la demo viva
 *      de Grupo Progreso, y la palabra de consentimiento del chat es justamente "LISTO";
 *   3. que un reintento no duplique ni salte un paso, y que un link viejo no retroceda la
 *      secuencia.
 *
 * VISTO FALLAR (mutaciones):
 *   - quitando el `(?<![a-z0-9])` del regex de numeros cae `id con digito al final`;
 *   - `una sola cifra no es un reparto` cae al quitar LOS DOS frenos a la vez (el `+` final
 *     del regex de numeros y el `porcentajes.length < 2`): cada uno tapa al otro, y por eso
 *     mutar solo uno no la hace fallar — verificado;
 *   - quitando el chequeo de `objeto.opciones` cae `numeros de mas o de menos`;
 *   - quitando el tope de 100, el freno de suma cero, el rechazo de id duplicado en el spec
 *     o el saneado del paso (`pasoSano`), cae su caso respectivo;
 *   - devolviendo `estado` sin tocar en `fuera_de_secuencia` (o avanzando el paso) cae
 *     `un link viejo registra pero NO retrocede`;
 *   - quitando el `s.modo === MODO_OBJETOS` de `esEstadoObjetos` cae `una sesion de chat o de
 *     Navigate NO es de objetos`, y con el la proteccion de la demo viva;
 *   - quitando el `if (data.modo !== MODO_OBJETOS)` de `cargarEstudioObjetos` cae `una fila de
 *     chat o de miniweb no la atiende el bloque de objetos`.
 */
import { describe, expect, it } from 'vitest'
import {
  MODO_OBJETOS,
  ORIGEN_TEXTO,
  cargarEstudioObjetos,
  decidirObjetos,
  esEstadoObjetos,
  estadoInicialObjetos,
  guardarVectorDeTexto,
  hayRegistroDelObjeto,
  leerSpecObjetos,
  normalizarIdObjeto,
  objetoPendiente,
  parsearListo,
  resolverEstudioObjetosPorTrigger,
  urlDelObjeto,
  vectorDePorcentajes,
  type EstadoObjetos,
  type SpecObjetos,
} from './objetos'

// ---------------------------------------------------------------------------------------
// Datos: la secuencia REAL del instrumento de adultos (ids leidos del HTML en produccion).
// ---------------------------------------------------------------------------------------

const SPEC_CRUDO = {
  base_url: 'https://reframeit.metrik.com.co/adultos',
  encuadre: 'Toca el botón.',
  cierre: 'Listo, eso era todo.',
  objetos: [
    { id: 'quien_decidio', titulo: 'Las tres fuerzas', opciones: 3 },
    { id: 'sentia_vs_esperaban', titulo: 'La balanza', opciones: 2 },
    { id: 'semana', titulo: 'Tu semana en diez fichas', opciones: 5 },
    { id: 'preocupaciones', titulo: 'Lo que te quita el sueño', opciones: 8 },
  ],
}

const spec = leerSpecObjetos(SPEC_CRUDO) as SpecObjetos
const ESTUDIO = 'cardumen-objetos-adultos'

const estadoEn = (paso: number, recibidos: string[] = []): EstadoObjetos => ({
  modo: MODO_OBJETOS,
  study_id: ESTUDIO,
  paso,
  recibidos,
})

// ---------------------------------------------------------------------------------------
// leerSpecObjetos
// ---------------------------------------------------------------------------------------

describe('leerSpecObjetos', () => {
  it('lee la secuencia completa, en orden', () => {
    expect(spec.base_url).toBe(SPEC_CRUDO.base_url)
    expect(spec.objetos.map((o) => o.id)).toEqual([
      'quien_decidio', 'sentia_vs_esperaban', 'semana', 'preocupaciones',
    ])
    expect(spec.objetos.map((o) => o.opciones)).toEqual([3, 2, 5, 8])
  })

  it('toma la base_url de la columna `url` de la fila si el spec no la trae', () => {
    const s = leerSpecObjetos({ objetos: [{ id: 'a' }] }, 'https://x.co/ninos')
    expect(s?.base_url).toBe('https://x.co/ninos')
  })

  it('devuelve null (no lanza) ante cualquier spec inutilizable', () => {
    // El llamador es el webhook: un throw aqui tumbaria el turno completo de la persona.
    for (const malo of [
      null, undefined, 'x', 3, [SPEC_CRUDO],
      { objetos: [{ id: 'a' }] },                                  // sin base_url
      { base_url: 'ftp://x.co', objetos: [{ id: 'a' }] },          // esquema que Meta rechaza
      { base_url: 'https://x.co', objetos: [] },                   // secuencia vacia
      { base_url: 'https://x.co', objetos: 'a' },
      { base_url: 'https://x.co', objetos: [{ id: '' }] },
      { base_url: 'https://x.co', objetos: [{ id: '---' }] },      // normaliza a vacio
      { base_url: 'https://x.co', objetos: [{ id: 'a' }, { id: 'A' }] }, // id repetido
    ]) {
      expect(leerSpecObjetos(malo), JSON.stringify(malo)).toBe(null)
    }
  })

  it('un `opciones` fuera de rango queda en null: se deja de verificar, no se inventa', () => {
    const s = leerSpecObjetos({ base_url: 'https://x.co', objetos: [{ id: 'a', opciones: 1 }, { id: 'b', opciones: 99 }, { id: 'c', opciones: 2.5 }] })
    expect(s?.objetos.map((o) => o.opciones)).toEqual([null, null, null])
  })
})

describe('normalizarIdObjeto', () => {
  it('iguala tildes, mayusculas, espacios y guiones al id del guion', () => {
    for (const texto of ['quien_decidio', 'QUIEN DECIDIO', 'quién decidió', ' Quien-Decidio ', 'quien   decidio']) {
      expect(normalizarIdObjeto(texto), texto).toBe('quien_decidio')
    }
  })
})

// ---------------------------------------------------------------------------------------
// parsearListo — la parte que de verdad recibe texto escrito a mano
// ---------------------------------------------------------------------------------------

describe('parsearListo', () => {
  it('lee el texto tal como lo prellena la pagina', () => {
    expect(parsearListo('Listo preocupaciones 50-30-20')).toEqual({
      objeto: 'preocupaciones', porcentajes: [50, 30, 20],
    })
  })

  it('aguanta todas las formas torcidas que puede producir un celular', () => {
    const casos: Array<[string, number[]]> = [
      ['listo preocupaciones 50-30-20', [50, 30, 20]],
      ['LISTO PREOCUPACIONES 50-30-20', [50, 30, 20]],
      ['Listó preocupaciones 50-30-20', [50, 30, 20]],          // tilde del corrector
      ['  Listo   preocupaciones   50 - 30 - 20  ', [50, 30, 20]],
      ['Listo preocupaciones 50/30/20', [50, 30, 20]],          // separador /
      ['Listo preocupaciones 50,30,20', [50, 30, 20]],          // separador ,
      ['Listo preocupaciones 50 30 20', [50, 30, 20]],          // separador espacio
      ['Listo preocupaciones 50-30-20 gracias', [50, 30, 20]],  // texto pegado despues
      ['ya quedo, listo preocupaciones 50-30-20', [50, 30, 20]],// texto pegado antes
    ]
    for (const [texto, esperado] of casos) {
      expect(parsearListo(texto), texto).toEqual({ objeto: 'preocupaciones', porcentajes: esperado })
    }
  })

  it('el objeto con espacio en vez de guion bajo resuelve al mismo id', () => {
    expect(parsearListo('Listo sentia vs esperaban 70-30')?.objeto).toBe('sentia_vs_esperaban')
    expect(parsearListo('Listo sentía vs esperaban 70-30')?.objeto).toBe('sentia_vs_esperaban')
  })

  it('id con digito al final: el digito no arranca la corrida de numeros', () => {
    // `amigos2` es un id real de opcion del instrumento de ninos. Sin el lookbehind, el "2"
    // abriria la corrida y el objeto quedaria en `amigos`.
    expect(parsearListo('Listo amigos2 50-50')).toEqual({ objeto: 'amigos2', porcentajes: [50, 50] })
  })

  it('devuelve null y no adivina cuando el mensaje no es un reparto', () => {
    for (const texto of [
      '', '   ', 'hola', 'gracias',
      'Listo',                                 // sin numeros
      'Listo preocupaciones',                  // idem
      'preocupaciones 50-30-20',               // sin la palabra
      'Listo 50-30-20',                        // sin objeto
      'alistando 50-30-20',                    // `listo` dentro de otra palabra
      'Listo preocupaciones 50',               // una sola cifra no es un reparto
      'Listo preocupaciones 120-30',           // porcentaje imposible
      'Listo preocupaciones 0-0-0',            // suma cero: no hay reparto
    ]) {
      expect(parsearListo(texto), texto).toBe(null)
    }
  })

  it('una sola cifra no es un reparto, aunque venga pegada a texto', () => {
    expect(parsearListo('listo semana 10')).toBe(null)
  })
})

describe('vectorDePorcentajes', () => {
  it('normaliza a suma 1', () => {
    expect(vectorDePorcentajes([50, 30, 20])).toEqual([0.5, 0.3, 0.2])
  })
  it('un reparto que no suma 100 igual se normaliza (la pagina redondea)', () => {
    const v = vectorDePorcentajes([33, 33, 33])
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })
})

// ---------------------------------------------------------------------------------------
// Estado y marca que protege la demo viva
// ---------------------------------------------------------------------------------------

describe('esEstadoObjetos', () => {
  it('reconoce la sesion de objetos', () => {
    expect(esEstadoObjetos(estadoInicialObjetos(ESTUDIO))).toBe(true)
  })

  it('una sesion de chat o de Navigate NO es de objetos', () => {
    // Esto es lo que mantiene el texto "Listo ..." fuera del entrevistador de chat.
    for (const state of [
      null, undefined, 'x', [],
      { study_id: 'navigate', motor: 'navigate', paso: 'triada_1' },   // Navigate
      { study_id: 'araucania-turismo', history: [] },                  // chat R1/R2
      { modo: 'objetos' },                                             // sin study_id
      { modo: 'miniweb', study_id: ESTUDIO },
    ]) {
      expect(esEstadoObjetos(state), JSON.stringify(state)).toBe(false)
    }
  })
})

describe('objetoPendiente', () => {
  it('es el objeto del paso en que va, y null cuando ya se repartieron todos', () => {
    expect(objetoPendiente(spec, estadoEn(0))?.id).toBe('quien_decidio')
    expect(objetoPendiente(spec, estadoEn(3))?.id).toBe('preocupaciones')
    expect(objetoPendiente(spec, estadoEn(4))).toBe(null)
  })
})

// ---------------------------------------------------------------------------------------
// decidirObjetos — el avance de la secuencia
// ---------------------------------------------------------------------------------------

describe('decidirObjetos', () => {
  it('el objeto esperado avanza un paso y deja el siguiente listo', () => {
    const d = decidirObjetos(spec, estadoEn(0), 'Listo quien_decidio 60-20-20')
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.siguiente.id).toBe('sentia_vs_esperaban')
    expect(d.estado.paso).toBe(1)
    expect(d.estado.recibidos).toEqual(['quien_decidio'])
  })

  it('lo que no se entiende NO es error tecnico: se reenvia el paso pendiente', () => {
    const d = decidirObjetos(spec, estadoEn(2), 'gracias!')
    expect(d).toEqual({ tipo: 'no_entendido', pendiente: spec.objetos[2] })
  })

  it('un objeto que no esta en la secuencia se trata como no entendido', () => {
    const d = decidirObjetos(spec, estadoEn(0), 'Listo historia 50-50')
    expect(d?.tipo).toBe('no_entendido')
  })

  it('numeros de mas o de menos: no se registra un vector de largo equivocado', () => {
    // `quien_decidio` tiene 3 opciones. Un mensaje mutilado trae 2.
    expect(decidirObjetos(spec, estadoEn(0), 'Listo quien_decidio 60-40')?.tipo).toBe('no_entendido')
    expect(decidirObjetos(spec, estadoEn(0), 'Listo quien_decidio 25-25-25-25')?.tipo).toBe('no_entendido')
  })

  it('reintento del mismo objeto: registra, NO avanza dos pasos', () => {
    const primera = decidirObjetos(spec, estadoEn(0), 'Listo quien_decidio 60-20-20')
    expect(primera?.tipo).toBe('avanza')
    if (primera?.tipo !== 'avanza') return

    // La persona vuelve a mandar el mismo mensaje (reenvio, o toco dos veces el enlace).
    const segunda = decidirObjetos(spec, primera.estado, 'Listo quien_decidio 60-20-20')
    expect(segunda?.tipo).toBe('fuera_de_secuencia')
    if (segunda?.tipo !== 'fuera_de_secuencia') return
    expect(segunda.repetido).toBe(true)
    expect(segunda.pendiente.id).toBe('sentia_vs_esperaban')
  })

  it('un link viejo registra pero NO retrocede la secuencia', () => {
    // Va en el paso 3 (`semana`) y le llega el reparto del paso 1, reabierto desde el chat.
    const estado = estadoEn(2, ['quien_decidio', 'sentia_vs_esperaban'])
    const d = decidirObjetos(spec, estado, 'Listo quien_decidio 10-10-80')
    expect(d?.tipo).toBe('fuera_de_secuencia')
    if (d?.tipo !== 'fuera_de_secuencia') return
    expect(d.objeto.id).toBe('quien_decidio')          // el registro vale
    expect(d.reparto.porcentajes).toEqual([10, 10, 80])
    expect(d.pendiente.id).toBe('semana')              // y la secuencia se queda donde iba
  })

  it('un objeto posterior adelantado tambien registra sin mover el pendiente', () => {
    const d = decidirObjetos(spec, estadoEn(0), 'Listo semana 2-2-2-2-2')
    expect(d?.tipo).toBe('fuera_de_secuencia')
    if (d?.tipo !== 'fuera_de_secuencia') return
    expect(d.repetido).toBe(false)
    expect(d.pendiente.id).toBe('quien_decidio')
  })

  it('el ultimo objeto cierra la secuencia', () => {
    const d = decidirObjetos(spec, estadoEn(3, ['quien_decidio', 'sentia_vs_esperaban', 'semana']), 'Listo preocupaciones 20-20-20-10-10-10-5-5')
    expect(d?.tipo).toBe('cierra')
    if (d?.tipo !== 'cierra') return
    expect(d.estado.paso).toBe(4)
    expect(d.estado.recibidos).toHaveLength(4)
    expect(objetoPendiente(spec, d.estado)).toBe(null)
  })

  it('la secuencia completa se recorre de punta a punta', () => {
    let estado = estadoInicialObjetos(ESTUDIO)
    const textos = [
      'Listo quien_decidio 60-20-20',
      'Listo sentia vs esperaban 70-30',
      'Listo semana 4/2/1/2/1',
      'Listo preocupaciones 20-20-20-10-10-10-5-5',
    ]
    for (let i = 0; i < textos.length; i++) {
      const d = decidirObjetos(spec, estado, textos[i])
      expect(d?.tipo, textos[i]).toBe(i === textos.length - 1 ? 'cierra' : 'avanza')
      if (d?.tipo === 'avanza' || d?.tipo === 'cierra') estado = d.estado
    }
    expect(estado.recibidos).toEqual(['quien_decidio', 'sentia_vs_esperaban', 'semana', 'preocupaciones'])
  })

  it('secuencia agotada con la sesion abierta: null (el flujo la cierra)', () => {
    expect(decidirObjetos(spec, estadoEn(4), 'Listo semana 2-2-2-2-2')).toBe(null)
  })

  it('un paso corrupto en el estado se trata como el primero, no revienta', () => {
    const d = decidirObjetos(spec, { ...estadoEn(0), paso: -3 }, 'Listo quien_decidio 60-20-20')
    expect(d?.tipo).toBe('avanza')
  })
})

// ---------------------------------------------------------------------------------------
// urlDelObjeto
// ---------------------------------------------------------------------------------------

describe('urlDelObjeto', () => {
  it('lleva obj, e, p y wa', () => {
    expect(urlDelObjeto('https://reframeit.metrik.com.co/adultos', ESTUDIO, 'preocupaciones', '573159509103'))
      .toBe('https://reframeit.metrik.com.co/adultos?obj=preocupaciones&e=cardumen-objetos-adultos&p=573159509103&wa=573159509103')
  })

  it('`e` va explicito: sin el, el POST de la pagina cae bajo el slug del instrumento completo', () => {
    expect(urlDelObjeto('https://x.co/adultos', ESTUDIO, 'semana', '57315')).toContain(`&e=${ESTUDIO}&`)
  })

  it('respeta la query que ya traiga la base_url', () => {
    expect(urlDelObjeto('https://x.co/adultos?v=2', ESTUDIO, 'semana', '57315'))
      .toBe('https://x.co/adultos?v=2&obj=semana&e=cardumen-objetos-adultos&p=57315&wa=57315')
  })

  it('escapa el telefono: un + sin escapar se lee como espacio del otro lado', () => {
    expect(urlDelObjeto('https://x.co/a', ESTUDIO, 'semana', '+57 315')).toContain('p=%2B57%20315&wa=%2B57%20315')
  })
})

// ---------------------------------------------------------------------------------------
// Catalogo y sesion (cliente falso, mismo patron que miniweb.test.ts)
// ---------------------------------------------------------------------------------------

type Fila = Record<string, unknown>

function clienteFalso(opts: {
  triggers?: Fila[]
  estudios?: Fila[]
  sesiones?: Fila[]
  respuestas?: Fila[]
  errorTrigger?: string
  errorRespuestas?: string
  insertados?: Fila[]
}) {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      const fuente = () => {
        if (tabla === 'cardumen_estudio_triggers') return opts.triggers ?? []
        if (tabla === 'cardumen_estudios') return opts.estudios ?? []
        if (tabla === 'cardumen_chat_sessions') return opts.sesiones ?? []
        return opts.respuestas ?? []
      }
      const q = {
        select() { return q },
        eq(col: string, val: unknown) {
          // `payload->>objeto` es la ruta con la que PostgREST filtra dentro del jsonb.
          if (col === 'payload->>objeto') {
            filtros.push((f) => (f.payload as Fila | undefined)?.objeto === val)
          } else {
            filtros.push((f) => f[col] === val)
          }
          return q
        },
        limit() {
          if (tabla === 'cardumen_respuestas' && opts.errorRespuestas) {
            return Promise.resolve({ data: null, error: { message: opts.errorRespuestas } })
          }
          return Promise.resolve({ data: fuente().filter((f) => filtros.every((p) => p(f))), error: null })
        },
        maybeSingle() {
          if (tabla === 'cardumen_estudio_triggers' && opts.errorTrigger) {
            return Promise.resolve({ data: null, error: { message: opts.errorTrigger } })
          }
          return Promise.resolve({ data: fuente().find((f) => filtros.every((p) => p(f))) ?? null, error: null })
        },
        insert(fila: Fila) {
          opts.insertados?.push(fila)
          return Promise.resolve({ data: null, error: null })
        },
      }
      return q
    },
  }
}

const FILA_ADULTOS = {
  estudio: ESTUDIO,
  nombre: 'Cardumen — repartos sueltos, adultos (piloto WhatsApp)',
  modo: MODO_OBJETOS,
  spec: SPEC_CRUDO,
  url: null,
  activo: true,
}

const catalogo = (estudios: Fila[] = [FILA_ADULTOS], extra: Partial<Parameters<typeof clienteFalso>[0]> = {}) =>
  clienteFalso({
    triggers: [
      { palabra: 'objetos adultos', estudio: ESTUDIO },
      { palabra: 'objetosadultos', estudio: ESTUDIO },
      // Las palabras vivas: `cardumen` es la demo de chat y `cardumen adultos` el
      // instrumento completo en modo miniweb. Ninguna la puede atender este bloque.
      { palabra: 'cardumen', estudio: 'navigate' },
      { palabra: 'cardumen adultos', estudio: 'cardumen-instrumento-adultos' },
    ],
    estudios: [
      ...estudios,
      { estudio: 'navigate', nombre: 'Navigate', modo: 'chat', spec: SPEC_CRUDO, url: null, activo: true },
      // La fila de miniweb lleva spec A PROPOSITO (en produccion es null): asi lo unico que
      // la mantiene fuera de este bloque es el `modo`.
      { estudio: 'cardumen-instrumento-adultos', nombre: 'Instrumento completo', modo: 'miniweb', spec: SPEC_CRUDO, url: 'https://reframeit.metrik.com.co/adultos', activo: true },
    ],
    ...extra,
  })

describe('resolverEstudioObjetosPorTrigger', () => {
  it('resuelve el estudio por su palabra y lee la secuencia', async () => {
    const r = await resolverEstudioObjetosPorTrigger(catalogo(), 'objetos adultos')
    expect(r?.estudio).toBe(ESTUDIO)
    expect(r?.spec.objetos).toHaveLength(4)
  })

  it('normaliza como el chat: mayusculas, espacios y puntuacion', async () => {
    for (const texto of ['  Objetos Adultos ', 'OBJETOS ADULTOS!', 'objetos adultos.']) {
      expect((await resolverEstudioObjetosPorTrigger(catalogo(), texto))?.estudio, texto).toBe(ESTUDIO)
    }
  })

  it('una fila de chat o de miniweb no la atiende el bloque de objetos', async () => {
    // Si esto deja de dar null, la demo viva de Grupo Progreso (`cardumen`) y el instrumento
    // completo que esta en evaluacion (`cardumen adultos`) cambian de conducta.
    expect(await resolverEstudioObjetosPorTrigger(catalogo(), 'cardumen')).toBe(null)
    expect(await resolverEstudioObjetosPorTrigger(catalogo(), 'cardumen adultos')).toBe(null)
  })

  it('palabra sin trigger, texto vacio, fila ausente o estudio apagado: null', async () => {
    expect(await resolverEstudioObjetosPorTrigger(catalogo(), 'hola')).toBe(null)
    expect(await resolverEstudioObjetosPorTrigger(catalogo(), '  ')).toBe(null)
    expect(await resolverEstudioObjetosPorTrigger(catalogo([]), 'objetos adultos')).toBe(null)
    expect(await resolverEstudioObjetosPorTrigger(catalogo([{ ...FILA_ADULTOS, activo: false }]), 'objetos adultos')).toBe(null)
  })

  it('fila con spec inutilizable: null en vez de reventar el turno del webhook', async () => {
    expect(await resolverEstudioObjetosPorTrigger(catalogo([{ ...FILA_ADULTOS, spec: null }]), 'objetos adultos')).toBe(null)
  })

  it('un error de la consulta de triggers no tumba el webhook', async () => {
    const c = clienteFalso({ errorTrigger: '42703 column does not exist' })
    expect(await resolverEstudioObjetosPorTrigger(c, 'objetos adultos')).toBe(null)
  })
})

describe('cargarEstudioObjetos', () => {
  it('acepta la fila sembrada con base_url en el spec y url null', async () => {
    const r = await cargarEstudioObjetos(catalogo(), ESTUDIO)
    expect(r?.spec.base_url).toBe('https://reframeit.metrik.com.co/adultos')
  })
})

describe('hayRegistroDelObjeto', () => {
  const medido = { estudio: ESTUDIO, token: '57315', payload: { objeto: 'quien_decidio' } }

  it('ve la fila que dejo el POST de la pagina (ese es el vector autoritativo)', async () => {
    const c = clienteFalso({ respuestas: [medido] })
    expect(await hayRegistroDelObjeto(c, ESTUDIO, '57315', 'quien_decidio')).toBe(true)
  })

  it('no confunde otro objeto, otro participante ni otro estudio', async () => {
    const c = clienteFalso({ respuestas: [medido] })
    expect(await hayRegistroDelObjeto(c, ESTUDIO, '57315', 'semana')).toBe(false)
    expect(await hayRegistroDelObjeto(c, ESTUDIO, '57999', 'quien_decidio')).toBe(false)
    expect(await hayRegistroDelObjeto(c, 'otro-estudio', '57315', 'quien_decidio')).toBe(false)
  })

  it('ante un error de la consulta dice que SI hay: un duplicado es peor que un hueco', async () => {
    // Si se guardara, el analisis tendria dos vectores del mismo objeto sin saber cual es el
    // medido. Por eso el error se traduce en "no guardes".
    const c = clienteFalso({ errorRespuestas: '500' })
    expect(await hayRegistroDelObjeto(c, ESTUDIO, '57315', 'quien_decidio')).toBe(true)
  })
})

describe('guardarVectorDeTexto', () => {
  it('marca el origen: un vector escrito a mano NUNCA se confunde con uno medido', async () => {
    const insertados: Fila[] = []
    const c = clienteFalso({ insertados })
    await guardarVectorDeTexto(c, ESTUDIO, '57315', spec.objetos[0], { objeto: 'quien_decidio', porcentajes: [60, 20, 20] })

    expect(insertados).toHaveLength(1)
    const fila = insertados[0] as { estudio: string; token: string; payload: Fila }
    expect(fila.estudio).toBe(ESTUDIO)
    expect(fila.token).toBe('57315')
    expect(fila.payload.origen).toBe(ORIGEN_TEXTO)
    expect(fila.payload.modo).toBe('objeto_suelto')
    expect(fila.payload.objeto).toBe('quien_decidio')
    const respuesta = fila.payload.respuesta as Fila
    expect(respuesta.origen).toBe(ORIGEN_TEXTO)
    expect(respuesta.porcentajes).toEqual([60, 20, 20])
    // `vector_aproximado`, no `vector`: la clave tambien dice que no es una medicion.
    expect(respuesta.vector_aproximado).toEqual([0.6, 0.2, 0.2])
    expect(respuesta.vector).toBeUndefined()
  })
})
