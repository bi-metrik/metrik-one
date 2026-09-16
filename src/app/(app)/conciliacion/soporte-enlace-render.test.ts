/**
 * El enlace al SOPORTE de un pago externo, en el panel de Tesoreria.
 *
 * Un soporte de pago es la captura de una transferencia bancaria. Hasta el 2026-09-16 el
 * archivo nacia abierto en Drive a cualquiera con el enlace, sin vencimiento, y la
 * pantalla mandaba ahi. Esta prueba fija que el JSX ya no lo haga: una prueba pura del
 * helper sigue verde con `href={pago.soporte.url}` puesto.
 *
 * Mismo patron que `factura-en-tesoreria-render.test.ts`: `renderToStaticMarkup` sin DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type {
  PagoExternoFila,
  PanelPagosExternos,
  SoportePago,
} from '@/lib/actions/pagos-externos'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

import { FilaPago } from './pagos-externos-tab'

const URL_DRIVE = 'https://drive.google.com/file/d/1XXWDr1OfnAL8UwZTalaw7vqgjMCm7CNC/view'
const ID_DRIVE = '1XXWDr1OfnAL8UwZTalaw7vqgjMCm7CNC'
const COBRO = '4013ee2b-6bb9-4454-9a11-0b1c2d3e4f50'
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'

const soporteEnDrive: SoportePago = {
  url: URL_DRIVE,
  file_name: 'PHOTO-2026-09-04.jpg',
  mime_type: 'image/jpeg',
  drive_file_id: ID_DRIVE,
  storage_path: `${WS}/pagos-externos/abc.jpg`,
  subido_en: '2026-09-08T14:17:56.642Z',
  pendiente_de_drive: false,
}

function pagoFalso(soporte: SoportePago | null): PagoExternoFila {
  return {
    cobro_id: COBRO,
    referencia: 'REF-1',
    referencia_label: 'REF-1',
    referencia_autogenerada: false,
    monto: 1_020_000,
    fecha: '2026-09-04',
    fuente: 'davivienda',
    negocio_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    negocio_codigo: 'V0200',
    negocio_nombre: 'Caso de prueba',
    empresa: null,
    notas: null,
    registrado_por: 'Alguien',
    registrado_en: '2026-09-08T14:17:56.642Z',
    soporte,
    anulado: false,
    anulado_en: null,
    anulado_por: null,
    anulacion_motivo: null,
    ref_negocios: 1,
    ref_estado: 'cuadra',
    ref_total: 1_020_000,
    ref_asignado: 1_020_000,
    ref_sin_asignar: 0,
    ref_excedente: 0,
  }
}

const panel: PanelPagosExternos = {
  pagos: [],
  workspace_id: WS,
  puede_gestionar: false,
  soporte_obligatorio: true,
  cuentas: [],
  max_largo_referencia: 40,
  min_largo_motivo: 10,
}

const pintar = (soporte: SoportePago | null): string =>
  renderToStaticMarkup(
    React.createElement(FilaPago, { pago: pagoFalso(soporte), panel, onCambio: () => {} }),
  )

describe('el enlace al soporte de un pago externo', () => {
  it('NO manda a Drive: pasa por la ruta de ONE, con el id del cobro', () => {
    const html = pintar(soporteEnDrive)
    expect(html).toContain(`href="/api/archivos/cobro?cobro=${COBRO}&amp;doc=soporte"`)
    expect(html).not.toContain('drive.google.com')
    expect(html).not.toContain(ID_DRIVE)
  })

  it('un soporte que quedo en Storage sigue por la puerta que firma', () => {
    const ref = `one://ve-documentos/${WS}/pagos-externos/abc.jpg`
    const html = pintar({ ...soporteEnDrive, url: ref, drive_file_id: null, pendiente_de_drive: true })
    expect(html).toContain('/api/archivos/abrir?ref=')
    expect(html).not.toContain('/api/archivos/cobro')
  })

  it('sin soporte no hay enlace, y se dice', () => {
    const html = pintar(null)
    expect(html).toContain('Sin soporte')
    expect(html).not.toContain('/api/archivos/')
  })
})
