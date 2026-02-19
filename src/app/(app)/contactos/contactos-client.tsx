'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Search, Plus, Mail, Phone, Building2, MoreHorizontal,
  Pencil, Trash2, UserPlus, ArrowRightLeft,
} from 'lucide-react'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CONTACT_TYPES, CONTACT_SOURCES, SECTORES_EMPRESA,
  formatNit, detectarTipoCliente,
} from '@/lib/contacts/constants'
import {
  createContact, updateContact, deleteContact, convertToPromoter,
  createCompany, updateCompany, deleteCompany,
} from './actions'

// ── Types ─────────────────────────────────────────────────

type ContactWithRelations = {
  id: string
  workspace_id: string
  full_name: string
  email: string | null
  phone: string | null
  company: string | null
  client_id: string | null
  position: string | null
  contact_type: string | null
  source: string | null
  city: string | null
  country: string | null
  notes: string | null
  promoter_id: string | null
  referred_by_id: string | null
  status: string
  created_at: string | null
  updated_at: string | null
  client: { id: string; name: string; nit: string | null; digito_verificacion: string | null; person_type: string | null } | null
  promoter: { id: string; name: string } | null
  referred_by: { id: string; full_name: string; email: string | null } | null
}

type ClientWithCount = {
  id: string
  workspace_id: string
  name: string
  razon_social: string | null
  nit: string | null
  digito_verificacion: string | null
  person_type: string | null
  sector: string | null
  agente_retenedor: boolean | null
  gran_contribuyente: boolean | null
  regimen_simple: boolean | null
  email: string | null
  city: string | null
  notes: string | null
  contacts_count: number
  created_at: string | null
}

type PromoterOption = { id: string; name: string }
type ContactOption = { id: string; full_name: string; email: string | null }

interface ContactosClientProps {
  contacts: ContactWithRelations[]
  clients: ClientWithCount[]
  promoters: PromoterOption[]
  allContacts: ContactOption[]
}

// ── Contact form defaults ──────────────────────────────────

const emptyContactForm = {
  full_name: '',
  email: '',
  phone: '',
  position: '',
  contact_type: 'Cliente',
  source: '',
  promoter_id: '',
  referred_by_id: '',
  city: '',
  country: 'Colombia',
  notes: '',
  client_id: '',
  company: '',
}

// ── Client form defaults ───────────────────────────────────

const emptyClientForm = {
  name: '',
  razon_social: '',
  nit: '',
  digito_verificacion: '',
  person_type: '',
  sector: '',
  agente_retenedor: false,
  gran_contribuyente: false,
  regimen_simple: false,
  email: '',
  city: '',
  notes: '',
}

// ── New company inline form defaults ───────────────────────

const emptyNewCompanyForm = {
  name: '',
  razon_social: '',
  nit: '',
  digito_verificacion: '',
  sector: '',
  person_type: '',
  agente_retenedor: false,
  gran_contribuyente: false,
  regimen_simple: false,
}

// ── Empresa Autocomplete Component ─────────────────────────

function EmpresaAutocomplete({
  clients,
  selectedClientId,
  onSelect,
  onCreateNew,
}: {
  clients: ClientWithCount[]
  selectedClientId: string
  onSelect: (clientId: string) => void
  onCreateNew: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedClient = clients.find(c => c.id === selectedClientId)

  useEffect(() => {
    if (selectedClient) {
      setQuery(selectedClient.name)
    }
  }, [selectedClient])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    (c.nit && c.nit.includes(query))
  )

  return (
    <div ref={containerRef} className="relative">
      <Label className="text-sm font-medium">Empresa</Label>
      <div className="relative mt-1.5">
        <Building2 className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder="Buscar empresa o crear nueva..."
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
            if (!e.target.value) {
              onSelect('')
            }
          }}
          onFocus={() => setOpen(true)}
          className="pl-9"
        />
      </div>

      {/* Selected client fiscal badges */}
      {selectedClient && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px]">
            {selectedClient.person_type === 'juridica' ? 'PJ' : selectedClient.person_type === 'natural' ? 'PN' : '—'}
          </Badge>
          {selectedClient.agente_retenedor && (
            <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Retiene</Badge>
          )}
          {selectedClient.gran_contribuyente && (
            <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">Gran C.</Badge>
          )}
          {selectedClient.regimen_simple && (
            <Badge variant="secondary" className="text-[10px] bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">R. Simple</Badge>
          )}
        </div>
      )}

      {/* Dropdown */}
      {open && query.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-52 overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onSelect(c.id)
                setQuery(c.name)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent ${
                selectedClientId === c.id ? 'bg-accent/50 font-medium' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{c.name}</span>
              </div>
              {c.nit && (
                <span className="text-xs text-muted-foreground ml-2 shrink-0">
                  {formatNit(c.nit, c.digito_verificacion)}
                </span>
              )}
            </button>
          ))}

          {/* Create new option */}
          <button
            type="button"
            onClick={() => {
              onCreateNew(query)
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            Crear empresa &ldquo;{query}&rdquo;
          </button>
        </div>
      )}
    </div>
  )
}

