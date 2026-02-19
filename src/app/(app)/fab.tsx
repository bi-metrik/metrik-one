'use client'

import { useState } from 'react'
import { Plus, X, Funnel, Receipt } from 'lucide-react'
import { useRouter } from 'next/navigation'
import OpportunityModal from './pipeline/opportunity-modal'
import ExpenseModal from './gastos/expense-modal'
import type { Opportunity } from '@/types/database'

type OpportunityWithClient = Opportunity & {
  clients: { name: string } | null
}

/**
 * FAB — D43: Floating Action Button visible en todas las pantallas
 * Sprint 2: "Nueva oportunidad"
 * Sprint 4: "Registrar gasto" habilitado
 */
export default function FAB() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [showOppModal, setShowOppModal] = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)

  const handleOppCreated = (_opp: OpportunityWithClient) => {
    setShowOppModal(false)
    setOpen(false)
    router.push('/pipeline')
    router.refresh()
  }

  const handleExpenseCreated = () => {
    setShowExpenseModal(false)
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      {/* FAB button */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {/* Quick actions menu */}
        {open && (
          <div className="mb-2 space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Nueva oportunidad */}
            <button
              onClick={() => {
                setOpen(false)
                setShowOppModal(true)
              }}
              className="flex items-center gap-3 rounded-full border bg-background py-2.5 pl-4 pr-5 text-sm font-medium shadow-lg transition-colors hover:bg-accent"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Funnel className="h-4 w-4" />
              </div>
              Nueva oportunidad
            </button>

            {/* Registrar gasto — Sprint 4: FUNCTIONAL */}
            <button
              onClick={() => {
                setOpen(false)
                setShowExpenseModal(true)
              }}
              className="flex items-center gap-3 rounded-full border bg-background py-2.5 pl-4 pr-5 text-sm font-medium shadow-lg transition-colors hover:bg-accent"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Receipt className="h-4 w-4" />
              </div>
              Registrar gasto
            </button>
          </div>
        )}

        {/* Main FAB button */}
        <button
          onClick={() => setOpen(!open)}
          className={`flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-all hover:bg-primary/90 hover:shadow-2xl active:scale-95 ${
            open ? 'rotate-45' : ''
          }`}
        >
          {open ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
        </button>
      </div>

      {/* Backdrop when menu is open */}
      {open && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Opportunity Modal */}
      {showOppModal && (
        <OpportunityModal
          defaultStage="lead"
          onClose={() => setShowOppModal(false)}
          onCreated={handleOppCreated}
        />
      )}

      {/* Expense Modal — Sprint 4 */}
      {showExpenseModal && (
        <ExpenseModal
          onClose={() => setShowExpenseModal(false)}
          onCreated={handleExpenseCreated}
        />
      )}
    </>
  )
}
