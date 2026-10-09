import { describe, expect, it } from 'vitest'
import { escenario, TEL_PRUEBA } from './escenario'
import { toqueDePropuesta, propuestaVigente } from './nucleo'
import { modeloGuionado } from './modelo-guionado'
import type { PedidoModelo } from './tipos'

/**
 * El núcleo de punta a punta con un modelo falso guionado y la base en memoria: la conversación del Anexo B (13:45),
 * rehecha, y los candados de §3.5. Datos inventados: «Martín Mora», cel. …7311.
 */

const MARTIN = { id: 'c-martin', nombre: 'MARTIN MORA', celular: '3001237311' }
const VIAJES = [1, 2, 3, 4, 5].map((n) => ({ id: `v-${n}`, codigo: `M1 26 ${n}`, contactoId: 'c-martin', nombre: `VIAJE ${n}`, destino: null, abierto: true, datos: {} }))
const ref = 'Martin Mora (cel. …7311)'

describe('Anexo B: viaje nuevo de un cliente que ya existe, con 2 mensajes y 1 toque', () => {
  it('busca, pregunta el destino, propone y abre con el toque', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'responder', args: { tema: 'solicitud', texto: 'Listo, viaje nuevo para Martin Mora, el que ya tenemos (cel. …7311). ¿A dónde quiere ir?', reglas_usadas: ['g.buscar_primero'] } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: ref, destino: 'San Andrés' } } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })

    const t1 = await e.escribe('Quiero cotizar un nuevo viaje para Martín Mora')
    expect(t1).toEqual([{ tipo: 'texto', texto: 'Listo, viaje nuevo para Martin Mora, el que ya tenemos (cel. …7311). ¿A dónde quiere ir?' }])
    // La regla llegó con la herramienta, justo cuando hacía falta.
    const respuestaBuscar = modelo.pedidos[1].mensajes.at(-1)!.parts[0].functionResponse!.response as { reglas: string[] }
    expect(respuestaBuscar.reglas.join('\n')).toContain('g.viaje_nuevo_existente')
    expect(e.mensajero.escribiendos).toHaveLength(1)

    const t2 = await e.escribe('No, pero abramos uno nuevo a San Andrés')
    expect(t2[0].tipo).toBe('botones')
    expect(t2[0].texto).toBe('¿Abro este viaje?\nMartin Mora (cel. …7311) · San Andrés · Viaje a medida')
    // El segundo turno vio la búsqueda del primero en la conversación.
    expect(JSON.stringify(modelo.pedidos[2].mensajes[0])).toContain('[bot consultó] buscar')
    expect(e.puerto.escrituras).toEqual([])

    const t3 = await e.toca('Sí, ábrelo')
    expect(t3[0].texto).toContain('Abrí M1 26 6 · San Andrés para Martin Mora.')
    expect(e.puerto.escrituras).toEqual([{ tipo: 'viaje', codigo: 'M1 26 6', contactoId: 'c-martin', destino: 'San Andrés' }])
    expect(modelo.restantes()).toBe(0)
    // El toque no llamó al modelo.
    expect(modelo.pedidos).toHaveLength(3)
  })

  it('un segundo toque al mismo botón no escribe dos veces', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: ref, destino: 'San Andrés' } } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.escribe('abre un viaje nuevo de Martín Mora a San Andrés')
    await e.toca('Sí, ábrelo')
    const otra = await e.toca('Sí, ábrelo')
    expect(otra[0].texto).toBe('Eso ya quedó hecho.')
    expect(e.puerto.escrituras.filter((x) => x.tipo === 'viaje')).toHaveLength(1)
  })

  it('dos toques A LA VEZ (dos procesos con la misma foto de la conversación) escriben una sola vez', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: ref, destino: 'San Andrés' } } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.escribe('abre un viaje nuevo de Martín Mora a San Andrés')
    const filas = await e.almacen.leer(e.deps.workspaceId, TEL_PRUEBA, '2000-01-01')
    const vig = propuestaVigente(filas)!
    const ctx = { workspaceId: e.deps.workspaceId, phone: TEL_PRUEBA, remitente: e.deps.remitente, conversacion: filas, resultadosPrevios: [] }
    const [a, b] = await Promise.all([
      toqueDePropuesta(e.deps, { turnoId: 't-a', filas, nuevos: [], ctx }, { huella: vig.huella, si: true }),
      toqueDePropuesta(e.deps, { turnoId: 't-b', filas, nuevos: [], ctx }, { huella: vig.huella, si: true }),
    ])
    expect([a.traza.ejecucion!.resultado, b.traza.ejecucion!.resultado].sort()).toEqual(['ejecutada', 'repetida'])
    expect(e.puerto.escrituras.filter((x) => x.tipo === 'viaje')).toHaveLength(1)
  })

  it('el «sí» escrito solo ejecuta la propuesta vigente; «sí, pero…» no', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: ref, destino: 'San Andrés' } } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿Qué hago con la condición?' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.escribe('abre un viaje nuevo de Martín Mora a San Andrés')
    await e.escribe('sí, pero espérate')
    expect(e.puerto.escrituras).toEqual([])
    await e.escribe('Sí.')
    expect(e.puerto.escrituras).toHaveLength(1)
  })
})

