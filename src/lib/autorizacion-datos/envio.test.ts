/**
 * Sin autorización de datos se puede armar la cotización, pero no enviarla (reunión con Trappvel
 * del 2026-10-22, punto 4). Datos ficticios.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const estado = vi.hoisted(() => ({ generales: false, menores: false, error: null as string | null }))
vi.mock('./servidor', () => ({
  estadoDelContacto: async () => ({
    estado: { existe: true, vigente: { generales: estado.generales, menores: estado.menores }, requiere_reaceptar: false, pendiente: null, manual_sin_evidencia: null },
    error: estado.error,
  }),
}))

import { base, clienteFalso, type Fila } from '../../../test/cotizacion-pdf-doble'
import { autorizacionParaEnviar, lineaExigeAutorizacion, MENSAJE_ENVIO, motivoAutorizacionDeCotizacion, motivoAutorizacionParaEnviar } from './envio'
import { listaUnica } from '@/lib/cotizaciones/lista-unica'

const WS = 'ws-agencia'

function sembrar(gates: { e1: string[]; e2: string[] }, contacto: string | null = 'c-1', menores = 0) {
  base.tablas = {
    negocios: [{ id: 'neg-1', workspace_id: WS, linea_id: 'linea-viaje', contacto_id: contacto }],
    lineas_negocio: [{ id: 'linea-viaje', config_extra: {} }],
    etapas_negocio: [
      { id: 'e1', linea_id: 'linea-viaje', numero: 1, config_extra: { gates: gates.e1 } },
      { id: 'e2', linea_id: 'linea-viaje', numero: 2, config_extra: { gates: gates.e2 } },
    ],
    negocio_bloques: [{ negocio_id: 'neg-1', data: { adultos: 2, ninos: menores } }],
    cotizaciones: [{ id: 'cot-1', negocio_id: 'neg-1', workspace_id: WS }],
  } as Record<string, Fila[]>
}

beforeEach(() => {
  estado.generales = false
  estado.menores = false
  estado.error = null
})

describe('¿la línea pide la autorización?', () => {
  it('en cualquier etapa (antes o después de mover el gate a Cotización)', () => {
    expect(lineaExigeAutorizacion([{ config_extra: { gates: ['autorizacion_datos'] } }, { config_extra: { gates: ['margen_sobre_piso'] } }])).toBe(true)
    expect(lineaExigeAutorizacion([{ config_extra: { gates: ['margen_sobre_piso'] } }, { config_extra: null }])).toBe(false)
  })
})

describe('enviar sin la autorización', () => {
  it('con el gate en Cotización (después del SQL) y sin firma: no se envía, con el motivo en llano', async () => {
    sembrar({ e1: [], e2: ['margen_sobre_piso', 'autorizacion_datos'] })
    expect(await autorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1' })).toEqual({ aplica: true, falta: 'generales' })
    expect(await motivoAutorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1' })).toBe(MENSAJE_ENVIO.generales)
    expect(MENSAJE_ENVIO.generales).toMatch(/se puede armar, pero no enviar/)
  })

  it('con el gate todavía en Solicitud (antes del SQL) también frena enviar', async () => {
    sembrar({ e1: ['autorizacion_datos'], e2: ['margen_sobre_piso'] })
    expect((await autorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1' })).falta).toBe('generales')
  })

  it('autorizado, sale; con menores en el viaje, exige también esa casilla', async () => {
    sembrar({ e1: [], e2: ['autorizacion_datos'] })
    estado.generales = true
    expect(await motivoAutorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1' })).toBeNull()
    sembrar({ e1: [], e2: ['autorizacion_datos'] }, 'c-1', 1)
    expect(await motivoAutorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1' })).toBe(MENSAJE_ENVIO.menores)
  })

  it('sin contacto o sin poder leer, no sale (falla cerrado)', async () => {
    sembrar({ e1: [], e2: ['autorizacion_datos'] }, null)
    expect(await motivoAutorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1' })).toBe(MENSAJE_ENVIO.sin_contacto)
    sembrar({ e1: [], e2: ['autorizacion_datos'] })
    estado.error = 'rpc caída'
    expect(await motivoAutorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1' })).toBe(MENSAJE_ENVIO.error)
  })

  it('una línea que no pide la autorización (SOENA, AFI…) no cambia en nada', async () => {
    sembrar({ e1: [], e2: ['margen_sobre_piso'] })
    expect(await autorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1' })).toEqual({ aplica: false, falta: null })
    expect(await motivoAutorizacionParaEnviar(clienteFalso(), { workspaceId: WS, negocioId: null })).toBeNull()
  })

  it('con el negocio embebido en la lectura de la cotización (la ida que ya hacen Enviar y Aprobar)', async () => {
    sembrar({ e1: [], e2: ['autorizacion_datos'] })
    const { data } = await clienteFalso().from('cotizaciones').select('negocio_id, negocio_envio:negocios!cotizaciones_negocio_id_fkey(linea_id)').eq('id', 'cot-1').maybeSingle()
    expect(await motivoAutorizacionDeCotizacion(clienteFalso(), { workspaceId: WS, negocioId: 'neg-1', negocio: (data as Fila).negocio_envio })).toBe(MENSAJE_ENVIO.generales)
  })
})

describe('la lista de «Revisar y enviar» lo dice primero', () => {
  it('es lo primero que impide enviar', () => {
    const l = listaUnica({
      autorizacionDatos: MENSAJE_ENVIO.generales,
      sinPrecio: [], capturas: { motivo: 'Capturas de otros pasajeros', itemId: null }, tarifas: [], salida: null,
      pantallazosPorAceptar: 0, texto: 'ok', noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
    })
    expect(l.impide.map(r => r.clave)).toEqual(['autorizacion-datos', 'capturas'])
  })
})
