---
doc_id: 98G
version: 1.0
updated: 2026-02-26
depends_on: [21], [99], [98B], [98C], [98F]
depended_by: [98A], [98B], [98C], [98F]
decisiones: D129-D152
sesion: Diseño Roles + Activity Log + Reconstrucción v2 (sesión 7)
revisado_por: Max (Tech Lead), Kaori (Documentación), Hana (QA/Optimización), Vera (COO)
vigente: false
nota_vigencia: "Concepto base vigente pero desactualizado en detalles. Implementacion actual: 6 roles (owner/admin/supervisor/operator/contador/read_only) en src/lib/roles.ts. Activity Log en tabla activity_log. Ver metrik-one/CLAUDE.md seccion Sistema de roles para matriz de permisos actual."
---

# Spec: Sistema de Roles, Activity Log y Comentarios v1.0

Código: MOD-ROL. Capa transversal que define quién puede hacer qué dentro de MéTRIK ONE. Gobierna la edición, visibilidad, asignación y trazabilidad de acciones en todos los módulos. No es un módulo con tab propio — vive dentro de cada módulo existente.

Pregunta central: **"¿Quién hace qué, dónde, y cómo lo rastreamos?"**

---

## §1. Principio de diseño

El sistema de roles se basa en 3 ejes:

**Eje 1 — Nivel de usuario (rol global):** define qué tabs ve, qué configuración puede tocar, qué acciones globales puede ejecutar. Se asigna una vez en Mi Equipo.

**Eje 2 — Relación con el registro (rol por registro):** define si puede editar o solo consultar una oportunidad o proyecto específico. Se establece al asignar responsable o colaborador.

**Eje 3 — Canal de acceso:** define si interactúa vía app, WhatsApp o ambos. Restringe intenciones del bot.

Regla universal: **visibilidad amplia, edición restringida.** Todos los usuarios con acceso app ven Pipeline y Proyectos. Solo editan donde tienen relación (responsable o colaborador).

---

## §2. Niveles de usuario

5 niveles. Se asignan en Mi Equipo [99] §8 mediante la combinación de Rol + Área.

| Nivel | Quién es | Cómo se asigna | Revocable |
|-------|----------|----------------|-----------|
| **Dueño** | Creador de la cuenta | Automático al registrarse | No. Irrevocable. Siempre 1 mínimo |
| **Administrador** | Persona de confianza total (socio, implementador, contador) | Dueño otorga en Mi Equipo | Sí, solo por Dueño |
| **Supervisor** | Líder de equipo comercial u operativo | Dueño o Admin asigna en Mi Equipo | Sí, por Dueño o Admin |
| **Ejecutor** | Persona que trabaja en oportunidades y/o proyectos | Default al agregar persona con acceso app | Sí |
| **Campo** | Técnico en terreno, solo reporta | Automático si acceso = "Solo WhatsApp" | Sí |

### Acciones exclusivas del Dueño (no delegables a Administrador)

| Acción | Razón |
|--------|-------|
| Eliminar cuenta del tenant | Irreversible |
| Cambiar plan de facturación | Compromiso financiero |
| Revocar rol Administrador | Protección de cadena de confianza |

### Relación Dueño <-> Administrador

Funcionalmente idénticos en el 97% de las acciones. La diferencia es de gobernanza, no de funcionalidad. Un tenant puede tener múltiples Administradores (socios, persona de confianza, implementador externo como MéTRIK vía Clarity).

---

## §3. Áreas funcionales

4 áreas predeterminadas. Se seleccionan en Mi Equipo junto con el Rol. La combinación Rol + Área = cargo funcional del usuario.

| Área | Tooltip descriptivo |
|------|-------------------|
| **Comercial** | Ventas, atención al cliente, cotizaciones, relaciones comerciales |
| **Operaciones** | Ejecución de proyectos, trabajo en campo, producción, mantenimiento, logística |
| **Admin y Finanzas** | Contabilidad, facturación, cartera, asistencia administrativa, recursos humanos |
| **Dirección** | Gerencia general, toma de decisiones estratégicas, socios |

Los tooltips se muestran en un dropdown enriquecido — cada opción tiene su descripción visible debajo en texto gris, no como hover. Mismo tratamiento para el select de Rol.

### Combinaciones más comunes

| Rol + Área | Se lee como | Caso típico |
|-----------|-------------|-------------|
| Administrador - Dirección | Admin - Dirección | Socio, co-dueño |
| Administrador - Admin y Finanzas | Admin - Admin y Finanzas | Contador de confianza |
| Supervisor - Comercial | Supervisor - Comercial | Líder equipo de ventas |
| Supervisor - Operaciones | Supervisor - Operaciones | Jefe de proyectos / obra |
| Ejecutor - Comercial | Ejecutor - Comercial | Vendedor, closer |
| Ejecutor - Operaciones | Ejecutor - Operaciones | Coordinador, técnico con app |
| Ejecutor - Admin y Finanzas | Ejecutor - Admin y Finanzas | Auxiliar contable, asistente |
| Campo - Operaciones | Campo - Operaciones | Técnico de campo, operario, instalador |

Cualquier combinación es válida. El sistema no bloquea combinaciones inusuales (ej: Campo - Comercial para un promotor que solo reporta por WhatsApp).

---

## §4. Relación con registros

Cada oportunidad y cada proyecto tiene asignaciones que determinan quién puede editar.

### Responsable (1 por registro)

Persona que rinde cuentas por ese registro. Aparece con nombre en la tarjeta. Recibe alertas. Puede ejecutar todas las acciones sobre el registro, incluyendo decisiones de cierre.

