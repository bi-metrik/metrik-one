'use client'

/**
 * Los tres textos de la ficha en el panel (P11): la vista previa con sus conteos y el botón de copiar, que queda
 * deshabilitado si el texto tiene un «[FALTA: …]» o pasa su límite (lo dice `motivo`). Si menciona Nequi o Daviplata
 * sale un aviso que NO bloquea (`avisos`, 23-oct).
 * Los textos los arma `_shared/funciones/textos.ts`, puro, con la tarifa que resolvió la base.
 */
import type { CampanaPanel, FuncionAgenda } from '@/lib/funciones/datos'
import type { FichaTextos, FuncionTextos, TextoGenerado } from '../../../../supabase/functions/_shared/funciones/textos.ts'
import { copiar } from './panel-ui'

export const fichaParaTextos = (c: CampanaPanel): FichaTextos => ({
  titulo_oferta: c.experiencia.titulo_oferta, frase_gancho: c.experiencia.frase_gancho, intro: c.experiencia.intro,
  que_incluye: c.experiencia.que_incluye, emojis_tema: c.experiencia.emojis_tema, saludo_grupo: c.experiencia.saludo_grupo,
  relato_grupo: c.experiencia.relato_grupo,
})

export const funcionesParaTextos = (fs: FuncionAgenda[]): FuncionTextos[] =>
  fs.map((f) => ({ inicia_at: f.inicia_at, estado: f.estado, llena: f.ocupadas >= f.capacidad, tarifa: f.tarifa }))

const miles = (n: number) => n.toLocaleString('es-CO')

/** «834 caracteres · 923 bytes». El que tiene límite va primero, con el límite. */
export function conteo(g: TextoGenerado): string {
  const c = `${miles(g.caracteres)} caracteres`
  const b = `${miles(g.bytes)} bytes`
  if (g.limite?.unidad === 'bytes') return `${b} de ${miles(g.limite.maximo)} · ${c}`
  if (g.limite?.unidad === 'caracteres') return `${c} de ${miles(g.limite.maximo)} · ${b}`
  return `${c} · ${b}`
}

export function VistaTexto({ generado: g, textoBoton, aviso }: { generado: TextoGenerado; textoBoton: string; aviso: string }) {
  return (
    <div className="space-y-2">
      <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-[#E5E7EB] bg-gray-50 p-3 font-sans text-sm text-[#1A1A1A]">{g.texto}</pre>
      <p className={`text-xs ${g.sobra > 0 ? 'text-red-600' : 'text-[#6B7280]'}`}>{conteo(g)}</p>
      {g.motivo && <p className="text-xs text-red-600">{g.motivo}</p>}
      {g.avisos.map((a) => <p key={a} className="text-xs text-amber-700">{a}</p>)}
      <button
        type="button"
        disabled={!g.copiable}
        onClick={() => copiar(g.texto, aviso)}
        className="h-11 w-full rounded-md bg-[#10B981] text-sm font-medium text-white disabled:opacity-50"
      >
        {textoBoton}
      </button>
    </div>
  )
}
