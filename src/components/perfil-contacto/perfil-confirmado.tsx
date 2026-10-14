import { agruparPerfil, type HechoPerfilVista } from '@/lib/perfil-contacto/vista'

/**
 * El perfil CONFIRMADO del contacto, de solo lectura, para que la comercial lo vea al cotizar (bloque
 * «Ficha del cliente» del viaje). Lo sugerido no aparece: no cuenta hasta que alguien lo confirma en
 * la ficha del directorio. Sin nada confirmado no se pinta, así que un workspace que no usa el perfil
 * no ve ningún cambio.
 */
export default function PerfilConfirmado({ hechos }: { hechos: ReadonlyArray<HechoPerfilVista> }) {
  const grupos = agruparPerfil(hechos.filter(h => h.estado === 'confirmado'))
  if (!grupos.length) return null
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-slate-50/60 px-3 py-2">
      <p className="mb-1 text-[11px] font-medium text-tinta">Perfil del cliente</p>
      <dl className="space-y-1">
        {grupos.map(g => (
          <div key={g.dimension} className="text-xs">
            <dt className="inline font-medium text-tinta-suave">{g.titulo}: </dt>
            <dd className="inline text-tinta">{g.hechos.map(h => h.texto).join(' · ')}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