| Campo | Tabla | Tipo | Notas |
|-------|-------|------|-------|
| `responsable_id` | `oportunidades` | UUID FK -> personal, nullable | Si null -> banner "sin responsable" |
| `responsable_id` | `proyectos` | UUID FK -> personal, nullable | Si null -> banner "sin responsable" |

**Default:** en tenant unipersonal (1 solo usuario), el Dueño es responsable automático de todo. No se muestra UI de asignación.

**Asignación:** Dueño, Administrador o Supervisor pueden asignar/cambiar responsable. El Supervisor, al crear una oportunidad, es obligado a asignar responsable en el mismo flujo (D145).

### Colaborador (N por registro)

Personas que ejecutan trabajo operativo pero no toman decisiones de cierre.

| Campo | Tabla | Tipo | Notas |
|-------|-------|------|-------|
| `colaboradores` | `oportunidades` | UUID[] | Array de personal.id. Default: vacío |
| `colaboradores` | `proyectos` | UUID[] | Array de personal.id. Default: vacío |

**Asignación:** Dueño, Administrador, Supervisor o Responsable del registro pueden agregar colaboradores.

**MVP nota:** UUID[] es suficiente. Si a futuro se requiere metadata por colaborador (fecha de asignación, quién lo agregó), se migra a tabla relacional `registro_colaboradores`.

### Sin relación

Cualquier usuario con acceso app que no es responsable ni colaborador. Ve el registro completo en read-only. Puede comentar.

---

## §5. Permisos por acción — Responsable vs Colaborador

### En Pipeline

| Acción | Responsable | Colaborador |
|--------|:-----------:|:-----------:|
| Crear/editar contactos y empresas | Si | Si |
| Agregar notas / comentarios | Si | Si |
| Mover oportunidad entre etapas | Si | No |
| Crear cotización borrador | Si | Si |
| Editar cotización borrador | Si | Si |
| Enviar cotización al cliente | Si | No |
| Marcar oportunidad como Ganada | Si | No |
| Marcar como Perdida/Descartada | Si | No |
| Editar datos fiscales empresa | Si | No |

### En Proyectos

| Acción | Responsable | Colaborador |
|--------|:-----------:|:-----------:|
| Registrar horas | Si | Si |
| Registrar gastos directos | Si | Si |
| Agregar notas / comentarios | Si | Si |
| Crear factura | Si | No |
| Registrar cobro | Si | No |
| Cambiar estado del proyecto | Si | No |
| Cerrar proyecto | Si | No |

**Principio de corte:** todo lo que compromete financieramente o cambia el estado del registro = solo responsable. Todo lo que es trabajo operativo del día a día = responsable + colaborador.

---

## §6. Matriz de permisos por tab y rol global

### Visibilidad de tabs

| Tab | Dueño | Admin | Supervisor | Ejecutor | Campo |
|-----|:-----:|:-----:|:----------:|:--------:|:-----:|
| Mis Números | Si | Si | No | No | No |
| Pipeline | Si | Si | Si | Si | No |
| Proyectos | Si | Si | Si | Si | No |
| Directorio | Si | Si | Si | Si | No |
| Mi Negocio | Si | Si | No | No | No |
| Notificaciones | Si | Si | Si | Si | No |

### Acciones en Pipeline (por rol global)

| Acción | Dueño/Admin | Supervisor | Ejecutor (responsable) | Ejecutor (colaborador) | Ejecutor (sin relación) |
|--------|:-----------:|:----------:|:---------------------:|:---------------------:|:----------------------:|
| Ver kanban completo | Si | Si | Si | Si | Si (read-only) |
| Crear contacto/empresa | Si | Si | Si | Si | Si |
| Crear oportunidad | Si | Si (con asignación obligatoria) | Si | — | — |
| Asignar responsable | Si | Si | No | No | No |
| Agregar colaborador | Si | Si | Si | No | No |
| Mover etapa | Si | No | Si | No | No |
| Crear/editar cotización borrador | Si | No | Si | Si | No |
| Enviar cotización | Si | No | Si | No | No |
| Marcar Ganada (handoff) | Si | No | Si | No | No |
| Marcar Perdida/Descartada | Si | No | Si | No | No |
| Editar datos fiscales empresa | Si | No | Si | No | No |
| Comentar | Si | Si | Si | Si | Si |

### Acciones en Proyectos (por rol global)

| Acción | Dueño/Admin | Supervisor | Ejecutor (responsable) | Ejecutor (colaborador) | Ejecutor (sin relación) |
|--------|:-----------:|:----------:|:---------------------:|:---------------------:|:----------------------:|
| Ver lista completa | Si | Si | Si | Si | Si (read-only) |
| Asignar responsable | Si | Si | No | No | No |
| Agregar colaborador | Si | Si | Si | No | No |
| Registrar horas | Si | No | Si | Si | No |
| Registrar gastos directos | Si | No | Si | Si | No |
| Crear factura | Si | No | Si | No | No |
| Registrar cobro | Si | No | Si | No | No |
| Cambiar estado | Si | No | Si | No | No |
| Cerrar proyecto | Si | No | Si | No | No |
| Crear proyecto interno | Si | No | No | No | No |
| Comentar | Si | Si | Si | Si | Si |

### Acciones en Directorio

| Acción | Dueño/Admin | Supervisor | Ejecutor |
|--------|:-----------:|:----------:|:--------:|
| Ver contactos y empresas | Si | Si | Si |
| Crear/editar | Si | Si | Si |
| Eliminar | Si | No | No |

