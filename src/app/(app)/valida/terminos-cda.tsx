import { FileSignature, ShieldCheck } from 'lucide-react'
import { EntradaTerminos } from '@/components/terminos/entrada-terminos'
import { textoQuienFirma } from '@/lib/valida-api/quien-firma'
import type { EstadoEntradaPagina } from '@/lib/valida-api/resultados'

type EntradaPendiente = Extract<EstadoEntradaPagina, { estado: 'pendiente' }>

/**
 * Lo que ve un CDA en `/valida` mientras sus términos de suscripción no estén aceptados.
 *
 *   - La persona designada ve la entrada completa: los términos para leer hasta el final, el aviso
 *     de la Política, su firma y un solo «Acepto» (el mismo componente de Valida API).
 *   - Los demás ven un aviso: el módulo se abre cuando la persona designada acepte, y se nombra a
 *     esa persona. No se les muestra la casilla ni el aviso de la Política, porque ellos no aceptan
 *     nada: un «Al continuar, autoriza…» sin nada que continuar sería falso.
 *
 * Sin estado ni efectos: la decisión viene del servidor (`entradaValidaCda`).
 */
export function TerminosCda({
  entrada,
  aviso,
  politicaUrl,
  politicaTitulo,
}: {
  entrada: EntradaPendiente
  aviso: string
  politicaUrl: string
  politicaTitulo: string
}) {
  const { contrato } = entrada
  const firma = contrato.estado === 'pendiente' && contrato.puede

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-acento" />
        <div>
          <h1 className="text-xl font-bold text-tinta">Valida</h1>
          <p className="text-sm text-tinta-suave">
            Tu licencia de Valida ahora la presta directamente METRIK IA S.A.S.
          </p>
        </div>
      </div>

      {firma ? (
        <EntradaTerminos
          entrada={entrada}
          aviso={aviso}
          politicaUrl={politicaUrl}
          politicaTitulo={politicaTitulo}
          producto="valida_cda"
        />
      ) : (
        <section data-terminos-pendientes className="rounded-lg border border-border bg-white p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <FileSignature className="mt-0.5 hidden h-5 w-5 shrink-0 text-acento sm:block" />
            <div className="min-w-0 space-y-2">
              <h2 className="text-base font-semibold text-tinta">Falta la aceptación de los términos de tu empresa</h2>
              <p className="text-sm text-tinta">
                {contrato.estado === 'pendiente' && !contrato.puede
                  ? textoQuienFirma(contrato, 'valida_cda')
                  : 'Los términos de suscripción de tu empresa todavía no están aceptados.'}
              </p>
              <p className="text-sm text-tinta-suave">
                Mientras tanto no se pueden hacer consultas desde este espacio.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
