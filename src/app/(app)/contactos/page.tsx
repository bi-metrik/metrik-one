import { getContacts, getClients, getPromotersForSelect, getContactsForSelect } from './actions'
import ContactosClient from './contactos-client'

export default async function ContactosPage() {
  const [contacts, clients, promoters, allContacts] = await Promise.all([
    getContacts(),
    getClients(),
    getPromotersForSelect(),
    getContactsForSelect(),
  ])

  return (
    <ContactosClient
      contacts={contacts}
      clients={clients}
      promoters={promoters}
      allContacts={allContacts}
    />
  )
}