### Acciones WhatsApp Bot (por rol)

| Intención | Dueño/Admin | Supervisor | Ejecutor | Campo |
|-----------|:-----------:|:----------:|:--------:|:-----:|
| W01 — Registrar gasto de proyecto | Si | Si | Si | Si (cualquier proyecto activo) |
| W01 — Registrar gasto de empresa | Si | No | No | No |
| W03 — Registrar horas | Si | Si | Si | Si (cualquier proyecto activo) |
| W05 — Registrar cobro | Si | Si | Si | No |
| W09 — Nota/comentario oportunidad | Si | Si | Si | No |
| W13 — Consultar proyecto | Si | Si | Si | Si |
| W16 — Consultar números | Si | No | No | No |
| W32 — Actualizar saldo banco | Si | No | No | No |

**Campo — restricciones:**
- Solo puede registrar contra proyectos con `estado = 'activo'`.
- No requiere asignación previa al proyecto. Registra contra cualquier proyecto activo del tenant.
- Si menciona un proyecto cerrado/pausado -> bot responde: "Ese proyecto no está activo."

**Gastos de empresa vs proyecto:** si el mensaje de WhatsApp menciona un proyecto -> gasto de proyecto (validación normal de roles). Si no menciona proyecto -> gasto de empresa -> solo Dueño/Admin.

### Acciones de cuenta

| Acción | Dueño | Admin | Supervisor | Ejecutor | Campo |
|--------|:-----:|:-----:|:----------:|:--------:|:-----:|
| Cambiar plan/facturación | Si | No | No | No | No |
| Eliminar cuenta | Si | No | No | No | No |
| Otorgar/revocar Administrador | Si | No | No | No | No |
| Otorgar/revocar Supervisor | Si | Si | No | No | No |
| Exportar datos (CSV) | Si | Si | No | No | No |
| Gestionar equipo (Mi Equipo) | Si | Si | No | No | No |

---

## §7. Handoff: Pipeline -> Proyectos

Cuando una oportunidad se marca como Ganada:

1. Hard gate fiscal se valida (datos fiscales empresa completos — D41 de [98B]).
2. Sistema muestra paso: **"¿Quién va a ejecutar este proyecto?"** con selector de personas del equipo.
3. Si selecciona alguien -> proyecto se crea con ese `responsable_id`.
4. Si salta (botón "Asignar después") -> proyecto se crea con `responsable_id = NULL`.
5. Proyecto con `responsable_id = NULL` genera banner persistente.

**Banner "Proyectos sin responsable":**

Visible para Dueño, Administrador y Supervisor en la vista de Proyectos.

> [ATENCION] Hay [N] proyectos sin responsable asignado.

Query: `SELECT count(*) FROM proyectos WHERE responsable_id IS NULL AND estado = 'activo' AND tenant_id = X`. Desaparece cuando count = 0.

**Regla:** quien marca Ganada (el comercial) no necesariamente es quien decide quién ejecuta. La asignación del responsable de proyecto es potestad de Dueño/Admin/Supervisor.

---

## §8. Activity Log — Timeline unificado

Tabla única que unifica comentarios manuales, cambios automáticos y eventos del sistema. Se muestra como timeline cronológico en el detalle de oportunidades y proyectos.

### Modelo de datos

```sql
CREATE TABLE activity_log (
 id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 entidad_tipo TEXT NOT NULL CHECK (entidad_tipo IN ('oportunidad', 'proyecto')),
 entidad_id UUID NOT NULL,
 tipo TEXT NOT NULL CHECK (tipo IN ('comentario', 'cambio', 'sistema')),
 autor_id UUID REFERENCES personal(id),
 campo_modificado TEXT,
 valor_anterior TEXT,
 valor_nuevo TEXT,
 contenido TEXT CHECK (char_length(contenido) <= 280),
 mencion_id UUID REFERENCES personal(id),
 link_url TEXT,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_log_entidad ON activity_log(tenant_id, entidad_tipo, entidad_id, created_at DESC);
CREATE INDEX idx_activity_log_menciones ON activity_log(mencion_id) WHERE mencion_id IS NOT NULL;

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON activity_log
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
CREATE POLICY "insert_app_users" ON activity_log FOR INSERT
 WITH CHECK (
 tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
 AND tipo = 'comentario'
 );
```

### Tipos de entrada

| Tipo | Quién genera | Ícono UI | Campos usados |
|------|-------------|----------|---------------|
| `comentario` | Usuario (manual) | | contenido (max 280 chars), mencion_id (0 o 1), link_url (0 o 1) |
| `cambio` | Trigger automático | ⚡ | campo_modificado, valor_anterior, valor_nuevo, autor_id |
| `sistema` | Edge Function / cron | | contenido (generado por sistema) |

### Restricciones de comentarios (D148)

Un comentario = **280 caracteres + máximo 1 mención + máximo 1 link**.

| Restricción | Valor | Razón |
|-------------|-------|-------|
| Caracteres máximo | 280 | Fuerza claridad. Sin tratados. |
| Menciones máximo | 1 (un solo `mencion_id`) | Evita spam a toda la empresa. Un interesado principal. |
| Links máximo | 1 (un solo `link_url`) | Un archivo relevante, no 10. |
| Links cuentan en caracteres | No | El URL puede ser largo; el texto es lo que importa. |

### Detección de links

Regex para detectar URLs en el texto: `https?://[^\s]+`. Si se detecta más de una URL, solo se acepta la primera. El link se extrae del texto y se guarda en `link_url`. Se renderiza como chip clickeable con ícono según dominio:

