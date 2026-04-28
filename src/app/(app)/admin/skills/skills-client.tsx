'use client'

import { useState, useMemo } from 'react'
import type { SkillRow } from './actions'

interface Props {
  skills: SkillRow[]
}

const TIPO_LABELS: Record<number, string> = {
  1: 'Proceso',
  2: 'Agente',
  3: 'Organización',
}

const TIPO_STYLES: Record<number, string> = {
  1: 'bg-blue-100 text-blue-700 border-blue-200',
  2: 'bg-violet-100 text-violet-700 border-violet-200',
  3: 'bg-teal-100 text-teal-700 border-teal-200',
}

const TIPO_FILTER_STYLES: Record<number | 'all', string> = {
  all: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
  1:   'bg-blue-100 text-blue-700 hover:bg-blue-200',
  2:   'bg-violet-100 text-violet-700 hover:bg-violet-200',
  3:   'bg-teal-100 text-teal-700 hover:bg-teal-200',
}

export default function SkillsClient({ skills }: Props) {
  const [selected, setSelected] = useState<SkillRow | null>(null)
  const [q, setQ] = useState('')
  const [tipoFilter, setTipoFilter] = useState<number | 'all'>('all')

  const tipos = [1, 2, 3].filter(t => skills.some(s => s.tipo === t))

  const filtered = useMemo(() => {
    return skills.filter(s => {
      if (tipoFilter !== 'all' && s.tipo !== tipoFilter) return false
      if (!q.trim()) return true
      const hay = `${s.nombre} ${s.descripcion ?? ''} ${s.argument_hint ?? ''}`.toLowerCase()
      return hay.includes(q.trim().toLowerCase())
    })
  }, [skills, q, tipoFilter])

  return (
    <div className="flex h-[calc(100vh-88px)] gap-4 overflow-hidden">

      {/* ── Panel izquierdo: lista ───────────────────────────────── */}
      <div className="flex w-[320px] shrink-0 flex-col gap-3 overflow-hidden">
        {/* Filtros */}
        <div className="space-y-2">
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar skill…"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-[#10B981] focus:outline-none"
          />
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setTipoFilter('all')}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${tipoFilter === 'all' ? 'ring-2 ring-gray-400 ring-offset-1' : ''} ${TIPO_FILTER_STYLES['all']}`}
            >
              Todos ({skills.length})
            </button>
            {tipos.map(t => (
              <button
                key={t}
                onClick={() => setTipoFilter(t)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${tipoFilter === t ? 'ring-2 ring-offset-1' : ''} ${TIPO_STYLES[t]}`}
              >
                {TIPO_LABELS[t]} ({skills.filter(s => s.tipo === t).length})
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-gray-400">{filtered.length} skills</p>

        {/* Lista */}
        <div className="flex-1 space-y-1 overflow-y-auto">
          {filtered.map(skill => {
            const isActive = selected?.id === skill.id
            return (
              <button
                key={skill.id}
                onClick={() => setSelected(isActive ? null : skill)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-all ${
                  isActive
                    ? 'border-[#10B981] bg-emerald-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {skill.skill_id && (
                        <span className="shrink-0 font-mono text-[10px] font-bold text-gray-400">{skill.skill_id}</span>
                      )}
                      <p className="text-[13px] font-semibold text-[#1A1A1A]">/{skill.nombre}</p>
                    </div>
                    {skill.descripcion && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">{skill.descripcion}</p>
                    )}
                  </div>
                  {skill.tipo && TIPO_LABELS[skill.tipo] && (
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${TIPO_STYLES[skill.tipo]}`}>
                      {TIPO_LABELS[skill.tipo]}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {skill.disable_model_invocation && (
                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] text-rose-500">manual</span>
                  )}
                  {skill.effort === 'high' && (
                    <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[9px] text-purple-500">effort:high</span>
                  )}
                  {!skill.user_invocable && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-400">no-invocable</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Panel derecho: detalle ───────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Selecciona un skill para ver su definición
          </div>
        ) : (
          <SkillDetail skill={selected} />
        )}
      </div>
    </div>
  )
}

function SkillDetail({ skill }: { skill: SkillRow }) {
  const [showRaw, setShowRaw] = useState(false)
  const syncDate = new Date(skill.ultima_sync).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric'
  })

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* Header */}
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {skill.skill_id && (
                <span className="font-mono text-sm font-bold text-gray-300">{skill.skill_id}</span>
              )}
              <h2 className="font-mono text-lg font-bold text-[#1A1A1A]">/{skill.nombre}</h2>
              {skill.tipo && TIPO_LABELS[skill.tipo] && (
                <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TIPO_STYLES[skill.tipo]}`}>
                  {TIPO_LABELS[skill.tipo]}
                </span>
              )}
            </div>
            {skill.argument_hint && (
              <code className="mt-1 block text-xs text-gray-400">
                /{skill.nombre} {skill.argument_hint}
              </code>
            )}
          </div>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 transition"
          >
            {showRaw ? 'Vista previa' : 'Raw SKILL.md'}
          </button>
        </div>

        {skill.descripcion && (
          <p className="mt-2 text-sm text-gray-600">{skill.descripcion}</p>
        )}

        {/* Metadata pills */}
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {skill.allowed_tools.length > 0 && (
            <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-500">
              tools: {skill.allowed_tools.join(', ')}
            </span>
          )}
          {skill.disable_model_invocation && (
            <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-600">
              disable-model-invocation
            </span>
          )}
          {!skill.user_invocable && (
            <span className="rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-500">
              user-invocable: false
            </span>
          )}
          {skill.effort && (
            <span className="rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-purple-600">
              effort: {skill.effort}
            </span>
          )}
          <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-400">
            sync: {syncDate}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        {showRaw ? (
          <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-[11px] text-gray-700 whitespace-pre-wrap">
            {skill.contenido ?? '(sin contenido)'}
          </pre>
        ) : (
          <MarkdownPreview content={skill.contenido ?? ''} />
        )}
      </div>
    </div>
  )
}

