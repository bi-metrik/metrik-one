/**
 * Foto de los 17 workspaces de producción, medida el 2026-09-15 por PostgREST (solo lectura):
 * `workspaces.modules` tal cual, `config_extra.modo_vitrina` y si el workspace tiene al menos
 * una `lineas_negocio` activa (lo que enciende "Workflows" en el menú).
 *
 * Es la base de las pruebas del gate: lo que tiene que seguir abriendo para cada workspace
 * real, y lo que el menú no puede ofrecer. Una foto envejece; si un workspace cambia de
 * módulos, se remide y se reemplaza el archivo con su fecha nueva, no se edita a mano.
 */
export interface WorkspaceMedido {
  slug: string
  modules: Record<string, boolean>
  modoVitrina: boolean
  hasLineas: boolean
}

export const WORKSPACES_2026_09_15: readonly WorkspaceMedido[] = [
  { slug: 'advise', modules: { wa_customer_bot: true, calidad_llamadas: true, fab_registrar_cobro: true }, modoVitrina: false, hasLineas: true },
  { slug: 'afi', modules: { business: true, valida_consulta: true }, modoVitrina: false, hasLineas: true },
  { slug: 'alma-afi', modules: { compliance: true, pausa_enabled: false, compliance_validacion: false, compliance_vinculacion: true, pausa_sla_auto_enabled: false, compliance_dual_informa: true }, modoVitrina: false, hasLineas: false },
  { slug: 'ana-demo', modules: { business: true, pausa_enabled: false, fab_registrar_cobro: true, fab_registrar_horas: true, pausa_sla_auto_enabled: false }, modoVitrina: false, hasLineas: true },
  { slug: 'cda-caqueta', modules: { valida_consulta: true }, modoVitrina: true, hasLineas: false },
  { slug: 'cda-elcarmen', modules: { valida_consulta: true }, modoVitrina: true, hasLineas: false },
  { slug: 'cda-puertotest', modules: { valida_consulta: true }, modoVitrina: true, hasLineas: false },
  { slug: 'dimpro', modules: { business: true, causacion: true, pausa_enabled: false, fab_registrar_horas: true, pausa_sla_auto_enabled: false }, modoVitrina: false, hasLineas: false },
  { slug: 'hjbc', modules: { business: true, rentabilidad_comercial: true }, modoVitrina: false, hasLineas: false },
  { slug: 'maxitec', modules: { valida_consulta: true }, modoVitrina: true, hasLineas: false },
  { slug: 'metrik', modules: { business: true, centro_costos: true, pausa_enabled: false, valida_consulta: true, compliance_audit: true, cobros_recurrentes: true, fab_registrar_cobro: true, pausa_sla_auto_enabled: false }, modoVitrina: false, hasLineas: true },
  { slug: 'regat', modules: { calidad_llamadas: true }, modoVitrina: false, hasLineas: false },
  { slug: 'reposteria-dulce-hogar', modules: { business: true }, modoVitrina: false, hasLineas: false },
  { slug: 'soena', modules: { aliados: true, business: true, conciliacion: true, pausa_enabled: true, fab_pago_epayco: true, proceso_semanal: true, operaciones_bonos: true, comercial_negocios: true, fab_registrar_pago: true, marketing_campanas: true, fab_registrar_cobro: true, pausa_sla_auto_enabled: false }, modoVitrina: false, hasLineas: true },
  { slug: 'termotech', modules: { business: true, fab_registrar_pago: true }, modoVitrina: false, hasLineas: true },
  { slug: 'trappvel', modules: { business: true }, modoVitrina: false, hasLineas: true },
  { slug: 'wmc-sm', modules: { cert_qr: true, business: true, causacion: true, centro_costos: true, pausa_enabled: false, pausa_sla_auto_enabled: false }, modoVitrina: false, hasLineas: true },
]

export function workspaceMedido(slug: string): WorkspaceMedido {
  const w = WORKSPACES_2026_09_15.find((x) => x.slug === slug)
  if (!w) throw new Error(`No hay workspace medido con slug ${slug}`)
  return w
}