| Dominio | Ícono |
|---------|-------|
| drive.google.com | Google Drive |
| docs.google.com | Google Docs |
| onedrive.live.com, 1drv.ms | OneDrive |
| dropbox.com | Dropbox |
| Otro | Link genérico |

El link abre en nueva pestaña. ONE no autentica contra estos servicios. El usuario necesita permisos propios.

**Fuera de MVP:** preview del documento (thumbnail, nombre). Requiere OAuth con cada servicio.

### UI del input de comentario

```
┌─────────────────────────────────────────────────┐
│ [Texto libre hasta 280 chars...............] │
│ │
│ @María López × drive.google/... × │
│ 148/280 │
└─────────────────────────────────────────────────┘
```

Botones dedicados para @ y . Al agregar 1 mención, el botón @ se desactiva. Al agregar 1 link, el botón se desactiva.

### UI del timeline

```
 Mauricio — hace 2 hrs @Laura
 "Cliente confirmó presupuesto, procedo con cotización"
 drive.google.com/propuesta_v2

⚡ Laura — hace 1 hr
 Cambió etapa: Negociación -> Propuesta enviada

⚡ Laura — hace 45 min
 Creó cotización COT-0042 por $12.500.000

 Laura — hace 30 min
 "Cotización enviada por email, espera respuesta lunes"

 Sistema — hace 5 min
 Cotización COT-0042 vencida (sin respuesta en 15 días)
```

### Triggers audit log

On UPDATE en `oportunidades` y `proyectos`, un trigger de Postgres captura:

```sql
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER AS $$
DECLARE
 col TEXT;
 old_val TEXT;
 new_val TEXT;
BEGIN
 FOR col IN SELECT column_name FROM information_schema.columns
 WHERE table_name = TG_TABLE_NAME
 AND column_name NOT IN ('updated_at', 'created_at')
 LOOP
 EXECUTE format('SELECT ($1).%I::TEXT', col) INTO old_val USING OLD;
 EXECUTE format('SELECT ($1).%I::TEXT', col) INTO NEW_val USING NEW;
 IF old_val IS DISTINCT FROM new_val THEN
 INSERT INTO activity_log (
 tenant_id, entidad_tipo, entidad_id, tipo,
 autor_id, campo_modificado, valor_anterior, valor_nuevo
 ) VALUES (
 NEW.tenant_id,
 CASE TG_TABLE_NAME
 WHEN 'oportunidades' THEN 'oportunidad'
 WHEN 'proyectos' THEN 'proyecto'
 END,
 NEW.id,
 'cambio',
 auth.uid(),
 col,
 old_val,
 new_val
 );
 END IF;
 END LOOP;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_oportunidades
 AFTER UPDATE ON oportunidades
 FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_proyectos
 AFTER UPDATE ON proyectos
 FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
```

---

## §9. Concurrencia — Optimistic Locking (D150)

Cuando dos personas editan el mismo registro simultáneamente, el sistema usa optimistic locking para evitar sobreescritura silenciosa.

**Flujo:**

1. Al abrir registro para editar, se captura `updated_at` del registro.
2. Al guardar, se verifica: `WHERE id = X AND updated_at = [capturado]`.
3. Si el `updated_at` cambió (otra persona guardó entre tanto) -> UPDATE no aplica.
4. UI muestra modal: "Este registro fue modificado por [nombre] mientras lo editabas. Recarga para ver los cambios."

**Implementación:** campo `updated_at TIMESTAMPTZ DEFAULT NOW()` con trigger `ON UPDATE SET updated_at = NOW()` en `oportunidades` y `proyectos`. El frontend envía `expected_updated_at` en cada PATCH/PUT.

**Fuera de MVP:** indicador de presencia en tiempo real ("María está editando este registro") vía Supabase Realtime Presence.

---

## §10. Notificaciones

### Modelo de datos

```sql
CREATE TABLE notificaciones (
 id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 destinatario_id UUID NOT NULL REFERENCES personal(id),
 tipo TEXT NOT NULL CHECK (tipo IN (
 'mencion', 'asignacion_responsable', 'asignacion_colaborador',
 'cambio_etapa', 'cambio_estado', 'handoff', 'sin_responsable',
 'cobro_registrado', 'cotizacion_vencida', 'inactividad_oportunidad'
 )),
 referencia_tipo TEXT NOT NULL CHECK (referencia_tipo IN ('oportunidad', 'proyecto')),
 referencia_id UUID NOT NULL,
 contenido TEXT NOT NULL,
 leida BOOLEAN DEFAULT false,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notificaciones_destinatario ON notificaciones(destinatario_id, leida, created_at DESC);

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solo_mis_notificaciones" ON notificaciones
 USING (destinatario_id = auth.uid());
```

### Notificaciones por rol

**Dueño / Administrador:**

| Notificación | Trigger |
|-------------|---------|
| Proyecto creado sin responsable | Handoff sin asignación |
| Oportunidad sin actividad >14 días | Cron semanal |
| Cambio de semáforo en Números | Evaluación automática |
| Runway < 2 meses | Cálculo P5 |
| Mención @ en comentario | INSERT activity_log con mencion_id |
| Cobro registrado | INSERT cobro por colaborador/responsable |
| Nuevo usuario agregado al tenant | INSERT personal |

**Supervisor:**

