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
      activity_log: {
        Row: {
          autor_id: string | null
          campo_modificado: string | null
          contenido: string | null
          created_at: string | null
          entidad_id: string
          entidad_tipo: string
          id: string
          link_url: string | null
          mencion_id: string | null
          tipo: string
          valor_anterior: string | null
          valor_nuevo: string | null
          workspace_id: string
        }
        Insert: {
          autor_id?: string | null
          campo_modificado?: string | null
          contenido?: string | null
          created_at?: string | null
          entidad_id: string
          entidad_tipo: string
          id?: string
          link_url?: string | null
          mencion_id?: string | null
          tipo: string
          valor_anterior?: string | null
          valor_nuevo?: string | null
          workspace_id: string
        }
        Update: {
          autor_id?: string | null
          campo_modificado?: string | null
          contenido?: string | null
          created_at?: string | null
          entidad_id?: string
          entidad_tipo?: string
          id?: string
          link_url?: string | null
          mencion_id?: string | null
          tipo?: string
          valor_anterior?: string | null
          valor_nuevo?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_mencion_id_fkey"
            columns: ["mencion_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_proceso_etapas: {
        Row: {
          bloques: Json
          created_at: string | null
          descripcion: string | null
          fase: string
          gates_entrada: Json
          id: string
          inputs: Json
          linea: string
          nombre: string
          notas: string | null
          orden: number
          outputs: Json
          paralelo_con: string[] | null
          skill_estado: string
          skill_name: string | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          bloques?: Json
          created_at?: string | null
          descripcion?: string | null
          fase: string
          gates_entrada?: Json
          id?: string
          inputs?: Json
          linea?: string
          nombre: string
          notas?: string | null
          orden: number
          outputs?: Json
          paralelo_con?: string[] | null
          skill_estado?: string
          skill_name?: string | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          bloques?: Json
          created_at?: string | null
          descripcion?: string | null
          fase?: string
          gates_entrada?: Json
          id?: string
          inputs?: Json
          linea?: string
          nombre?: string
          notas?: string | null
          orden?: number
          outputs?: Json
          paralelo_con?: string[] | null
          skill_estado?: string
          skill_name?: string | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      admin_skills: {
        Row: {
          allowed_tools: string[] | null
          argument_hint: string | null
          contenido: string | null
          created_at: string | null
          descripcion: string | null
          disable_model_invocation: boolean | null
          effort: string | null
          id: string
          nombre: string
          skill_id: string | null
          tipo: number | null
          ultima_sync: string | null
          updated_at: string | null
          user_invocable: boolean | null
        }
        Insert: {
          allowed_tools?: string[] | null
          argument_hint?: string | null
          contenido?: string | null
          created_at?: string | null
          descripcion?: string | null
          disable_model_invocation?: boolean | null
          effort?: string | null
          id?: string
          nombre: string
          skill_id?: string | null
          tipo?: number | null
          ultima_sync?: string | null
          updated_at?: string | null
          user_invocable?: boolean | null
        }
        Update: {
          allowed_tools?: string[] | null
          argument_hint?: string | null
          contenido?: string | null
          created_at?: string | null
          descripcion?: string | null
          disable_model_invocation?: boolean | null
          effort?: string | null
          id?: string
          nombre?: string
          skill_id?: string | null
          tipo?: number | null
          ultima_sync?: string | null
          updated_at?: string | null
          user_invocable?: boolean | null
        }
        Relationships: []
      }
      admin_workflows: {
        Row: {
          autor_proceso: string | null
          autor_tecnico: string | null
          basado_en: string | null
          cliente_nombre: string | null
          cliente_slug: string
          created_at: string | null
          estado: string | null
          fase_cubierta: string[] | null
          fase_detallada: string | null
          fecha_actualizacion: string | null
          html_storage_path: string
          id: string
          linea_negocio: string
          linea_negocio_cliente: string | null
          metadata: Json | null
          nombre_flujo: string
          numero_flujo: number | null
          owner_calidad: string | null
          pdf_storage_path: string | null
          proyecto_slug: string
          tags: string[] | null
          tiene_condicionales: boolean | null
          tipo_proceso: string | null
          total_bloques: number | null
          total_etapas: number | null
          total_fases: number | null
          updated_at: string | null
          version: number
        }
        Insert: {
          autor_proceso?: string | null
          autor_tecnico?: string | null
          basado_en?: string | null
          cliente_nombre?: string | null
          cliente_slug: string
          created_at?: string | null
          estado?: string | null
          fase_cubierta?: string[] | null
          fase_detallada?: string | null
          fecha_actualizacion?: string | null
          html_storage_path: string
          id?: string
          linea_negocio: string
          linea_negocio_cliente?: string | null
          metadata?: Json | null
          nombre_flujo: string
          numero_flujo?: number | null
          owner_calidad?: string | null
          pdf_storage_path?: string | null
          proyecto_slug: string
          tags?: string[] | null
          tiene_condicionales?: boolean | null
          tipo_proceso?: string | null
          total_bloques?: number | null
          total_etapas?: number | null
          total_fases?: number | null
          updated_at?: string | null
          version?: number
        }
        Update: {
          autor_proceso?: string | null
          autor_tecnico?: string | null
          basado_en?: string | null
          cliente_nombre?: string | null
          cliente_slug?: string
          created_at?: string | null
          estado?: string | null
          fase_cubierta?: string[] | null
          fase_detallada?: string | null
          fecha_actualizacion?: string | null
          html_storage_path?: string
          id?: string
          linea_negocio?: string
          linea_negocio_cliente?: string | null
          metadata?: Json | null
          nombre_flujo?: string
          numero_flujo?: number | null
          owner_calidad?: string | null
          pdf_storage_path?: string | null
          proyecto_slug?: string
          tags?: string[] | null
          tiene_condicionales?: boolean | null
          tipo_proceso?: string | null
          total_bloques?: number | null
          total_etapas?: number | null
          total_fases?: number | null
          updated_at?: string | null
          version?: number
        }
        Relationships: []
      }
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
      bloque_configs: {
        Row: {
          bloque_definition_id: string
          config_extra: Json
          created_at: string
          descripcion: string | null
          es_gate: boolean
          estado: string
          etapa_id: string
          id: string
          nombre: string | null
          orden: number
          workspace_id: string
        }
        Insert: {
          bloque_definition_id: string
          config_extra?: Json
          created_at?: string
          descripcion?: string | null
          es_gate?: boolean
          estado?: string
          etapa_id: string
          id?: string
          nombre?: string | null
          orden?: number
          workspace_id: string
        }
        Update: {
          bloque_definition_id?: string
          config_extra?: Json
          created_at?: string
          descripcion?: string | null
          es_gate?: boolean
          estado?: string
          etapa_id?: string
          id?: string
          nombre?: string | null
          orden?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloque_configs_bloque_definition_id_fkey"
            columns: ["bloque_definition_id"]
            isOneToOne: false
            referencedRelation: "bloque_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloque_configs_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloque_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bloque_definitions: {
        Row: {
          can_be_gate: boolean
          codigo: string | null
          created_at: string
          default_estado: string
          descripcion: string | null
          icon_name: string | null
          id: string
          is_visualization: boolean
          nombre: string
          supports_array_items: boolean
          tipo: string
        }
        Insert: {
          can_be_gate?: boolean
          codigo?: string | null
          created_at?: string
          default_estado?: string
          descripcion?: string | null
          icon_name?: string | null
          id?: string
          is_visualization?: boolean
          nombre: string
          supports_array_items?: boolean
          tipo: string
        }
        Update: {
          can_be_gate?: boolean
          codigo?: string | null
          created_at?: string
          default_estado?: string
          descripcion?: string | null
          icon_name?: string | null
          id?: string
          is_visualization?: boolean
          nombre?: string
          supports_array_items?: boolean
          tipo?: string
        }
        Relationships: []
      }
      bloque_items: {
        Row: {
          completado: boolean
          completado_at: string | null
          completado_por: string | null
          contenido: Json
          created_at: string
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          imagen_data: string | null
          label: string
          link_url: string | null
          negocio_bloque_id: string
          orden: number
          responsable_id: string | null
          tipo: string
        }
        Insert: {
          completado?: boolean
          completado_at?: string | null
          completado_por?: string | null
          contenido?: Json
          created_at?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          imagen_data?: string | null
          label: string
          link_url?: string | null
          negocio_bloque_id: string
          orden?: number
          responsable_id?: string | null
          tipo?: string
        }
        Update: {
          completado?: boolean
          completado_at?: string | null
          completado_por?: string | null
          contenido?: Json
          created_at?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          imagen_data?: string | null
          label?: string
          link_url?: string | null
          negocio_bloque_id?: string
          orden?: number
          responsable_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloque_items_completado_por_fkey"
            columns: ["completado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloque_items_negocio_bloque_id_fkey"
            columns: ["negocio_bloque_id"]
            isOneToOne: false
            referencedRelation: "negocio_bloques"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloque_items_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "staff"
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
      categoria_clasificacion_default: {
        Row: {
          categoria: string
          clasificacion_default: string
          updated_at: string | null
        }
        Insert: {
          categoria: string
          clasificacion_default: string
          updated_at?: string | null
        }
        Update: {
          categoria?: string
          clasificacion_default?: string
          updated_at?: string | null
        }
        Relationships: []
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
      cobros: {
        Row: {
          canal_registro: string | null
          created_at: string | null
          created_by: string | null
          created_by_wa_name: string | null
          external_ref: string | null
          factura_id: string | null
          fecha: string
          id: string
          mensaje_original: string | null
          monto: number
          negocio_id: string | null
          notas: string | null
          proyecto_id: string | null
          retencion: number | null
          revisado: boolean
          revisado_at: string | null
          revisado_por: string | null
          tercero_nit: string | null
          tipo_cobro: string | null
          workspace_id: string
        }
        Insert: {
          canal_registro?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          external_ref?: string | null
          factura_id?: string | null
          fecha?: string
          id?: string
          mensaje_original?: string | null
          monto: number
          negocio_id?: string | null
          notas?: string | null
          proyecto_id?: string | null
          retencion?: number | null
          revisado?: boolean
          revisado_at?: string | null
          revisado_por?: string | null
          tercero_nit?: string | null
          tipo_cobro?: string | null
          workspace_id: string
        }
        Update: {
          canal_registro?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          external_ref?: string | null
          factura_id?: string | null
          fecha?: string
          id?: string
          mensaje_original?: string | null
          monto?: number
          negocio_id?: string | null
          notas?: string | null
          proyecto_id?: string | null
          retencion?: number | null
          revisado?: boolean
          revisado_at?: string | null
          revisado_por?: string | null
          tercero_nit?: string | null
          tipo_cobro?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobros_created_by_profiles_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobros_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobros_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "v_facturas_estado"
            referencedColumns: ["factura_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobros_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
          },
          {
            foreignKeyName: "cobros_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      config_financiera: {
        Row: {
          created_at: string | null
          id: string
          margen_contribucion_calculado: number | null
          margen_contribucion_estimado: number | null
          margen_fuente: string | null
          n_proyectos_margen: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          margen_contribucion_calculado?: number | null
          margen_contribucion_estimado?: number | null
          margen_fuente?: string | null
          n_proyectos_margen?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          margen_contribucion_calculado?: number | null
          margen_contribucion_estimado?: number | null
          margen_fuente?: string | null
          n_proyectos_margen?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_financiera_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      config_metas: {
        Row: {
          created_at: string | null
          id: string
          mes: string
          meta_recaudo_mensual: number | null
          meta_ventas_mensual: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          mes: string
          meta_recaudo_mensual?: number | null
          meta_ventas_mensual?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          mes?: string
          meta_recaudo_mensual?: number | null
          meta_ventas_mensual?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_metas_workspace_id_fkey"
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
          custom_data: Json | null
          email: string | null
          fuente_adquisicion: string | null
          fuente_detalle: string | null
          fuente_promotor_id: string | null
          fuente_referido_nombre: string | null
          id: string
          nombre: string
          rol: string | null
          segmento: string | null
          telefono: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          comision_porcentaje?: number | null
          created_at?: string | null
          custom_data?: Json | null
          email?: string | null
          fuente_adquisicion?: string | null
          fuente_detalle?: string | null
          fuente_promotor_id?: string | null
          fuente_referido_nombre?: string | null
          id?: string
          nombre: string
          rol?: string | null
          segmento?: string | null
          telefono?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          comision_porcentaje?: number | null
          created_at?: string | null
          custom_data?: Json | null
          email?: string | null
          fuente_adquisicion?: string | null
          fuente_detalle?: string | null
          fuente_promotor_id?: string | null
          fuente_referido_nombre?: string | null
          id?: string
          nombre?: string
          rol?: string | null
          segmento?: string | null
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
            foreignKeyName: "contactos_fuente_promotor_id_fkey"
            columns: ["fuente_promotor_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
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
      control_causa: {
        Row: {
          causa_id: string
          control_id: string
          created_at: string | null
          id: string
        }
        Insert: {
          causa_id: string
          control_id: string
          created_at?: string | null
          id?: string
        }
        Update: {
          causa_id?: string
          control_id?: string
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "control_causa_causa_id_fkey"
            columns: ["causa_id"]
            isOneToOne: false
            referencedRelation: "riesgo_causas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_causa_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "riesgos_controles"
            referencedColumns: ["id"]
          },
        ]
      }
      costos_referencia: {
        Row: {
          costo_promedio: number | null
          horas_promedio: number | null
          id: string
          margen_promedio: number | null
          proyectos_base: number | null
          tipo_servicio: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          costo_promedio?: number | null
          horas_promedio?: number | null
          id?: string
          margen_promedio?: number | null
          proyectos_base?: number | null
          tipo_servicio?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          costo_promedio?: number | null
          horas_promedio?: number | null
          id?: string
          margen_promedio?: number | null
          proyectos_base?: number | null
          tipo_servicio?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "costos_referencia_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          aiu_admin_pct: number | null
          aiu_imprevistos_pct: number | null
          codigo: string
          condiciones_pago: string | null
          consecutivo: string
          costo_total: number | null
          created_at: string | null
          descripcion: string | null
          descuento_porcentaje: number
          descuento_valor: number
          duplicada_de: string | null
          email_enviado_a: string | null
          estado: string
          fecha_envio: string | null
          fecha_validez: string | null
          id: string
          margen_porcentaje: number | null
          modo: string
          negocio_id: string | null
          notas: string | null
          oportunidad_id: string | null
          updated_at: string | null
          valor_total: number
          workspace_id: string
        }
        Insert: {
          aiu_admin_pct?: number | null
          aiu_imprevistos_pct?: number | null
          codigo: string
          condiciones_pago?: string | null
          consecutivo: string
          costo_total?: number | null
          created_at?: string | null
          descripcion?: string | null
          descuento_porcentaje?: number
          descuento_valor?: number
          duplicada_de?: string | null
          email_enviado_a?: string | null
          estado?: string
          fecha_envio?: string | null
          fecha_validez?: string | null
          id?: string
          margen_porcentaje?: number | null
          modo: string
          negocio_id?: string | null
          notas?: string | null
          oportunidad_id?: string | null
          updated_at?: string | null
          valor_total?: number
          workspace_id: string
        }
        Update: {
          aiu_admin_pct?: number | null
          aiu_imprevistos_pct?: number | null
          codigo?: string
          condiciones_pago?: string | null
          consecutivo?: string
          costo_total?: number | null
          created_at?: string | null
          descripcion?: string | null
          descuento_porcentaje?: number
          descuento_valor?: number
          duplicada_de?: string | null
          email_enviado_a?: string | null
          estado?: string
          fecha_envio?: string | null
          fecha_validez?: string | null
          id?: string
          margen_porcentaje?: number | null
          modo?: string
          negocio_id?: string | null
          notas?: string | null
          oportunidad_id?: string | null
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
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
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
      custom_field_mappings: {
        Row: {
          activo: boolean | null
          destino_entidad: string
          destino_slug: string
          id: string
          origen_entidad: string
          origen_slug: string
          workspace_id: string
        }
        Insert: {
          activo?: boolean | null
          destino_entidad: string
          destino_slug: string
          id?: string
          origen_entidad: string
          origen_slug: string
          workspace_id: string
        }
        Update: {
          activo?: boolean | null
          destino_entidad?: string
          destino_slug?: string
          id?: string
          origen_entidad?: string
          origen_slug?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_mappings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          activo: boolean | null
          condicion_visibilidad: Json | null
          created_at: string | null
          entidad: string
          id: string
          nombre: string
          obligatorio: boolean | null
          opciones: Json | null
          orden: number | null
          slug: string
          tipo: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          activo?: boolean | null
          condicion_visibilidad?: Json | null
          created_at?: string | null
          entidad: string
          id?: string
          nombre: string
          obligatorio?: boolean | null
          opciones?: Json | null
          orden?: number | null
          slug: string
          tipo: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          activo?: boolean | null
          condicion_visibilidad?: Json | null
          created_at?: string | null
          entidad?: string
          id?: string
          nombre?: string
          obligatorio?: boolean | null
          opciones?: Json | null
          orden?: number | null
          slug?: string
          tipo?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          actividad_ciiu: string | null
          actividad_secundaria: string | null
          agente_retenedor: boolean | null
          autorretenedor: boolean | null
          codigo: string
          contacto_email: string | null
          contacto_id: string | null
          contacto_nombre: string | null
          created_at: string | null
          custom_data: Json | null
          departamento: string | null
          direccion_fiscal: string | null
          email_fiscal: string | null
          estado_fiscal: string
          fecha_inicio_actividades: string | null
          gran_contribuyente: boolean | null
          id: string
          municipio: string | null
          nombre: string
          numero_documento: string | null
          razon_social: string | null
          regimen_tributario: string | null
          responsable_iva: boolean | null
          rut_confianza_ocr: number | null
          rut_documento_url: string | null
          rut_fecha_carga: string | null
          rut_verificado: boolean | null
          sector: string | null
          telefono: string | null
          tipo_documento: string | null
          tipo_persona: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          actividad_ciiu?: string | null
          actividad_secundaria?: string | null
          agente_retenedor?: boolean | null
          autorretenedor?: boolean | null
          codigo: string
          contacto_email?: string | null
          contacto_id?: string | null
          contacto_nombre?: string | null
          created_at?: string | null
          custom_data?: Json | null
          departamento?: string | null
          direccion_fiscal?: string | null
          email_fiscal?: string | null
          estado_fiscal?: string
          fecha_inicio_actividades?: string | null
          gran_contribuyente?: boolean | null
          id?: string
          municipio?: string | null
          nombre: string
          numero_documento?: string | null
          razon_social?: string | null
          regimen_tributario?: string | null
          responsable_iva?: boolean | null
          rut_confianza_ocr?: number | null
          rut_documento_url?: string | null
          rut_fecha_carga?: string | null
          rut_verificado?: boolean | null
          sector?: string | null
          telefono?: string | null
          tipo_documento?: string | null
          tipo_persona?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          actividad_ciiu?: string | null
          actividad_secundaria?: string | null
          agente_retenedor?: boolean | null
          autorretenedor?: boolean | null
          codigo?: string
          contacto_email?: string | null
          contacto_id?: string | null
          contacto_nombre?: string | null
          created_at?: string | null
          custom_data?: Json | null
          departamento?: string | null
          direccion_fiscal?: string | null
          email_fiscal?: string | null
          estado_fiscal?: string
          fecha_inicio_actividades?: string | null
          gran_contribuyente?: boolean | null
          id?: string
          municipio?: string | null
          nombre?: string
          numero_documento?: string | null
          razon_social?: string | null
          regimen_tributario?: string | null
          responsable_iva?: boolean | null
          rut_confianza_ocr?: number | null
          rut_documento_url?: string | null
          rut_fecha_carga?: string | null
          rut_verificado?: boolean | null
          sector?: string | null
          telefono?: string | null
          tipo_documento?: string | null
          tipo_persona?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresas_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresas_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
          },
          {
            foreignKeyName: "empresas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_labels: {
        Row: {
          applied_by: string | null
          created_at: string | null
          entidad: string
          entidad_id: string
          id: string
          label_id: string
          workspace_id: string
        }
        Insert: {
          applied_by?: string | null
          created_at?: string | null
          entidad: string
          entidad_id: string
          id?: string
          label_id: string
          workspace_id: string
        }
        Update: {
          applied_by?: string | null
          created_at?: string | null
          entidad?: string
          entidad_id?: string
          id?: string
          label_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      etapa_historial: {
        Row: {
          cambiado_por: string | null
          created_at: string | null
          etapa_anterior: string | null
          etapa_nueva: string
          id: string
          oportunidad_id: string
          workspace_id: string
        }
        Insert: {
          cambiado_por?: string | null
          created_at?: string | null
          etapa_anterior?: string | null
          etapa_nueva: string
          id?: string
          oportunidad_id: string
          workspace_id: string
        }
        Update: {
          cambiado_por?: string | null
          created_at?: string | null
          etapa_anterior?: string | null
          etapa_nueva?: string
          id?: string
          oportunidad_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "etapa_historial_cambiado_por_fkey"
            columns: ["cambiado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etapa_historial_oportunidad_id_fkey"
            columns: ["oportunidad_id"]
            isOneToOne: false
            referencedRelation: "oportunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etapa_historial_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      etapas_negocio: {
        Row: {
          config_extra: Json
          created_at: string
          id: string
          is_active: boolean
          linea_id: string
          nombre: string
          orden: number
          stage: string
        }
        Insert: {
          config_extra?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          linea_id: string
          nombre: string
          orden?: number
          stage: string
        }
        Update: {
          config_extra?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          linea_id?: string
          nombre?: string
          orden?: number
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "etapas_negocio_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
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
      facturas: {
        Row: {
          canal_registro: string | null
          created_at: string | null
          external_ref: string | null
          fecha_emision: string
          id: string
          monto: number
          notas: string | null
          numero_factura: string | null
          proyecto_id: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          canal_registro?: string | null
          created_at?: string | null
          external_ref?: string | null
          fecha_emision?: string
          id?: string
          monto: number
          notas?: string | null
          numero_factura?: string | null
          proyecto_id: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          canal_registro?: string | null
          created_at?: string | null
          external_ref?: string | null
          fecha_emision?: string
          id?: string
          monto?: number
          notas?: string | null
          numero_factura?: string | null
          proyecto_id?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facturas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
          },
          {
            foreignKeyName: "facturas_workspace_id_fkey"
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
          actividad_secundaria: string | null
          agente_retenedor: boolean | null
          ciiu: string | null
          created_at: string | null
          departamento: string | null
          direccion_fiscal: string | null
          email_facturacion: string | null
          email_fiscal: string | null
          fecha_inicio_actividades: string | null
          gran_contribuyente: boolean | null
          ica_city: string | null
          ica_rate: number | null
          id: string
          is_complete: boolean | null
          is_declarante: boolean | null
          is_estimated: boolean | null
          iva_responsible: boolean | null
          municipio: string | null
          nit: string | null
          nudge_count: number | null
          person_type: string | null
          razon_social: string | null
          rut_confianza_ocr: number | null
          rut_documento_url: string | null
          rut_fecha_carga: string | null
          rut_verificado: boolean | null
          self_withholder: boolean | null
          tax_regime: string | null
          telefono: string | null
          tipo_documento: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          actividad_secundaria?: string | null
          agente_retenedor?: boolean | null
          ciiu?: string | null
          created_at?: string | null
          departamento?: string | null
          direccion_fiscal?: string | null
          email_facturacion?: string | null
          email_fiscal?: string | null
          fecha_inicio_actividades?: string | null
          gran_contribuyente?: boolean | null
          ica_city?: string | null
          ica_rate?: number | null
          id?: string
          is_complete?: boolean | null
          is_declarante?: boolean | null
          is_estimated?: boolean | null
          iva_responsible?: boolean | null
          municipio?: string | null
          nit?: string | null
          nudge_count?: number | null
          person_type?: string | null
          razon_social?: string | null
          rut_confianza_ocr?: number | null
          rut_documento_url?: string | null
          rut_fecha_carga?: string | null
          rut_verificado?: boolean | null
          self_withholder?: boolean | null
          tax_regime?: string | null
          telefono?: string | null
          tipo_documento?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          actividad_secundaria?: string | null
          agente_retenedor?: boolean | null
          ciiu?: string | null
          created_at?: string | null
          departamento?: string | null
          direccion_fiscal?: string | null
          email_facturacion?: string | null
          email_fiscal?: string | null
          fecha_inicio_actividades?: string | null
          gran_contribuyente?: boolean | null
          ica_city?: string | null
          ica_rate?: number | null
          id?: string
          is_complete?: boolean | null
          is_declarante?: boolean | null
          is_estimated?: boolean | null
          iva_responsible?: boolean | null
          municipio?: string | null
          nit?: string | null
          nudge_count?: number | null
          person_type?: string | null
          razon_social?: string | null
          rut_confianza_ocr?: number | null
          rut_documento_url?: string | null
          rut_fecha_carga?: string | null
          rut_verificado?: boolean | null
          self_withholder?: boolean | null
          tax_regime?: string | null
          telefono?: string | null
          tipo_documento?: string | null
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
          deducible: boolean | null
          description: string
          dia_pago: number | null
          id: string
          is_active: boolean | null
          monthly_amount: number
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          deducible?: boolean | null
          description: string
          dia_pago?: number | null
          id?: string
          is_active?: boolean | null
          monthly_amount: number
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          deducible?: boolean | null
          description?: string
          dia_pago?: number | null
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
          clasificacion_costo: string
          created_at: string | null
          created_by: string | null
          created_by_wa_name: string | null
          deducible: boolean | null
          descripcion: string | null
          empresa_id: string | null
          estado_pago: string | null
          external_ref: string | null
          fecha: string
          fecha_pago: string | null
          gasto_fijo_ref_id: string | null
          id: string
          mensaje_original: string | null
          monto: number
          negocio_id: string | null
          proyecto_id: string | null
          retencion: number | null
          revisado: boolean
          revisado_at: string | null
          revisado_por: string | null
          rubro_id: string | null
          soporte_pendiente: boolean | null
          soporte_url: string | null
          tercero_nit: string | null
          tipo: string | null
          workspace_id: string
        }
        Insert: {
          canal_registro?: string | null
          categoria: string
          clasificacion_costo?: string
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          deducible?: boolean | null
          descripcion?: string | null
          empresa_id?: string | null
          estado_pago?: string | null
          external_ref?: string | null
          fecha?: string
          fecha_pago?: string | null
          gasto_fijo_ref_id?: string | null
          id?: string
          mensaje_original?: string | null
          monto: number
          negocio_id?: string | null
          proyecto_id?: string | null
          retencion?: number | null
          revisado?: boolean
          revisado_at?: string | null
          revisado_por?: string | null
          rubro_id?: string | null
          soporte_pendiente?: boolean | null
          soporte_url?: string | null
          tercero_nit?: string | null
          tipo?: string | null
          workspace_id: string
        }
        Update: {
          canal_registro?: string | null
          categoria?: string
          clasificacion_costo?: string
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          deducible?: boolean | null
          descripcion?: string | null
          empresa_id?: string | null
          estado_pago?: string | null
          external_ref?: string | null
          fecha?: string
          fecha_pago?: string | null
          gasto_fijo_ref_id?: string | null
          id?: string
          mensaje_original?: string | null
          monto?: number
          negocio_id?: string | null
          proyecto_id?: string | null
          retencion?: number | null
          revisado?: boolean
          revisado_at?: string | null
          revisado_por?: string | null
          rubro_id?: string | null
          soporte_pendiente?: boolean | null
          soporte_url?: string | null
          tercero_nit?: string | null
          tipo?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_gastos_borrador"
            columns: ["gasto_fijo_ref_id"]
            isOneToOne: false
            referencedRelation: "gastos_fijos_borradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_gastos_borrador"
            columns: ["gasto_fijo_ref_id"]
            isOneToOne: false
            referencedRelation: "v_gastos_fijos_mes_actual"
            referencedColumns: ["borrador_id"]
          },
          {
            foreignKeyName: "fk_gastos_rubro"
            columns: ["rubro_id"]
            isOneToOne: false
            referencedRelation: "proyecto_rubros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_gastos_rubro"
            columns: ["rubro_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_rubros_comparativo"
            referencedColumns: ["rubro_id"]
          },
          {
            foreignKeyName: "gastos_created_by_profiles_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
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
      gastos_fijos_borradores: {
        Row: {
          categoria: string
          confirmado: boolean | null
          created_at: string | null
          fecha_confirmacion: string | null
          gasto_fijo_config_id: string
          gasto_id: string | null
          id: string
          monto_esperado: number
          nombre: string
          periodo: string
          workspace_id: string
        }
        Insert: {
          categoria: string
          confirmado?: boolean | null
          created_at?: string | null
          fecha_confirmacion?: string | null
          gasto_fijo_config_id: string
          gasto_id?: string | null
          id?: string
          monto_esperado: number
          nombre: string
          periodo: string
          workspace_id: string
        }
        Update: {
          categoria?: string
          confirmado?: boolean | null
          created_at?: string | null
          fecha_confirmacion?: string | null
          gasto_fijo_config_id?: string
          gasto_id?: string | null
          id?: string
          monto_esperado?: number
          nombre?: string
          periodo?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gastos_fijos_borradores_gasto_fijo_config_id_fkey"
            columns: ["gasto_fijo_config_id"]
            isOneToOne: false
            referencedRelation: "gastos_fijos_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_fijos_borradores_gasto_id_fkey"
            columns: ["gasto_id"]
            isOneToOne: false
            referencedRelation: "gastos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_fijos_borradores_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      gastos_fijos_config: {
        Row: {
          activo: boolean | null
          categoria: string
          created_at: string | null
          id: string
          monto_referencia: number
          nombre: string
          sugerencia_rechazada: boolean | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          activo?: boolean | null
          categoria: string
          created_at?: string | null
          id?: string
          monto_referencia: number
          nombre: string
          sugerencia_rechazada?: boolean | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          activo?: boolean | null
          categoria?: string
          created_at?: string | null
          id?: string
          monto_referencia?: number
          nombre?: string
          sugerencia_rechazada?: boolean | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gastos_fijos_config_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generaciones_log: {
        Row: {
          docs_generados: Json | null
          drive_folder_url: string | null
          duration_ms: number | null
          ejecutada_at: string | null
          error_message: string | null
          id: string
          logo_storage_path: string | null
          negocio_id: string
          oficial_data: Json | null
          productos_contratados: Json | null
          rut_extraction: Json | null
          status: string | null
          version_motor: string | null
          version_templates: string | null
        }
        Insert: {
          docs_generados?: Json | null
          drive_folder_url?: string | null
          duration_ms?: number | null
          ejecutada_at?: string | null
          error_message?: string | null
          id?: string
          logo_storage_path?: string | null
          negocio_id: string
          oficial_data?: Json | null
          productos_contratados?: Json | null
          rut_extraction?: Json | null
          status?: string | null
          version_motor?: string | null
          version_templates?: string | null
        }
        Update: {
          docs_generados?: Json | null
          drive_folder_url?: string | null
          duration_ms?: number | null
          ejecutada_at?: string | null
          error_message?: string | null
          id?: string
          logo_storage_path?: string | null
          negocio_id?: string
          oficial_data?: Json | null
          productos_contratados?: Json | null
          rut_extraction?: Json | null
          status?: string | null
          version_motor?: string | null
          version_templates?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
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
          aprobado_por: string | null
          canal_registro: string | null
          created_at: string | null
          created_by: string | null
          created_by_wa_name: string | null
          descripcion: string | null
          estado_aprobacion: string | null
          fecha: string
          fecha_aprobacion: string | null
          fin: string | null
          horas: number
          id: string
          inicio: string | null
          mensaje_original: string | null
          negocio_id: string | null
          proyecto_id: string | null
          rechazo_motivo: string | null
          staff_id: string | null
          timer_activo: boolean | null
          workspace_id: string
        }
        Insert: {
          aprobado_por?: string | null
          canal_registro?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          descripcion?: string | null
          estado_aprobacion?: string | null
          fecha?: string
          fecha_aprobacion?: string | null
          fin?: string | null
          horas: number
          id?: string
          inicio?: string | null
          mensaje_original?: string | null
          negocio_id?: string | null
          proyecto_id?: string | null
          rechazo_motivo?: string | null
          staff_id?: string | null
          timer_activo?: boolean | null
          workspace_id: string
        }
        Update: {
          aprobado_por?: string | null
          canal_registro?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          descripcion?: string | null
          estado_aprobacion?: string | null
          fecha?: string
          fecha_aprobacion?: string | null
          fin?: string | null
          horas?: number
          id?: string
          inicio?: string | null
          mensaje_original?: string | null
          negocio_id?: string | null
          proyecto_id?: string | null
          rechazo_motivo?: string | null
          staff_id?: string | null
          timer_activo?: boolean | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "horas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "horas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
          },
          {
            foreignKeyName: "horas_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
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
          cantidad: number
          cotizacion_id: string
          created_at: string | null
          descripcion: string | null
          descuento_porcentaje: number | null
          es_ajuste: boolean
          id: string
          nombre: string
          orden: number
          precio_venta: number | null
          servicio_origen_id: string | null
          subtotal: number | null
        }
        Insert: {
          cantidad?: number
          cotizacion_id: string
          created_at?: string | null
          descripcion?: string | null
          descuento_porcentaje?: number | null
          es_ajuste?: boolean
          id?: string
          nombre: string
          orden?: number
          precio_venta?: number | null
          servicio_origen_id?: string | null
          subtotal?: number | null
        }
        Update: {
          cantidad?: number
          cotizacion_id?: string
          created_at?: string | null
          descripcion?: string | null
          descuento_porcentaje?: number | null
          es_ajuste?: boolean
          id?: string
          nombre?: string
          orden?: number
          precio_venta?: number | null
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
      labels: {
        Row: {
          color: string
          created_by: string | null
          entidad: string
          id: string
          nombre: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_by?: string | null
          entidad: string
          id?: string
          nombre: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_by?: string | null
          entidad?: string
          id?: string
          nombre?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lineas_negocio: {
        Row: {
          created_at: string
          descripcion: string | null
          drive_folder_id: string | null
          id: string
          is_active: boolean
          nombre: string
          tipo: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          descripcion?: string | null
          drive_folder_id?: string | null
          id?: string
          is_active?: boolean
          nombre: string
          tipo?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          descripcion?: string | null
          drive_folder_id?: string | null
          id?: string
          is_active?: boolean
          nombre?: string
          tipo?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lineas_negocio_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
      negocio_bloques: {
        Row: {
          bloque_config_id: string
          completado_at: string | null
          completado_por: string | null
          created_at: string
          data: Json
          estado: string
          id: string
          negocio_id: string
          updated_at: string
        }
        Insert: {
          bloque_config_id: string
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string
          data?: Json
          estado?: string
          id?: string
          negocio_id: string
          updated_at?: string
        }
        Update: {
          bloque_config_id?: string
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string
          data?: Json
          estado?: string
          id?: string
          negocio_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "negocio_bloques_bloque_config_id_fkey"
            columns: ["bloque_config_id"]
            isOneToOne: false
            referencedRelation: "bloque_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocio_bloques_completado_por_fkey"
            columns: ["completado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
        ]
      }
      negocios: {
        Row: {
          balance_final: Json | null
          carpeta_url: string | null
          cierre_snapshot: Json | null
          closed_at: string | null
          codigo: string | null
          contacto_id: string | null
          created_at: string
          descripcion_cierre: string | null
          empresa_id: string | null
          estado: string
          etapa_actual_id: string | null
          id: string
          lecciones_aprendidas: string | null
          linea_id: string | null
          motivo_cierre: string | null
          motivo_pausa: string | null
          motivo_pausa_detalle: string | null
          nombre: string
          pausado: boolean
          pausado_hasta: string | null
          precio_aprobado: number | null
          precio_estimado: number | null
          razon_cierre: string | null
          responsable_id: string | null
          stage_actual: string
          tipo_cierre: string | null
          ultimo_pausado_at: string | null
          updated_at: string
          veces_pausado: number
          workspace_id: string
        }
        Insert: {
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string
          etapa_actual_id?: string | null
          id?: string
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre: string
          pausado?: boolean
          pausado_hasta?: string | null
          precio_aprobado?: number | null
          precio_estimado?: number | null
          razon_cierre?: string | null
          responsable_id?: string | null
          stage_actual?: string
          tipo_cierre?: string | null
          ultimo_pausado_at?: string | null
          updated_at?: string
          veces_pausado?: number
          workspace_id: string
        }
        Update: {
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string
          etapa_actual_id?: string | null
          id?: string
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre?: string
          pausado?: boolean
          pausado_hasta?: string | null
          precio_aprobado?: number | null
          precio_estimado?: number | null
          razon_cierre?: string | null
          responsable_id?: string | null
          stage_actual?: string
          tipo_cierre?: string | null
          ultimo_pausado_at?: string | null
          updated_at?: string
          veces_pausado?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negocios_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocios_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
          },
          {
            foreignKeyName: "negocios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "negocios_etapa_actual_id_fkey"
            columns: ["etapa_actual_id"]
            isOneToOne: false
            referencedRelation: "etapas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocios_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocios_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocios_workspace_id_fkey"
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
      notificaciones: {
        Row: {
          contenido: string
          created_at: string | null
          deep_link: string | null
          destinatario_id: string
          entidad_id: string | null
          entidad_tipo: string | null
          estado: string
          id: string
          metadata: Json | null
          tipo: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          contenido: string
          created_at?: string | null
          deep_link?: string | null
          destinatario_id: string
          entidad_id?: string | null
          entidad_tipo?: string | null
          estado?: string
          id?: string
          metadata?: Json | null
          tipo: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          contenido?: string
          created_at?: string | null
          deep_link?: string | null
          destinatario_id?: string
          entidad_id?: string | null
          entidad_tipo?: string | null
          estado?: string
          id?: string
          metadata?: Json | null
          tipo?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificaciones_destinatario_id_fkey"
            columns: ["destinatario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_workspace_id_fkey"
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
      oportunidad_notas: {
        Row: {
          canal_registro: string | null
          contenido: string
          created_at: string | null
          id: string
          oportunidad_id: string
          workspace_id: string
        }
        Insert: {
          canal_registro?: string | null
          contenido: string
          created_at?: string | null
          id?: string
          oportunidad_id: string
          workspace_id: string
        }
        Update: {
          canal_registro?: string | null
          contenido?: string
          created_at?: string | null
          id?: string
          oportunidad_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oportunidad_notas_oportunidad_id_fkey"
            columns: ["oportunidad_id"]
            isOneToOne: false
            referencedRelation: "oportunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oportunidad_notas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      oportunidades: {
        Row: {
          carpeta_url: string | null
          codigo: string
          colaboradores: string[] | null
          contacto_id: string
          created_at: string | null
          custom_data: Json | null
          descripcion: string
          empresa_id: string
          etapa: string
          etapa_changed_at: string
          fecha_cierre_estimada: string | null
          id: string
          probabilidad: number
          razon_perdida: string | null
          responsable_id: string | null
          ultima_accion: string | null
          ultima_accion_fecha: string | null
          updated_at: string | null
          valor_estimado: number | null
          workspace_id: string
        }
        Insert: {
          carpeta_url?: string | null
          codigo: string
          colaboradores?: string[] | null
          contacto_id: string
          created_at?: string | null
          custom_data?: Json | null
          descripcion: string
          empresa_id: string
          etapa?: string
          etapa_changed_at?: string
          fecha_cierre_estimada?: string | null
          id?: string
          probabilidad?: number
          razon_perdida?: string | null
          responsable_id?: string | null
          ultima_accion?: string | null
          ultima_accion_fecha?: string | null
          updated_at?: string | null
          valor_estimado?: number | null
          workspace_id: string
        }
        Update: {
          carpeta_url?: string | null
          codigo?: string
          colaboradores?: string[] | null
          contacto_id?: string
          created_at?: string | null
          custom_data?: Json | null
          descripcion?: string
          empresa_id?: string
          etapa?: string
          etapa_changed_at?: string
          fecha_cierre_estimada?: string | null
          id?: string
          probabilidad?: number
          razon_perdida?: string | null
          responsable_id?: string | null
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
            foreignKeyName: "oportunidades_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
          },
          {
            foreignKeyName: "oportunidades_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oportunidades_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "oportunidades_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "staff"
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
          area: string | null
          avatar_url: string | null
          created_at: string | null
          display_role: string | null
          full_name: string | null
          id: string
          role: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          area?: string | null
          avatar_url?: string | null
          created_at?: string | null
          display_role?: string | null
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          area?: string | null
          avatar_url?: string | null
          created_at?: string | null
          display_role?: string | null
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
      proyecto_notas: {
        Row: {
          canal_registro: string | null
          contenido: string
          created_at: string | null
          id: string
          proyecto_id: string
          workspace_id: string
        }
        Insert: {
          canal_registro?: string | null
          contenido: string
          created_at?: string | null
          id?: string
          proyecto_id: string
          workspace_id: string
        }
        Update: {
          canal_registro?: string | null
          contenido?: string
          created_at?: string | null
          id?: string
          proyecto_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proyecto_notas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyecto_notas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
          },
          {
            foreignKeyName: "proyecto_notas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proyecto_rubros: {
        Row: {
          cantidad: number | null
          created_at: string | null
          id: string
          nombre: string
          presupuestado: number
          proyecto_id: string
          tipo: string | null
          unidad: string | null
          valor_unitario: number | null
        }
        Insert: {
          cantidad?: number | null
          created_at?: string | null
          id?: string
          nombre: string
          presupuestado: number
          proyecto_id: string
          tipo?: string | null
          unidad?: string | null
          valor_unitario?: number | null
        }
        Update: {
          cantidad?: number | null
          created_at?: string | null
          id?: string
          nombre?: string
          presupuestado?: number
          proyecto_id?: string
          tipo?: string | null
          unidad?: string | null
          valor_unitario?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proyecto_rubros_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyecto_rubros_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
          },
        ]
      }
      proyectos: {
        Row: {
          avance_porcentaje: number | null
          canal_creacion: string | null
          carpeta_url: string | null
          cierre_snapshot: Json | null
          codigo: string
          colaboradores: string[] | null
          contacto_id: string | null
          cotizacion_id: string | null
          created_at: string | null
          custom_data: Json | null
          empresa_id: string | null
          estado: string
          estado_changed_at: string
          fecha_cierre: string | null
          fecha_entrega_estimada: string | null
          fecha_fin_estimada: string | null
          fecha_inicio: string | null
          ganancia_estimada: number | null
          horas_estimadas: number | null
          id: string
          lecciones_aprendidas: string | null
          nombre: string
          notas_cierre: string | null
          oportunidad_id: string | null
          presupuesto_total: number | null
          responsable_comercial_id: string | null
          responsable_id: string | null
          retenciones_estimadas: number | null
          roi_descripcion: string | null
          roi_retorno_estimado: number | null
          tipo: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          avance_porcentaje?: number | null
          canal_creacion?: string | null
          carpeta_url?: string | null
          cierre_snapshot?: Json | null
          codigo: string
          colaboradores?: string[] | null
          contacto_id?: string | null
          cotizacion_id?: string | null
          created_at?: string | null
          custom_data?: Json | null
          empresa_id?: string | null
          estado?: string
          estado_changed_at?: string
          fecha_cierre?: string | null
          fecha_entrega_estimada?: string | null
          fecha_fin_estimada?: string | null
          fecha_inicio?: string | null
          ganancia_estimada?: number | null
          horas_estimadas?: number | null
          id?: string
          lecciones_aprendidas?: string | null
          nombre: string
          notas_cierre?: string | null
          oportunidad_id?: string | null
          presupuesto_total?: number | null
          responsable_comercial_id?: string | null
          responsable_id?: string | null
          retenciones_estimadas?: number | null
          roi_descripcion?: string | null
          roi_retorno_estimado?: number | null
          tipo?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          avance_porcentaje?: number | null
          canal_creacion?: string | null
          carpeta_url?: string | null
          cierre_snapshot?: Json | null
          codigo?: string
          colaboradores?: string[] | null
          contacto_id?: string | null
          cotizacion_id?: string | null
          created_at?: string | null
          custom_data?: Json | null
          empresa_id?: string | null
          estado?: string
          estado_changed_at?: string
          fecha_cierre?: string | null
          fecha_entrega_estimada?: string | null
          fecha_fin_estimada?: string | null
          fecha_inicio?: string | null
          ganancia_estimada?: number | null
          horas_estimadas?: number | null
          id?: string
          lecciones_aprendidas?: string | null
          nombre?: string
          notas_cierre?: string | null
          oportunidad_id?: string | null
          presupuesto_total?: number | null
          responsable_comercial_id?: string | null
          responsable_id?: string | null
          retenciones_estimadas?: number | null
          roi_descripcion?: string | null
          roi_retorno_estimado?: number | null
          tipo?: string
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
            foreignKeyName: "proyectos_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
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
            foreignKeyName: "proyectos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "proyectos_oportunidad_id_fkey"
            columns: ["oportunidad_id"]
            isOneToOne: false
            referencedRelation: "oportunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyectos_responsable_comercial_id_fkey"
            columns: ["responsable_comercial_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyectos_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "staff"
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
      ref_tarifas_ica: {
        Row: {
          ciiu_desde: string
          ciiu_hasta: string
          created_at: string | null
          fuente: string
          id: string
          municipio: string
          tarifa_por_mil: number
          vigencia_desde: string
          vigencia_hasta: string | null
        }
        Insert: {
          ciiu_desde?: string
          ciiu_hasta?: string
          created_at?: string | null
          fuente: string
          id?: string
          municipio: string
          tarifa_por_mil: number
          vigencia_desde?: string
          vigencia_hasta?: string | null
        }
        Update: {
          ciiu_desde?: string
          ciiu_hasta?: string
          created_at?: string | null
          fuente?: string
          id?: string
          municipio?: string
          tarifa_por_mil?: number
          vigencia_desde?: string
          vigencia_hasta?: string | null
        }
        Relationships: []
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
      riesgo_causas: {
        Row: {
          contexto: string | null
          created_at: string
          descripcion: string
          factor_riesgo: string | null
          id: string
          impacto_contagio: number | null
          impacto_contagio_detalle: string | null
          impacto_legal: number | null
          impacto_legal_detalle: string | null
          impacto_operativo: number | null
          impacto_operativo_detalle: string | null
          impacto_ponderado: number | null
          impacto_reputacional: number | null
          impacto_reputacional_detalle: string | null
          probabilidad: number | null
          probabilidad_frecuencia: number | null
          probabilidad_frecuencia_detalle: string | null
          probabilidad_ocurrencia: number | null
          probabilidad_ocurrencia_detalle: string | null
          referencia: string
          riesgo_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contexto?: string | null
          created_at?: string
          descripcion: string
          factor_riesgo?: string | null
          id?: string
          impacto_contagio?: number | null
          impacto_contagio_detalle?: string | null
          impacto_legal?: number | null
          impacto_legal_detalle?: string | null
          impacto_operativo?: number | null
          impacto_operativo_detalle?: string | null
          impacto_ponderado?: number | null
          impacto_reputacional?: number | null
          impacto_reputacional_detalle?: string | null
          probabilidad?: number | null
          probabilidad_frecuencia?: number | null
          probabilidad_frecuencia_detalle?: string | null
          probabilidad_ocurrencia?: number | null
          probabilidad_ocurrencia_detalle?: string | null
          referencia: string
          riesgo_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contexto?: string | null
          created_at?: string
          descripcion?: string
          factor_riesgo?: string | null
          id?: string
          impacto_contagio?: number | null
          impacto_contagio_detalle?: string | null
          impacto_legal?: number | null
          impacto_legal_detalle?: string | null
          impacto_operativo?: number | null
          impacto_operativo_detalle?: string | null
          impacto_ponderado?: number | null
          impacto_reputacional?: number | null
          impacto_reputacional_detalle?: string | null
          probabilidad?: number | null
          probabilidad_frecuencia?: number | null
          probabilidad_frecuencia_detalle?: string | null
          probabilidad_ocurrencia?: number | null
          probabilidad_ocurrencia_detalle?: string | null
          referencia?: string
          riesgo_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "riesgo_causas_riesgo_id_fkey"
            columns: ["riesgo_id"]
            isOneToOne: false
            referencedRelation: "riesgos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgo_causas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      riesgos: {
        Row: {
          categoria: string
          codigo: string | null
          created_at: string | null
          descripcion: string
          estado: string
          evaluado_por: string | null
          evento_riesgo: string | null
          evidencias: Json | null
          factor_riesgo: string
          fecha_evaluacion: string | null
          fecha_identificacion: string | null
          fuente_identificacion: string | null
          id: string
          impacto: number
          impacto_contagio: number | null
          impacto_legal: number | null
          impacto_operativo: number | null
          impacto_reputacional: number | null
          nivel_riesgo: string | null
          nivel_riesgo_residual: string | null
          notas: string | null
          probabilidad: number
          probabilidad_frecuencia: number | null
          probabilidad_ocurrencia: number | null
          probabilidad_tipo: string | null
          referencia: string | null
          responsable_id: string | null
          riesgo_residual_impacto: number | null
          riesgo_residual_probabilidad: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          categoria: string
          codigo?: string | null
          created_at?: string | null
          descripcion: string
          estado?: string
          evaluado_por?: string | null
          evento_riesgo?: string | null
          evidencias?: Json | null
          factor_riesgo: string
          fecha_evaluacion?: string | null
          fecha_identificacion?: string | null
          fuente_identificacion?: string | null
          id?: string
          impacto: number
          impacto_contagio?: number | null
          impacto_legal?: number | null
          impacto_operativo?: number | null
          impacto_reputacional?: number | null
          nivel_riesgo?: string | null
          nivel_riesgo_residual?: string | null
          notas?: string | null
          probabilidad: number
          probabilidad_frecuencia?: number | null
          probabilidad_ocurrencia?: number | null
          probabilidad_tipo?: string | null
          referencia?: string | null
          responsable_id?: string | null
          riesgo_residual_impacto?: number | null
          riesgo_residual_probabilidad?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          categoria?: string
          codigo?: string | null
          created_at?: string | null
          descripcion?: string
          estado?: string
          evaluado_por?: string | null
          evento_riesgo?: string | null
          evidencias?: Json | null
          factor_riesgo?: string
          fecha_evaluacion?: string | null
          fecha_identificacion?: string | null
          fuente_identificacion?: string | null
          id?: string
          impacto?: number
          impacto_contagio?: number | null
          impacto_legal?: number | null
          impacto_operativo?: number | null
          impacto_reputacional?: number | null
          nivel_riesgo?: string | null
          nivel_riesgo_residual?: string | null
          notas?: string | null
          probabilidad?: number
          probabilidad_frecuencia?: number | null
          probabilidad_ocurrencia?: number | null
          probabilidad_tipo?: string | null
          referencia?: string | null
          responsable_id?: string | null
          riesgo_residual_impacto?: number | null
          riesgo_residual_probabilidad?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "riesgos_evaluado_por_fkey"
            columns: ["evaluado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgos_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      riesgos_controles: {
        Row: {
          actividad_control: string | null
          causa_id: string | null
          clasificacion: string | null
          config_extra: Json | null
          created_at: string | null
          ef_actividades_complejas: number | null
          ef_cambios_personal: number | null
          ef_certeza: number | null
          ef_depende_otros: number | null
          ef_juicios_significativos: number | null
          ef_multiples_localidades: number | null
          ef_sujeto_actualizaciones: number | null
          estado: string
          id: string
          negocio_id: string | null
          nombre_control: string
          periodicidad: string | null
          ponderacion_efectividad: number | null
          ponderacion_factores: number | null
          referencia: string | null
          responsable_id: string | null
          riesgo_id: string | null
          tipo_control: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          actividad_control?: string | null
          causa_id?: string | null
          clasificacion?: string | null
          config_extra?: Json | null
          created_at?: string | null
          ef_actividades_complejas?: number | null
          ef_cambios_personal?: number | null
          ef_certeza?: number | null
          ef_depende_otros?: number | null
          ef_juicios_significativos?: number | null
          ef_multiples_localidades?: number | null
          ef_sujeto_actualizaciones?: number | null
          estado?: string
          id?: string
          negocio_id?: string | null
          nombre_control: string
          periodicidad?: string | null
          ponderacion_efectividad?: number | null
          ponderacion_factores?: number | null
          referencia?: string | null
          responsable_id?: string | null
          riesgo_id?: string | null
          tipo_control: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          actividad_control?: string | null
          causa_id?: string | null
          clasificacion?: string | null
          config_extra?: Json | null
          created_at?: string | null
          ef_actividades_complejas?: number | null
          ef_cambios_personal?: number | null
          ef_certeza?: number | null
          ef_depende_otros?: number | null
          ef_juicios_significativos?: number | null
          ef_multiples_localidades?: number | null
          ef_sujeto_actualizaciones?: number | null
          estado?: string
          id?: string
          negocio_id?: string | null
          nombre_control?: string
          periodicidad?: string | null
          ponderacion_efectividad?: number | null
          ponderacion_factores?: number | null
          referencia?: string | null
          responsable_id?: string | null
          riesgo_id?: string | null
          tipo_control?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "riesgos_controles_causa_id_fkey"
            columns: ["causa_id"]
            isOneToOne: false
            referencedRelation: "riesgo_causas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "riesgos_controles_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgos_controles_riesgo_id_fkey"
            columns: ["riesgo_id"]
            isOneToOne: false
            referencedRelation: "riesgos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgos_controles_workspace_id_fkey"
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
      saldos_banco: {
        Row: {
          created_at: string | null
          diferencia: number
          fecha: string | null
          id: string
          nota: string | null
          registrado_via: string
          saldo_real: number
          saldo_teorico: number
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          diferencia: number
          fecha?: string | null
          id?: string
          nota?: string | null
          registrado_via?: string
          saldo_real: number
          saldo_teorico: number
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          diferencia?: number
          fecha?: string | null
          id?: string
          nota?: string | null
          registrado_via?: string
          saldo_real?: number
          saldo_teorico?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saldos_banco_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      servicios: {
        Row: {
          activo: boolean | null
          costo_estimado: number | null
          created_at: string | null
          id: string
          nombre: string
          precio_estandar: number | null
          rubros_template: Json | null
          tarifa_iva: number
          tipo_iva: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          activo?: boolean | null
          costo_estimado?: number | null
          created_at?: string | null
          id?: string
          nombre: string
          precio_estandar?: number | null
          rubros_template?: Json | null
          tarifa_iva?: number
          tipo_iva?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          activo?: boolean | null
          costo_estimado?: number | null
          created_at?: string | null
          id?: string
          nombre?: string
          precio_estandar?: number | null
          rubros_template?: Json | null
          tarifa_iva?: number
          tipo_iva?: string
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
          area: string | null
          contract_type: string | null
          created_at: string | null
          department: string | null
          display_role: string | null
          es_principal: boolean | null
          full_name: string
          horas_disponibles_mes: number | null
          id: string
          is_active: boolean | null
          phone_whatsapp: string | null
          position: string | null
          profile_id: string | null
          rol_plataforma: string | null
          salary: number | null
          tipo_acceso: string | null
          tipo_vinculo: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          area?: string | null
          contract_type?: string | null
          created_at?: string | null
          department?: string | null
          display_role?: string | null
          es_principal?: boolean | null
          full_name: string
          horas_disponibles_mes?: number | null
          id?: string
          is_active?: boolean | null
          phone_whatsapp?: string | null
          position?: string | null
          profile_id?: string | null
          rol_plataforma?: string | null
          salary?: number | null
          tipo_acceso?: string | null
          tipo_vinculo?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          area?: string | null
          contract_type?: string | null
          created_at?: string | null
          department?: string | null
          display_role?: string | null
          es_principal?: boolean | null
          full_name?: string
          horas_disponibles_mes?: number | null
          id?: string
          is_active?: boolean | null
          phone_whatsapp?: string | null
          position?: string | null
          profile_id?: string | null
          rol_plataforma?: string | null
          salary?: number | null
          tipo_acceso?: string | null
          tipo_vinculo?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_transition_rules: {
        Row: {
          activo: boolean | null
          condicion_config: Json | null
          condicion_tipo: string | null
          created_at: string | null
          desde_stage_id: string | null
          entidad: string
          hasta_stage_id: string
          id: string
          tipo: string
          workspace_id: string
        }
        Insert: {
          activo?: boolean | null
          condicion_config?: Json | null
          condicion_tipo?: string | null
          created_at?: string | null
          desde_stage_id?: string | null
          entidad: string
          hasta_stage_id: string
          id?: string
          tipo: string
          workspace_id: string
        }
        Update: {
          activo?: boolean | null
          condicion_config?: Json | null
          condicion_tipo?: string | null
          created_at?: string | null
          desde_stage_id?: string | null
          entidad?: string
          hasta_stage_id?: string
          id?: string
          tipo?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_transition_rules_desde_stage_id_fkey"
            columns: ["desde_stage_id"]
            isOneToOne: false
            referencedRelation: "workspace_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_transition_rules_hasta_stage_id_fkey"
            columns: ["hasta_stage_id"]
            isOneToOne: false
            referencedRelation: "workspace_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_transition_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      streaks: {
        Row: {
          created_at: string | null
          id: string
          semanas_actuales: number | null
          semanas_record: number | null
          streak_inicio: string | null
          tipo: string
          ultima_actualizacion: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          semanas_actuales?: number | null
          semanas_record?: number | null
          streak_inicio?: string | null
          tipo?: string
          ultima_actualizacion?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          semanas_actuales?: number | null
          semanas_record?: number | null
          streak_inicio?: string | null
          tipo?: string
          ultima_actualizacion?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "streaks_workspace_id_fkey"
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
      tenant_rules: {
        Row: {
          acciones: Json
          activo: boolean | null
          condiciones: Json
          created_at: string | null
          descripcion: string | null
          entidad: string
          evento: string
          id: string
          nombre: string
          prioridad: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          acciones: Json
          activo?: boolean | null
          condiciones: Json
          created_at?: string | null
          descripcion?: string | null
          entidad: string
          evento: string
          id?: string
          nombre: string
          prioridad?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          acciones?: Json
          activo?: boolean | null
          condiciones?: Json
          created_at?: string | null
          descripcion?: string | null
          entidad?: string
          evento?: string
          id?: string
          nombre?: string
          prioridad?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_rules_tenant_id_fkey"
            columns: ["tenant_id"]
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
      timer_activo: {
        Row: {
          created_at: string | null
          descripcion: string | null
          id: string
          inicio: string
          negocio_id: string | null
          proyecto_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          descripcion?: string | null
          id?: string
          inicio?: string
          negocio_id?: string | null
          proyecto_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          descripcion?: string | null
          id?: string
          inicio?: string
          negocio_id?: string | null
          proyecto_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "timer_activo_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timer_activo_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
          },
          {
            foreignKeyName: "timer_activo_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ve_procesamiento_log: {
        Row: {
          campos_extraidos: Json | null
          costo_usd: number | null
          documentos_procesados: string[]
          exitoso: boolean
          id: string
          oportunidad_id: string
          procesado_en: string
          workspace_id: string
        }
        Insert: {
          campos_extraidos?: Json | null
          costo_usd?: number | null
          documentos_procesados?: string[]
          exitoso?: boolean
          id?: string
          oportunidad_id: string
          procesado_en?: string
          workspace_id: string
        }
        Update: {
          campos_extraidos?: Json | null
          costo_usd?: number | null
          documentos_procesados?: string[]
          exitoso?: boolean
          id?: string
          oportunidad_id?: string
          procesado_en?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ve_procesamiento_log_workspace_id_fkey"
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
      wa_message_log: {
        Row: {
          confidence: number | null
          created_at: string | null
          direction: string
          gemini_input_tokens: number | null
          gemini_latency_ms: number | null
          gemini_model: string | null
          gemini_output_tokens: number | null
          id: string
          intent: string | null
          message_preview: string | null
          parser_source: string | null
          phone: string
          workspace_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          direction: string
          gemini_input_tokens?: number | null
          gemini_latency_ms?: number | null
          gemini_model?: string | null
          gemini_output_tokens?: number | null
          id?: string
          intent?: string | null
          message_preview?: string | null
          parser_source?: string | null
          phone: string
          workspace_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          direction?: string
          gemini_input_tokens?: number | null
          gemini_latency_ms?: number | null
          gemini_model?: string | null
          gemini_output_tokens?: number | null
          id?: string
          intent?: string | null
          message_preview?: string | null
          parser_source?: string | null
          phone?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_message_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_features: {
        Row: {
          activated_at: string | null
          created_at: string | null
          feature_key: string
          id: string
          is_active: boolean
          price_cop: number
          workspace_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string | null
          feature_key: string
          id?: string
          is_active?: boolean
          price_cop?: number
          workspace_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string | null
          feature_key?: string
          id?: string
          is_active?: boolean
          price_cop?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_features_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_stages: {
        Row: {
          activo: boolean | null
          color: string | null
          created_at: string | null
          entidad: string
          es_sistema: boolean | null
          es_terminal: boolean | null
          id: string
          nombre: string
          orden: number
          proceso: string | null
          sistema_slug: string | null
          slug: string
          workspace_id: string
        }
        Insert: {
          activo?: boolean | null
          color?: string | null
          created_at?: string | null
          entidad: string
          es_sistema?: boolean | null
          es_terminal?: boolean | null
          id?: string
          nombre: string
          orden?: number
          proceso?: string | null
          sistema_slug?: string | null
          slug: string
          workspace_id: string
        }
        Update: {
          activo?: boolean | null
          color?: string | null
          created_at?: string | null
          entidad?: string
          es_sistema?: boolean | null
          es_terminal?: boolean | null
          id?: string
          nombre?: string
          orden?: number
          proceso?: string | null
          sistema_slug?: string | null
          slug?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          color_primario: string | null
          color_secundario: string | null
          created_at: string | null
          drive_folder_id: string | null
          equipo_declarado: number | null
          id: string
          linea_activa_id: string | null
          logo_url: string | null
          max_seats: number
          modules: Json
          name: string
          onboarding_completed: boolean | null
          profession: string | null
          proyecto_modules: Json
          slug: string
          stages_activos: Json
          subscription_expires_at: string | null
          subscription_started_at: string | null
          subscription_status: string
          tipo: string
          trial_ends_at: string | null
          updated_at: string | null
          years_independent: number | null
        }
        Insert: {
          color_primario?: string | null
          color_secundario?: string | null
          created_at?: string | null
          drive_folder_id?: string | null
          equipo_declarado?: number | null
          id?: string
          linea_activa_id?: string | null
          logo_url?: string | null
          max_seats?: number
          modules?: Json
          name: string
          onboarding_completed?: boolean | null
          profession?: string | null
          proyecto_modules?: Json
          slug: string
          stages_activos?: Json
          subscription_expires_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          tipo?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          years_independent?: number | null
        }
        Update: {
          color_primario?: string | null
          color_secundario?: string | null
          created_at?: string | null
          drive_folder_id?: string | null
          equipo_declarado?: number | null
          id?: string
          linea_activa_id?: string | null
          logo_url?: string | null
          max_seats?: number
          modules?: Json
          name?: string
          onboarding_completed?: boolean | null
          profession?: string | null
          proyecto_modules?: Json
          slug?: string
          stages_activos?: Json
          subscription_expires_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string
          tipo?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          years_independent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_linea_activa_id_fkey"
            columns: ["linea_activa_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_cartera_antiguedad: {
        Row: {
          rango_0_30: number | null
          rango_31_60: number | null
          rango_61_90: number | null
          rango_90_plus: number | null
          total_cartera: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_equipo_activo: {
        Row: {
          tiene_equipo: boolean | null
          workspace_id: string | null
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
      v_facturas_estado: {
        Row: {
          cobrado: number | null
          created_at: string | null
          dias_antiguedad: number | null
          estado_pago: string | null
          factura_id: string | null
          fecha_emision: string | null
          monto: number | null
          notas: string | null
          numero_factura: string | null
          proyecto_id: string | null
          saldo_pendiente: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
          },
          {
            foreignKeyName: "facturas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_gastos_fijos_mes_actual: {
        Row: {
          borrador_id: string | null
          categoria: string | null
          confirmado: boolean | null
          fecha_confirmacion: string | null
          fecha_pago_real: string | null
          monto_esperado: number | null
          monto_real: number | null
          nombre: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gastos_fijos_borradores_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_mc_negocio: {
        Row: {
          costos_variables: number | null
          estado: string | null
          gastos_count: number | null
          mc: number | null
          mc_pct: number | null
          negocio_codigo: string | null
          negocio_id: string | null
          negocio_nombre: string | null
          precio_aprobado: number | null
          precio_estimado: number | null
          stage_actual: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negocios_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_proyecto_financiero: {
        Row: {
          avance_calculado: number | null
          avance_porcentaje: number | null
          canal_creacion: string | null
          carpeta_url: string | null
          cobrado: number | null
          codigo: string | null
          contacto_id: string | null
          contacto_nombre: string | null
          costo_acumulado: number | null
          costo_horas: number | null
          cotizacion_id: string | null
          created_at: string | null
          empresa_id: string | null
          empresa_nombre: string | null
          estado: string | null
          estado_changed_at: string | null
          facturado: number | null
          fecha_cierre: string | null
          fecha_entrega_estimada: string | null
          fecha_fin_estimada: string | null
          fecha_inicio: string | null
          ganancia_actual: number | null
          ganancia_estimada: number | null
          gastos_directos: number | null
          horas_estimadas: number | null
          horas_reales: number | null
          nombre: string | null
          num_cobros: number | null
          num_facturas: number | null
          oportunidad_codigo: string | null
          oportunidad_id: string | null
          presupuesto_consumido_pct: number | null
          presupuesto_total: number | null
          proyecto_id: string | null
          responsable_nombre: string | null
          retenciones_estimadas: number | null
          tipo: string | null
          ultima_actividad: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proyectos_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
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
      v_proyecto_rubros_comparativo: {
        Row: {
          cantidad: number | null
          consumido_pct: number | null
          diferencia: number | null
          gastado_real: number | null
          presupuestado: number | null
          proyecto_id: string | null
          rubro_id: string | null
          rubro_nombre: string | null
          rubro_tipo: string | null
          unidad: string | null
          valor_unitario: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proyecto_rubros_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "proyectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyecto_rubros_proyecto_id_fkey"
            columns: ["proyecto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["proyecto_id"]
          },
        ]
      }
      v_pyl_mes: {
        Row: {
          costos_variables: number | null
          ebitda: number | null
          fijos_gastos_mes: number | null
          fijos_recurrentes: number | null
          fijos_total: number | null
          ingresos: number | null
          mc: number | null
          mc_pct: number | null
          mes: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_plantilla_to_workspace: {
        Args: { p_linea_id: string; p_workspace_id: string }
        Returns: undefined
      }
      check_perfil_fiscal_completo: {
        Args: { p_empresa_id: string }
        Returns: boolean
      }
      crear_notificacion: {
        Args: {
          p_contenido: string
          p_deep_link?: string
          p_destinatario_id: string
          p_entidad_id?: string
          p_entidad_tipo?: string
          p_metadata?: Json
          p_tipo: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      current_user_workspace_id: { Args: never; Returns: string }
      evaluate_stage_rules: {
        Args: {
          p_entidad_id: string
          p_entidad_tipo: string
          p_workspace_id: string
        }
        Returns: string
      }
      generate_empresa_codigo: {
        Args: { p_nombre: string; p_workspace_id: string }
        Returns: string
      }
      generate_negocio_codigo: {
        Args: { p_empresa_id: string; p_workspace_id: string }
        Returns: string
      }
      generate_negocio_codigo_sin_empresa: {
        Args: { p_contacto_id: string; p_workspace_id: string }
        Returns: string
      }
      generate_oportunidad_codigo: {
        Args: { p_empresa_id: string; p_workspace_id: string }
        Returns: string
      }
      get_next_cotizacion_consecutivo: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      get_profile_by_role: {
        Args: { p_role: string; p_workspace_id: string }
        Returns: string
      }
      get_user_role: { Args: never; Returns: string }
      is_admin_or_owner: { Args: never; Returns: boolean }
      puede_avanzar_etapa: {
        Args: { p_etapa_id: string; p_negocio_id: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
      wa_find_contacts: {
        Args: { p_hint: string; p_limit?: number; p_workspace_id: string }
        Returns: {
          email: string
          id: string
          nombre: string
          rol: string
          telefono: string
        }[]
      }
      wa_find_opportunities: {
        Args: { p_hint: string; p_limit?: number; p_workspace_id: string }
        Returns: {
          contacto_nombre: string
          descripcion: string
          empresa_nombre: string
          etapa: string
          id: string
          updated_at: string
          valor_estimado: number
        }[]
      }
      wa_find_projects: {
        Args: { p_hint: string; p_limit?: number; p_workspace_id: string }
        Returns: {
          cartera: number
          cobrado: number
          codigo: string
          contacto_nombre: string
          costo_acumulado: number
          empresa_nombre: string
          estado: string
          facturado: number
          horas_estimadas: number
          horas_reales: number
          id: string
          nombre: string
          presupuesto_consumido_pct: number
          presupuesto_total: number
        }[]
      }
      wa_identify_user: {
        Args: { p_phone: string }
        Returns: {
          es_principal: boolean
          full_name: string
          phone_whatsapp: string
          tipo_acceso: string
          workspace_id: string
        }[]
      }
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
export type BankAccount = Database['public']['Tables']['bank_accounts']['Row']
export type Client = Database['public']['Tables']['clients']['Row']
export type Contacto = Database['public']['Tables']['contactos']['Row']
export type CustomFieldMapping = Database['public']['Tables']['custom_field_mappings']['Row']
export type DBClient = Database['public']['Tables']['clients']['Row']
export type DBFiscalProfile = Database['public']['Tables']['fiscal_profiles']['Row']
export type Empresa = Database['public']['Tables']['empresas']['Row']
export type EntityLabel = Database['public']['Tables']['entity_labels']['Row']
export type EtapaHistorial = Database['public']['Tables']['etapa_historial']['Row']
export type Expense = Database['public']['Tables']['expenses']['Row']
export type ExpenseCategory = Database['public']['Tables']['expense_categories']['Row']
export type Factura = Database['public']['Tables']['facturas']['Row']
export type FiscalProfile = Database['public']['Tables']['fiscal_profiles']['Row']
export type FixedExpense = Database['public']['Tables']['fixed_expenses']['Row']
export type Gasto = Database['public']['Tables']['gastos']['Row']
export type Hora = Database['public']['Tables']['horas']['Row']
export type Invoice = Database['public']['Tables']['invoices']['Row']
export type Label = Database['public']['Tables']['labels']['Row']
export type MonthlyTarget = Database['public']['Tables']['monthly_targets']['Row']
export type Notificacion = Database['public']['Tables']['notificaciones']['Row']
export type Note = Database['public']['Tables']['notes']['Row']
export type Oportunidad = Database['public']['Tables']['oportunidades']['Row']
export type OpportunityLegacy = Database['public']['Tables']['opportunities']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProjectLegacy = Database['public']['Tables']['projects']['Row']
export type Proyecto = Database['public']['Tables']['proyectos']['Row']
export type ProyectoRubro = Database['public']['Tables']['proyecto_rubros']['Row']
export type Quote = Database['public']['Tables']['quotes']['Row']
export type RefTarifaIca = Database['public']['Tables']['ref_tarifas_ica']['Row']
export type Rubro = Database['public']['Tables']['rubros']['Row']
export type SaldoBanco = Database['public']['Tables']['saldos_banco']['Row']
export type Servicio = Database['public']['Tables']['servicios']['Row']
export type Staff = Database['public']['Tables']['staff']['Row']
export type StageTransitionRule = Database['public']['Tables']['stage_transition_rules']['Row']
export type TeamInvitation = Database['public']['Tables']['team_invitations']['Row']
export type TimeEntry = Database['public']['Tables']['time_entries']['Row']
export type Workspace = Database['public']['Tables']['workspaces']['Row']
export type WorkspaceFeature = Database['public']['Tables']['workspace_features']['Row']
export type WorkspaceStageRow = Database['public']['Tables']['workspace_stages']['Row']
