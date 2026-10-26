import { describe, expect, it } from 'vitest'
import { catalogoDe } from './funciones/catalogo'
import { FUNCIONES_COMUNES } from './funciones/comunes'
import type { Funcion } from './funciones/tipos'
import { modeloGuionado } from './modelo-guionado'
import { escenarioOne } from './one/escenario'
import { reglamentoOne } from './one/reglamento'
import {
  ESCALAMIENTO_CHATWOOT_HOY, ESCALAMIENTO_METRIK, correccionesSeguidas, dentroDeHorario, escalamientoDe, mensajeParaPersona, senalDelCodigo,
  sinDatosSensibles, urlWa,
} from './persona'
import type { FilaEscalamiento } from './persona'
import { escenarioPublico, reglamentoSabor } from './publico/escenario'
import type { Ficha, Salida, Traza } from './tipos'

/**
 * El paso a una persona (spec 2026-10-26, §4.2): los casos de la spec, en WhatsApp (wa_link, ONE) y en Chatwoot
 * (chatwoot_equipo, un rol de prueba sobre el motor `publico`). El modelo es un guion. Datos inventados.
 */

const NEGOCIOS = [
  { id: 'n-a', codigo: 'A1 26 1', nombre: 'Obra de prueba', empresa: 'Alfa Pruebas', contacto: null, etapa: 'ejecucion', valor: 2_500_000 },
]
const responder = (texto: string) => ({ name: 'responder', args: { tema: 'conversacion', texto } })
const enlaces = (ss: Salida[]) => ss.filter((s): s is Extract<Salida, { tipo: 'enlace' }> => s.tipo === 'enlace')
const textoDe = (url: string) => decodeURIComponent(new URL(url).searchParams.get('text') ?? '')

const fichaEscalamiento = (valores: Record<string, unknown>): Ficha => ({ clave: 'rol.escalamiento', tipo: 'alcance', carga: 'siempre', hacer: 'A quién se pasa la conversación.', valores })

