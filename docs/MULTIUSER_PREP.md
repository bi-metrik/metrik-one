# MeTRIK ONE — Preparacion para Multiusuario (98G)

> Documento generado: 2026-02-26
> Feature principal de la siguiente version

---

## Vision: De 1 usuario a equipos completos

El MVP actual funciona para el **dueno del negocio** como usuario principal. La version multiusuario (codename **98G**) debe permitir equipos de 2-15 personas con permisos granulares.

---

## 1. Lo que YA esta listo

### 1.1 Multi-tenancy (Fundacion solida)
- ✅ `workspace_id` en TODAS las tablas
- ✅ RLS policies con `current_user_workspace_id()`
- ✅ Subdomain routing (`slug.metrikone.co`)
- ✅ Tabla `profiles` con `role` por usuario
- ✅ Tabla `team_invitations` para invitar por email

### 1.2 Sistema de Roles (4 niveles)
- ✅ `owner` — Todo
- ✅ `admin` — Operativo completo, sin fiscal/invitaciones
- ✅ `operator` — Ejecutor, registra gastos/horas
- ✅ `read_only` — Auditor, solo lectura + exportar

### 1.3 Permisos en codigo
- ✅ `src/lib/roles.ts` con 16 flags de permiso
- ✅ Sidebar filtra items por rol
- ✅ FAB condicionado por `canUseFab`
- ✅ Server actions validan permisos antes de ejecutar
- ✅ Causacion (D246) ya respeta `canApproveCausacion` / `canCausar`

### 1.4 Trazabilidad
- ✅ `created_by` en gastos y cobros (con FK a profiles)
- ✅ `causaciones_log` para auditoria contable
- ✅ `opportunity_stage_history` para cambios de pipeline
- ✅ `audit_log` tabla generica (sin triggers aun)

### 1.5 Invitaciones
- ✅ Server actions para invitar (`config/team-actions.ts`)
- ✅ Pagina `/accept-invite` para aceptar
- ✅ Asignar rol al invitar

### 1.6 WhatsApp Colaboradores
- ✅ Tabla `wa_collaborators` (phone, name, role)
- ✅ Webhook identifica usuario por telefono
- ✅ `created_by` se asigna en registros via WhatsApp (solo owner por ahora)

---

## 2. Lo que FALTA para multiusuario completo

### 2.1 Roles expandidos (5 niveles → 98G)

El plan 98G define 5 niveles:

| Nivel | Rol | Descripcion |
|-------|-----|-------------|
| 1 | **Dueno** | Control total. Fiscal, billing, invitaciones |
| 2 | **Administrador** | Gestion operativa completa |
| 3 | **Supervisor** | Ve todo, aprueba, pero no configura |
| 4 | **Ejecutor** | Registra gastos, horas, avances |
| 5 | **Campo** | Solo WhatsApp (sin acceso app web) |

**Plus:** Rol **Contador** (transversal, solo causacion)

#### Que cambiar:
- `src/lib/roles.ts` — Agregar roles supervisor, ejecutor, campo, contador
- `profiles.role` — Expand CHECK constraint en BD
- Sidebar `ALL_NAV_ITEMS` — Agregar nuevos roles a cada item
- Cada server action — Revisar validaciones de permisos

### 2.2 Visibilidad de datos por rol

Actualmente todos ven todos los proyectos (excepto operator que solo ve propios). Falta:

| Concepto | Estado actual | Requerido |
|----------|--------------|-----------|
| Proyectos propios vs todos | Parcial (operator) | Completo para supervisor/ejecutor |
| Gastos propios vs todos | No implementado | Ejecutor solo ve los suyos |
| Pipeline por vendedor | No implementado | Cada vendedor ve su pipeline |
| Numeros por equipo | No implementado | Dashboard filtrado por rol |

#### Que cambiar:
- `getMovimientos()` — Filtro por `created_by` para ejecutor
- `getOpportunities()` — Filtro por vendedor asignado
- `getProyectos()` — Filtro por miembros del proyecto
- Tabla `proyecto_miembros` (por crear) — N:M proyectos ↔ profiles

### 2.3 Asignacion de trabajo

No existe concepto de "asignar tarea/proyecto a usuario":

