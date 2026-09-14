/**
 * La línea de flujo de `/negocios`, pintada: orden del recorrido, fase resaltada, conteos
 * y color por atrasados.
 *
 * ⚠️ Por qué RENDER y no basta con las pruebas de `linea-de-flujo.ts` y de
 * `contarLineaDeFlujo`: los helpers pueden estar perfectos y el JSX seguir ordenando por
 * `orden`, filtrar las etapas de la fase o contar con la fase puesta. Ninguna prueba pura
 * ve esa diferencia (precedente: el aviso de otras pestañas, #611).
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Límite declarado: la suite corre en `node`, sin DOM, así que ni el clic ni el
 * desplazamiento horizontal se ejercitan. Lo que sí se fija es que el estado al que lleva
 * el clic (`fase` de la etapa + `etapa`) lista exactamente los casos que el número promete.
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

const caso = (codigo: string, numero: number, exceso: number | null, estado = 'abierto') => {
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
    etapa_sla_horas: etapa.sla_horas,
    horas_habiles_en_etapa: null,
    sla_exceso_horas: exceso,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// Cita (13): 3 abiertos, 2 atrasados → mayoría. Seguimiento (18): 4 abiertos, 1 atrasado →
// algunos. Propuesta (3): 2 a tiempo. Y un CERRADO que conserva la etapa Cita: la fase Todos
// lo cuenta, el clic en Cita (que pone Ejecución) no lo abre.
const ABIERTOS = [
  caso('C1', 13, 10),
  caso('C2', 13, -5),
  caso('C3', 13, 3),
  caso('S1', 18, 5),
  caso('S2', 18, -1),
  caso('S3', 18, -1),
  caso('S4', 18, -1),
  caso('P1', 3, -2),
  caso('P2', 3, -2),
]
const CERRADOS = [caso('Z1', 13, null, 'completado')]

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

/** Los `data-etapa` en el orden en que salen en el HTML. */
const ordenEnPantalla = (html: string) => [...html.matchAll(/data-etapa="(\d+)"/g)].map((m) => Number(m[1]))

/** La etiqueta `<button>` de una etapa, con su contenido. */
const boton = (html: string, numero: number) => {
  const m = html.match(new RegExp(`<button[^>]*data-etapa="${numero}"[^>]*>([\\s\\S]*?)</button>`))
  if (!m) throw new Error(`sin botón para la etapa ${numero}`)
  return { etiqueta: m[0], texto: m[1].replace(/<[^>]+>/g, '') }
}

