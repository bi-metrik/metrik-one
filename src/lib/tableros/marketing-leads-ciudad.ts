/**
 * Las interacciones de Meta convertidas en LEADS con su ciudad declarada. Corre en el
 * SERVIDOR (arrastra el catálogo DIVIPOLA vía `ciudad-residencia`); al navegador solo
 * viaja una fila por lead con la ciudad ya resuelta.
 *
 * ⚠️ El lead se define EXACTAMENTE como en `v_marketing_campana` (CTE `leads`,
 * `20260903000001_marketing_campana.sql`): un CONTACTO distinto por campaña, contado
 * en el mes de Bogotá de su primera interacción con esa campaña. Es lo que hace que la
 * tabla «Leads por ciudad» sume lo mismo que la cifra «Leads»: dos definiciones del
 * mismo número discrepan el día que una de las dos cambia.
 *
 * La ciudad del lead es la de su interacción MÁS ANTIGUA que la traiga. Si volvió a
 * escribir desde otra ciudad, manda la primera: es la que lo trajo.
 */

import { bogotaYearMonth } from '@/lib/dates/bogota'
import { ciudadDeclarada, NombresDeCiudad } from '@/lib/contactos/ciudad-residencia'
import type { CampoFormulario } from '@/lib/contactos/campos-formulario'
import type { FilaLeadCiudad } from './marketing'

/** Una interacción de Meta tal como la trae la consulta. */
export interface InteraccionMeta {
  contactoId: string
  campaignId: string
  ocurridaAt: string | null
  createdAt: string | null
  fieldData: unknown
}

const instante = (i: InteraccionMeta): number | null => {
  const t = i.ocurridaAt ?? i.createdAt
  if (!t) return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

export function leadsConCiudad(interacciones: InteraccionMeta[]): FilaLeadCiudad[] {
  type Lead = { campaignId: string; primera: number | null; ciudad: string | null; ciudadEn: number }
  const leads = new Map<string, Lead>()
  const nombres = new NombresDeCiudad()

  for (const it of interacciones) {
    if (!it.campaignId) continue
    const k = `${it.campaignId}|${it.contactoId}`
    const t = instante(it)
    const fd = Array.isArray(it.fieldData) ? (it.fieldData as CampoFormulario[]) : null
    const clave = nombres.registrar(ciudadDeclarada(fd))
    const lead = leads.get(k) ?? { campaignId: it.campaignId, primera: null, ciudad: null, ciudadEn: Infinity }
    if (t !== null && (lead.primera === null || t < lead.primera)) lead.primera = t
    // Sin instante cuenta como el más tardío: solo pone ciudad si no hay otra.
    const orden = t ?? Infinity
    if (clave !== null && (lead.ciudad === null || orden < lead.ciudadEn)) {
      lead.ciudad = clave
      lead.ciudadEn = orden
    }
    leads.set(k, lead)
  }

  return [...leads.values()].map((l) => ({
    campaignId: l.campaignId,
    mes: l.primera === null ? null : `${bogotaYearMonth(new Date(l.primera))}-01`,
    ciudad: l.ciudad === null ? null : nombres.nombre(l.ciudad),
  }))
}