// ── Inline New Company Form ────────────────────────────────

function InlineNewCompanyForm({
  form,
  onChange,
}: {
  form: typeof emptyNewCompanyForm
  onChange: (updated: typeof emptyNewCompanyForm) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
      <p className="text-xs font-medium text-primary">Nueva empresa</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Razon social</Label>
          <Input
            value={form.razon_social}
            onChange={e => onChange({ ...form, razon_social: e.target.value })}
            placeholder="Raz\u00f3n social"
            className="mt-1"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">NIT</Label>
            <Input
              value={form.nit}
              onChange={e => onChange({ ...form, nit: e.target.value })}
              placeholder="NIT"
              className="mt-1"
            />
          </div>
          <div className="w-16">
            <Label className="text-xs">DV</Label>
            <Input
              value={form.digito_verificacion}
              onChange={e => onChange({ ...form, digito_verificacion: e.target.value.slice(0, 1) })}
              placeholder="DV"
              maxLength={1}
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Sector</Label>
          <Select
            value={form.sector}
            onValueChange={v => onChange({ ...form, sector: v })}
          >
            <SelectTrigger className="mt-1 w-full">
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              {SECTORES_EMPRESA.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select
            value={form.person_type}
            onValueChange={v => onChange({ ...form, person_type: v })}
          >
            <SelectTrigger className="mt-1 w-full">
              <SelectValue placeholder="Auto-detectado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="juridica">Persona Jur\u00eddica</SelectItem>
              <SelectItem value="natural">Persona Natural</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.agente_retenedor}
            onChange={e => onChange({ ...form, agente_retenedor: e.target.checked })}
            className="rounded border"
          />
          Agente retenedor
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.gran_contribuyente}
            onChange={e => onChange({ ...form, gran_contribuyente: e.target.checked })}
            className="rounded border"
          />
          Gran contribuyente
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.regimen_simple}
            onChange={e => onChange({ ...form, regimen_simple: e.target.checked })}
            className="rounded border"
          />
          R\u00e9gimen Simple
        </label>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────

