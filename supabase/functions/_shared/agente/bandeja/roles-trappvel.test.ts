import { describe, expect, it } from 'vitest'
import { escenario, reglamentoDePrueba } from '../escenario'
import type { Escenario } from '../escenario'
import { modeloGuionado } from '../modelo-guionado'
import type { PedidoModelo } from '../tipos'
import { declaraciones } from '../herramientas'
import { dominioBandeja } from './dominio'
import { PuertoMemoria } from '../memoria'
import { dominioOne } from '../one/dominio'
import { PuertoOneMemoria } from '../one/puerto-memoria'
import { RF_ROL_NO_LEIDO, RF_SIN_ROL, bloquesDelTurno, turnoViajes } from './turno-con-rol'
import type { PuertosTurnoViajes } from './turno-con-rol'
import { FUNCIONES_ROL, fichasBaseBandeja, fichasDelRol } from './roles-trappvel'
import { lectorMixto, unirLecturas } from './lectura-mixta'
import { textoLectura } from '../contexto'
import { propuestaVigente } from '../nucleo'
import type { RolResuelto } from '../roles'
import type { Ficha, LecturaAdjunto } from '../tipos'
import { RESPUESTAS_FIJAS_NUCLEO } from '../reglamento'
import { fichasOne } from '../one/reglamento'
import { BOTON_POR_DEFECTO, MOTIVO_LLANO, PLANTILLA_POR_DEFECTO } from '../persona'

/**
 * Los dos roles de Trappvel sobre la bandeja de viajes (2026-10-29): el turno por el rol (hoy / rol / parar), lo que ve
 * el modelo en cada rol, y la mano derecha con dos motores en la misma conversación (abrir un viaje de una solicitud
 * reenviada y registrar un gasto con foto sin que una cosa se trague la otra). Modelo guionado; datos inventados.
 */

const rolResuelto = (clave: 'mano_derecha' | 'asesor_viajes', extra: Partial<RolResuelto> = {}): RolResuelto => ({
  id: `rol-${clave}`, clave, familia: 'equipo', canal: 'wa_one', activo: true, reglamento_id: `reg-${clave}`, version: 1, por: 'staff',
  asignacion_id: 'a-1', funciones: FUNCIONES_ROL[clave].map((funcion) => ({ funcion, parametros: {} })), funciones_apagadas: [], ...extra,
})

function puertos(r: Awaited<ReturnType<PuertosTurnoViajes['resolver']>>, o: { reglamento?: boolean; llamadasOne?: string[][] } = {}): PuertosTurnoViajes {
  return {
    resolver: async () => r,
    rolPrevio: async () => null,
    reglamentoDelRol: async (clave) => (o.reglamento === false ? null : await reglamentoDePrueba(fichasDelRol(clave as 'mano_derecha'))),
    motorViajes: () => dominioBandeja(new PuertoMemoria({})),
    motorOne: (funciones, empresa) => {
      o.llamadasOne?.push(funciones)
      return dominioOne(new PuertoOneMemoria({}), { rol: 'operator', funciones, empresa })
    },
    empresa: async () => 'Agencia de Prueba',
  }
}

/** Lo que el modelo lee como instrucción o el usuario recibe: `hacer`, `cuando` y los textos de `valores` (no las claves). */
function textosVisibles(f: Ficha): string[] {
  const out: string[] = [f.hacer, f.cuando ?? '']
  const recorrer = (v: unknown): void => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(recorrer)
    else if (v && typeof v === 'object') Object.values(v).forEach(recorrer)
  }
  recorrer(f.valores)
  return out
}

const PLATA = /\bplata\b/i

