import { describe, expect, it } from 'vitest'
import { escenarioOne } from './escenario'
import { modeloGuionado } from '../modelo-guionado'
import { fotoDe, gastosDeLaConversacion, nombreNegocio, permisosDe, telefonoEnLaConversacion } from './dominio'
import { agenteOnePorDefecto, CORTE_ONE_MS, dominioDelAgente, leerConfigOne } from '../config'
import { declaraciones } from '../herramientas'
import { dominioOne } from './dominio'
import { PuertoOneMemoria } from './puerto-memoria'
import { reglamentoOne } from './reglamento'
import type { FilaConversacion } from '../tipos'

/**
 * El dominio ONE de punta a punta con un modelo guionado y la base en memoria. Datos inventados: «Vértice Impermeables»
 * hace las veces de la empresa del caso real del 2026-10-20 («al proyecto impervium», que el bot de siempre registró
 * solo y sin decir el código).
 */

const NEGOCIOS = [
  { id: 'n-v', codigo: 'V1 26 5', nombre: 'Flujo corto — de la obra vendida a la utilidad de cada obra', empresa: 'Vértice Impermeables', contacto: 'Lina Prueba', etapa: 'venta', valor: 5_000_000 },
  { id: 'n-a', codigo: 'A1 26 1', nombre: 'Concesión de prueba', empresa: 'Alfa Grupo', contacto: null, etapa: 'cobro', valor: 1_000_000 },
  { id: 'n-v2', codigo: 'V1 26 6', nombre: 'Segunda obra', empresa: 'Vértice Impermeables', contacto: 'Lina Prueba', etapa: 'ejecucion', valor: null },
]

describe('gasto a un negocio por la empresa (el caso «al proyecto impervium»)', () => {
  it('busca, propone con código · empresa — nombre y solo escribe con el toque', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar_negocios', args: { texto: 'vértice' } },
      // Dos negocios de esa empresa: pregunta cuál, sin suponer.
      { name: 'responder', args: { tema: 'gasto', texto: '¿A cuál de los dos de Vértice Impermeables?', opciones: [{ titulo: 'V1 26 5', descripcion: 'Flujo corto' }, { titulo: 'V1 26 6', descripcion: 'Segunda obra' }] } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'transportes' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t1 = await e.escribe('Registra un gasto de 27000 por transportes al proyecto vértice')
    expect(t1[0].tipo).toBe('botones')
    expect(e.puerto.escrituras).toEqual([])

    const t2 = await e.elige(1)
    expect(t2.como).toBe('[toque: V1 26 5]')
    const resumen = t2.salidas[0]
    expect(resumen.tipo).toBe('botones')
    expect(resumen.texto).toContain('💰 Gasto de $27.000 · Transporte y movilidad')
    expect(resumen.texto).toContain('📁 V1 26 5 · Vértice Impermeables — Flujo corto — de la obra vendida a la utilidad de cada obra')
    expect(resumen.texto).toContain('¿Lo registro?')
    expect('opciones' in resumen && resumen.opciones.map((o) => o.titulo)).toEqual(['Registrar', 'No'])
    expect(e.puerto.escrituras).toEqual([])

    const t3 = await e.toca('Registrar')
    expect(t3[0].texto).toContain('✅ Gasto de $27.000 registrado · V1 26 5 · Vértice Impermeables — Flujo corto')
    expect(t3[0].texto).toContain('mándamela')
    expect(e.puerto.escrituras).toEqual([{ tipo: 'gasto', id: 'gasto-1', monto: 27000, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'transportes', soporte: false, centro: 'directa_negocio' }])
    expect(modelo.restantes()).toBe(0)
  })

  it('un «sí» escrito solo registra la propuesta pendiente (como el «Si» de termotech)', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 47600, negocio: 'A1 26 1', categoria: 'otros' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('47.600 al A1 26 1')
    await e.escribe('Si')
    expect(e.puerto.escrituras).toHaveLength(1)
    expect(modelo.pedidos).toHaveLength(1)
  })
})

