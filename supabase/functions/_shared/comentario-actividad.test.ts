import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { comentariosDeActividad, filasDeComentarios, textoDeActividad, TOPE_COMENTARIO } from './comentario-actividad'

// `char_length` de Postgres cuenta puntos de código, como `[...s].length`.
const largo = (s: string) => [...s].length

/** Lo que dice cada comentario sin el prefijo ni la marca «(i/n) ». */
const textoDe = (contenidos: string[], prefijo: string) =>
  contenidos.map((c) => c.slice(prefijo.length).replace(/^\(\d+\/\d+\) /, '')).join(' ')

const palabras = (s: string) => s.split(/\s+/).filter(Boolean)

// Del tamaño de la nota de voz del 2026-10-26 (4.451 caracteres, 789 palabras). Texto inventado.
const NOTA_LARGA = Array.from({ length: 80 }, (_, i) =>
  `Punto ${i + 1}: en el evento hablamos con la gente de cocina sobre los turnos y el inventario.`).join(' ')

describe('comentariosDeActividad: lo largo va completo, no cortado', () => {
  it('si cabe, un solo comentario igual al de siempre', () => {
    expect(comentariosDeActividad('📞 ', 'llamé a Alfa para revisar el cobro')).toEqual(['📞 llamé a Alfa para revisar el cobro'])
  })

  it('justo en el tope sigue siendo uno', () => {
    const texto = 'a'.repeat(TOPE_COMENTARIO - 3)
    expect(comentariosDeActividad('📝 ', texto)).toEqual([`📝 ${texto}`])
  })

  it('una nota de 4.400 caracteres: cada comentario cabe en el CHECK y entre todos está el texto entero', () => {
    expect(largo(NOTA_LARGA)).toBeGreaterThan(4000)
    const c = comentariosDeActividad('🤝 ', NOTA_LARGA)
    expect(c.length).toBeGreaterThan(15)
    for (const x of c) expect(largo(x)).toBeLessThanOrEqual(TOPE_COMENTARIO)
    c.forEach((x, i) => expect(x.startsWith(`🤝 (${i + 1}/${c.length}) `)).toBe(true))
    expect(palabras(textoDe(c, '🤝 '))).toEqual(palabras(NOTA_LARGA))
  })

  it('parte entre palabras: ninguna queda dividida', () => {
    const c = comentariosDeActividad('🤝 ', NOTA_LARGA)
    const todas = new Set(palabras(NOTA_LARGA))
    for (const x of c) for (const p of palabras(x.replace(/^🤝 \(\d+\/\d+\) /, ''))) expect(todas.has(p)).toBe(true)
  })

  it('con el nombre de un colaborador sin perfil en el prefijo también cabe', () => {
    const prefijo = '📝 [María Fernanda Rodríguez de la Torre] '
    const c = comentariosDeActividad(prefijo, NOTA_LARGA)
    for (const x of c) {
      expect(x.startsWith(prefijo)).toBe(true)
      expect(largo(x)).toBeLessThanOrEqual(TOPE_COMENTARIO)
    }
    expect(palabras(textoDe(c, prefijo))).toEqual(palabras(NOTA_LARGA))
  })

  it('cuenta caracteres como Postgres: con emojis en el texto no se pasa', () => {
    const texto = Array.from({ length: 200 }, () => 'listo ✅').join(' ')
    for (const x of comentariosDeActividad('💬 ', texto)) expect(largo(x)).toBeLessThanOrEqual(TOPE_COMENTARIO)
  })

  it('una palabra más larga que un comentario (un enlace) se parte sin perder caracteres', () => {
    const enlace = `https://ejemplo.co/${'x'.repeat(600)}`
    const c = comentariosDeActividad('📝 ', `mira ${enlace} y dime`)
    for (const x of c) expect(largo(x)).toBeLessThanOrEqual(TOPE_COMENTARIO)
    expect(textoDe(c, '📝 ').replace(/\s+/g, '')).toBe(`mira${enlace}ydime`)
  })

  it('con más de nueve partes la marca crece y aun así cabe', () => {
    const c = comentariosDeActividad('📝 ', NOTA_LARGA.repeat(3))
    expect(c.length).toBeGreaterThan(9)
    for (const x of c) expect(largo(x)).toBeLessThanOrEqual(TOPE_COMENTARIO)
  })
})

describe('filasDeComentarios', () => {
  it('una fila por comentario, en orden, cada una un milisegundo después', () => {
    const f = filasDeComentarios({ workspace_id: 'w', tipo: 'comentario' }, ['uno', 'dos', 'tres'], Date.UTC(2026, 9, 26, 3, 23))
    expect(f.map((x) => x.contenido)).toEqual(['uno', 'dos', 'tres'])
    expect(f.map((x) => x.created_at)).toEqual(['2026-10-26T03:23:00.000Z', '2026-10-26T03:23:00.001Z', '2026-10-26T03:23:00.002Z'])
    expect(f.every((x) => x.workspace_id === 'w' && x.tipo === 'comentario')).toBe(true)
  })
})

// Guarda de regresión: el bot no vuelve a recortar en silencio lo que escribe en el timeline.
describe('nadie corta el contenido de una actividad a 280 en silencio', () => {
  const fuentes: string[] = []
  const recorrer = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) recorrer(p)
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) fuentes.push(p)
    }
  }
  recorrer('supabase/functions')

  it('no queda ningún `.slice(0, 280)` en las funciones', () => {
    const conCorte = fuentes.filter((p) => readFileSync(p, 'utf8').split('\n').some((l) => /\.slice\(0,\s*280\)/.test(l) && !l.trim().startsWith('//')))
    expect(conCorte).toEqual([])
  })
})

describe('textoDeActividad (la ruta sin agente)', () => {
  it('de una nota de voz: la transcripción tal cual, con lo interpretado arriba', () => {
    expect(textoDeActividad({ tipo: 'audio', mensaje: ' dictado entero ', interpretado: 'resumen' })).toEqual({ texto: 'Resumen: resumen\n\nNota tal cual: dictado entero', talCual: true })
    expect(textoDeActividad({ tipo: 'audio', mensaje: 'dictado', interpretado: null })).toEqual({ texto: 'dictado', talCual: true })
  })

  it('de un escrito: lo interpretado, o el mensaje si no hay', () => {
    expect(textoDeActividad({ tipo: 'text', mensaje: 'en el S2: llamé', interpretado: 'llamé' })).toEqual({ texto: 'llamé', talCual: false })
    expect(textoDeActividad({ tipo: 'text', mensaje: 'llamé', interpretado: '' })).toEqual({ texto: 'llamé', talCual: false })
  })
})
