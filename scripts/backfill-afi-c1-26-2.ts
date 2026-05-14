/**
 * Backfill carpeta_url para el negocio AFI `C1 26 2` que se creo cuando
 * google-drive.ts todavia no soportaba Shared Drives — quedo carpeta_url=NULL.
 *
 * Crea la carpeta correspondiente en la Shared Drive CDA (root AFI) usando el
 * OAuth per-workspace de AFI y actualiza el campo `carpeta_url` del negocio.
 *
 * Uso:
 *   npx tsx scripts/backfill-afi-c1-26-2.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { createDriveFolder } from '../src/lib/google-drive'

const AFI_WS_ID = '77ddc3f2-83aa-4a29-aa7f-18a6f6196c5b'
const NEGOCIO_ID = 'e7840811-36a2-4828-b040-5ca6ca8f2a63'
const CDA_PARENT_FOLDER = '1hK2v_cC2vW2BramfGQUGgNSrjm5rS0RM'

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Leer negocio + cliente
  const { data: negocio, error: negErr } = await sb
    .from('negocios')
    .select('id, codigo, carpeta_url, workspace_id, empresas(nombre), contactos(nombre)')
    .eq('id', NEGOCIO_ID)
    .single()

  if (negErr || !negocio) {
    console.error('negocio no encontrado:', negErr)
    process.exit(1)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = negocio as any
  console.log('codigo:', n.codigo)
  console.log('carpeta_url actual:', n.carpeta_url)
  console.log('workspace_id:', n.workspace_id)
  console.log('empresa:', n.empresas?.nombre)
  console.log('contacto:', n.contactos?.nombre)

  if (n.workspace_id !== AFI_WS_ID) {
    console.error('negocio no pertenece a AFI')
    process.exit(1)
  }

  if (n.carpeta_url) {
    console.log('negocio ya tiene carpeta_url, abortando')
    process.exit(0)
  }

  const clienteNombre = n.empresas?.nombre ?? n.contactos?.nombre ?? 'CDA'
  const folderName = `${n.codigo} - ${clienteNombre}`
  console.log('creando carpeta:', folderName)

  // 2. Crear carpeta en Shared Drive CDA con OAuth per-workspace
  const folderId = await createDriveFolder(folderName, CDA_PARENT_FOLDER, AFI_WS_ID)
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`
  console.log('folder creado:', folderId)
  console.log('url:', folderUrl)

  // 3. UPDATE negocio.carpeta_url
  const { error: updErr } = await sb
    .from('negocios')
    .update({ carpeta_url: folderUrl })
    .eq('id', NEGOCIO_ID)

  if (updErr) {
    console.error('error actualizando negocio:', updErr)
    process.exit(1)
  }

  console.log('backfill OK')
}

main().catch(e => { console.error(e); process.exit(1) })
