import { describe, expect, it } from 'vitest'
import { escenario } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import { normalizarLecturaViaje, PROMPT_DOCUMENTO_VIAJE } from './bandeja/lectura-adjunto'
import { cuerpoLectura } from './one/lectura-adjunto'
import { PERFIL_DOCUMENTO_VIAJE } from './bandeja/lectura-adjunto'
import { adjuntosDe, MARCA_ARCHIVO, textoParaCarga } from './bandeja/carga'
import { instruccionesCarga, PARRAFO_DOCUMENTOS } from './bandeja/extraccion'
import { lineasAdjuntos } from './bandeja/dominio'
import { textoLectura } from './contexto'
import { leerConfigAgente } from './config'
import type { ArchivoAdjunto, Lector } from './one/lectura-adjunto'
import type { FilaConversacion, LecturaAdjunto, PedidoModelo } from './tipos'
import { solicitudViajeSintetica } from './arnes/soportes/pdf-minimo'

/**
 * La bandeja de Trappvel lee lo que el cliente manda en foto o PDF (2026-10-21, Mauricio: «llévalo a Trappvel», el
 * soporte del #1228). En la bandeja no se registran gastos: se cargan viajes. Lo leído entra a la carga como un mensaje
 * más del cliente (marcado como archivo), el comercial confirma con el toque de siempre y el archivo queda de soporte
 * en la actividad del viaje. Sin lector, la bandeja queda como antes. Datos inventados.
 */

const MARTIN = { id: 'c-martin', nombre: 'MARTIN MORA', celular: '3001237311' }
const VIAJE = { id: 'v-m1', codigo: 'M1 26 1', contactoId: 'c-martin', nombre: 'SAN ANDRÉS', destino: 'San Andrés', abierto: true, datos: {} }
const PDF: ArchivoAdjunto = { bytes: solicitudViajeSintetica(), mime: 'application/pdf' }
const FOTO: ArchivoAdjunto = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]), mime: 'image/jpeg' }
const LEIDO_PDF: LecturaAdjunto = {
  legible: true, clase: 'viaje', texto: 'San Andrés. Salida 2027-01-08 desde Medellín, regreso 2027-01-13. Viajeros: Laura (38), Andrés (40), Sofía (9), Tomás (1). Hotel 4 estrellas todo incluido. Presupuesto hasta COP 9.000.000.',
  monto: null, fecha: null, comercio: null, nit: null, descripcion: null,
}
const LEIDO_FOTO: LecturaAdjunto = { legible: true, clase: 'viaje', texto: 'Cartagena del 12 al 16 de diciembre de 2026. 2 adultos y un niño de 7 años.', monto: null, fecha: null, comercio: null, nit: null, descripcion: null }

function lectorDe(por: Record<string, LecturaAdjunto | null>): Lector & { leidos: string[] } {
  const leidos: string[] = []
  const f = (async (a: ArchivoAdjunto) => {
    leidos.push(a.mime)
    return por[a.mime] ?? null
  }) as Lector & { leidos: string[] }
  f.leidos = leidos
  return f
}

const textoDelTurno = (p: PedidoModelo) => String(p.mensajes[0].parts[0].text)