| Notificación | Trigger |
|-------------|---------|
| Proyecto sin responsable | Banner persistente |
| Oportunidad sin actividad >14 días | Cron semanal |
| Cambio de etapa en oportunidad | UPDATE oportunidad.etapa |
| Cambio de estado en proyecto | UPDATE proyecto.estado |
| Mención @ en comentario | INSERT activity_log con mencion_id |
| Oportunidad marcada como Ganada | Trigger handoff |

**Ejecutor:**

| Notificación | Trigger |
|-------------|---------|
| Asignado como responsable | UPDATE responsable_id = mi id |
| Agregado como colaborador | UPDATE colaboradores array contains mi id |
| Mención @ en comentario | INSERT activity_log con mencion_id |
| Cambio en registro donde soy responsable | UPDATE en oportunidad/proyecto por otro usuario |
| Cotización vencida | fecha_validez < hoy en cotización que creé |

**Campo:**

| Notificación | Canal | Trigger |
|-------------|-------|---------|
| Registro confirmado | WhatsApp | Bot confirma gasto/hora registrado |
| Registro rechazado | WhatsApp | Bot no pudo asociar a proyecto activo |

### UI — Campana 

Ícono de campana en header de la app con badge numérico (notificaciones no leídas). Al tocar: lista cronológica. Cada notificación tiene link directo al registro. Tocar = marca como leída.

**MVP:** solo notificaciones in-app. Email y push se agregan en fase posterior cuando el sistema de notificaciones general esté maduro.

---

## §11. Refactor Mi Equipo [99] §8

El formulario actual de Mi Equipo se reemplaza completamente.

### Campos eliminados

| Campo | Razón |
|-------|-------|
| Cargo (texto libre) | Reemplazado por Rol + Área como llave de cargo |
| Departamento (texto libre) | Redundante con Área. En equipos <50 no hay departamentos |

### Campos que se mantienen

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Nombre completo | Text | Sí | — |
| Salario / Honorario | Currency | Sí | Label contextual según tipo vínculo |
| Horas disponibles/mes | Number | Sí | Default: 160 |
| Costo hora | Calculado | — | = Salario ÷ Horas. Display-only |
| Teléfono WhatsApp | Phone | Condicional | Obligatorio si acceso incluye WhatsApp |
| Tipo contrato | Select | No | Contrato fijo / Prestación de servicios / Obra labor / Otro. Útil para cálculo de prestaciones |
| Tipo vínculo | Select | No | Empleado / Contratista / Freelance |

### Campos nuevos

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Rol | Select enriquecido | Sí | Administrador / Supervisor / Ejecutor / Campo. Con tooltip descriptivo por opción |
| Área | Select enriquecido | Sí | Comercial / Operaciones / Admin y Finanzas / Dirección. Con tooltip descriptivo por opción |
| Acceso | Radio | Sí | App / WhatsApp / Ambos |

### Etiqueta de cargo

La combinación Rol + Área se muestra como etiqueta informativa: "Ejecutor - Comercial". No es un campo editable — se construye en tiempo real.

### Reglas de validación

| Regla | Lógica |
|-------|--------|
| Rol = Campo -> Acceso se fuerza a " WhatsApp" | Campo no tiene acceso app |
| Rol = Campo -> Área se sugiere "Operaciones" | Permite cambiar, pero 90% es operaciones |
| Acceso = "Solo WhatsApp" -> Rol se sugiere "Campo" | Consistencia |
| Rol = Administrador -> Acceso forzado a " App" o " Ambos" | Admin sin app no tiene sentido |
| WhatsApp obligatorio si Acceso incluye WhatsApp | Ya existía |
| Rol "Dueño" no aparece en el select | Solo asignable automáticamente al creador |

### Asignación automática de rol_plataforma

Trigger on INSERT/UPDATE en `personal`:

| Selección del usuario en UI | `rol_plataforma` asignado |
|----------------------------|--------------------------|
| Rol = Campo (o Acceso = Solo WhatsApp) | `campo` |
| Rol = Ejecutor | `ejecutor` |
| Rol = Supervisor | `supervisor` |
| Rol = Administrador | `administrador` |
| Creador de la cuenta (no seleccionable) | `dueño` |

---

## §12. Modelo de datos — Cambios a tablas

### Tabla `personal` — agregar campos

```sql
ALTER TABLE personal ADD COLUMN IF NOT EXISTS rol_plataforma TEXT DEFAULT 'ejecutor'
 CHECK (rol_plataforma IN ('dueño', 'administrador', 'supervisor', 'ejecutor', 'campo'));
ALTER TABLE personal ADD COLUMN IF NOT EXISTS area TEXT
 CHECK (area IN ('comercial', 'operaciones', 'admin_finanzas', 'direccion'));

COMMENT ON COLUMN personal.rol_plataforma IS 'Nivel de permisos global del usuario. Determina visibilidad de tabs y acciones globales.';
COMMENT ON COLUMN personal.area IS 'Área funcional. Combinado con rol_plataforma = cargo funcional.';
```

### Tabla `oportunidades` — agregar campos

```sql
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS responsable_id UUID REFERENCES personal(id);
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS colaboradores UUID[] DEFAULT '{}';

COMMENT ON COLUMN oportunidades.responsable_id IS 'Persona responsable. Null = sin responsable (genera banner).';
COMMENT ON COLUMN oportunidades.colaboradores IS 'Array de personal.id que colaboran. Pueden ejecutar acciones operativas.';
```

### Tabla `proyectos` — agregar campos

```sql
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS responsable_id UUID REFERENCES personal(id);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS colaboradores UUID[] DEFAULT '{}';
```

### Flag equipo_activo

