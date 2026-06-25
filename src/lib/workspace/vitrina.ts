import 'server-only'

/**
 * Copys comerciales por defecto del modo vitrina (voz de marca — Mateo).
 * NO modificar sin pasar por marketing. Se pueden sobrescribir por workspace vía
 * `workspaces.config_extra.vitrina_copy` ({ tableros, numeros }).
 */
export const VITRINA_COPY_DEFAULT = {
  numeros:
    'Esta es una muestra de lo que MeTRIK ONE puede darte: facturación, márgenes y EBITDA de tu negocio en un solo lugar. Hoy usas Valida para cumplir; imagina toda tu operación con la misma claridad.',
  tableros:
    'Aquí vivirían tus tableros de seguimiento y control —vencimientos, citas, ingresos, cumplimiento— en tiempo real y sin hojas de cálculo. Se construyen a la medida de tu negocio. Hablemos.',
} as const

export interface VitrinaCopy {
  numeros: string
  tableros: string
}

/**
 * Resuelve si un workspace está en modo vitrina y, de estarlo, devuelve las copys
 * comerciales (override de `config_extra.vitrina_copy` fusionado sobre los defaults).
 *
 * Devuelve `null` cuando NO es vitrina → el caller sigue el flujo normal del módulo.
 * Opt-in puro: workspaces sin el flag se comportan idéntico a hoy.
 *
 * Lee `config_extra` server-side (nunca llega al cliente). Acepta el cliente
 * Supabase ya resuelto por `getWorkspace` (authenticated o service en dev override).
 */
export async function getVitrinaCopy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string | null,
): Promise<VitrinaCopy | null> {
  if (!supabase || !workspaceId) return null

  const { data } = await supabase
    .from('workspaces')
    .select('config_extra')
    .eq('id', workspaceId)
    .single()

  const configExtra = (data?.config_extra ?? null) as {
    modo_vitrina?: boolean
    vitrina_copy?: Partial<VitrinaCopy> | null
  } | null

  if (configExtra?.modo_vitrina !== true) return null

  const override = configExtra.vitrina_copy ?? {}
  return {
    numeros: override.numeros ?? VITRINA_COPY_DEFAULT.numeros,
    tableros: override.tableros ?? VITRINA_COPY_DEFAULT.tableros,
  }
}