describe('«plata» está vetada en lo que dice el asistente (decisión de Mauricio, 2026-10-30)', () => {
  it.each(['mano_derecha', 'asesor_viajes'] as const)('%s: ninguna ficha del rol ni del turno compuesto la trae (las claves sí pueden)', async (clave) => {
    const fichas = fichasDelRol(clave)
    expect(fichas.flatMap((f) => textosVisibles(f).filter((t) => PLATA.test(t)).map((t) => `${f.clave}: ${t}`))).toEqual([])
    // El reglamento del turno, con la ayuda y el «fuera de tema» que escribe el código para el rol.
    const t = await turnoViajes(puertos({ tipo: 'rol', rol: rolResuelto(clave) }))
    if (t.tipo !== 'atender') throw new Error(t.tipo)
    expect(t.reglamento.fichas.flatMap((f) => textosVisibles(f).filter((x) => PLATA.test(x)).map((x) => `${f.clave}: ${x}`))).toEqual([])
  })

  it('el asistente se llama Trappi en la bandeja y en los dos roles (decisión de Mauricio, 2026-10-30)', () => {
    const nombre = (fs: Ficha[]) => fs.find((f) => f.clave === 'perfil')?.valores?.nombre
    expect(nombre(fichasBaseBandeja())).toBe('Trappi')
    expect(nombre(fichasDelRol('mano_derecha'))).toBe('Trappi')
    expect(nombre(fichasDelRol('asesor_viajes'))).toBe('Trappi')
  })

  it('las respuestas fijas y los textos del código tampoco', () => {
    const fijas = [
      ...Object.values(RESPUESTAS_FIJAS_NUCLEO), RF_SIN_ROL, RF_ROL_NO_LEIDO, ...Object.values(MOTIVO_LLANO), PLANTILLA_POR_DEFECTO, BOTON_POR_DEFECTO,
      ...fichasOne('Agencia de Prueba').filter((f) => f.tipo === 'respuesta_fija').flatMap(textosVisibles),
      ...fichasBaseBandeja().filter((f) => f.tipo === 'respuesta_fija').flatMap(textosVisibles),
    ]
    expect(fijas.filter((t) => PLATA.test(t))).toEqual([])
  })
})

describe('el turno de la bandeja por el rol', () => {
  it('sin roles en el workspace: el camino de hoy (nada se compone)', async () => {
    const llamadasOne: string[][] = []
    const t = await turnoViajes(puertos({ tipo: 'hoy', motivo: 'el workspace no usa roles en este canal' }, { llamadasOne }))
    expect(t).toEqual({ tipo: 'hoy', motivo: 'el workspace no usa roles en este canal' })
    expect(llamadasOne).toEqual([])
  })

  it('con roles y remitente sin rol: la respuesta fija, sin modelo; si no se pudo leer, la otra', async () => {
    expect(await turnoViajes(puertos({ tipo: 'parar', motivo: 'sin_rol' }))).toMatchObject({ tipo: 'parar', texto: RF_SIN_ROL })
    expect(await turnoViajes(puertos({ tipo: 'parar', motivo: 'lectura_fallo' }))).toMatchObject({ tipo: 'parar', texto: RF_ROL_NO_LEIDO })
    expect(await turnoViajes(puertos({ tipo: 'rol', rol: rolResuelto('asesor_viajes') }, { reglamento: false }))).toMatchObject({ tipo: 'parar', texto: RF_ROL_NO_LEIDO })
  })

  it('asesora: solo viajes y el paso a persona; el motor ONE ni se arma', async () => {
    const llamadasOne: string[][] = []
    const t = await turnoViajes(puertos({ tipo: 'rol', rol: rolResuelto('asesor_viajes') }, { llamadasOne }))
    if (t.tipo !== 'atender') throw new Error(t.tipo)
    expect(llamadasOne).toEqual([])
    expect(t.composicion.declaradas).toEqual({
      lecturas: ['buscar', 'ver_viaje'], cierres: ['link_autorizacion', 'pasar_a_persona'],
      acciones: ['viaje_nuevo', 'cargar_tanda', 'anotar_en_viaje', 'crear_cliente', 'descartar', 'perfil_contacto'],
    })
    expect(t.rol).toMatchObject({ clave: 'asesor_viajes', version: 1, reglamento_id: 'reg-asesor_viajes' })
    expect(t.bloques).toBeNull()
    // Lo que ve el modelo: ninguna herramienta de dinero.
    const nombres = declaraciones(t.dominio, t.reglamento).map((d) => d.name)
    expect(nombres).toEqual(['buscar', 'ver_viaje', 'link_autorizacion', 'pasar_a_persona', 'proponer', 'responder'])
    // Su reglamento no habla de gastos: no trae fichas de ONE y conserva «esta bandeja no consulta cartera, gastos…».
    const claves = t.reglamento.fichas.map((f) => f.clave)
    expect(claves).toContain('alc.plata')
    expect(claves.filter((k) => ['p.gasto', 'g.ingreso', 'g.soporte', 'glo.gasto_empresa'].includes(k))).toEqual([])
    expect(t.escalamiento).toMatchObject({ modo: 'wa_link', numero: '573159509103', atiende: 'alguien de MeTRIK' })
  })

  it('mano derecha: viajes + ONE + persona, con los bloques del prompt más grandes', async () => {
    const llamadasOne: string[][] = []
    const t = await turnoViajes(puertos({ tipo: 'rol', rol: rolResuelto('mano_derecha') }, { llamadasOne }))
    if (t.tipo !== 'atender') throw new Error(t.tipo)
    expect(llamadasOne).toHaveLength(1)
    expect(t.composicion.descartadas).toEqual([])
    expect(t.composicion.errores).toEqual([])
    const nombres = declaraciones(t.dominio, t.reglamento).map((d) => d.name)
    expect(nombres).toEqual([
      'buscar', 'ver_viaje', 'buscar_negocios', 'negocios_abiertos', 'ver_negocio', 'gastos_recientes',
      'link_autorizacion', 'preguntar_destino', 'pasar_a_persona', 'proponer', 'responder',
    ])
    expect([...t.composicion.declaradas.acciones].sort()).toEqual([
      'actividad', 'adjuntar_soporte', 'anotar_en_viaje', 'cargar_tanda', 'corregir_gasto', 'crear_cliente', 'descartar', 'gasto', 'ingreso',
      'perfil_contacto', 'viaje_nuevo',
    ])
    expect(t.composicion.declaradas.acciones).not.toContain('contacto_nuevo')
    expect(t.bloques).toEqual(bloquesDelTurno(t.composicion))
    expect(t.bloques).not.toBeNull()
    // `texto` lo usan anotar_en_viaje y actividad: una sola propiedad con las dos descripciones.
    const texto = (t.dominio.datosProponer.texto as { description: string }).description
    expect(texto).toContain('anotar_en_viaje')
    expect(texto).toContain('actividad')
    // El principal es viajes: los reenvíos son la tanda, como hoy; las propuestas de ONE vencen con cualquier respuesta.
    expect(t.dominio.bot).toBe('bandeja-solicitudes')
    expect(t.dominio.reenvios).toBeUndefined()
    expect(t.dominio.venceConRespuesta?.('gasto')).toBe(true)
    expect(t.dominio.venceConRespuesta?.('viaje_nuevo')).toBe(false)
    // Su reglamento: sin «no consulta cartera, gastos…», con las reglas del gasto de ONE y sin crear contactos.
    const claves = t.reglamento.fichas.map((f) => f.clave)
    expect(claves).not.toContain('alc.plata')
    expect(claves).toEqual(expect.arrayContaining(['p.gasto', 'g.ingreso', 'g.soporte', 'g.viaje_o_gasto', 'g.rol_dueno']))
    expect(claves).not.toContain('g.contacto')
  })
})

