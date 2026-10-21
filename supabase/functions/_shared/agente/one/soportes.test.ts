import { describe, expect, it } from 'vitest'
import { escenarioOne, TEL_ONE_PRUEBA, WS_ONE_PRUEBA } from './escenario'
import { modeloGuionado } from '../modelo-guionado'
import { atenderPendientes } from '../cola'
import { gastosDeLaConversacion, montoDistinto, soporteDe, TEXTO_PEDIR_SOPORTE } from './dominio'
import type { ArchivoAdjunto, Lector } from './lectura-adjunto'
import type { FilaConversacion, LecturaAdjunto, PedidoModelo } from '../tipos'
import { reciboUberSintetico } from '../arnes/soportes/pdf-minimo'

/**
 * El soporte que llega por WhatsApp (foto o PDF) en el modo agente de ONE: se guarda al llegar, se lee con el modelo y
 * se combina con lo que dice la persona. Caso real del 2026-10-21: gasto de Uber de $27.000 registrado, PDF del recibo
 * de $6.880 con el pie «Este fue la ida» (el PDF se perdía). Datos inventados.
 */

const NEGOCIOS = [
  { id: 'n-v', codigo: 'V1 26 5', nombre: 'Impermeabilización bodega', empresa: 'Vértice Impermeables', contacto: 'Lina Prueba', etapa: 'ejecucion', valor: 5_000_000 },
  { id: 'n-a', codigo: 'A1 26 1', nombre: 'Concesión de prueba', empresa: 'Alfa Grupo', contacto: null, etapa: 'cobro', valor: 1_000_000 },
]

const PDF_UBER: ArchivoAdjunto = { bytes: reciboUberSintetico(), mime: 'application/pdf' }
const LECTURA_UBER: LecturaAdjunto = { legible: true, monto: 6880, fecha: '2026-10-21', comercio: 'Uber', nit: null, descripcion: 'viaje de Carrera 7 # 71-21 a Calle 26 # 59-41, Bogotá' }
const FOTO_FACTURA: ArchivoAdjunto = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]), mime: 'image/jpeg' }
const LECTURA_FACTURA: LecturaAdjunto = { legible: true, monto: 84500, fecha: '2026-10-20', comercio: 'Ferretería El Tornillo Feliz', nit: '900000000-0', descripcion: 'brochas, rodillo y pintura' }

/** Un lector guionado: devuelve la lectura según el tipo de archivo, y cuenta qué leyó. */
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

