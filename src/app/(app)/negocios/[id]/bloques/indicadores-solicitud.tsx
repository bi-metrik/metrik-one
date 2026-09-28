import { calcularNiveles, declaraNiveles, type Barra, type CampoConNivel } from '@/lib/negocios/niveles-solicitud'

/**
 * «Mínimo para cotizar: 5 de 7» y «Para la cotización final: 3 de 9», con lo que falta
 * escrito como pregunta. Solo aparece en un bloque cuyos campos declaran `nivel`; en
 * cualquier otro bloque no pinta nada (un bloque sin la config nueva se ve como antes).
 *
 * Es un aviso, no un freno: el freno, si la etapa lo declara, es el gate `solicitud_minimo`
 * al avanzar. La cuenta es la misma función pura que usa ese gate y el bot.
 */

function Fila({ titulo, barra, tono }: { titulo: string; barra: Barra; tono: 'minimo' | 'deseable' }) {
  const completa = barra.faltan.length === 0
  const pct = barra.total > 0 ? Math.round((barra.completos / barra.total) * 100) : 0
  const color = completa ? 'bg-acento' : tono === 'minimo' ? 'bg-[#D97706]' : 'bg-[#9CA3AF]'
  return (
    <div data-barra={tono} data-completos={barra.completos} data-total={barra.total}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-tinta">{titulo}</span>
        <span className={`text-[11px] tabular-nums ${completa ? 'text-acento' : 'text-tinta-suave'}`}>
          {barra.completos} de {barra.total}
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#E5E7EB]" aria-hidden>
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {!completa && (
        <ul className="mt-1 space-y-0.5">
          {barra.faltan.map(f => (
            <li key={f.slug} className="text-[11px] text-tinta-suave">{f.pregunta}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function IndicadoresSolicitud({
  fields,
  valores,
}: {
  fields: ReadonlyArray<CampoConNivel>
  valores: Record<string, unknown>
}) {
  if (!declaraNiveles(fields)) return null
  const n = calcularNiveles(fields, valores)
  if (n.errores.length > 0) console.warn('[niveles-solicitud] config con problemas:', n.errores)
  if (n.minimo.total === 0 && n.deseable.total === 0) return null
  return (
    <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2" data-indicadores-solicitud>
      {n.minimo.total > 0 && <Fila titulo="Mínimo para cotizar" barra={n.minimo} tono="minimo" />}
      {n.deseable.total > 0 && <Fila titulo="Para la cotización final" barra={n.deseable} tono="deseable" />}
    </div>
  )
}
