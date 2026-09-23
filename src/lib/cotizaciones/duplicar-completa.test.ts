/**
 * «Duplicar copia todo» (2026-09-22): las reglas puras de la copia completa.
 *
 * Lo que la base hace con ellas (un solo camino para los dos botones, la copia en
 * borrador, los adicionales colgados de la variante copia) se prueba llamando a las
 * acciones en `recomendada-tarifa-elegida-e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  adicionalParaLaCopia,
  cotizacionParaLaCopia,
  documentoClienteSinRevisar,
  itemParaLaCopia,
  itinerariosParaLaCopia,
  rubroParaLaCopia,
} from './duplicar-opciones'

describe('cotizacionParaLaCopia', () => {
  const original = {
    id: 'cot-1', workspace_id: 'ws-1', negocio_id: 'neg-1', oportunidad_id: null,
    consecutivo: 'COT-2026-0007', codigo: 'COT-2026-0007', estado: 'enviada', modo: 'detallada',
    descripcion: 'Cartagena', valor_total: 5_000_000, costo_total: 4_000_000,
    fecha_envio: '2026-09-20T10:00:00Z', fecha_validez: '2026-10-20', email_enviado_a: 'cliente@x.co',
    tarifa_aceptada_id: 'it-pre', duplicada_de: 'cot-0',
    created_at: '2026-09-19T10:00:00Z', updated_at: '2026-09-20T10:00:00Z',
    margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta',
    piso_margen_pct: 5, aviso_margen_pct: 10,
    lugar_entrega: 'Bogotá', anticipo_pct: 50, terminos_condiciones: 'Pago contra reserva',
    documento_cliente: {
      intro: 'Hola', revisado_en: '2026-09-21T10:00:00Z', revisado_por: 'p-1', revisado_por_nombre: 'Ale', fuente_hash: 'abc',
    },
  }
  const copia = cotizacionParaLaCopia(original, {
    workspaceId: 'ws-1', consecutivo: 'COT-2026-0010', descripcion: 'Cartagena (2)', originalId: 'cot-1',
  })

  it('nace en borrador, con identidad propia y apuntando a la original', () => {
    expect(copia.estado).toBe('borrador')
    expect(copia.consecutivo).toBe('COT-2026-0010')
    expect(copia.codigo).toBe('')
    expect(copia.descripcion).toBe('Cartagena (2)')
    expect(copia.duplicada_de).toBe('cot-1')
    expect(copia).not.toHaveProperty('id')
    expect(copia).not.toHaveProperty('created_at')
    expect(copia).not.toHaveProperty('updated_at')
  })

  it('NO copia lo que dejó el envío ni la elección del cliente', () => {
    expect(copia).not.toHaveProperty('fecha_envio')
    expect(copia).not.toHaveProperty('fecha_validez')
    expect(copia).not.toHaveProperty('email_enviado_a')
    expect(copia).not.toHaveProperty('tarifa_aceptada_id')
  })

  it('SÍ copia todo lo demás: la cascada, los umbrales y las condiciones comerciales', () => {
    expect(copia).toMatchObject({
      negocio_id: 'neg-1', modo: 'detallada', margen_default_pct: 15, convencion_margen: 'sobre_venta',
      piso_margen_pct: 5, aviso_margen_pct: 10, lugar_entrega: 'Bogotá', anticipo_pct: 50,
      terminos_condiciones: 'Pago contra reserva', valor_total: 5_000_000,
    })
    // `null` se copia como `null`: «usa el de la línea» no puede volverse un 0.
    expect(copia.margen_porcentaje).toBeNull()
  })

  it('el texto del cliente viaja, pero vuelve a borrador: nadie lo revisó para la copia', () => {
    expect(copia.documento_cliente).toEqual({
      intro: 'Hola', revisado_en: null, revisado_por: null, revisado_por_nombre: null, fuente_hash: 'abc',
    })
    // Y la original no se tocó: la copia es otro objeto.
    expect(original.documento_cliente.revisado_en).toBe('2026-09-21T10:00:00Z')
  })

  it('una columna NUEVA de la cotización viaja sola (lista de exclusión, no de inclusión)', () => {
    const conNueva = cotizacionParaLaCopia({ ...original, columna_del_futuro: 'x' }, {
      workspaceId: 'ws-1', consecutivo: 'C', descripcion: null, originalId: 'cot-1',
    })
    expect(conNueva.columna_del_futuro).toBe('x')
  })

  it('el workspace sale de la sesión, no de la fila', () => {
    const otra = cotizacionParaLaCopia({ ...original, workspace_id: 'ws-ajeno' }, {
      workspaceId: 'ws-1', consecutivo: 'C', descripcion: null, originalId: 'cot-1',
    })
    expect(otra.workspace_id).toBe('ws-1')
  })

  it('sin la columna del texto del cliente, no la nombra', () => {
    const { documento_cliente: _d, ...sinTexto } = original
    const c = cotizacionParaLaCopia(sinTexto, {
      workspaceId: 'ws-1', consecutivo: 'C', descripcion: null, originalId: 'cot-1',
    })
    expect(c).not.toHaveProperty('documento_cliente')
  })
})

describe('documentoClienteSinRevisar', () => {
  it('sin texto deja null', () => {
    expect(documentoClienteSinRevisar(null)).toBeNull()
    expect(documentoClienteSinRevisar(undefined)).toBeNull()
  })
})

describe('itemParaLaCopia, rubroParaLaCopia, adicionalParaLaCopia', () => {
  it('la línea viaja entera —tarifa por pasajero con sus correcciones— menos su identidad y su vínculo', () => {
    const tarifaPax = {
      casillas: { grupo: { precio: 1_000_000 } },
      confirmada: { total: 1_000_000 },
      correcciones: { hora_salida: { valor: '07:10', por: 'Ale' } },
    }
    const item = {
      id: 'wingo', cotizacion_id: 'cot-1', created_at: 'x', opcion_de: 'avianca', rubros: [{ id: 'r1' }],
      nombre: 'WINGO', grupo: 'vuelo', margen_porcentaje: null, precio_manual: true, tarifa_pax: tarifaPax,
      base_iva: 'ingreso_propio', entra_al_precio: true, servicio_origen_id: 'srv-1',
    }
    expect(itemParaLaCopia(item, 'cot-2')).toEqual({
      cotizacion_id: 'cot-2', nombre: 'WINGO', grupo: 'vuelo', margen_porcentaje: null, precio_manual: true,
      tarifa_pax: tarifaPax, base_iva: 'ingreso_propio', entra_al_precio: true, servicio_origen_id: 'srv-1',
    })
  })

  it('el rubro viaja con su marca de sugerido y sin la columna calculada', () => {
    expect(rubroParaLaCopia(
      { id: 'r1', item_id: 'wingo', tipo: 'servicios_prof', cantidad: 2, valor_unitario: 500, valor_total: 1000, sugerido: true },
      'wingo-2',
    )).toEqual({ item_id: 'wingo-2', tipo: 'servicios_prof', cantidad: 2, valor_unitario: 500, sugerido: true })
  })

  it('el adicional cuelga de la variante COPIA', () => {
    expect(adicionalParaLaCopia(
      { id: 'a1', item_id: 'avianca', created_at: 'x', codigo: 'maleta', cantidad: 2, costo: 100, precio: 120, moneda: 'COP' },
      'avianca-2',
    )).toEqual({ item_id: 'avianca-2', codigo: 'maleta', cantidad: 2, costo: 100, precio: 120, moneda: 'COP' })
  })
})

describe('itinerariosParaLaCopia · el motivo de la tarifa viaja, si la base lo tiene', () => {
  const mapa = new Map([['avianca', 'c-avianca']])

  it('con las columnas, copia el motivo', () => {
    const [c] = itinerariosParaLaCopia(
      [{
        id: 'it', nombre: 'Recomendada', orden: 2, va_en_propuesta: true, es_principal: true,
        seleccion: ['avianca'], motivo_codigo: 'horario', motivo_texto: 'sale temprano',
      }],
      mapa, 'cot-2', 'ws-1',
    )
    expect(c.cabecera).toMatchObject({ motivo_codigo: 'horario', motivo_texto: 'sale temprano' })
  })

  it('sin las columnas, no las nombra: nombrarlas tumbaría la copia con un 42703', () => {
    const [c] = itinerariosParaLaCopia(
      [{ id: 'it', nombre: 'Recomendada', orden: 2, va_en_propuesta: true, es_principal: true, seleccion: ['avianca'] }],
      mapa, 'cot-2', 'ws-1',
    )
    expect(c.cabecera).not.toHaveProperty('motivo_codigo')
    expect(c.cabecera).not.toHaveProperty('motivo_texto')
  })
})