describe('los candados del gasto', () => {
  it('un código que no existe no se propone: vuelve al modelo con el error', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 1000, negocio: 'X9 26 9', categoria: 'otros' } } },
      (p) => {
        const r = p.mensajes.at(-1)!.parts[0].functionResponse!.response as { error: string }
        expect(r.error).toContain('No hay un negocio abierto con código «X9 26 9»')
        return { name: 'responder', args: { tema: 'gasto', texto: 'No encuentro ese negocio. ¿Cuál es?' } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('gasto de 1000 al X9 26 9')
    expect(e.puerto.escrituras).toEqual([])
    expect(e.trazas().at(-1)!.candados![0].candado).toBe('negocio_inexistente')
  })

  it('sin destino, o con los dos destinos, no hay propuesta', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 1000, categoria: 'otros' } } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 1000, categoria: 'otros', negocio: 'A1 26 1', empresa: true } } },
      { name: 'responder', args: { tema: 'gasto', texto: '¿A qué negocio va?' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('gasté 1000')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['sin_destino', 'destino_doble'])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('monto que no es número, o categoría inventada, vuelven al modelo', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: '47.600', empresa: true, categoria: 'otros' } } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 47600, empresa: true, categoria: 'tintos' } } },
      { name: 'responder', args: { tema: 'gasto', texto: '¿De cuánto fue?' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('gasto')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['monto', 'categoria'])
  })

  it('un viaje con servicios por pagar no recibe un gasto suelto', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 1000, negocio: 'A1 26 1', categoria: 'otros' } } },
      { name: 'responder', args: { tema: 'gasto', texto: 'Ese pago va en la app.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS.map((n) => (n.id === 'n-a' ? { ...n, viajeConServicios: true } : n)) })
    await e.escribe('pagué 1000 del A1 26 1')
    expect(e.trazas().at(-1)!.candados![0].candado).toBe('servicio_viaje')
  })
})

describe('el soporte del gasto', () => {
  it('la foto que llega con el pedido va en la propuesta y se guarda con el toque', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 18900, empresa: true, categoria: 'transporte', descripcion: 'peaje', soporte: '#1' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t = await e.foto('peaje 18900 de empresa')
    expect(t[0].texto).toContain('📷 Con la foto #1 como soporte')
    expect(t[0].texto).toContain('🏢 Gasto de empresa (sin negocio)')
    const hecho = await e.toca('Registrar')
    expect(hecho[0].texto).toContain('📷 Con su soporte.')
    expect(e.puerto.escrituras[0]).toMatchObject({ tipo: 'gasto', monto: 18900, negocio: null, soporte: true })
  })

  it('la foto que llega después se adjunta al gasto de la conversación (G1), con su toque', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 30000, negocio: 'A1 26 1', categoria: 'otros' } } },
      (p) => {
        expect(p.mensajes[0].parts[0].text).toContain('G1 · $30.000 · A1 26 1 · Alfa Grupo — Concesión de prueba · sin soporte')
        return { name: 'proponer', args: { accion: 'adjuntar_soporte', datos: { gasto: 'G1', soporte: '#5' } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('30 mil al A1 26 1')
    await e.toca('Registrar')
    const t = await e.foto()
    expect(t[0].texto).toBe('📷 La foto #5 como soporte del gasto de $30.000 · A1 26 1 · Alfa Grupo — Concesión de prueba\n¿La adjunto?')
    await e.toca('Adjuntar')
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['gasto', 'soporte'])
    expect(gastosDeLaConversacion(e.almacen.filas)[0].soporte).toBe(true)
  })

  it('si Meta no deja bajar la foto, no se escribe nada y se dice', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 30000, negocio: 'A1 26 1', categoria: 'otros' } } },
      { name: 'proponer', args: { accion: 'adjuntar_soporte', datos: { gasto: 'G1', soporte: '#5' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    e.puerto.mediaRota.add('media-1')
    await e.escribe('30 mil al A1 26 1')
    await e.toca('Registrar')
    await e.foto()
    const t = await e.toca('Adjuntar')
    expect(t[0].texto).toContain('No pude hacerlo ahora')
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['gasto'])
  })

  it('el #n tiene que ser una foto de esta conversación, y no una ya usada', () => {
    const fila = (id: string, extra: Partial<FilaConversacion>): FilaConversacion => ({ id, workspace_id: 'w', phone: 'p', direccion: 'entrante', clase: 'escrito', texto: null, created_at: '2026-10-21T15:00:00Z', ...extra })
    const filas = [
      fila('a', { texto: 'hola' }),
      fila('b', { clase: 'imagen', media: { tipo: 'imagen', id: 'm1' } }),
      fila('c', { clase: 'toque', traza: { tipo: 'toque_propuesta', bot: 'one', ejecucion: { huella: 'h', resultado: 'ejecutada', escrituras: [{ tipo: 'gasto', id: 'g', monto: 1, foto: 'b' }] } } }),
      fila('d', { clase: 'imagen', media: { tipo: 'imagen', id: 'm2' } }),
    ]
    expect(fotoDe(filas, '#1')).toHaveProperty('error')
    expect(fotoDe(filas, '#2')).toEqual({ error: 'La foto #2 ya es el soporte de otro gasto. Pregunta si hay otra foto.' })
    expect(fotoDe(filas, 4)).toEqual({ fila: 'd', mediaId: 'm2' })
    expect(fotoDe(filas, '#9')).toHaveProperty('error')
  })
})

