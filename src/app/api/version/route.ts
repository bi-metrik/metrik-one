import { NextResponse } from 'next/server'
import { versionDelBuild } from '@/lib/version/build'
import { EPOCA } from '@/lib/version/epoca'

// Version y epoca del deployment vivo. La consulta el vigilante de la pestaña
// (`VersionWatcher`) para saber si su codigo quedo incompatible con el servidor. Desde el
// 2026-10-03 la que decide es la `epoca` (`src/lib/version/epoca.ts`): un deploy normal
// cambia `version` y no recarga a nadie. `version` se queda para diagnostico.
//
// Esta consulta va SIN `x-deployment-id`: tiene que llegar al deployment vivo, no al de
// la pestaña. Si se sellara, la pestaña vieja se preguntaria a si misma.
//
// Publica a proposito: no expone nada del workspace ni del usuario, solo el id
// del deployment, y necesita responder aunque la sesion haya expirado — que es
// justo uno de los estados en los que la pestaña vieja hay que recargarla.
//
// `force-dynamic` + `no-store`: si esta respuesta se cachea, el vigilante ve
// para siempre la version con la que se cacheo y deja de detectar deploys.

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { version: versionDelBuild(), epoca: EPOCA },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