describe('wa_link (ONE): ofrecer o pasar', () => {
  it('«Quiero hablar con alguien»: el botón al WhatsApp de MeTRIK sale de una, con el mensaje que arma el código', async () => {
    const e = await escenarioOne({
      modelo: modeloGuionado([{ name: 'pasar_a_persona', args: { motivo: 'pide_persona', pidio: 'revisar el gasto del 1.234.567 de la obra' } }]),
      negocios: NEGOCIOS, rol: 'operator', remitente: { nombre: 'Pedro Operario', rol: 'operator' },
    })
    const salidas = await e.escribe('quiero hablar con alguien')
    const [b] = enlaces(salidas)
    expect(salidas).toHaveLength(1)
    expect(b.url.startsWith('https://wa.me/573159509103?text=')).toBe(true)
    expect(b.texto).toContain('alguien de MeTRIK')
    expect([...b.boton].length).toBeLessThanOrEqual(20)
    // El mensaje: quién es y qué necesita, sin el monto (cifra de 5 dígitos o más).
    expect(textoDe(b.url)).toBe('Hola, soy Pedro Operario de Empresa de Prueba. El asistente no pudo con: revisar el gasto del … de la obra')
    expect(e.trazas().at(-1)!.escalamiento).toMatchObject({ modo: 'link', motivo: 'pide_persona', senal: 'modelo' })
    expect(e.escalamientos).toEqual([expect.objectContaining({ modo: 'link', motivo: 'pide_persona', canal: 'wa_one', rol_clave: 'cargo:operator' })])
    // La conversación va por alias, nunca el teléfono.
    expect(e.escalamientos[0].conversacion).toMatch(/^wa-[0-9a-f]{10}$/)
    expect(JSON.stringify(e.escalamientos)).not.toContain('573000001234')
  })

  it('dos «no pude» seguidos: se ofrece una vez, debajo de la respuesta fija', async () => {
    const e = await escenarioOne({ modelo: modeloGuionado([{ falla: 'http 529' }, { falla: 'http 529' }]), negocios: NEGOCIOS })
    const primero = await e.escribe('cómo va la obra')
    expect(enlaces(primero)).toEqual([])
    const segundo = await e.escribe('hola?')
    expect(segundo.map((s) => s.tipo)).toEqual(['texto', 'enlace'])
    expect(segundo[1].texto).toContain('¿Quieres hablar con alguien de MeTRIK?')
    expect(textoDe((segundo[1] as Extract<Salida, { tipo: 'enlace' }>).url)).toContain('El asistente no pudo con: responderme (falló dos veces seguidas)')
    expect(e.trazas().at(-1)!.escalamiento).toMatchObject({ modo: 'ofrecido', motivo: 'no_pude', senal: 'codigo' })
    expect(e.escalamientos.map((f) => [f.modo, f.motivo])).toEqual([['ofrecido', 'no_pude']])
  })

  it('ya se ofreció en el turno anterior: el tercer «no pude» no lo repite; el cuarto sí puede', async () => {
    const e = await escenarioOne({ modelo: modeloGuionado([{ falla: 'x' }, { falla: 'x' }, { falla: 'x' }, { falla: 'x' }]), negocios: NEGOCIOS })
    await e.escribe('uno')
    expect(enlaces(await e.escribe('dos'))).toHaveLength(1)
    expect(enlaces(await e.escribe('tres'))).toHaveLength(0)
    expect(enlaces(await e.escribe('cuatro'))).toHaveLength(1)
  })

  it('el modelo tampoco lo ofrece dos veces seguidas (candado), pero si la persona lo pide, sale de una', async () => {
    const e = await escenarioOne({
      modelo: modeloGuionado([
        { name: 'pasar_a_persona', args: { motivo: 'frustracion', pidio: 'registrar un gasto' } },
        { name: 'pasar_a_persona', args: { motivo: 'no_entiende', pidio: 'registrar un gasto' } },
        responder('Dime de qué negocio es el gasto.'),
        { name: 'pasar_a_persona', args: { motivo: 'pide_persona', pidio: 'registrar un gasto' } },
      ]),
      negocios: NEGOCIOS,
    })
    const a = await e.escribe('esto no sirve!!')
    expect(enlaces(a)[0].texto).toContain('¿Quieres hablar con alguien de MeTRIK?')
    const b = await e.escribe('no me entiendes')
    expect(b.map((s) => s.tipo)).toEqual(['texto'])
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['persona_ya_ofrecida'])
    const c = await e.escribe('pásame con alguien')
    expect(enlaces(c)).toHaveLength(1)
    expect(e.escalamientos.map((f) => f.modo)).toEqual(['ofrecido', 'link'])
  })

  it('tercera corrección del mismo campo: con la cuarta propuesta sobre lo mismo, se ofrece', async () => {
    const gasto = (monto: number) => ({ name: 'proponer', args: { accion: 'gasto', datos: { monto, negocio: 'A1 26 1', categoria: 'transporte' } } })
    const e = await escenarioOne({ modelo: modeloGuionado([gasto(1000), gasto(2000), gasto(3000), gasto(4000)]), negocios: NEGOCIOS, rol: 'operator' })
    expect(enlaces(await e.escribe('gasté 1000 en transporte en la A1 26 1'))).toEqual([])
    expect(enlaces(await e.escribe('no, fueron 2000'))).toEqual([])
    expect(enlaces(await e.escribe('no, 3000'))).toEqual([])
    const cuarta = await e.escribe('que no, 4000')
    expect(cuarta.map((s) => s.tipo)).toEqual(['botones', 'enlace'])
    expect(e.trazas().at(-1)!.escalamiento).toMatchObject({ modo: 'ofrecido', motivo: 'bucle' })
    // La propuesta sigue viva: su botón todavía registra.
    await e.toca('Registrar')
    expect(e.puerto.gastos.map((g) => g.monto)).toEqual([4000])
  })

  it('un operario de un rol con la oficina en la ficha: sale el número de la oficina y nunca el nombre de una persona', async () => {
    const base = await reglamentoOne('Obras Demo')
    const reglamento = { ...base, fichas: [...base.fichas, fichaEscalamiento({ modo: 'wa_link', numero: '+57 601 555 0101', atiende: 'la oficina', boton: 'Escribir a la oficina' })] }
    const e = await escenarioOne({
      modelo: modeloGuionado([{ name: 'pasar_a_persona', args: { motivo: 'pide_persona', pidio: 'hablar con alguien' } }]),
      negocios: NEGOCIOS, rol: 'operator', reglamento, remitente: { nombre: 'Juan Operario', rol: 'operator' },
      funciones: ['equipo.consulta_negocio'],
      rolTraza: { clave: 'recolector', id: 'r-1', version: 1, reglamento_id: 'reg-1', por: 'staff', funciones: [{ funcion: 'equipo.consulta_negocio', parametros: {} }] },
    })
    const [b] = enlaces(await e.escribe('necesito hablar con alguien'))
    expect(b.url.startsWith('https://wa.me/576015550101?text=')).toBe(true)
    expect(b.texto).toBe('Te paso con la oficina: toca el botón y se abre su WhatsApp con el mensaje ya escrito. Solo envíalo.')
    // «Escribir a la oficina» pasa de 20 (Meta): no se corta a media frase, va el genérico.
    expect(b.boton).toBe('Abrir WhatsApp')
    for (const nombre of ['Liliana', 'Mauricio']) expect(JSON.stringify(b)).not.toContain(nombre)
    expect(b.url).not.toContain('573159509103')
    expect(e.escalamientos[0]).toMatchObject({ rol_clave: 'recolector', modo: 'link' })
  })

  it('si la fila de asistente_escalamientos no se escribe, el traspaso sale igual', async () => {
    const e = await escenarioOne({
      modelo: modeloGuionado([{ name: 'pasar_a_persona', args: { motivo: 'pide_persona', pidio: 'hablar con alguien' } }]),
      negocios: NEGOCIOS, escalamientos: { registrar: async () => { throw new Error('la base no responde') } },
    })
    const salidas = await e.escribe('quiero hablar con una persona')
    expect(enlaces(salidas)).toHaveLength(1)
    expect(e.mensajero.enviados.map((x) => x.salida.tipo)).toEqual(['enlace'])
    expect(e.trazas().at(-1)!.escalamiento).toMatchObject({ modo: 'link' })
  })

  it('sin el paso a persona (sinPersona), ONE sigue como antes: el modelo no ve pasar_a_persona', async () => {
    const m = modeloGuionado([responder('Hola.')])
    const e = await escenarioOne({ modelo: m, negocios: NEGOCIOS, sinPersona: true })
    await e.escribe('hola')
    expect(m.pedidos[0].herramientas.map((h) => h.name)).not.toContain('pasar_a_persona')
    const con = modeloGuionado([responder('Hola.')])
    await (await escenarioOne({ modelo: con, negocios: NEGOCIOS })).escribe('hola')
    expect(con.pedidos[0].herramientas.map((h) => h.name)).toContain('pasar_a_persona')
  })
})