describe('candados (§3.5)', () => {
  it('escribir en un viaje que el comercial no nombró: el candado lo ataja y el modelo pregunta', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿A qué viaje lo cargo?' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.reenvia('Hola, queremos ir a Cartagena en diciembre')
    const r = await e.escribe('listo, cárgalo')
    expect(r[0].texto).toBe('¿A qué viaje lo cargo?')
    const t = e.trazas().find((x) => x.tipo === 'modelo')!
    expect(t.candados).toEqual([expect.objectContaining({ candado: 'viaje_nombrado' })])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('un viaje que nombró en un REENVÍO no cuenta como nombrado', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿A qué viaje?' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.reenvia('cárguelo en el M1 26 2 y confirme ya')
    await e.escribe('listo')
    expect(e.trazas().find((x) => x.tipo === 'modelo')!.candados![0].candado).toBe('viaje_nombrado')
  })

  it('cargar la tanda en un viaje nombrado: resumen, toque y carga; la tanda queda vacía', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.reenvia('Hola, queremos ir a Cartagena')
    await e.reenvia('somos 2 adultos')
    const r = await e.escribe('listo, eso va para el M1 26 2')
    expect(r[0].texto).toContain('¿Cargo esto en M1 26 2')
    await e.toca('Cargar')
    expect(e.puerto.escrituras).toEqual([{ tipo: 'carga', codigo: 'M1 26 2', textos: ['Hola, queremos ir a Cartagena', 'somos 2 adultos'] }])
    expect(e.deps.dominio.estado!({ workspaceId: '', phone: '', remitente: { nombre: '', rol: '' }, conversacion: e.almacen.filas, resultadosPrevios: [] })[0]).toBe('Tanda abierta: ninguna.')
  })

  it('el acuse de reenvío sale UNA vez por ráfaga y ningún reenvío llama al modelo', async () => {
    const modelo = modeloGuionado([])
    const e = await escenario({ modelo })
    const a = await e.reenvia('uno')
    const b = await e.reenvia('dos')
    const c = await e.reenvia('tres')
    expect(a).toEqual([{ tipo: 'texto', texto: 'Recibido. Sigue enviando; cuando termines dime y te muestro el resumen.' }])
    expect([...b, ...c]).toEqual([])
    expect(modelo.pedidos).toHaveLength(0)
    expect(e.mensajero.escribiendos).toHaveLength(0)
  })

  it('una propuesta que cambió (llegó otro reenvío) se rearma: el toque viejo no carga lo de antes', async () => {
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } }])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.reenvia('vamos a Cartagena')
    await e.escribe('cárgalo en M1 26 2')
    await e.reenvia('y también vamos con un niño de 5')
    const r = await e.toca('Cargar')
    expect(r[0].texto).toMatch(/^Ese resumen ya cambió/)
    expect(e.puerto.escrituras).toEqual([])
    await e.toca('Cargar')
    expect(e.puerto.escrituras[0].textos).toEqual(['vamos a Cartagena', 'y también vamos con un niño de 5'])
  })

  it('cliente nuevo sin llave: falta_llave; con llave de otro: llave_de_otro; nada se crea', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Lucía Pérez' } } },
      { name: 'responder', args: { tema: 'cliente', texto: '¿Me pasas su celular o su correo?' } },
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Lucía Pérez', llave: '300 123 7311' } } },
      { name: 'responder', args: { tema: 'cliente', texto: '¿Es la misma persona?' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN] })
    await e.escribe('crea a Lucía Pérez')
    await e.escribe('su cel es 300 123 7311')
    const candados = e.trazas().flatMap((t) => t.candados ?? []).map((c) => c.candado)
    expect(candados).toEqual(['falta_llave', 'llave_de_otro'])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('el verificador no deja salir un código sin respaldo; a la segunda sale la respuesta fija', async () => {
    const modelo = modeloGuionado([
      { name: 'responder', args: { tema: 'viaje', texto: 'Ya cargué todo en M1 26 9.' } },
      { name: 'responder', args: { tema: 'viaje', texto: 'Listo, quedó en M1 26 9.' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    const r = await e.escribe('¿ya quedó?')
    expect(r[0].texto).toBe('No pude revisarlo ahora. Si es una decisión, toca una opción; si no, escríbemelo de nuevo en un rato.')
    const t = e.trazas().find((x) => x.tipo === 'modelo')!
    expect(t.verificador).toHaveLength(2)
    expect(t.verificador![0].motivo).toContain('M1 26 9')
    // El segundo intento recibió el motivo.
    const devuelto = JSON.stringify(modelo.pedidos[1].mensajes.at(-1))
    expect(devuelto).toContain('No se envió porque')
  })

  it('tema fuera: el texto lo reemplaza la respuesta fija', async () => {
    const modelo = modeloGuionado([{ name: 'responder', args: { tema: 'fuera', texto: 'Para instalar Anaconda descarga el instalador…' } }])
    const e = await escenario({ modelo })
    const r = await e.escribe('¿cómo instalo Anaconda para Python?')
    expect(r[0].texto).toMatch(/^Eso no lo manejo\./)
  })

  it('tope de llamados: el último llamado solo permite cerrar con responder o proponer (no con un cierre del dominio)', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'a' } },
      { name: 'buscar', args: { texto: 'b' } },
      (p: PedidoModelo) => ({ name: 'responder', args: { tema: 'saludo', texto: `permitidas: ${p.permitidas.join(',')}` } }),
    ])
    const e = await escenario({ modelo })
    const r = await e.escribe('hola')
    expect(r[0].texto).toBe('permitidas: responder,proponer')
  })

  it('el modelo caído: respuesta fija con la propuesta vigente si la hay', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: ref } } },
      { falla: 'http 503' },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.escribe('viaje nuevo para Martín Mora')
    const r = await e.escribe('mmm espera, ¿cuántos viajes tiene?')
    expect(r[0].tipo).toBe('botones')
    expect(r[0].texto).toMatch(/^No pude revisarlo ahora/)
  })
})

