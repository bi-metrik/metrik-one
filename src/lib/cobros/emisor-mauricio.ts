/**
 * Constantes del emisor (Brallan Mauricio Moreno Guzmán persona natural).
 *
 * Fuente canónica: cerebro/reglas/cuenta-cobro-persona-natural-mauricio.md
 * y cerebro/conceptos/cobros-recurrentes-metrik.md
 *
 * Datos verificados contra RUT (cerebro/documentos-legales/mauricio/RUT_1016044186.pdf)
 * y certificado bancario (verificado en sesión 2026-05-15).
 *
 * CAMBIOS REQUIEREN:
 * - RUT actualizado: tocar campos CIIU + dirección + responsabilidades RUT
 * - Cambio bancario: tocar BANCO_* tras nuevo certificado
 * - Cambio régimen tributario (ej. constitución SAS): tocar REGIMEN + REVISAR TEMPLATE
 */

export const EMISOR_MAURICIO = {
  // Identidad legal
  nombre: 'Brallan Mauricio Moreno Guzmán',
  documento_tipo: 'CC',
  documento_numero: '1.016.044.186',
  documento_dv: '1',
  documento_completo: '1.016.044.186-1',

  // Domicilio fiscal
  direccion: 'CL 24 A BIS 100 71, Bogotá D.C.',
  ciudad: 'Bogotá D.C.',

  // Contacto
  email: 'mauricio.moreno@metrik.com.co',
  telefono: '+57 320 291 9444',

  // Tributario
  regimen: 'Persona natural — Renta ordinaria',
  responsabilidades_rut: ['05', '22'],
  responsable_iva: false,
  obligado_factura_electronica: false,

  // Actividad económica (CIIU Rev. 4)
  ciiu_codigo: '6201',
  ciiu_descripcion: 'Desarrollo de sistemas informáticos',
  ciiu_full: '6201 — Desarrollo de sistemas informáticos',

  // Declaración de juramento — año gravable declarado
  // Se actualiza cada año después de presentar renta:
  //   En 2026 declara 2024 (presentada 2025)
  //   En 2027 declara 2025 (presentada 2026)
  // Helper que devuelve año correcto según fecha actual abajo
  declarante_renta: true,

  // Banco para recibir pagos
  banco: {
    nombre: 'Banco Falabella S.A.',
    tipo: 'Ahorros',
    numero: '111810431095',
    titular: 'Brallan Mauricio Moreno Guzmán',
    identificacion: 'CC 1.016.044.186',
  },
} as const

/**
 * Año gravable a declarar en la declaración bajo gravedad de juramento.
 *
 * Regla: el año gravable más reciente cuya declaración ya fue presentada.
 * Las declaraciones de renta de personas naturales se presentan en agosto-octubre
 * del año siguiente al gravable. Por simplicidad, asumimos que desde el 1 de
 * enero de cada año, ya se considera "presentado" el año anterior (lo cual es
 * cierto para Mauricio que presenta a tiempo).
 *
 * Ej:
 *   En 2026 (cualquier mes) → declara año gravable 2024
 *   En 2027 (cualquier mes) → declara año gravable 2025
 *
 * Si Mauricio NO declara renta de un año dado (porque cayó por debajo del tope),
 * se debe ajustar manualmente la cuenta de cobro a tarifa 6% (no declarante).
 */
export function getAnioGravableDeclaracion(fechaEmision: Date = new Date()): number {
  return fechaEmision.getFullYear() - 2
}