describe('chatwoot_equipo: un rol compuesto de prueba sobre el motor publico', () => {
  const f = (clave: string, h: Funcion['herramientas']['x']): Funcion => ({ clave, familia: 'clientes', queHace: '', herramientas: { publico: h }, candados: [], fichas: [] })
  const CATALOGO_PRUEBA = catalogoDe([...FUNCIONES_COMUNES, f('clientes.prueba_ficha', { lecturas: ['ver_catalogo', 'ver_funciones'] })])
  const rol = { clave: 'asesor_vendedor', id: 'rol-1', version: 1, reglamento_id: 'reg-1', por: 'inbox' as const, funciones: [{ funcion: 'clientes.prueba_ficha', parametros: {} }] }

  it('pasar_a_persona hace la nota, la etiqueta, el equipo de la ficha y el open; deja la fila «pasado»', async () => {
    const sabor = await reglamentoSabor()
    const reglamento = { ...sabor, fichas: [...sabor.fichas, fichaEscalamiento({ modo: 'chatwoot_equipo', equipos: { pago: 42 }, equipo_por_defecto: 7 })] }
    const filas: FilaEscalamiento[] = []
    const e = await escenarioPublico({
      modelo: modeloGuionado([{ name: 'pasar_a_persona', args: { motivo: 'pago', pidio: 'ya pagó y quiere confirmar' } }]),
      reglamento, funciones: rol.funciones, catalogo: CATALOGO_PRUEBA, rol, config: { equipos: { pago: 3 } },
      escalamientos: { registrar: async (x) => { filas.push(x) } },
    })
    await e.escribe('ya pagué, me confirman?')
    const k = `${e.llave.cuentaId}:${e.llave.conversacionId}`
    expect(e.chatwoot.notas.at(-1)!.texto.split('\n')[0]).toBe('[Asistente] Paso a persona · motivo: pago')
    expect(e.chatwoot.notas.at(-1)!.texto).toContain('Reserva: sin datos tomados')
    expect([...e.chatwoot.etiquetas.get(k)!]).toEqual(['pago'])
    expect(e.chatwoot.equipos.get(k)).toBe(42)
    expect(await e.chatwoot.estado(e.llave)).toBe('open')
    expect(filas).toEqual([expect.objectContaining({ modo: 'pasado', motivo: 'pago', canal: 'chatwoot', rol_clave: 'asesor_vendedor', conversacion: `cw:${k}` })])
    expect(e.trazas().at(-1)!.escalamiento).toMatchObject({ modo: 'pasado', motivo: 'pago' })
  })

  it('una función con el gancho `notaPersona` pone su bloque en el medio de la nota (en lugar del de Sabor)', async () => {
    const conGancho: Funcion = { ...f('clientes.prueba_reserva', { acciones: ['reserva'] }), notaPersona: (x) => [`Bloque de prueba: ${x.motivo}`] }
    const cat = catalogoDe([...FUNCIONES_COMUNES, f('clientes.prueba_ficha', { lecturas: ['ver_catalogo', 'ver_funciones'] }), conGancho])
    const e = await escenarioPublico({
      modelo: modeloGuionado([{ name: 'pasar_a_persona', args: { motivo: 'queja', pidio: 'una queja' } }]),
      funciones: ['clientes.prueba_ficha', 'clientes.prueba_reserva'], catalogo: cat, rol,
    })
    await e.escribe('tengo una queja')
    expect(e.chatwoot.notas.at(-1)!.texto.split('\n')).toEqual([
      '[Asistente] Paso a persona · motivo: queja', 'Pidió: una queja', 'Bloque de prueba: queja', 'Siguiente paso: atender la queja',
    ])
  })

  it('si la fila no se escribe, el paso a persona sale igual', async () => {
    const e = await escenarioPublico({
      modelo: modeloGuionado([{ name: 'pasar_a_persona', args: { motivo: 'queja', pidio: 'una queja' } }]),
      funciones: rol.funciones, catalogo: CATALOGO_PRUEBA, rol,
      escalamientos: { registrar: async () => { throw new Error('caída') } },
    })
    await e.escribe('tengo una queja')
    expect(await e.chatwoot.estado(e.llave)).toBe('open')
    expect(e.chatwoot.notas).toHaveLength(1)
  })

  it('sin roles, Sabor sigue con el equipo de config_extra (la ficha no se lee)', async () => {
    const sabor = await reglamentoSabor()
    const reglamento = { ...sabor, fichas: [...sabor.fichas, fichaEscalamiento({ modo: 'chatwoot_equipo', equipos: { pago: 42 } })] }
    const e = await escenarioPublico({ modelo: modeloGuionado([{ name: 'pasar_a_persona', args: { motivo: 'pago', pidio: 'pago' } }]), reglamento, config: { equipos: { pago: 3 } } })
    await e.escribe('ya pagué')
    expect(e.chatwoot.equipos.get(`${e.llave.cuentaId}:${e.llave.conversacionId}`)).toBe(3)
  })
})