describe('un PDF que llega sin gasto en curso: se guarda, se lee y se propone un gasto nuevo', () => {
  it('lo leído llega al modelo como texto, la propuesta dice «📎 Soporte: recibo-uber.pdf» y el gasto queda con ese archivo', async () => {
    const lector = lectorDe({ 'application/pdf': LECTURA_UBER })
    const modelo = modeloGuionado([
      (p) => {
        const t = textoDelTurno(p)
        expect(t).toContain('[documento de Ana Dueña: "recibo-uber.pdf"] "para el proyecto de vértice"')
        expect(t).toContain('lo que dice el archivo: total $6.880 · fecha 2026-10-21 · comercio "Uber"')
        expect(t).toContain('#1 (PDF «recibo-uber.pdf», dice $6.880)')
        return { name: 'buscar_negocios', args: { texto: 'vértice' } }
      },
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'Uber de Carrera 7 a Calle 26', soporte: '#1' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    const t = await e.documento('recibo-uber.pdf', 'para el proyecto de vértice', { archivo: PDF_UBER })
    expect(t).toHaveLength(1)
    expect(t[0].texto).toContain('💰 Gasto de $6.880 · Transporte y movilidad')
    expect(t[0].texto).toContain('📁 V1 26 5 · Vértice Impermeables — Impermeabilización bodega')
    expect(t[0].texto).toContain('📎 Soporte: recibo-uber.pdf')
    expect(t[0].texto).not.toContain('⚠️')
    // Se subió al llegar (no se pierde aunque nadie confirme), pero el gasto no existe hasta el toque.
    expect(e.puerto.subidos.size).toBe(1)
    expect(e.puerto.escrituras).toEqual([])
    expect(lector.leidos).toEqual(['application/pdf'])
    // La traza deja lo preparado.
    expect(e.trazas().at(-1)!.adjuntos).toEqual([expect.objectContaining({ tipo: 'documento', guardado: true, leido: true, monto: 6880 })])

    const hecho = await e.toca('Registrar')
    expect(hecho[0].texto).toContain('✅ Gasto de $6.880 registrado')
    expect(hecho[0].texto).toContain('📎 Con su soporte.')
    expect(e.puerto.escrituras).toEqual([expect.objectContaining({ tipo: 'gasto', monto: 6880, negocio: 'V1 26 5', soporte: true })])
    // La fila del PDF quedó anotada con su referencia y su lectura (para los turnos que siguen).
    const fila = e.almacen.filas.find((f) => f.media?.tipo === 'documento')!
    expect(fila.media).toMatchObject({ ref: expect.stringMatching(/^one:\/\/gastos-soportes\/.+\.pdf$/), lectura: LECTURA_UBER })
  })

  it('si el monto no se pudo leer, el archivo se guarda igual y el bot pregunta solo lo que falta', async () => {
    const lector = lectorDe({})
    const modelo = modeloGuionado([
      (p) => {
        expect(textoDelTurno(p)).toContain('(no se pudo leer el monto del archivo: el lector no respondió)')
        return { name: 'responder', args: { tema: 'gasto', texto: 'Ya guardé el archivo. ¿De cuánto fue el gasto?' } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    await e.documento('escaneo.pdf', '', { archivo: PDF_UBER })
    expect(e.puerto.subidos.size).toBe(1)
    expect(e.puerto.escrituras).toEqual([])
  })

  it('el «sí» escrito también registra con el soporte, y lo leído respalda la cifra que dice el bot', async () => {
    const lector = lectorDe({ 'application/pdf': LECTURA_UBER })
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, negocio: 'A1 26 1', categoria: 'transporte', soporte: '#1' }, texto: 'El recibo dice $6.880 del 21 de octubre.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    const t = await e.documento('recibo-uber.pdf', 'al A1 26 1', { archivo: PDF_UBER })
    // El verificador no frena «$6.880» ni «21 de octubre»: están en lo leído.
    expect(e.trazas().at(-1)!.verificador ?? []).toEqual([])
    expect(t[0].texto).toContain('El recibo dice $6.880')
    await e.escribe('si')
    expect(e.puerto.escrituras[0]).toMatchObject({ tipo: 'gasto', monto: 6880, soporte: true })
  })
})

describe('el caso real: gasto de $27.000 registrado y llega el recibo de $6.880 («Este fue la ida»)', () => {
  it('no se adjunta callado: el candado lo devuelve al modelo, que propone corregir el monto con el soporte', async () => {
    const lector = lectorDe({ 'application/pdf': LECTURA_UBER })
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'transportes' } } },
      // Llega el PDF: el modelo intenta adjuntarlo al G1 y el candado no lo deja.
      (p) => {
        expect(textoDelTurno(p)).toContain('G1 · $27.000 · V1 26 5 · Vértice Impermeables — Impermeabilización bodega · sin soporte')
        expect(textoDelTurno(p)).toContain('"Este fue la ida" · lo que dice el archivo: total $6.880')
        return { name: 'proponer', args: { accion: 'adjuntar_soporte', datos: { gasto: 'G1', soporte: '#5' } } }
      },
      (p) => {
        const r = p.mensajes.at(-1)!.parts[0].functionResponse!.response as { error: string }
        expect(r.error).toContain('El soporte #5 dice $6.880 y ese gasto es de $27.000')
        return { name: 'proponer', args: { accion: 'corregir_gasto', datos: { gasto: 'G1', monto: 6880, soporte: '#5' }, texto: 'El recibo dice $6.880 y el gasto quedó en $27.000. Si los $27.000 eran ida y vuelta, dejo este en $6.880 y la vuelta la registramos aparte.' } }
      },
      // Tras el toque, el modelo tiene un turno para seguir (la vuelta): pregunta.
      { name: 'responder', args: { tema: 'gasto', texto: '¿Me mandas el recibo de la vuelta?' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    await e.escribe('Registra un gasto de 27000 por transportes al proyecto vértice')
    const reg = await e.toca('Registrar')
    expect(reg[0].texto).toContain(TEXTO_PEDIR_SOPORTE)
    expect(reg[0].texto).not.toContain('📷 Si tienes la foto del soporte')

    const t = await e.documento('recibo-uber.pdf', 'Este fue la ida', { archivo: PDF_UBER })
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['monto_distinto'])
    expect(t[0].texto).toContain('✏️ El gasto de $27.000 · V1 26 5 · Vértice Impermeables — Impermeabilización bodega queda en $6.880')
    expect(t[0].texto).toContain('📎 Soporte: recibo-uber.pdf')
    expect('opciones' in t[0] && t[0].opciones.map((o) => o.titulo)).toEqual(['Cambiar', 'No'])
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['gasto'])

    const hecho = await e.toca('Cambiar')
    expect(hecho[0].texto).toContain('✅ El gasto · V1 26 5 · Vértice Impermeables — Impermeabilización bodega quedó en $6.880 (antes $27.000).')
    expect(hecho[0].texto).toContain('¿Me mandas el recibo de la vuelta?')
    expect(e.puerto.escrituras.at(-1)).toMatchObject({ tipo: 'correccion', monto_antes: 27000, monto: 6880, soporte: true })
    expect(gastosDeLaConversacion(e.almacen.filas)[0]).toMatchObject({ monto: 6880, soporte: true })
    expect(modelo.restantes()).toBe(0)
  })

  it('si la persona dice que va así aunque no cuadre, se adjunta con la advertencia en el resumen', async () => {
    const lector = lectorDe({ 'application/pdf': LECTURA_UBER })
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte' } } },
      { name: 'proponer', args: { accion: 'adjuntar_soporte', datos: { gasto: 'G1', soporte: '#5', monto_distinto: true } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    await e.escribe('27000 de transportes al V1 26 5')
    await e.toca('Registrar')
    const t = await e.documento('recibo-uber.pdf', 'déjalo así, es uno de los dos recibos', { archivo: PDF_UBER })
    expect(t[0].texto).toContain('📎 recibo-uber.pdf como soporte del gasto de $27.000')
    expect(t[0].texto).toContain('⚠️ El soporte dice $6.880, no $27.000')
    expect(t[0].texto).toContain('¿Lo adjunto?')
  })

  it('un gasto nuevo con un soporte que dice otro monto también lo muestra en el resumen', async () => {
    const lector = lectorDe({ 'application/pdf': LECTURA_UBER })
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte', soporte: '#1' } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    const t = await e.documento('recibo-uber.pdf', '27000 al V1 26 5', { archivo: PDF_UBER })
    expect(t[0].texto).toContain('⚠️ El soporte dice $6.880, no $27.000')
  })

  it('corregir_gasto: solo gastos de esta conversación, con otro monto', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'corregir_gasto', datos: { gasto: 'G1', monto: 6880 } } },
      { name: 'responder', args: { tema: 'gasto', texto: 'Ese gasto se corrige en la app.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('cambia el gasto de ayer a 6880')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['gasto_desconocido'])
    expect(e.puerto.escrituras).toEqual([])
  })

  it('un gasto ya revisado no se corrige por aquí: ni se propone (candado gasto_revisado)', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte' } } },
      { name: 'proponer', args: { accion: 'corregir_gasto', datos: { gasto: 'G1', monto: 6880 } } },
      { name: 'responder', args: { tema: 'gasto', texto: 'Contabilidad ya lo revisó: ese monto no se cambia por aquí.' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('27000 al V1 26 5')
    await e.toca('Registrar')
    e.puerto.revisados.add('gasto-1')
    await e.escribe('eran 6880')
    expect(e.trazas().at(-1)!.candados!.map((c) => c.candado)).toEqual(['gasto_revisado'])
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['gasto'])
  })

  it('si lo revisan entre la propuesta y el toque, no se escribe nada y se dice', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'gasto', datos: { monto: 27000, negocio: 'V1 26 5', categoria: 'transporte' } } },
      { name: 'proponer', args: { accion: 'corregir_gasto', datos: { gasto: 'G1', monto: 6880 } } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    await e.escribe('27000 al V1 26 5')
    await e.toca('Registrar')
    await e.escribe('eran 6880')
    e.puerto.revisados.add('gasto-1')
    const t = await e.toca('Cambiar')
    expect(t[0].texto).toContain('No pude hacerlo ahora')
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['gasto'])
  })
})

