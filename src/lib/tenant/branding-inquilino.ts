import 'server-only'
import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Branding publico de un inquilino resuelto por su slug, SIN sesion.
 *
 * Lo consumen tres superficies que tienen que coincidir o el enlace miente:
 * el `/login` del subdominio (el logo que se pinta), su `generateMetadata`
 * (si hay tarjeta propia o se hereda la generica) y el handler que dibuja esa
 * tarjeta. Vive aqui, y no copiado en cada una, porque el dia que una resuelva
 * distinto de las otras el sintoma seria una vista previa que no corresponde
 * con la pagina.
 *
 * Solo salen `name` y `logo_url`: el service role no cruza al browser.
 *
 * `cache()` lo deduplica dentro de una misma peticion, asi que `generateMetadata`
 * y el render de la pagina comparten UNA sola consulta.
 */

export type BrandingInquilino = {
  name: string
  logoUrl: string | null
}

export const brandingInquilino = cache(
  async (slug: string): Promise<BrandingInquilino | null> => {
    if (!slug) return null

    const svc = createServiceClient()
    const { data } = await svc
      .from('workspaces')
      .select('name, logo_url')
      .eq('slug', slug)
      .single()

    if (!data) return null
    return { name: data.name, logoUrl: data.logo_url }
  }
)

/**
 * Un slug de subdominio valido (etiqueta DNS). El handler de la tarjeta lo usa
 * para no ir a la base con lo que venga en la URL.
 */
export function slugPlausible(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(slug)
}
