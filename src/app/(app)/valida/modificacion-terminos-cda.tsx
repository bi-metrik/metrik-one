import Link from 'next/link'
import { ArrowLeft, FileText } from 'lucide-react'
import { EntradaTerminos, TextoDocumento } from '@/components/terminos/entrada-terminos'
import type { DocumentoContractual, EstadoEntradaPagina } from '@/lib/valida-api/resultados'
import {
  nombreVersion,
  rutaPdfTerminos,
  textoQuienAceptaModificacion,
  textosAvisoModificacion,
} from '@/lib/valida-cda/modificacion-terminos'

type EntradaPendiente = Extract<EstadoEntradaPagina, { estado: 'pendiente' }>

/**
 * `/valida?modificacion=1`: el documento completo de una modificación por aviso (cláusula 13.1).
 *
 *   - La persona designada lo lee hasta el final y lo acepta con la MISMA entrada de los términos
 *     (`EntradaTerminos`): misma declaración, misma constancia (fecha, persona, cédula, IP, huella del PDF).
 *   - Los demás lo leen, con su PDF, y ven a quién le toca. No se les muestra casilla ni aviso de la
 *     Política, porque no aceptan nada.
 *
 * Aceptar es voluntario y el módulo sigue abierto: siempre hay cómo volver a Valida.
 *
 * Sin estado ni efectos: la decisión viene del servidor (`entradaValidaCda().modificacion`).
 */
export function ModificacionTerminosCda({
  documentos,
  entrada,
  hoy,
  designadoNombre,
  aviso,
  politicaUrl,
  politicaTitulo,
}: {
  documentos: DocumentoContractual[]
  /** La entrada armada para firmar; `null` si quien entra no puede firmar o no se pudo armar. */
  entrada: EntradaPendiente | null
  hoy: string
  designadoNombre: string | null
  aviso: string
  politicaUrl: string
  politicaTitulo: string
}) {
  const firma = entrada !== null && entrada.contrato.estado === 'pendiente' && entrada.contrato.puede
  const versiones = documentos.map((d) => nombreVersion(d.version)).join(' y ')

  return (
    <div className="space-y-6">
      <Link href="/valida" className="inline-flex items-center gap-1 text-sm font-semibold text-acento">
        <ArrowLeft className="h-4 w-4" />
        Volver a Valida
      </Link>

      {documentos.map((d) => {
        const t = textosAvisoModificacion(d, hoy)
        return (
          <section
            key={d.documentoId}
            data-modificacion-resumen
            className="space-y-2 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950"
          >
            <p className="font-semibold">{t.titulo}</p>
            <p>{t.queCambia}</p>
            <p className="font-semibold">{t.vigencia}</p>
            {t.derecho && <p>{t.derecho}</p>}
            {t.publicado && <p className="text-xs text-sky-800">{t.publicado}</p>}
            <a href={rutaPdfTerminos(d.documentoId)} className="inline-block font-semibold underline underline-offset-2">
              Descargar el PDF ({nombreVersion(d.version)})
            </a>
          </section>
        )
      })}

      {firma && entrada ? (
        <EntradaTerminos
          entrada={entrada}
          aviso={aviso}
          politicaUrl={politicaUrl}
          politicaTitulo={politicaTitulo}
          producto="valida_cda"
          titulo={`Aceptar la ${versiones} de los Términos`}
          descripcion={
            'Lee los términos hasta el final. Aceptarlos es voluntario: el cambio rige igual desde su fecha, y ' +
            'Valida sigue funcionando con o sin tu aceptación. Si aceptas, el aviso deja de mostrarse a tu equipo.'
          }
        />
      ) : (
        <section data-modificacion-lectura className="rounded-lg border border-border bg-white p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 hidden h-5 w-5 shrink-0 text-acento sm:block" />
            <div className="min-w-0 flex-1 space-y-4">
              <p className="text-sm text-tinta">{textoQuienAceptaModificacion(designadoNombre)}</p>
              <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-papel p-4 text-sm leading-relaxed text-tinta [overflow-wrap:anywhere] sm:max-h-[28rem]">
                {documentos.map((d, i) => (
                  <article key={d.documentoId} className={i > 0 ? 'mt-8 border-t border-border pt-6' : undefined}>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                      {d.titulo} · {d.version}
                    </p>
                    <TextoDocumento md={d.textoMd} />
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