describe('las fichas de los roles', () => {
  it('la asesora es la bandeja de hoy más lo del rol (ninguna ficha de la bandeja cambia)', () => {
    const base = fichasBaseBandeja()
    const rol = fichasDelRol('asesor_viajes', base)
    expect(rol.slice(0, base.length)).toEqual(base)
    expect(rol.slice(base.length).map((f) => f.clave)).toEqual(['rol.funciones', 'rol.escalamiento', 'rol.saludo', 'g.natural'])
    expect(rol.find((f) => f.clave === 'rol.funciones')!.valores).toEqual({ funciones: FUNCIONES_ROL.asesor_viajes })
  })

  it('la mano derecha: claves únicas, conserva los valores del perfil de la base y suma los temas de ONE', () => {
    const base = fichasBaseBandeja()
    const rol = fichasDelRol('mano_derecha', base)
    expect(new Set(rol.map((f) => f.clave)).size).toBe(rol.length)
    expect(rol.find((f) => f.clave === 'perfil')!.valores).toEqual(base.find((f) => f.clave === 'perfil')!.valores)
    expect(rol.find((f) => f.clave === 'alc.temas')!.valores!.temas).toEqual(['solicitud', 'viaje', 'cliente', 'saludo', 'gasto', 'ingreso', 'actividad', 'negocios', 'ayuda'])
    // Las respuestas fijas son las de la bandeja.
    for (const f of rol.filter((x) => x.clave.startsWith('rf.'))) expect(f).toEqual(base.find((x) => x.clave === f.clave))
  })

  it('con otra base (la publicada en producción, exportada) el rol se arma sobre ella', () => {
    const base = fichasBaseBandeja().map((f) => (f.clave === 'g.fechas' ? { ...f, hacer: 'texto que la agencia ajustó' } : f))
    expect(fichasDelRol('asesor_viajes', base).find((f) => f.clave === 'g.fechas')!.hacer).toBe('texto que la agencia ajustó')
    expect(fichasDelRol('mano_derecha', base).find((f) => f.clave === 'g.fechas')!.hacer).toBe('texto que la agencia ajustó')
  })
})

