/**
 * El segmentador de `/negocios`, pintado: nivel 1 las fases, nivel 2 las etapas de la fase
 * puesta, en orden de ocurrencia y con su contador.
 *
 * ⚠️ Por qué RENDER y no basta con las pruebas de `linea-de-flujo.ts` y de
 * `segmentador.ts`: los helpers pueden estar perfectos y el JSX seguir ordenando por
 * `orden`, o contar sobre la lista ya filtrada por la etapa. Ninguna prueba pura ve esa
 * diferencia (precedente: el aviso de otras pestañas, #611).
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Límite declarado: la suite corre en `node`, sin DOM, así que el clic no se ejercita.
 * El estado al que lleva un clic (`fase` + `etapa`) entra por la URL, que es de donde la
 * pantalla lo lee al cargar.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LINEA_SOENA } from '../../../../test/linea-soena'

vi.mock('./negocio-card', () => ({
  default: ({ negocio }: { negocio: { codigo: string | null } }) =>
    React.createElement('div', null, `tarjeta:${negocio.codigo}`),
}))
vi.mock('./descargar-excel-button', () => ({
  default: () => React.createElement('div', null, 'excel'),
}))

const { default: NegociosClient } = await import('./negocios-client')

const etapaPorNumero = new Map(LINEA_SOENA.map((e) => [e.numero, e]))
const numeroDe = (nombre: string) => LINEA_SOENA.find((e) => e.nombre === nombre)!.numero

const caso = (codigo: string, numero: number, estado = 'abierto') => {
  const etapa = etapaPorNumero.get(numero)!
  return {
    id: `id-${codigo}`,
    codigo,
    nombre: codigo,
    precio_estimado: null,
    precio_aprobado: null,
    carpeta_url: null,
    stage_actual: etapa.stage,
    estado,
    created_at: '2026-08-01T12:00:00Z',
    linea_nombre: null,
    linea_numero: null,
    etapa_nombre: etapa.nombre,
    etapa_numero: numero,
    etapa_stage: etapa.stage,
    empresa_nombre: null,
    contacto_nombre: null,
    contacto_telefono: null,
    costos_ejecutados: 0,
    pausado: false,
    pausado_hasta: null,
    motivo_pausa: null,
    closed_at: estado === 'abierto' ? null : '2026-09-01T12:00:00Z',
    razon_cierre: null,
    vehiculo_label: null,
    seccional_label: null,
    ciudad_label: null,
    cedula: null,
    radicado: null,
    numero_factura: null,
    fecha_cita: null,
    cita_pendiente: false,
    atencion_cita: null,
    servicio: null,
    servicio_label: null,
    responsables: [],
    es_meta_lead: false,
    reproceso: null,
    desenlaces: [],
    origen: null,
    aliado_nombre: null,
    marcas: [],
    etapa_cambiada_at: '2026-08-15T12:00:00Z',
    etapa_sla_horas: 24,
    horas_habiles_en_etapa: null,
    sla_exceso_horas: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// Ejecución: Cita (13) 3 casos, Revisión radicado (8) 1, Envío (17) 2. Venta: Seguimiento
// (18) 2, Propuesta (3) 1. Y un CERRADO que conserva la etapa Cita: una fase de stage lista
// solo abiertos, así que no cuenta.
const ABIERTOS = [
  caso('C1', 13),
  caso('C2', 13),
  caso('C3', 13),
  caso('R1', 8),
  caso('E1', 17),
  caso('E2', 17),
  caso('S1', 18),
  caso('S2', 18),
  caso('P1', 3),
]
const CERRADOS = [caso('Z1', 13, 'completado')]

const pintar = (searchParams: Record<string, string>, etapas = LINEA_SOENA) =>
  renderToStaticMarkup(
    React.createElement(NegociosClient, {
      negocios: ABIERTOS,
      cerrados: CERRADOS,
      stagesActivos: ['venta', 'ejecucion', 'cobro'],
      etapas,
      searchParams,
      hoyISO: '2026-09-14',
    }),
  )

/** El bloque de un nivel del segmentador, o null si no se pintó. */
const nivel = (html: string, cual: 'fases' | 'etapas') => {
  const m = html.match(new RegExp(`<div[^>]*data-nivel="${cual}"[^>]*>([\\s\\S]*?)</div>`))
  return m ? m[1] : null
}

/** Los botones de un nivel, en el orden del HTML, con su texto sin etiquetas. */
const botones = (bloque: string) =>
  [...bloque.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    atributos: m[1],
    texto: m[2].replace(/<[^>]+>/g, ''),
  }))

