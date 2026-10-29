import { describe, expect, it } from 'vitest'
import { escenarioOne } from './escenario'
import { modeloGuionado } from '../modelo-guionado'
import { DIAS_ATRAS_GASTO, fechaConDia, fechaDelGasto, fotoDe, gastoParecido, gastosDeLaConversacion, nombreNegocio, permisosDe, telefonoEnLaConversacion } from './dominio'
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
    expect(t3[0].texto).toContain('📎 Si tienes el soporte, mándamelo: foto o PDF.')
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
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 18900, negocio: 'A1 26 1', categoria: 'transporte', descripcion: 'peaje', soporte: '#1' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t = await e.foto('peaje 18900 al A1 26 1')
    expect(t[0].texto).toContain('📷 Con la foto #1 como soporte')
    expect(t[0].texto).toContain('📁 A1 26 1 · Alfa Grupo — Concesión de prueba')
    const hecho = await e.toca('Registrar')
    expect(hecho[0].texto).toContain('📎 Con su soporte.')
    expect(e.puerto.escrituras[0]).toMatchObject({ tipo: 'gasto', monto: 18900, negocio: 'A1 26 1', soporte: true })
  })

  it('la foto que llega después se adjunta al gasto de la conversación (G1), con su toque', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 30000, negocio: 'A1 26 1', categoria: 'otros' } } },
      (p) => {
        expect(p.mensajes[0].parts[0].text).toContain('G1 · gasto de $30.000 · A1 26 1 · Alfa Grupo — Concesión de prueba · sin soporte')
        expect(p.mensajes[0].parts[0].text).toContain('todavía no son soporte de ningún gasto: #5 (foto')
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
    expect(fotoDe(filas, '#2')).toEqual({ error: 'El #2 ya es el soporte de otro gasto. Pregunta si hay otro soporte.' })
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

  it('un texto largo escrito por el modelo va en varios comentarios, sin prometer que es «completo»', async () => {
    const largo = Array.from({ length: 40 }, (_, i) => `En el evento, punto ${i + 1}: la cocina trabaja con siete personas de planta.`).join(' ')
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'actividad', datos: { negocio: 'A1 26 1', tipo: 'reunion', texto: largo } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t = await e.escribe(largo)
    expect(t[0].texto).toMatch(/Es largo: va en \d+ comentarios seguidos\.\n¿La registro\?$/)
    expect(t[0].texto).not.toMatch(/complet/i)
    const fin = await e.toca('Registrar')
    expect(fin.map((s) => s.texto).join('\n')).toMatch(/✅ 🤝 Actividad registrada en A1 26 1 · Alfa Grupo — Concesión de prueba, en \d+ comentarios seguidos\./)
    expect(e.puerto.escrituras).toEqual([{ tipo: 'actividad', negocio: 'A1 26 1', actividad: 'reunion', texto: largo }])
  })

  it('una nota de voz se guarda tal cual: el resumen del modelo va arriba, nunca en lugar de la nota', async () => {
    // El caso del 2026-10-26: 4.459 caracteres dictados; el modelo veía solo los primeros 1.200 y guardó su resumen de
    // unos 650, diciendo «Esta versión tiene el mensaje completo».
    const dictado = Array.from({ length: 60 }, (_, i) => `En el evento, punto ${i + 1}: la cocina trabaja con siete personas de planta.`).join(' ')
    const resumen = 'Evento del viernes: cocina con siete personas de planta.'
    const modelo = modeloGuionado([
      // Sin `nota`: el código no deja guardar el resumen en lugar de lo dictado.
      { name: 'proponer', args: { accion: 'actividad', datos: { negocio: 'A1 26 1', tipo: 'reunion', texto: resumen } } },
      { name: 'proponer', args: { accion: 'actividad', texto: 'Esta versión tiene el mensaje completo.', datos: { negocio: 'A1 26 1', tipo: 'reunion', texto: resumen, nota: '#1' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t = await e.dicta(dictado)
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['nota_de_voz_sin_referencia'])
    expect(t[0].texto).toContain('Esta versión tiene el mensaje completo.')
    expect(t[0].texto).toMatch(/📝 Tu nota de voz #1 va tal cual, entero, en \d+ comentarios seguidos\.\n¿La registro\?$/)
    const fin = await e.toca('Registrar')
    expect(fin.map((s) => s.texto).join('\n')).toMatch(/✅ 🤝 Actividad registrada en A1 26 1 · Alfa Grupo — Concesión de prueba, con tu nota #1 tal cual en \d+ comentarios seguidos\./)
    expect(e.puerto.escrituras).toEqual([{ tipo: 'actividad', negocio: 'A1 26 1', actividad: 'reunion', texto: `Resumen: ${resumen}\n\nNota tal cual: ${dictado}` }])
    expect(modelo.restantes()).toBe(0)
  })

  it('sin la nota, el bot no dice que guarda el mensaje completo', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'actividad', texto: 'Esta versión tiene el mensaje completo.', datos: { negocio: 'A1 26 1', tipo: 'llamada', texto: 'Llamé a Alfa por el cobro.' } } },
      { name: 'proponer', args: { accion: 'actividad', datos: { negocio: 'A1 26 1', tipo: 'llamada', texto: 'Llamé a Alfa por el cobro.' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t = await e.escribe('anota en el A1 26 1 que llamé a Alfa para revisar el cobro, que quedó de pagar el viernes')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['texto_contra_propuesta'])
    expect(t[0].texto).not.toMatch(/complet/i)
    expect(t[0].texto).toContain('«Llamé a Alfa por el cobro.»')
    expect(modelo.restantes()).toBe(0)
  })

  it('`nota` solo apunta a un audio o un escrito de la persona', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'actividad', datos: { negocio: 'A1 26 1', tipo: 'nota', texto: 'x', nota: '#9' } } },
      { name: 'responder', args: { tema: 'actividad', texto: '¿Qué nota registro?' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('registra la nota')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['nota_no_es_de_la_persona'])
    expect(e.puerto.escrituras).toEqual([])
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
    // Desde el componedor (2026-10-26) el operador ni siquiera ve `contacto_nuevo`: si el modelo lo intenta igual, el
    // núcleo lo ataja como acción desconocida, antes del motor.
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, rol: 'operator' })
    await e.escribe('nuevo contacto Juan Prueba')
    expect(e.trazas().at(-1)!.candados![0].candado).toBe('accion_desconocida')
    expect(e.composicion!.declaradas.acciones).toEqual(['gasto', 'adjuntar_soporte', 'corregir_gasto', 'actividad'])
  })

  it('el motor sin componer sigue frenando por rol (la tercera llave)', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'contacto_nuevo', datos: { nombre: 'Juan Prueba' } } },
      { name: 'responder', args: { tema: 'contacto', texto: 'Tu rol no permite crear contactos por aquí.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, rol: 'operator', sinComponer: true })
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
    expect(decl.map((d) => d.name)).toEqual(['buscar_negocios', 'negocios_abiertos', 'ver_negocio', 'gastos_recientes', 'preguntar_destino', 'proponer', 'responder'])
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

describe('una propuesta vence cuando el bot manda otro mensaje (arnés 2026-10-21, t-mantenimiento)', () => {
  it('el «Registrar» de una propuesta vieja no escribe si el bot ya volvió a preguntar', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 47600, negocio: 'A1 26 1', categoria: 'otros' } } },
      { name: 'negocios_abiertos', args: {} },
      { name: 'responder', args: { tema: 'gasto', texto: '¿A cuál va?', opciones: [{ titulo: 'A1 26 1' }, { titulo: 'V1 26 5' }] } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('47.600')
    await e.escribe('1')
    const t = await e.toca('Registrar')
    expect(t[0].texto).toBe('Ese botón ya no está vigente: no hice nada.')
    expect(e.puerto.escrituras).toEqual([])
  })

  it('reenviar la MISMA propuesta (propuesta_repetida) no la vence', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 47600, negocio: 'A1 26 1', categoria: 'otros' } } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 47600, negocio: 'A1 26 1', categoria: 'otros' }, texto: 'Sí, es el de Alfa.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('47600 al A1 26 1')
    await e.escribe('¿ese es el de Alfa?')
    await e.toca('Registrar')
    expect(e.puerto.escrituras).toHaveLength(1)
  })

  it('el Estado lleva la última lista con su orden', async () => {
    const modelo = modeloGuionado([
      { name: 'negocios_abiertos', args: {} },
      { name: 'responder', args: { tema: 'gasto', texto: '¿A cuál va?', opciones: [{ titulo: 'A1 26 1', descripcion: 'Alfa' }, { titulo: 'V1 26 5' }] } },
      (p) => {
        expect(p.mensajes[0].parts[0].text).toContain('Última lista que mostraste (#2, 1 mensaje(s) de la persona después): 1) A1 26 1; 2) V1 26 5.')
        return { name: 'responder', args: { tema: 'gasto', texto: 'Listo.' } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('gasto de 5000')
    await e.escribe('1')
    expect(modelo.restantes()).toBe(0)
  })
})

describe('preguntar_destino: la lista la arma el código', () => {
  it('negocios en orden con código · empresa — nombre, y «Gasto de empresa» al final; un «1» es el primer negocio', async () => {
    const modelo = modeloGuionado([
      { name: 'preguntar_destino', args: { para: 'gasto', texto: '¿A cuál negocio va el gasto de $47.600?' } },
      (p) => {
        expect(p.mensajes[0].parts[0].text).toContain('1) V1 26 5 — Vértice Impermeables — Flujo corto')
        expect(p.mensajes[0].parts[0].text).toContain('4) Gasto de empresa.')
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 47600, negocio: 'V1 26 5', categoria: 'otros' } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t = await e.escribe('47.600')
    expect(t[0].tipo).toBe('lista')
    expect('opciones' in t[0] && t[0].opciones.map((o) => o.titulo)).toEqual(['V1 26 5', 'A1 26 1', 'V1 26 6', 'Gasto de empresa'])
    await e.escribe('1')
    await e.toca('Registrar')
    expect(e.puerto.escrituras[0]).toMatchObject({ monto: 47600, negocio: 'V1 26 5' })
  })

  it('para una actividad no ofrece «Gasto de empresa»; con pocos negocios el detalle va en el cuerpo', async () => {
    const modelo = modeloGuionado([{ name: 'preguntar_destino', args: { para: 'actividad', texto: '¿En cuál negocio?' } }])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS.slice(0, 2) })
    const t = await e.escribe('llamé al cliente')
    expect(t[0].tipo).toBe('botones')
    expect(t[0].texto).toBe('¿En cuál negocio?\n• V1 26 5 · Vértice Impermeables — Flujo corto — de la obra vendida a la utilidad de cada obra\n• A1 26 1 · Alfa Grupo — Concesión de prueba')
    expect('opciones' in t[0] && t[0].opciones.map((o) => o.titulo)).toEqual(['V1 26 5', 'A1 26 1'])
  })
})

describe('gasto de empresa solo si la persona lo dijo o lo eligió', () => {
  it('sin #n de la persona, o apuntando al bot, no hay propuesta; con el toque de «Gasto de empresa», sí', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 20000, empresa: true, categoria: 'alimentacion' } } },
      { name: 'preguntar_destino', args: { para: 'gasto', texto: '¿A cuál negocio va?' } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 20000, empresa: true, empresa_dicho_en: '#2', categoria: 'alimentacion' } } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 20000, empresa: true, empresa_dicho_en: '#3', categoria: 'alimentacion' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('Bebidas de 20000')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['empresa_sin_respaldo'])
    await e.toca('Gasto de empresa')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['empresa_sin_respaldo'])
    await e.toca('Registrar')
    expect(e.puerto.escrituras[0]).toMatchObject({ monto: 20000, negocio: null })
  })

  it('dos llamadas que cierran en el mismo mensaje: las dos reciben respuesta (Claude exige un tool_result por tool_use)', async () => {
    const modelo = modeloGuionado([
      { varias: [
        { name: 'proponer', args: { accion: 'gasto', datos: { monto: 1000, categoria: 'otros' } } },
        { name: 'responder', args: { tema: 'gasto', texto: '¿A cuál?' } },
      ] },
      (p) => {
        const partes = p.mensajes.at(-1)!.parts
        expect(partes.map((x) => x.functionResponse?.name)).toEqual(['proponer', 'responder'])
        return { name: 'responder', args: { tema: 'gasto', texto: '¿A cuál negocio va?' } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('gasté 1000')
    expect(modelo.restantes()).toBe(0)
  })
})

describe('r-t-gasolina (arnés real 2026-10-22): una lista del destino ya contestada no respalda un gasto de empresa', () => {
  const pasosHastaElSegundoGasto = [
    { name: 'responder', args: { tema: 'gasto', texto: '¿De cuánto fue el gasto?' } },
    { name: 'preguntar_destino', args: { para: 'gasto', texto: '¿A cuál negocio va el gasto de $90.000 de gasolina?' } },
    { name: 'proponer', args: { accion: 'gasto', datos: { monto: 90000, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'gasolina' } } },
  ] as const

  it('«Gasto de 18900 sin mas…» dos gastos después de la lista no es «Gasto de empresa»: no hay propuesta', async () => {
    const modelo = modeloGuionado([
      ...pasosHastaElSegundoGasto,
      // Lo que hizo el modelo real: gasto de empresa apuntando al escrito del segundo gasto (#9).
      (p) => {
        expect(String(p.mensajes[0].parts[0].text)).toContain('#9 [escrito de Ana Dueña] "Gasto de 18900 sin mas, por ahora no tengo la foto del soporte, te la mando despues"')
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 18900, empresa: true, empresa_dicho_en: '9', categoria: 'otros' } } }
      },
      { name: 'preguntar_destino', args: { para: 'gasto', texto: '¿A cuál negocio va el gasto de $18.900?' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('Gasto')
    await e.escribe('90000 gasolina')
    await e.elige(1)
    await e.toca('Registrar')
    expect(e.puerto.escrituras).toHaveLength(1)
    const t = await e.escribe('Gasto de 18900 sin mas, por ahora no tengo la foto del soporte, te la mando despues')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['empresa_sin_respaldo'])
    expect(t[0].texto).not.toContain('Gasto de empresa (sin negocio)')
    expect(t[0].texto).toContain('¿A cuál negocio va el gasto de $18.900?')
    expect(e.puerto.escrituras).toHaveLength(1)
    expect(modelo.restantes()).toBe(0)
  })

  it('el escrito que SÍ contesta la lista abierta (el primer mensaje después de ella) sigue valiendo', async () => {
    const modelo = modeloGuionado([
      { name: 'preguntar_destino', args: { para: 'gasto', texto: '¿A cuál negocio va?' } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 20000, empresa: true, empresa_dicho_en: '#3', categoria: 'alimentacion' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('Bebidas de 20000')
    const t = await e.escribe('a ninguno, es de la empresa')
    expect(t[0].texto).toContain('🏢 Gasto de empresa (sin negocio)')
  })
})

describe('Resend (caso real 2026-10-26): la respuesta a la lista vale por lo que dice, no por ser la primera', () => {
  it('«se realizó ayer» no es «Gasto de empresa»; «sería un gasto de empresa» después sí, sin volver a mostrar la lista', async () => {
    const modelo = modeloGuionado([
      { name: 'preguntar_destino', args: { para: 'gasto', texto: '¿A cuál negocio va el gasto de $65.000?' } },
      // Lo que hizo el modelo real: apuntó `empresa_dicho_en` al mensaje de la fecha.
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 65000, empresa: true, empresa_dicho_en: '#3', categoria: 'software', descripcion: 'suscripción a Resend' } } },
      { name: 'responder', args: { tema: 'gasto', texto: 'Anoto la fecha de ayer. ¿A cuál negocio va?' } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 65000, empresa: true, empresa_dicho_en: '#5', categoria: 'software', descripcion: 'suscripción a Resend' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('Registra la suscripción a Resend por 65.000')
    let t = await e.escribe('se realizó el día de ayer')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['empresa_sin_respaldo'])
    expect(t[0].texto).not.toContain('Gasto de empresa (sin negocio)')
    t = await e.escribe('sería un gasto de empresa')
    expect(t[0].texto).toContain('🏢 Gasto de empresa (sin negocio)')
    await e.toca('Registrar')
    expect(e.puerto.escrituras[0]).toMatchObject({ monto: 65000, negocio: null })
    expect(modelo.restantes()).toBe(0)
  })

  it('el número de la opción «Gasto de empresa» escrito como respuesta también vale', async () => {
    const modelo = modeloGuionado([
      { name: 'preguntar_destino', args: { para: 'gasto', texto: '¿A cuál negocio va?' } },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 20000, empresa: true, empresa_dicho_en: '#3', categoria: 'alimentacion' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const l = await e.escribe('Bebidas de 20000')
    const k = ('opciones' in l[0] ? l[0].opciones : []).findIndex((o) => o.titulo === 'Gasto de empresa')
    const t = await e.escribe(String(k + 1))
    expect(t[0].texto).toContain('🏢 Gasto de empresa (sin negocio)')
  })
})

describe('«de empresa» dicho antes de la lista del destino', () => {
  it('no basta: primero preguntar_destino y la persona toca la opción', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 50000, empresa: true, empresa_dicho_en: '#1', categoria: 'otros' } } },
      { name: 'responder', args: { tema: 'gasto', texto: '¿A cuál negocio va?' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('50 mil en papelería, gasto de empresa')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['empresa_sin_respaldo'])
    expect(e.puerto.escrituras).toEqual([])
  })
})

describe('gasto que parece repetido (caso real 2026-10-28: «Resend» de $65.000 quedó el 25 y el 28 de octubre)', () => {
  // El reloj del escenario: miércoles 21-oct-2026.
  const yaRegistrado = { id: 'g-1', fecha: '2026-10-18', monto: 65000, categoria: 'software', descripcion: 'suscripción a Resend', negocio: 'V1 26 5', negocioId: 'n-v', soporte: false }
  const propone = (negocio: string, monto = 65000) => modeloGuionado([
    { name: 'proponer', args: { accion: 'gasto', datos: { monto, negocio, categoria: 'software', descripcion: 'Resend' } } },
  ])

  it('mismo monto, mismo negocio y a 3 días: la propuesta lo avisa, sin bloquear', async () => {
    const e = await escenarioOne({ modelo: propone('V1 26 5'), negocios: NEGOCIOS, gastos: [{ ...yaRegistrado }] })
    const t = await e.escribe('65 mil de Resend para V1 26 5')
    expect(t[0].texto).toContain('⚠️ Ya hay uno parecido: $65.000 el domingo 18-oct («suscripción a Resend»). Si es el mismo, toca No.')
    await e.toca('Registrar')
    expect(e.puerto.escrituras).toHaveLength(1)
  })

  it('un gasto de empresa no se cruza con el de un negocio (la consulta de empresa trae todos)', () => {
    const g = { id: 'g-1', fecha: '2026-10-25', monto: 65000, categoria: 'software', descripcion: 'Resend', negocio: 'V1 26 5', soporte: false }
    expect(gastoParecido([g], { monto: 65000, negocio: null, fecha: '2026-10-28' })).toBeNull()
    expect(gastoParecido([{ ...g, negocio: null }], { monto: 65000, negocio: null, fecha: '2026-10-28' })).toMatchObject({ id: 'g-1' })
    expect(gastoParecido([{ ...g, negocio: null }], { monto: 65000.5, negocio: null, fecha: '2026-11-04' })).toMatchObject({ id: 'g-1' })
    expect(gastoParecido([{ ...g, negocio: null }], { monto: 65000, negocio: null, fecha: '2026-11-05' })).toBeNull()
  })

  it('otro negocio, otro monto o más de 10 días: sin aviso', async () => {
    for (const [negocio, monto, fecha] of [['V1 26 6', 65000, '2026-10-18'], ['V1 26 5', 66000, '2026-10-18'], ['V1 26 5', 65000, '2026-10-05']] as const) {
      const e = await escenarioOne({ modelo: propone(negocio, monto), negocios: NEGOCIOS, gastos: [{ ...yaRegistrado, fecha }] })
      const t = await e.escribe('gasto de Resend')
      expect(t[0].texto).toContain('¿Lo registro?')
      expect(t[0].texto).not.toContain('⚠️ Ya hay uno parecido')
    }
  })
})

describe('la fecha del gasto (caso real 2026-10-26: «el miércoles de la semana pasada» quedó con la fecha de hoy)', () => {
  // El reloj del escenario: miércoles 21-oct-2026, 10:00 en Bogotá.
  it('«el miércoles de la semana pasada»: la fecha que deduce el modelo se ve en el resumen y va al gasto', async () => {
    const modelo = modeloGuionado([
      (p) => {
        const props = (p.herramientas.find((d) => d.name === 'proponer')!.parameters as { properties: { datos: { properties: Record<string, unknown> } } }).properties.datos.properties
        expect(props.fecha).toBeDefined()
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 21000, negocio: 'A1 26 1', categoria: 'otros', fecha: '2026-10-14' } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t1 = await e.escribe('Un gasto de 21.000 al A1 26 1, se ejecutó el miércoles de la semana pasada')
    expect(t1[0].texto).toContain('📅 miércoles 14-oct')
    expect(t1[0].texto).not.toContain('Hoy')
    await e.toca('Registrar')
    expect(e.puerto.gastos.at(-1)!.fecha).toBe('2026-10-14')
  })

  it('sin fecha dicha: hoy en Bogotá, y el resumen lo dice', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 5000, negocio: 'A1 26 1', categoria: 'otros' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    const t1 = await e.escribe('5000 al A1 26 1')
    expect(t1[0].texto).toContain('📅 Hoy, miércoles 21-oct')
    await e.toca('Registrar')
    expect(e.puerto.gastos.at(-1)!.fecha).toBe('2026-10-21')
  })

  it('una fecha futura no se propone: vuelve al modelo con el error', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 5000, negocio: 'A1 26 1', categoria: 'otros', fecha: '2026-10-22' } } },
      (p) => {
        const r = p.mensajes.at(-1)!.parts[0].functionResponse!.response as { error: string }
        expect(r.error).toContain('es futura')
        return { name: 'responder', args: { tema: 'gasto', texto: '¿Qué día fue el gasto?' } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('5000 al A1 26 1, mañana')
    expect(e.puerto.escrituras).toEqual([])
    expect(e.trazas().at(-1)!.candados![0].candado).toBe('fecha')
  })

  it('fechaDelGasto: el caso real con el reloj del 26-oct, los topes y lo que no es fecha', () => {
    const ahora = Date.parse('2026-10-26T19:42:00Z') // lunes 26-oct-2026, 14:42 en Bogotá
    expect(fechaDelGasto('2026-10-21', ahora)).toEqual({ fecha: '2026-10-21' })
    expect(fechaConDia('2026-10-21')).toBe('miércoles 21-oct')
    expect(fechaDelGasto('', ahora)).toEqual({ fecha: '2026-10-26' })
    expect(fechaDelGasto(undefined, ahora)).toEqual({ fecha: '2026-10-26' })
    // A las 9 p. m. de Bogotá ya es mañana en UTC: hoy sigue siendo el de Bogotá.
    expect(fechaDelGasto(null, Date.parse('2026-10-27T02:00:00Z'))).toEqual({ fecha: '2026-10-26' })
    expect(fechaDelGasto('2026-10-27', ahora)).toHaveProperty('error')
    expect(fechaDelGasto(`2026-07-28`, ahora)).toEqual({ fecha: '2026-07-28' }) // justo 90 días
    expect(fechaDelGasto('2026-07-27', ahora)).toHaveProperty('error')
    expect(fechaDelGasto('2025-10-21', ahora)).toHaveProperty('error') // el año mal deducido
    expect(fechaDelGasto('2026-02-30', ahora)).toHaveProperty('error')
    expect(fechaDelGasto('21/10/2026', ahora)).toHaveProperty('error')
    expect(DIAS_ATRAS_GASTO).toBe(90)
  })
})
