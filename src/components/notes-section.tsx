'use client'

import { useState, useEffect, useTransition } from 'react'
import { MessageSquare, Plus, Trash2, X, Send, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { getNotes, addNote, deleteNote } from '@/app/(app)/notes-actions'
import type { Note } from '@/types/database'

interface NotesSectionProps {
  entityType: string   // 'opportunity', 'project', 'contact', etc.
  entityId: string
  /** Optional: show inherited notes from another entity (e.g., opportunity notes on a project) */
  inheritedFrom?: {
    entityType: string
    entityId: string
    label: string
  }
}

const NOTE_TYPES = [
  { value: 'nota', label: 'Nota', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  { value: 'llamada', label: 'Llamada', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  { value: 'reunion', label: 'Reunión', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  { value: 'email', label: 'Email', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'decision', label: 'Decisión', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
]

export default function NotesSection({ entityType, entityId, inheritedFrom }: NotesSectionProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [inheritedNotes, setInheritedNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [noteType, setNoteType] = useState('nota')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    async function load() {
      const [main, inherited] = await Promise.all([
        getNotes(entityType, entityId),
        inheritedFrom ? getNotes(inheritedFrom.entityType, inheritedFrom.entityId) : Promise.resolve([]),
      ])
      setNotes(main)
      setInheritedNotes(inherited)
      setLoading(false)
    }
    load()
  }, [entityType, entityId, inheritedFrom])

  const handleAdd = () => {
    if (!content.trim()) return
    startTransition(async () => {
      const res = await addNote(entityType, entityId, content.trim(), noteType)
      if (res.success) {
        setNotes(prev => [{
          id: crypto.randomUUID(),
          workspace_id: '',
          entity_type: entityType,
          entity_id: entityId,
          note_type: noteType,
          content: content.trim(),
          created_by: null,
          created_at: new Date().toISOString(),
        }, ...prev])
        setContent('')
        setNoteType('nota')
        toast.success('Nota agregada')
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDelete = (noteId: string) => {
    startTransition(async () => {
      const res = await deleteNote(noteId)
      if (res.success) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
        toast.success('Nota eliminada')
      }
    })
  }

  const getTypeConfig = (type: string) =>
    NOTE_TYPES.find(t => t.value === type) || NOTE_TYPES[0]

  const allNotes = [
    ...notes.map(n => ({ ...n, inherited: false })),
    ...inheritedNotes.map(n => ({ ...n, inherited: true })),
  ].sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-20 rounded bg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Add note form */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="flex gap-1">
            {NOTE_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setNoteType(t.value)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  noteType === t.value ? t.color : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Escribe una nota..."
            rows={2}
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm resize-none"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd()
            }}
          />
          <button
            onClick={handleAdd}
            disabled={isPending || !content.trim()}
            className="flex h-auto items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Notes list */}
      {allNotes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground/30" />
          <p className="mt-1 text-xs text-muted-foreground">Sin notas aún. Agrega la primera.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allNotes.map(note => {
            const typeConfig = getTypeConfig(note.note_type ?? '')
            return (
              <div
                key={note.id}
                className={`rounded-lg border p-3 ${note.inherited ? 'border-dashed bg-muted/20' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${typeConfig.color}`}>
                      {typeConfig.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(note.created_at ?? '').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {note.inherited && inheritedFrom && (
                      <span className="text-[9px] text-muted-foreground italic">
                        de {inheritedFrom.label}
                      </span>
                    )}
                  </div>
                  {!note.inherited && (
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="shrink-0 rounded p-0.5 hover:bg-accent"
                    >
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-sm whitespace-pre-wrap">{note.content}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
