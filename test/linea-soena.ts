// ============================================================
// Línea GIT EV/HEV de SOENA (34a0fa6b-9ed3-4652-a419-42601132d1a8), leída de producción
// el 2026-09-14: `orden`, `numero`, `nombre`, `stage` y `config_extra.routing` tal cual.
//
// Se usa la real porque es la que destapó el defecto: el `orden` no es el recorrido
// (Revisión radicado es 20 y va antes de Certificación, 9; la rama de IVA es 16-17-18 y
// sigue en 13-14-19).
//
// ⚠️ En esta línea el `numero` SÍ coincide con el recorrido en cada fase. Una prueba que
// quiera caer si se ordena por `numero` tiene que barajar los números: con los reales,
// ordenar por `numero` da el mismo resultado y la prueba pasaría por la razón equivocada.
//
// Vive en `test/` para que vitest no lo recoja como suite.
// ============================================================

import type { EtapaDelSegmentador } from '../src/lib/negocios/linea-de-flujo'

export const LINEA_SOENA: EtapaDelSegmentador[] = [
  { orden: 1, numero: 1, nombre: 'Validación', stage: 'venta', routing: { conditional: [{ condition: { field: 'cargado_upme', value: 'no' }, etapa_orden: 2 }], default_etapa_orden: 4 } },
  { orden: 2, numero: 2, nombre: 'Inclusión', stage: 'venta', routing: { conditional: [], default_etapa_orden: 4 } },
  { orden: 4, numero: 3, nombre: 'Propuesta', stage: 'venta', routing: null },
  { orden: 5, numero: 4, nombre: 'Negociación', stage: 'venta', routing: null },
  { orden: 6, numero: 5, nombre: 'Documentación', stage: 'venta', routing: { conditional: [{ condition: { field: 'servicio', value: 'solo_iva' }, etapa_orden: 10 }], source_etapa_orden: 4, default_etapa_orden: 7 } },
  { orden: 7, numero: 6, nombre: 'Cargue', stage: 'ejecucion', routing: null },
  { orden: 8, numero: 7, nombre: 'Pago UPME', stage: 'cobro', routing: { conditional: [], default_etapa_orden: 20 } },
  { orden: 9, numero: 9, nombre: 'Certificación', stage: 'ejecucion', routing: null },
  { orden: 10, numero: 10, nombre: 'Segundo cobro', stage: 'venta', routing: null },
  { orden: 11, numero: 11, nombre: 'Cartera', stage: 'cobro', routing: { conditional: [{ condition: { field: 'requiere_cita_dian', value: 'true' }, etapa_orden: 16 }, { condition: { field: 'requiere_cita_dian', value: 'false' }, etapa_orden: 18 }], label_default: 'Si el caso trae certificado UPME', source_etapa_orden: 6, default_etapa_orden: 12 } },
  { orden: 12, numero: 12, nombre: 'Entrega', stage: 'venta', routing: { conditional: [{ condition: { field: 'requiere_cita_dian_iva', value: 'true' }, etapa_orden: 16 }, { condition: { field: 'requiere_cita_dian_iva', value: 'false' }, etapa_orden: 18 }], label_default: 'Si no requiere devolución de IVA', default_etapa_orden: 15 } },
  { orden: 13, numero: 16, nombre: 'Generación', stage: 'ejecucion', routing: null },
  { orden: 14, numero: 17, nombre: 'Envío', stage: 'ejecucion', routing: { conditional: [], default_etapa_orden: 19 } },
  { orden: 15, numero: 19, nombre: 'Facturación', stage: 'cobro', routing: { conditional: [], default_etapa_orden: 15 } },
  { orden: 16, numero: 13, nombre: 'Cita', stage: 'ejecucion', routing: { conditional: [{ condition: { field: 'via_solicitud', value: 'pqrs' }, etapa_orden: 17 }, { condition: { field: 'via_solicitud', value: 'agenda' }, etapa_orden: 18 }], label_default: 'Si no se registro la via', default_etapa_orden: 17 } },
  { orden: 17, numero: 14, nombre: 'Notificación', stage: 'ejecucion', routing: { conditional: [{ condition: { field: 'resultado_pqr', value: 'pqr_rechazado' }, etapa_orden: 16 }], label_default: 'Si la DIAN asignó la cita', default_etapa_orden: 18 } },
  { orden: 18, numero: 15, nombre: 'Anexos', stage: 'venta', routing: { conditional: [], default_etapa_orden: 13 } },
  { orden: 19, numero: 18, nombre: 'Seguimiento', stage: 'venta', routing: { conditional: [], default_etapa_orden: 15 } },
  { orden: 20, numero: 8, nombre: 'Revisión radicado', stage: 'ejecucion', routing: { conditional: [], default_etapa_orden: 9 } },
]
