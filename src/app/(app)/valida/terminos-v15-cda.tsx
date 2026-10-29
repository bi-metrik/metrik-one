import { Fragment } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { EntradaTerminos } from '@/components/terminos/entrada-terminos'
import type { EstadoEntradaPagina } from '@/lib/valida-api/resultados'
import { tramosDeLinea } from '@/lib/valida-api/texto-documento'
import { rutaPdfTerminos } from '@/lib/valida-cda/modificacion-terminos'
import { textoQuienAceptaV15, type TextosPantallaV15 } from '@/lib/valida-cda/terminos-v1-5'
import { posponerTerminosV15 } from './terminos-v15-acciones'

type EntradaPendiente = Extract<EstadoEntradaPagina, { estado: 'pendiente' }>

/** Una línea con `**negritas**`, como texto (React escapa todo). */
function Linea({ texto }: { texto: string }) {
  return (
    <>
      {tramosDeLinea(texto).map((t, i) =>
        t.negrita ? (
          <strong key={i} className="font-semibold">
            {t.texto}
          </strong>
        ) : (
          <Fragment key={i}>{t.texto}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * La pantalla de aceptación de la v1.5 de los Términos (anexo A de la fuente de Emilio): la ven TODOS los
 * usuarios del CDA al entrar a Valida desde la publicación.
 *
 *   - La persona designada: el resumen, los Términos completos y la aceptación con la MISMA entrada de
 *     siempre (`EntradaTerminos`: leer hasta el final, nombre, cédula, casilla sin marcar, «Acepto»; la
 *     constancia de la v1.3/v1.4: fecha y hora, usuario, IP, navegador, versión y huellas).
 *   - Los demás: el resumen y «Esta aceptación la hace {nombre}».
 *   - Todos: «Ahora no, recordármelo», que cierra la pantalla sin bloquear nada (vuelve en otro ingreso).
 *
 * No bloquea: Valida opera igual con o sin la aceptación. Sin estado ni efectos: se pinta en el servidor.
 */
export function TerminosV15Cda({
  documentoId,
  textos,
  entrada,
  designadoNombre,
  aviso,
  politicaUrl,
  politicaTitulo,
}: {
  documentoId: string
  textos: TextosPantallaV15
  /** La entrada armada para firmar; `null` si quien entra no es la persona designada. */
  entrada: EntradaPendiente | null
  designadoNombre: string | null
  aviso: string
  politicaUrl: string
  politicaTitulo: string
}) {
  const firma = entrada !== null && entrada.contrato.estado === 'pendiente' && entrada.contrato.puede
  return (
    <div className="space-y-6" data-terminos-v15>
      <section className="space-y-3 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950 sm:p-5">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 hidden h-5 w-5 shrink-0 sm:block" />
          <div className="min-w-0 space-y-3">
            <h2 className="text-base font-semibold">{textos.titulo}</h2>
            <p>
              <Linea texto={textos.intro} />
            </p>
            <p className="font-semibold">Qué cambia:</p>
            <ol className="list-decimal space-y-2 pl-5" data-terminos-v15-cambios>
              {textos.queCambia.map((q, i) => (
                <li key={i}>
                  <Linea texto={q} />
                </li>
              ))}
            </ol>
            <p>
              <Linea texto={textos.siNoAceptas} />
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link href="/valida?modificacion=1" className="font-semibold underline underline-offset-2">
                Ver los Términos completos
              </Link>
              <a href={rutaPdfTerminos(documentoId)} className="font-semibold underline underline-offset-2">
                Descargar PDF
              </a>
            </div>
            <p className="text-xs text-sky-800 [overflow-wrap:anywhere]">Huella SHA-256: {textos.huella}</p>
            {textos.publicado && <p className="text-xs text-sky-800">{textos.publicado}</p>}
          </div>
        </div>
      </section>

      {firma && entrada ? (
        <EntradaTerminos
          entrada={entrada}
          aviso={aviso}
          politicaUrl={politicaUrl}
          politicaTitulo={politicaTitulo}
          producto="valida_cda"
          titulo="Aceptar la versión 1.5 de los Términos"
          descripcion="Lee los Términos hasta el final, escribe tu nombre y tu cédula, marca la casilla y acepta. Mientras no la aceptes, Valida sigue funcionando."
        />
      ) : (
        <p data-terminos-v15-quien className="rounded-lg border border-border bg-white p-4 text-sm text-tinta">
          {textoQuienAceptaV15(designadoNombre)}
        </p>
      )}

      <form action={posponerTerminosV15}>
        <input type="hidden" name="documento_id" value={documentoId} />
        <button
          type="submit"
          data-terminos-v15-luego
          className="w-full rounded-md border border-border bg-white px-4 py-2.5 text-sm font-semibold text-tinta sm:w-auto"
        >
          Ahora no, recordármelo
        </button>
      </form>
    </div>
  )
}