function MarkdownPreview({ content }: { content: string }) {
  // Strip frontmatter
  const body = content.replace(/^---[\s\S]*?---\n/, '').trim()

  // Simple markdown render: headers, bold, code, lists, horizontal rules
  const lines = body.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="mb-2 mt-4 text-lg font-bold text-[#1A1A1A]">{line.slice(2)}</h1>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="mb-1.5 mt-4 text-[15px] font-bold text-[#1A1A1A]">{line.slice(3)}</h2>)
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="mb-1 mt-3 text-[13px] font-semibold text-gray-700">{line.slice(4)}</h3>)
    } else if (line.startsWith('```')) {
      // Code block
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={i} className={`my-2 overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] text-gray-700 ${lang === 'json' ? 'text-blue-800' : ''}`}>
          {codeLines.join('\n')}
        </pre>
      )
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <li key={i} className="ml-4 list-disc text-sm text-gray-600">{inlineFormat(line.slice(2))}</li>
      )
    } else if (/^\d+\. /.test(line)) {
      elements.push(
        <li key={i} className="ml-4 list-decimal text-sm text-gray-600">{inlineFormat(line.replace(/^\d+\. /, ''))}</li>
      )
    } else if (line.startsWith('---') || line.startsWith('===')) {
      elements.push(<hr key={i} className="my-3 border-gray-200" />)
    } else if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="my-2 border-l-4 border-[#10B981] pl-3 text-sm italic text-gray-600">
          {line.slice(2)}
        </blockquote>
      )
    } else if (line.startsWith('|')) {
      // Table — collect all rows
      const tableLines: string[] = [line]
      i++
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      elements.push(<SimpleTable key={`table-${i}`} lines={tableLines} />)
      continue
    } else if (line.trim()) {
      elements.push(<p key={i} className="my-1 text-sm text-gray-600">{inlineFormat(line)}</p>)
    }
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}

function inlineFormat(text: string): React.ReactNode {
  // Bold + code inline — simple split
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px] text-gray-700">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-800">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

function SimpleTable({ lines }: { lines: string[] }) {
  const rows = lines
    .filter(l => !l.match(/^\|[\s-:|]+\|$/))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()))

  if (rows.length === 0) return null
  const [header, ...body] = rows

  return (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 rounded-lg border border-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            {header.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-gray-600">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