describe('las piezas puras', () => {
  const t = (x: Partial<Traza>): Traza => ({ tipo: 'modelo', bot: 'one', salida: { tipo: 'texto', texto: 'x' }, ...x })

  it('rol.escalamiento: sin ficha, con modo de otro canal o con un número que no sirve, rige el de por defecto', () => {
    expect(escalamientoDe(null, ESCALAMIENTO_METRIK)).toBe(ESCALAMIENTO_METRIK)
    const r = (v: Record<string, unknown>) => ({ fichas: [fichaEscalamiento(v)] })
    expect(escalamientoDe(r({ modo: 'chatwoot_equipo' }), ESCALAMIENTO_METRIK, () => {})).toBe(ESCALAMIENTO_METRIK)
    expect(escalamientoDe(r({ modo: 'wa_link', numero: '12' }), ESCALAMIENTO_METRIK, () => {})).toBe(ESCALAMIENTO_METRIK)
    expect(escalamientoDe(r({ modo: 'wa_link', umbral_no_pude: 3, plantilla: 'sin el hueco' }), ESCALAMIENTO_METRIK)).toMatchObject({
      numero: '573159509103', atiende: 'alguien de MeTRIK', plantilla: ESCALAMIENTO_METRIK.plantilla, umbrales: { noPude: 3, correcciones: 3 },
    })
    expect(escalamientoDe(r({ modo: 'chatwoot_equipo', equipos: { pago: 4, queja: 'x' }, horario: { dias: [1, 2], desde: '09:00', hasta: '18:00' } }), ESCALAMIENTO_CHATWOOT_HOY)).toEqual({
      modo: 'chatwoot_equipo', equipos: { pago: 4 }, equipoPorDefecto: null, horario: { dias: [1, 2], desde: '09:00', hasta: '18:00' }, umbrales: { noPude: 2, correcciones: 3 },
    })
  })

  it('el mensaje ya escrito no lleva datos sensibles', () => {
    expect(sinDatosSensibles('mi cédula 1.020.304.050, cel 315 950 9103, correo a@b.co, https://x.co/y y 3 personas')).toBe('mi cédula …, cel …, correo … … y 3 personas')
    expect(mensajeParaPersona(ESCALAMIENTO_METRIK, { nombre: null, empresa: null, resumen: 'algo' })).toBe('Hola, soy una persona del equipo de mi empresa. El asistente no pudo con: algo')
    expect(urlWa('+57 315 950 9103', 'a b?')).toBe('https://wa.me/573159509103?text=a%20b%3F')
  })

  it('la señal del código: «no pude» seguidos (un error de envío no cuenta) y correcciones', () => {
    const caido = t({ respuesta_fija: 'rf.modelo_caido' })
    expect(senalDelCodigo([caido], t({ error: 'modelo: http 529' }), ESCALAMIENTO_METRIK.umbrales)).toBe('no_pude')
    expect(senalDelCodigo([caido], t({ error: 'Meta rechazó el envío' }), ESCALAMIENTO_METRIK.umbrales)).toBeNull()
    expect(senalDelCodigo([caido, t({})], caido, ESCALAMIENTO_METRIK.umbrales)).toBeNull()
    const p = (sobre: string, monto: number) => t({ propuesta: { accion: 'gasto', datos: { monto }, resumen: 'r', sobre, si: 'S', no: 'N', huella: String(monto), args_modelo: {} } })
    expect(correccionesSeguidas([p('A', 1), p('A', 2), p('A', 3)], p('A', 4))).toBe(3)
    expect(correccionesSeguidas([p('A', 1), p('B', 2), p('A', 3)], p('A', 4))).toBe(1)
    const pregunta = t({ salida: { tipo: 'texto', texto: '¿De qué negocio es?' } })
    expect(correccionesSeguidas([pregunta, pregunta, pregunta], pregunta)).toBe(3)
  })

  it('el horario de la ficha, en hora de Bogotá', () => {
    const h = { dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' }
    expect(dentroDeHorario(h, Date.parse('2026-10-26T15:00:00Z'))).toBe(true) // lunes 10:00
    expect(dentroDeHorario(h, Date.parse('2026-10-26T02:00:00Z'))).toBe(false) // domingo 21:00
    expect(dentroDeHorario(null, 0)).toBe(true)
  })
})