/** Las etapas del nivel 2 como `nombre·contador`, en el orden en que salen. */
const etapasPintadas = (html: string, etapas = LINEA_SOENA) => {
  const bloque = nivel(html, 'etapas')
  if (!bloque) return null
  const porNumero = new Map(etapas.map((e) => [e.numero, e]))
  return botones(bloque)
    .filter((b) => b.atributos.includes('data-etapa='))
    .map((b) => {
      const numero = Number(b.atributos.match(/data-etapa="(\d+)"/)![1])
      const nombre = porNumero.get(numero)!.nombre
      return `${nombre}·${b.texto.slice(nombre.length)}`
    })
}

const tarjetas = (html: string) => [...html.matchAll(/tarjeta:(\w+)/g)].map((m) => m[1]).sort()

describe('/negocios · segmentador de dos niveles', () => {
  it('pinta los dos niveles: las fases arriba y, debajo, las etapas de la fase puesta', () => {
    const html = pintar({ fase: 'ejecucion' })
    // Cada fase con su contador; Cobro sin casos no pinta número.
    const fases = botones(nivel(html, 'fases')!).map((b) => b.texto)
    expect(fases).toEqual(['Todos10', 'Comercial3', 'Operaciones6', 'Financiera', 'Cerrados1'])

    const etapas = nivel(html, 'etapas')!
    expect(botones(etapas)[0].texto).toBe('Todas')
    // Solo las etapas de Ejecución: ninguna de otra fase se cuela en el nivel 2.
    expect(etapasPintadas(html)!.every((e) => etapaPorNumero.get(numeroDe(e.split('·')[0]))!.stage === 'ejecucion')).toBe(true)
  })

  it('las etapas de la fase salen en orden de ocurrencia, con la rama de IVA después, no por `orden`', () => {
    expect(etapasPintadas(pintar({ fase: 'ejecucion' }))).toEqual([
      'Cargue·0', 'Revisión radicado·1', 'Certificación·0', 'Cita·3', 'Notificación·0', 'Generación·0', 'Envío·2',
    ])
    expect(etapasPintadas(pintar({ fase: 'venta' }))).toEqual([
      'Validación·0', 'Inclusión·0', 'Propuesta·1', 'Negociación·0', 'Documentación·0', 'Segundo cobro·0',
      'Entrega·0', 'Anexos·0', 'Seguimiento·2',
    ])
    expect(etapasPintadas(pintar({ fase: 'cobro' }))).toEqual(['Pago UPME·0', 'Cartera·0', 'Facturación·0'])
  })

  it('tampoco ordena por `numero`: con los números barajados el orden no se mueve', () => {
    // En SOENA el `numero` coincide hoy con el recorrido; se invierte para que ordenar por
    // `numero` dé otra cosa. Sin casos en estas etapas: aquí solo importa el orden.
    const renumerada = LINEA_SOENA.map((e) => ({ ...e, numero: 100 - e.numero }))
    const nombres = (html: string) => etapasPintadas(html, renumerada)!.map((e) => e.split('·')[0])
    expect(nombres(pintar({ fase: 'ejecucion' }, renumerada))).toEqual([
      'Cargue', 'Revisión radicado', 'Certificación', 'Cita', 'Notificación', 'Generación', 'Envío',
    ])
    expect(nombres(pintar({ fase: 'cobro' }, renumerada))).toEqual(['Pago UPME', 'Cartera', 'Facturación'])
  })

  it('el contador de una etapa no se filtra a sí mismo, y es el largo de la lista que abre', () => {
    const html = pintar({ fase: 'ejecucion', etapa: String(numeroDe('Cita')) })
    // Elegida Cita, las demás etapas conservan su número (no caen a cero).
    expect(etapasPintadas(html)).toContain('Revisión radicado·1')
    expect(etapasPintadas(html)).toContain('Envío·2')
    // Y el número de Cita es exactamente lo que se lista: los tres abiertos, sin el cerrado.
    expect(etapasPintadas(html)).toContain('Cita·3')
    expect(tarjetas(html)).toEqual(['C1', 'C2', 'C3'])
  })

  it('los contadores respetan los demás filtros', () => {
    const html = pintar({ fase: 'ejecucion', q: 'e1' })
    expect(etapasPintadas(html)).toContain('Envío·1')
    expect(etapasPintadas(html)).toContain('Cita·0')
  })

  it('en «Todos» y en «Cerrados» no hay nivel 2', () => {
    expect(nivel(pintar({ fase: 'todos' }), 'etapas')).toBeNull()
    expect(nivel(pintar({ fase: 'cerrados' }), 'etapas')).toBeNull()
    expect(nivel(pintar({ fase: 'todos' }), 'fases')).not.toBeNull()
  })

  it('una línea sin routing cae al `orden` de siempre', () => {
    const sinRouting = LINEA_SOENA.map((e) => ({ ...e, routing: null }))
    expect(etapasPintadas(pintar({ fase: 'ejecucion' }, sinRouting))!.map((e) => e.split('·')[0])).toEqual([
      'Cargue', 'Certificación', 'Generación', 'Envío', 'Cita', 'Notificación', 'Revisión radicado',
    ])
  })
})