describe('actividad, contacto y consultas', () => {
  it('actividad en un negocio, con su tipo y su toque', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar_negocios', args: { texto: 'Alfa' } },
      { name: 'proponer', args: { accion: 'actividad', datos: { negocio: 'A1 26 1', tipo: 'llamada', texto: 'llamé a Alfa para revisar el cobro' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t = await e.escribe('llamé a Alfa para revisar el cobro')
    expect(t[0].texto).toBe('📞 Actividad en A1 26 1 · Alfa Grupo — Concesión de prueba:\n«llamé a Alfa para revisar el cobro»\n¿La registro?')
    await e.toca('Registrar')
    expect(e.puerto.escrituras).toEqual([{ tipo: 'actividad', negocio: 'A1 26 1', actividad: 'llamada', texto: 'llamé a Alfa para revisar el cobro' }])
  })

  it('contacto nuevo: el teléfono tiene que estar escrito y no ser de otro', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'contacto_nuevo', datos: { nombre: 'Juan Prueba', telefono: '3009998877' } } },
      { name: 'proponer', args: { accion: 'contacto_nuevo', datos: { nombre: 'Juan Prueba', telefono: '3001112233' } } },
      { name: 'responder', args: { tema: 'contacto', texto: 'Ese teléfono ya es de Pedro Prueba.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, contactos: [{ id: 'c1', nombre: 'Pedro Prueba', telefono: '3001112233' }] })
    await e.escribe('nuevo contacto Juan Prueba 300 111 2233')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['telefono_sin_respaldo', 'contacto_duplicado'])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('una consulta no escribe y respalda las cifras', async () => {
    const modelo = modeloGuionado([
      { name: 'negocios_abiertos', args: {} },
      { name: 'responder', args: { tema: 'negocios', texto: 'Tienes 3 negocios abiertos: V1 26 5, A1 26 1 y V1 26 6.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t = await e.escribe('qué negocios tengo')
    expect(t[0].texto).toContain('Tienes 3 negocios abiertos')
    expect(e.trazas().at(-1)!.verificador).toEqual([])
    expect(e.puerto.escrituras).toEqual([])
  })
})

describe('el rol manda (los permisos del bot de siempre)', () => {
  it('un operador registra gastos pero no crea contactos', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'contacto_nuevo', datos: { nombre: 'Juan Prueba' } } },
      { name: 'responder', args: { tema: 'contacto', texto: 'Tu rol no permite crear contactos por aquí.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, rol: 'operator' })
    await e.escribe('nuevo contacto Juan Prueba')
    expect(e.trazas().at(-1)!.candados![0].candado).toBe('rol')
  })

  it('un contador consulta pero no registra; solo lectura no ve negocios', async () => {
    expect(permisosDe('contador')).toMatchObject({ escribir: false, negocios: true, gastos: true })
    expect(permisosDe('read_only')).toMatchObject({ escribir: false, negocios: false, gastos: true })
    expect(permisosDe('operator')).toMatchObject({ escribir: true, contactos: false, plata: false })
    expect(permisosDe('raro')).toMatchObject({ escribir: false, negocios: false })
    const d = dominioOne(new PuertoOneMemoria({ negocios: NEGOCIOS }), { rol: 'read_only' })
    const r = await d.leer('buscar_negocios', { texto: 'alfa' }, { workspaceId: 'w', phone: 'p', remitente: { nombre: 'x', rol: 'read_only' }, conversacion: [], resultadosPrevios: [] })
    expect(r.ok).toBe(false)
  })

  it('un operador no ve el valor de los negocios', async () => {
    const d = dominioOne(new PuertoOneMemoria({ negocios: NEGOCIOS }), { rol: 'operator' })
    const r = await d.leer('negocios_abiertos', {}, { workspaceId: 'w', phone: 'p', remitente: { nombre: 'x', rol: 'operator' }, conversacion: [], resultadosPrevios: [] })
    expect(JSON.stringify(r.datos)).not.toContain('valor')
    const o = dominioOne(new PuertoOneMemoria({ negocios: NEGOCIOS }), { rol: 'owner' })
    const r2 = await o.leer('negocios_abiertos', {}, { workspaceId: 'w', phone: 'p', remitente: { nombre: 'x', rol: 'owner' }, conversacion: [], resultadosPrevios: [] })
    expect(JSON.stringify(r2.datos)).toContain('$5.000.000')
  })
})

describe('piezas puras', () => {
  it('nombreNegocio: código · empresa (o contacto) — nombre', () => {
    expect(nombreNegocio({ codigo: 'P 26 1', nombre: 'Casa', empresa: null, contacto: 'Pedro' })).toBe('P 26 1 · Pedro — Casa')
    expect(nombreNegocio({ codigo: 'P 26 1', nombre: 'Casa', empresa: null, contacto: null })).toBe('P 26 1 · sin empresa — Casa')
  })

  it('telefonoEnLaConversacion compara dígitos, no palabras', () => {
    const f = [{ id: 'a', workspace_id: 'w', phone: 'p', direccion: 'entrante', clase: 'escrito', texto: 'su cel es 300-111-2233', created_at: '' }] as FilaConversacion[]
    expect(telefonoEnLaConversacion(f, '+57 3001112233')).toBe(true)
    expect(telefonoEnLaConversacion(f, '3001112234')).toBe(false)
  })

  it('las declaraciones del dominio ONE pasan al núcleo con sus acciones', async () => {
    const r = await reglamentoOne('X')
    const decl = declaraciones(dominioOne(new PuertoOneMemoria(), { rol: 'owner' }), r)
    expect(decl.map((d) => d.name)).toEqual(['buscar_negocios', 'negocios_abiertos', 'ver_negocio', 'gastos_recientes', 'proponer', 'responder'])
    expect(JSON.stringify(decl.find((d) => d.name === 'responder'))).toContain('"ayuda"')
  })
})

describe('qué dominio atiende (el interruptor)', () => {
  it('sin configuración: ONE para todos', () => {
    expect(dominioDelAgente(null, '573001')).toBe('one')
    expect(dominioDelAgente({}, '573001')).toBe('one')
    expect(dominioDelAgente({ activo: true }, '573001')).toBe('one')
  })

  it('agente: true (Trappvel) sigue en la bandeja, solo para su lista; el resto por el camino de hoy', () => {
    const t = { agente: true, agente_telefonos: ['573209219444'] }
    expect(dominioDelAgente(t, '573209219444')).toBe('bandeja')
    expect(dominioDelAgente(t, '573000000000')).toBeNull()
    expect(dominioDelAgente({ agente: true }, '573000000000')).toBe('bandeja')
  })

  it('agente: false apaga el workspace; dominio explícito manda; la lista también aplica a ONE', () => {
    expect(dominioDelAgente({ agente: false }, '573001')).toBeNull()
    expect(dominioDelAgente({ agente: false, dominio: 'one' }, '573001')).toBeNull()
    expect(dominioDelAgente({ agente: true, dominio: 'one' }, '573001')).toBe('one')
    expect(dominioDelAgente({ agente_telefonos: ['573001234567'] }, '573001234567')).toBe('one')
    expect(dominioDelAgente({ agente_telefonos: ['573001234567'] }, '573009999999')).toBeNull()
  })

  it('AGENTE_ONE=off apaga el ONE por defecto, no el explícito ni la bandeja', () => {
    expect(agenteOnePorDefecto(undefined)).toBe(true)
    expect(agenteOnePorDefecto('off')).toBe(false)
    expect(dominioDelAgente(null, '573001', { porDefecto: false })).toBeNull()
    expect(dominioDelAgente({ dominio: 'one' }, '573001', { porDefecto: false })).toBe('one')
    expect(dominioDelAgente({ agente: true }, '573001', { porDefecto: false })).toBe('bandeja')
  })
})

describe('la configuración del dominio ONE', () => {
  it('corte de 5 s por defecto (Gemini solo de respaldo); el del workspace manda', () => {
    expect(leerConfigOne(null).corteMs).toBe(CORTE_ONE_MS)
    expect(leerConfigOne({ agente_config: { corte_ms: 3000 } }).corteMs).toBe(3000)
    expect(leerConfigOne(null).respaldo?.modelo).toBe('gemini-3.5-flash-lite')
  })
})