export default function ContactosClient({
  contacts,
  clients,
  promoters,
  allContacts,
}: ContactosClientProps) {
  const router = useRouter()

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState('contactos')

  // ── Search state per tab ──
  const [contactSearch, setContactSearch] = useState('')
  const [clientSearch, setClientSearch] = useState('')

  // ── Contact dialog state ──
  const [contactDialogOpen, setContactDialogOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<ContactWithRelations | null>(null)
  const [contactForm, setContactForm] = useState(emptyContactForm)
  const [savingContact, setSavingContact] = useState(false)

  // ── Company autocomplete state (inside contact dialog) ──
  const [creatingNewCompany, setCreatingNewCompany] = useState(false)
  const [newCompanyForm, setNewCompanyForm] = useState(emptyNewCompanyForm)

  // ── Client dialog state ──
  const [clientDialogOpen, setClientDialogOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<ClientWithCount | null>(null)
  const [clientForm, setClientForm] = useState(emptyClientForm)
  const [savingClient, setSavingClient] = useState(false)

  // ── Helpers ──

  const formatDate = (date: string | null) => {
    if (!date) return '—'
    return new Date(date).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'Cliente':
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-0">{type}</Badge>
      case 'Proveedor':
        return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-0">{type}</Badge>
      case 'Promotor':
        return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-0">{type}</Badge>
      default:
        return <Badge variant="secondary">{type}</Badge>
    }
  }

  // ── Contact handlers ──

  const resetContactForm = useCallback(() => {
    setContactForm(emptyContactForm)
    setEditingContact(null)
    setCreatingNewCompany(false)
    setNewCompanyForm(emptyNewCompanyForm)
    setContactDialogOpen(false)
  }, [])

  const openNewContact = () => {
    resetContactForm()
    setContactDialogOpen(true)
  }

  const openEditContact = (c: ContactWithRelations) => {
    setContactForm({
      full_name: c.full_name,
      email: c.email || '',
      phone: c.phone || '',
      position: c.position || '',
      contact_type: c.contact_type || 'Cliente',
      source: c.source || '',
      promoter_id: c.promoter_id || '',
      referred_by_id: c.referred_by_id || '',
      city: c.city || '',
      country: c.country || 'Colombia',
      notes: c.notes || '',
      client_id: c.client_id || '',
      company: c.company || '',
    })
    setEditingContact(c)
    setCreatingNewCompany(false)
    setNewCompanyForm(emptyNewCompanyForm)
    setContactDialogOpen(true)
  }

  const handleSaveContact = async () => {
    if (!contactForm.full_name.trim()) {
      toast.error('El nombre es requerido')
      return
    }
    setSavingContact(true)

    let finalClientId = contactForm.client_id

    // If creating a new company inline, create it first
    if (creatingNewCompany && newCompanyForm.name.trim()) {
      const clientRes = await createCompany({
        name: newCompanyForm.name,
        razon_social: newCompanyForm.razon_social || undefined,
        nit: newCompanyForm.nit || undefined,
        digito_verificacion: newCompanyForm.digito_verificacion || undefined,
        sector: newCompanyForm.sector || undefined,
        person_type: newCompanyForm.person_type || undefined,
        agente_retenedor: newCompanyForm.agente_retenedor,
        gran_contribuyente: newCompanyForm.gran_contribuyente,
        regimen_simple: newCompanyForm.regimen_simple,
      })
      if (clientRes.error) {
        toast.error(clientRes.error)
        setSavingContact(false)
        return
      }
      finalClientId = clientRes.clientId || ''
    }

    const payload = {
      full_name: contactForm.full_name,
      email: contactForm.email || undefined,
      phone: contactForm.phone || undefined,
      position: contactForm.position || undefined,
      contact_type: contactForm.contact_type || undefined,
      source: contactForm.source || undefined,
      city: contactForm.city || undefined,
      country: contactForm.country || undefined,
      notes: contactForm.notes || undefined,
      client_id: finalClientId || undefined,
      company: contactForm.company || undefined,
      promoter_id: contactForm.source === 'Promotor' ? (contactForm.promoter_id || undefined) : undefined,
      referred_by_id: contactForm.source === 'Referido' ? (contactForm.referred_by_id || undefined) : undefined,
    }

    if (editingContact) {
      const res = await updateContact(editingContact.id, {
        ...payload,
        email: payload.email || null,
        phone: payload.phone || null,
        position: payload.position || null,
        city: payload.city || null,
        country: payload.country || null,
        notes: payload.notes || null,
        client_id: payload.client_id || null,
        company: payload.company || null,
        promoter_id: payload.promoter_id || null,
        referred_by_id: payload.referred_by_id || null,
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Contacto actualizado')
        resetContactForm()
        router.refresh()
      }
    } else {
      const res = await createContact(payload)
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Contacto creado')
        resetContactForm()
        router.refresh()
      }
    }
    setSavingContact(false)
  }

  const handleDeleteContact = async (id: string) => {
    if (!window.confirm('¿Eliminar este contacto?')) return
    const res = await deleteContact(id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Contacto eliminado')
      router.refresh()
    }
  }

  const handleConvertToPromoter = async (contactId: string) => {
    if (!window.confirm('¿Convertir este contacto en Promotor? Se creará un registro en la tabla de promotores.')) return
    const res = await convertToPromoter(contactId)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Contacto convertido a Promotor')
      router.refresh()
    }
  }

  // ── Client handlers ──

  const resetClientForm = useCallback(() => {
    setClientForm(emptyClientForm)
    setEditingClient(null)
    setClientDialogOpen(false)
  }, [])

  const openNewClient = () => {
    resetClientForm()
    setClientDialogOpen(true)
  }

  const openEditClient = (c: ClientWithCount) => {
    setClientForm({
      name: c.name,
      razon_social: c.razon_social || '',
      nit: c.nit || '',
      digito_verificacion: c.digito_verificacion || '',
      person_type: c.person_type || '',
      sector: c.sector || '',
      agente_retenedor: c.agente_retenedor ?? false,
      gran_contribuyente: c.gran_contribuyente ?? false,
      regimen_simple: c.regimen_simple ?? false,
      email: c.email || '',
      city: c.city || '',
      notes: c.notes || '',
    })
    setEditingClient(c)
    setClientDialogOpen(true)
  }

  const handleSaveClient = async () => {
    if (!clientForm.name.trim()) {
      toast.error('El nombre es requerido')
      return
    }
    setSavingClient(true)

    if (editingClient) {
      const res = await updateCompany(editingClient.id, {
        name: clientForm.name,
        razon_social: clientForm.razon_social || null,
        nit: clientForm.nit || null,
        digito_verificacion: clientForm.digito_verificacion || null,
        person_type: clientForm.person_type || null,
        sector: clientForm.sector || null,
        agente_retenedor: clientForm.agente_retenedor,
        gran_contribuyente: clientForm.gran_contribuyente,
        regimen_simple: clientForm.regimen_simple,
        email: clientForm.email || null,
        city: clientForm.city || null,
        notes: clientForm.notes || null,
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Empresa actualizada')
        resetClientForm()
        router.refresh()
      }
    } else {
      const res = await createCompany({
        name: clientForm.name,
        razon_social: clientForm.razon_social || undefined,
        nit: clientForm.nit || undefined,
        digito_verificacion: clientForm.digito_verificacion || undefined,
        person_type: clientForm.person_type || undefined,
        sector: clientForm.sector || undefined,
        agente_retenedor: clientForm.agente_retenedor,
        gran_contribuyente: clientForm.gran_contribuyente,
        regimen_simple: clientForm.regimen_simple,
        email: clientForm.email || undefined,
        city: clientForm.city || undefined,
        notes: clientForm.notes || undefined,
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Empresa creada')
        resetClientForm()
        router.refresh()
      }
    }
    setSavingClient(false)
  }

  const handleDeleteClient = async (id: string) => {
    if (!window.confirm('¿Desactivar esta empresa? Los contactos vinculados no se eliminarán.')) return
    const res = await deleteCompany(id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Empresa desactivada')
      router.refresh()
    }
  }

  // Auto-detect person_type when client name changes
  useEffect(() => {
    if (clientForm.name) {
      const detected = detectarTipoCliente(clientForm.name)
      if (detected) {
        setClientForm(prev => ({ ...prev, person_type: detected }))
      }
    }
  }, [clientForm.name])

  // Auto-detect for new company inline form
  useEffect(() => {
    if (newCompanyForm.name) {
      const detected = detectarTipoCliente(newCompanyForm.name)
      if (detected) {
        setNewCompanyForm(prev => ({ ...prev, person_type: detected }))
      }
    }
  }, [newCompanyForm.name])

  // ── Filtered lists ──

  const filteredContacts = contacts.filter(c => {
    const q = contactSearch.toLowerCase()
    if (!q) return true
    return (
      c.full_name.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.client?.name?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q)
    )
  })

  const filteredClients = clients.filter(c => {
    const q = clientSearch.toLowerCase()
    if (!q) return true
    return (
      c.name.toLowerCase().includes(q) ||
      c.nit?.toLowerCase().includes(q) ||
      c.sector?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q)
    )
  })

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Contactos</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona tus contactos y empresas
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="contactos">
            Contactos
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {contacts.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="empresas">
            Empresas
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {clients.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* ═══════════ TAB: CONTACTOS ═══════════ */}
        <TabsContent value="contactos">
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar contactos..."
                  value={contactSearch}
                  onChange={e => setContactSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <button
                onClick={openNewContact}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Nuevo Contacto
              </button>
            </div>

            {/* Table */}
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nombre</TableHead>
                    <TableHead className="text-xs">Empresa</TableHead>
                    <TableHead className="text-xs">Contacto</TableHead>
                    <TableHead className="text-xs">Tipo</TableHead>
                    <TableHead className="text-xs">Ciudad</TableHead>
                    <TableHead className="text-xs">Creado</TableHead>
                    <TableHead className="text-xs text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContacts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                        {contactSearch ? 'Sin resultados' : 'No hay contactos a\u00fan'}
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredContacts.map(c => (
                    <TableRow key={c.id}>
                      {/* Nombre + Cargo */}
                      <TableCell>
                        <p className="font-medium text-sm">{c.full_name}</p>
                        {c.position && (
                          <p className="text-xs text-muted-foreground">{c.position}</p>
                        )}
                      </TableCell>

                      {/* Empresa */}
                      <TableCell>
                        {c.client ? (
                          <span className="flex items-center gap-1.5 text-sm">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[160px]">{c.client.name}</span>
                          </span>
                        ) : c.company ? (
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate max-w-[160px]">{c.company}</span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">&mdash;</span>
                        )}
                      </TableCell>

                      {/* Contacto (email + phone) */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {c.email && (
                            <a
                              href={`mailto:${c.email}`}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title={c.email}
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {c.phone && (
                            <a
                              href={`tel:${c.phone}`}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title={c.phone}
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {!c.email && !c.phone && (
                            <span className="text-xs text-muted-foreground">&mdash;</span>
                          )}
                        </div>
                      </TableCell>

                      {/* Tipo */}
                      <TableCell>{getTypeBadge(c.contact_type ?? '')}</TableCell>

                      {/* Ciudad */}
                      <TableCell className="text-sm text-muted-foreground">
                        {c.city || '—'}
                      </TableCell>

                      {/* Creado */}
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(c.created_at)}
                      </TableCell>

                      {/* Acciones */}
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="rounded p-1.5 hover:bg-accent transition-colors">
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditContact(c)}>
                              <Pencil className="h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            {c.contact_type !== 'Promotor' && (
                              <DropdownMenuItem onClick={() => handleConvertToPromoter(c.id)}>
                                <ArrowRightLeft className="h-4 w-4" />
                                Convertir a Promotor
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDeleteContact(c.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════ TAB: EMPRESAS ═══════════ */}
        <TabsContent value="empresas">
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar empresas..."
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <button
                onClick={openNewClient}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Nueva Empresa
              </button>
            </div>

            {/* Table */}
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nombre</TableHead>
                    <TableHead className="text-xs">NIT</TableHead>
                    <TableHead className="text-xs">Tipo</TableHead>
                    <TableHead className="text-xs">Sector</TableHead>
                    <TableHead className="text-xs">Fiscal</TableHead>
                    <TableHead className="text-xs text-center">Contactos</TableHead>
                    <TableHead className="text-xs text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                        {clientSearch ? 'Sin resultados' : 'No hay empresas a\u00fan'}
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredClients.map(c => (
                    <TableRow key={c.id}>
                      {/* Nombre */}
                      <TableCell className="font-medium text-sm">{c.name}</TableCell>

                      {/* NIT */}
                      <TableCell className="text-sm text-muted-foreground">
                        {c.nit ? formatNit(c.nit, c.digito_verificacion) : '—'}
                      </TableCell>

                      {/* Tipo */}
                      <TableCell>
                        {c.person_type === 'juridica' ? (
                          <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 border-0">PJ</Badge>
                        ) : c.person_type === 'natural' ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-0">PN</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Sector */}
                      <TableCell className="text-sm text-muted-foreground">
                        {c.sector || '—'}
                      </TableCell>

                      {/* Fiscal badges */}
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {c.agente_retenedor && (
                            <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                              Retiene
                            </Badge>
                          )}
                          {c.gran_contribuyente && (
                            <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                              Gran C.
                            </Badge>
                          )}
                          {c.regimen_simple && (
                            <Badge variant="secondary" className="text-[10px] bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">
                              R. Simple
                            </Badge>
                          )}
                          {!c.agente_retenedor && !c.gran_contribuyente && !c.regimen_simple && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>

                      {/* Contactos count */}
                      <TableCell className="text-center text-sm">
                        {c.contacts_count > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                            {c.contacts_count}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>

                      {/* Acciones */}
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="rounded p-1.5 hover:bg-accent transition-colors">
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditClient(c)}>
                              <Pencil className="h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDeleteClient(c.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ═══════════ DIALOG: CONTACTO ═══════════ */}
      <Dialog open={contactDialogOpen} onOpenChange={open => {
        if (!open) resetContactForm()
        setContactDialogOpen(open)
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingContact ? 'Editar Contacto' : 'Nuevo Contacto'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Row 1: Nombre + Email */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ct-name">Nombre *</Label>
                <Input
                  id="ct-name"
                  value={contactForm.full_name}
                  onChange={e => setContactForm(prev => ({ ...prev, full_name: e.target.value }))}
                  placeholder="Nombre completo"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="ct-email">Email</Label>
                <Input
                  id="ct-email"
                  type="email"
                  value={contactForm.email}
                  onChange={e => setContactForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="correo@ejemplo.com"
                  className="mt-1.5"
                />
              </div>
            </div>

            {/* Row 2: Telefono + Cargo */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ct-phone">Tel\u00e9fono</Label>
                <Input
                  id="ct-phone"
                  value={contactForm.phone}
                  onChange={e => setContactForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="+57 300 123 4567"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="ct-position">Cargo</Label>
                <Input
                  id="ct-position"
                  value={contactForm.position}
                  onChange={e => setContactForm(prev => ({ ...prev, position: e.target.value }))}
                  placeholder="Director, Gerente..."
                  className="mt-1.5"
                />
              </div>
            </div>

            {/* Row 3: Empresa autocomplete */}
            {!creatingNewCompany ? (
              <EmpresaAutocomplete
                clients={clients}
                selectedClientId={contactForm.client_id}
                onSelect={clientId => setContactForm(prev => ({ ...prev, client_id: clientId }))}
                onCreateNew={name => {
                  setCreatingNewCompany(true)
                  setNewCompanyForm({ ...emptyNewCompanyForm, name })
                  setContactForm(prev => ({ ...prev, client_id: '' }))
                }}
              />
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-sm font-medium">Empresa</Label>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingNewCompany(false)
                      setNewCompanyForm(emptyNewCompanyForm)
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancelar nueva
                  </button>
                </div>
                <Input
                  value={newCompanyForm.name}
                  onChange={e => setNewCompanyForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Nombre de la empresa"
                  className="mb-3"
                />
                <InlineNewCompanyForm
                  form={newCompanyForm}
                  onChange={setNewCompanyForm}
                />
              </div>
            )}

            {/* Row 4: Tipo + Fuente */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={contactForm.contact_type}
                  onValueChange={v => setContactForm(prev => ({ ...prev, contact_type: v }))}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fuente</Label>
                <Select
                  value={contactForm.source}
                  onValueChange={v => setContactForm(prev => ({ ...prev, source: v }))}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Seleccionar fuente" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_SOURCES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Conditional: Promoter select */}
            {contactForm.source === 'Promotor' && (
              <div>
                <Label>Promotor</Label>
                <Select
                  value={contactForm.promoter_id}
                  onValueChange={v => setContactForm(prev => ({ ...prev, promoter_id: v }))}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Seleccionar promotor" />
                  </SelectTrigger>
                  <SelectContent>
                    {promoters.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Conditional: Referido por select */}
            {contactForm.source === 'Referido' && (
              <div>
                <Label>Referido por</Label>
                <Select
                  value={contactForm.referred_by_id}
                  onValueChange={v => setContactForm(prev => ({ ...prev, referred_by_id: v }))}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Seleccionar contacto" />
                  </SelectTrigger>
                  <SelectContent>
                    {allContacts.map(ac => (
                      <SelectItem key={ac.id} value={ac.id}>
                        {ac.full_name}{ac.email ? ` (${ac.email})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Row 5: Ciudad + Pais */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ct-city">Ciudad</Label>
                <Input
                  id="ct-city"
                  value={contactForm.city}
                  onChange={e => setContactForm(prev => ({ ...prev, city: e.target.value }))}
                  placeholder="Bogot\u00e1, Medell\u00edn..."
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="ct-country">Pa\u00eds</Label>
                <Input
                  id="ct-country"
                  value={contactForm.country}
                  onChange={e => setContactForm(prev => ({ ...prev, country: e.target.value }))}
                  placeholder="Colombia"
                  className="mt-1.5"
                />
              </div>
            </div>

            {/* Row 6: Notas */}
            <div>
              <Label htmlFor="ct-notes">Notas</Label>
              <Textarea
                id="ct-notes"
                value={contactForm.notes}
                onChange={e => setContactForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Notas adicionales..."
                rows={3}
                className="mt-1.5"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={resetContactForm}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveContact}
                disabled={savingContact}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {savingContact ? 'Guardando...' : editingContact ? 'Guardar cambios' : 'Crear contacto'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════ DIALOG: EMPRESA ═══════════ */}
      <Dialog open={clientDialogOpen} onOpenChange={open => {
        if (!open) resetClientForm()
        setClientDialogOpen(open)
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingClient ? 'Editar Empresa' : 'Nueva Empresa'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Row 1: Nombre */}
            <div>
              <Label htmlFor="cl-name">Nombre *</Label>
              <Input
                id="cl-name"
                value={clientForm.name}
                onChange={e => setClientForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nombre de la empresa"
                className="mt-1.5"
              />
            </div>

            {/* Row 2: Razon social */}
            <div>
              <Label htmlFor="cl-razon">Raz\u00f3n Social</Label>
              <Input
                id="cl-razon"
                value={clientForm.razon_social}
                onChange={e => setClientForm(prev => ({ ...prev, razon_social: e.target.value }))}
                placeholder="Raz\u00f3n social completa"
                className="mt-1.5"
              />
            </div>

            {/* Row 3: NIT + DV */}
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="cl-nit">NIT</Label>
                <Input
                  id="cl-nit"
                  value={clientForm.nit}
                  onChange={e => setClientForm(prev => ({ ...prev, nit: e.target.value }))}
                  placeholder="900123456"
                  className="mt-1.5"
                />
              </div>
              <div className="w-20">
                <Label htmlFor="cl-dv">DV</Label>
                <Input
                  id="cl-dv"
                  value={clientForm.digito_verificacion}
                  onChange={e => setClientForm(prev => ({ ...prev, digito_verificacion: e.target.value.slice(0, 1) }))}
                  placeholder="7"
                  maxLength={1}
                  className="mt-1.5"
                />
              </div>
            </div>

            {/* Row 4: Sector + Tipo */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Sector</Label>
                <Select
                  value={clientForm.sector}
                  onValueChange={v => setClientForm(prev => ({ ...prev, sector: v }))}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Seleccionar sector" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTORES_EMPRESA.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo cliente</Label>
                <Select
                  value={clientForm.person_type}
                  onValueChange={v => setClientForm(prev => ({ ...prev, person_type: v }))}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Auto-detectado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="juridica">Persona Jur\u00eddica</SelectItem>
                    <SelectItem value="natural">Persona Natural</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 5: Fiscal checkboxes */}
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clientForm.agente_retenedor}
                  onChange={e => setClientForm(prev => ({ ...prev, agente_retenedor: e.target.checked }))}
                  className="rounded border"
                />
                Agente retenedor
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clientForm.gran_contribuyente}
                  onChange={e => setClientForm(prev => ({ ...prev, gran_contribuyente: e.target.checked }))}
                  className="rounded border"
                />
                Gran contribuyente
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clientForm.regimen_simple}
                  onChange={e => setClientForm(prev => ({ ...prev, regimen_simple: e.target.checked }))}
                  className="rounded border"
                />
                R\u00e9gimen Simple
              </label>
            </div>

            {/* Row 6: Ciudad + Email */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="cl-city">Ciudad</Label>
                <Input
                  id="cl-city"
                  value={clientForm.city}
                  onChange={e => setClientForm(prev => ({ ...prev, city: e.target.value }))}
                  placeholder="Bogot\u00e1, Medell\u00edn..."
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="cl-email">Email</Label>
                <Input
                  id="cl-email"
                  type="email"
                  value={clientForm.email}
                  onChange={e => setClientForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="empresa@ejemplo.com"
                  className="mt-1.5"
                />
              </div>
            </div>

            {/* Row 7: Notas */}
            <div>
              <Label htmlFor="cl-notes">Notas</Label>
              <Textarea
                id="cl-notes"
                value={clientForm.notes}
                onChange={e => setClientForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Notas adicionales..."
                rows={3}
                className="mt-1.5"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={resetClientForm}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveClient}
                disabled={savingClient}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {savingClient ? 'Guardando...' : editingClient ? 'Guardar cambios' : 'Crear empresa'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
