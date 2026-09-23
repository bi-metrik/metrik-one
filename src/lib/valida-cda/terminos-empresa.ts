/**
 * Los términos que la EMPRESA aceptó, para releerlos en la pestaña Términos de `/valida` del CDA.
 *
 * En Valida API cada usuario acepta y relee lo que ÉL aprobó (`valida-api/terminos-aprobados.ts`).
 * En los CDA los acepta una sola persona, la designada, en nombre de la empresa; los operadores no
 * firman nada propio (`producto.ts`). Así que aquí lo que se muestra es la constancia del CONTRATO:
 * cada versión con aceptación, quién la aceptó y cuándo.
 *
 * El texto sale con la misma garantía que en Valida API: solo si sha256 del texto que se va a pintar
 * es el `texto_sha256` registrado de la versión y la huella del PDF es la registrada. Si no, un
 * aviso, nunca otro texto.
 *
 * Puro: la huella entra por parámetro.
 */

import type { HuellasVersion } from '@/lib/valida-api/terminos-aprobados'
import type { DocumentoContractual, TerminoAprobado } from '@/lib/valida-api/resultados'

export function terminosAceptadosPorEmpresa(p: {
  /** Lo que devuelve `mis_documentos_de_servicio()` para el espacio. */
  documentos: readonly DocumentoContractual[]
  /** Por `documentoId`, las huellas registradas de la versión. */
  huellas: ReadonlyMap<string, HuellasVersion>
  huella: (texto: string) => string
}): TerminoAprobado[] {
  // La RPC repite una versión por cada constancia: por versión, la PRIMERA aceptación (la que abrió el módulo).
  const porVersion = new Map<string, DocumentoContractual & { aceptadoAt: string }>()
  for (const d of p.documentos) {
    if (d.aceptadoAt === null) continue
    const previa = porVersion.get(d.documentoId)
    if (!previa || Date.parse(d.aceptadoAt) < Date.parse(previa.aceptadoAt)) {
      porVersion.set(d.documentoId, d as DocumentoContractual & { aceptadoAt: string })
    }
  }

  return [...porVersion.values()]
    .sort((a, b) => Date.parse(b.aceptadoAt) - Date.parse(a.aceptadoAt))
    .map((d): TerminoAprobado => {
      const registrada = p.huellas.get(d.documentoId)
      const integro =
        registrada !== undefined && registrada.pdfSha256 === d.pdfSha256 && p.huella(d.textoMd) === registrada.textoSha256
      if (!integro) {
        return {
          estado: 'no_verificado',
          titulo: d.titulo,
          version: d.version,
          aprobadoAt: d.aceptadoAt,
          motivo: 'huella_distinta',
        }
      }
      return {
        estado: 'verificado',
        documentoId: d.documentoId,
        titulo: d.titulo,
        version: d.version,
        textoMd: d.textoMd,
        aprobadoAt: d.aceptadoAt,
        contrato: {
          aceptadoAt: d.aceptadoAt,
          aceptadoPor: d.aceptadoPor,
          canal: d.aceptadoCanal === 'whatsapp' ? 'whatsapp' : 'modulo',
        },
      }
    })
}
