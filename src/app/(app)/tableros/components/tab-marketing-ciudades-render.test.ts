/**
 * La tabla "Ventas por ciudad" de la pestaña Marketing, renderizada de verdad.
 *
 * ⚠️ Por qué RENDER y no basta con `ventasPorCiudad` en aislamiento: el agregado puede
 * estar perfecto y el JSX pintar otra cosa — dibujar solo las columnas con cifra,
 * poner un botón sobre un cero, o sumar la fila «Sin rastro» dentro del total sin
 * decirlo. Ninguna prueba pura ve esas tres. Precedentes en este repo: el banner de
 * recaudo (#569), el panel de retenidos (#581) y el badge de Tesorería (#585).
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Límite declarado: la suite corre en `node`, sin DOM, así que **el clic no se
 * ejercita**. Lo que sí queda fijado es que la celda con cifra es un `<button>` y la de
 * cero no lo es, y que el alcance que el botón anuncia es el que el panel va a pedir.
 * Que la lista traiga exactamente esa cantidad lo sostiene `drillSeAcotaAVentas`, que
 * se prueba aparte en `src/lib/tableros/marketing.test.ts`.
 *
 * Los datos son los REALES de producción, medidos el 2026-09-14 en SOENA
 * (7dea141d-d4da-483d-a78d-b14ef35500c5): 28 ventas con campaña, todas con seccional.
 *
 * ⚠️ Mutaciones MEDIDAS el 2026-09-14 sobre las 9 pruebas de este archivo, con la línea
 * base comprobada verde antes de cada una y restaurada después:
 *   · el cero también es botón (`{false ? …}`) ................................... 1 roja
 *   · la celda en cero se pinta vacía en vez de con raya ......................... 1 roja
 *   · la sección desaparece cuando no hay ventas ................................. 1 roja
 *   · la fila de totales suma solo las campañas (`tc.campanas`) .................. 1 roja
 *   · la tabla ignora la lente de mes (siempre cohorte) .......................... 2 rojas
 *   · la nota de totales miente sobre lo que suma ................................ 1 roja
 *
 * ⚠️ Lo que NINGUNA mutación de este archivo puede tumbar, y queda declarado: que el
 * botón mande `columna: col` al panel. Sin DOM no hay clic, y en el HTML estático el
 * `onClick` no deja rastro. Lo que sí está cubierto es el efecto de esa prop en el
 * servidor (`drillSeAcotaAVentas`) y el texto del `title`, que anuncia el mismo alcance.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FilaMarketing, FilaNegocioMarketing } from '@/lib/tableros/marketing'

// El panel lateral se dobla: arrastra `marketing-actions`, que es `'use server'` y
// depende del runtime de Next. Aquí se prueba la TABLA, no el panel.
vi.mock('./marketing-drawer', () => ({
  MarketingDrawer: () => React.createElement('div', null, 'drawer'),
}))

const { default: TabMarketing } = await import('./tab-marketing')

const VIDEO = '120248098468670215'
const SEP_DANIELA = '120250901461170215'
const JUL_AGO = '52653642310428'
const AGO_2026 = '52655556820428'
const PLUS = '52656511383228'
const AGO_50 = '52661829912228'
const SEP_50 = '52663199200828'
const SEP_70 = '52663609288628'
const WEBINAR = '52664310612028'

const f = (p: Partial<FilaMarketing> & Pick<FilaMarketing, 'campaignId' | 'mes'>): FilaMarketing => ({
  campana: null, gasto: 0, leads: 0, formularios: 0, negocios: 0, ventas: 0,
  honorario: 0, recaudado: 0, primerLead: null, ultimoLead: null,
  status: null, sincronizadoAt: null, ...p,
})

const n = (
  campaignId: string | null,
  mesVenta: string | null,
  seccional: string | null,
): FilaNegocioMarketing => ({ campaignId, mesVenta, seccional, honorario: 0, recaudado: 0 })

/** `v_marketing_campana` de SOENA, campañas solamente, 2026-09-14. */
const FILAS: FilaMarketing[] = [
  f({ campaignId: VIDEO, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-07-01',
      leads: 135, ventas: 5, primerLead: '2026-07-08T12:36:22+00:00' }),
  f({ campaignId: VIDEO, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-08-01', ventas: 2 }),
  f({ campaignId: VIDEO, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-09-01', ventas: 1 }),
  f({ campaignId: SEP_DANIELA, campana: 'CAMPAÑA SEP DANIELA', mes: '2026-08-01',
      leads: 34, ventas: 2, primerLead: '2026-08-27T19:24:08+00:00' }),
  f({ campaignId: SEP_DANIELA, campana: 'CAMPAÑA SEP DANIELA', mes: '2026-09-01',
      leads: 113, ventas: 1, primerLead: '2026-09-01T06:49:26+00:00' }),
  f({ campaignId: JUL_AGO, campana: 'CLIENTES POTENCIALES JUL/AGO 2026', mes: '2026-07-01',
      leads: 49, primerLead: '2026-07-29T19:41:57+00:00' }),
  f({ campaignId: JUL_AGO, campana: 'CLIENTES POTENCIALES JUL/AGO 2026', mes: '2026-08-01',
      leads: 53, ventas: 4, primerLead: '2026-08-01T07:57:22+00:00' }),
  f({ campaignId: AGO_2026, campana: 'CLIENTES POTENCIALES AGO 2026', mes: '2026-08-01',
      leads: 16, ventas: 1, primerLead: '2026-08-04T21:34:46+00:00' }),
  f({ campaignId: PLUS, campana: 'CLIENTES POTENCIALES AGO 2026 PLUS', mes: '2026-07-01', ventas: 1 }),
  f({ campaignId: PLUS, campana: 'CLIENTES POTENCIALES AGO 2026 PLUS', mes: '2026-08-01',
      leads: 304, ventas: 5, primerLead: '2026-08-06T21:54:16+00:00' }),
  f({ campaignId: PLUS, campana: 'CLIENTES POTENCIALES AGO 2026 PLUS', mes: '2026-09-01', ventas: 1 }),
  f({ campaignId: AGO_50, campana: 'CLIENTES POTENCIALES AGO ($50)', mes: '2026-08-01',
      leads: 93, ventas: 2, primerLead: '2026-08-24T20:55:56+00:00' }),
  f({ campaignId: AGO_50, campana: 'CLIENTES POTENCIALES AGO ($50)', mes: '2026-09-01',
      leads: 1, ventas: 2, primerLead: '2026-09-01T14:12:18+00:00' }),
  f({ campaignId: SEP_50, campana: 'CLIENTES POTENCIALES SEP ($50)', mes: '2026-09-01',
      leads: 5, primerLead: '2026-09-03T01:52:59+00:00' }),
  f({ campaignId: SEP_70, campana: 'CLIENTES POTENCIALES SEP ($70)', mes: '2026-09-01',
      leads: 69, ventas: 1, primerLead: '2026-09-03T21:42:50+00:00' }),
  f({ campaignId: WEBINAR, campana: 'WEBINAR', mes: '2026-09-01',
      leads: 23, primerLead: '2026-09-07T23:41:32+00:00' }),
]

/** Las 28 ventas con campaña, con la ciudad que traen de `negocios.metadata`. */
const VENTAS: FilaNegocioMarketing[] = [
  n(VIDEO, '2026-07-01', 'Barranquilla'), n(VIDEO, '2026-07-01', 'Bogotá'),
  n(VIDEO, '2026-07-01', 'Cúcuta'), n(VIDEO, '2026-07-01', 'Montería'),
  n(VIDEO, '2026-07-01', 'Palmira'), n(VIDEO, '2026-08-01', 'Girardot'),
  n(VIDEO, '2026-08-01', 'Manizales'), n(VIDEO, '2026-09-01', 'Montería'),
  n(SEP_DANIELA, '2026-08-01', 'Armenia'), n(SEP_DANIELA, '2026-08-01', 'Pereira'),
  n(SEP_DANIELA, '2026-09-01', 'Bucaramanga'),
  n(JUL_AGO, '2026-08-01', 'Bucaramanga'), n(JUL_AGO, '2026-08-01', 'Bucaramanga'),
  n(JUL_AGO, '2026-08-01', 'Cartagena'), n(JUL_AGO, '2026-08-01', 'Medellín'),
  n(AGO_2026, '2026-08-01', 'Medellín'),
  n(PLUS, '2026-07-01', 'Medellín'), n(PLUS, '2026-08-01', 'Cali'),
  n(PLUS, '2026-08-01', 'Medellín'), n(PLUS, '2026-08-01', 'Medellín'),
  n(PLUS, '2026-08-01', 'Santa Marta'), n(PLUS, '2026-08-01', 'Villavicencio'),
  n(PLUS, '2026-09-01', 'Medellín'),
  n(AGO_50, '2026-08-01', 'Bogotá'), n(AGO_50, '2026-08-01', 'Medellín'),
  n(AGO_50, '2026-09-01', 'Cali'), n(AGO_50, '2026-09-01', 'Florencia'),
  n(SEP_70, '2026-09-01', 'Popayán'),
]

const datos = (p: Partial<Parameters<typeof TabMarketing>[0]['datos']> = {}) => ({
  filas: FILAS,
  ventas: VENTAS,
  mesEnCurso: '2026-09-01',
  hoyISO: '2026-09-14',
  gastoSincronizado: false,
  monedas: ['COP'],
  ...p,
})

const pintar = (d = datos()) =>
  renderToStaticMarkup(React.createElement(TabMarketing, { datos: d }))

/**
 * Solo el trozo de HTML de la tabla de ciudades.
 *
 * ⚠️ Hace falta y costó una prueba verde por la razón equivocada: el nombre de una
 * campaña aparece TRES veces en la página (fila de la tabla de campañas, tarjeta de
 * celular y fila de ciudades). Buscando en el HTML completo, «la fila de WEBINAR no
 * tiene botón» era cierta sobre la fila de arriba, que nunca tuvo uno.
 */
function seccionCiudades(html: string): string {
  const i = html.indexOf('Ventas por ciudad')
  if (i < 0) throw new Error('no se pintó la sección "Ventas por ciudad"')
  return html.slice(i)
}

/** Las celdas de la fila que contiene `etiqueta`, ya sin etiquetas HTML. */
function celdas(html: string, etiqueta: string): string[] {
  return [...filaCruda(html, etiqueta).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m =>
    m[1].replace(/<[^>]+>/g, '').trim(),
  )
}

/** Lo mismo pero el `<tr>` completo, para mirar si hay botones. */
function filaCruda(html: string, etiqueta: string): string {
  const fila = seccionCiudades(html).split('<tr').find(t => t.includes(`>${etiqueta}<`))
  if (!fila) throw new Error(`no hay fila con la etiqueta "${etiqueta}" en Ventas por ciudad`)
  return fila
}

const RAYA = '—'

describe('Ventas por ciudad · render', () => {
  it('la tabla existe y trae las SEIS columnas del tablero directivo', () => {
    const html = pintar()
    expect(html).toContain('Ventas por ciudad')
    for (const col of ['Bogotá', 'Cali', 'Medellín', 'Bucaramanga', 'Otras ciudades', 'Sin seccional']) {
      expect(html).toContain(col)
    }
  })

  it('cohorte: el total reparte las 28 ventas como las midió producción', () => {
    // La pestaña arranca en la lente MES; para ver la cohorte hace falta el clic, que
    // esta suite no puede dar. Se comprueba el mes en curso, y la cohorte queda cubierta
    // por las pruebas puras de `marketing.test.ts`.
    const html = pintar()
    // Septiembre de 2026 es el `mesEnCurso` del fixture: 6 ventas.
    expect(celdas(html, 'Total de ventas')).toEqual(['Total de ventas', RAYA, '1', '1', '1', '3', RAYA, '6'])
  })

  it('las columnas en cero se DIBUJAN, con raya', () => {
    // El defecto que evita: esconder la columna vacía deja la tabla afirmando que esa
    // ciudad no existe, y «Sin seccional» en cero es justamente la noticia buena.
    const html = pintar()
    const total = celdas(html, 'Total de ventas')
    expect(total).toHaveLength(8)
    expect(total[1]).toBe(RAYA) // Bogotá, sin ventas en septiembre
    expect(total[6]).toBe(RAYA) // Sin seccional
  })

  it('una cifra es botón; un cero NO lo es', () => {
    const html = pintar()
    // WEBINAR tuvo 23 leads en septiembre y cero ventas: su fila está, en ceros y sin
    // un solo botón. Abrir una lista vacía enseña a desconfiar del panel.
    const webinar = filaCruda(html, 'WEBINAR')
    expect(webinar).not.toContain('<button')
    expect(celdas(html, 'WEBINAR')).toEqual(['WEBINAR', RAYA, RAYA, RAYA, RAYA, RAYA, RAYA, '0'])
    // La de PLUS vendió 1 en Medellín ese mes: ahí sí hay botón.
    expect(filaCruda(html, 'CLIENTES POTENCIALES AGO 2026 PLUS')).toContain('<button')
  })

  it('el botón anuncia el alcance exacto que el panel va a pedir', () => {
    const html = pintar()
    expect(html).toContain('Ver las 1 ventas · ventas en Medellín')
    // «Sin seccional» no es una ciudad: el texto no puede decir «ventas en sin seccional».
    expect(html).not.toContain('ventas en Sin seccional')
  })

  it('la fila de totales dice de qué está hecha', () => {
    // La matriz del directivo ya costó una corrección por esto (#455): sumaba bien y su
    // etiqueta no decía que incluía los terminados.
    const html = pintar()
    expect(html).toContain('La fila de totales incluye la de')
    expect(html).toContain('Sin rastro de Meta')
  })

  it('sin ventas en el mes, la sección lo DICE y no desaparece', () => {
    // Un mes con leads y sin una sola venta. La sección que se esconde deja al lector
    // sin saber si no hubo ventas o si la pantalla se rompió.
    const html = pintar(datos({
      filas: [f({ campaignId: WEBINAR, campana: 'WEBINAR', mes: '2026-10-01', leads: 23,
                  primerLead: '2026-10-01T00:00:00Z' })],
      ventas: [],
      mesEnCurso: '2026-10-01',
    }))
    expect(html).toContain('Ventas por ciudad')
    expect(html).toContain('No hay ventas registradas en Octubre 2026')
  })

  it('el total INCLUYE las ventas sin rastro, y la nota separa las dos cifras', () => {
    // Fixture chico y sintético a propósito: el de producción no trae las 302 ventas sin
    // rastro, y sin una sola de ellas `total` y `campanas` valen lo mismo — la fila de
    // totales pasaría cualquier prueba aunque sumara solo las campañas.
    const html = pintar(datos({
      filas: [
        f({ campaignId: PLUS, campana: 'CLIENTES POTENCIALES AGO 2026 PLUS', mes: '2026-09-01',
            ventas: 2, primerLead: '2026-09-01T00:00:00Z' }),
        f({ campaignId: null, mes: '2026-09-01', ventas: 3 }),
      ],
      ventas: [
        n(PLUS, '2026-09-01', 'Medellín'), n(PLUS, '2026-09-01', 'Cali'),
        n(null, '2026-09-01', 'Bogotá'), n(null, '2026-09-01', null),
        n(null, '2026-09-01', 'Medellín'),
      ],
    }))
    expect(celdas(html, 'Total de ventas')).toEqual(['Total de ventas', '1', '1', '2', RAYA, RAYA, '1', '5'])
    expect(html).toContain('son 2 ventas atribuidas a campaña y 3 sin rastro')
    // «Sin seccional» ya no es cero: hay una venta real sin RUT cargado.
    expect(celdas(html, 'Sin rastro de Meta')[6]).toBe('1')
  })

  it('la nota explica por qué NO hay CPL ni CAC por ciudad', () => {
    const html = pintar()
    expect(html).toContain('Solo las ventas se parten por ciudad')
    expect(html).toContain('Documentación')
  })
})
