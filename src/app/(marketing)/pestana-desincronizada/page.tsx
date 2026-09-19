import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PestanaDesincronizada } from '@/components/pestana-desincronizada'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getPlatformAdminState } from '@/lib/actions/platform-admin'
import { ERROR_DESINCRONIZADO, urlDeWorkspace } from '@/lib/tenant/desincronizacion'

export const metadata: Metadata = { title: 'Esta pestaña quedó en otro espacio de trabajo' }

/**
 * El aviso de pestaña desincronizada, en su propia ruta.
 *
 * Vive en `(marketing)` y no en `(app)` por dos razones, y las dos importan:
 *
 *  - el layout de `(app)` es justo el que está desincronizado (pinta el nombre, el logo y el
 *    menú del inquilino equivocado), así que el aviso no puede colgar de él;
 *  - y un layout compartido NO se vuelve a ejecutar en una navegación del lado del cliente,
 *    que es el hueco por el que este aviso era invisible. El guard vive ahora en el
 *    middleware, que manda la navegación acá (ver `middleware.ts`).
 *
 * Es hermana de `/sin-espacio` y `/suscripcion-suspendida`: pantallas de la aplicación que
 * explican por qué no hay nada que mostrar.
 *
 * Una sola lectura: `getWorkspace` ya trae el slug, el nombre y el `platform_admin` en el
 * mismo viaje del perfil (ver `get-workspace-impl.ts`). La lista de workspaces solo se pide
 * cuando quien mira es platform admin, que es el único que puede traer la pestaña de vuelta.
 */
export default async function PestanaDesincronizadaPage() {
  const ws = await getWorkspace()

  // Si la pestaña ya está sincronizada (la persona volvió, o el guard no aplica acá porque no
  // hay subdominio de inquilino), esta pantalla no tiene nada que decir: sigue su camino.
  if (ws.error !== ERROR_DESINCRONIZADO) redirect('/')

  const { slugPestana, slugSesion, nombreSesion, platformAdmin } = ws as unknown as {
    slugPestana: string
    slugSesion: string
    nombreSesion: string
    platformAdmin: boolean
  }

  const estadoAdmin = platformAdmin ? await getPlatformAdminState() : null
  const dePestana = estadoAdmin?.workspaces.find((w) => w.slug === slugPestana) ?? null

  return (
    <PestanaDesincronizada
      slugPestana={slugPestana}
      slugSesion={slugSesion}
      nombreSesion={nombreSesion || slugSesion}
      urlSesion={urlDeWorkspace(
        slugSesion,
        process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co',
        process.env.NODE_ENV === 'development',
      )}
      workspaceDePestana={
        dePestana ? { id: dePestana.id, slug: dePestana.slug, name: dePestana.name } : null
      }
    />
  )
}
