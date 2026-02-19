export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string
          slug: string
          name: string
          subscription_status: string
          subscription_started_at: string | null
          subscription_expires_at: string | null
          trial_ends_at: string | null
          profession: string | null
          years_independent: number | null
          onboarding_completed: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug?: string
          name: string
          subscription_status?: string
          subscription_started_at?: string | null
          subscription_expires_at?: string | null
          trial_ends_at?: string | null
          profession?: string | null
          years_independent?: number | null
          onboarding_completed?: boolean
        }
        Update: Partial<Database['public']['Tables']['workspaces']['Insert']>
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          workspace_id: string
          full_name: string | null
          role: string
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          workspace_id: string
          full_name?: string | null
          role?: string
          avatar_url?: string | null
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
        Relationships: []
      }
      fiscal_profiles: {
        Row: {
          id: string
          workspace_id: string
          person_type: string | null
          tax_regime: string | null
          ciiu: string | null
          self_withholder: boolean
          ica_rate: number | null
          ica_city: string | null
          is_complete: boolean
          is_estimated: boolean
          nudge_count: number
          iva_responsible: boolean
          is_declarante: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          person_type?: string | null
          tax_regime?: string | null
          ciiu?: string | null
          self_withholder?: boolean
          ica_rate?: number | null
          ica_city?: string | null
          is_complete?: boolean
          is_estimated?: boolean
          nudge_count?: number
          iva_responsible?: boolean
          is_declarante?: boolean
        }
        Update: Partial<Database['public']['Tables']['fiscal_profiles']['Insert']>
        Relationships: []
      }
      fiscal_params: {
        Row: {
          id: string
          key: string
          value: number
          description: string | null
          valid_from: string | null
          valid_to: string | null
          created_at: string
        }
        Insert: {
          id?: string
          key: string
          value: number
          description?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: Partial<Database['public']['Tables']['fiscal_params']['Insert']>
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          workspace_id: string
          name: string
          nit: string | null
          person_type: string | null
          tax_regime: string | null
          gran_contribuyente: boolean
          agente_retenedor: boolean
          contact_name: string | null
          contact_phone: string | null
          email: string | null
          address: string | null
          city: string | null
          notes: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          nit?: string | null
          person_type?: string | null
          tax_regime?: string | null
          gran_contribuyente?: boolean
          agente_retenedor?: boolean
          contact_name?: string | null
          contact_phone?: string | null
          email?: string | null
          address?: string | null
          city?: string | null
          notes?: string | null
          is_active?: boolean
        }
        Update: Partial<Database['public']['Tables']['clients']['Insert']>
        Relationships: []
      }
      expense_categories: {
        Row: {
          id: string
          workspace_id: string
          name: string
          is_deductible: string
          deduction_pct: number | null
          sort_order: number | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          is_deductible?: string
          deduction_pct?: number | null
          sort_order?: number | null
          is_active?: boolean
        }
        Update: Partial<Database['public']['Tables']['expense_categories']['Insert']>
        Relationships: []
      }
      opportunities: {
        Row: {
          id: string
          workspace_id: string
          client_id: string | null
          name: string
          estimated_value: number
          stage: string
          probability: number
          source: string | null
          lost_reason: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id?: string | null
          name: string
          estimated_value?: number
          stage?: string
          probability?: number
          source?: string | null
          lost_reason?: string | null
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['opportunities']['Insert']>
        Relationships: []
      }
      opportunity_stage_history: {
        Row: {
          id: string
          workspace_id: string
          opportunity_id: string
          from_stage: string | null
          to_stage: string
          changed_at: string
          changed_by: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          opportunity_id: string
          from_stage?: string | null
          to_stage: string
          changed_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['opportunity_stage_history']['Insert']>
        Relationships: []
      }
      quotes: {
        Row: {
          id: string
          workspace_id: string
          client_id: string | null
          opportunity_id: string | null
          mode: string
          description: string | null
          total_price: number
          estimated_cost: number | null
          iva_amount: number | null
          retention_amount: number | null
          net_amount: number | null
          profit_amount: number | null
          margin_pct: number | null
          status: string
          sent_at: string | null
          accepted_at: string | null
          valid_until: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id?: string | null
          opportunity_id?: string | null
          mode?: string
          description?: string | null
          total_price?: number
          estimated_cost?: number | null
          iva_amount?: number | null
          retention_amount?: number | null
          net_amount?: number | null
          profit_amount?: number | null
          margin_pct?: number | null
          status?: string
          sent_at?: string | null
          accepted_at?: string | null
          valid_until?: string | null
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['quotes']['Insert']>
        Relationships: []
      }
      quote_items: {
        Row: {
          id: string
          quote_id: string
          item_type: string
          description: string
          quantity: number
          unit_price: number
          total: number
          sort_order: number | null
        }
        Insert: {
          id?: string
          quote_id: string
          item_type: string
          description: string
          quantity?: number
          unit_price?: number
          sort_order?: number | null
        }
        Update: Partial<Database['public']['Tables']['quote_items']['Insert']>
        Relationships: []
      }
      projects: {
        Row: {
          id: string
          workspace_id: string
          client_id: string | null
          opportunity_id: string | null
          quote_id: string | null
          name: string
          approved_budget: number | null
          start_date: string | null
          estimated_end_date: string | null
          status: string
          progress_pct: number
          rework_reason: string | null
          rework_cost: number | null
          closed_at: string | null
          actual_cost: number | null
          actual_margin_pct: number | null
          lessons_learned: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id?: string | null
          opportunity_id?: string | null
          quote_id?: string | null
          name: string
          approved_budget?: number | null
          start_date?: string | null
          estimated_end_date?: string | null
          status?: string
          progress_pct?: number
          rework_reason?: string | null
          rework_cost?: number | null
        }
        Update: Partial<Database['public']['Tables']['projects']['Insert']>
        Relationships: []
      }
      time_entries: {
        Row: {
          id: string
          workspace_id: string
          project_id: string
          user_id: string | null
          entry_date: string
          hours: number
          activity: string | null
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          project_id: string
          user_id?: string | null
          entry_date?: string
          hours: number
          activity?: string | null
          source?: string
        }
        Update: Partial<Database['public']['Tables']['time_entries']['Insert']>
        Relationships: []
      }
      expenses: {
        Row: {
          id: string
          workspace_id: string
          project_id: string | null
          category_id: string
          expense_date: string
          amount: number
          description: string | null
          support_url: string | null
          is_rework: boolean
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          project_id?: string | null
          category_id: string
          expense_date?: string
          amount: number
          description?: string | null
          support_url?: string | null
          is_rework?: boolean
          source?: string
        }
        Update: Partial<Database['public']['Tables']['expenses']['Insert']>
        Relationships: []
      }
      fixed_expenses: {
        Row: {
          id: string
          workspace_id: string
          category_id: string | null
          description: string
          monthly_amount: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          category_id?: string | null
          description: string
          monthly_amount: number
          is_active?: boolean
        }
        Update: Partial<Database['public']['Tables']['fixed_expenses']['Insert']>
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          workspace_id: string
          project_id: string
          concept: string
          gross_amount: number
          due_date: string | null
          status: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          project_id: string
          concept: string
          gross_amount: number
          due_date?: string | null
          status?: string
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['invoices']['Insert']>
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          workspace_id: string
          invoice_id: string
          net_received: number
          payment_date: string
          payment_method: string
          retention_applied: number
          source: string
          reference: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          invoice_id: string
          net_received: number
          payment_date?: string
          payment_method?: string
          retention_applied?: number
          source?: string
          reference?: string | null
        }
        Update: Partial<Database['public']['Tables']['payments']['Insert']>
        Relationships: []
      }
      subscriptions: {
        Row: {
          id: string
          workspace_id: string
          plan: string
          status: string
          payment_provider: string | null
          payment_method: string | null
          amount: number | null
          currency: string
          current_period_start: string | null
          current_period_end: string | null
          cancelled_at: string | null
          cancel_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          plan: string
          status?: string
          payment_provider?: string | null
          payment_method?: string | null
          amount?: number | null
          currency?: string
        }
        Update: Partial<Database['public']['Tables']['subscriptions']['Insert']>
        Relationships: []
      }
      bot_sessions: {
        Row: {
          id: string
          workspace_id: string
          user_phone: string
          intent: string | null
          state: string | null
          context: Json
          started_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_phone: string
          intent?: string | null
          state?: string | null
          context?: Json
        }
        Update: Partial<Database['public']['Tables']['bot_sessions']['Insert']>
        Relationships: []
      }
      wa_collaborators: {
        Row: {
          id: string
          workspace_id: string
          name: string
          phone: string
          is_active: boolean
          requires_approval: boolean
          consent_accepted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          phone: string
          is_active?: boolean
          requires_approval?: boolean
          consent_accepted_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['wa_collaborators']['Insert']>
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          workspace_id: string
          user_id: string | null
          type: string
          title: string
          message: string | null
          action_url: string | null
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id?: string | null
          type: string
          title: string
          message?: string | null
          action_url?: string | null
          is_read?: boolean
        }
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
        Relationships: []
      }
      referrals: {
        Row: {
          id: string
          workspace_id: string
          referrer_workspace_id: string | null
          referral_code: string
          status: string
          months_rewarded: number
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          referrer_workspace_id?: string | null
          referral_code: string
          status?: string
          months_rewarded?: number
        }
        Update: Partial<Database['public']['Tables']['referrals']['Insert']>
        Relationships: []
      }
      health_scores: {
        Row: {
          id: string
          workspace_id: string
          actions_per_week: number
          days_inactive: number
          questions_complete: number
          wa_collaborators_active: number
          summary_open_rate: number
          score: number
          calculated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          actions_per_week?: number
          days_inactive?: number
          questions_complete?: number
          wa_collaborators_active?: number
          summary_open_rate?: number
          score?: number
        }
        Update: Partial<Database['public']['Tables']['health_scores']['Insert']>
        Relationships: []
      }
      testimonials: {
        Row: {
          id: string
          workspace_id: string
          answer_1: string | null
          answer_2: string | null
          answer_3: string | null
          marketing_consent: boolean
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          answer_1?: string | null
          answer_2?: string | null
          answer_3?: string | null
          marketing_consent?: boolean
          status?: string
        }
        Update: Partial<Database['public']['Tables']['testimonials']['Insert']>
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          workspace_id: string
          user_id: string | null
          action: string
          table_name: string
          record_id: string | null
          old_data: Json | null
          new_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id?: string | null
          action: string
          table_name: string
          record_id?: string | null
          old_data?: Json | null
          new_data?: Json | null
        }
        Update: Partial<Database['public']['Tables']['audit_log']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      current_user_workspace_id: {
        Args: Record<string, never>
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

// Convenience types
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type UpdateTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

// Commonly used types
export type Workspace = Tables<'workspaces'>
export type Profile = Tables<'profiles'>
export type FiscalProfile = Tables<'fiscal_profiles'>
export type FiscalParam = Tables<'fiscal_params'>
export type Client = Tables<'clients'>
export type ExpenseCategory = Tables<'expense_categories'>
export type Opportunity = Tables<'opportunities'>
export type OpportunityStageHistory = Tables<'opportunity_stage_history'>
export type Quote = Tables<'quotes'>
export type QuoteItem = Tables<'quote_items'>
export type Project = Tables<'projects'>
export type TimeEntry = Tables<'time_entries'>
export type Expense = Tables<'expenses'>
export type FixedExpense = Tables<'fixed_expenses'>
export type Invoice = Tables<'invoices'>
export type Payment = Tables<'payments'>
export type Subscription = Tables<'subscriptions'>
export type BotSession = Tables<'bot_sessions'>
export type WaCollaborator = Tables<'wa_collaborators'>
export type Notification = Tables<'notifications'>
export type Referral = Tables<'referrals'>
export type HealthScore = Tables<'health_scores'>
export type Testimonial = Tables<'testimonials'>
export type AuditLog = Tables<'audit_log'>