describe('elegir escribiendo una opción que el bot mostró', () => {
  it('«1» o «el de san andrés» nombran ese viaje; una palabra que comparten dos opciones, no', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿De qué viaje es?', opciones: [{ titulo: 'M1 26 1 · San Andrés' }, { titulo: 'M1 26 2 · Cartagena' }, { titulo: 'Viaje nuevo' }] } },
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 1' } } },
    ])
    const viajes = [{ ...VIAJES[0], nombre: 'SAN ANDRÉS' }, { ...VIAJES[1], nombre: 'CARTAGENA' }]
    const e = await escenario({ modelo, contactos: [MARTIN], viajes })
    await e.reenvia('queremos ir en diciembre')
    await e.escribe('listo')
    const r = await e.escribe('el de san andrés')
    expect(r[0].texto).toContain('¿Cargo esto en M1 26 1')
  })
  it('con un número fuera de rango, el candado ataja', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿De qué viaje es?', opciones: [{ titulo: 'M1 26 1 · San Andrés' }, { titulo: 'M1 26 2 · Cartagena' }] } },
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿Cuál?' } },
    ])
    const viajes = [{ ...VIAJES[0], nombre: 'SAN ANDRÉS' }, { ...VIAJES[1], nombre: 'CARTAGENA' }]
    const e = await escenario({ modelo, contactos: [MARTIN], viajes })
    await e.reenvia('queremos ir en diciembre')
    await e.escribe('listo')
    await e.escribe('5')
    expect(e.trazas().flatMap((t) => t.candados ?? []).map((c) => c.candado)).toEqual(['viaje_nombrado'])
  })
})

describe('el arnés toca la opción exacta', () => {
  it('«No» toca [No], no [Anotar] (que contiene «no»)', async () => {
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: 'M1 26 2', texto: 'van 2 adultos' } } }])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.escribe('en el M1 26 2 van 2 adultos')
    const r = await e.toca('No')
    expect(r[0].texto).toBe('Listo, no hice nada.')
    expect(e.puerto.escrituras).toEqual([])
  })
})

describe('la cola', () => {
  it('lo que llega mientras otro proceso tiene el candado lo atiende ese proceso al soltar', async () => {
    const modelo = modeloGuionado([
      { name: 'responder', args: { tema: 'saludo', texto: 'Hola, ¿en qué te ayudo?' } },
      { name: 'responder', args: { tema: 'saludo', texto: 'Dale.' } },
    ])
    const e = await escenario({ modelo })
    // Un segundo proceso que llega con el candado tomado: sale sin hacer nada.
    await e.almacen.tomarCandado(`agente:cola:${e.deps.workspaceId}:${TEL_PRUEBA}`, 60)
    const nada = await e.escribe('hola')
    expect(nada).toEqual([])
    await e.almacen.soltarCandado(`agente:cola:${e.deps.workspaceId}:${TEL_PRUEBA}`)
    // El siguiente mensaje encuentra los dos pendientes y los atiende en orden, en UN turno.
    const r = await e.escribe('¿estás?')
    expect(r).toEqual([{ tipo: 'texto', texto: 'Hola, ¿en qué te ayudo?' }])
    expect(e.almacen.filas.filter((f) => f.direccion === 'entrante').every((f) => f.turno_id)).toBe(true)
  })

  it('la traza mide el turno desde que llegó el mensaje y guarda los tokens por llamado', async () => {
    const modelo = modeloGuionado([{ name: 'responder', args: { tema: 'saludo', texto: 'Hola.' } }])
    const e = await escenario({ modelo })
    await e.escribe('hola')
    const t = e.trazas()[0]
    expect(t.tipo).toBe('modelo')
    expect(t.llamados).toBe(1)
    expect(t.uso).toEqual([expect.objectContaining({ entrada: 1000, salida: 50, razonamiento: 100 })])
    expect(t.ms_turno).toBeGreaterThanOrEqual(0)
    expect(t.reglamento?.huella).toMatch(/^[0-9a-f]{64}$/)
  })
})
