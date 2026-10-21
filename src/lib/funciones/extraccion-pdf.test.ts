/**
 * Pruebas 21 a 23 del diseño de la etapa 2 (§4.4): el PDF que pre-llena el formulario.
 *
 *   21. La extracción no escribe en ninguna tabla: con la migración real cargada en PGlite, las seis tablas
 *       `funcion_*` quedan igual después de extraer.
 *   22. Lo que el modelo no devuelve, o devuelve y no está en el texto del PDF, llega vacío y marcado (`no_leido`).
 *   23. Ninguna prueba llama al modelo: se usa un doble, y `fetch` queda envenenado mientras corren.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { textoDelPdf } from '@/lib/ai/texto-pdf'
import {
  extraerBorrador,
  fechasCompletas,
  horasClaras,
  contieneNumero,
  normalizar,
  type BorradorFunciones,
  type BorradorMontaje,
  type ModeloExtraccion,
} from './extraccion-pdf'

const PLANO = `Salón Ratatouille — montaje cena
Mesa M1: 4 puestos, zona frente, cerca de la pantalla
Mesa M2: 2 puestos, zona barra
Mesa M3: zona centro
Las mesas del fondo se arman según la reserva.`

const PROGRAMACION = `Programación Ratatouille
Cupo por función: 24 personas
Sábado 14 de noviembre de 2026, 7:00 p. m.
Domingo 15 de noviembre de 2026 a las 7:00
Viernes 20 de noviembre, 19:00
21/11/2026 19:30`

/** Un modelo doble: devuelve lo que se le diga y anota con qué lo llamaron. */
function doble(respuesta: unknown) {
  const llamadas: Array<{ instruccion: string; texto: string }> = []
  const modelo: ModeloExtraccion = async (p) => {
    llamadas.push(p)
    return respuesta
  }
  return { modelo, llamadas }
}

const pdf = new Uint8Array([1, 2, 3])
const conTexto = (t: string | null) => async () => t

