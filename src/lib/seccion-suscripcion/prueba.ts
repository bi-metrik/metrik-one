import type { SaldoBolsa, PruebaValida } from '@/lib/valida/corte-bolsa'
import { pruebaEnPantalla, type CobroDeLaPrueba, type PruebaEnPantalla } from '@/lib/valida-registro/prueba-en-pantalla'

/**
 * La Suscripción de Valida en prueba, sin `server-only` (lo inyectado es la red y la base): la usan el
 * menú (`menuSuscripcion`) y `/suscripcion`. Ver `prueba-servidor.ts`.
 *
 * Reglas:
 *   - solo espacios del registro autogestionado con su suscripción en `prueba` (o `cancelada` por
 *     «Cancelar prueba», mientras le queden días de prueba) y SIN contrato vivo: con contrato manda la
 *     sección de siempre;
 *   - la ve la persona que se registró (la que la activación deja como designada), también un platform
 *     admin en «Ver como» mirándola, en solo lectura; nadie más (la ruta da 404, como hoy);
 *   - cancela solo esa persona, con su sesión real y rol de dueña, nunca «Ver como».
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface SuscripcionEnPrueba {
  workspaceId: string
  suscripcionId: string
  estado: 'prueba' | 'cancelada'
  razonSocial: string
  /** Quien no la puede operar (otra persona real, o «Ver como»). */
  soloLectura: boolean
  /** Consultas de la prueba: usadas y total. null si Valida no respondió. */
  consultas: { usadas: number; total: number; restantes: number } | null
  /** Fecha del fin de la prueba y, con tarjeta, el cobro (la misma fecha). */
  prueba: PruebaEnPantalla | null
  /** Los 4 dígitos de la tarjeta (ePayco). null = sin tarjeta, o ePayco no respondió. */
  ultimos4: string | null
  conTarjeta: boolean
}

export interface DepsSuscripcionEnPrueba {
  db: unknown
  esAutogestion: (config: Record<string, unknown> | null) => boolean
  pruebaDeConfig: (config: Record<string, unknown> | null) => PruebaValida | null
  cobro: (db: never, workspaceId: string) => Promise<CobroDeLaPrueba | null>
  saldo: (workspaceId: string) => Promise<SaldoBolsa | null>
  ultimos4: (ref: string | null) => Promise<string | null>
}

export async function resolverSuscripcionEnPrueba(
  deps: DepsSuscripcionEnPrueba,
  p: { workspaceId: string; usuarioRealId: string; usuarioEfectivoId: string; impersonando: boolean; rolReal: string | null },
): Promise<SuscripcionEnPrueba | null> {
  const db = deps.db as Db
  const ws = await db.from('workspaces').select('config_extra').eq('id', p.workspaceId).maybeSingle()
  if (ws.error || !ws.data) return null
  const config = (ws.data.config_extra ?? null) as Record<string, unknown> | null
  if (!deps.esAutogestion(config)) return null

  const reg = await db.from('valida_registros').select('id, usuario_id').eq('workspace_id', p.workspaceId).eq('estado', 'creado').maybeSingle()
  const registro = reg.data as { id: string; usuario_id: string | null } | null
  if (reg.error || !registro?.usuario_id) return null
  // La persona designada de la prueba: la que se registró (efectiva, para «Ver como»).
  if (p.usuarioEfectivoId !== registro.usuario_id) return null

  const [sus, contrato] = await Promise.all([
    db
      .from('suscripciones_producto')
      .select('id, estado, razon_social, metodo_pago_ref, prueba_hasta, created_at')
      .eq('workspace_cliente_id', p.workspaceId)
      .eq('producto', 'valida')
      .eq('valida_registro_id', registro.id)
      .in('estado', ['prueba', 'cancelada'])
      .order('created_at', { ascending: false })
      .limit(1),
    db.from('servicios_contratados').select('id').eq('workspace_pagador_id', p.workspaceId).not('estado', 'in', '(cancelado,terminado)').limit(1),
  ])
  if (sus.error || contrato.error) return null
  // Con contrato manda la sección de siempre (`contextoSuscripcion`).
  if ((contrato.data ?? []).length > 0) return null
  const fila = ((sus.data ?? []) as {
    id: string
    estado: 'prueba' | 'cancelada'
    razon_social: string
    metodo_pago_ref: string | null
    prueba_hasta: string | null
  }[])[0]
  if (!fila) return null

  const [cobro, saldo] = await Promise.all([deps.cobro(db as never, p.workspaceId), deps.saldo(p.workspaceId)])
  const venceConfig = deps.pruebaDeConfig(config)?.vence_en ?? fila.prueba_hasta
  // Una prueba cancelada y ya vencida no tiene nada que mostrar: la sección desaparece.
  const fin = cobro?.cobroDesde ?? saldo?.venceEn ?? venceConfig
  if (fila.estado === 'cancelada' && fin && Date.parse(fin) <= Date.now()) return null

  const soloLectura = p.impersonando || p.usuarioRealId !== registro.usuario_id || p.rolReal !== 'owner'
  const prueba = pruebaEnPantalla({ saldo, cobro, venceConfig, puedeCancelar: !soloLectura })
  const conTarjeta = Boolean(fila.metodo_pago_ref)
  return {
    workspaceId: p.workspaceId,
    suscripcionId: fila.id,
    estado: fila.estado,
    razonSocial: fila.razon_social,
    soloLectura,
    consultas: saldo?.esPrueba ? { usadas: Math.max(0, saldo.compradas - saldo.saldo), total: saldo.compradas, restantes: saldo.saldo } : null,
    prueba,
    // Cancelada, la tarjeta ya se pidió borrar: no se le pregunta a ePayco.
    ultimos4: conTarjeta && fila.estado === 'prueba' ? await deps.ultimos4(fila.metodo_pago_ref) : null,
    conTarjeta,
  }
}