describe('la lectura mixta (viaje + soporte de pago)', () => {
  const viaje: LecturaAdjunto = { legible: true, clase: 'viaje', texto: 'San Andrés del 3 al 8 de enero, 2 adultos', monto: null, fecha: null, comercio: null, nit: null, descripcion: null }
  const recibo: LecturaAdjunto = { legible: true, monto: 45000, fecha: '2026-10-28', comercio: 'Taxis Libres', nit: null, descripcion: 'taxi al aeropuerto' }
  const noPago: LecturaAdjunto = { legible: false, monto: null, fecha: null, comercio: null, nit: null, descripcion: null }

  it('une las dos lecturas y la conversación muestra lo que sirve de cada una', async () => {
    const l = await lectorMixto(async () => viaje, async () => noPago)({ bytes: new Uint8Array(), mime: 'image/jpeg' })
    expect(l).toMatchObject({ legible: true, clase: 'viaje', texto: viaje.texto, monto: null, mixta: true })
    expect(textoLectura(l)).toBe(' · lo que dice el archivo (del viaje): "San Andrés del 3 al 8 de enero, 2 adultos"')
    const r = unirLecturas({ legible: false, clase: 'otro', texto: null, monto: null, fecha: null, comercio: null, nit: null, descripcion: null }, recibo)
    expect(r).toMatchObject({ legible: true, monto: 45000, fecha: '2026-10-28', texto: null, mixta: true })
    expect(textoLectura(r)).toBe(' · lo que dice el archivo: total $45.000 · fecha 2026-10-28 · comercio "Taxis Libres" · concepto "taxi al aeropuerto"')
  })

  it('si ningún lector respondió, null; si los dos fallaron, «no se pudo leer»', async () => {
    expect(await lectorMixto(async () => { throw new Error('x') }, async () => null)({ bytes: new Uint8Array(), mime: 'image/jpeg' })).toBeNull()
    const r = unirLecturas({ ...noPago, clase: 'otro', texto: null, motivo: 'el lector no respondió' }, noPago)
    expect(textoLectura(r)).toBe(' · (no se pudo leer el archivo: el lector no respondió)')
  })

  it('una lectura de la bandeja sola (sin mixta) se ve como hoy', () => {
    expect(textoLectura(viaje)).toBe(' · lo que dice el archivo (del viaje): "San Andrés del 3 al 8 de enero, 2 adultos"')
  })
})

