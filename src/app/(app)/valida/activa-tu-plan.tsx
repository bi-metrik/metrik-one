import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { accionDelCorte, textoCorte, textoSaldo, type MotivoCorte, type SaldoBolsa } from '@/lib/valida/corte-bolsa'

/** Un enlace de afuera (el WhatsApp de MéTRIK) abre en otra pestaña; una ruta de ONE va con `Link`. */
function esExterno(ruta: string): boolean {
  return /^https?:\/\//.test(ruta)
}

/**
 * En lugar de los formularios de consulta cuando la bolsa se cortó (agotada o vencida). El
 * historial sigue abierto en su pestaña.
 */
export function ActivaTuPlan({ motivo, esPrueba, espacio }: { motivo: MotivoCorte; esPrueba: boolean; espacio: string }) {
  const { titulo, detalle } = textoCorte(motivo, esPrueba)
  const accion = accionDelCorte(esPrueba, espacio)
  const clase = 'inline-flex h-11 w-full items-center justify-center rounded-lg bg-acento px-5 text-sm font-semibold text-white sm:w-auto'
  return (
    <section data-activa-tu-plan={motivo} className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 hidden h-5 w-5 shrink-0 text-acento sm:block" />
        <div className="w-full space-y-3">
          <div>
            <h2 className="text-base font-semibold text-tinta">{titulo}</h2>
            <p className="mt-1 text-sm text-tinta-suave">{detalle}</p>
          </div>
          {esExterno(accion.ruta) ? (
            <a href={accion.ruta} target="_blank" rel="noopener noreferrer" className={clase}>
              {accion.texto}
            </a>
          ) : (
            <Link href={accion.ruta} className={clase}>
              {accion.texto}
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

/** La línea del contador mientras la bolsa sigue vigente. */
export function SaldoConsultas({ saldo, espacio }: { saldo: SaldoBolsa; espacio: string }) {
  const accion = accionDelCorte(saldo.esPrueba, espacio)
  const clase = 'flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-2.5 text-sm text-tinta'
  const contenido = (
    <>
      <span>{textoSaldo(saldo)}</span>
      <span className="shrink-0 font-semibold text-acento">{accion.texto}</span>
    </>
  )
  return esExterno(accion.ruta) ? (
    <a href={accion.ruta} target="_blank" rel="noopener noreferrer" data-saldo-consultas={saldo.saldo} className={clase}>
      {contenido}
    </a>
  ) : (
    <Link href={accion.ruta} data-saldo-consultas={saldo.saldo} className={clase}>
      {contenido}
    </Link>
  )
}