describe('/negocios · línea de flujo', () => {
  it('se ven TODAS las etapas en el orden del recorrido, no por `orden`', () => {
    const html = pintar({ fase: 'ejecucion' })
    const orden = ordenEnPantalla(html).map((n) => etapaPorNumero.get(n)!.nombre)
    expect(orden).toEqual([
      'Validación', 'Inclusión', 'Propuesta', 'Negociación', 'Documentación', 'Cargue', 'Pago UPME',
      'Revisión radicado', 'Certificación', 'Segundo cobro', 'Cartera', 'Entrega', 'Facturación',
      'Cita', 'Notificación', 'Anexos', 'Generación', 'Envío', 'Seguimiento',
    ])
  })

  it('la rama de IVA va en el segundo renglón', () => {
    const html = pintar({ fase: 'todos' })
    for (const nombre of ['Cita', 'Notificación', 'Anexos', 'Generación', 'Envío', 'Seguimiento']) {
      const numero = LINEA_SOENA.find((e) => e.nombre === nombre)!.numero
      expect(html).toMatch(new RegExp(`data-fila="2"[^>]*>(?:(?!data-fila=)[\\s\\S])*?data-etapa="${numero}"`))
    }
    expect(html).toMatch(/data-fila="1"[^>]*>(?:(?!data-fila=)[\s\S])*?data-etapa="12"/)
  })

  it('con una fase puesta solo se resaltan sus etapas; las demás siguen ahí, tenues', () => {
    const html = pintar({ fase: 'ejecucion' })
    const resaltadas = [...html.matchAll(/data-etapa="(\d+)" data-en-fase="si"/g)].map((m) =>
      etapaPorNumero.get(Number(m[1]))!.nombre,
    )
    expect(resaltadas.sort()).toEqual(
      ['Cargue', 'Certificación', 'Cita', 'Envío', 'Generación', 'Notificación', 'Revisión radicado'].sort(),
    )
    expect(boton(html, 18).etiqueta).toContain('data-en-fase="no"')
    expect(boton(html, 18).etiqueta).toContain('opacity-40')
  })

  it('con «Todos» se resalta todo', () => {
    const html = pintar({ fase: 'todos' })
    expect(html).not.toContain('data-en-fase="no"')
  })

  it('en «Cerrados» la línea no aplica', () => {
    const html = pintar({ fase: 'cerrados' })
    expect(ordenEnPantalla(html)).toEqual([])
  })

  it('cada etapa muestra su conteo y sus atrasados; el color lo deciden los atrasados', () => {
    const html = pintar({ fase: 'todos' })
    const cita = boton(html, 13)
    expect(cita.etiqueta).toContain('title="Cita · 3 casos · 2 atrasados"')
    expect(cita.texto).toContain('2 atrasados')
    expect(cita.etiqueta).toContain('data-nivel="mayoria"')

    // Seguimiento tiene MÁS casos que Cita y va menos alarmada: manda el atraso, no el volumen.
    const seguimiento = boton(html, 18)
    expect(seguimiento.etiqueta).toContain('title="Seguimiento · 4 casos · 1 atrasado"')
    expect(seguimiento.etiqueta).toContain('data-nivel="algunos"')

    expect(boton(html, 3).etiqueta).toContain('data-nivel="al_dia"')
    expect(boton(html, 3).texto).not.toContain('atrasado')
  })

  it('una etapa sin SLA no se pinta de alerta', () => {
    const sinSlaEnCita = LINEA_SOENA.map((e) => (e.numero === 13 ? { ...e, sla_horas: null } : e))
    const cita = boton(pintar({ fase: 'todos' }, sinSlaEnCita), 13)
    expect(cita.etiqueta).toContain('data-nivel="sin_sla"')
    expect(cita.etiqueta).toContain('sin SLA')
  })

  it('el número de la etapa es el largo de la lista que abre su clic (sin los cerrados de Todos)', () => {
    // «Todos» cuenta el cerrado Z1 en la etapa Cita; la línea no.
    expect(boton(pintar({ fase: 'todos' }), 13).etiqueta).toContain('3 casos')
    // El clic en Cita pone su fase (Ejecución) y su etapa: esa lista tiene 3 tarjetas.
    const abierto = pintar({ fase: 'ejecucion', etapa: '13' })
    expect([...abierto.matchAll(/tarjeta:(\w+)/g)].map((m) => m[1]).sort()).toEqual(['C1', 'C2', 'C3'])
    expect(boton(abierto, 13).etiqueta).toContain('aria-pressed="true"')
  })

  it('los conteos respetan los demás filtros', () => {
    const html = pintar({ fase: 'todos', q: 'c1' })
    expect(boton(html, 13).etiqueta).toContain('title="Cita · 1 caso · 1 atrasado"')
    expect(boton(html, 18).etiqueta).toContain('title="Seguimiento · 0 casos · 0 atrasados"')
  })

  it('una línea sin routing cae al `orden` de siempre', () => {
    const sinRouting = LINEA_SOENA.map((e) => ({ ...e, routing: null }))
    const html = pintar({ fase: 'todos' }, sinRouting)
    const porOrden = [...LINEA_SOENA].sort((a, b) => a.orden - b.orden).map((e) => e.numero)
    expect(ordenEnPantalla(html)).toEqual(porOrden)
    expect(html).not.toContain('data-fila="2"')
  })
})
