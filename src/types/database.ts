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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aceptaciones_terminos: {
        Row: {
          button_id: string | null
          calidad: string
          canal: string
          cedula_aceptante: string | null
          contrato_fin: string | null
          created_at: string
          documento_sha256: string
          documento_titulo: string
          documento_url: string | null
          documento_version: string
          documento_version_id: string | null
          documento_wamid: string | null
          empresa_nit: string | null
          empresa_nombre: string | null
          enviado_at: string | null
          estado: string
          expira_at: string
          id: string
          ip: unknown
          negocio_id: string | null
          nombre_aceptante: string
          payload_respuesta: Json | null
          prompt_wamid: string | null
          reply_wamid: string | null
          respondido_at: string | null
          retencion_hasta: string | null
          telefono: string | null
          texto_aceptacion: string
          texto_aceptacion_sha256: string | null
          texto_documento_sha256: string | null
          ultimo_intento_at: string | null
          user_agent: string | null
          usuario_id: string | null
          workspace_cliente_id: string | null
          workspace_id: string
        }
        Insert: {
          button_id?: string | null
          calidad: string
          canal?: string
          cedula_aceptante?: string | null
          contrato_fin?: string | null
          created_at?: string
          documento_sha256: string
          documento_titulo: string
          documento_url?: string | null
          documento_version: string
          documento_version_id?: string | null
          documento_wamid?: string | null
          empresa_nit?: string | null
          empresa_nombre?: string | null
          enviado_at?: string | null
          estado?: string
          expira_at?: string
          id?: string
          ip?: unknown
          negocio_id?: string | null
          nombre_aceptante: string
          payload_respuesta?: Json | null
          prompt_wamid?: string | null
          reply_wamid?: string | null
          respondido_at?: string | null
          retencion_hasta?: string | null
          telefono?: string | null
          texto_aceptacion: string
          texto_aceptacion_sha256?: string | null
          texto_documento_sha256?: string | null
          ultimo_intento_at?: string | null
          user_agent?: string | null
          usuario_id?: string | null
          workspace_cliente_id?: string | null
          workspace_id: string
        }
        Update: {
          button_id?: string | null
          calidad?: string
          canal?: string
          cedula_aceptante?: string | null
          contrato_fin?: string | null
          created_at?: string
          documento_sha256?: string
          documento_titulo?: string
          documento_url?: string | null
          documento_version?: string
          documento_version_id?: string | null
          documento_wamid?: string | null
          empresa_nit?: string | null
          empresa_nombre?: string | null
          enviado_at?: string | null
          estado?: string
          expira_at?: string
          id?: string
          ip?: unknown
          negocio_id?: string | null
          nombre_aceptante?: string
          payload_respuesta?: Json | null
          prompt_wamid?: string | null
          reply_wamid?: string | null
          respondido_at?: string | null
          retencion_hasta?: string | null
          telefono?: string | null
          texto_aceptacion?: string
          texto_aceptacion_sha256?: string | null
          texto_documento_sha256?: string | null
          ultimo_intento_at?: string | null
          user_agent?: string | null
          usuario_id?: string | null
          workspace_cliente_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aceptaciones_terminos_documento_version_id_fkey"
            columns: ["documento_version_id"]
            isOneToOne: false
            referencedRelation: "documentos_contractuales_versiones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_workspace_cliente_id_fkey"
            columns: ["workspace_cliente_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aceptaciones_terminos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      aceptaciones_terminos_acciones: {
        Row: {
          aceptacion_id: string
          acuse_status: string | null
          acuse_status_at: string | null
          created_at: string
          enviada_at: string | null
          error: string | null
          estado: string
          id: string
          intentado_at: string | null
          secreto_borrado_at: string | null
          secreto_id: string | null
          tipo: string
          wamid: string | null
        }
        Insert: {
          aceptacion_id: string
          acuse_status?: string | null
          acuse_status_at?: string | null
          created_at?: string
          enviada_at?: string | null
          error?: string | null
          estado?: string
          id?: string
          intentado_at?: string | null
          secreto_borrado_at?: string | null
          secreto_id?: string | null
          tipo: string
          wamid?: string | null
        }
        Update: {
          aceptacion_id?: string
          acuse_status?: string | null
          acuse_status_at?: string | null
          created_at?: string
          enviada_at?: string | null
          error?: string | null
          estado?: string
          id?: string
          intentado_at?: string | null
          secreto_borrado_at?: string | null
          secreto_id?: string | null
          tipo?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aceptaciones_terminos_acciones_aceptacion_id_fkey"
            columns: ["aceptacion_id"]
            isOneToOne: false
            referencedRelation: "aceptaciones_terminos"
            referencedColumns: ["id"]
          },
        ]
      }
      actas_generadas: {
        Row: {
          compromisos: Json
          created_at: string
          decisiones: Json
          duracion_segundos: number
          enviado_at: string | null
          estado: string
          event_id: string
          fecha_reunion: string
          id: string
          modo_envio: string
          participantes: Json
          resend_id: string | null
          resumen: string
          tipo: string
          titulo: string | null
          transcript_file_id: string
          workspace_id: string | null
        }
        Insert: {
          compromisos?: Json
          created_at?: string
          decisiones?: Json
          duracion_segundos: number
          enviado_at?: string | null
          estado?: string
          event_id: string
          fecha_reunion: string
          id?: string
          modo_envio: string
          participantes?: Json
          resend_id?: string | null
          resumen: string
          tipo: string
          titulo?: string | null
          transcript_file_id: string
          workspace_id?: string | null
        }
        Update: {
          compromisos?: Json
          created_at?: string
          decisiones?: Json
          duracion_segundos?: number
          enviado_at?: string | null
          estado?: string
          event_id?: string
          fecha_reunion?: string
          id?: string
          modo_envio?: string
          participantes?: Json
          resend_id?: string | null
          resumen?: string
          tipo?: string
          titulo?: string | null
          transcript_file_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actas_generadas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
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
      activity_menciones: {
        Row: {
          activity_log_id: string
          area: string | null
          created_at: string
          id: string
          staff_id: string | null
          workspace_id: string
        }
        Insert: {
          activity_log_id: string
          area?: string | null
          created_at?: string
          id?: string
          staff_id?: string | null
          workspace_id: string
        }
        Update: {
          activity_log_id?: string
          area?: string | null
          created_at?: string
          id?: string
          staff_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_menciones_activity_log_id_fkey"
            columns: ["activity_log_id"]
            isOneToOne: false
            referencedRelation: "activity_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_menciones_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_menciones_workspace_id_fkey"
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
      alertas_plazo_log: {
        Row: {
          ancla_origen: string
          destinatarios: string[]
          dias_habiles: number
          enviado_at: string
          fecha_ancla: string
          hito: string
          id: string
          negocio_id: string
          workspace_id: string
        }
        Insert: {
          ancla_origen: string
          destinatarios?: string[]
          dias_habiles: number
          enviado_at?: string
          fecha_ancla: string
          hito: string
          id?: string
          negocio_id: string
          workspace_id: string
        }
        Update: {
          ancla_origen?: string
          destinatarios?: string[]
          dias_habiles?: number
          enviado_at?: string
          fecha_ancla?: string
          hito?: string
          id?: string
          negocio_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "alertas_plazo_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      aliados: {
        Row: {
          contacto_nombre: string | null
          created_at: string
          created_by: string | null
          email: string | null
          estado: string
          id: string
          nit: string | null
          nombre: string
          notas: string | null
          telefono: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contacto_nombre?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          estado?: string
          id?: string
          nit?: string | null
          nombre: string
          notas?: string | null
          telefono?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contacto_nombre?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          estado?: string
          id?: string
          nit?: string | null
          nombre?: string
          notas?: string | null
          telefono?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aliados_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aliados_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
      avisos_cliente: {
        Row: {
          bloque_config_id: string | null
          canal: string
          copia_a: string | null
          created_at: string
          destino: string | null
          entregado_at: string | null
          estado: string
          etapa_id: string | null
          etapa_nombre: string | null
          id: string
          motivo: string | null
          negocio_id: string
          proveedor_id: string | null
          queja_at: string | null
          titulo: string | null
          workspace_id: string
        }
        Insert: {
          bloque_config_id?: string | null
          canal: string
          copia_a?: string | null
          created_at?: string
          destino?: string | null
          entregado_at?: string | null
          estado: string
          etapa_id?: string | null
          etapa_nombre?: string | null
          id?: string
          motivo?: string | null
          negocio_id: string
          proveedor_id?: string | null
          queja_at?: string | null
          titulo?: string | null
          workspace_id: string
        }
        Update: {
          bloque_config_id?: string | null
          canal?: string
          copia_a?: string | null
          created_at?: string
          destino?: string | null
          entregado_at?: string | null
          estado?: string
          etapa_id?: string | null
          etapa_nombre?: string | null
          id?: string
          motivo?: string | null
          negocio_id?: string
          proveedor_id?: string | null
          queja_at?: string | null
          titulo?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avisos_cliente_bloque_config_id_fkey"
            columns: ["bloque_config_id"]
            isOneToOne: false
            referencedRelation: "bloque_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_cliente_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_cliente_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "v_negocios_etapa_vencimiento"
            referencedColumns: ["etapa_id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "avisos_cliente_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "avisos_cliente_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_areas_editoras_fecha_cita_20260810: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_areas_editoras_operaciones_20260914: {
        Row: {
          config_extra: Json | null
          id: string | null
          respaldado_at: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_aviso_recaudo_20260908: {
        Row: {
          aviso: Json | null
          codigo: string | null
          id: string | null
          respaldado_en: string | null
        }
        Insert: {
          aviso?: Json | null
          codigo?: string | null
          id?: string | null
          respaldado_en?: string | null
        }
        Update: {
          aviso?: Json | null
          codigo?: string | null
          id?: string | null
          respaldado_en?: string | null
        }
        Relationships: []
      }
      backup_bloque_cita_dian_requerida_20260818: {
        Row: {
          bloque_definition_id: string | null
          config_extra: Json | null
          created_at: string | null
          descripcion: string | null
          es_gate: boolean | null
          estado: string | null
          etapa_id: string | null
          id: string | null
          nombre: string | null
          orden: number | null
          respaldado_at: string | null
          slug: string | null
          workspace_id: string | null
        }
        Insert: {
          bloque_definition_id?: string | null
          config_extra?: Json | null
          created_at?: string | null
          descripcion?: string | null
          es_gate?: boolean | null
          estado?: string | null
          etapa_id?: string | null
          id?: string | null
          nombre?: string | null
          orden?: number | null
          respaldado_at?: string | null
          slug?: string | null
          workspace_id?: string | null
        }
        Update: {
          bloque_definition_id?: string | null
          config_extra?: Json | null
          created_at?: string | null
          descripcion?: string | null
          es_gate?: boolean | null
          estado?: string | null
          etapa_id?: string | null
          id?: string | null
          nombre?: string | null
          orden?: number | null
          respaldado_at?: string | null
          slug?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_bloque_configs_a1_20260831: {
        Row: {
          bloque_definition_id: string | null
          config_extra: Json | null
          created_at: string | null
          descripcion: string | null
          es_gate: boolean | null
          estado: string | null
          etapa_id: string | null
          id: string | null
          nombre: string | null
          orden: number | null
          respaldado_at: string | null
          slug: string | null
          workspace_id: string | null
        }
        Insert: {
          bloque_definition_id?: string | null
          config_extra?: Json | null
          created_at?: string | null
          descripcion?: string | null
          es_gate?: boolean | null
          estado?: string | null
          etapa_id?: string | null
          id?: string | null
          nombre?: string | null
          orden?: number | null
          respaldado_at?: string | null
          slug?: string | null
          workspace_id?: string | null
        }
        Update: {
          bloque_definition_id?: string | null
          config_extra?: Json | null
          created_at?: string | null
          descripcion?: string | null
          es_gate?: boolean | null
          estado?: string | null
          etapa_id?: string | null
          id?: string | null
          nombre?: string | null
          orden?: number | null
          respaldado_at?: string | null
          slug?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_bloque_configs_notificacion_20260810: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_bloque_configs_seccional_20260918: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_bloque_configs_tipo_doc_20260825: {
        Row: {
          bloque_config_id: string | null
          config_extra: Json | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          config_extra?: Json | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          config_extra?: Json | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_bloque_fecha_cita_notif_20260810: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_bloque_labels_orden_deisy_20260908: {
        Row: {
          config_extra: Json | null
          estado: string | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          estado?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          estado?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_bloque_labels_sin_slug_20260908: {
        Row: {
          config_extra: Json | null
          estado: string | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          estado?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          estado?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_bloque_revision_radicado_20260818: {
        Row: {
          config_extra: Json | null
          es_gate: boolean | null
          estado: string | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          es_gate?: boolean | null
          estado?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          es_gate?: boolean | null
          estado?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_certificado_upme_anexos_20260907: {
        Row: {
          config_extra: Json | null
          id: string | null
          respaldado_en: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          respaldado_en?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          respaldado_en?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_cobro_duplicado_ref378962162_20260811: {
        Row: {
          canal_registro: string | null
          created_at: string | null
          created_by: string | null
          created_by_wa_name: string | null
          external_ref: string | null
          factura_id: string | null
          fecha: string | null
          fecha_esperada: string | null
          fuente: string | null
          id: string | null
          mensaje_original: string | null
          monto: number | null
          motivo_respaldo: string | null
          negocio_id: string | null
          notas: string | null
          numero_cuota: number | null
          plan_cobro_id: string | null
          proyecto_id: string | null
          retencion: number | null
          revisado: boolean | null
          revisado_at: string | null
          revisado_por: string | null
          split_json: Json | null
          tercero_nit: string | null
          tipo_cobro: string | null
          vencido: boolean | null
          vencido_at: string | null
          workspace_id: string | null
        }
        Insert: {
          canal_registro?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          external_ref?: string | null
          factura_id?: string | null
          fecha?: string | null
          fecha_esperada?: string | null
          fuente?: string | null
          id?: string | null
          mensaje_original?: string | null
          monto?: number | null
          motivo_respaldo?: string | null
          negocio_id?: string | null
          notas?: string | null
          numero_cuota?: number | null
          plan_cobro_id?: string | null
          proyecto_id?: string | null
          retencion?: number | null
          revisado?: boolean | null
          revisado_at?: string | null
          revisado_por?: string | null
          split_json?: Json | null
          tercero_nit?: string | null
          tipo_cobro?: string | null
          vencido?: boolean | null
          vencido_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          canal_registro?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          external_ref?: string | null
          factura_id?: string | null
          fecha?: string | null
          fecha_esperada?: string | null
          fuente?: string | null
          id?: string | null
          mensaje_original?: string | null
          monto?: number | null
          motivo_respaldo?: string | null
          negocio_id?: string | null
          notas?: string | null
          numero_cuota?: number | null
          plan_cobro_id?: string | null
          proyecto_id?: string | null
          retencion?: number | null
          revisado?: boolean | null
          revisado_at?: string | null
          revisado_por?: string | null
          split_json?: Json | null
          tercero_nit?: string | null
          tipo_cobro?: string | null
          vencido?: boolean | null
          vencido_at?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_contactos_form4106_20260902: {
        Row: {
          email: string | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          rol: string | null
          telefono: string | null
        }
        Insert: {
          email?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          rol?: string | null
          telefono?: string | null
        }
        Update: {
          email?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          rol?: string | null
          telefono?: string | null
        }
        Relationships: []
      }
      backup_contactos_telefono_20260902: {
        Row: {
          id: string | null
          respaldado_at: string | null
          telefono: string | null
        }
        Insert: {
          id?: string | null
          respaldado_at?: string | null
          telefono?: string | null
        }
        Update: {
          id?: string | null
          respaldado_at?: string | null
          telefono?: string | null
        }
        Relationships: []
      }
      backup_copias_documento_20260914: {
        Row: {
          bloque_config_id: string | null
          completado_at: string | null
          completado_por: string | null
          created_at: string | null
          data: Json | null
          estado: string | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
          updated_at: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
          updated_at?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_declaracion_juramentada_20260907: {
        Row: {
          config_extra: Json | null
          id: string | null
          respaldado_en: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          respaldado_en?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          respaldado_en?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_devolucion_iva_derivado_20260915: {
        Row: {
          bloque_config_id: string | null
          completado_at: string | null
          completado_por: string | null
          created_at: string | null
          data: Json | null
          estado: string | null
          id: string | null
          negocio_id: string | null
          updated_at: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
          updated_at?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_etapa_documentacion_routing_20260811: {
        Row: {
          config_extra: Json | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          linea_id: string | null
          motivo_respaldo: string | null
          nombre: string | null
          numero: number | null
          orden: number | null
          stage: string | null
        }
        Insert: {
          config_extra?: Json | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          linea_id?: string | null
          motivo_respaldo?: string | null
          nombre?: string | null
          numero?: number | null
          orden?: number | null
          stage?: string | null
        }
        Update: {
          config_extra?: Json | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          linea_id?: string | null
          motivo_respaldo?: string | null
          nombre?: string | null
          numero?: number | null
          orden?: number | null
          stage?: string | null
        }
        Relationships: []
      }
      backup_etapa_documentacion_routing_20260818: {
        Row: {
          config_extra: Json | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          linea_id: string | null
          nombre: string | null
          numero: number | null
          orden: number | null
          respaldado_at: string | null
          stage: string | null
        }
        Insert: {
          config_extra?: Json | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          linea_id?: string | null
          nombre?: string | null
          numero?: number | null
          orden?: number | null
          respaldado_at?: string | null
          stage?: string | null
        }
        Update: {
          config_extra?: Json | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          linea_id?: string | null
          nombre?: string | null
          numero?: number | null
          orden?: number | null
          respaldado_at?: string | null
          stage?: string | null
        }
        Relationships: []
      }
      backup_etapa_precobro_20260902: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_etapa_v0012_v0246_20260818: {
        Row: {
          codigo: string | null
          etapa_actual_id: string | null
          etapa_cambiada_at: string | null
          id: string | null
          respaldado_at: string | null
          stage_actual: string | null
          updated_at: string | null
        }
        Insert: {
          codigo?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          respaldado_at?: string | null
          stage_actual?: string | null
          updated_at?: string | null
        }
        Update: {
          codigo?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          respaldado_at?: string | null
          stage_actual?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_etapa_v0115_v0138_20260818: {
        Row: {
          codigo: string | null
          etapa_actual_id: string | null
          etapa_cambiada_at: string | null
          id: string | null
          respaldado_at: string | null
          stage_actual: string | null
          updated_at: string | null
        }
        Insert: {
          codigo?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          respaldado_at?: string | null
          stage_actual?: string | null
          updated_at?: string | null
        }
        Update: {
          codigo?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          respaldado_at?: string | null
          stage_actual?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_etapas_aviso_cliente_wa_20260824: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          numero: number | null
          respaldado_at: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          numero?: number | null
          respaldado_at?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          numero?: number | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_etapas_revision_radicado_20260812: {
        Row: {
          config_extra: Json | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          linea_id: string | null
          nombre: string | null
          numero: number | null
          orden: number | null
          stage: string | null
        }
        Insert: {
          config_extra?: Json | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          linea_id?: string | null
          nombre?: string | null
          numero?: number | null
          orden?: number | null
          stage?: string | null
        }
        Update: {
          config_extra?: Json | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          linea_id?: string | null
          nombre?: string | null
          numero?: number | null
          orden?: number | null
          stage?: string | null
        }
        Relationships: []
      }
      backup_factura_campos_extraccion_20260903: {
        Row: {
          config_extra: Json | null
          id: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_fase2_notificacion_20260810: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
          tipo: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          tipo?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
          tipo?: string | null
        }
        Relationships: []
      }
      backup_formulario_tipo_doc_20260825: {
        Row: {
          bloque_config_id: string | null
          data: Json | null
          negocio_bloque_id: string | null
          negocio_id: string | null
          respaldado_at: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          data?: Json | null
          negocio_bloque_id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          data?: Json | null
          negocio_bloque_id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_fusion_contactos_soena_20260907: {
        Row: {
          comision_porcentaje: number | null
          created_at: string | null
          custom_data: Json | null
          email: string | null
          fuente_adquisicion: string | null
          fuente_detalle: string | null
          fuente_promotor_id: string | null
          fuente_referido_nombre: string | null
          id: string | null
          nombre: string | null
          responsable_id: string | null
          rol: string | null
          segmento: string | null
          telefono: string | null
          updated_at: string | null
          usuario_whatsapp: string | null
          workspace_id: string | null
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
          id?: string | null
          nombre?: string | null
          responsable_id?: string | null
          rol?: string | null
          segmento?: string | null
          telefono?: string | null
          updated_at?: string | null
          usuario_whatsapp?: string | null
          workspace_id?: string | null
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
          id?: string | null
          nombre?: string | null
          responsable_id?: string | null
          rol?: string | null
          segmento?: string | null
          telefono?: string | null
          updated_at?: string | null
          usuario_whatsapp?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_fusion_fk_soena_20260907: {
        Row: {
          contacto_id: string | null
          fila_id: string | null
          ref: string | null
          tabla: string | null
        }
        Insert: {
          contacto_id?: string | null
          fila_id?: string | null
          ref?: string | null
          tabla?: string | null
        }
        Update: {
          contacto_id?: string | null
          fila_id?: string | null
          ref?: string | null
          tabla?: string | null
        }
        Relationships: []
      }
      backup_gate_anticipo_20260826: {
        Row: {
          bloque_config_id: string | null
          completado_at: string | null
          data: Json | null
          estado: string | null
          id: string | null
          negocio_id: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          completado_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          completado_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
        }
        Relationships: []
      }
      backup_guias_etapa_20260813: {
        Row: {
          etapa_id: string | null
          guia_anterior: Json | null
          nombre: string | null
          numero: number | null
          tomado_at: string | null
        }
        Insert: {
          etapa_id?: string | null
          guia_anterior?: Json | null
          nombre?: string | null
          numero?: number | null
          tomado_at?: string | null
        }
        Update: {
          etapa_id?: string | null
          guia_anterior?: Json | null
          nombre?: string | null
          numero?: number | null
          tomado_at?: string | null
        }
        Relationships: []
      }
      backup_guias_etapa_20260910: {
        Row: {
          guia: Json | null
          id: string | null
          nombre: string | null
          orden: number | null
          respaldado_at: string | null
        }
        Insert: {
          guia?: Json | null
          id?: string | null
          nombre?: string | null
          orden?: number | null
          respaldado_at?: string | null
        }
        Update: {
          guia?: Json | null
          id?: string | null
          nombre?: string | null
          orden?: number | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_marcas_factura_20260810: {
        Row: {
          codigo: string | null
          id: string | null
          marca_removida: Json | null
          respaldado_at: string | null
        }
        Insert: {
          codigo?: string | null
          id?: string | null
          marca_removida?: Json | null
          respaldado_at?: string | null
        }
        Update: {
          codigo?: string | null
          id?: string | null
          marca_removida?: Json | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_marcas_siigo_cliente_20260902: {
        Row: {
          codigo: string | null
          factura: string | null
          id: string | null
          respaldado_at: string | null
          siigo_cliente_antes: Json | null
        }
        Insert: {
          codigo?: string | null
          factura?: string | null
          id?: string | null
          respaldado_at?: string | null
          siigo_cliente_antes?: Json | null
        }
        Update: {
          codigo?: string | null
          factura?: string | null
          id?: string | null
          respaldado_at?: string | null
          siigo_cliente_antes?: Json | null
        }
        Relationships: []
      }
      backup_meta_leads_config_20260902: {
        Row: {
          id: string | null
          meta_leads: Json | null
          respaldado_at: string | null
        }
        Insert: {
          id?: string | null
          meta_leads?: Json | null
          respaldado_at?: string | null
        }
        Update: {
          id?: string | null
          meta_leads?: Json | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_negocio_bloques_aprobado_servicio_20260901: {
        Row: {
          data: Json | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
        }
        Insert: {
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_negocio_bloques_servicio_20260818: {
        Row: {
          bloque_config_id: string | null
          bloque_slug: string | null
          completado_at: string | null
          completado_por: string | null
          created_at: string | null
          data: Json | null
          estado: string | null
          id: string | null
          negocio_codigo: string | null
          negocio_id: string | null
          respaldado_at: string | null
          updated_at: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          bloque_slug?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_codigo?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
          updated_at?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          bloque_slug?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_codigo?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_negocio_etapa_20260818: {
        Row: {
          codigo: string | null
          etapa_actual_id: string | null
          etapa_cambiada_at: string | null
          id: string | null
          respaldado_at: string | null
          responsable_id: string | null
          stage_actual: string | null
        }
        Insert: {
          codigo?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          respaldado_at?: string | null
          responsable_id?: string | null
          stage_actual?: string | null
        }
        Update: {
          codigo?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          respaldado_at?: string | null
          responsable_id?: string | null
          stage_actual?: string | null
        }
        Relationships: []
      }
      backup_negocio_responsables_20260810: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          negocio_id: string | null
          rol: string | null
          staff_id: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          negocio_id?: string | null
          rol?: string | null
          staff_id?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          negocio_id?: string | null
          rol?: string | null
          staff_id?: string | null
        }
        Relationships: []
      }
      backup_negocio_responsables_20260902: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          negocio_id: string | null
          rol: string | null
          staff_id: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          negocio_id?: string | null
          rol?: string | null
          staff_id?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          negocio_id?: string | null
          rol?: string | null
          staff_id?: string | null
        }
        Relationships: []
      }
      backup_negocio_responsables_deisy_20260902: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          negocio_id: string | null
          rol: string | null
          staff_id: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          negocio_id?: string | null
          rol?: string | null
          staff_id?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          negocio_id?: string | null
          rol?: string | null
          staff_id?: string | null
        }
        Relationships: []
      }
      backup_negocios_reabiertos_iva_20260915: {
        Row: {
          aliado_id: string | null
          balance_final: Json | null
          carpeta_url: string | null
          cierre_motivo: string | null
          cierre_no_facturable: boolean | null
          cierre_no_facturable_at: string | null
          cierre_no_facturable_motivo: string | null
          cierre_no_facturable_nota: string | null
          cierre_no_facturable_por: string | null
          cierre_snapshot: Json | null
          closed_at: string | null
          codigo: string | null
          contacto_id: string | null
          created_at: string | null
          descripcion_cierre: string | null
          empresa_id: string | null
          estado: string | null
          etapa_actual_id: string | null
          etapa_cambiada_at: string | null
          id: string | null
          is_paused: boolean | null
          lecciones_aprendidas: string | null
          linea_id: string | null
          metadata: Json | null
          motivo_cierre: string | null
          motivo_pausa: string | null
          motivo_pausa_detalle: string | null
          nombre: string | null
          origen: string | null
          pausado: boolean | null
          pausado_hasta: string | null
          paused_at: string | null
          paused_by: string | null
          paused_reason: string | null
          precio_aprobado: number | null
          precio_estimado: number | null
          razon_cierre: string | null
          responsable_id: string | null
          stage_actual: string | null
          tipo_cierre: string | null
          ultimo_pausado_at: string | null
          updated_at: string | null
          veces_pausado: number | null
          workspace_id: string | null
        }
        Insert: {
          aliado_id?: string | null
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_motivo?: string | null
          cierre_no_facturable?: boolean | null
          cierre_no_facturable_at?: string | null
          cierre_no_facturable_motivo?: string | null
          cierre_no_facturable_nota?: string | null
          cierre_no_facturable_por?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string | null
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          is_paused?: boolean | null
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          metadata?: Json | null
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre?: string | null
          origen?: string | null
          pausado?: boolean | null
          pausado_hasta?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_reason?: string | null
          precio_aprobado?: number | null
          precio_estimado?: number | null
          razon_cierre?: string | null
          responsable_id?: string | null
          stage_actual?: string | null
          tipo_cierre?: string | null
          ultimo_pausado_at?: string | null
          updated_at?: string | null
          veces_pausado?: number | null
          workspace_id?: string | null
        }
        Update: {
          aliado_id?: string | null
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_motivo?: string | null
          cierre_no_facturable?: boolean | null
          cierre_no_facturable_at?: string | null
          cierre_no_facturable_motivo?: string | null
          cierre_no_facturable_nota?: string | null
          cierre_no_facturable_por?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string | null
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          is_paused?: boolean | null
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          metadata?: Json | null
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre?: string | null
          origen?: string | null
          pausado?: boolean | null
          pausado_hasta?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_reason?: string | null
          precio_aprobado?: number | null
          precio_estimado?: number | null
          razon_cierre?: string | null
          responsable_id?: string | null
          stage_actual?: string | null
          tipo_cierre?: string | null
          ultimo_pausado_at?: string | null
          updated_at?: string | null
          veces_pausado?: number | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_nombres_negocio_n_20260902: {
        Row: {
          id: string | null
          nombre: string | null
          respaldado_en: string | null
        }
        Insert: {
          id?: string | null
          nombre?: string | null
          respaldado_en?: string | null
        }
        Update: {
          id?: string | null
          nombre?: string | null
          respaldado_en?: string | null
        }
        Relationships: []
      }
      backup_precio_aprobado_20260810: {
        Row: {
          codigo: string | null
          id: string | null
          metadata: Json | null
          precio_aprobado: number | null
          respaldado_at: string | null
        }
        Insert: {
          codigo?: string | null
          id?: string | null
          metadata?: Json | null
          precio_aprobado?: number | null
          respaldado_at?: string | null
        }
        Update: {
          codigo?: string | null
          id?: string | null
          metadata?: Json | null
          precio_aprobado?: number | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_propuesta_plan_historico_20260826: {
        Row: {
          bloque_config_id: string | null
          completado_at: string | null
          data: Json | null
          estado: string | null
          id: string | null
          negocio_id: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          completado_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          completado_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
        }
        Relationships: []
      }
      backup_prueba_20260902_contactos: {
        Row: {
          comision_porcentaje: number | null
          created_at: string | null
          custom_data: Json | null
          email: string | null
          fuente_adquisicion: string | null
          fuente_detalle: string | null
          fuente_promotor_id: string | null
          fuente_referido_nombre: string | null
          id: string | null
          nombre: string | null
          responsable_id: string | null
          rol: string | null
          segmento: string | null
          telefono: string | null
          updated_at: string | null
          workspace_id: string | null
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
          id?: string | null
          nombre?: string | null
          responsable_id?: string | null
          rol?: string | null
          segmento?: string | null
          telefono?: string | null
          updated_at?: string | null
          workspace_id?: string | null
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
          id?: string | null
          nombre?: string | null
          responsable_id?: string | null
          rol?: string | null
          segmento?: string | null
          telefono?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_prueba_20260902_empresa_giraldo: {
        Row: {
          actividad_ciiu: string | null
          actividad_secundaria: string | null
          agente_retenedor: boolean | null
          autorretenedor: boolean | null
          codigo: string | null
          contacto_email: string | null
          contacto_id: string | null
          contacto_nombre: string | null
          created_at: string | null
          custom_data: Json | null
          departamento: string | null
          direccion_fiscal: string | null
          email_fiscal: string | null
          estado_fiscal: string | null
          fecha_inicio_actividades: string | null
          gran_contribuyente: boolean | null
          id: string | null
          municipio: string | null
          nombre: string | null
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
          workspace_id: string | null
        }
        Insert: {
          actividad_ciiu?: string | null
          actividad_secundaria?: string | null
          agente_retenedor?: boolean | null
          autorretenedor?: boolean | null
          codigo?: string | null
          contacto_email?: string | null
          contacto_id?: string | null
          contacto_nombre?: string | null
          created_at?: string | null
          custom_data?: Json | null
          departamento?: string | null
          direccion_fiscal?: string | null
          email_fiscal?: string | null
          estado_fiscal?: string | null
          fecha_inicio_actividades?: string | null
          gran_contribuyente?: boolean | null
          id?: string | null
          municipio?: string | null
          nombre?: string | null
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
          workspace_id?: string | null
        }
        Update: {
          actividad_ciiu?: string | null
          actividad_secundaria?: string | null
          agente_retenedor?: boolean | null
          autorretenedor?: boolean | null
          codigo?: string | null
          contacto_email?: string | null
          contacto_id?: string | null
          contacto_nombre?: string | null
          created_at?: string | null
          custom_data?: Json | null
          departamento?: string | null
          direccion_fiscal?: string | null
          email_fiscal?: string | null
          estado_fiscal?: string | null
          fecha_inicio_actividades?: string | null
          gran_contribuyente?: boolean | null
          id?: string | null
          municipio?: string | null
          nombre?: string | null
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
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_prueba_20260902_empresas: {
        Row: {
          actividad_ciiu: string | null
          actividad_secundaria: string | null
          agente_retenedor: boolean | null
          autorretenedor: boolean | null
          codigo: string | null
          contacto_email: string | null
          contacto_id: string | null
          contacto_nombre: string | null
          created_at: string | null
          custom_data: Json | null
          departamento: string | null
          direccion_fiscal: string | null
          email_fiscal: string | null
          estado_fiscal: string | null
          fecha_inicio_actividades: string | null
          gran_contribuyente: boolean | null
          id: string | null
          municipio: string | null
          nombre: string | null
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
          workspace_id: string | null
        }
        Insert: {
          actividad_ciiu?: string | null
          actividad_secundaria?: string | null
          agente_retenedor?: boolean | null
          autorretenedor?: boolean | null
          codigo?: string | null
          contacto_email?: string | null
          contacto_id?: string | null
          contacto_nombre?: string | null
          created_at?: string | null
          custom_data?: Json | null
          departamento?: string | null
          direccion_fiscal?: string | null
          email_fiscal?: string | null
          estado_fiscal?: string | null
          fecha_inicio_actividades?: string | null
          gran_contribuyente?: boolean | null
          id?: string | null
          municipio?: string | null
          nombre?: string | null
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
          workspace_id?: string | null
        }
        Update: {
          actividad_ciiu?: string | null
          actividad_secundaria?: string | null
          agente_retenedor?: boolean | null
          autorretenedor?: boolean | null
          codigo?: string | null
          contacto_email?: string | null
          contacto_id?: string | null
          contacto_nombre?: string | null
          created_at?: string | null
          custom_data?: Json | null
          departamento?: string | null
          direccion_fiscal?: string | null
          email_fiscal?: string | null
          estado_fiscal?: string | null
          fecha_inicio_actividades?: string | null
          gran_contribuyente?: boolean | null
          id?: string | null
          municipio?: string | null
          nombre?: string | null
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
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_prueba_20260902_negocios: {
        Row: {
          aliado_id: string | null
          balance_final: Json | null
          carpeta_url: string | null
          cierre_motivo: string | null
          cierre_no_facturable: boolean | null
          cierre_no_facturable_at: string | null
          cierre_no_facturable_motivo: string | null
          cierre_no_facturable_nota: string | null
          cierre_no_facturable_por: string | null
          cierre_snapshot: Json | null
          closed_at: string | null
          codigo: string | null
          contacto_id: string | null
          created_at: string | null
          descripcion_cierre: string | null
          empresa_id: string | null
          estado: string | null
          etapa_actual_id: string | null
          etapa_cambiada_at: string | null
          id: string | null
          is_paused: boolean | null
          lecciones_aprendidas: string | null
          linea_id: string | null
          metadata: Json | null
          motivo_cierre: string | null
          motivo_pausa: string | null
          motivo_pausa_detalle: string | null
          nombre: string | null
          origen: string | null
          pausado: boolean | null
          pausado_hasta: string | null
          paused_at: string | null
          paused_by: string | null
          paused_reason: string | null
          precio_aprobado: number | null
          precio_estimado: number | null
          razon_cierre: string | null
          responsable_id: string | null
          stage_actual: string | null
          tipo_cierre: string | null
          ultimo_pausado_at: string | null
          updated_at: string | null
          veces_pausado: number | null
          workspace_id: string | null
        }
        Insert: {
          aliado_id?: string | null
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_motivo?: string | null
          cierre_no_facturable?: boolean | null
          cierre_no_facturable_at?: string | null
          cierre_no_facturable_motivo?: string | null
          cierre_no_facturable_nota?: string | null
          cierre_no_facturable_por?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string | null
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          is_paused?: boolean | null
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          metadata?: Json | null
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre?: string | null
          origen?: string | null
          pausado?: boolean | null
          pausado_hasta?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_reason?: string | null
          precio_aprobado?: number | null
          precio_estimado?: number | null
          razon_cierre?: string | null
          responsable_id?: string | null
          stage_actual?: string | null
          tipo_cierre?: string | null
          ultimo_pausado_at?: string | null
          updated_at?: string | null
          veces_pausado?: number | null
          workspace_id?: string | null
        }
        Update: {
          aliado_id?: string | null
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_motivo?: string | null
          cierre_no_facturable?: boolean | null
          cierre_no_facturable_at?: string | null
          cierre_no_facturable_motivo?: string | null
          cierre_no_facturable_nota?: string | null
          cierre_no_facturable_por?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string | null
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          is_paused?: boolean | null
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          metadata?: Json | null
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre?: string | null
          origen?: string | null
          pausado?: boolean | null
          pausado_hasta?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_reason?: string | null
          precio_aprobado?: number | null
          precio_estimado?: number | null
          razon_cierre?: string | null
          responsable_id?: string | null
          stage_actual?: string | null
          tipo_cierre?: string | null
          ultimo_pausado_at?: string | null
          updated_at?: string | null
          veces_pausado?: number | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_recibo_caja_config_20260903: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          respaldado_at: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_reclasificacion_pasante_20260818: {
        Row: {
          id: string | null
          monto: number | null
          negocio_id: string | null
          notas_anterior: string | null
          pasante_calculado: number | null
          split_json_anterior: Json | null
          tarifa: number | null
          tipo_cobro_anterior: string | null
        }
        Insert: {
          id?: string | null
          monto?: number | null
          negocio_id?: string | null
          notas_anterior?: string | null
          pasante_calculado?: number | null
          split_json_anterior?: Json | null
          tarifa?: number | null
          tipo_cobro_anterior?: string | null
        }
        Update: {
          id?: string | null
          monto?: number | null
          negocio_id?: string | null
          notas_anterior?: string | null
          pasante_calculado?: number | null
          split_json_anterior?: Json | null
          tarifa?: number | null
          tipo_cobro_anterior?: string | null
        }
        Relationships: []
      }
      backup_rediseno_rama_iva_20260810: {
        Row: {
          config_extra: Json | null
          id: string | null
          nombre: string | null
          ref: string | null
          respaldado_at: string | null
          tipo: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          ref?: string | null
          respaldado_at?: string | null
          tipo?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          nombre?: string | null
          ref?: string | null
          respaldado_at?: string | null
          tipo?: string | null
        }
        Relationships: []
      }
      backup_reproceso_etapa_origen_20260918: {
        Row: {
          codigo: string | null
          id: string | null
          metadata: Json | null
          respaldado_at: string | null
          workspace_id: string | null
        }
        Insert: {
          codigo?: string | null
          id?: string | null
          metadata?: Json | null
          respaldado_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          codigo?: string | null
          id?: string | null
          metadata?: Json | null
          respaldado_at?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_reproceso_v0142_20260914: {
        Row: {
          abierto_at: string | null
          abierto_por: string | null
          atribuido_a: string | null
          causa: string | null
          cerrado_at: string | null
          ciclo: number | null
          created_at: string | null
          detalle: string | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
          tipo: string | null
          workspace_id: string | null
        }
        Insert: {
          abierto_at?: string | null
          abierto_por?: string | null
          atribuido_a?: string | null
          causa?: string | null
          cerrado_at?: string | null
          ciclo?: number | null
          created_at?: string | null
          detalle?: string | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
          tipo?: string | null
          workspace_id?: string | null
        }
        Update: {
          abierto_at?: string | null
          abierto_por?: string | null
          atribuido_a?: string | null
          causa?: string | null
          cerrado_at?: string | null
          ciclo?: number | null
          created_at?: string | null
          detalle?: string | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
          tipo?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_rls_policies_20260831: {
        Row: {
          backed_up_at: string | null
          cmd: string | null
          permissive: string | null
          policyname: unknown
          qual: string | null
          roles: unknown[] | null
          schemaname: unknown
          tablename: unknown
          with_check: string | null
        }
        Insert: {
          backed_up_at?: string | null
          cmd?: string | null
          permissive?: string | null
          policyname?: unknown
          qual?: string | null
          roles?: unknown[] | null
          schemaname?: unknown
          tablename?: unknown
          with_check?: string | null
        }
        Update: {
          backed_up_at?: string | null
          cmd?: string | null
          permissive?: string | null
          policyname?: unknown
          qual?: string | null
          roles?: unknown[] | null
          schemaname?: unknown
          tablename?: unknown
          with_check?: string | null
        }
        Relationships: []
      }
      backup_rut_campos_extraccion_20260825: {
        Row: {
          config_extra: Json | null
          id: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          config_extra?: Json | null
          id?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          config_extra?: Json | null
          id?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_rut_campos_ubicacion_20260825: {
        Row: {
          codigo: string | null
          data: Json | null
          negocio_bloque_id: string | null
          respaldado_at: string | null
        }
        Insert: {
          codigo?: string | null
          data?: Json | null
          negocio_bloque_id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          codigo?: string | null
          data?: Json | null
          negocio_bloque_id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_rut_dv_errado_20260914: {
        Row: {
          data: Json | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
        }
        Insert: {
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_rut_nit_dv_20260914: {
        Row: {
          data: Json | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
        }
        Insert: {
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_rut_nit_dv_copias_20260914: {
        Row: {
          bloque_config_id: string | null
          data: Json | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_ruta_iva_por_servicio_20260915: {
        Row: {
          config_extra: Json | null
          data: Json | null
          id: string | null
          respaldado_at: string | null
          tabla: string | null
        }
        Insert: {
          config_extra?: Json | null
          data?: Json | null
          id?: string | null
          respaldado_at?: string | null
          tabla?: string | null
        }
        Update: {
          config_extra?: Json | null
          data?: Json | null
          id?: string | null
          respaldado_at?: string | null
          tabla?: string | null
        }
        Relationships: []
      }
      backup_seccional_negocios_20260810: {
        Row: {
          codigo: string | null
          estado: string | null
          id: string | null
          respaldado_en: string | null
          seccional_previa: string | null
        }
        Insert: {
          codigo?: string | null
          estado?: string | null
          id?: string | null
          respaldado_en?: string | null
          seccional_previa?: string | null
        }
        Update: {
          codigo?: string | null
          estado?: string | null
          id?: string | null
          respaldado_en?: string | null
          seccional_previa?: string | null
        }
        Relationships: []
      }
      backup_staff_areas_20260902: {
        Row: {
          area: string | null
          created_at: string | null
          staff_id: string | null
        }
        Insert: {
          area?: string | null
          created_at?: string | null
          staff_id?: string | null
        }
        Update: {
          area?: string | null
          created_at?: string | null
          staff_id?: string | null
        }
        Relationships: []
      }
      backup_telefono_no_numerico_20260902: {
        Row: {
          email: string | null
          id: string | null
          nombre: string | null
          respaldado_en: string | null
          telefono: string | null
          workspace_id: string | null
        }
        Insert: {
          email?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_en?: string | null
          telefono?: string | null
          workspace_id?: string | null
        }
        Update: {
          email?: string | null
          id?: string | null
          nombre?: string | null
          respaldado_en?: string | null
          telefono?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_tramo_gen_envio_20260914: {
        Row: {
          bloque_config_id: string | null
          codigo: string | null
          completado_at: string | null
          completado_por: string | null
          created_at: string | null
          data: Json | null
          estado: string | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
          updated_at: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          codigo?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
          updated_at?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          codigo?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_v0122_correccion_ruta_20260810: {
        Row: {
          bloque_config_id: string | null
          completado_at: string | null
          completado_por: string | null
          created_at: string | null
          data: Json | null
          estado: string | null
          id: string | null
          negocio_id: string | null
          origen_tabla: string | null
          updated_at: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
          origen_tabla?: string | null
          updated_at?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          completado_at?: string | null
          completado_por?: string | null
          created_at?: string | null
          data?: Json | null
          estado?: string | null
          id?: string | null
          negocio_id?: string | null
          origen_tabla?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_v0122_negocio_20260810: {
        Row: {
          aliado_id: string | null
          balance_final: Json | null
          carpeta_url: string | null
          cierre_motivo: string | null
          cierre_no_facturable: boolean | null
          cierre_no_facturable_at: string | null
          cierre_no_facturable_motivo: string | null
          cierre_no_facturable_nota: string | null
          cierre_no_facturable_por: string | null
          cierre_snapshot: Json | null
          closed_at: string | null
          codigo: string | null
          contacto_id: string | null
          created_at: string | null
          descripcion_cierre: string | null
          empresa_id: string | null
          estado: string | null
          etapa_actual_id: string | null
          etapa_cambiada_at: string | null
          id: string | null
          is_paused: boolean | null
          lecciones_aprendidas: string | null
          linea_id: string | null
          metadata: Json | null
          motivo_cierre: string | null
          motivo_pausa: string | null
          motivo_pausa_detalle: string | null
          nombre: string | null
          origen: string | null
          pausado: boolean | null
          pausado_hasta: string | null
          paused_at: string | null
          paused_by: string | null
          paused_reason: string | null
          precio_aprobado: number | null
          precio_estimado: number | null
          razon_cierre: string | null
          responsable_id: string | null
          stage_actual: string | null
          tipo_cierre: string | null
          ultimo_pausado_at: string | null
          updated_at: string | null
          veces_pausado: number | null
          workspace_id: string | null
        }
        Insert: {
          aliado_id?: string | null
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_motivo?: string | null
          cierre_no_facturable?: boolean | null
          cierre_no_facturable_at?: string | null
          cierre_no_facturable_motivo?: string | null
          cierre_no_facturable_nota?: string | null
          cierre_no_facturable_por?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string | null
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          is_paused?: boolean | null
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          metadata?: Json | null
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre?: string | null
          origen?: string | null
          pausado?: boolean | null
          pausado_hasta?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_reason?: string | null
          precio_aprobado?: number | null
          precio_estimado?: number | null
          razon_cierre?: string | null
          responsable_id?: string | null
          stage_actual?: string | null
          tipo_cierre?: string | null
          ultimo_pausado_at?: string | null
          updated_at?: string | null
          veces_pausado?: number | null
          workspace_id?: string | null
        }
        Update: {
          aliado_id?: string | null
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_motivo?: string | null
          cierre_no_facturable?: boolean | null
          cierre_no_facturable_at?: string | null
          cierre_no_facturable_motivo?: string | null
          cierre_no_facturable_nota?: string | null
          cierre_no_facturable_por?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string | null
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string | null
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          is_paused?: boolean | null
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          metadata?: Json | null
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre?: string | null
          origen?: string | null
          pausado?: boolean | null
          pausado_hasta?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_reason?: string | null
          precio_aprobado?: number | null
          precio_estimado?: number | null
          razon_cierre?: string | null
          responsable_id?: string | null
          stage_actual?: string | null
          tipo_cierre?: string | null
          ultimo_pausado_at?: string | null
          updated_at?: string | null
          veces_pausado?: number | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      backup_v0136_precobro_20260909: {
        Row: {
          etapa_o_estado: string | null
          fila: Json | null
          id: string | null
          origen: string | null
          respaldado_at: string | null
          slug: string | null
        }
        Insert: {
          etapa_o_estado?: string | null
          fila?: Json | null
          id?: string | null
          origen?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Update: {
          etapa_o_estado?: string | null
          fila?: Json | null
          id?: string | null
          origen?: string | null
          respaldado_at?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      backup_v0235_fecha_cita_20260914: {
        Row: {
          data: Json | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
        }
        Insert: {
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_v0374_anexos_20260914: {
        Row: {
          etapa_actual_id: string | null
          etapa_cambiada_at: string | null
          id: string | null
          respaldado_at: string | null
          stage_actual: string | null
          updated_at: string | null
        }
        Insert: {
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          respaldado_at?: string | null
          stage_actual?: string | null
          updated_at?: string | null
        }
        Update: {
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string | null
          respaldado_at?: string | null
          stage_actual?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_v0486_rut_20260918: {
        Row: {
          bloque_config_id: string | null
          data: Json | null
          id: string | null
          negocio_id: string | null
          respaldado_at: string | null
        }
        Insert: {
          bloque_config_id?: string | null
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Update: {
          bloque_config_id?: string | null
          data?: Json | null
          id?: string | null
          negocio_id?: string | null
          respaldado_at?: string | null
        }
        Relationships: []
      }
      backup_workspace_modules_20260903: {
        Row: {
          id: string | null
          modules: Json | null
          respaldado_at: string | null
        }
        Insert: {
          id?: string | null
          modules?: Json | null
          respaldado_at?: string | null
        }
        Update: {
          id?: string | null
          modules?: Json | null
          respaldado_at?: string | null
        }
        Relationships: []
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
          slug: string | null
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
          slug?: string | null
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
          slug?: string | null
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
            foreignKeyName: "bloque_configs_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "v_negocios_etapa_vencimiento"
            referencedColumns: ["etapa_id"]
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
      bloque_correcciones: {
        Row: {
          activity_log_id: string | null
          area: string | null
          bloque_nombre: string | null
          bloque_slug: string | null
          campo_slug: string
          causa: string
          corregido_por: string | null
          corregido_por_nombre: string | null
          created_at: string
          etapa_id: string | null
          etapa_nombre: string | null
          etapa_orden: number | null
          id: string
          negocio_bloque_id: string
          negocio_id: string
          sesion_id: string
          updated_at: string
          valor_anterior: string | null
          valor_nuevo: string | null
          workspace_id: string
        }
        Insert: {
          activity_log_id?: string | null
          area?: string | null
          bloque_nombre?: string | null
          bloque_slug?: string | null
          campo_slug: string
          causa: string
          corregido_por?: string | null
          corregido_por_nombre?: string | null
          created_at?: string
          etapa_id?: string | null
          etapa_nombre?: string | null
          etapa_orden?: number | null
          id?: string
          negocio_bloque_id: string
          negocio_id: string
          sesion_id: string
          updated_at?: string
          valor_anterior?: string | null
          valor_nuevo?: string | null
          workspace_id: string
        }
        Update: {
          activity_log_id?: string | null
          area?: string | null
          bloque_nombre?: string | null
          bloque_slug?: string | null
          campo_slug?: string
          causa?: string
          corregido_por?: string | null
          corregido_por_nombre?: string | null
          created_at?: string
          etapa_id?: string | null
          etapa_nombre?: string | null
          etapa_orden?: number | null
          id?: string
          negocio_bloque_id?: string
          negocio_id?: string
          sesion_id?: string
          updated_at?: string
          valor_anterior?: string | null
          valor_nuevo?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloque_correcciones_negocio_bloque_id_fkey"
            columns: ["negocio_bloque_id"]
            isOneToOne: false
            referencedRelation: "negocio_bloques"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "bloque_correcciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "bloque_correcciones_workspace_id_fkey"
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
          fecha_fin_real: string | null
          fecha_inicio: string | null
          fecha_inicio_real: string | null
          id: string
          imagen_data: string | null
          label: string
          link_url: string | null
          negocio_bloque_id: string
          orden: number
          responsable_id: string | null
          responsable_texto: string | null
          tipo: string
        }
        Insert: {
          completado?: boolean
          completado_at?: string | null
          completado_por?: string | null
          contenido?: Json
          created_at?: string
          fecha_fin?: string | null
          fecha_fin_real?: string | null
          fecha_inicio?: string | null
          fecha_inicio_real?: string | null
          id?: string
          imagen_data?: string | null
          label: string
          link_url?: string | null
          negocio_bloque_id: string
          orden?: number
          responsable_id?: string | null
          responsable_texto?: string | null
          tipo?: string
        }
        Update: {
          completado?: boolean
          completado_at?: string | null
          completado_por?: string | null
          contenido?: Json
          created_at?: string
          fecha_fin?: string | null
          fecha_fin_real?: string | null
          fecha_inicio?: string | null
          fecha_inicio_real?: string | null
          id?: string
          imagen_data?: string | null
          label?: string
          link_url?: string | null
          negocio_bloque_id?: string
          orden?: number
          responsable_id?: string | null
          responsable_texto?: string | null
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
      bloque_locks: {
        Row: {
          bloque_instancia_id: string
          expires_at: string
          locked_at: string
          locked_by: string
          workspace_id: string
        }
        Insert: {
          bloque_instancia_id: string
          expires_at: string
          locked_at?: string
          locked_by: string
          workspace_id: string
        }
        Update: {
          bloque_instancia_id?: string
          expires_at?: string
          locked_at?: string
          locked_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloque_locks_bloque_instancia_id_fkey"
            columns: ["bloque_instancia_id"]
            isOneToOne: true
            referencedRelation: "negocio_bloques"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloque_locks_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloque_locks_workspace_id_fkey"
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
      calidad_cobertura_dia: {
        Row: {
          auditadas: number
          baseline_manual: number
          created_at: string
          fecha: string
          id: string
          recibidas: number
          workspace_id: string
        }
        Insert: {
          auditadas?: number
          baseline_manual?: number
          created_at?: string
          fecha: string
          id?: string
          recibidas?: number
          workspace_id: string
        }
        Update: {
          auditadas?: number
          baseline_manual?: number
          created_at?: string
          fecha?: string
          id?: string
          recibidas?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_cobertura_dia_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calidad_dinero_cuotas: {
        Row: {
          created_at: string
          cuota: number
          id: string
          recaudado_usd: number
          vendido_usd: number
          ventas: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          cuota: number
          id?: string
          recaudado_usd?: number
          vendido_usd?: number
          ventas?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          cuota?: number
          id?: string
          recaudado_usd?: number
          vendido_usd?: number
          ventas?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_dinero_cuotas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calidad_llamadas: {
        Row: {
          agente_nombre: string
          agente_staff_id: string | null
          cerro_venta: boolean
          cliente_ref: string
          created_at: string
          detalle_completo: boolean
          direccion: string
          duracion_seg: number
          es_real: boolean
          fecha_grabacion: string | null
          fecha_hora: string
          forma_pago: string | null
          habla_agente_pct: number | null
          habla_cliente_pct: number | null
          id: string
          lote: string | null
          monologos_45s: number | null
          monto_usd: number | null
          puntaje_tecnico: number
          repreguntas: number | null
          semaforo: string
          turnos: number | null
          workspace_id: string
        }
        Insert: {
          agente_nombre: string
          agente_staff_id?: string | null
          cerro_venta?: boolean
          cliente_ref: string
          created_at?: string
          detalle_completo?: boolean
          direccion?: string
          duracion_seg: number
          es_real?: boolean
          fecha_grabacion?: string | null
          fecha_hora: string
          forma_pago?: string | null
          habla_agente_pct?: number | null
          habla_cliente_pct?: number | null
          id?: string
          lote?: string | null
          monologos_45s?: number | null
          monto_usd?: number | null
          puntaje_tecnico: number
          repreguntas?: number | null
          semaforo: string
          turnos?: number | null
          workspace_id: string
        }
        Update: {
          agente_nombre?: string
          agente_staff_id?: string | null
          cerro_venta?: boolean
          cliente_ref?: string
          created_at?: string
          detalle_completo?: boolean
          direccion?: string
          duracion_seg?: number
          es_real?: boolean
          fecha_grabacion?: string | null
          fecha_hora?: string
          forma_pago?: string | null
          habla_agente_pct?: number | null
          habla_cliente_pct?: number | null
          id?: string
          lote?: string | null
          monologos_45s?: number | null
          monto_usd?: number | null
          puntaje_tecnico?: number
          repreguntas?: number | null
          semaforo?: string
          turnos?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_llamadas_agente_staff_id_fkey"
            columns: ["agente_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calidad_llamadas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calidad_llamadas_bloques: {
        Row: {
          created_at: string
          id: string
          llamada_id: string
          nombre: string
          orden: number
          puntaje: number
          puntaje_max: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          llamada_id: string
          nombre: string
          orden: number
          puntaje: number
          puntaje_max: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          llamada_id?: string
          nombre?: string
          orden?: number
          puntaje?: number
          puntaje_max?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_llamadas_bloques_llamada_id_fkey"
            columns: ["llamada_id"]
            isOneToOne: false
            referencedRelation: "calidad_llamadas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calidad_llamadas_bloques_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calidad_llamadas_hallazgos: {
        Row: {
          cita: string | null
          codigo: string | null
          created_at: string
          eje: string
          hecho: string | null
          id: string
          llamada_id: string
          segundo: number
          severidad: string | null
          titulo: string
          turno_ref: string | null
          workspace_id: string
        }
        Insert: {
          cita?: string | null
          codigo?: string | null
          created_at?: string
          eje?: string
          hecho?: string | null
          id?: string
          llamada_id: string
          segundo: number
          severidad?: string | null
          titulo: string
          turno_ref?: string | null
          workspace_id: string
        }
        Update: {
          cita?: string | null
          codigo?: string | null
          created_at?: string
          eje?: string
          hecho?: string | null
          id?: string
          llamada_id?: string
          segundo?: number
          severidad?: string | null
          titulo?: string
          turno_ref?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_llamadas_hallazgos_llamada_id_fkey"
            columns: ["llamada_id"]
            isOneToOne: false
            referencedRelation: "calidad_llamadas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calidad_llamadas_hallazgos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calidad_recobro_dia: {
        Row: {
          created_at: string
          debitos_rebotados: number
          fecha: string
          id: string
          monto_en_riesgo_usd: number
          pendientes_recobro: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          debitos_rebotados?: number
          fecha: string
          id?: string
          monto_en_riesgo_usd?: number
          pendientes_recobro?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          debitos_rebotados?: number
          fecha?: string
          id?: string
          monto_en_riesgo_usd?: number
          pendientes_recobro?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_recobro_dia_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campana_insights: {
        Row: {
          account_id: string | null
          campaign_id: string
          campaign_name: string | null
          clicks: number | null
          created_at: string
          currency: string | null
          id: string
          impressions: number | null
          mes: string
          sincronizado_at: string
          spend: number
          status: string | null
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          campaign_id: string
          campaign_name?: string | null
          clicks?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          impressions?: number | null
          mes: string
          sincronizado_at?: string
          spend?: number
          status?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          impressions?: number | null
          mes?: string
          sincronizado_at?: string
          spend?: number
          status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campana_insights_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cardumen_chat_sessions: {
        Row: {
          closed: boolean
          created_at: string
          phone: string
          reminded_at: string | null
          state: Json
          updated_at: string
        }
        Insert: {
          closed?: boolean
          created_at?: string
          phone: string
          reminded_at?: string | null
          state?: Json
          updated_at?: string
        }
        Update: {
          closed?: boolean
          created_at?: string
          phone?: string
          reminded_at?: string | null
          state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      cardumen_estudio_triggers: {
        Row: {
          created_at: string
          estudio: string
          palabra: string
        }
        Insert: {
          created_at?: string
          estudio: string
          palabra: string
        }
        Update: {
          created_at?: string
          estudio?: string
          palabra?: string
        }
        Relationships: [
          {
            foreignKeyName: "cardumen_estudio_triggers_estudio_fkey"
            columns: ["estudio"]
            isOneToOne: false
            referencedRelation: "cardumen_estudios"
            referencedColumns: ["estudio"]
          },
        ]
      }
      cardumen_estudios: {
        Row: {
          activo: boolean
          claves_publicas: string[]
          created_at: string
          encuadre: Json | null
          estudio: string
          modo: string | null
          nombre: string | null
          nota: string | null
          publicable: boolean
          spec: Json | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          claves_publicas?: string[]
          created_at?: string
          encuadre?: Json | null
          estudio: string
          modo?: string | null
          nombre?: string | null
          nota?: string | null
          publicable?: boolean
          spec?: Json | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          claves_publicas?: string[]
          created_at?: string
          encuadre?: Json | null
          estudio?: string
          modo?: string | null
          nombre?: string | null
          nota?: string | null
          publicable?: boolean
          spec?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      cardumen_respuestas: {
        Row: {
          created_at: string
          estudio: string
          id: string
          lang: string | null
          payload: Json
          token: string | null
        }
        Insert: {
          created_at?: string
          estudio?: string
          id?: string
          lang?: string | null
          payload: Json
          token?: string | null
        }
        Update: {
          created_at?: string
          estudio?: string
          id?: string
          lang?: string | null
          payload?: Json
          token?: string | null
        }
        Relationships: []
      }
      catalogo_servicios: {
        Row: {
          activo: boolean
          disparador_cobro: string
          modulo: string
          nombre: string
          slug: string
          updated_at: string
          version_vigente: number
        }
        Insert: {
          activo?: boolean
          disparador_cobro: string
          modulo: string
          nombre: string
          slug: string
          updated_at?: string
          version_vigente: number
        }
        Update: {
          activo?: boolean
          disparador_cobro?: string
          modulo?: string
          nombre?: string
          slug?: string
          updated_at?: string
          version_vigente?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_servicios_version_vigente_fk"
            columns: ["slug", "version_vigente"]
            isOneToOne: false
            referencedRelation: "catalogo_servicios_versiones"
            referencedColumns: ["slug", "version"]
          },
        ]
      }
      catalogo_servicios_versiones: {
        Row: {
          definicion: Json
          fuente_ruta: string
          fuente_sha256: string
          recibida_at: string
          slug: string
          version: number
        }
        Insert: {
          definicion: Json
          fuente_ruta: string
          fuente_sha256: string
          recibida_at?: string
          slug: string
          version: number
        }
        Update: {
          definicion?: Json
          fuente_ruta?: string
          fuente_sha256?: string
          recibida_at?: string
          slug?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_servicios_versiones_slug_fkey"
            columns: ["slug"]
            isOneToOne: false
            referencedRelation: "catalogo_servicios"
            referencedColumns: ["slug"]
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
      cert_documentos: {
        Row: {
          cert_lote_id: string
          created_at: string
          id: string
          mime_type: string | null
          nombre: string | null
          public_url: string | null
          storage_path: string
          tipo: string
          workspace_id: string
        }
        Insert: {
          cert_lote_id: string
          created_at?: string
          id?: string
          mime_type?: string | null
          nombre?: string | null
          public_url?: string | null
          storage_path: string
          tipo: string
          workspace_id: string
        }
        Update: {
          cert_lote_id?: string
          created_at?: string
          id?: string
          mime_type?: string | null
          nombre?: string | null
          public_url?: string | null
          storage_path?: string
          tipo?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cert_documentos_cert_lote_id_fkey"
            columns: ["cert_lote_id"]
            isOneToOne: false
            referencedRelation: "cert_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cert_documentos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cert_lotes: {
        Row: {
          cert_producto_id: string | null
          certificado_para: string | null
          certificado_por: string | null
          created_at: string
          created_by: string | null
          cumple: boolean
          enviado_aprobacion_at: string | null
          estado: string
          fecha_certificacion: string | null
          fecha_vencimiento: string | null
          id: string
          material_calibre: string | null
          material_norma: string | null
          material_perfil: string | null
          negocio_id: string
          numero_contrato: string | null
          numero_lote: string
          opcion_material: string | null
          orientacion_instalacion: string | null
          publicado_at: string | null
          publicado_por: string | null
          ratio_critico: number | null
          ratio_descripcion: string | null
          serie_desde: number | null
          serie_hasta: number | null
          short_code: string | null
          sku: string
          ubicacion: string | null
          updated_at: string
          vigencia_meses: number
          workspace_id: string
        }
        Insert: {
          cert_producto_id?: string | null
          certificado_para?: string | null
          certificado_por?: string | null
          created_at?: string
          created_by?: string | null
          cumple?: boolean
          enviado_aprobacion_at?: string | null
          estado?: string
          fecha_certificacion?: string | null
          fecha_vencimiento?: string | null
          id?: string
          material_calibre?: string | null
          material_norma?: string | null
          material_perfil?: string | null
          negocio_id: string
          numero_contrato?: string | null
          numero_lote: string
          opcion_material?: string | null
          orientacion_instalacion?: string | null
          publicado_at?: string | null
          publicado_por?: string | null
          ratio_critico?: number | null
          ratio_descripcion?: string | null
          serie_desde?: number | null
          serie_hasta?: number | null
          short_code?: string | null
          sku: string
          ubicacion?: string | null
          updated_at?: string
          vigencia_meses?: number
          workspace_id: string
        }
        Update: {
          cert_producto_id?: string | null
          certificado_para?: string | null
          certificado_por?: string | null
          created_at?: string
          created_by?: string | null
          cumple?: boolean
          enviado_aprobacion_at?: string | null
          estado?: string
          fecha_certificacion?: string | null
          fecha_vencimiento?: string | null
          id?: string
          material_calibre?: string | null
          material_norma?: string | null
          material_perfil?: string | null
          negocio_id?: string
          numero_contrato?: string | null
          numero_lote?: string
          opcion_material?: string | null
          orientacion_instalacion?: string | null
          publicado_at?: string | null
          publicado_por?: string | null
          ratio_critico?: number | null
          ratio_descripcion?: string | null
          serie_desde?: number | null
          serie_hasta?: number | null
          short_code?: string | null
          sku?: string
          ubicacion?: string | null
          updated_at?: string
          vigencia_meses?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cert_lotes_cert_producto_id_fkey"
            columns: ["cert_producto_id"]
            isOneToOne: false
            referencedRelation: "cert_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cert_lotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cert_lotes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cert_lotes_publicado_por_fkey"
            columns: ["publicado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cert_lotes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cert_productos: {
        Row: {
          altura_mm: number | null
          carga_lb: number | null
          carga_n: number | null
          created_at: string
          criterio: string | null
          databook_nombre: string | null
          databook_path: string | null
          factor_seguridad: number | null
          ficha: Json | null
          id: string
          nombre: string | null
          norma: string
          producto_tipo: string | null
          rango_max_mm: number | null
          rango_min_mm: number | null
          serie: string | null
          sku: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          altura_mm?: number | null
          carga_lb?: number | null
          carga_n?: number | null
          created_at?: string
          criterio?: string | null
          databook_nombre?: string | null
          databook_path?: string | null
          factor_seguridad?: number | null
          ficha?: Json | null
          id?: string
          nombre?: string | null
          norma?: string
          producto_tipo?: string | null
          rango_max_mm?: number | null
          rango_min_mm?: number | null
          serie?: string | null
          sku: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          altura_mm?: number | null
          carga_lb?: number | null
          carga_n?: number | null
          created_at?: string
          criterio?: string | null
          databook_nombre?: string | null
          databook_path?: string | null
          factor_seguridad?: number | null
          ficha?: Json | null
          id?: string
          nombre?: string | null
          norma?: string
          producto_tipo?: string | null
          rango_max_mm?: number | null
          rango_min_mm?: number | null
          serie?: string | null
          sku?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cert_productos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cert_recertificaciones: {
        Row: {
          cert_lote_id: string
          certificado_por: string | null
          created_at: string
          created_by: string | null
          fecha_certificacion: string
          fecha_vencimiento: string
          id: string
          notas: string | null
          ratio_critico: number | null
          workspace_id: string
        }
        Insert: {
          cert_lote_id: string
          certificado_por?: string | null
          created_at?: string
          created_by?: string | null
          fecha_certificacion: string
          fecha_vencimiento: string
          id?: string
          notas?: string | null
          ratio_critico?: number | null
          workspace_id: string
        }
        Update: {
          cert_lote_id?: string
          certificado_por?: string | null
          created_at?: string
          created_by?: string | null
          fecha_certificacion?: string
          fecha_vencimiento?: string
          id?: string
          notas?: string | null
          ratio_critico?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cert_recertificaciones_cert_lote_id_fkey"
            columns: ["cert_lote_id"]
            isOneToOne: false
            referencedRelation: "cert_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cert_recertificaciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cert_recertificaciones_workspace_id_fkey"
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
      cobros: {
        Row: {
          anulacion_motivo: string | null
          anulado_at: string | null
          anulado_por: string | null
          canal_registro: string | null
          created_at: string | null
          created_by: string | null
          created_by_wa_name: string | null
          external_ref: string | null
          factura_id: string | null
          fecha: string | null
          fecha_esperada: string | null
          fuente: string | null
          id: string
          mensaje_original: string | null
          monto: number
          monto_anulado: number | null
          negocio_id: string | null
          notas: string | null
          numero_cuota: number | null
          plan_cobro_id: string | null
          proyecto_id: string | null
          recibo_no_aplica: Json | null
          retencion: number | null
          revisado: boolean
          revisado_at: string | null
          revisado_por: string | null
          siigo_recibo: Json | null
          soporte: Json | null
          split_json: Json | null
          tercero_nit: string | null
          tipo_cobro: string | null
          vencido: boolean
          vencido_at: string | null
          workspace_id: string
        }
        Insert: {
          anulacion_motivo?: string | null
          anulado_at?: string | null
          anulado_por?: string | null
          canal_registro?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          external_ref?: string | null
          factura_id?: string | null
          fecha?: string | null
          fecha_esperada?: string | null
          fuente?: string | null
          id?: string
          mensaje_original?: string | null
          monto: number
          monto_anulado?: number | null
          negocio_id?: string | null
          notas?: string | null
          numero_cuota?: number | null
          plan_cobro_id?: string | null
          proyecto_id?: string | null
          recibo_no_aplica?: Json | null
          retencion?: number | null
          revisado?: boolean
          revisado_at?: string | null
          revisado_por?: string | null
          siigo_recibo?: Json | null
          soporte?: Json | null
          split_json?: Json | null
          tercero_nit?: string | null
          tipo_cobro?: string | null
          vencido?: boolean
          vencido_at?: string | null
          workspace_id: string
        }
        Update: {
          anulacion_motivo?: string | null
          anulado_at?: string | null
          anulado_por?: string | null
          canal_registro?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_wa_name?: string | null
          external_ref?: string | null
          factura_id?: string | null
          fecha?: string | null
          fecha_esperada?: string | null
          fuente?: string | null
          id?: string
          mensaje_original?: string | null
          monto?: number
          monto_anulado?: number | null
          negocio_id?: string | null
          notas?: string | null
          numero_cuota?: number | null
          plan_cobro_id?: string | null
          proyecto_id?: string | null
          recibo_no_aplica?: Json | null
          retencion?: number | null
          revisado?: boolean
          revisado_at?: string | null
          revisado_por?: string | null
          siigo_recibo?: Json | null
          soporte?: Json | null
          split_json?: Json | null
          tercero_nit?: string | null
          tipo_cobro?: string | null
          vencido?: boolean
          vencido_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobros_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_plan_cobro_id_fkey"
            columns: ["plan_cobro_id"]
            isOneToOne: false
            referencedRelation: "planes_cobro"
            referencedColumns: ["id"]
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
      compliance_aceptaciones: {
        Row: {
          aceptada_por: string | null
          cargo_id: string
          controles_snapshot: Json
          created_at: string
          fecha_aceptacion: string
          id: string
          medio: string
          persona_documento: string
          persona_nombre: string
          registrada_por: string | null
          soporte_path: string | null
          workspace_id: string
        }
        Insert: {
          aceptada_por?: string | null
          cargo_id: string
          controles_snapshot: Json
          created_at?: string
          fecha_aceptacion?: string
          id?: string
          medio: string
          persona_documento: string
          persona_nombre: string
          registrada_por?: string | null
          soporte_path?: string | null
          workspace_id: string
        }
        Update: {
          aceptada_por?: string | null
          cargo_id?: string
          controles_snapshot?: Json
          created_at?: string
          fecha_aceptacion?: string
          id?: string
          medio?: string
          persona_documento?: string
          persona_nombre?: string
          registrada_por?: string | null
          soporte_path?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_aceptaciones_aceptada_por_fkey"
            columns: ["aceptada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_aceptaciones_cargo_id_fkey"
            columns: ["cargo_id"]
            isOneToOne: false
            referencedRelation: "compliance_cargos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_aceptaciones_registrada_por_fkey"
            columns: ["registrada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_aceptaciones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_barrido_items: {
        Row: {
          barrido_id: string
          consulta_anterior_id: string | null
          consulta_nueva_id: string | null
          created_at: string
          delta: boolean
          diferida: boolean
          documento_numero: string | null
          documento_tipo: string | null
          error_mensaje: string | null
          etiqueta: string
          fuentes_nuevas: string[] | null
          habilita_reevaluacion: boolean
          id: string
          matches_ahora: number | null
          matches_antes: number | null
          motivo: string
          nombre: string | null
          notificada: boolean
          workspace_id: string
        }
        Insert: {
          barrido_id: string
          consulta_anterior_id?: string | null
          consulta_nueva_id?: string | null
          created_at?: string
          delta?: boolean
          diferida?: boolean
          documento_numero?: string | null
          documento_tipo?: string | null
          error_mensaje?: string | null
          etiqueta: string
          fuentes_nuevas?: string[] | null
          habilita_reevaluacion?: boolean
          id?: string
          matches_ahora?: number | null
          matches_antes?: number | null
          motivo: string
          nombre?: string | null
          notificada?: boolean
          workspace_id: string
        }
        Update: {
          barrido_id?: string
          consulta_anterior_id?: string | null
          consulta_nueva_id?: string | null
          created_at?: string
          delta?: boolean
          diferida?: boolean
          documento_numero?: string | null
          documento_tipo?: string | null
          error_mensaje?: string | null
          etiqueta?: string
          fuentes_nuevas?: string[] | null
          habilita_reevaluacion?: boolean
          id?: string
          matches_ahora?: number | null
          matches_antes?: number | null
          motivo?: string
          nombre?: string | null
          notificada?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_barrido_items_barrido_id_fkey"
            columns: ["barrido_id"]
            isOneToOne: false
            referencedRelation: "compliance_barridos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_barrido_items_consulta_anterior_id_fkey"
            columns: ["consulta_anterior_id"]
            isOneToOne: false
            referencedRelation: "consultas_listas_dual"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_barrido_items_consulta_nueva_id_fkey"
            columns: ["consulta_nueva_id"]
            isOneToOne: false
            referencedRelation: "consultas_listas_dual"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_barrido_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_barridos: {
        Row: {
          candidatos: number
          con_delta: number
          consumidas_periodo_antes: number
          corte_por_tope: boolean
          created_at: string
          cupo_periodo: number | null
          dia: string
          diferidas: number
          ejecutadas: number
          error_mensaje: string | null
          fallidas: number
          id: string
          modo: string
          notificadas: number
          workspace_id: string
        }
        Insert: {
          candidatos?: number
          con_delta?: number
          consumidas_periodo_antes?: number
          corte_por_tope?: boolean
          created_at?: string
          cupo_periodo?: number | null
          dia: string
          diferidas?: number
          ejecutadas?: number
          error_mensaje?: string | null
          fallidas?: number
          id?: string
          modo: string
          notificadas?: number
          workspace_id: string
        }
        Update: {
          candidatos?: number
          con_delta?: number
          consumidas_periodo_antes?: number
          corte_por_tope?: boolean
          created_at?: string
          cupo_periodo?: number | null
          dia?: string
          diferidas?: number
          ejecutadas?: number
          error_mensaje?: string | null
          fallidas?: number
          id?: string
          modo?: string
          notificadas?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_barridos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_cargos: {
        Row: {
          activo: boolean
          created_at: string
          id: string
          nombre: string
          orden: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          id?: string
          nombre: string
          orden?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          id?: string
          nombre?: string
          orden?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_cargos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_documento_versiones: {
        Row: {
          aprobacion_referencia: string | null
          aprobado_por: string | null
          cargado_por: string | null
          created_at: string
          documento_id: string
          drive_file_id: string | null
          fecha_aprobacion: string | null
          hash_sha256: string | null
          id: string
          notas: string | null
          url: string
          url_estado: string | null
          url_verificada_at: string | null
          version: string
          vigente_desde: string
          vigente_hasta: string | null
          workspace_id: string
        }
        Insert: {
          aprobacion_referencia?: string | null
          aprobado_por?: string | null
          cargado_por?: string | null
          created_at?: string
          documento_id: string
          drive_file_id?: string | null
          fecha_aprobacion?: string | null
          hash_sha256?: string | null
          id?: string
          notas?: string | null
          url: string
          url_estado?: string | null
          url_verificada_at?: string | null
          version: string
          vigente_desde: string
          vigente_hasta?: string | null
          workspace_id: string
        }
        Update: {
          aprobacion_referencia?: string | null
          aprobado_por?: string | null
          cargado_por?: string | null
          created_at?: string
          documento_id?: string
          drive_file_id?: string | null
          fecha_aprobacion?: string | null
          hash_sha256?: string | null
          id?: string
          notas?: string | null
          url?: string
          url_estado?: string | null
          url_verificada_at?: string | null
          version?: string
          vigente_desde?: string
          vigente_hasta?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_documento_versiones_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "compliance_documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_documento_versiones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_documentos: {
        Row: {
          activo: boolean
          codigo: string
          created_at: string
          descripcion: string | null
          id: string
          nombre: string
          obligatorio: boolean
          periodicidad_meses: number | null
          responsable_cargo_id: string | null
          tipo: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activo?: boolean
          codigo: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre: string
          obligatorio?: boolean
          periodicidad_meses?: number | null
          responsable_cargo_id?: string | null
          tipo: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activo?: boolean
          codigo?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre?: string
          obligatorio?: boolean
          periodicidad_meses?: number | null
          responsable_cargo_id?: string | null
          tipo?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_documentos_responsable_cargo_id_fkey"
            columns: ["responsable_cargo_id"]
            isOneToOne: false
            referencedRelation: "compliance_cargos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_documentos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_liberaciones: {
        Row: {
          consulta_id: string
          control_id: string | null
          created_at: string
          decision: string
          documento_numero: string
          documento_tipo: string
          id: string
          justificacion: string
          liberada_por: string | null
          nombre: string | null
          seguimiento: boolean
          vigente_desde: string
          vigente_hasta: string | null
          workspace_id: string
        }
        Insert: {
          consulta_id: string
          control_id?: string | null
          created_at?: string
          decision: string
          documento_numero: string
          documento_tipo: string
          id?: string
          justificacion: string
          liberada_por?: string | null
          nombre?: string | null
          seguimiento?: boolean
          vigente_desde?: string
          vigente_hasta?: string | null
          workspace_id: string
        }
        Update: {
          consulta_id?: string
          control_id?: string | null
          created_at?: string
          decision?: string
          documento_numero?: string
          documento_tipo?: string
          id?: string
          justificacion?: string
          liberada_por?: string | null
          nombre?: string | null
          seguimiento?: boolean
          vigente_desde?: string
          vigente_hasta?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_liberaciones_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas_listas_dual"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_liberaciones_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "riesgos_controles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_liberaciones_liberada_por_fkey"
            columns: ["liberada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_liberaciones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_monitoreo_config: {
        Row: {
          adoptado_at: string | null
          adoptado_por: string | null
          created_at: string
          cupo_periodo: number | null
          horizonte_rechazadas_meses: number
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          adoptado_at?: string | null
          adoptado_por?: string | null
          created_at?: string
          cupo_periodo?: number | null
          horizonte_rechazadas_meses?: number
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          adoptado_at?: string | null
          adoptado_por?: string | null
          created_at?: string
          cupo_periodo?: number | null
          horizonte_rechazadas_meses?: number
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_monitoreo_config_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_periodicidad_config: {
        Row: {
          actualizado_por: string | null
          created_at: string
          id: string
          meses: number
          nivel: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actualizado_por?: string | null
          created_at?: string
          id?: string
          meses: number
          nivel: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actualizado_por?: string | null
          created_at?: string
          id?: string
          meses?: number
          nivel?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_periodicidad_config_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_segmentos: {
        Row: {
          activo: boolean
          created_at: string
          id: string
          nombre: string
          orden: number
          universo: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          id?: string
          nombre: string
          orden?: number
          universo: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          id?: string
          nombre?: string
          orden?: number
          universo?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_segmentos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_sujeto_eventos: {
        Row: {
          actor: string | null
          created_at: string
          detalle: string | null
          evento: string
          id: string
          motivo: string | null
          sujeto_id: string
          workspace_id: string
        }
        Insert: {
          actor?: string | null
          created_at?: string
          detalle?: string | null
          evento: string
          id?: string
          motivo?: string | null
          sujeto_id: string
          workspace_id: string
        }
        Update: {
          actor?: string | null
          created_at?: string
          detalle?: string | null
          evento?: string
          id?: string
          motivo?: string | null
          sujeto_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_sujeto_eventos_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_sujeto_eventos_sujeto_id_fkey"
            columns: ["sujeto_id"]
            isOneToOne: false
            referencedRelation: "compliance_sujetos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_sujeto_eventos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_sujetos: {
        Row: {
          cerrado_at: string | null
          cerrado_por: string | null
          correo: string | null
          created_at: string
          created_by: string | null
          documento_numero: string
          documento_tipo: string
          id: string
          motivo_cierre: string | null
          nombre: string
          notas: string | null
          relacion_desde: string
          relacion_hasta: string | null
          responsable_profile_id: string | null
          segmento_id: string | null
          staff_id: string | null
          tipo: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cerrado_at?: string | null
          cerrado_por?: string | null
          correo?: string | null
          created_at?: string
          created_by?: string | null
          documento_numero: string
          documento_tipo: string
          id?: string
          motivo_cierre?: string | null
          nombre: string
          notas?: string | null
          relacion_desde?: string
          relacion_hasta?: string | null
          responsable_profile_id?: string | null
          segmento_id?: string | null
          staff_id?: string | null
          tipo: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cerrado_at?: string | null
          cerrado_por?: string | null
          correo?: string | null
          created_at?: string
          created_by?: string | null
          documento_numero?: string
          documento_tipo?: string
          id?: string
          motivo_cierre?: string | null
          nombre?: string
          notas?: string | null
          relacion_desde?: string
          relacion_hasta?: string | null
          responsable_profile_id?: string | null
          segmento_id?: string | null
          staff_id?: string | null
          tipo?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_sujetos_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_sujetos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_sujetos_responsable_profile_id_fkey"
            columns: ["responsable_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_sujetos_segmento_id_fkey"
            columns: ["segmento_id"]
            isOneToOne: false
            referencedRelation: "compliance_segmentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_sujetos_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_sujetos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_tier_catalogo_versiones: {
        Row: {
          created_at: string
          extraccion_metodo: string
          firmada_legal_at: string | null
          firmada_legal_by: string | null
          fuente_dictamen: string
          huella_revision_legal_jsonb: Json | null
          razon_cambio: string
          retirada_at: string | null
          status: string
          validada_tecnica_at: string | null
          validada_tecnica_by: string | null
          validada_tecnica_nota: string | null
          version: number
        }
        Insert: {
          created_at?: string
          extraccion_metodo?: string
          firmada_legal_at?: string | null
          firmada_legal_by?: string | null
          fuente_dictamen: string
          huella_revision_legal_jsonb?: Json | null
          razon_cambio: string
          retirada_at?: string | null
          status: string
          validada_tecnica_at?: string | null
          validada_tecnica_by?: string | null
          validada_tecnica_nota?: string | null
          version: number
        }
        Update: {
          created_at?: string
          extraccion_metodo?: string
          firmada_legal_at?: string | null
          firmada_legal_by?: string | null
          fuente_dictamen?: string
          huella_revision_legal_jsonb?: Json | null
          razon_cambio?: string
          retirada_at?: string | null
          status?: string
          validada_tecnica_at?: string | null
          validada_tecnica_by?: string | null
          validada_tecnica_nota?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "compliance_tier_catalogo_versiones_firmada_legal_by_fkey"
            columns: ["firmada_legal_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_tier_fuentes: {
        Row: {
          catalogo_version: number
          created_at: string
          etiqueta: string
          familia: string
          grupo_dedup: string | null
          id: string
          lista_referencia: string | null
          llave: string
          llave_tipo: string
          provisional: boolean
          sustento: string
          tier: string
        }
        Insert: {
          catalogo_version: number
          created_at?: string
          etiqueta: string
          familia: string
          grupo_dedup?: string | null
          id?: string
          lista_referencia?: string | null
          llave: string
          llave_tipo: string
          provisional?: boolean
          sustento: string
          tier: string
        }
        Update: {
          catalogo_version?: number
          created_at?: string
          etiqueta?: string
          familia?: string
          grupo_dedup?: string | null
          id?: string
          lista_referencia?: string | null
          llave?: string
          llave_tipo?: string
          provisional?: boolean
          sustento?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_tier_fuentes_catalogo_version_fkey"
            columns: ["catalogo_version"]
            isOneToOne: false
            referencedRelation: "compliance_tier_catalogo_versiones"
            referencedColumns: ["version"]
          },
        ]
      }
      config_bono_operaciones: {
        Row: {
          bono_max_pct: number
          bono_max_pct_director: number
          calidad_base: number
          calidad_frac_un_malo: number
          calidad_malos_pierde_todo: number
          calidad_tramo: number
          correcciones_cobertura: string
          etapa_radicacion_dian_orden: number
          horas_antes_cita: number
          horas_desde_certificado: number
          horas_radicacion: number
          jornada_fin_hora: number
          jornada_inicio_hora: number
          jornada_sabado_habil: boolean
          peso_correcciones: number
          peso_envio: number
          peso_radicacion: number
          piso_director: number
          piso_operativo: number
          radicacion_reloj: string
          techo_director: number
          techo_operativo: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bono_max_pct?: number
          bono_max_pct_director?: number
          calidad_base?: number
          calidad_frac_un_malo?: number
          calidad_malos_pierde_todo?: number
          calidad_tramo?: number
          correcciones_cobertura?: string
          etapa_radicacion_dian_orden?: number
          horas_antes_cita?: number
          horas_desde_certificado?: number
          horas_radicacion?: number
          jornada_fin_hora?: number
          jornada_inicio_hora?: number
          jornada_sabado_habil?: boolean
          peso_correcciones?: number
          peso_envio?: number
          peso_radicacion?: number
          piso_director?: number
          piso_operativo?: number
          radicacion_reloj?: string
          techo_director?: number
          techo_operativo?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          bono_max_pct?: number
          bono_max_pct_director?: number
          calidad_base?: number
          calidad_frac_un_malo?: number
          calidad_malos_pierde_todo?: number
          calidad_tramo?: number
          correcciones_cobertura?: string
          etapa_radicacion_dian_orden?: number
          horas_antes_cita?: number
          horas_desde_certificado?: number
          horas_radicacion?: number
          jornada_fin_hora?: number
          jornada_inicio_hora?: number
          jornada_sabado_habil?: boolean
          peso_correcciones?: number
          peso_envio?: number
          peso_radicacion?: number
          piso_director?: number
          piso_operativo?: number
          radicacion_reloj?: string
          techo_director?: number
          techo_operativo?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_bono_operaciones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      config_bono_operaciones_mes: {
        Row: {
          actualizado_por: string | null
          anio: number
          bono_max_pct: number
          bono_max_pct_director: number
          calidad_base: number
          calidad_frac_un_malo: number
          calidad_malos_pierde_todo: number
          calidad_tramo: number
          correcciones_cobertura: string
          created_at: string
          etapa_radicacion_dian_orden: number
          horas_antes_cita: number
          horas_desde_certificado: number
          horas_radicacion: number
          jornada_fin_hora: number
          jornada_inicio_hora: number
          jornada_sabado_habil: boolean
          mes: number
          peso_correcciones: number
          peso_envio: number
          peso_radicacion: number
          piso_director: number
          piso_operativo: number
          radicacion_reloj: string
          techo_director: number
          techo_operativo: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actualizado_por?: string | null
          anio: number
          bono_max_pct?: number
          bono_max_pct_director?: number
          calidad_base?: number
          calidad_frac_un_malo?: number
          calidad_malos_pierde_todo?: number
          calidad_tramo?: number
          correcciones_cobertura?: string
          created_at?: string
          etapa_radicacion_dian_orden?: number
          horas_antes_cita?: number
          horas_desde_certificado?: number
          horas_radicacion?: number
          jornada_fin_hora?: number
          jornada_inicio_hora?: number
          jornada_sabado_habil?: boolean
          mes: number
          peso_correcciones?: number
          peso_envio?: number
          peso_radicacion?: number
          piso_director?: number
          piso_operativo?: number
          radicacion_reloj?: string
          techo_director?: number
          techo_operativo?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actualizado_por?: string | null
          anio?: number
          bono_max_pct?: number
          bono_max_pct_director?: number
          calidad_base?: number
          calidad_frac_un_malo?: number
          calidad_malos_pierde_todo?: number
          calidad_tramo?: number
          correcciones_cobertura?: string
          created_at?: string
          etapa_radicacion_dian_orden?: number
          horas_antes_cita?: number
          horas_desde_certificado?: number
          horas_radicacion?: number
          jornada_fin_hora?: number
          jornada_inicio_hora?: number
          jornada_sabado_habil?: boolean
          mes?: number
          peso_correcciones?: number
          peso_envio?: number
          peso_radicacion?: number
          piso_director?: number
          piso_operativo?: number
          radicacion_reloj?: string
          techo_director?: number
          techo_operativo?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_bono_operaciones_mes_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "config_bono_operaciones_mes_workspace_id_fkey"
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
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
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
          meta_leads_calificados_mensual: number | null
          meta_leads_mensual: number | null
          meta_negocios_mensual: number | null
          meta_recaudo_mensual: number | null
          meta_ventas_mensual: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          mes: string
          meta_leads_calificados_mensual?: number | null
          meta_leads_mensual?: number | null
          meta_negocios_mensual?: number | null
          meta_recaudo_mensual?: number | null
          meta_ventas_mensual?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          mes?: string
          meta_leads_calificados_mensual?: number | null
          meta_leads_mensual?: number | null
          meta_negocios_mensual?: number | null
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
      consultas_listas_dual: {
        Row: {
          created_at: string
          created_by: string | null
          documento_numero: string | null
          documento_tipo: string | null
          dual_id: string | null
          error_mensaje: string | null
          id: string
          lote_id: string | null
          matches: Json | null
          nombre_consultado: string | null
          segmento_id: string | null
          severidad: string
          tier_catalogo_version: number | null
          tier_duplicados: number | null
          tier_fuentes_sin_clasificar: string[] | null
          tier_hallazgos: number | null
          tier_maximo: string | null
          tier_opera: boolean | null
          tier_sin_clasificar: boolean
          tipo: string
          tipo_persona: string
          titulo_lote: string | null
          total_matches: number
          vigencia_meses: number | null
          vigencia_nivel: string | null
          vigente_hasta: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          documento_numero?: string | null
          documento_tipo?: string | null
          dual_id?: string | null
          error_mensaje?: string | null
          id?: string
          lote_id?: string | null
          matches?: Json | null
          nombre_consultado?: string | null
          segmento_id?: string | null
          severidad: string
          tier_catalogo_version?: number | null
          tier_duplicados?: number | null
          tier_fuentes_sin_clasificar?: string[] | null
          tier_hallazgos?: number | null
          tier_maximo?: string | null
          tier_opera?: boolean | null
          tier_sin_clasificar?: boolean
          tipo: string
          tipo_persona: string
          titulo_lote?: string | null
          total_matches?: number
          vigencia_meses?: number | null
          vigencia_nivel?: string | null
          vigente_hasta?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          documento_numero?: string | null
          documento_tipo?: string | null
          dual_id?: string | null
          error_mensaje?: string | null
          id?: string
          lote_id?: string | null
          matches?: Json | null
          nombre_consultado?: string | null
          segmento_id?: string | null
          severidad?: string
          tier_catalogo_version?: number | null
          tier_duplicados?: number | null
          tier_fuentes_sin_clasificar?: string[] | null
          tier_hallazgos?: number | null
          tier_maximo?: string | null
          tier_opera?: boolean | null
          tier_sin_clasificar?: boolean
          tipo?: string
          tipo_persona?: string
          titulo_lote?: string | null
          total_matches?: number
          vigencia_meses?: number | null
          vigencia_nivel?: string | null
          vigente_hasta?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultas_listas_dual_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_listas_dual_segmento_id_fkey"
            columns: ["segmento_id"]
            isOneToOne: false
            referencedRelation: "compliance_segmentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_listas_dual_tier_catalogo_version_fkey"
            columns: ["tier_catalogo_version"]
            isOneToOne: false
            referencedRelation: "compliance_tier_catalogo_versiones"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "consultas_listas_dual_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacto_interacciones: {
        Row: {
          contacto_id: string
          created_at: string | null
          estado: string
          fuente: string
          fuente_ref: string | null
          id: string
          negocio_id: string | null
          ocurrida_at: string | null
          payload: Json
          workspace_id: string
        }
        Insert: {
          contacto_id: string
          created_at?: string | null
          estado?: string
          fuente: string
          fuente_ref?: string | null
          id?: string
          negocio_id?: string | null
          ocurrida_at?: string | null
          payload?: Json
          workspace_id: string
        }
        Update: {
          contacto_id?: string
          created_at?: string | null
          estado?: string
          fuente?: string
          fuente_ref?: string | null
          id?: string
          negocio_id?: string | null
          ocurrida_at?: string | null
          payload?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacto_interacciones_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacto_interacciones_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "contacto_interacciones_workspace_id_fkey"
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
          responsable_id: string | null
          rol: string | null
          segmento: string | null
          telefono: string | null
          updated_at: string | null
          usuario_whatsapp: string | null
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
          responsable_id?: string | null
          rol?: string | null
          segmento?: string | null
          telefono?: string | null
          updated_at?: string | null
          usuario_whatsapp?: string | null
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
          responsable_id?: string | null
          rol?: string | null
          segmento?: string | null
          telefono?: string | null
          updated_at?: string | null
          usuario_whatsapp?: string | null
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
            foreignKeyName: "contactos_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "staff"
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
      cotizacion_excepciones_margen: {
        Row: {
          autorizada_at: string
          autorizada_por_profile_id: string
          autorizada_por_staff_id: string | null
          cotizacion_id: string
          created_at: string
          detalle: Json
          huella: string
          id: string
          motivo: string
          perdida_at: string | null
          perdida_causa: string | null
          piso_pct: number
          workspace_id: string
        }
        Insert: {
          autorizada_at?: string
          autorizada_por_profile_id: string
          autorizada_por_staff_id?: string | null
          cotizacion_id: string
          created_at?: string
          detalle: Json
          huella: string
          id?: string
          motivo: string
          perdida_at?: string | null
          perdida_causa?: string | null
          piso_pct: number
          workspace_id: string
        }
        Update: {
          autorizada_at?: string
          autorizada_por_profile_id?: string
          autorizada_por_staff_id?: string | null
          cotizacion_id?: string
          created_at?: string
          detalle?: Json
          huella?: string
          id?: string
          motivo?: string
          perdida_at?: string | null
          perdida_causa?: string | null
          piso_pct?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizacion_excepciones_margen_autorizada_por_profile_id_fkey"
            columns: ["autorizada_por_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizacion_excepciones_margen_autorizada_por_staff_id_fkey"
            columns: ["autorizada_por_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizacion_excepciones_margen_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizacion_excepciones_margen_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizacion_itinerarios: {
        Row: {
          cotizacion_id: string
          created_at: string
          es_principal: boolean
          id: string
          motivo_codigo: string | null
          motivo_texto: string | null
          nombre: string | null
          orden: number
          va_en_propuesta: boolean
          workspace_id: string
        }
        Insert: {
          cotizacion_id: string
          created_at?: string
          es_principal?: boolean
          id?: string
          motivo_codigo?: string | null
          motivo_texto?: string | null
          nombre?: string | null
          orden?: number
          va_en_propuesta?: boolean
          workspace_id: string
        }
        Update: {
          cotizacion_id?: string
          created_at?: string
          es_principal?: boolean
          id?: string
          motivo_codigo?: string | null
          motivo_texto?: string | null
          nombre?: string | null
          orden?: number
          va_en_propuesta?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizacion_itinerarios_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizacion_itinerarios_workspace_id_fkey"
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
          anticipo_pct: number | null
          anticipo_terminos: string | null
          aviso_margen_pct: number | null
          codigo: string
          condiciones_pago: string | null
          consecutivo: string
          convencion_margen: string | null
          costo_total: number | null
          created_at: string | null
          descripcion: string | null
          descuento_porcentaje: number
          descuento_valor: number
          documento_cliente: Json | null
          duplicada_de: string | null
          email_enviado_a: string | null
          estado: string
          fecha_envio: string | null
          fecha_validez: string | null
          id: string
          lugar_entrega: string | null
          margen_default_pct: number | null
          margen_porcentaje: number | null
          modo: string
          negocio_id: string | null
          notas: string | null
          observaciones_extra: Json
          oportunidad_id: string | null
          piso_margen_pct: number | null
          saldo_terminos: string | null
          tarifa_aceptada_id: string | null
          terminos_condiciones: string | null
          tiempo_entrega: string | null
          updated_at: string | null
          valor_total: number
          workspace_id: string
        }
        Insert: {
          aiu_admin_pct?: number | null
          aiu_imprevistos_pct?: number | null
          anticipo_pct?: number | null
          anticipo_terminos?: string | null
          aviso_margen_pct?: number | null
          codigo: string
          condiciones_pago?: string | null
          consecutivo: string
          convencion_margen?: string | null
          costo_total?: number | null
          created_at?: string | null
          descripcion?: string | null
          descuento_porcentaje?: number
          descuento_valor?: number
          documento_cliente?: Json | null
          duplicada_de?: string | null
          email_enviado_a?: string | null
          estado?: string
          fecha_envio?: string | null
          fecha_validez?: string | null
          id?: string
          lugar_entrega?: string | null
          margen_default_pct?: number | null
          margen_porcentaje?: number | null
          modo: string
          negocio_id?: string | null
          notas?: string | null
          observaciones_extra?: Json
          oportunidad_id?: string | null
          piso_margen_pct?: number | null
          saldo_terminos?: string | null
          tarifa_aceptada_id?: string | null
          terminos_condiciones?: string | null
          tiempo_entrega?: string | null
          updated_at?: string | null
          valor_total?: number
          workspace_id: string
        }
        Update: {
          aiu_admin_pct?: number | null
          aiu_imprevistos_pct?: number | null
          anticipo_pct?: number | null
          anticipo_terminos?: string | null
          aviso_margen_pct?: number | null
          codigo?: string
          condiciones_pago?: string | null
          consecutivo?: string
          convencion_margen?: string | null
          costo_total?: number | null
          created_at?: string | null
          descripcion?: string | null
          descuento_porcentaje?: number
          descuento_valor?: number
          documento_cliente?: Json | null
          duplicada_de?: string | null
          email_enviado_a?: string | null
          estado?: string
          fecha_envio?: string | null
          fecha_validez?: string | null
          id?: string
          lugar_entrega?: string | null
          margen_default_pct?: number | null
          margen_porcentaje?: number | null
          modo?: string
          negocio_id?: string | null
          notas?: string | null
          observaciones_extra?: Json
          oportunidad_id?: string | null
          piso_margen_pct?: number | null
          saldo_terminos?: string | null
          tarifa_aceptada_id?: string | null
          terminos_condiciones?: string | null
          tiempo_entrega?: string | null
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
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
            foreignKeyName: "cotizaciones_tarifa_aceptada_id_fkey"
            columns: ["tarifa_aceptada_id"]
            isOneToOne: false
            referencedRelation: "cotizacion_itinerarios"
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
      cronograma_versiones: {
        Row: {
          abierta_hasta: string | null
          cambios: Json
          creado_por: string | null
          created_at: string
          id: string
          negocio_bloque_id: string
          negocio_id: string
          numero: number
          snapshot: Json
          workspace_id: string
        }
        Insert: {
          abierta_hasta?: string | null
          cambios?: Json
          creado_por?: string | null
          created_at?: string
          id?: string
          negocio_bloque_id: string
          negocio_id: string
          numero: number
          snapshot?: Json
          workspace_id: string
        }
        Update: {
          abierta_hasta?: string | null
          cambios?: Json
          creado_por?: string | null
          created_at?: string
          id?: string
          negocio_bloque_id?: string
          negocio_id?: string
          numero?: number
          snapshot?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cronograma_versiones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_bloque_id_fkey"
            columns: ["negocio_bloque_id"]
            isOneToOne: false
            referencedRelation: "negocio_bloques"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cronograma_versiones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cronograma_versiones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_chat_sessions: {
        Row: {
          closed: boolean
          contacto_id: string | null
          created_at: string
          desenlace: string | null
          escalamiento_id: string | null
          phone: string
          state: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          closed?: boolean
          contacto_id?: string | null
          created_at?: string
          desenlace?: string | null
          escalamiento_id?: string | null
          phone: string
          state?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          closed?: boolean
          contacto_id?: string | null
          created_at?: string
          desenlace?: string | null
          escalamiento_id?: string | null
          phone?: string
          state?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_chat_sessions_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_chat_sessions_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
          },
          {
            foreignKeyName: "cs_chat_sessions_escalamiento_id_fkey"
            columns: ["escalamiento_id"]
            isOneToOne: false
            referencedRelation: "cs_escalamientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_chat_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_escalamientos: {
        Row: {
          cliente_nombre: string | null
          contacto_id: string | null
          conversacion: Json
          created_at: string
          estado: string
          franja: string | null
          id: string
          motivo: string
          negocio_id: string | null
          nota_cierre: string | null
          phone: string
          resuelto_at: string | null
          resumen: string | null
          tomado_at: string | null
          tomado_por: string | null
          workspace_id: string
        }
        Insert: {
          cliente_nombre?: string | null
          contacto_id?: string | null
          conversacion?: Json
          created_at?: string
          estado?: string
          franja?: string | null
          id?: string
          motivo: string
          negocio_id?: string | null
          nota_cierre?: string | null
          phone: string
          resuelto_at?: string | null
          resumen?: string | null
          tomado_at?: string | null
          tomado_por?: string | null
          workspace_id: string
        }
        Update: {
          cliente_nombre?: string | null
          contacto_id?: string | null
          conversacion?: Json
          created_at?: string
          estado?: string
          franja?: string | null
          id?: string
          motivo?: string
          negocio_id?: string | null
          nota_cierre?: string | null
          phone?: string
          resuelto_at?: string | null
          resumen?: string | null
          tomado_at?: string | null
          tomado_por?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_escalamientos_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_escalamientos_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cs_escalamientos_tomado_por_fkey"
            columns: ["tomado_por"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_escalamientos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cuentas_cobro_emitidas: {
        Row: {
          anio: number
          aprobado_at: string | null
          aprobado_por: string | null
          cobros_ids: string[]
          conciliado_at: string | null
          created_at: string
          email_destinatarios: string[] | null
          email_enviado_at: string | null
          email_resend_id: string | null
          empresa_id_pagador: string
          estado: Database["public"]["Enums"]["cuenta_cobro_estado"]
          fecha_emision: string
          fecha_vencimiento: string
          id: string
          mes: number
          monto_total: number
          notas: string | null
          numero: string
          pagado_at: string | null
          pdf_drive_id: string | null
          pdf_drive_url: string | null
          planilla_pila_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          anio: number
          aprobado_at?: string | null
          aprobado_por?: string | null
          cobros_ids: string[]
          conciliado_at?: string | null
          created_at?: string
          email_destinatarios?: string[] | null
          email_enviado_at?: string | null
          email_resend_id?: string | null
          empresa_id_pagador: string
          estado?: Database["public"]["Enums"]["cuenta_cobro_estado"]
          fecha_emision?: string
          fecha_vencimiento: string
          id?: string
          mes: number
          monto_total: number
          notas?: string | null
          numero: string
          pagado_at?: string | null
          pdf_drive_id?: string | null
          pdf_drive_url?: string | null
          planilla_pila_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          anio?: number
          aprobado_at?: string | null
          aprobado_por?: string | null
          cobros_ids?: string[]
          conciliado_at?: string | null
          created_at?: string
          email_destinatarios?: string[] | null
          email_enviado_at?: string | null
          email_resend_id?: string | null
          empresa_id_pagador?: string
          estado?: Database["public"]["Enums"]["cuenta_cobro_estado"]
          fecha_emision?: string
          fecha_vencimiento?: string
          id?: string
          mes?: number
          monto_total?: number
          notas?: string | null
          numero?: string
          pagado_at?: string | null
          pdf_drive_id?: string | null
          pdf_drive_url?: string | null
          planilla_pila_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_cobro_emitidas_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_cobro_emitidas_empresa_id_pagador_fkey"
            columns: ["empresa_id_pagador"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_cobro_emitidas_empresa_id_pagador_fkey"
            columns: ["empresa_id_pagador"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cuentas_cobro_emitidas_planilla_pila_id_fkey"
            columns: ["planilla_pila_id"]
            isOneToOne: false
            referencedRelation: "planillas_pila_periodo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_cobro_emitidas_workspace_id_fkey"
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
      decisiones_combinacion: {
        Row: {
          contexto: Json
          costo_elegida: number
          cotizacion_id: string
          decidido_por: string | null
          decidido_por_nombre: string | null
          descartadas: Json
          elegida: Json
          evento: string
          id: string
          itinerario_id: string | null
          margen_elegida_pct: number | null
          motivo_codigo: string | null
          motivo_texto: string | null
          negocio_id: string | null
          precio_elegida: number
          precio_propuesta: number | null
          precio_recomendada: number | null
          propuesta: Json | null
          propuesta_origen: string | null
          recomendada_itinerario_id: string | null
          recomendada_nombre: string | null
          salida_at: string
          tarifa_nombre: string | null
          tarifas_ofrecidas: Json | null
          workspace_id: string
        }
        Insert: {
          contexto?: Json
          costo_elegida?: number
          cotizacion_id: string
          decidido_por?: string | null
          decidido_por_nombre?: string | null
          descartadas?: Json
          elegida?: Json
          evento?: string
          id?: string
          itinerario_id?: string | null
          margen_elegida_pct?: number | null
          motivo_codigo?: string | null
          motivo_texto?: string | null
          negocio_id?: string | null
          precio_elegida?: number
          precio_propuesta?: number | null
          precio_recomendada?: number | null
          propuesta?: Json | null
          propuesta_origen?: string | null
          recomendada_itinerario_id?: string | null
          recomendada_nombre?: string | null
          salida_at?: string
          tarifa_nombre?: string | null
          tarifas_ofrecidas?: Json | null
          workspace_id: string
        }
        Update: {
          contexto?: Json
          costo_elegida?: number
          cotizacion_id?: string
          decidido_por?: string | null
          decidido_por_nombre?: string | null
          descartadas?: Json
          elegida?: Json
          evento?: string
          id?: string
          itinerario_id?: string | null
          margen_elegida_pct?: number | null
          motivo_codigo?: string | null
          motivo_texto?: string | null
          negocio_id?: string | null
          precio_elegida?: number
          precio_propuesta?: number | null
          precio_recomendada?: number | null
          propuesta?: Json | null
          propuesta_origen?: string | null
          recomendada_itinerario_id?: string | null
          recomendada_nombre?: string | null
          salida_at?: string
          tarifa_nombre?: string | null
          tarifas_ofrecidas?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisiones_combinacion_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_itinerario_id_fkey"
            columns: ["itinerario_id"]
            isOneToOne: false
            referencedRelation: "cotizacion_itinerarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_recomendada_itinerario_id_fkey"
            columns: ["recomendada_itinerario_id"]
            isOneToOne: false
            referencedRelation: "cotizacion_itinerarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisiones_combinacion_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      devolucion_eventos: {
        Row: {
          bloque_nombre: string
          bloque_slug: string | null
          created_at: string
          devuelto_at: string
          devuelto_por: string | null
          etapa_al_devolver: string | null
          id: string
          motivo: string
          negocio_bloque_id: string
          negocio_id: string
          nota: string | null
          resuelto_at: string | null
          resuelto_por: string | null
          workspace_id: string
        }
        Insert: {
          bloque_nombre: string
          bloque_slug?: string | null
          created_at?: string
          devuelto_at?: string
          devuelto_por?: string | null
          etapa_al_devolver?: string | null
          id?: string
          motivo: string
          negocio_bloque_id: string
          negocio_id: string
          nota?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          workspace_id: string
        }
        Update: {
          bloque_nombre?: string
          bloque_slug?: string | null
          created_at?: string
          devuelto_at?: string
          devuelto_por?: string | null
          etapa_al_devolver?: string | null
          id?: string
          motivo?: string
          negocio_bloque_id?: string
          negocio_id?: string
          nota?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devolucion_eventos_devuelto_por_fkey"
            columns: ["devuelto_por"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_bloque_id_fkey"
            columns: ["negocio_bloque_id"]
            isOneToOne: false
            referencedRelation: "negocio_bloques"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "devolucion_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "devolucion_eventos_resuelto_por_fkey"
            columns: ["resuelto_por"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucion_eventos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_aceptaciones_usuario: {
        Row: {
          aceptada_at: string
          aviso_texto_sha256: string
          documento_sha256: string | null
          documento_slug: string
          documento_url: string | null
          documento_version: string
          id: string
          ip: unknown
          user_agent: string | null
          usuario_id: string
          workspace_id: string
        }
        Insert: {
          aceptada_at?: string
          aviso_texto_sha256: string
          documento_sha256?: string | null
          documento_slug: string
          documento_url?: string | null
          documento_version: string
          id?: string
          ip?: unknown
          user_agent?: string | null
          usuario_id: string
          workspace_id: string
        }
        Update: {
          aceptada_at?: string
          aviso_texto_sha256?: string
          documento_sha256?: string | null
          documento_slug?: string
          documento_url?: string | null
          documento_version?: string
          id?: string
          ip?: unknown
          user_agent?: string | null
          usuario_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_aceptaciones_usuario_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_aceptaciones_usuario_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_contractuales_versiones: {
        Row: {
          alcance: string
          created_at: string
          empresa_id: string | null
          id: string
          linea_id: string | null
          pdf_bucket: string
          pdf_path: string
          pdf_sha256: string
          registrado_por: string | null
          slug: string
          texto_md: string
          texto_sha256: string
          titulo: string
          version: string
          vigente_desde: string
          vigente_hasta: string | null
          workspace_id: string
        }
        Insert: {
          alcance: string
          created_at?: string
          empresa_id?: string | null
          id?: string
          linea_id?: string | null
          pdf_bucket?: string
          pdf_path: string
          pdf_sha256: string
          registrado_por?: string | null
          slug: string
          texto_md: string
          texto_sha256: string
          titulo: string
          version: string
          vigente_desde: string
          vigente_hasta?: string | null
          workspace_id: string
        }
        Update: {
          alcance?: string
          created_at?: string
          empresa_id?: string | null
          id?: string
          linea_id?: string | null
          pdf_bucket?: string
          pdf_path?: string
          pdf_sha256?: string
          registrado_por?: string | null
          slug?: string
          texto_md?: string
          texto_sha256?: string
          titulo?: string
          version?: string
          vigente_desde?: string
          vigente_hasta?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_contractuales_versiones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_contractuales_versiones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "documentos_contractuales_versiones_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_contractuales_versiones_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_contractuales_versiones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_health_log: {
        Row: {
          checked_at: string
          drive_folder_id: string | null
          error_code: string | null
          error_message: string | null
          folder_accessible: boolean
          folder_name: string | null
          id: string
          latency_ms: number | null
          oauth_mode: string
          shared_drive_id: string | null
          token_refresh_ok: boolean
          workspace_id: string
        }
        Insert: {
          checked_at?: string
          drive_folder_id?: string | null
          error_code?: string | null
          error_message?: string | null
          folder_accessible: boolean
          folder_name?: string | null
          id?: string
          latency_ms?: number | null
          oauth_mode: string
          shared_drive_id?: string | null
          token_refresh_ok: boolean
          workspace_id: string
        }
        Update: {
          checked_at?: string
          drive_folder_id?: string | null
          error_code?: string | null
          error_message?: string | null
          folder_accessible?: boolean
          folder_name?: string | null
          id?: string
          latency_ms?: number | null
          oauth_mode?: string
          shared_drive_id?: string | null
          token_refresh_ok?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drive_health_log_workspace_id_fkey"
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
      etapa_sla_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          etapa_id: string
          id: string
          new_sla_horas: number | null
          old_sla_horas: number | null
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          etapa_id: string
          id?: string
          new_sla_horas?: number | null
          old_sla_horas?: number | null
          workspace_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          etapa_id?: string
          id?: string
          new_sla_horas?: number | null
          old_sla_horas?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "etapa_sla_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etapa_sla_log_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etapa_sla_log_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "v_negocios_etapa_vencimiento"
            referencedColumns: ["etapa_id"]
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
          numero: number
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
          numero: number
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
          numero?: number
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
      festivos_colombia: {
        Row: {
          descripcion: string
          fecha: string
        }
        Insert: {
          descripcion: string
          fecha: string
        }
        Update: {
          descripcion?: string
          fecha?: string
        }
        Relationships: []
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
      formulario_versiones: {
        Row: {
          datos_snapshot: Json
          drive_url: string | null
          generated_at: string
          generated_by: string | null
          id: string
          negocio_bloque_id: string
          version_n: number
          workspace_id: string
        }
        Insert: {
          datos_snapshot?: Json
          drive_url?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          negocio_bloque_id: string
          version_n: number
          workspace_id: string
        }
        Update: {
          datos_snapshot?: Json
          drive_url?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          negocio_bloque_id?: string
          version_n?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "formulario_versiones_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_versiones_negocio_bloque_id_fkey"
            columns: ["negocio_bloque_id"]
            isOneToOne: false
            referencedRelation: "negocio_bloques"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_versiones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      funnelchat_eventos: {
        Row: {
          autenticado: boolean
          bytes: number | null
          contacto_id: string | null
          content_type: string | null
          headers: Json
          id: string
          metodo: string
          motivo: string | null
          payload: Json
          recibido_en: string
          resolucion: Json | null
          sincronizacion: Json | null
          workspace_id: string | null
        }
        Insert: {
          autenticado?: boolean
          bytes?: number | null
          contacto_id?: string | null
          content_type?: string | null
          headers?: Json
          id?: string
          metodo: string
          motivo?: string | null
          payload?: Json
          recibido_en?: string
          resolucion?: Json | null
          sincronizacion?: Json | null
          workspace_id?: string | null
        }
        Update: {
          autenticado?: boolean
          bytes?: number | null
          contacto_id?: string | null
          content_type?: string | null
          headers?: Json
          id?: string
          metodo?: string
          motivo?: string | null
          payload?: Json
          recibido_en?: string
          resolucion?: Json | null
          sincronizacion?: Json | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnelchat_eventos_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnelchat_eventos_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
          },
          {
            foreignKeyName: "funnelchat_eventos_workspace_id_fkey"
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
          centro_costos: string | null
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
          origen_asignacion: string | null
          proyecto_id: string | null
          retencion: number | null
          revisado: boolean
          revisado_at: string | null
          revisado_por: string | null
          rubro_id: string | null
          soporte_pendiente: boolean | null
          soporte_url: string | null
          split_json: Json | null
          tercero_nit: string | null
          tipo: string | null
          workspace_id: string
        }
        Insert: {
          canal_registro?: string | null
          categoria: string
          centro_costos?: string | null
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
          origen_asignacion?: string | null
          proyecto_id?: string | null
          retencion?: number | null
          revisado?: boolean
          revisado_at?: string | null
          revisado_por?: string | null
          rubro_id?: string | null
          soporte_pendiente?: boolean | null
          soporte_url?: string | null
          split_json?: Json | null
          tercero_nit?: string | null
          tipo?: string | null
          workspace_id: string
        }
        Update: {
          canal_registro?: string | null
          categoria?: string
          centro_costos?: string | null
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
          origen_asignacion?: string | null
          proyecto_id?: string | null
          retencion?: number | null
          revisado?: boolean
          revisado_at?: string | null
          revisado_por?: string | null
          rubro_id?: string | null
          soporte_pendiente?: boolean | null
          soporte_url?: string | null
          split_json?: Json | null
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
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
      gastos_recurrentes_map: {
        Row: {
          centro_costos: string
          confianza: number
          created_at: string
          created_by: string
          id: string
          negocio_id_default: string | null
          proveedor_match: string
          workspace_id: string
        }
        Insert: {
          centro_costos: string
          confianza?: number
          created_at?: string
          created_by?: string
          id?: string
          negocio_id_default?: string | null
          proveedor_match: string
          workspace_id: string
        }
        Update: {
          centro_costos?: string
          confianza?: number
          created_at?: string
          created_by?: string
          id?: string
          negocio_id_default?: string | null
          proveedor_match?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_negocio_id_default_fkey"
            columns: ["negocio_id_default"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "gastos_recurrentes_map_workspace_id_fkey"
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "generaciones_log_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "horas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
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
      item_adicionales: {
        Row: {
          cantidad: number
          codigo: string | null
          costo: number
          created_at: string
          id: string
          item_id: string
          moneda: string
          nombre: string | null
          orden: number
          origen: string
          precio: number
          tasa_cop: number | null
        }
        Insert: {
          cantidad?: number
          codigo?: string | null
          costo?: number
          created_at?: string
          id?: string
          item_id: string
          moneda?: string
          nombre?: string | null
          orden?: number
          origen?: string
          precio?: number
          tasa_cop?: number | null
        }
        Update: {
          cantidad?: number
          codigo?: string | null
          costo?: number
          created_at?: string
          id?: string
          item_id?: string
          moneda?: string
          nombre?: string | null
          orden?: number
          origen?: string
          precio?: number
          tasa_cop?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "item_adicionales_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          base_iva: string | null
          cantidad: number
          cotizacion_id: string
          created_at: string | null
          descripcion: string | null
          descuento_porcentaje: number | null
          dia_relativo: number | null
          entra_al_precio: boolean
          es_ajuste: boolean
          grupo: string | null
          id: string
          margen_porcentaje: number | null
          mostrar_en_sugeridos: boolean
          nombre: string
          opcion_de: string | null
          orden: number
          precio_manual: boolean
          precio_venta: number | null
          servicio_origen_id: string | null
          subtotal: number | null
          tarifa_pax: Json | null
          unidad: string | null
        }
        Insert: {
          base_iva?: string | null
          cantidad?: number
          cotizacion_id: string
          created_at?: string | null
          descripcion?: string | null
          descuento_porcentaje?: number | null
          dia_relativo?: number | null
          entra_al_precio?: boolean
          es_ajuste?: boolean
          grupo?: string | null
          id?: string
          margen_porcentaje?: number | null
          mostrar_en_sugeridos?: boolean
          nombre: string
          opcion_de?: string | null
          orden?: number
          precio_manual?: boolean
          precio_venta?: number | null
          servicio_origen_id?: string | null
          subtotal?: number | null
          tarifa_pax?: Json | null
          unidad?: string | null
        }
        Update: {
          base_iva?: string | null
          cantidad?: number
          cotizacion_id?: string
          created_at?: string | null
          descripcion?: string | null
          descuento_porcentaje?: number | null
          dia_relativo?: number | null
          entra_al_precio?: boolean
          es_ajuste?: boolean
          grupo?: string | null
          id?: string
          margen_porcentaje?: number | null
          mostrar_en_sugeridos?: boolean
          nombre?: string
          opcion_de?: string | null
          orden?: number
          precio_manual?: boolean
          precio_venta?: number | null
          servicio_origen_id?: string | null
          subtotal?: number | null
          tarifa_pax?: Json | null
          unidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_opcion_de_fkey"
            columns: ["opcion_de"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      itinerario_opciones: {
        Row: {
          item_id: string
          itinerario_id: string
        }
        Insert: {
          item_id: string
          itinerario_id: string
        }
        Update: {
          item_id?: string
          itinerario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerario_opciones_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerario_opciones_itinerario_id_fkey"
            columns: ["itinerario_id"]
            isOneToOne: false
            referencedRelation: "cotizacion_itinerarios"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_expediente_ref: {
        Row: {
          actualizado_en: string
          creado_en: string
          decision_cache: Json | null
          documento_numero: string | null
          documento_tipo: string | null
          estado_cache: string
          etapa_cache: string | null
          expediente_kyc_id: string
          id: string
          nombre: string | null
          razon_social: string | null
          severidad_cache: string | null
          workspace_id: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          decision_cache?: Json | null
          documento_numero?: string | null
          documento_tipo?: string | null
          estado_cache: string
          etapa_cache?: string | null
          expediente_kyc_id: string
          id?: string
          nombre?: string | null
          razon_social?: string | null
          severidad_cache?: string | null
          workspace_id: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          decision_cache?: Json | null
          documento_numero?: string | null
          documento_tipo?: string | null
          estado_cache?: string
          etapa_cache?: string | null
          expediente_kyc_id?: string
          id?: string
          nombre?: string | null
          razon_social?: string | null
          severidad_cache?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyc_expediente_ref_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
          config_extra: Json
          created_at: string
          descripcion: string | null
          drive_folder_id: string | null
          id: string
          is_active: boolean
          nombre: string
          numero: number
          tipo: string
          workspace_id: string | null
        }
        Insert: {
          config_extra?: Json
          created_at?: string
          descripcion?: string | null
          drive_folder_id?: string | null
          id?: string
          is_active?: boolean
          nombre: string
          numero: number
          tipo?: string
          workspace_id?: string | null
        }
        Update: {
          config_extra?: Json
          created_at?: string
          descripcion?: string | null
          drive_folder_id?: string | null
          id?: string
          is_active?: boolean
          nombre?: string
          numero?: number
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
      meta_leads_eventos: {
        Row: {
          contacto_id: string | null
          created_at: string
          created_time: string | null
          estado: string
          form_id: string | null
          id: string
          interaccion_id: string | null
          leadgen_id: string | null
          motivo: string | null
          page_id: string | null
          payload: Json
          procesado_en: string | null
          recibido_en: string
          workspace_id: string | null
        }
        Insert: {
          contacto_id?: string | null
          created_at?: string
          created_time?: string | null
          estado?: string
          form_id?: string | null
          id?: string
          interaccion_id?: string | null
          leadgen_id?: string | null
          motivo?: string | null
          page_id?: string | null
          payload: Json
          procesado_en?: string | null
          recibido_en?: string
          workspace_id?: string | null
        }
        Update: {
          contacto_id?: string | null
          created_at?: string
          created_time?: string | null
          estado?: string
          form_id?: string | null
          id?: string
          interaccion_id?: string | null
          leadgen_id?: string | null
          motivo?: string | null
          page_id?: string | null
          payload?: Json
          procesado_en?: string | null
          recibido_en?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_leads_eventos_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "contactos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_leads_eventos_contacto_id_fkey"
            columns: ["contacto_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["contacto_id"]
          },
          {
            foreignKeyName: "meta_leads_eventos_interaccion_id_fkey"
            columns: ["interaccion_id"]
            isOneToOne: false
            referencedRelation: "contacto_interacciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_leads_eventos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_comerciales: {
        Row: {
          anio: number
          created_at: string
          created_by: string | null
          id: string
          mes: number
          meta_num_ventas: number | null
          meta_valor: number | null
          staff_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          anio: number
          created_at?: string
          created_by?: string | null
          id?: string
          mes: number
          meta_num_ventas?: number | null
          meta_valor?: number | null
          staff_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          anio?: number
          created_at?: string
          created_by?: string | null
          id?: string
          mes?: number
          meta_num_ventas?: number | null
          meta_valor?: number | null
          staff_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_comerciales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_comerciales_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_comerciales_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_vendedor: {
        Row: {
          anio: number | null
          centro_costo: string | null
          created_at: string
          dias_laborales: number | null
          id: string
          mes: string | null
          meta_rentabilidad: number | null
          meta_utilidad: number | null
          meta_venta: number | null
          vendedor: string | null
          workspace_id: string
        }
        Insert: {
          anio?: number | null
          centro_costo?: string | null
          created_at?: string
          dias_laborales?: number | null
          id?: string
          mes?: string | null
          meta_rentabilidad?: number | null
          meta_utilidad?: number | null
          meta_venta?: number | null
          vendedor?: string | null
          workspace_id: string
        }
        Update: {
          anio?: number | null
          centro_costo?: string | null
          created_at?: string
          dias_laborales?: number | null
          id?: string
          mes?: string | null
          meta_rentabilidad?: number | null
          meta_utilidad?: number | null
          meta_venta?: number | null
          vendedor?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_vendedor_workspace_id_fkey"
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
      movimientos_rechazados: {
        Row: {
          fila: Json
          fila_id: string
          id: string
          motivo: string
          rechazado_at: string
          rechazado_por: string | null
          tabla: string
          workspace_id: string
        }
        Insert: {
          fila: Json
          fila_id: string
          id?: string
          motivo: string
          rechazado_at?: string
          rechazado_por?: string | null
          tabla: string
          workspace_id: string
        }
        Update: {
          fila?: Json
          fila_id?: string
          id?: string
          motivo?: string
          rechazado_at?: string
          rechazado_por?: string | null
          tabla?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_rechazados_workspace_id_fkey"
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_bloques_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
        ]
      }
      negocio_conciliacion: {
        Row: {
          conciliado: boolean
          conciliado_at: string | null
          conciliado_por: string | null
          created_at: string
          id: string
          negocio_id: string
          nota: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          conciliado?: boolean
          conciliado_at?: string | null
          conciliado_por?: string | null
          created_at?: string
          id?: string
          negocio_id: string
          nota?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          conciliado?: boolean
          conciliado_at?: string | null
          conciliado_por?: string | null
          created_at?: string
          id?: string
          negocio_id?: string
          nota?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negocio_conciliacion_conciliado_por_fkey"
            columns: ["conciliado_por"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_conciliacion_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      negocio_responsables: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          negocio_id: string
          rol: string | null
          staff_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          negocio_id: string
          rol?: string | null
          staff_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          negocio_id?: string
          rol?: string | null
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negocio_responsables_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_responsables_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "negocio_responsables_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      negocios: {
        Row: {
          aliado_id: string | null
          balance_final: Json | null
          carpeta_url: string | null
          cierre_motivo: string | null
          cierre_no_facturable: boolean
          cierre_no_facturable_at: string | null
          cierre_no_facturable_motivo: string | null
          cierre_no_facturable_nota: string | null
          cierre_no_facturable_por: string | null
          cierre_snapshot: Json | null
          closed_at: string | null
          codigo: string | null
          contacto_id: string | null
          created_at: string
          descripcion_cierre: string | null
          empresa_id: string | null
          estado: string
          etapa_actual_id: string | null
          etapa_cambiada_at: string | null
          id: string
          is_paused: boolean
          lecciones_aprendidas: string | null
          linea_id: string | null
          metadata: Json
          motivo_cierre: string | null
          motivo_pausa: string | null
          motivo_pausa_detalle: string | null
          nombre: string
          origen: string | null
          pausado: boolean
          pausado_hasta: string | null
          paused_at: string | null
          paused_by: string | null
          paused_reason: string | null
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
          aliado_id?: string | null
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_motivo?: string | null
          cierre_no_facturable?: boolean
          cierre_no_facturable_at?: string | null
          cierre_no_facturable_motivo?: string | null
          cierre_no_facturable_nota?: string | null
          cierre_no_facturable_por?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string
          is_paused?: boolean
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          metadata?: Json
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre: string
          origen?: string | null
          pausado?: boolean
          pausado_hasta?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_reason?: string | null
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
          aliado_id?: string | null
          balance_final?: Json | null
          carpeta_url?: string | null
          cierre_motivo?: string | null
          cierre_no_facturable?: boolean
          cierre_no_facturable_at?: string | null
          cierre_no_facturable_motivo?: string | null
          cierre_no_facturable_nota?: string | null
          cierre_no_facturable_por?: string | null
          cierre_snapshot?: Json | null
          closed_at?: string | null
          codigo?: string | null
          contacto_id?: string | null
          created_at?: string
          descripcion_cierre?: string | null
          empresa_id?: string | null
          estado?: string
          etapa_actual_id?: string | null
          etapa_cambiada_at?: string | null
          id?: string
          is_paused?: boolean
          lecciones_aprendidas?: string | null
          linea_id?: string | null
          metadata?: Json
          motivo_cierre?: string | null
          motivo_pausa?: string | null
          motivo_pausa_detalle?: string | null
          nombre?: string
          origen?: string | null
          pausado?: boolean
          pausado_hasta?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_reason?: string | null
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
            foreignKeyName: "negocios_aliado_id_fkey"
            columns: ["aliado_id"]
            isOneToOne: false
            referencedRelation: "aliados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocios_cierre_no_facturable_por_fkey"
            columns: ["cierre_no_facturable_por"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "negocios_etapa_actual_id_fkey"
            columns: ["etapa_actual_id"]
            isOneToOne: false
            referencedRelation: "v_negocios_etapa_vencimiento"
            referencedColumns: ["etapa_id"]
          },
          {
            foreignKeyName: "negocios_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocios_paused_by_fkey"
            columns: ["paused_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          grupo_clave: string | null
          id: string
          metadata: Json | null
          resuelta_por: string | null
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
          grupo_clave?: string | null
          id?: string
          metadata?: Json | null
          resuelta_por?: string | null
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
          grupo_clave?: string | null
          id?: string
          metadata?: Json | null
          resuelta_por?: string | null
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
            foreignKeyName: "notificaciones_resuelta_por_fkey"
            columns: ["resuelta_por"]
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
      plan_cobro_cuotas: {
        Row: {
          concepto_detalle: string | null
          created_at: string
          fecha_vencimiento: string
          id: string
          monto: number
          numero: number
          plan_cobro_id: string
          tipo: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          concepto_detalle?: string | null
          created_at?: string
          fecha_vencimiento: string
          id?: string
          monto: number
          numero: number
          plan_cobro_id: string
          tipo?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          concepto_detalle?: string | null
          created_at?: string
          fecha_vencimiento?: string
          id?: string
          monto?: number
          numero?: number
          plan_cobro_id?: string
          tipo?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_cobro_cuotas_plan_cobro_id_fkey"
            columns: ["plan_cobro_id"]
            isOneToOne: false
            referencedRelation: "planes_cobro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_cobro_cuotas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      planes_cobro: {
        Row: {
          activo: boolean
          auto_renovar: boolean
          concepto_detalle_template: string | null
          created_at: string | null
          fecha_fin: string
          fecha_inicio: string
          frecuencia: string
          id: string
          monto: number
          negocio_id: string
          notas: string | null
          pasarela: string
          referencia_wompi: string | null
          total_cuotas: number
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          activo?: boolean
          auto_renovar?: boolean
          concepto_detalle_template?: string | null
          created_at?: string | null
          fecha_fin: string
          fecha_inicio: string
          frecuencia: string
          id?: string
          monto: number
          negocio_id: string
          notas?: string | null
          pasarela?: string
          referencia_wompi?: string | null
          total_cuotas: number
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          activo?: boolean
          auto_renovar?: boolean
          concepto_detalle_template?: string | null
          created_at?: string | null
          fecha_fin?: string
          fecha_inicio?: string
          frecuencia?: string
          id?: string
          monto?: number
          negocio_id?: string
          notas?: string | null
          pasarela?: string
          referencia_wompi?: string | null
          total_cuotas?: number
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "planes_cobro_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "planes_cobro_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      planillas_pila_periodo: {
        Row: {
          anio: number
          file_drive_id: string
          file_drive_url: string
          id: string
          mes: number
          monto_aportado: number | null
          notas: string | null
          uploaded_at: string
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          anio: number
          file_drive_id: string
          file_drive_url: string
          id?: string
          mes: number
          monto_aportado?: number | null
          notas?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          anio?: number
          file_drive_id?: string
          file_drive_url?: string
          id?: string
          mes?: number
          monto_aportado?: number | null
          notas?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planillas_pila_periodo_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planillas_pila_periodo_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proceso_snapshots: {
        Row: {
          abiertos: number
          created_at: string
          etapa_id: string
          etapa_nombre: string
          etapa_numero: number | null
          etapa_orden: number
          id: string
          linea_id: string
          seccional: string | null
          sla_horas: number | null
          stage: string | null
          tomado_en: string
          vencidos: number
          workspace_id: string
        }
        Insert: {
          abiertos?: number
          created_at?: string
          etapa_id: string
          etapa_nombre: string
          etapa_numero?: number | null
          etapa_orden: number
          id?: string
          linea_id: string
          seccional?: string | null
          sla_horas?: number | null
          stage?: string | null
          tomado_en?: string
          vencidos?: number
          workspace_id: string
        }
        Update: {
          abiertos?: number
          created_at?: string
          etapa_id?: string
          etapa_nombre?: string
          etapa_numero?: number | null
          etapa_orden?: number
          id?: string
          linea_id?: string
          seccional?: string | null
          sla_horas?: number | null
          stage?: string | null
          tomado_en?: string
          vencidos?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proceso_snapshots_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceso_snapshots_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "v_negocios_etapa_vencimiento"
            referencedColumns: ["etapa_id"]
          },
          {
            foreignKeyName: "proceso_snapshots_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceso_snapshots_workspace_id_fkey"
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
          home_workspace_id: string | null
          id: string
          platform_admin: boolean
          role: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          home_workspace_id?: string | null
          id: string
          platform_admin?: boolean
          role?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          home_workspace_id?: string | null
          id?: string
          platform_admin?: boolean
          role?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_home_workspace_id_fkey"
            columns: ["home_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
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
      purga_registros_bot_corridas: {
        Row: {
          conteos: Json
          ejecutada_at: string
          id: string
        }
        Insert: {
          conteos: Json
          ejecutada_at?: string
          id?: string
        }
        Update: {
          conteos?: Json
          ejecutada_at?: string
          id?: string
        }
        Relationships: []
      }
      purga_storage_pendiente: {
        Row: {
          bucket: string
          encolado_at: string
          id: string
          ruta: string
        }
        Insert: {
          bucket: string
          encolado_at?: string
          id?: string
          ruta: string
        }
        Update: {
          bucket?: string
          encolado_at?: string
          id?: string
          ruta?: string
        }
        Relationships: []
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
      reproceso_eventos: {
        Row: {
          abierto_at: string
          abierto_por: string | null
          atribuido_a: string | null
          causa: string
          cerrado_at: string | null
          ciclo: number
          created_at: string
          detalle: string | null
          id: string
          negocio_id: string
          tipo: string
          workspace_id: string
        }
        Insert: {
          abierto_at?: string
          abierto_por?: string | null
          atribuido_a?: string | null
          causa: string
          cerrado_at?: string | null
          ciclo: number
          created_at?: string
          detalle?: string | null
          id?: string
          negocio_id: string
          tipo: string
          workspace_id: string
        }
        Update: {
          abierto_at?: string
          abierto_por?: string | null
          atribuido_a?: string | null
          causa?: string
          cerrado_at?: string | null
          ciclo?: number
          created_at?: string
          detalle?: string | null
          id?: string
          negocio_id?: string
          tipo?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reproceso_eventos_abierto_por_fkey"
            columns: ["abierto_por"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reproceso_eventos_atribuido_a_fkey"
            columns: ["atribuido_a"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "reproceso_eventos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "reproceso_eventos_workspace_id_fkey"
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
          cargo_responsable_id: string | null
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
          cargo_responsable_id?: string | null
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
          cargo_responsable_id?: string | null
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
            foreignKeyName: "riesgos_controles_cargo_responsable_id_fkey"
            columns: ["cargo_responsable_id"]
            isOneToOne: false
            referencedRelation: "compliance_cargos"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "riesgos_controles_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
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
          sugerido: boolean
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
          sugerido?: boolean
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
          sugerido?: boolean
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
      servicio_contratado_beneficiarios: {
        Row: {
          servicio_contratado_id: string
          workspace_id: string
        }
        Insert: {
          servicio_contratado_id: string
          workspace_id: string
        }
        Update: {
          servicio_contratado_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "servicio_contratado_beneficiarios_servicio_contratado_id_fkey"
            columns: ["servicio_contratado_id"]
            isOneToOne: false
            referencedRelation: "servicios_contratados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicio_contratado_beneficiarios_workspace_id_fkey"
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
          linea_id: string | null
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
          linea_id?: string | null
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
          linea_id?: string | null
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
            foreignKeyName: "servicios_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      servicios_contratados: {
        Row: {
          actualizado_por: string | null
          autorizacion_sin_poder_permitida: boolean
          bolsa_inicial_referencia: string | null
          comision: Json | null
          correo_facturacion: string | null
          created_at: string
          empresa_id: string
          estado: string
          id: string
          negocio_id: string
          parametros: Json
          servicio_slug: string
          servicio_version: number
          updated_at: string
          valida_cliente_api_id: string | null
          vigente_desde: string
          vigente_hasta: string | null
          workspace_id: string
          workspace_pagador_id: string | null
        }
        Insert: {
          actualizado_por?: string | null
          autorizacion_sin_poder_permitida?: boolean
          bolsa_inicial_referencia?: string | null
          comision?: Json | null
          correo_facturacion?: string | null
          created_at?: string
          empresa_id: string
          estado?: string
          id?: string
          negocio_id: string
          parametros?: Json
          servicio_slug: string
          servicio_version: number
          updated_at?: string
          valida_cliente_api_id?: string | null
          vigente_desde: string
          vigente_hasta?: string | null
          workspace_id: string
          workspace_pagador_id?: string | null
        }
        Update: {
          actualizado_por?: string | null
          autorizacion_sin_poder_permitida?: boolean
          bolsa_inicial_referencia?: string | null
          comision?: Json | null
          correo_facturacion?: string | null
          created_at?: string
          empresa_id?: string
          estado?: string
          id?: string
          negocio_id?: string
          parametros?: Json
          servicio_slug?: string
          servicio_version?: number
          updated_at?: string
          valida_cliente_api_id?: string | null
          vigente_desde?: string
          vigente_hasta?: string | null
          workspace_id?: string
          workspace_pagador_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "servicios_contratados_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_contratados_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_contratados_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_proyecto_financiero"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_contratados_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_contratados_version_fk"
            columns: ["servicio_slug", "servicio_version"]
            isOneToOne: false
            referencedRelation: "catalogo_servicios_versiones"
            referencedColumns: ["slug", "version"]
          },
          {
            foreignKeyName: "servicios_contratados_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_contratados_workspace_pagador_id_fkey"
            columns: ["workspace_pagador_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      servicios_contratados_cambios: {
        Row: {
          campo: string
          created_at: string
          id: string
          motivo: string
          registrado_por: string
          servicio_contratado_id: string
          valor_anterior: Json | null
          valor_nuevo: Json | null
        }
        Insert: {
          campo: string
          created_at?: string
          id?: string
          motivo: string
          registrado_por: string
          servicio_contratado_id: string
          valor_anterior?: Json | null
          valor_nuevo?: Json | null
        }
        Update: {
          campo?: string
          created_at?: string
          id?: string
          motivo?: string
          registrado_por?: string
          servicio_contratado_id?: string
          valor_anterior?: Json | null
          valor_nuevo?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "servicios_contratados_cambios_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_contratados_cambios_servicio_contratado_id_fkey"
            columns: ["servicio_contratado_id"]
            isOneToOne: false
            referencedRelation: "servicios_contratados"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          contract_type: string | null
          created_at: string | null
          department: string | null
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
          contract_type?: string | null
          created_at?: string | null
          department?: string | null
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
          contract_type?: string | null
          created_at?: string | null
          department?: string | null
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
      staff_areas: {
        Row: {
          area: string
          created_at: string
          staff_id: string
        }
        Insert: {
          area: string
          created_at?: string
          staff_id: string
        }
        Update: {
          area?: string
          created_at?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_areas_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
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
      suscripciones: {
        Row: {
          created_at: string
          estado: string
          estado_cambiado_at: string | null
          id: string
          intentos_fallidos: number
          medio_pago: Json | null
          pasarela: string
          plan_cobro_id: string
          proximo_cobro: string | null
          ultimo_error: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          estado?: string
          estado_cambiado_at?: string | null
          id?: string
          intentos_fallidos?: number
          medio_pago?: Json | null
          pasarela?: string
          plan_cobro_id: string
          proximo_cobro?: string | null
          ultimo_error?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          estado?: string
          estado_cambiado_at?: string | null
          id?: string
          intentos_fallidos?: number
          medio_pago?: Json | null
          pasarela?: string
          plan_cobro_id?: string
          proximo_cobro?: string | null
          ultimo_error?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suscripciones_plan_cobro_id_fkey"
            columns: ["plan_cobro_id"]
            isOneToOne: true
            referencedRelation: "planes_cobro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suscripciones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "timer_activo_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
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
      tutorial_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: number
          dismissed_at: string | null
          id: string
          tutorial_slug: string
          updated_at: string
          user_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          dismissed_at?: string | null
          id?: string
          tutorial_slug: string
          updated_at?: string
          user_id: string
          version?: number
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          dismissed_at?: string | null
          id?: string
          tutorial_slug?: string
          updated_at?: string
          user_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutorial_progress_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      valida_consultas: {
        Row: {
          created_at: string
          created_by: string | null
          documento_numero: string | null
          documento_tipo: string | null
          hash_reporte: string | null
          id: string
          lote_id: string | null
          matches: Json | null
          negocio_id: string | null
          nombre_consultado: string | null
          severidad: string
          tipo: string
          tipo_persona: string
          total_matches: number
          valida_consulta_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          documento_numero?: string | null
          documento_tipo?: string | null
          hash_reporte?: string | null
          id?: string
          lote_id?: string | null
          matches?: Json | null
          negocio_id?: string | null
          nombre_consultado?: string | null
          severidad: string
          tipo: string
          tipo_persona: string
          total_matches?: number
          valida_consulta_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          documento_numero?: string | null
          documento_tipo?: string | null
          hash_reporte?: string | null
          id?: string
          lote_id?: string | null
          matches?: Json | null
          negocio_id?: string | null
          nombre_consultado?: string | null
          severidad?: string
          tipo?: string
          tipo_persona?: string
          total_matches?: number
          valida_consulta_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valida_consultas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_consultas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_consultas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      valida_dict_ciiu: {
        Row: {
          actualizado_at: string
          codigo: string
          descripcion: string
          score: number
        }
        Insert: {
          actualizado_at?: string
          codigo: string
          descripcion: string
          score: number
        }
        Update: {
          actualizado_at?: string
          codigo?: string
          descripcion?: string
          score?: number
        }
        Relationships: []
      }
      valida_dict_municipios: {
        Row: {
          actualizado_at: string
          departamento: string
          divipola: string
          municipio: string
          score: number
        }
        Insert: {
          actualizado_at?: string
          departamento: string
          divipola: string
          municipio: string
          score: number
        }
        Update: {
          actualizado_at?: string
          departamento?: string
          divipola?: string
          municipio?: string
          score?: number
        }
        Relationships: []
      }
      valida_dict_paises: {
        Row: {
          actualizado_at: string
          codigo_iso: string
          motivo: string | null
          nombre: string
          score: number
        }
        Insert: {
          actualizado_at?: string
          codigo_iso: string
          motivo?: string | null
          nombre: string
          score: number
        }
        Update: {
          actualizado_at?: string
          codigo_iso?: string
          motivo?: string | null
          nombre?: string
          score?: number
        }
        Relationships: []
      }
      valida_sarlaft_datos_negocio: {
        Row: {
          actualizado_at: string
          actualizado_por: string | null
          calidad_verificado: string | null
          ciiu_codigo: string | null
          criticidad_cargo: string | null
          endeudamiento: string | null
          forma_operacion: string | null
          municipio_divipola: string | null
          negocio_id: string
          notas: string | null
          pais_codigo_iso: string | null
          tipo_contrato: string | null
          universo: string
          workspace_id: string
        }
        Insert: {
          actualizado_at?: string
          actualizado_por?: string | null
          calidad_verificado?: string | null
          ciiu_codigo?: string | null
          criticidad_cargo?: string | null
          endeudamiento?: string | null
          forma_operacion?: string | null
          municipio_divipola?: string | null
          negocio_id: string
          notas?: string | null
          pais_codigo_iso?: string | null
          tipo_contrato?: string | null
          universo: string
          workspace_id: string
        }
        Update: {
          actualizado_at?: string
          actualizado_por?: string | null
          calidad_verificado?: string | null
          ciiu_codigo?: string | null
          criticidad_cargo?: string | null
          endeudamiento?: string | null
          forma_operacion?: string | null
          municipio_divipola?: string | null
          negocio_id?: string
          notas?: string | null
          pais_codigo_iso?: string | null
          tipo_contrato?: string | null
          universo?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_sarlaft_datos_negocio_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      valida_score_negocio: {
        Row: {
          actualizado_at: string
          factores_aplicados: Json
          negocio_id: string
          nivel: string
          proxima_revision: string | null
          puntaje: number
          universo: string
          valida_consulta_id_ultima: string | null
          workspace_id: string
        }
        Insert: {
          actualizado_at?: string
          factores_aplicados?: Json
          negocio_id: string
          nivel: string
          proxima_revision?: string | null
          puntaje: number
          universo: string
          valida_consulta_id_ultima?: string | null
          workspace_id: string
        }
        Update: {
          actualizado_at?: string
          factores_aplicados?: Json
          negocio_id?: string
          nivel?: string
          proxima_revision?: string | null
          puntaje?: number
          universo?: string
          valida_consulta_id_ultima?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_score_negocio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "valida_score_negocio_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      valida_segmentacion_bitacora: {
        Row: {
          aplicada_at: string
          aplicada_por: string | null
          id: string
          pesos_contrapartes: Json
          pesos_empleados: Json
          preset: string
          razon_cambio: string | null
          umbrales_contrapartes: Json
          umbrales_empleados: Json
          version: number
          workspace_id: string
        }
        Insert: {
          aplicada_at?: string
          aplicada_por?: string | null
          id?: string
          pesos_contrapartes: Json
          pesos_empleados: Json
          preset: string
          razon_cambio?: string | null
          umbrales_contrapartes: Json
          umbrales_empleados: Json
          version: number
          workspace_id: string
        }
        Update: {
          aplicada_at?: string
          aplicada_por?: string | null
          id?: string
          pesos_contrapartes?: Json
          pesos_empleados?: Json
          preset?: string
          razon_cambio?: string | null
          umbrales_contrapartes?: Json
          umbrales_empleados?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valida_segmentacion_bitacora_aplicada_por_fkey"
            columns: ["aplicada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valida_segmentacion_bitacora_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      valida_segmentacion_ciiu_override: {
        Row: {
          codigo_ciiu: string
          creado_at: string
          creado_por: string | null
          razon: string | null
          score: number
          workspace_id: string
        }
        Insert: {
          codigo_ciiu: string
          creado_at?: string
          creado_por?: string | null
          razon?: string | null
          score: number
          workspace_id: string
        }
        Update: {
          codigo_ciiu?: string
          creado_at?: string
          creado_por?: string | null
          razon?: string | null
          score?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valida_segmentacion_ciiu_override_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valida_segmentacion_ciiu_override_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      valida_segmentacion_config: {
        Row: {
          aplicada_at: string | null
          aplicada_por: string | null
          created_at: string
          disclaimer_aceptado: boolean
          id: string
          pesos_contrapartes: Json
          pesos_empleados: Json
          preset: string
          umbrales_contrapartes: Json
          umbrales_empleados: Json
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          aplicada_at?: string | null
          aplicada_por?: string | null
          created_at?: string
          disclaimer_aceptado?: boolean
          id?: string
          pesos_contrapartes?: Json
          pesos_empleados?: Json
          preset: string
          umbrales_contrapartes?: Json
          umbrales_empleados?: Json
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          aplicada_at?: string | null
          aplicada_por?: string | null
          created_at?: string
          disclaimer_aceptado?: boolean
          id?: string
          pesos_contrapartes?: Json
          pesos_empleados?: Json
          preset?: string
          umbrales_contrapartes?: Json
          umbrales_empleados?: Json
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valida_segmentacion_config_aplicada_por_fkey"
            columns: ["aplicada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valida_segmentacion_config_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ve_chat_sessions: {
        Row: {
          closed: boolean
          created_at: string
          phone: string
          state: Json
          updated_at: string
        }
        Insert: {
          closed?: boolean
          created_at?: string
          phone: string
          state?: Json
          updated_at?: string
        }
        Update: {
          closed?: boolean
          created_at?: string
          phone?: string
          state?: Json
          updated_at?: string
        }
        Relationships: []
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
      ve_respuestas: {
        Row: {
          atribucion: string | null
          consent_at: string | null
          consent_version: string | null
          created_at: string
          crisis: string | null
          edad: number | null
          genero: string | null
          historia: string | null
          id: string
          idioma: string | null
          lat: number | null
          lng: number | null
          necesidades: Json
          nombre: string | null
          payload: Json
          phone: string
          quien_ayudo: string | null
          resumen: string | null
          sexo: string | null
          turnos: number | null
          ubicacion: string | null
          ubicacion_fuente: string | null
          zona: string | null
        }
        Insert: {
          atribucion?: string | null
          consent_at?: string | null
          consent_version?: string | null
          created_at?: string
          crisis?: string | null
          edad?: number | null
          genero?: string | null
          historia?: string | null
          id?: string
          idioma?: string | null
          lat?: number | null
          lng?: number | null
          necesidades?: Json
          nombre?: string | null
          payload?: Json
          phone: string
          quien_ayudo?: string | null
          resumen?: string | null
          sexo?: string | null
          turnos?: number | null
          ubicacion?: string | null
          ubicacion_fuente?: string | null
          zona?: string | null
        }
        Update: {
          atribucion?: string | null
          consent_at?: string | null
          consent_version?: string | null
          created_at?: string
          crisis?: string | null
          edad?: number | null
          genero?: string | null
          historia?: string | null
          id?: string
          idioma?: string | null
          lat?: number | null
          lng?: number | null
          necesidades?: Json
          nombre?: string | null
          payload?: Json
          phone?: string
          quien_ayudo?: string | null
          resumen?: string | null
          sexo?: string | null
          turnos?: number | null
          ubicacion?: string | null
          ubicacion_fuente?: string | null
          zona?: string | null
        }
        Relationships: []
      }
      ventas_hechos: {
        Row: {
          anio: number | null
          bodega: string | null
          cantidad: number | null
          centro_costo: string | null
          cliente: string | null
          costo: number | null
          created_at: string
          departamento: string | null
          descripcion: string | null
          descuento: number | null
          documento: string | null
          fecha: string | null
          fuente: string | null
          id: string
          linea: string | null
          lote: string | null
          mes: string | null
          precio_unit: number | null
          referencia: string | null
          rentabilidad: number | null
          tipo_docto: string | null
          utilidad: number | null
          vendedor: string | null
          venta_neta: number | null
          workspace_id: string
        }
        Insert: {
          anio?: number | null
          bodega?: string | null
          cantidad?: number | null
          centro_costo?: string | null
          cliente?: string | null
          costo?: number | null
          created_at?: string
          departamento?: string | null
          descripcion?: string | null
          descuento?: number | null
          documento?: string | null
          fecha?: string | null
          fuente?: string | null
          id?: string
          linea?: string | null
          lote?: string | null
          mes?: string | null
          precio_unit?: number | null
          referencia?: string | null
          rentabilidad?: number | null
          tipo_docto?: string | null
          utilidad?: number | null
          vendedor?: string | null
          venta_neta?: number | null
          workspace_id: string
        }
        Update: {
          anio?: number | null
          bodega?: string | null
          cantidad?: number | null
          centro_costo?: string | null
          cliente?: string | null
          costo?: number | null
          created_at?: string
          departamento?: string | null
          descripcion?: string | null
          descuento?: number | null
          documento?: string | null
          fecha?: string | null
          fuente?: string | null
          id?: string
          linea?: string | null
          lote?: string | null
          mes?: string | null
          precio_unit?: number | null
          referencia?: string | null
          rentabilidad?: number | null
          tipo_docto?: string | null
          utilidad?: number | null
          vendedor?: string | null
          venta_neta?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ventas_hechos_workspace_id_fkey"
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
      wa_envios: {
        Row: {
          created_at: string
          error_code: number | null
          error_title: string | null
          id: string
          intent: string | null
          origen: string
          phone: string | null
          preview: string | null
          status: string
          status_at: string | null
          template_name: string | null
          wa_message_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          error_code?: number | null
          error_title?: string | null
          id?: string
          intent?: string | null
          origen?: string
          phone?: string | null
          preview?: string | null
          status?: string
          status_at?: string | null
          template_name?: string | null
          wa_message_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          error_code?: number | null
          error_title?: string | null
          id?: string
          intent?: string | null
          origen?: string
          phone?: string | null
          preview?: string | null
          status?: string
          status_at?: string | null
          template_name?: string | null
          wa_message_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_envios_workspace_id_fkey"
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
          phone: string | null
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
          phone?: string | null
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
          phone?: string | null
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
      workspace_default_responsables: {
        Row: {
          area: string
          configured_by: string | null
          staff_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          area: string
          configured_by?: string | null
          staff_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          area?: string
          configured_by?: string | null
          staff_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_default_responsables_configured_by_fkey"
            columns: ["configured_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_default_responsables_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_default_responsables_workspace_id_fkey"
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
      workspace_modulos: {
        Row: {
          activo_desde: string
          activo_hasta: string | null
          created_at: string
          id: string
          modulo: string
          motivo: string
          origen: string
          registrado_por: string
          servicio_contratado_id: string | null
          workspace_id: string
        }
        Insert: {
          activo_desde: string
          activo_hasta?: string | null
          created_at?: string
          id?: string
          modulo: string
          motivo: string
          origen: string
          registrado_por: string
          servicio_contratado_id?: string | null
          workspace_id: string
        }
        Update: {
          activo_desde?: string
          activo_hasta?: string | null
          created_at?: string
          id?: string
          modulo?: string
          motivo?: string
          origen?: string
          registrado_por?: string
          servicio_contratado_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_modulos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_modulos_servicio_fk"
            columns: ["servicio_contratado_id"]
            isOneToOne: false
            referencedRelation: "servicios_contratados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_modulos_workspace_id_fkey"
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
          config_extra: Json
          cotizacion_template_slug: string
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
          config_extra?: Json
          cotizacion_template_slug?: string
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
          config_extra?: Json
          cotizacion_template_slug?: string
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
      v_cardumen_live: {
        Row: {
          created_at: string | null
          estudio: string | null
          id: string | null
          lang: string | null
          payload: Json | null
        }
        Relationships: []
      }
      v_cartera_negocio: {
        Row: {
          codigo: string | null
          dias: number | null
          honorario: number | null
          honorario_recaudado: number | null
          negocio_id: string | null
          nombre: string | null
          saldo: number | null
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
      v_cobro_valor: {
        Row: {
          a_tarifa: number | null
          a_tramo1: number | null
          a_tramo1_base: number | null
          a_tramo2: number | null
          a_tramo2_base: number | null
          cobro_id: string | null
          completa_tramo1: boolean | null
          completa_tramo2: boolean | null
          excedente: number | null
          fecha: string | null
          iva_frac: number | null
          iva_origen: string | null
          linea_id: string | null
          monto: number | null
          negocio_id: string | null
          tipo_cobro: string | null
          workspace_id: string | null
        }
        Relationships: [
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
            referencedRelation: "v_cartera_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_marketing_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_mc_negocio"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_atribucion"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_bonificable"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_negocio_valor"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "v_venta_mes_comercial"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cobros_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negocios_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
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
      v_marketing_campana: {
        Row: {
          account_id: string | null
          campaign_id: string | null
          campana: string | null
          clicks: number | null
          currency: string | null
          formularios: number | null
          gasto: number | null
          honorario: number | null
          impressions: number | null
          leads: number | null
          mes: string | null
          negocios: number | null
          primer_lead: string | null
          recaudado: number | null
          sin_rastro: boolean | null
          sincronizado_at: string | null
          status: string | null
          ultimo_lead: string | null
          ventas: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_marketing_negocio: {
        Row: {
          campaign_id: string | null
          campana_payload: string | null
          cliente: string | null
          codigo: string | null
          comercial: string | null
          estado: string | null
          etapa: string | null
          fecha_venta: string | null
          honorario: number | null
          mes_creacion: string | null
          mes_venta: string | null
          negocio_id: string | null
          nombre: string | null
          recaudado: number | null
          seccional: string | null
          tiene_rastro_meta: boolean | null
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
      v_mc_linea_mes: {
        Row: {
          costos_variables: number | null
          ingresos: number | null
          linea_id: string | null
          linea_nombre: string | null
          linea_tipo: string | null
          mc: number | null
          mc_pct: number | null
          mes: string | null
          recaudo_terceros: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_mc_negocio: {
        Row: {
          costos_variables: number | null
          estado: string | null
          gastos_count: number | null
          iva_declarado: boolean | null
          iva_frac: number | null
          iva_origen: string | null
          mc: number | null
          mc_pct: number | null
          negocio_codigo: string | null
          negocio_id: string | null
          negocio_nombre: string | null
          precio_aprobado: number | null
          precio_estimado: number | null
          stage_actual: string | null
          valor_base: number | null
          valor_iva: number | null
          valor_total: number | null
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
      v_negocio_atribucion: {
        Row: {
          atribucion_en_conflicto: boolean | null
          campana: string | null
          comision_retenida: boolean | null
          contacto_id: string | null
          n_conversiones: number | null
          negocio_id: string | null
          origen_declarado: string | null
          primera_conversion: string | null
          tiene_rastro_meta: boolean | null
          ultima_conversion: string | null
          workspace_id: string | null
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
            foreignKeyName: "negocios_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_negocio_bonificable: {
        Row: {
          bonificable: boolean | null
          linea_id: string | null
          negocio_id: string | null
          orden_umbral: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negocios_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
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
      v_negocio_comercial: {
        Row: {
          comercial_staff_id: string | null
          negocio_id: string | null
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
      v_negocio_valor: {
        Row: {
          es_estimado: boolean | null
          iva_declarado: boolean | null
          iva_frac: number | null
          iva_origen: string | null
          linea_id: string | null
          negocio_id: string | null
          plan_pago: number | null
          techo_tarifa: number | null
          techo_tramo1: number | null
          techo_tramo2: number | null
          topar_por_valor: boolean | null
          valor_aprobado_base: number | null
          valor_aprobado_iva: number | null
          valor_aprobado_total: number | null
          valor_base: number | null
          valor_iva: number | null
          valor_techo: number | null
          valor_total: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negocios_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
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
      v_negocios_etapa_vencimiento: {
        Row: {
          abiertos: number | null
          etapa_id: string | null
          etapa_nombre: string | null
          etapa_orden: number | null
          linea_id: string | null
          sla_horas: number | null
          vencidos: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "etapas_negocio_linea_id_fkey"
            columns: ["linea_id"]
            isOneToOne: false
            referencedRelation: "lineas_negocio"
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
          fijos_nomina: number | null
          fijos_recurrentes: number | null
          fijos_total: number | null
          ingresos: number | null
          ingresos_con_iva: number | null
          iva_recaudado: number | null
          mc: number | null
          mc_pct: number | null
          mes: string | null
          recaudo_terceros: number | null
          tarifa_recaudada: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_tutorial_adopcion: {
        Row: {
          completados: number | null
          descartados: number | null
          iniciados: number | null
          tasa_completacion_pct: number | null
          tutorial_slug: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tutorial_progress_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_venta_mes_comercial: {
        Row: {
          bonificable: boolean | null
          caso_completo: boolean | null
          codigo: string | null
          contacto_id: string | null
          created_at: string | null
          estado: string | null
          fecha_honorario_cubierto: string | null
          fecha_venta: string | null
          honorario_con_iva: number | null
          honorario_recaudado: number | null
          honorario_sin_iva: number | null
          negocio_id: string | null
          nombre: string | null
          origen_declarado: string | null
          plan_pago: number | null
          primer_pago: number | null
          responsable_id: string | null
          segundo_pago: number | null
          tarifa: number | null
          workspace_id: string | null
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
            foreignKeyName: "negocios_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      apply_plantilla_to_workspace: {
        Args: { p_linea_id: string; p_workspace_id: string }
        Returns: undefined
      }
      assert_workspace_del_usuario: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      audit_block_slug_refs: {
        Args: { p_linea_id: string }
        Returns: {
          clase: string
          host_nombre: string
          ok: boolean
          problema: string
          slug_ref: string
        }[]
      }
      audit_flujo_coherencia: {
        Args: { p_linea_id: string }
        Returns: {
          afectados: number
          clase: string
          detalle: string
          etapa: string
          etapa_orden: number
          ok: boolean
          severidad: string
        }[]
      }
      audit_workflow_refs: {
        Args: { p_linea_id: string }
        Returns: {
          clase: string
          donde_vive: string
          host_etapa: number
          host_nombre: string
          ok: boolean
          tgt_bloque: number
          tgt_campo: string
          tgt_etapa: number
        }[]
      }
      avisar_documento_al_cliente: {
        Args: { p_bloque_config_id: string; p_negocio_id: string }
        Returns: boolean
      }
      bloque_nace_completo: {
        Args: { p_config_extra: Json; p_es_gate: boolean; p_estado: string }
        Returns: boolean
      }
      borrar_secreto_accion_aceptacion: {
        Args: { p_accion_id: string }
        Returns: boolean
      }
      buscar_contacto_duplicado: {
        Args: {
          p_email?: string
          p_excluir_id?: string
          p_telefono?: string
          p_usuario_whatsapp?: string
          p_workspace_id: string
        }
        Returns: {
          email: string
          id: string
          motivo: string
          nombre: string
          telefono: string
          usuario_whatsapp: string
        }[]
      }
      calidad_bloque_periodo: {
        Args: { p_desde: string; p_hasta: string; p_workspace_id: string }
        Returns: Json
      }
      calidad_llamada_es_mia: {
        Args: { p_llamada_id: string }
        Returns: boolean
      }
      calidad_ranking_periodo: {
        Args: {
          p_desde: string
          p_hasta: string
          p_nombre_completo?: boolean
          p_workspace_id: string
        }
        Returns: Json
      }
      calidad_reparto_cuotas: {
        Args: { p_desde: string; p_hasta: string; p_workspace_id: string }
        Returns: Json
      }
      calidad_ve_todo_el_piso: { Args: never; Returns: boolean }
      cardumen_payload_publico: {
        Args: { claves: string[]; p: Json }
        Returns: Json
      }
      cardumen_poda_textual: { Args: { v: Json }; Returns: Json }
      check_perfil_fiscal_completo: {
        Args: { p_empresa_id: string }
        Returns: boolean
      }
      claim_bloque_lock: {
        Args: {
          p_bloque_instancia_id: string
          p_profile_id: string
          p_ttl_minutes?: number
          p_workspace_id: string
        }
        Returns: Json
      }
      cleanup_expired_bloque_locks: { Args: never; Returns: number }
      comision_coherente: { Args: { c: Json }; Returns: boolean }
      compliance_cerrar_relacion_sujeto: {
        Args: {
          p_actor: string
          p_fecha: string
          p_motivo: string
          p_sujeto_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      compliance_reabrir_relacion_sujeto: {
        Args: {
          p_actor: string
          p_fecha: string
          p_motivo: string
          p_sujeto_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      compliance_registrar_evento_sujeto: {
        Args: {
          p_actor: string
          p_detalle: string
          p_evento: string
          p_motivo: string
          p_sujeto_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      compliance_registrar_version_documento: {
        Args: {
          p_aprobacion_referencia?: string
          p_aprobado_por?: string
          p_cargado_por?: string
          p_documento_id: string
          p_drive_file_id?: string
          p_fecha_aprobacion?: string
          p_hash_sha256?: string
          p_notas?: string
          p_url: string
          p_version: string
          p_vigente_desde: string
          p_workspace_id: string
        }
        Returns: string
      }
      condicion_cumplida: {
        Args: {
          p_cond: Json
          p_etapa_actual_id: string
          p_linea_id: string
          p_negocio_id: string
        }
        Returns: boolean
      }
      congelar_config_bono_meses_pasados: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      count_negocios_por_conciliar: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      count_negocios_por_conciliar_sin_guarda: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      crear_notificacion: {
        Args: {
          p_contenido: string
          p_deep_link?: string
          p_destinatario_id: string
          p_entidad_id?: string
          p_entidad_tipo?: string
          p_metadata?: Json
          p_permitir_repetidas?: boolean
          p_tipo: string
          p_workspace_id: string
        }
        Returns: string
      }
      crear_notificacion_equipo: {
        Args: {
          p_area: string
          p_contenido: string
          p_deep_link?: string
          p_entidad_id?: string
          p_entidad_tipo?: string
          p_excluir_profile_id?: string
          p_grupo_clave: string
          p_metadata?: Json
          p_tipo: string
          p_workspace_id: string
        }
        Returns: number
      }
      cs_estado_pagos: {
        Args: { p_negocio_id: string }
        Returns: {
          cuotas_pagadas: number
          cuotas_totales: number
          hay_vencido: boolean
          monto_vencido: number
          pagado: number
          precio_total: number
          proxima_fecha: string
          proxima_monto: number
          saldo: number
          ultimo_pago_fecha: string
          ultimo_pago_monto: number
        }[]
      }
      cs_identificar_cliente: {
        Args: { p_phone: string; p_workspace_id: string }
        Returns: {
          ambiguo: boolean
          caso_codigo: string
          contacto_id: string
          contacto_nombre: string
          etapa_nombre: string
          etapa_numero: number
          negocio_id: string
          precio_aprobado: number
          producto: string
          responsable: string
          stage: string
        }[]
      }
      current_user_profile_role: { Args: never; Returns: string }
      current_user_staff_id: { Args: never; Returns: string }
      current_user_workspace_id: { Args: never; Returns: string }
      debe_alertar_inactividad: {
        Args: { p_negocio_id: string }
        Returns: boolean
      }
      debe_alertar_responsable_faltante: {
        Args: { p_negocio_id: string }
        Returns: boolean
      }
      destinatarios_negocio: {
        Args: { p_negocio_id: string }
        Returns: {
          profile_id: string
          via: string
        }[]
      }
      detectar_responsable_faltante_area: { Args: never; Returns: number }
      dias_habiles_entre: {
        Args: { d_desde: string; d_hasta: string }
        Returns: number
      }
      dias_habiles_sin_actividad: {
        Args: { p_negocio_id: string }
        Returns: number
      }
      email_cliente_negocio: { Args: { p_negocio_id: string }; Returns: string }
      emails_cliente_negocio: {
        Args: { p_negocio_ids: string[] }
        Returns: {
          email: string
          negocio_id: string
        }[]
      }
      etapa_del_aviso_entrada: {
        Args: { p_linea_id: string; p_metadata: Json }
        Returns: string
      }
      evaluate_stage_rules: {
        Args: {
          p_entidad_id: string
          p_entidad_tipo: string
          p_workspace_id: string
        }
        Returns: string
      }
      evaluate_stage_rules_sin_guarda: {
        Args: {
          p_entidad_id: string
          p_entidad_tipo: string
          p_workspace_id: string
        }
        Returns: string
      }
      fecha_de_texto: { Args: { t: string }; Returns: string }
      force_unlock_bloque: {
        Args: { p_bloque_instancia_id: string; p_forced_by: string }
        Returns: Json
      }
      funnelchat_contactos_por_telefono: {
        Args: { p_nacional: string; p_workspace_id: string }
        Returns: {
          id: string
          nombre: string
          segmento: string
          telefono: string
        }[]
      }
      fusionar_contactos: {
        Args: { p_ganador: string; p_perdedor: string; p_workspace_id: string }
        Returns: Json
      }
      gates_pendientes_etapa: {
        Args: { p_etapa_id: string; p_negocio_id: string }
        Returns: {
          bloque_config_id: string
          nombre: string
          orden: number
          tipo: string
        }[]
      }
      gen_cert_short_code: { Args: never; Returns: string }
      generate_cert_lote_numero: {
        Args: { p_producto: string; p_sku: string; p_workspace: string }
        Returns: string
      }
      generate_cuenta_cobro_numero: {
        Args: { p_anio: number; p_mes: number; p_workspace_id: string }
        Returns: string
      }
      generate_cuenta_cobro_numero_sin_guarda: {
        Args: { p_anio: number; p_mes: number; p_workspace_id: string }
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
      get_calidad_dinero: {
        Args: { p_dias?: number; p_workspace_id: string }
        Returns: Json
      }
      get_calidad_equipo: {
        Args: { p_desde: string; p_hasta: string; p_workspace_id: string }
        Returns: Json
      }
      get_calidad_lista: {
        Args: {
          p_dias?: number
          p_limite?: number
          p_staff_id?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      get_calidad_muro: {
        Args: { p_fecha?: string; p_workspace_id: string }
        Returns: Json
      }
      get_calidad_perfil_agente: {
        Args: {
          p_agente: string
          p_desde: string
          p_hasta: string
          p_workspace_id: string
        }
        Returns: Json
      }
      get_capacidad_seccional_soena: {
        Args: { p_desde: string; p_hasta: string; p_workspace_id: string }
        Returns: Json
      }
      get_comercial_kpis_mes_soena: {
        Args: { p_anio: number; p_mes: number; p_workspace_id: string }
        Returns: Json
      }
      get_comercial_origen_mes_soena: {
        Args: {
          p_anio: number
          p_mes: number
          p_responsable_id?: string
          p_sin_responsable?: boolean
          p_workspace_id: string
        }
        Returns: Json
      }
      get_comercial_pagos_mes_soena: {
        Args: { p_anio: number; p_mes: number; p_workspace_id: string }
        Returns: Json
      }
      get_comercial_perdidos_mes_soena: {
        Args: { p_anio: number; p_mes: number; p_workspace_id: string }
        Returns: Json
      }
      get_comercial_perfil_soena: {
        Args: { p_anio?: number; p_mes?: number; p_responsable_id: string }
        Returns: Json
      }
      get_comercial_plan_pago_mes_soena: {
        Args: {
          p_anio: number
          p_mes: number
          p_responsable_id?: string
          p_sin_responsable?: boolean
          p_workspace_id: string
        }
        Returns: Json
      }
      get_comercial_resumen_soena: {
        Args: { p_anio?: number; p_mes?: number; p_workspace_id: string }
        Returns: Json
      }
      get_comercial_seccional_mes_soena: {
        Args: {
          p_anio: number
          p_mes: number
          p_responsable_id?: string
          p_sin_responsable?: boolean
          p_workspace_id: string
        }
        Returns: Json
      }
      get_comercial_serie_mensual_soena: {
        Args: { p_meses?: number; p_workspace_id: string }
        Returns: Json
      }
      get_comercial_serie_seccional_soena: {
        Args: { p_meses?: number; p_workspace_id: string }
        Returns: Json
      }
      get_comercial_serie_vendedor_soena: {
        Args: { p_meses?: number; p_workspace_id: string }
        Returns: Json
      }
      get_comercial_ventas_mes_soena: {
        Args: {
          p_anio: number
          p_campana?: string
          p_dia?: string
          p_mes: number
          p_negocio_ids?: string[]
          p_responsable_id?: string
          p_sin_responsable?: boolean
          p_solo_bonificables?: boolean
          p_solo_completos?: boolean
          p_workspace_id: string
        }
        Returns: Json
      }
      get_directivo_soena: {
        Args: { p_anio: number; p_mes: number; p_workspace_id: string }
        Returns: Json
      }
      get_next_cotizacion_consecutivo: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      get_operaciones_bono_detalle: {
        Args: { p_anio: number; p_mes: number; p_staff_id: string }
        Returns: Json
      }
      get_operaciones_bono_resumen: {
        Args: { p_anio: number; p_mes: number; p_workspace_id: string }
        Returns: Json
      }
      get_profile_by_role: {
        Args: { p_role: string; p_workspace_id: string }
        Returns: string
      }
      get_rentabilidad_comercial: {
        Args: {
          p_anio?: number
          p_linea?: string
          p_mes?: string
          p_vendedor?: string
        }
        Returns: Json
      }
      get_user_role: { Args: never; Returns: string }
      get_vendedor_perfil: { Args: { p_vendedor: string }; Returns: Json }
      get_vendedores_resumen: { Args: never; Returns: Json }
      guardar_field_map_formulario: {
        Args: { p_form_id: string; p_mapa: Json; p_workspace_id: string }
        Returns: undefined
      }
      guardar_secreto_workspace: {
        Args: { p_clave: string; p_valor: string; p_workspace_id: string }
        Returns: undefined
      }
      heartbeat_bloque_lock: {
        Args: {
          p_bloque_instancia_id: string
          p_profile_id: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      horas_habiles_entre: {
        Args: { end_ts: string; start_ts: string }
        Returns: number
      }
      horas_habiles_jornada: {
        Args: {
          p_desde: string
          p_hasta: string
          p_jornada_fin?: number
          p_jornada_inicio?: number
          p_sabado_habil?: boolean
        }
        Returns: number
      }
      horas_habiles_negocios: {
        Args: { p_ids: string[] }
        Returns: {
          horas: number
          negocio_id: string
        }[]
      }
      is_admin_or_owner: { Args: never; Returns: boolean }
      leer_secreto_accion_aceptacion: {
        Args: { p_accion_id: string }
        Returns: string
      }
      leer_secretos_workspace: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      limpiar_telefono: { Args: { p_telefono: string }; Returns: string }
      mis_cobros_de_servicio: {
        Args: { p_servicio_contratado_id: string }
        Returns: {
          cobro_id: string
          concepto: string
          estado: string
          fecha: string
          fuente: string
          monto: number
          recibo_numero: string
          recibo_origen: string
          recibo_path: string
        }[]
      }
      mis_documentos_de_servicio: {
        Args: never
        Returns: {
          aceptado_at: string
          aceptado_calidad: string
          aceptado_canal: string
          aceptado_por: string
          alcance: string
          documento_id: string
          pdf_bucket: string
          pdf_path: string
          pdf_sha256: string
          slug: string
          texto_md: string
          titulo: string
          version: string
          vigente_desde: string
          vigente_hasta: string
        }[]
      }
      mis_servicios: {
        Args: never
        Returns: {
          disparador_cobro: string
          es_pagador: boolean
          estado: string
          modulo: string
          negocio_nombre: string
          servicio_contratado_id: string
          servicio_nombre: string
          servicio_slug: string
          servicio_version: number
          vigente_desde: string
          vigente_hasta: string
        }[]
      }
      negocio_bloques_campos_json: {
        Args: { p_negocio_ids: string[]; p_pares: Json }
        Returns: {
          negocio_id: string
          valores: Json
        }[]
      }
      negocio_exige_honorario_confirmado: {
        Args: { p_negocio_id: string }
        Returns: boolean
      }
      negocio_puede_recibir_cobro: {
        Args: { p_negocio_id: string }
        Returns: boolean
      }
      negocios_ultima_actividad: {
        Args: { p_ids: string[] }
        Returns: {
          debe_alertar: boolean
          dias_habiles: number
          negocio_id: string
          ultima_actividad: string
          umbral_dias: number
        }[]
      }
      objetos_purga_bot_por_borrar: {
        Args: never
        Returns: {
          bucket: string
          id: string
          ruta: string
        }[]
      }
      omitir_owner_en_notificaciones: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      plazos_pendientes: {
        Args: { p_linea_id: string }
        Returns: {
          ancla_origen: string
          codigo: string
          dias_habiles: number
          dias_transcurridos: number
          etapa: string
          fecha_ancla: string
          festivos_cargados: boolean
          hito: string
          hito_titulo: string
          negocio_id: string
          nombre: string
          workspace_id: string
        }[]
      }
      proyectar_modulos: { Args: { p_workspace_id: string }; Returns: Json }
      puede_avanzar_etapa: {
        Args: { p_etapa_id: string; p_negocio_id: string }
        Returns: boolean
      }
      purgar_registros_bot: { Args: never; Returns: Json }
      reclamar_export_negocios_file_id: {
        Args: { p_file_id: string; p_workspace_id: string }
        Returns: string
      }
      registrar_email_alterno: {
        Args: {
          p_contacto_id: string
          p_email: string
          p_fuente?: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      registrar_version_catalogo: {
        Args: {
          p_definicion: Json
          p_fuente_ruta: string
          p_fuente_sha256: string
          p_slug: string
          p_version: number
        }
        Returns: Json
      }
      release_bloque_lock: {
        Args: { p_bloque_instancia_id: string; p_profile_id: string }
        Returns: Json
      }
      resolver_grupo_notificaciones: {
        Args: {
          p_grupo_clave: string
          p_resuelta_por?: string
          p_workspace_id: string
        }
        Returns: number
      }
      resolver_notificaciones_obsoletas: {
        Args: never
        Returns: {
          motivo: string
          resueltas: number
        }[]
      }
      ruta_documento_aceptacion: { Args: { p_url: string }; Returns: string }
      sembrar_casillas_bloque: {
        Args: { p_bloque_config_id: string }
        Returns: number
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soltar_export_negocios_file_id: {
        Args: { p_file_id: string; p_workspace_id: string }
        Returns: boolean
      }
      sumar_dias_habiles: {
        Args: { d_desde: string; n_dias: number }
        Returns: string
      }
      telefono_cliente_negocio: {
        Args: { p_negocio_id: string }
        Returns: string
      }
      telefono_movil_co: { Args: { p_crudo: string }; Returns: string }
      telefono_utilizable: { Args: { p_telefono: string }; Returns: string }
      telefono_valido: { Args: { p_telefono: string }; Returns: boolean }
      tomar_proceso_snapshot: { Args: never; Returns: number }
      ultima_actividad_negocio: {
        Args: { p_negocio_id: string }
        Returns: string
      }
      umbral_inactividad_negocio: {
        Args: { p_negocio_id: string }
        Returns: number
      }
      unaccent: { Args: { "": string }; Returns: string }
      usuario_whatsapp_comparable: {
        Args: { p_usuario: string }
        Returns: string
      }
      wa_aplicar_status: {
        Args: {
          p_error_code?: number
          p_error_title?: string
          p_phone?: string
          p_status: string
          p_status_at?: string
          p_wa_message_id: string
        }
        Returns: undefined
      }
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
      wa_rango_status: { Args: { p_status: string }; Returns: number }
      workspace_por_secreto: {
        Args: { p_clave: string; p_valor: string }
        Returns: string
      }
    }
    Enums: {
      cuenta_cobro_estado:
        | "borrador"
        | "emitida_pendiente_aprobacion"
        | "aprobada_lista_envio"
        | "enviada"
        | "pagada"
        | "conciliada"
        | "anulada"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cuenta_cobro_estado: [
        "borrador",
        "emitida_pendiente_aprobacion",
        "aprobada_lista_envio",
        "enviada",
        "pagada",
        "conciliada",
        "anulada",
      ],
    },
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
export type Suscripcion = Database['public']['Tables']['suscripciones']['Row']
export type TeamInvitation = Database['public']['Tables']['team_invitations']['Row']
export type TimeEntry = Database['public']['Tables']['time_entries']['Row']
export type Workspace = Database['public']['Tables']['workspaces']['Row']
export type WorkspaceFeature = Database['public']['Tables']['workspace_features']['Row']
export type WorkspaceStageRow = Database['public']['Tables']['workspace_stages']['Row']
export type ValidaConsulta = Database['public']['Tables']['valida_consultas']['Row']
export type TutorialProgress = Database['public']['Tables']['tutorial_progress']['Row']
export type CuentaCobroEmitida = Database['public']['Tables']['cuentas_cobro_emitidas']['Row']
export type PlanillaPilaPeriodo = Database['public']['Tables']['planillas_pila_periodo']['Row']