```sql
CREATE OR REPLACE VIEW v_equipo_activo AS
SELECT tenant_id, count(*) > 1 AS equipo_activo
FROM personal
WHERE activo = true
GROUP BY tenant_id;
```

Controla visibilidad UI: si `equipo_activo = false`, se ocultan controles de asignación de responsable/colaboradores. El independiente solo no ve complejidad innecesaria.

---

## §13. Funciones helper para RLS

```sql
CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS BOOLEAN AS $$
 SELECT EXISTS (
 SELECT 1 FROM personal
 WHERE id = auth.uid()
 AND tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
 AND rol_plataforma IN ('dueño', 'administrador')
 );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
 SELECT rol_plataforma FROM personal
 WHERE id = auth.uid()
 AND tenant_id = (auth.jwt() ->> 'tenant_id')::UUID;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_responsible_or_collaborator(p_entidad_tipo TEXT, p_entidad_id UUID)
RETURNS TEXT AS $$
DECLARE
 v_responsable UUID;
 v_colaboradores UUID[];
 v_user_id UUID := auth.uid();
BEGIN
 IF p_entidad_tipo = 'oportunidad' THEN
 SELECT responsable_id, colaboradores INTO v_responsable, v_colaboradores
 FROM oportunidades WHERE id = p_entidad_id;
 ELSIF p_entidad_tipo = 'proyecto' THEN
 SELECT responsable_id, colaboradores INTO v_responsable, v_colaboradores
 FROM proyectos WHERE id = p_entidad_id;
 END IF;

 IF v_responsable = v_user_id THEN RETURN 'responsable';
 ELSIF v_user_id = ANY(v_colaboradores) THEN RETURN 'colaborador';
 ELSE RETURN 'ninguno';
 END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
```

### RLS Policies principales

**Números + Mi Negocio (solo Dueño/Admin):**

```sql
CREATE POLICY "admin_only" ON config_metas
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID AND is_admin_or_owner());

-- Mismo patrón para: saldos_banco, streaks, gastos_fijos_config, cuentas_bancarias, servicios
```

**Pipeline y Proyectos (SELECT abierto, UPDATE por relación):**

```sql
CREATE POLICY "tenant_read" ON oportunidades FOR SELECT
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY "edit_by_role" ON oportunidades FOR UPDATE
 USING (
 tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
 AND (
 is_admin_or_owner()
 OR responsable_id = auth.uid()
 OR auth.uid() = ANY(colaboradores)
 )
 );

-- Mismo patrón para proyectos
```

**Nota:** las restricciones finas (colaborador no puede mover etapa, solo responsable puede cerrar) se implementan en Edge Functions, no en RLS. RLS controla acceso a la fila; la lógica de negocio controla qué campos/acciones están permitidas.

---

## §14. Registro de decisiones

| # | Decisión | Definición | Quién decidió |
|---|----------|-----------|---------------|
| D129 | Modelo de roles basado en flujo de trabajo | No se ocultan tabs; la edición depende de la relación con el registro (responsable/colaborador) | Mauricio directo Si |
| D130 | 5 niveles de usuario | Dueño, Administrador, Supervisor, Ejecutor, Campo | Hana -> Mauricio Si |
| D131 | Responsable único por registro | 1 responsable por oportunidad/proyecto. Accountability clara | Hana -> Mauricio Si |
| D132 | Colaboradores con acciones operativas | N colaboradores. Ejecutan trabajo diario, no decisiones de cierre | Mauricio directo Si |
| D133 | Dueño replicable como Administrador | Dueño puede otorgar acceso Administrador (socios, implementadores, confianza). Mismo acceso funcional excepto 3 acciones exclusivas | Mauricio directo Si |
| D134 | Campo sin restricción de asignación a proyecto | Registra gastos/horas contra cualquier proyecto activo vía WhatsApp. Sin gate de asignación | Mauricio directo Si |
| D135 | Campo solo en proyectos activos | Si proyecto cerrado/pausado -> bot rechaza registro | Hana -> Mauricio Si |
| D136 | Handoff con asignación opcional + banner | Al marcar Ganada se pregunta quién ejecuta. Si salta -> banner persistente "proyectos sin responsable" | Mauricio directo Si |
| D137 | Números y Mi Negocio solo Dueño/Admin | Supervisor, Ejecutor y Campo no ven estos tabs | Mauricio directo Si |
| D138 | Supervisor limitado a Pipeline + Proyectos + Directorio | Puede visualizar movimientos, asignar, comentar. No ejecuta | Mauricio directo Si |
| D139 | 4 áreas funcionales | Comercial, Operaciones, Admin y Finanzas, Dirección. Con dropdown enriquecido + tooltip | Mauricio + Hana Si |
| D140 | Cargo = Rol + Área | Se elimina campo texto libre "Cargo" y "Departamento". La combinación genera la etiqueta de cargo | Mauricio directo Si |
| D141 | Tipo contrato se mantiene | Útil para cálculo de prestaciones. Opciones: Contrato fijo, Prestación de servicios, Obra labor, Otro | Mauricio directo Si |
| D142 | Dropdowns enriquecidos con tooltip | Tanto Rol como Área muestran descripción de cada opción en el dropdown, no como hover | Mauricio directo Si |
| D143 | Gastos de empresa solo Dueño/Admin | Gastos no asociados a proyecto (operativos) solo los registra Dueño o Administrador | Hana -> Mauricio Si |
| D144 | Supervisor crea oportunidad con asignación obligatoria | El supervisor no ejecuta; al crear debe asignar responsable inmediatamente | Hana -> Mauricio Si |
| D145 | UI oculta asignación si equipo no activo | Si tenant tiene 1 solo usuario, controles de responsable/colaborador no se muestran | Hana -> Mauricio Si |
| D146 | Asignación automática de rol según selección UI | Trigger mapea la selección de Rol en UI a `rol_plataforma` en BD | Hana -> Mauricio Si |
| D147 | Activity log unificado | Comentarios + cambios automáticos + eventos sistema en una sola tabla y un solo timeline | Max + Hana -> Mauricio Si |
| D148 | Comentarios: 280 chars + 1 mención + 1 link | Sin tratados. Links no cuentan en caracteres. Fuerza claridad | Mauricio directo Si |
| D149 | Links como chips clickeables por dominio | Detección regex. Ícono según dominio (Drive, OneDrive, Dropbox, genérico). Sin preview de documento en MVP | Max -> Mauricio Si |
| D150 | Optimistic locking para concurrencia | Verificación `updated_at` al guardar. Modal de conflicto si otro usuario modificó el registro | Max -> Mauricio Si |
| D151 | Notificaciones in-app MVP | Campana con badge. Sin email/push en MVP | Max -> Mauricio Si |
| D152 | Reconstrucción v2 desde cero | No sobreescribir v1. Repositorio nuevo, tablas limpias. v1 queda como referencia. Lógica de negocio se porta | Vera + Max -> Mauricio Si |

