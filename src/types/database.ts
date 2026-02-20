export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_name: string | null
          account_type: string | null
          bank_name: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_primary: boolean | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          account_name?: string | null
          account_type?: string | null
          bank_name: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          account_name?: string | null
          account_type?: string | null
          bank_name?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_balances: {
        Row: {
          account_id: string
          balance: number
          id: string
          notes: string | null
          recorded_at: string | null
          workspace_id: string
        }
        Insert: {
          account_id: string
          balance: number
          id?: string
          notes?: string | null
          recorded_at?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string
          balance?: number
          id?: string
          notes?: string | null
          recorded_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_balances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_sessions: {
        Row: {
          context: Json | null
          expires_at: string | null
          id: string
          intent: string | null
          started_at: string | null
          state: string | null
          user_phone: string
          workspace_id: string
        }
        Insert: {
          context?: Json | null
          expires_at?: string | null
          id?: string
          intent?: string | null
          started_at?: string | null
          state?: string | null
          user_phone: string
          workspace_id: string
        }
        Update: {
          context?: Json | null
          expires_at?: string | null
          id?: string
          intent?: string | null
          started_at?: string | null
          state?: string | null
          user_phone?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          agente_retenedor: boolean | null
          city: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          digito_verificacion: string | null
          email: string | null
          gran_contribuyente: boolean | null
          id: string
          is_active: boolean | null
          name: string
          nit: string | null
          notes: string | null
          person_type: string | null
          razon_social: string | null
          regimen_simple: boolean | null
          sector: string | null
          tax_regime: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          address?: string | null
          agente_retenedor?: boolean | null
          city?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          digito_verificacion?: string | null
          email?: string | null
          gran_contribuyente?: boolean | null
          id?: string
          is_active?: boolean | null
          name: string
          nit?: string | null
          notes?: string | null
          person_type?: string | null
          razon_social?: string | null
          regimen_simple?: boolean | null
          sector?: string | null
          tax_regime?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          address?: string | null
          agente_retenedor?: boolean | null
          city?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          digito_verificacion?: string | null
          email?: string | null
          gran_contribuyente?: boolean | null
          id?: string
          is_active?: boolean | null
          name?: string
          nit?: string | null
          notes?: string | null
          person_type?: string | null
          razon_social?: string | null
          regimen_simple?: boolean | null
          sector?: string | null
          tax_regime?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contactos: {
        Row: {
          comision_porcentaje: number | null
          created_at: string | null
          email: string | null
          fuente_adquisicion: string | null
          fuente_detalle: string | null
          fuente_promotor_id: string | null
          fuente_referido_nombre: string | null
          id: string
          nombre: string
          rol: string | null
          telefono: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          comision_porcentaje?: number | null
          created_at?: string | null
          email?: string | null
          fuente_adquisicion?: string | null
          fuente_detalle?: string | null
          fuente_promotor_id?: string | null
          fuente_referido_nombre?: string | null
          id?: string
          nombre: string
          rol?: string | null
          telefono?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          comision_porcentaje?: number | null
          created_at?: string | null
          email?: string | null
          fuente_adquisicion?: string | null
          fuente_detalle?: string | null
          fuente_promotor_id?: string | null
          fuente_referido_nombre?: string | null
          id?: string
          nombre?: string
          rol?: string | null
          telefono?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contactos_fuente_promotor_id_fkey"
            columns: ["fuente_promotor_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contactos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          city: string | null
          client_id: string | null
          company: string | null
          contact_type: string | null
          country: string | null
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          position: string | null
          promoter_id: string | null
          referred_by_id: string | null
          source: string | null
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          city?: string | null
          client_id?: string | null
          company?: string | null
          contact_type?: string | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          position?: string | null
          promoter_id?: string | null
          referred_by_id?: string | null
          source?: string | null
          status?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          city?: string | null
          client_id?: string | null
          company?: string | null
          contact_type?: string | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          position?: string | null
          promoter_id?: string | null
          referred_by_id?: string | null
          source?: string | null
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "promoters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_referred_by_id_fkey"
            columns: ["referred_by_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          condiciones_pago: string | null
          consecutivo: string
          costo_total: number | null
          created_at: string | null
          descripcion: string | null
          duplicada_de: string | null
          email_enviado_a: string | null
          estado: string
          fecha_envio: string | null
          fecha_validez: string | null
          id: string
          margen_porcentaje: number | null
          modo: string
          notas: string | null
          oportunidad_id: string
          updated_at: string | null
          valor_total: number
          workspace_id: string
        }
        Insert: {
          condiciones_pago?: string | null
          consecutivo: string
          costo_total?: number | null
          created_at?: string | null
          descripcion?: string | null
          duplicada_de?: string | null
          email_enviado_a?: string | null
          estado?: string
          fecha_envio?: string | null
          fecha_validez?: string | null
          id?: string
          margen_porcentaje?: number | null
          modo: string
          notas?: string | null
          oportunidad_id: string
          updated_at?: string | null
          valor_total?: number
          workspace_id: string
        }
        Update: {
          condiciones_pago?: string | null
          consecutivo?: string
          costo_total?: number | null
          created_at?: string | null
          descripcion?: string | null
          duplicada_de?: string | null
          email_enviado_a?: string | null
          estado?: string
          fecha_envio?: string | null
          fecha_validez?: string | null
          id?: string
          margen_porcentaje?: number | null
          modo?: string
          notas?: string | null
          oportunidad_id?: string
          updated_at?: string | null
          valor_total?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_duplicada_de_fkey"
            columns: ["duplicada_de"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_oportunidad_id_fkey"
            columns: ["oportunidad_id"]
            isOneToOne: false
            referencedRelation: "oportunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          agente_retenedor: boolean | null
          contacto_email: string | null
          contacto_nombre: string | null
          created_at: string | null
          gran_contribuyente: boolean | null
          id: string
          nit: string | null
          nombre: string
          regimen_tributario: string | null
          sector: string | null
          tipo_persona: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          agente_retenedor?: boolean | null
          contacto_email?: string | null
          contacto_nombre?: string | null
          created_at?: string | null
          gran_contribuyente?: boolean | null
          id?: string
          nit?: string | null
          nombre: string
          regimen_tributario?: string | null
          sector?: string | null
          tipo_persona?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          agente_retenedor?: boolean | null
          contacto_email?: string | null
          contacto_nombre?: string | null
          created_at?: string | null
          gran_contribuyente?: boolean | null
          id?: string
          nit?: string | null
          nombre?: string
          regimen_tributario?: string | null
          sector?: string | null
          tipo_persona?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string | null
          deduction_pct: number | null
          id: string
          is_active: boolean | null
          is_deductible: string
          name: string
          sort_order: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          deduction_pct?: number | null
          id?: string
          is_active?: boolean | null
          is_deductible?: string
          name: string
          sort_order?: number | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          deduction_pct?: number | null
          id?: string
          is_active?: boolean | null
          is_deductible?: string
          name?: string
          sort_order?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category_id: string
          created_at: string | null
          description: string | null
          expense_date: string
          id: string
          is_rework: boolean | null
          project_id: string | null
          source: string | null
          support_url: string | null
          workspace_id: string
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          is_rework?: boolean | null
          project_id?: string | null
          source?: string | null
          support_url?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          is_rework?: boolean | null
          project_id?: string | null
          source?: string | null
          support_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_params: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          key: string
          valid_from: string | null
          valid_to: string | null
          value: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          valid_from?: string | null
          valid_to?: string | null
          value: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          valid_from?: string | null
          valid_to?: string | null
          value?: number
        }
        Relationships: []
      }
      fiscal_profiles: {
        Row: {
          ciiu: string | null
          created_at: string | null
          ica_city: string | null
          ica_rate: number | null
          id: string
          is_complete: boolean | null
          is_declarante: boolean | null
          is_estimated: boolean | null
          iva_responsible: boolean | null
          nudge_count: number | null
          person_type: string | null
          self_withholder: boolean | null
          tax_regime: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          ciiu?: string | null
          created_at?: string | null
          ica_city?: string | null
          ica_rate?: number | null
          id?: string
          is_complete?: boolean | null
          is_declarante?: boolean | null
          is_estimated?: boolean | null
          iva_responsible?: boolean | null
          nudge_count?: number | null
          person_type?: string | null
          self_withholder?: boolean | null
          tax_regime?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          ciiu?: string | null
          created_at?: string | null
          ica_city?: string | null
          ica_rate?: number | null
          id?: string
          is_complete?: boolean | null
          is_declarante?: boolean | null
          is_estimated?: boolean | null
          iva_responsible?: boolean | null
          nudge_count?: number | null
          person_type?: string | null
          self_withholder?: boolean | null
          tax_regime?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_expenses: {
        Row: {
          category_id: string | null
          created_at: string | null
          description: string
          id: string
          is_active: boolean | null
          monthly_amount: number
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          description: string
          id?: string
          is_active?: boolean | null
          monthly_amount: number
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          description?: string
          id?: string
          is_active?: boolean | null
          monthly_amount?: number
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_expenses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      gastos: {
        Row: {
          canal_registro: string | null
          categoria: string
          created_at: string | null
          deducible: boolean | null
          descripcion: string | null
          empresa_id: string | null
          fecha: string
          id: string
          monto: number
          proyecto_id: string | null
          soporte_url: string | null
          workspace_id: string
        }
        Insert: {
          canal_registro?: string | null
          categoria: string
          created_at?: string | null
          deducible?: boolean | null
          descripcion?: string | null
          empresa_id?: string | null
          fecha?: string
          id?: string
          monto: number
          proyecto_id?: string | null
          soporte_url?: string | null
          workspace_id: string
        }
        Update: {
          canal_registro?: string | null
          categoria?: string
          created_at?: string | null
          deducible?: boolean | null
          descripcion?: string | null
          empresa_id?: string | null
          fecha?: string
          id?: string
          monto?: number
          proyecto_id?: string | null
          soporte_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gastos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      health_scores: {
        Row: {
          actions_per_week: number | null
          calculated_at: string | null
          days_inactive: number | null
          id: string
          questions_complete: number | null
          score: number | null
          summary_open_rate: number | null
          wa_collaborators_active: number | null
          workspace_id: string
        }
        Insert: {
          actions_per_week?: number | null
          calculated_at?: string | null
          days_inactive?: number | null
          id?: string
          questions_complete?: number | null
          score?: number | null
          summary_open_rate?: number | null
          wa_collaborators_active?: number | null
          workspace_id: string
        }
        Update: {
          actions_per_week?: number | null
          calculated_at?: string | null
          days_inactive?: number | null
          id?: string
          questions_complete?: number | null
          score?: number | null
          summary_open_rate?: number | null
          wa_collaborators_active?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_scores_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      horas: {
        Row: {
          canal_registro: string | null
          created_at: string | null
          descripcion: string | null
          fecha: string
          horas: number
          id: string
          proyecto_id: string
          workspace_id: string
        }
        Insert: {
          canal_registro?: string | null
          created_at?: string | null
          descripcion?: string | null
          fecha?: string
          horas: number
          id?: string
          proyecto_id: string
          workspace_id: string
        }
        Update: {
          canal_registro?: string | null
          created_at?: string | null
          descripcion?: string | null
          fecha?: string
          horas?: number
          id?: string
          proyecto_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "horas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "horas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_id: string | null
          concept: string
          created_at: string | null
          due_date: string | null
          gross_amount: number
          id: string
          invoice_number: string | null
          invoice_type: string | null
          notes: string | null
          project_id: string
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          client_id?: string | null
          concept: string
          created_at?: string | null
          due_date?: string | null
          gross_amount: number
          id?: string
          invoice_number?: string | null
          invoice_type?: string | null
          notes?: string | null
          project_id: string
          status?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          concept?: string
          created_at?: string | null
          due_date?: string | null
          gross_amount?: number
          id?: string
          invoice_number?: string | null
          invoice_type?: string | null
          notes?: string | null
          project_id?: string
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          cotizacion_id: string
          created_at: string | null
          id: string
          nombre: string
          orden: number
          servicio_origen_id: string | null
          subtotal: number | null
        }
        Insert: {
          cotizacion_id: string
          created_at?: string | null
          id?: string
          nombre: string
          orden?: number
          servicio_origen_id?: string | null
          subtotal?: number | null
        }
        Update: {
          cotizacion_id?: string
          created_at?: string | null
          id?: string
          nombre?: string
          orden?: number
          servicio_origen_id?: string | null
          subtotal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_targets: {
        Row: {
          collection_target: number | null
          created_at: string | null
          id: string
          month: number
          sales_target: number | null
          updated_at: string | null
          workspace_id: string
          year: number
        }
        Insert: {
          collection_target?: number | null
          created_at?: string | null
          id?: string
          month: number
          sales_target?: number | null
          updated_at?: string | null
          workspace_id: string
          year: number
        }
        Update: {
          collection_target?: number | null
          created_at?: string | null
          id?: string
          month?: number
          sales_target?: number | null
          updated_at?: string | null
          workspace_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string | null
          created_by: string | null
          entity_id: string
          entity_type: string
          id: string
          note_type: string | null
          workspace_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          note_type?: string | null
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          note_type?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string | null
          title: string
          type: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          title: string
          type: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      oportunidades: {
        Row: {
          contacto_id: string
          created_at: string | null
          descripcion: string
          empresa_id: string
          etapa: string
          fecha_cierre_estimada: string | null
          id: string
          probabilidad: number
          razon_perdida: string | null
          ultima_accion: string | null
          ultima_accion_fecha: string | null
          updated_at: string | null
          valor_estimado: number | null
          workspace_id: string
        }
        Insert: {
          contacto_id: string
          created_at?: string | null
          descripcion: string
          empresa_id: string
          etapa?: string
          fecha_cierre_estimada?: string | null
          id?: string
          probabilidad?: number
          razon_perdida?: string | null
          ultima_accion?: string | null
          ultima_accion_fecha?: string | null
          updated_at?: string | null
          valor_estimado?: number | null
          workspace_id: string
        }
        Update: {
          contacto_id?: string
          created_at?: string | null
          descripcion?: string
          empresa_id?: string
          etapa?: string
          fecha_cierre_estimada?: string | null
          id?: string
          probabilidad?: number
          razon_perdida?: string | null
          ultima_accion?: string | null
          ultima_accion_fecha?: string | null
          updated_at?: string | null
          valor_estimado?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oportunidades_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oportunidades_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oportunidades_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          client_id: string | null
          contact_id: string | null
          created_at: string | null
          estimated_value: number
          id: string
          lost_reason: string | null
          name: string
          notes: string | null
          probability: number
          source: string | null
          stage: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          client_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          estimated_value?: number
          id?: string
          lost_reason?: string | null
          name: string
          notes?: string | null
          probability?: number
          source?: string | null
          stage?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          estimated_value?: number
          id?: string
          lost_reason?: string | null
          name?: string
          notes?: string | null
          probability?: number
          source?: string | null
          stage?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_stage_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          from_stage: string | null
          id: string
          opportunity_id: string
          to_stage: string
          workspace_id: string
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          from_stage?: string | null
          id?: string
          opportunity_id: string
          to_stage: string
          workspace_id: string
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          from_stage?: string | null
          id?: string
          opportunity_id?: string
          to_stage?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_stage_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stage_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          created_at: string | null
          id: string
          invoice_id: string
          net_received: number
          payment_date: string
          payment_method: string
          reference: string | null
          retention_applied: number
          source: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_id: string
          net_received: number
          payment_date?: string
          payment_method?: string
          reference?: string | null
          retention_applied?: number
          source?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_id?: string
          net_received?: number
          payment_date?: string
          payment_method?: string
          reference?: string | null
          retention_applied?: number
          source?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
          role: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_cost: number | null
          actual_margin_pct: number | null
          approved_budget: number | null
          client_id: string | null
          closed_at: string | null
          created_at: string | null
          estimated_end_date: string | null
          id: string
          lessons_learned: string | null
          name: string
          notes: string | null
          opportunity_id: string | null
          progress_pct: number | null
          quote_id: string | null
          rework_cost: number | null
          rework_reason: string | null
          start_date: string | null
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          actual_cost?: number | null
          actual_margin_pct?: number | null
          approved_budget?: number | null
          client_id?: string | null
          closed_at?: string | null
          created_at?: string | null
          estimated_end_date?: string | null
          id?: string
          lessons_learned?: string | null
          name: string
          notes?: string | null
          opportunity_id?: string | null
          progress_pct?: number | null
          quote_id?: string | null
          rework_cost?: number | null
          rework_reason?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          actual_cost?: number | null
          actual_margin_pct?: number | null
          approved_budget?: number | null
          client_id?: string | null
          closed_at?: string | null
          created_at?: string | null
          estimated_end_date?: string | null
          id?: string
          lessons_learned?: string | null
          name?: string
          notes?: string | null
          opportunity_id?: string | null
          progress_pct?: number | null
          quote_id?: string | null
          rework_cost?: number | null
          rework_reason?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      promoters: {
        Row: {
          accumulated_commission: number | null
          bank_account: string | null
          bank_name: string | null
          commission_pct: number | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          referrals_count: number | null
          status: string
          updated_at: string | null
          won_projects: number | null
          workspace_id: string
        }
        Insert: {
          accumulated_commission?: number | null
          bank_account?: string | null
          bank_name?: string | null
          commission_pct?: number | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          referrals_count?: number | null
          status?: string
          updated_at?: string | null
          won_projects?: number | null
          workspace_id: string
        }
        Update: {
          accumulated_commission?: number | null
          bank_account?: string | null
          bank_name?: string | null
          commission_pct?: number | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          referrals_count?: number | null
          status?: string
          updated_at?: string | null
          won_projects?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proyectos: {
        Row: {
          avance_porcentaje: number | null
          contacto_id: string | null
          cotizacion_id: string | null
          created_at: string | null
          empresa_id: string | null
          estado: string
          fecha_cierre: string | null
          fecha_fin_estimada: string | null
          fecha_inicio: string | null
          id: string
          nombre: string
          notas_cierre: string | null
          oportunidad_id: string | null
          presupuesto_total: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          avance_porcentaje?: number | null
          contacto_id?: string | null
          cotizacion_id?: string | null
          created_at?: string | null
          empresa_id?: string | null
          estado?: string
          fecha_cierre?: string | null
          fecha_fin_estimada?: string | null
          fecha_inicio?: string | null
          id?: string
          nombre: string
          notas_cierre?: string | null
          oportunidad_id?: string | null
          presupuesto_total?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          avance_porcentaje?: number | null
          contacto_id?: string | null
          cotizacion_id?: string | null
          created_at?: string | null
          empresa_id?: string | null
          estado?: string
          fecha_cierre?: string | null
          fecha_fin_estimada?: string | null
          fecha_inicio?: string | null
          id?: string
          nombre?: string
          notas_cierre?: string | null
          oportunidad_id?: string | null
          presupuesto_total?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proyectos_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyectos_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyectos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyectos_oportunidad_id_fkey"
            columns: ["oportunidad_id"]
            isOneToOne: false
            referencedRelation: "oportunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyectos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          description: string
          id: string
          item_type: string
          quantity: number
          quote_id: string
          sort_order: number | null
          total: number | null
          unit_price: number
        }
        Insert: {
          description: string
          id?: string
          item_type: string
          quantity?: number
          quote_id: string
          sort_order?: number | null
          total?: number | null
          unit_price?: number
        }
        Update: {
          description?: string
          id?: string
          item_type?: string
          quantity?: number
          quote_id?: string
          sort_order?: number | null
          total?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          client_id: string | null
          created_at: string | null
          description: string | null
          estimated_cost: number | null
          id: string
          iva_amount: number | null
          margin_pct: number | null
          mode: string
          net_amount: number | null
          notes: string | null
          opportunity_id: string | null
          profit_amount: number | null
          project_id: string | null
          rejected_reason: string | null
          retention_amount: number | null
          sent_at: string | null
          status: string
          total_price: number
          updated_at: string | null
          valid_days: number | null
          valid_until: string | null
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          estimated_cost?: number | null
          id?: string
          iva_amount?: number | null
          margin_pct?: number | null
          mode?: string
          net_amount?: number | null
          notes?: string | null
          opportunity_id?: string | null
          profit_amount?: number | null
          project_id?: string | null
          rejected_reason?: string | null
          retention_amount?: number | null
          sent_at?: string | null
          status?: string
          total_price?: number
          updated_at?: string | null
          valid_days?: number | null
          valid_until?: string | null
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          estimated_cost?: number | null
          id?: string
          iva_amount?: number | null
          margin_pct?: number | null
          mode?: string
          net_amount?: number | null
          notes?: string | null
          opportunity_id?: string | null
          profit_amount?: number | null
          project_id?: string | null
          rejected_reason?: string | null
          retention_amount?: number | null
          sent_at?: string | null
          status?: string
          total_price?: number
          updated_at?: string | null
          valid_days?: number | null
          valid_until?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string | null
          id: string
          months_rewarded: number | null
          referral_code: string
          referrer_workspace_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          months_rewarded?: number | null
          referral_code: string
          referrer_workspace_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          months_rewarded?: number | null
          referral_code?: string
          referrer_workspace_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referrer_workspace_id_fkey"
            columns: ["referrer_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      rubros: {
        Row: {
          cantidad: number
          descripcion: string | null
          id: string
          item_id: string
          orden: number
          tipo: string
          unidad: string
          valor_total: number | null
          valor_unitario: number
        }
        Insert: {
          cantidad?: number
          descripcion?: string | null
          id?: string
          item_id: string
          orden?: number
          tipo: string
          unidad?: string
          valor_total?: number | null
          valor_unitario?: number
        }
        Update: {
          cantidad?: number
          descripcion?: string | null
          id?: string
          item_id?: string
          orden?: number
          tipo?: string
          unidad?: string
          valor_total?: number | null
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "rubros_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      servicios: {
        Row: {
          activo: boolean | null
          created_at: string | null
          id: string
          nombre: string
          precio_estandar: number | null
          rubros_template: Json | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          id?: string
          nombre: string
          precio_estandar?: number | null
          rubros_template?: Json | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          id?: string
          nombre?: string
          precio_estandar?: number | null
          rubros_template?: Json | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "servicios_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          contract_type: string | null
          created_at: string | null
          department: string | null
          full_name: string
          id: string
          is_active: boolean | null
          phone_whatsapp: string | null
          position: string | null
          salary: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          contract_type?: string | null
          created_at?: string | null
          department?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          phone_whatsapp?: string | null
          position?: string | null
          salary?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          contract_type?: string | null
          created_at?: string | null
          department?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          phone_whatsapp?: string | null
          position?: string | null
          salary?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string | null
          currency: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          payment_method: string | null
          payment_provider: string | null
          plan: string
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          payment_method?: string | null
          payment_provider?: string | null
          plan: string
          status?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          payment_method?: string | null
          payment_provider?: string | null
          plan?: string
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          invited_by: string
          role: string
          status: string
          token: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invited_by: string
          role?: string
          status?: string
          token?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string
          role?: string
          status?: string
          token?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      testimonials: {
        Row: {
          answer_1: string | null
          answer_2: string | null
          answer_3: string | null
          created_at: string | null
          id: string
          marketing_consent: boolean | null
          status: string | null
          workspace_id: string
        }
        Insert: {
          answer_1?: string | null
          answer_2?: string | null
          answer_3?: string | null
          created_at?: string | null
          id?: string
          marketing_consent?: boolean | null
          status?: string | null
          workspace_id: string
        }
        Update: {
          answer_1?: string | null
          answer_2?: string | null
          answer_3?: string | null
          created_at?: string | null
          id?: string
          marketing_consent?: boolean | null
          status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "testimonials_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          activity: string | null
          category: string | null
          created_at: string | null
          end_time: string | null
          entry_date: string
          hours: number
          id: string
          project_id: string
          source: string | null
          start_time: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          activity?: string | null
          category?: string | null
          created_at?: string | null
          end_time?: string | null
          entry_date?: string
          hours: number
          id?: string
          project_id: string
          source?: string | null
          start_time?: string | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          activity?: string | null
          category?: string | null
          created_at?: string | null
          end_time?: string | null
          entry_date?: string
          hours?: number
          id?: string
          project_id?: string
          source?: string | null
          start_time?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_collaborators: {
        Row: {
          consent_accepted_at: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          phone: string
          requires_approval: boolean | null
          workspace_id: string
        }
        Insert: {
          consent_accepted_at?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          phone: string
          requires_approval?: boolean | null
          workspace_id: string
        }
        Update: {
          consent_accepted_at?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          phone?: string
          requires_approval?: boolean | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_collaborators_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string | null
          id: string
          name: string
          onboarding_completed: boolean | null
          profession: string | null
          slug: string
          subscription_expires_at: string | null
          subscription_started_at: string | null
          subscription_status: string
          trial_ends_at: string | null
          updated_at: string | null
          years_independent: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          onboarding_completed?: boolean | null
          profession?: string | null
          slug: string
          subscription_expires_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          years_independent?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          onboarding_completed?: boolean | null
          profession?: string | null
          slug?: string
          subscription_expires_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          years_independent?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_perfil_fiscal_completo: {
        Args: { p_empresa_id: string }
        Returns: boolean
      }
      current_user_workspace_id: { Args: never; Returns: string }
      get_next_cotizacion_consecutivo: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ── Type aliases ────────────────────────────────────────────
type TableRow<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']

// Legacy tables (kept for config compatibility)
export type Profile = TableRow<'profiles'>
export type Workspace = TableRow<'workspaces'>
export type BankAccount = TableRow<'bank_accounts'>
export type ExpenseCategory = TableRow<'expense_categories'>
export type FiscalProfile = TableRow<'fiscal_profiles'>
export type Staff = TableRow<'staff'>
export type MonthlyTarget = TableRow<'monthly_targets'>

// CRM v2 tables (new model from spec)
export type Contacto = TableRow<'contactos'>
export type Empresa = TableRow<'empresas'>
export type Oportunidad = TableRow<'oportunidades'>
export type Cotizacion = TableRow<'cotizaciones'>
export type Item = TableRow<'items'>
export type Rubro = TableRow<'rubros'>
export type Servicio = TableRow<'servicios'>
export type ProyectoV2 = TableRow<'proyectos'>
export type GastoV2 = TableRow<'gastos'>
export type Hora = TableRow<'horas'>

// Legacy v1 tables (still referenced by config modules)
export type Contact = TableRow<'contacts'>
export type Client = TableRow<'clients'>
export type Opportunity = TableRow<'opportunities'>
export type Project = TableRow<'projects'>
export type Quote = TableRow<'quotes'>
export type Invoice = TableRow<'invoices'>
export type Expense = TableRow<'expenses'>
export type FixedExpense = TableRow<'fixed_expenses'>
export type Note = TableRow<'notes'>
export type TimeEntry = TableRow<'time_entries'>
export type Promoter = TableRow<'promoters'>
export type Payment = TableRow<'payments'>