describe('un PDF reenviado del cliente: se guarda y se lee al llegar, entra a la tanda y queda de soporte', () => {
  it('cargar_tanda lleva lo leído a la extracción, el resumen dice el soporte y el toque lo deja en la actividad del viaje', async () => {
    const lector = lectorDe({ 'application/pdf': LEIDO_PDF })
    let estado = ''
    const modelo = modeloGuionado([
      (p) => {
        estado = textoDelTurno(p)
        return { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 1' } } }
      },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [VIAJE], lector })

    // El reenvío no pasa por el modelo: acuse y, después, la lectura (al llegar, no cuando se pida cargar).
    const acuse = await e.adjunta({ tipo: 'pdf', nombre: 'solicitud.pdf', reenviado: true, archivo: PDF })
    expect(acuse).toHaveLength(1)
    expect(lector.leidos).toEqual(['application/pdf'])
    expect(e.puerto.subidos.size).toBe(1)
    const fila = e.almacen.filas.find((f) => f.media?.tipo === 'documento')!
    expect(fila.media?.ref).toMatch(/^one:\/\/gastos-soportes\/ws\/whatsapp\/.+\.pdf$/)
    expect(fila.media?.lectura?.clase).toBe('viaje')
    expect(e.puerto.escrituras).toEqual([])

    const t = await e.escribe('cárgalo en M1 26 1')
    // El modelo vio el archivo con lo leído y el Estado lo lista.
    expect(estado).toContain('documento "solicitud.pdf"')
    expect(estado).toContain('lo que dice el archivo (del viaje): "San Andrés. Salida 2027-01-08')
    expect(estado).toContain('Archivos (fotos o PDF) en esta conversación: #1 (PDF «solicitud.pdf», reenviado del cliente, leído: datos del viaje)')
    // La propuesta: lo leído llegó a la carga (marcado como archivo) y el soporte está en el resumen.
    expect(t[0].texto).toContain(`¿Cargo esto en M1 26 1 · SAN ANDRÉS?`)
    expect(t[0].texto).toContain(`${MARCA_ARCHIVO} · PDF «solicitud.pdf» · del viaje`)
    expect(t[0].texto).toContain('📎 Queda como soporte del viaje: «solicitud.pdf».')
    expect(e.puerto.escrituras).toEqual([])
    expect(e.puerto.soportes).toEqual([])

    const hecho = await e.toca('Cargar')
    expect(hecho[0].texto).toContain('📎 Dejé «solicitud.pdf» como soporte en la actividad del viaje.')
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['carga', 'soporte'])
    expect(e.puerto.soportes).toEqual([{ viajeId: 'v-m1', ref: fila.media!.ref, tipo: 'documento', nombre: 'solicitud.pdf' }])
  })

  it('si la actividad no deja escribir el soporte, lo del viaje queda y se dice', async () => {
    const lector = lectorDe({ 'application/pdf': LEIDO_PDF })
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 1' } } }])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [VIAJE], lector })
    await e.adjunta({ tipo: 'pdf', nombre: 'solicitud.pdf', reenviado: true, archivo: PDF })
    await e.escribe('cárgalo en M1 26 1')
    e.puerto.fallarSoporte = true
    const hecho = await e.toca('Cargar')
    expect(hecho[0].texto).toContain('⚠️ No alcancé a dejar el archivo como soporte en el viaje; lo del viaje sí quedó.')
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['carga'])
  })

  it('si no se pudo leer, el archivo igual se guarda y queda de soporte; la carga no inventa nada', async () => {
    const lector = lectorDe({})
    let estado = ''
    const modelo = modeloGuionado([
      (p) => {
        estado = textoDelTurno(p)
        return { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 1' } } }
      },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [VIAJE], lector })
    await e.adjunta({ tipo: 'foto', reenviado: true, archivo: FOTO })
    const t = await e.escribe('cárgalo en M1 26 1')
    expect(e.puerto.subidos.size).toBe(1)
    expect(estado).toContain('no se pudo leer el archivo: el lector no respondió')
    expect(estado).toContain('(foto, reenviado del cliente, no se pudo leer)')
    expect(t[0].texto).toContain('(no encontré datos del viaje en esto)')
    expect(t[0].texto).toContain('📎 Queda como soporte del viaje: la foto.')
  })
})

describe('la foto que manda el comercial con el código del viaje: anotar_en_viaje', () => {
  it('lo leído va en el turno del modelo y en la anotación, y la foto queda de soporte con el toque', async () => {
    const lector = lectorDe({ 'image/jpeg': LEIDO_FOTO })
    let estado = ''
    const modelo = modeloGuionado([
      (p) => {
        estado = textoDelTurno(p)
        return { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: 'M1 26 1' } } }
      },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [VIAJE], lector })
    const t = await e.adjunta({ tipo: 'foto', pie: 'esto mandó para M1 26 1', archivo: FOTO })
    expect(estado).toContain('[foto de el comercial] "esto mandó para M1 26 1" · lo que dice el archivo (del viaje): "Cartagena del 12 al 16')
    expect(t[0].texto).toContain('¿Lo anoto en M1 26 1 · SAN ANDRÉS?')
    expect(t[0].texto).toContain('esto mandó para M1 26 1')
    expect(t[0].texto).toContain(`${MARCA_ARCHIVO} · foto · del viaje`)
    expect(t[0].texto).toContain('📎 Queda como soporte del viaje: la foto.')
    await e.toca('Anotar')
    expect(e.puerto.soportes).toHaveLength(1)
  })
})