---

## §15. Plan de reconstrucción v2 — Sprints

**Decisión D152:** reconstrucción completa desde cero. Repositorio nuevo. Las tablas nacen con la arquitectura de roles desde el CREATE, no ALTER. La v1 queda como referencia para portar lógica de negocio (cálculos fiscales, cotizaciones, fórmulas de Números).

### Sprint 0: Infraestructura base + Roles + Mi Equipo

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | CREATE `tenants` y `personal` con `rol_plataforma` y `area` desde el inicio | 2 |
| 2 | Funciones helper: `is_admin_or_owner()`, `get_user_role()`, `is_responsible_or_collaborator()` | 3 |
| 3 | Auth + registro: creador del tenant = `dueño` automático | 2 |
| 4 | Mi Equipo: formulario nuevo (Rol + Área con dropdowns enriquecidos, tipo contrato, tipo vínculo, acceso, costo hora) | 8-10 |
| 5 | Trigger asignación automática de rol según selección UI | 2 |
| 6 | View `v_equipo_activo` | 1 |
| 7 | RLS base en tenants + personal | 2 |
| | **Subtotal** | **20-22** |

**Gate:** 5 usuarios de prueba (uno por rol) logueados. Dueño ve Mi Equipo completo. Roles asignados correctamente.

### Sprint 1: Mi Negocio [99] completo

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | Navegación global 5 tabs con visibilidad por rol | 4-6 |
| 2 | §3 Mi perfil fiscal | 3 |
| 3 | §4 Mi marca (logo + colores + preview) | 4 |
| 4 | §5 Mis servicios | 3 |
| 5 | §6 Mis gastos fijos | 3 |
| 6 | §7 Mi cuenta bancaria | 3 |
| 7 | §9 Mis metas | 3 |
| 8 | Barra progreso + onboarding primera vez | 4 |
| 9 | RLS config: solo `is_admin_or_owner()` en todas las tablas | 2 |
| | **Subtotal** | **29-31** |

**Gate:** las 7 secciones completas. Barra llega al 100%. Solo Dueño/Admin acceden. Ejecutor/Supervisor/Campo no ven tab.

### Sprint 2: Pipeline + Directorio [98B]

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | CREATE `contactos` + `empresas` con RLS | 3 |
| 2 | CREATE `oportunidades` con `responsable_id` + `colaboradores` | 3 |
| 3 | CREATE `cotizaciones` + `cotizacion_items` + `rubros` | 4 |
| 4 | Kanban con lógica edición por relación | 8-10 |
| 5 | UI asignación responsable/colaborador (visible si `equipo_activo`) | 3-4 |
| 6 | Flujo cotización completo (rápida + detallada) con cálculo fiscal | 8-10 |
| 7 | Directorio (contactos + empresas + promotores) | 4-5 |
| 8 | RLS Pipeline | 3-4 |
| | **Subtotal** | **36-43** |

**Gate:** flujo completo contacto -> empresa -> oportunidad -> cotización -> ganada. RLS verificado con 5 roles.

### Sprint 3: Proyectos [98C] + Handoff

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | CREATE `proyectos` con `responsable_id` + `colaboradores` + `tipo` | 3 |
| 2 | CREATE `facturas` + `cobros` + `horas_proyecto` | 3 |
| 3 | Handoff: Ganada -> "¿Quién ejecuta?" -> crear proyecto | 4-5 |
| 4 | Detalle proyecto con lógica edición por relación | 6-8 |
| 5 | Registro horas + gastos directos + facturas + cobros | 8-10 |
| 6 | Proyectos internos con fricción (D93-D94 de [98C]) | 3 |
| 7 | RLS Proyectos | 3-4 |
| 8 | Banner "proyectos sin responsable" | 2 |
| | **Subtotal** | **32-38** |

**Gate:** handoff funcional. Responsable edita, colaborador ejecuta operativo, sin-relación read-only. Banner visible si hay proyectos sin asignar.