let fetchReal: typeof fetch
beforeEach(() => {
  fetchReal = globalThis.fetch
  globalThis.fetch = vi.fn(async () => {
    throw new Error('Una prueba de extracción intentó salir a la red (prueba 23).')
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = fetchReal
})

describe('22. lo que no está en el texto queda vacío y marcado', () => {
  it('plano: etiquetas y puestos verificados contra el texto; lo inventado se descarta', async () => {
    const { modelo, llamadas } = doble({
      nombre: 'Salón Ratatouille',
      mesas: [
        { etiqueta: 'M1', puestos: 4, zona: 'frente', condicion: 'cerca de la pantalla', cita: 'Mesa M1: 4 puestos, zona frente' },
        // Puestos inventados: 6 no está en la cita de M2.
        { etiqueta: 'M2', puestos: 6, zona: 'barra', cita: 'Mesa M2: 2 puestos, zona barra' },
        // El texto no dice cuántos puestos tiene M3: el modelo «completó» 4.
        { etiqueta: 'M3', puestos: 4, zona: 'centro', cita: 'Mesa M3: zona centro' },
        // Una mesa que no existe en el texto, con una cita inventada.
        { etiqueta: 'M9', puestos: 8, zona: 'terraza', condicion: 'con vista', cita: 'Mesa M9: 8 puestos' },
        // Sin cita: los puestos no tienen evidencia.
        { etiqueta: 'M2', puestos: 2 },
      ],
    })
    const b = (await extraerBorrador({ pdf, tipo: 'montaje', modelo, leerTexto: conTexto(PLANO) })) as BorradorMontaje
    expect(llamadas).toHaveLength(1)
    expect(b.nombre).toEqual({ valor: 'Salón Ratatouille', origen: 'pdf' })
    const resumen = b.mesas.map((m) => [m.etiqueta.valor, m.puestos.valor, m.puestos.origen, m.zona.valor, m.condicion.valor])
    expect(resumen).toEqual([
      ['M1', 4, 'pdf', 'frente', 'cerca de la pantalla'],
      ['M2', null, 'no_leido', 'barra', null],
      ['M3', null, 'no_leido', 'centro', null],
      [null, null, 'no_leido', null, null],
      ['M2', null, 'no_leido', null, null],
    ])
    expect(b.mesas[3].etiqueta.origen).toBe('no_leido')
  })

  it('funciones: sin año, sin a. m./p. m. o fuera del texto, vacía; el cupo con su cita', async () => {
    const { modelo } = doble({
      experiencia: 'Ratatouille',
      cupo: 24,
      cupo_cita: 'Cupo por función: 24 personas',
      funciones: [
        { fecha: '2026-11-14', hora: '19:00', cita: 'Sábado 14 de noviembre de 2026, 7:00 p. m.' },
        // «a las 7:00» sin marca: la hora no se adivina; la fecha sí está completa.
        { fecha: '2026-11-15', hora: '19:00', cita: 'Domingo 15 de noviembre de 2026 a las 7:00' },
        // Sin año en el texto: el modelo puso 2026 por su cuenta.
        { fecha: '2026-11-20', hora: '19:00', cita: 'Viernes 20 de noviembre, 19:00' },
        { fecha: '2026-11-21', hora: '19:30', cita: '21/11/2026 19:30' },
        // Una función que no está en el PDF.
        { fecha: '2026-11-28', hora: '20:00', cita: 'Sábado 28 de noviembre de 2026, 8:00 p. m.' },
        // Lo que el modelo no devolvió.
        { cita: '21/11/2026 19:30' },
      ],
    })
    const b = (await extraerBorrador({ pdf, tipo: 'funciones', modelo, leerTexto: conTexto(PROGRAMACION) })) as BorradorFunciones
    expect(b.experiencia).toEqual({ valor: 'Ratatouille', origen: 'pdf' })
    expect(b.cupo).toEqual({ valor: 24, origen: 'pdf' })
    expect(b.inicios.map((i) => [i.fecha.valor, i.hora.valor])).toEqual([
      ['2026-11-14', '19:00'],
      ['2026-11-15', null],
      [null, '19:00'],
      ['2026-11-21', '19:30'],
      [null, null],
      [null, null],
    ])
    expect(b.avisos.join(' ')).toMatch(/4 funciones quedaron con fecha u hora sin leer/)
  })

  it('un cupo sin cita, o que no está en ella, queda vacío', async () => {
    const sinCita = await extraerBorrador({ pdf, tipo: 'funciones', modelo: doble({ cupo: 24, funciones: [] }).modelo, leerTexto: conTexto(PROGRAMACION) })
    expect((sinCita as BorradorFunciones).cupo.origen).toBe('no_leido')
    const otro = await extraerBorrador({ pdf, tipo: 'funciones', modelo: doble({ cupo: 30, cupo_cita: 'Cupo por función: 24 personas', funciones: [] }).modelo, leerTexto: conTexto(PROGRAMACION) })
    expect((otro as BorradorFunciones).cupo).toEqual({ valor: null, origen: 'no_leido' })
  })

  it('las piezas de la verificación', () => {
    expect(fechasCompletas('9 de noviembre de 2026')).toEqual(['2026-11-09'])
    expect(fechasCompletas('9 nov. 2026')).toEqual(['2026-11-09'])
    expect(fechasCompletas('09/11/2026 y 2026-11-10').sort()).toEqual(['2026-11-09', '2026-11-10'])
    expect(fechasCompletas('9 de noviembre')).toEqual([])
    expect(fechasCompletas('31/02/2026')).toEqual([])
    expect(horasClaras('7:00 p. m.')).toEqual(['19:00'])
    expect(horasClaras('7 pm y 8:30 a.m.')).toEqual(['19:00', '08:30'])
    expect(horasClaras('a las 7')).toEqual([])
    expect(horasClaras('7:00')).toEqual([])
    expect(horasClaras('12:00 m')).toEqual(['12:00'])
    expect(contieneNumero(normalizar('mesa de 14 puestos'), 4)).toBe(false)
    expect(contieneNumero(normalizar('4,5 metros'), 4)).toBe(false)
    expect(contieneNumero(normalizar('4 puestos'), 4)).toBe(true)
  })
})

describe('23. sin capa de texto o sin respuesta del modelo: borrador vacío, nunca un valor por defecto', () => {
  it('un escaneo no se manda al modelo', async () => {
    const { modelo, llamadas } = doble({ mesas: [{ etiqueta: 'M1', puestos: 4, cita: 'M1' }] })
    const b = (await extraerBorrador({ pdf, tipo: 'montaje', modelo, leerTexto: conTexto(null) })) as BorradorMontaje
    expect(llamadas).toHaveLength(0)
    expect([b.nombre.origen, b.mesas.length]).toEqual(['no_leido', 0])
    expect(b.avisos[0]).toMatch(/no trae texto/)
  })

  it('un modelo que falla o responde basura deja el formulario vacío', async () => {
    const falla: ModeloExtraccion = async () => {
      throw new Error('503')
    }
    for (const modelo of [falla, doble('no es json').modelo, doble(null).modelo]) {
      const b = (await extraerBorrador({ pdf, tipo: 'funciones', modelo, leerTexto: conTexto(PROGRAMACION) })) as BorradorFunciones
      expect([b.experiencia.origen, b.cupo.origen, b.inicios.length]).toEqual(['no_leido', 'no_leido', 0])
      expect(b.avisos.join(' ')).toMatch(/No se pudo leer el PDF/)
    }
  })

  it('un PDF real con capa de texto pasa por textoDelPdf y el doble recibe ese texto', async () => {
    const doc = await PDFDocument.create()
    const pagina = doc.addPage([600, 400])
    const fuente = await doc.embedFont(StandardFonts.Helvetica)
    PLANO.split('\n').forEach((linea, i) =>
      pagina.drawText(linea.replace('—', '-').normalize('NFD').replace(/\p{M}/gu, ''), { x: 30, y: 360 - i * 20, size: 12, font: fuente }),
    )
    const bytes = await doc.save()
    const { modelo, llamadas } = doble({ mesas: [{ etiqueta: 'M1', puestos: 4, cita: 'Mesa M1: 4 puestos' }] })
    const b = (await extraerBorrador({ pdf: bytes, tipo: 'montaje', modelo, leerTexto: textoDelPdf })) as BorradorMontaje
    expect(llamadas[0].texto).toMatch(/Mesa M1: 4 puestos/)
    expect(b.mesas[0].puestos).toEqual({ valor: 4, origen: 'pdf' })
  })

  it('el módulo de extracción no sale a la red ni toca la llave de producción', () => {
    const fuente = readFileSync(join(process.cwd(), 'src/lib/funciones/extraccion-pdf.ts'), 'utf8')
    expect(fuente).not.toMatch(/GEMINI_API_KEY|ANTHROPIC_API_KEY|process\.env|fetch\(/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('21. extraer no escribe en ninguna tabla', () => {
  let db: PGlite
  const TABLAS = ['funcion_experiencias', 'funcion_montajes', 'funcion_mesas', 'funcion_funciones', 'funcion_reservas', 'funcion_reserva_mesas']
  const contar = async () => Promise.all(TABLAS.map(async (t) => (await db.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n))

  beforeAll(async () => {
    const leer = (r: string) => readFileSync(join(process.cwd(), r), 'utf8')
    db = new PGlite()
    await db.exec(leer('src/lib/funciones/__fixtures__/esquema-base.sql'))
    await db.exec(leer('supabase/migrations/20261021090000_asistente_chatwoot.sql'))
    await db.exec(leer('supabase/migrations/20261021120000_modulo_funciones.sql'))
    await db.exec(`insert into workspaces (id, slug) values ('00000000-0000-4000-8000-00000000e001', 'sabor-prueba');
      insert into funcion_experiencias (workspace_id, nombre, minutos_apartado) values ('00000000-0000-4000-8000-00000000e001', 'Ratatouille', 30);`)
  })
  afterAll(async () => {
    await db.close()
  })

  it('las seis tablas quedan igual después de extraer un plano y una programación', async () => {
    const antes = await contar()
    await extraerBorrador({ pdf, tipo: 'montaje', modelo: doble({ mesas: [{ etiqueta: 'M1', puestos: 4, cita: 'Mesa M1: 4 puestos' }] }).modelo, leerTexto: conTexto(PLANO) })
    await extraerBorrador({ pdf, tipo: 'funciones', modelo: doble({ funciones: [{ fecha: '2026-11-21', hora: '19:30', cita: '21/11/2026 19:30' }] }).modelo, leerTexto: conTexto(PROGRAMACION) })
    expect(await contar()).toEqual(antes)
    expect(antes).toEqual([1, 0, 0, 0, 0, 0])
  })

  it('el módulo no importa ningún cliente de base de datos', () => {
    const fuente = readFileSync(join(process.cwd(), 'src/lib/funciones/extraccion-pdf.ts'), 'utf8')
    expect(fuente).not.toMatch(/^import .*(supabase|pglite|@\/lib\/supabase)/m)
    expect(fuente).not.toMatch(/\.rpc\(|\.from\(/)
  })
})
