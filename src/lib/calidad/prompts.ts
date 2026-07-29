import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import type { PromptsAuditoria } from './motor-auditoria'

/**
 * De donde salen los prompts del motor de auditoria.
 *
 * DOS SITIOS, CON PAPELES DISTINTOS Y DECLARADOS:
 *
 * - `proyectos/regat/clarity/docs/entrega/prompt-motor-auditoria.md` es la
 *   FUENTE DOCUMENTADA: ahi vive el porque de cada decision, la tabla de
 *   calibracion y los criterios observables. Es lo que alguien lee para
 *   entender el motor o para comprobar si lo rompio.
 *
 * - `workspaces.config_extra.calidad_prompts` es la COPIA OPERATIVA: lo que el
 *   motor ejecuta. Vive en la base para poder calibrar sin desplegar, que era
 *   el criterio.
 *
 * Se sincronizan con `scripts/setup-calidad-prompts.ts`, que lee el archivo y
 * escribe la copia. NUNCA al reves, y nunca a mano: si alguien edita la base
 * directamente, el documento deja de explicar lo que el motor hace y nadie se
 * entera. Por eso la copia guarda el hash del archivo del que salio — para
 * poder detectar que se separaron.
 */

export interface PromptsGuardados extends PromptsAuditoria {
  /** Hash del archivo fuente del que se copio. Delata si se editaron aparte. */
  hashFuente: string
  actualizado: string
}

export async function getPromptsAuditoria(workspaceId: string): Promise<PromptsGuardados> {
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('workspaces')
    .select('config_extra')
    .eq('id', workspaceId)
    .single()

  if (error) throw new Error(`No se pudo leer la configuración del workspace: ${error.message}`)

  const cfg = (data as { config_extra: Record<string, unknown> | null } | null)?.config_extra
  const p = cfg?.calidad_prompts as PromptsGuardados | undefined

  // Fallar claro y temprano: sin prompts el motor no tiene nada que ejecutar, y
  // un mensaje vago aqui se convierte en media hora de rastreo en la demo.
  if (!p?.cumplimiento || !p?.tecnica) {
    throw new Error(
      'El motor de auditoría no está configurado en este espacio. ' +
        'Corre `npx tsx scripts/setup-calidad-prompts.ts <slug>` para cargar los prompts.',
    )
  }
  return p
}
