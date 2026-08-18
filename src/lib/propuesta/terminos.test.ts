import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  clausulasAHtml,
  normalizarTerminos,
  textoAHtml,
  type ClausulaTerminos,
} from './terminos'

// Los dos archivos de al lado son la MISMA cosa en dos formas: el HTML es el
// texto legal tal como sale hoy en el PDF de SOENA, y el JSON es ese texto ya
// pasado al modelo que edita el usuario. Si el render deja de reproducir el
// HTML a partir del JSON, la migracion perdio contenido legal — que es
// exactamente el fallo que nadie notaria leyendo el diff.
const aqui = path.dirname(new URL(import.meta.url).pathname)
const HTML_VIGENTE = readFileSync(path.join(aqui, '__fixtures__', 'terminos-soena-vigentes.html'), 'utf8')
const CLAUSULAS_VIGENTES = JSON.parse(
  readFileSync(path.join(aqui, '__fixtures__', 'terminos-soena-vigentes.json'), 'utf8'),
) as ClausulaTerminos[]

/**
 * El HTML vigente esta indentado a mano y el generado sale en una sola linea.
 * Se normaliza SOLO la sangria alrededor de las etiquetas de bloque: colapsar
 * todo espacio pegado a `<` tambien borraria el que separa una palabra de una
 * negrita, y ahi la comparacion dejaria pasar justo el error que busca.
 */
const normalizar = (html: string) =>
  html
    .replace(/\s*<(li|p)\b/g, '<$1')
    .replace(/<\/(li|p)>\s*/g, '</$1>')
    .trim()

describe('clausulasAHtml', () => {
  it('reproduce los terminos vigentes de SOENA sin perder contenido', () => {
    expect(normalizar(clausulasAHtml(CLAUSULAS_VIGENTES))).toBe(normalizar(HTML_VIGENTE))
  })

  it('numera por orden del arreglo, no por lo guardado', () => {
    const html = clausulasAHtml([
      { titulo: 'Nueva', parrafos: [{ texto: 'Va primero.' }] },
      ...CLAUSULAS_VIGENTES.slice(0, 1),
    ])
    expect(html).toContain('<span class="tn">1.</span><b>Nueva.</b>')
    expect(html).toContain('<span class="tn">2.</span><b>Objeto y alcance.</b>')
  })

  it('renumera las sub-clausulas cuando la clausula cambia de posicion', () => {
    const conSub = CLAUSULAS_VIGENTES.find((c) => c.parrafos.some((p) => p.subtitulo))
    expect(conSub).toBeDefined()
    expect(clausulasAHtml([conSub!])).toContain('<b>1.1.')
  })

  it('descarta la clausula vacia que deja una fila sin llenar en pantalla', () => {
    expect(clausulasAHtml([{ titulo: '  ', parrafos: [{ texto: '' }] }])).toBe('')
  })
})

describe('textoAHtml', () => {
  it('escapa el marcado que escriba el usuario', () => {
    expect(textoAHtml('<script>alert(1)</script> & <b>ya</b>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;ya&lt;/b&gt;',
    )
  })

  it('deja negrita solo con la marca de autor, despues de escapar', () => {
    expect(textoAHtml('SOENA **no garantiza** la fecha')).toBe('SOENA <b>no garantiza</b> la fecha')
  })

  it('respeta comillas y acentos del documento', () => {
    expect(textoAHtml('la "Gestión" del Cliente')).toBe('la "Gestión" del Cliente')
  })
})

describe('normalizarTerminos', () => {
  it('devuelve null cuando la linea no tiene nada configurado', () => {
    expect(normalizarTerminos(null)).toBeNull()
    expect(normalizarTerminos({})).toBeNull()
    expect(normalizarTerminos({ clausulas: [], cierre: '  ' })).toBeNull()
  })

  it('sobrevive a un config_extra con la forma equivocada', () => {
    const t = normalizarTerminos({ clausulas: [{ titulo: 7, parrafos: 'no es arreglo' }], cierre: 'ok' })
    expect(t).not.toBeNull()
    expect(t!.clausulas[0]).toEqual({ titulo: '', parrafos: [] })
    expect(t!.version).toBe(1)
  })
})