describe('sin lector la bandeja queda como antes (el texto de Trappvel no cambia)', () => {
  it('cargar_tanda de texto: mismo resumen, sin 📎, sin archivos en el Estado, sin lectura', async () => {
    let estado = ''
    const modelo = modeloGuionado([
      (p) => {
        estado = textoDelTurno(p)
        return { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 1' } } }
      },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [VIAJE] })
    expect(e.deps.dominio.prepararTurno).toBeUndefined()
    expect(e.deps.dominio.ventanaAdjuntosMs).toBeUndefined()
    await e.reenvia('Vamos 2 adultos del 3 al 8 de marzo')
    const t = await e.escribe('cárgalo en M1 26 1')
    expect(t[0].texto).toBe('¿Cargo esto en M1 26 1 · SAN ANDRÉS?\n• Vamos 2 adultos del 3 al 8 de marzo\nFalta para cotizar: fecha de salida, fecha de regreso, adultos, niños.')
    expect(estado).not.toContain('Archivos (fotos o PDF)')
  })

  it('con lector y sin archivos, el Estado y el resumen del texto son los mismos', async () => {
    let estado = ''
    const modelo = modeloGuionado([
      (p) => {
        estado = textoDelTurno(p)
        return { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 1' } } }
      },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: [VIAJE], lector: lectorDe({}) })
    await e.reenvia('Vamos 2 adultos del 3 al 8 de marzo')
    const t = await e.escribe('cárgalo en M1 26 1')
    expect(t[0].texto).toBe('¿Cargo esto en M1 26 1 · SAN ANDRÉS?\n• Vamos 2 adultos del 3 al 8 de marzo\nFalta para cotizar: fecha de salida, fecha de regreso, adultos, niños.')
    expect(estado).not.toContain('Archivos (fotos o PDF)')
  })

  it('el interruptor agente_config.leer_adjuntos: por defecto sí; false lo apaga', () => {
    expect(leerConfigAgente({ agente: true }).leerAdjuntos).toBe(true)
    expect(leerConfigAgente({ agente: true, agente_config: { leer_adjuntos: false } }).leerAdjuntos).toBe(false)
  })
})

describe('piezas puras', () => {
  const fila = (p: Partial<FilaConversacion>): FilaConversacion => ({ id: 'f1', workspace_id: 'ws', phone: '57', direccion: 'entrante', clase: 'reenvio', texto: null, created_at: '2026-10-21T15:00:00Z', ...p })

  it('textoParaCarga: un escrito queda igual; un archivo leído suma lo que dice, marcado; sin lectura, solo el pie', () => {
    expect(textoParaCarga(fila({ clase: 'escrito', texto: '  somos 3  ' }))).toBe('somos 3')
    expect(textoParaCarga(fila({ texto: 'mira', media: { tipo: 'documento', id: 'm', nombre: 'plan.pdf', lectura: LEIDO_PDF } })))
      .toBe(`mira\n${MARCA_ARCHIVO} · PDF «plan.pdf» · del viaje · lo que dice el archivo] ${LEIDO_PDF.texto}`)
    expect(textoParaCarga(fila({ texto: 'mira', media: { tipo: 'imagen', id: 'm' } }))).toBe('mira')
    expect(textoParaCarga(fila({ media: { tipo: 'imagen', id: 'm', lectura: { ...LEIDO_FOTO, legible: false } } }))).toBe('')
  })

  it('adjuntosDe: solo los archivos ya guardados (con ref)', () => {
    expect(adjuntosDe([
      fila({ id: 'a', media: { tipo: 'documento', id: 'm1', nombre: 'x.pdf', ref: 'one://gastos-soportes/ws/whatsapp/a.pdf' } }),
      fila({ id: 'b', media: { tipo: 'imagen', id: 'm2', ref: null } }),
      fila({ id: 'c', clase: 'escrito', texto: 'hola' }),
    ])).toEqual([{ fila: 'a', ref: 'one://gastos-soportes/ws/whatsapp/a.pdf', tipo: 'documento', nombre: 'x.pdf' }])
  })

  it('normalizarLecturaViaje: clase conocida; de un documento de identidad salen los números, no las fechas', () => {
    const id = normalizarLecturaViaje({ legible: true, clase: 'identidad', texto: 'Pasaporte AB1234567 de Laura Prueba, nacida 1987-03-14, cédula 1.020.304.050, vence 2031-05-02', monto: 5, fecha: '2026-01-01', comercio: 'x' })
    expect(id.texto).toBe('Pasaporte [número omitido] de Laura Prueba, nacida 1987-03-14, cédula [número omitido], vence 2031-05-02')
    expect(id).toMatchObject({ legible: true, clase: 'identidad', monto: null, fecha: null, comercio: null })
    const pago = normalizarLecturaViaje({ legible: true, clase: 'pago', texto: 'Transferencia de Laura a Agencia por $1.500.000', monto: 1500000, fecha: '2026-10-20', comercio: 'Agencia' })
    expect(pago).toMatchObject({ clase: 'pago', monto: 1500000, fecha: '2026-10-20', comercio: 'Agencia' })
    expect(normalizarLecturaViaje({ clase: 'raro', texto: '' })).toMatchObject({ legible: false, clase: 'otro', texto: null })
    expect(normalizarLecturaViaje({ clase: 'viaje', texto: 'x'.repeat(2000) }).texto).toHaveLength(900)
  })

  it('el pedido de lectura de la bandeja lleva su prompt (sin números de documento) y el archivo', () => {
    const c = cuerpoLectura(PDF, PERFIL_DOCUMENTO_VIAJE) as { system_instruction: { parts: Array<{ text: string }> }; contents: Array<{ parts: Array<{ inlineData?: { mimeType: string } }> }> }
    expect(c.system_instruction.parts[0].text).toBe(PROMPT_DOCUMENTO_VIAJE)
    expect(PROMPT_DOCUMENTO_VIAJE).toContain('NUNCA el número')
    expect(c.contents[0].parts[0].inlineData?.mimeType).toBe('application/pdf')
  })

  it('textoLectura: la lectura de la bandeja muestra qué es y lo que dice; la de ONE sigue igual', () => {
    expect(textoLectura(LEIDO_FOTO)).toBe(' · lo que dice el archivo (del viaje): "Cartagena del 12 al 16 de diciembre de 2026. 2 adultos y un niño de 7 años."')
    expect(textoLectura({ ...LEIDO_FOTO, legible: false, texto: null, motivo: 'no se pudo bajar el archivo' })).toBe(' · (no se pudo leer el archivo: no se pudo bajar el archivo)')
    expect(textoLectura({ legible: true, monto: 6880, fecha: null, comercio: 'Uber', nit: null, descripcion: null })).toBe(' · lo que dice el archivo: total $6.880 · comercio "Uber"')
  })

  it('la extracción solo cambia de prompt cuando hay un archivo', () => {
    const campos = [{ slug: 'destino', label: 'Destino', tipo: 'texto' }] as Parameters<typeof instruccionesCarga>[0]
    const sin = instruccionesCarga(campos, '2026-10-21')
    const con = instruccionesCarga(campos, '2026-10-21', {}, {}, undefined, { documentos: true })
    expect(sin).not.toContain(PARRAFO_DOCUMENTOS[1])
    expect(con).toContain(PARRAFO_DOCUMENTOS[1])
    expect(con.replace(PARRAFO_DOCUMENTOS.join('\n') + '\n', '')).toBe(sin)
  })

  it('lineasAdjuntos: vacío sin archivos', () => {
    expect(lineasAdjuntos([fila({ clase: 'escrito', texto: 'hola' })])).toEqual([])
  })
})