describe('foto de factura: se lee igual que el PDF', () => {
  it('foto con pie que nombra el negocio: propone el gasto con el monto leído y la foto de soporte', async () => {
    const lector = lectorDe({ 'image/jpeg': LECTURA_FACTURA })
    const modelo = modeloGuionado([
      (p) => {
        expect(textoDelTurno(p)).toContain('[foto de Ana Dueña] "pintura para alfa" · lo que dice el archivo: total $84.500 · fecha 2026-10-20 · comercio "Ferretería El Tornillo Feliz" · NIT 900000000-0')
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 84500, negocio: 'A1 26 1', categoria: 'materiales', descripcion: 'pintura', soporte: '#1' } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    const t = await e.foto('pintura para alfa', { archivo: FOTO_FACTURA })
    expect(t[0].texto).toContain('💰 Gasto de $84.500 · Materiales')
    expect(t[0].texto).toContain('📷 Con la foto #1 como soporte')
    expect(lector.leidos).toEqual(['image/jpeg'])
  })
})

describe('la ventana de los adjuntos (5 s): texto y adjunto en mensajes separados van en el mismo turno', () => {
  it('el PDF primero y el texto 2 s después: un solo turno del modelo con los dos', async () => {
    const lector = lectorDe({ 'application/pdf': LECTURA_UBER })
    const modelo = modeloGuionado([
      (p) => {
        const t = textoDelTurno(p)
        const nuevos = t.slice(t.indexOf('## Mensajes nuevos'))
        expect(nuevos).toContain('[documento de Ana Dueña: "recibo-uber.pdf"]')
        expect(nuevos).toContain('es del proyecto de vértice')
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, negocio: 'V1 26 5', categoria: 'transporte', soporte: '#1' } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    // El webhook del PDF toma la cola y espera la ventana; el texto llega en el medio (lo simula `dormir`).
    e.almacen.entrante({ workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, clase: 'otro', texto: null, media: { tipo: 'documento', id: 'm-pdf', mime: 'application/pdf', nombre: 'recibo-uber.pdf' } })
    e.puerto.archivos.set('m-pdf', PDF_UBER)
    e.deps.dormir = async (ms) => {
      e.reloj.avanzar(2000)
      e.almacen.entrante({ workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, clase: 'escrito', texto: 'es del proyecto de vértice' })
      e.reloj.avanzar(Math.max(0, ms - 2000))
    }
    await atenderPendientes(e.deps)
    expect(modelo.pedidos).toHaveLength(1)
    expect(e.mensajero.enviados).toHaveLength(1)
    expect(e.mensajero.enviados[0].salida.texto).toContain('📎 Soporte: recibo-uber.pdf')
  })

  it('el texto primero y el PDF llega mientras el modelo piensa: la respuesta no sale y el turno se repite con los dos', async () => {
    const lector = lectorDe({ 'application/pdf': LECTURA_UBER })
    const caja: { e: Awaited<ReturnType<typeof escenarioOne>> | null } = { e: null }
    const modelo = modeloGuionado([
      () => {
        // Mientras el modelo «piensa», llega el PDF (1,5 s después del texto).
        const e = caja.e!
        e.reloj.avanzar(1500)
        e.puerto.archivos.set('m-pdf2', PDF_UBER)
        e.almacen.entrante({ workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, clase: 'otro', texto: null, media: { tipo: 'documento', id: 'm-pdf2', mime: 'application/pdf', nombre: 'recibo-uber.pdf' } })
        return { name: 'responder', args: { tema: 'gasto', texto: '¿De cuánto fue?' } }
      },
      (p) => {
        const nuevos = textoDelTurno(p).slice(textoDelTurno(p).indexOf('## Mensajes nuevos'))
        expect(nuevos).toContain('este fue la ida, para vértice')
        expect(nuevos).toContain('lo que dice el archivo: total $6.880')
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, negocio: 'V1 26 5', categoria: 'transporte', soporte: '#2' } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    caja.e = e
    await e.escribe('este fue la ida, para vértice')
    // Salió UNA respuesta: la propuesta con el soporte (el «¿De cuánto fue?» no salió).
    expect(e.mensajero.enviados).toHaveLength(1)
    expect(e.mensajero.enviados[0].salida.texto).toContain('📎 Soporte: recibo-uber.pdf')
    expect(modelo.pedidos).toHaveLength(2)
  })

  it('fuera de la ventana cada mensaje es su turno (un escrito no espera)', async () => {
    const modelo = modeloGuionado([
      { name: 'responder', args: { tema: 'conversacion', texto: 'Hola, ¿en qué te ayudo?' } },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS })
    let durmio = 0
    e.deps.dormir = async (ms) => { durmio += ms }
    await e.escribe('hola')
    expect(durmio).toBe(0)
  })
})

describe('varios soportes seguidos: cada uno es su gasto', () => {
  it('dos PDF con montos distintos: tras registrar el primero, el modelo tiene un turno para proponer el segundo', async () => {
    const lector: Lector = async (a) => (a.nombre === 'ida.pdf' ? LECTURA_UBER : { ...LECTURA_UBER, monto: 9400, descripcion: 'viaje de vuelta' })
    const modelo = modeloGuionado([
      (p) => {
        expect(textoDelTurno(p)).toContain('#1 (PDF «ida.pdf», dice $6.880), #2 (PDF «vuelta.pdf», dice $9.400)')
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 6880, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'Uber ida', soporte: '#1' } } }
      },
      (p) => {
        expect(textoDelTurno(p)).toContain('#2 (PDF «vuelta.pdf», dice $9.400)')
        expect(textoDelTurno(p)).not.toContain('#1 (PDF')
        return { name: 'proponer', args: { accion: 'gasto', datos: { monto: 9400, negocio: 'V1 26 5', categoria: 'transporte', descripcion: 'Uber vuelta', soporte: '#2' } } }
      },
    ])
    const e = await escenarioOne({ modelo, negocios: NEGOCIOS, lector })
    await e.juntos([
      { documento: 'ida.pdf', archivo: PDF_UBER },
      { documento: 'vuelta.pdf', archivo: PDF_UBER, pie: 'ida y vuelta al V1 26 5' },
    ])
    const hecho = await e.toca('Registrar')
    expect(hecho[0].texto).toContain('✅ Gasto de $6.880 registrado')
    expect(hecho[0].texto).toContain('💰 Gasto de $9.400')
    await e.toca('Registrar')
    expect(e.puerto.escrituras.map((x) => [x.monto, x.soporte])).toEqual([[6880, true], [9400, true]])
  })

  it('el mismo soporte no sirve para dos gastos', () => {
    const fila = (id: string, extra: Partial<FilaConversacion>): FilaConversacion => ({ id, workspace_id: 'w', phone: 'p', direccion: 'entrante', clase: 'escrito', texto: null, created_at: '2026-10-21T15:00:00Z', ...extra })
    const filas = [
      fila('a', { clase: 'otro', media: { tipo: 'documento', id: 'm1', nombre: 'r.pdf', ref: 'one://gastos-soportes/w/whatsapp/a.pdf', lectura: LECTURA_UBER } }),
      fila('b', { clase: 'toque', traza: { tipo: 'toque_propuesta', bot: 'one', ejecucion: { huella: 'h', resultado: 'ejecutada', escrituras: [{ tipo: 'gasto', id: 'g', monto: 6880, foto: 'a' }] } } }),
      fila('c', { clase: 'reenvio', media: { tipo: 'documento', id: 'm2', nombre: 'reenviado.pdf' } }),
    ]
    expect(soporteDe(filas, '#1')).toEqual({ error: 'El #1 ya es el soporte de otro gasto. Pregunta si hay otro soporte.' })
    // Un PDF reenviado también sirve de soporte.
    expect(soporteDe(filas, '#3')).toMatchObject({ fila: 'c', mediaId: 'm2', tipo: 'documento', nombre: 'reenviado.pdf', ref: null })
    expect(soporteDe(filas, '#2')).toHaveProperty('error')
  })
})

describe('montoDistinto', () => {
  it('compara con un peso de tolerancia; sin monto leído no opina', () => {
    expect(montoDistinto(LECTURA_UBER, 6880)).toBe(false)
    expect(montoDistinto(LECTURA_UBER, 6881)).toBe(false)
    expect(montoDistinto(LECTURA_UBER, 27000)).toBe(true)
    expect(montoDistinto({ ...LECTURA_UBER, legible: false, monto: null }, 27000)).toBeNull()
    expect(montoDistinto(null, 27000)).toBeNull()
  })
})