| Tabla | Columna necesaria | Proposito |
|-------|------------------|----------|
| `proyectos` | `responsable_id` | Quien lidera el proyecto |
| `proyecto_miembros` | (nueva tabla) | Equipo del proyecto |
| `oportunidades` | `vendedor_id` | Vendedor asignado |
| `gastos` | ya tiene `created_by` | Quien registro |

### 2.4 Notificaciones

La tabla `notifications` existe pero no tiene triggers:

- Falta: Trigger cuando alguien aprueba/rechaza un movimiento
- Falta: Trigger cuando se asigna un proyecto
- Falta: Notificacion push (PWA o email)
- Falta: Centro de notificaciones en la UI

### 2.5 Activity Feed / Timeline

Para equipos, es critico ver "que paso hoy":

- Falta: Vista de actividad reciente del workspace
- Falta: Timeline por proyecto (quien hizo que)
- `audit_log` existe pero sin triggers automaticos
- `causaciones_log` es buen ejemplo del patron a seguir

### 2.6 WhatsApp para colaboradores

Actualmente solo el owner puede crear gastos via WhatsApp:

- `wa_collaborators` tiene phone + role
- `user.user_id` solo se asigna al owner en el webhook
- Falta: Lookup de `wa_collaborators.phone` → `profiles.id`
- Falta: Asignar `created_by` correcto para colaboradores
- Falta: Permisos WhatsApp por rol del colaborador

### 2.7 Contador como rol especial

El D246 prepara el camino pero falta:

- Rol `contador` con acceso SOLO a `/causacion`
- Sin acceso a numeros, pipeline, proyectos
- Puede causar pero NO puede aprobar (separacion de funciones)
- Invitacion especial "Invitar contador" con permisos limitados

---

## 3. Migraciones necesarias (estimado)

```sql
-- 1. Expand roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner','admin','supervisor','executor','field','accountant','read_only'));

-- 2. Tabla proyecto_miembros
CREATE TABLE proyecto_miembros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id UUID NOT NULL REFERENCES proyectos(id),
  profile_id UUID NOT NULL REFERENCES profiles(id),
  rol TEXT DEFAULT 'miembro', -- lider, miembro, observador
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(proyecto_id, profile_id)
);

-- 3. Responsable en proyectos y oportunidades
ALTER TABLE proyectos ADD COLUMN responsable_id UUID REFERENCES profiles(id);
ALTER TABLE oportunidades ADD COLUMN vendedor_id UUID REFERENCES profiles(id);

-- 4. Triggers para audit_log (ejemplo)
CREATE OR REPLACE FUNCTION fn_audit_insert() RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_log (table_name, record_id, action, new_data, user_id)
  VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), auth.uid());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 4. Orden sugerido de implementacion

| Paso | Que | Esfuerzo | Impacto |
|------|-----|----------|---------|
| 1 | Expandir roles en roles.ts (supervisor, ejecutor, campo, contador) | Bajo | Alto |
| 2 | Migracion: expand CHECK + tabla proyecto_miembros | Bajo | Medio |
| 3 | Visibilidad de datos por rol (filtros en server actions) | Medio | Alto |
| 4 | WhatsApp: lookup colaborador → profile → created_by | Medio | Alto |
| 5 | Asignacion: responsable_id + vendedor_id | Bajo | Medio |
| 6 | Rol contador: acceso limitado a /causacion | Bajo | Medio |
| 7 | Notificaciones: triggers + centro de notificaciones | Alto | Medio |
| 8 | Activity feed / timeline | Alto | Medio |

---

## 5. Riesgos y consideraciones

### Performance
- Mas usuarios = mas queries simultaneas
- RLS ya escala bien (filtro a nivel BD)
- Considerar: connection pooling (PgBouncer) si >10 usuarios concurrentes

### Seguridad
- Cada server action DEBE validar permisos (ya lo hacemos con `getRolePermissions`)
- WhatsApp: validar que colaborador pertenece al workspace antes de ejecutar acciones
- Auditar: todo cambio de rol debe quedar en audit_log

### UX
- Onboarding para usuarios invitados (diferente al del owner)
- Dashboard adaptado por rol (ejecutor no necesita ver numeros)
- Mobile-first para rol campo (solo WhatsApp + app basica)

### Migracion de datos
- No rompe nada: nuevos roles son aditivos
- Registros existentes siguen funcionando (roles actuales no cambian)
- `created_by` ya backfilleado para trazabilidad historica