### Sprint 4: Activity Log + Comentarios

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | CREATE `activity_log` con RLS | 2-3 |
| 2 | Triggers audit en `oportunidades` y `proyectos` | 4-5 |
| 3 | UI Timeline ( + ⚡ + intercalados, cronológico) | 5-7 |
| 4 | Input comentario: 280 chars + contador + 1 link (chip) + detección URL | 3-4 |
| 5 | Mención @: selector single-user, `mencion_id`, notificación on INSERT | 3-4 |
| 6 | Optimistic locking (`updated_at` check on save + modal conflicto) | 3-4 |
| | **Subtotal** | **20-27** |

**Gate:** timeline muestra cambios + comentarios intercalados. Mención genera notificación. Optimistic locking bloquea sobreescritura.

### Sprint 5: Notificaciones + Números [98A]

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | CREATE `notificaciones` + triggers por evento | 6-8 |
| 2 | UI campana (badge + lista + mark as read) | 4-5 |
| 3 | Módulo Números [98A]: 5 cards + semáforo + conciliación + streak | 20-25 |
| 4 | RLS Números: solo `is_admin_or_owner()` | 2 |
| 5 | Drill-downs P1-P5 | 10-12 |
| | **Subtotal** | **42-52** |

**Gate:** Números funcional con datos reales de Pipeline y Proyectos. Notificaciones llegan según matriz de roles. Solo Dueño/Admin ven.

### Sprint 6: WhatsApp [98F] + Validación de roles

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | Bot WhatsApp: 16 intenciones MVP con prompt maestro Gemini | 15-20 |
| 2 | Edge Function validación de rol antes de procesar intención | 3-4 |
| 3 | Campo: solo W01, W03, W13 contra proyectos activos | 2 |
| 4 | Gasto empresa vs proyecto: detección + restricción Dueño/Admin | 1 |
| 5 | W16 (números) + W32 (saldo): solo Dueño/Admin | 1 |
| 6 | Resumen semanal W29 | 3-4 |
| | **Subtotal** | **26-33** |

**Gate:** cada rol recibe solo las respuestas que le corresponden. Campo rechazado en intenciones no autorizadas.

### Sprint 7: UI adaptativa + Testing integral

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | UI adaptativa: controles visibles/ocultos por rol + `equipo_activo` | 4-6 |
| 2 | Responsive móvil completo | 6-8 |
| 3 | Test integral 5 usuarios simultáneos (1 por rol), todos los flujos | 6-8 |
| 4 | Test concurrencia (optimistic locking, 2 sesiones) | 2-3 |
| 5 | Fix bugs + polish | 6-8 |
| | **Subtotal** | **24-33** |

**Gate final:** todos los flujos verificados por rol. Cero acceso indebido. Responsive funcional.

---

## §16. Resumen de esfuerzo

| Sprint | Foco | Horas | Acumulado |
|--------|------|:-----:|:---------:|
| 0 | Infraestructura + Roles + Mi Equipo | 20-22 | 20-22 |
| 1 | Mi Negocio (7 secciones) | 29-31 | 49-53 |
| 2 | Pipeline + Directorio | 36-43 | 85-96 |
| 3 | Proyectos + Handoff | 32-38 | 117-134 |
| 4 | Activity Log + Comentarios | 20-27 | 137-161 |
| 5 | Notificaciones + Números | 42-52 | 179-213 |
| 6 | WhatsApp + Roles en bot | 26-33 | 205-246 |
| 7 | UI adaptativa + Testing | 24-33 | 229-279 |
| **Total** | | **229-279 hrs** | |

Estimación calendario: ~6-7 semanas a tiempo completo, ~8-10 semanas a ritmo realista con revisiones.

---

## §17. Dependencias con specs existentes

| Spec | Impacto | Acción requerida |
|------|---------|-----------------|
| [98B] Pipeline | Agregar `responsable_id` + `colaboradores` a oportunidades. Reemplazar notas con activity_log. RLS por rol | Reescribir en v2 |
| [98C] Proyectos | Agregar `responsable_id` + `colaboradores` a proyectos. Activity_log. RLS por rol | Reescribir en v2 |
| [98A] Números | RLS restrictivo: solo `is_admin_or_owner()` | Implementar en Sprint 5 |
| [98F] WhatsApp | Validación de rol antes de procesar intención. Gasto empresa vs proyecto | Implementar en Sprint 6 |
| [99] Mi Negocio | Refactor Mi Equipo §8: formulario nuevo con Rol + Área + Tipo contrato + Acceso. Eliminar Cargo y Departamento texto libre | Reescribir en Sprint 0 |

---

## §18. Features explícitamente fuera de MVP

| Feature | Razón | Fase estimada |
|---------|-------|---------------|
| Preview de documentos en links (thumbnail Drive/OneDrive) | Requiere OAuth por servicio. Rabbit hole | Fase 2 |
| Editar/eliminar comentarios | Trazabilidad. Si se puede eliminar, se pierde registro | Evaluar post-MVP |
| Reacciones en comentarios (, Si) | Nice-to-have, no crítico | Fase 2 |
| Hilos de respuesta (threads) | Complejidad UI. Comentarios lineales suficientes para equipos pequeños | Fase 2 |
| Notificación por email/push | Solo in-app para MVP. Email/push cuando sistema de notificaciones general madure | Fase 2 |
| Indicador de presencia ("María está editando") | Supabase Realtime Presence. Optimistic locking es suficiente para MVP | Fase 2 |
| Migración de datos v1 -> v2 | Datos de prueba. No críticos. Reconstrucción limpia | No aplica |
| Override de rol (cambiar rol que el sistema asignó automáticamente desde cargo) | 90% no lo necesita. Si se requiere, se puede ajustar Rol directamente en Mi Equipo | Evaluar post-MVP |