describe('la mano derecha en una conversación: un viaje de una solicitud reenviada y un gasto con foto', () => {
  const CONTACTOS = [{ id: 'c-martin', nombre: 'MARTIN MORA', celular: '5550001001' }]
  const VIAJES = [{ id: 'v-m1', codigo: 'M1 26 1', contactoId: 'c-martin', nombre: 'CARTAGENA', destino: 'Cartagena', abierto: true, datos: {} }]
  const NEGOCIOS = [{ id: 'v-m1', codigo: 'M1 26 1', nombre: 'CARTAGENA', empresa: null, contacto: 'MARTIN MORA', etapa: 'venta' }]
  const REF = 'Martin Mora (cel. …7311)'
  const RECIBO: LecturaAdjunto = { legible: true, monto: 45000, fecha: '2026-10-06', comercio: 'Taxis Libres', nit: null, descripcion: 'taxi al aeropuerto' }

  it('abre el viaje, carga la tanda, y el gasto con la foto va a ONE; nada se traga lo otro', async () => {
    const ref: { e?: Escenario } = {}
    const n = (texto: string) => ref.e!.almacen.filas.findIndex((f) => f.texto === texto) + 1
    const nFoto = () => ref.e!.almacen.filas.findIndex((f) => f.media?.tipo === 'imagen') + 1
    const pedidos: PedidoModelo[] = []
    const guion = modeloGuionado([
      // «ábrele un viaje a Martín Mora, lo lleva Carla»
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      () => ({ name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, destino: 'San Andrés', responsable: 'Carla Comercial', dicho_en: n(PIDE_VIAJE) } } }),
      // «cárgale lo que te pasé»
      (p) => { pedidos.push(p); return { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: codigoNuevo(ref.e!) } } } },
      // la foto del taxi con su pie
      (p) => { pedidos.push(p); return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 45000, negocio: 'M1 26 1', categoria: 'transporte', descripcion: 'taxi al aeropuerto', soporte: `#${nFoto()}` } } } },
    ])
    const PIDE_VIAJE = 'ábrele un viaje a Martín Mora a San Andrés, lo lleva Carla'
    const e = ref.e = await escenario({
      modelo: guion, contactos: CONTACTOS, viajes: VIAJES,
      reglamento: await reglamentoDePrueba(fichasDelRol('mano_derecha')),
      rol: { clave: 'mano_derecha', funciones: FUNCIONES_ROL.mano_derecha, negocios: NEGOCIOS },
      lector: lectorMixto(async () => ({ legible: false, clase: 'otro', texto: null, monto: null, fecha: null, comercio: null, nit: null, descripcion: null }), async () => RECIBO),
      remitente: { nombre: 'Rodrigo Dueño', rol: 'owner' },
    })
    // 1) La solicitud reenviada va a la tanda (sin modelo), como hoy.
    await e.reenvia('Hola, quiero ir a San Andrés del 3 al 8 de enero, somos 2 adultos')
    expect(guion.pedidos).toHaveLength(0)
    // 2) Abre el viaje.
    await e.escribe(PIDE_VIAJE)
    await e.toca('Sí, ábrelo')
    const viaje = e.puerto.escrituras.find((w) => w.tipo === 'viaje')!
    expect(viaje).toMatchObject({ contactoId: 'c-martin', responsableId: 'staff-carla' })
    // 3) Carga la tanda en el viaje nuevo.
    await e.escribe('cárgale lo que te pasé')
    await e.toca('Cargar')
    expect(e.puerto.escrituras.filter((w) => w.tipo === 'carga').map((w) => w.codigo)).toEqual([viaje.codigo])
    // 4) La foto del recibo con su pie: el Estado trae la tanda vacía y lo de ONE; la foto está leída como soporte.
    await e.adjunta({ tipo: 'foto', pie: 'taxi al aeropuerto del M1 26 1', archivo: { bytes: new Uint8Array([1]), mime: 'image/jpeg' } })
    const ultimo = JSON.stringify(pedidos.at(-1))
    expect(ultimo).toContain('Tanda abierta: ninguna')
    expect(ultimo).toContain('Su rol permite: registrar gastos y actividades')
    expect(ultimo).toContain('total $45.000')
    await e.toca('Registrar')
    // El gasto quedó en ONE, con su soporte y en el negocio del viaje; la tanda no tocó la foto.
    expect(e.puertoOne!.escrituras.map((w) => [w.tipo, w.monto, w.negocio, w.soporte])).toEqual([['gasto', 45000, 'M1 26 1', true]])
    expect(e.puerto.escrituras.filter((w) => w.tipo === 'carga')).toHaveLength(1)
    // Cada turno con su rol en la traza.
    expect(new Set(e.trazas().map((t) => t.rol?.clave))).toEqual(new Set(['mano_derecha']))
    expect(guion.restantes()).toBe(0)
  })

  it('una propuesta de gasto vence con la respuesta siguiente; la de un viaje no (como hoy en cada motor)', () => {
    const fila = (traza: unknown, i: number) => ({ id: `f${i}`, direccion: 'saliente', clase: 'bot', texto: 'x', created_at: `2026-10-29T10:0${i}:00Z`, traza }) as never
    const propuesta = (accion: string) => fila({ tipo: 'modelo', propuesta: { accion, huella: 'h1', datos: {}, resumen: 'r', si: 'Sí', no: 'No' } }, 1)
    const respuesta = fila({ tipo: 'modelo', salida: { tipo: 'texto', texto: '¿algo más?' } }, 2)
    const vence = (a: string) => a === 'gasto'
    expect(propuestaVigente([propuesta('gasto'), respuesta], { venceConRespuesta: vence })).toBeNull()
    expect(propuestaVigente([propuesta('viaje_nuevo'), respuesta], { venceConRespuesta: vence })?.accion).toBe('viaje_nuevo')
  })
})

function codigoNuevo(e: Escenario): string {
  return String(e.puerto.escrituras.find((w) => w.tipo === 'viaje')!.codigo)
}
