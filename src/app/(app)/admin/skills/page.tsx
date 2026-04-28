import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { listSkills } from './actions'
import SkillsClient from './skills-client'

export default async function AdminSkillsPage() {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) redirect('/numeros')

  const skills = await listSkills()
  const byTipo = [1, 2, 3].map(t => ({ tipo: t, count: skills.filter(s => s.tipo === t).length }))
    .filter(x => x.count > 0)

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">Biblioteca de Skills</h1>
            <p className="mt-1 text-sm text-gray-500">
              Skills MéTRIK sincronizados desde{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">.claude/skills/</code>
            </p>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-right">
            <p className="text-[10px] text-gray-400">Para actualizar:</p>
            <code className="text-[11px] text-gray-600">node scripts/sync-skills.js</code>
          </div>
        </div>

        {skills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-gray-500">
              {skills.length} skills
            </span>
            {byTipo.map(({ tipo, count }) => {
              const labels: Record<number, string> = { 1: 'Proceso', 2: 'Agente', 3: 'Organización' }
              const styles: Record<number, string> = {
                1: 'border-blue-200 bg-blue-50 text-blue-700',
                2: 'border-violet-200 bg-violet-50 text-violet-700',
                3: 'border-teal-200 bg-teal-50 text-teal-700',
              }
              return (
                <span key={tipo} className={`rounded-md border px-2.5 py-1 ${styles[tipo]}`}>
                  {count} {labels[tipo]}{count !== 1 ? 's' : ''}
                </span>
              )
            })}
          </div>
        )}
      </header>

      {skills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <p className="text-sm text-gray-600">No hay skills sincronizados todavía.</p>
          <p className="mt-2 text-xs text-gray-400">
            Aplica la migración y luego corre:{' '}
            <code className="rounded bg-white px-1 font-mono">node scripts/sync-skills.js</code>
          </p>
        </div>
      ) : (
        <SkillsClient skills={skills} />
      )}
    </div>
  )
}
