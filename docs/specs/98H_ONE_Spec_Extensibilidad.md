---
doc_id: 98H
version: 1.0
updated: 2026-03-07
depends_on: [21], [98B], [98C], [98G], [99]
depended_by: [98A]
decisiones: D153-D156
sesion: Diseño Extensibilidad ONE (sesión directiva)
revisado_por: Max (Tech Lead), Vera (COO), Hana (Process Optimizer)
aprobado_por: Mauricio
vigente: false
nota_vigencia: "Niveles 1 (custom_fields + labels + herencia) y 2 (tenant_rules motor de reglas) IMPLEMENTADOS. Nivel 3 (modulos satelite via Module Federation) sigue post-MVP. Referencias a /pipeline y /proyectos son legacy. Ver metrik-one/CLAUDE.md."
---

# Spec Técnica: Extensibilidad ONE — Campos Custom, Reglas Condicionales y Módulos Satélite

Documento ejecutable para Max en Claude Code. Contiene los tres niveles de personalización de ONE, modelo de datos, lógica de negocio, y orden de implementación.

Pregunta central: **"¿Cómo personalizo ONE para un cliente sin romper el core?"**

---

## §0. Contexto y decisiones

ONE necesita soportar personalizaciones por cliente sin contaminar el código base. Tres niveles aprobados:

| Nivel | Qué es | Cómo se vende | Cuándo |
|-------|--------|---------------|--------|
| 1. Campos custom + herencia | Configuración por tenant dentro de ONE | Servicio Clarity (MéTRIK configura) | MVP v2 — Sprint 0 y Sprint 2 |
| 2. Reglas condicionales | Motor de reglas evaluado por Edge Functions | Servicio Clarity (MéTRIK configura) | Post-MVP (spec lista desde ahora) |
| 3. Módulos satélite | Frontend independiente integrado vía Module Federation | Projects — cotizado por sprint | Post-MVP estable (~3 meses producción) |

### Decisiones

| # | Decisión | Aprobación |
|---|----------|------------|
| D153 | Module Federation como arquitectura oficial de módulos satélite. 30-35 hrs estimadas, roadmap post-MVP estable | Mauricio directo ✅ |
| D154 | Campos custom (JSONB) entran al MVP v2. Solo configurables por MéTRIK (no expuestos al cliente en UI de Ajustes). Se monetiza como servicio Clarity | Mauricio directo ✅ |
| D155 | Reglas condicionales se documentan en este spec. Implementación post-MVP pero spec lista desde ahora | Mauricio directo ✅ |
| D156 | Tres niveles de personalización: campos custom (Clarity), reglas condicionales (Clarity), módulos satélite (Projects) | Consenso equipo ✅ |

---

## §1. Principio de diseño

**El core de ONE es sagrado.** Ninguna personalización de un cliente individual modifica el schema base, el código del repositorio principal, ni la lógica compartida entre tenants.

Tres reglas inquebrantables:

1. **Datos custom en JSONB** — nunca ALTER TABLE para un cliente
2. **Lógica custom en configuración** — nunca IF tenant_id = 'X' en código
3. **Pantallas custom en módulos externos** — nunca componentes condicionales por tenant en el frontend

---

## §2. Nivel 1 — Campos Custom

### §2.1 Modelo de datos

```sql
-- Definición de campos custom por tenant
CREATE TABLE custom_fields (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entidad TEXT NOT NULL CHECK (entidad IN ('oportunidad', 'proyecto', 'contacto', 'empresa')),
  nombre TEXT NOT NULL,                    -- Nombre visible: "Tipo de obra"
  slug TEXT NOT NULL,                      -- Key en JSONB: "tipo_obra"
  tipo TEXT NOT NULL CHECK (tipo IN ('text', 'number', 'select', 'boolean', 'date')),
  opciones JSONB DEFAULT NULL,            -- Para tipo 'select': ["Residencial", "Comercial", "Industrial"]
  obligatorio BOOLEAN DEFAULT false,
  orden INT DEFAULT 0,                     -- Orden de aparición en formulario
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, entidad, slug)
);

CREATE INDEX idx_custom_fields_tenant ON custom_fields(tenant_id, entidad, activo);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

-- CRÍTICO: Solo MéTRIK (dueño/admin) puede ver la definición.
-- En MVP, ni siquiera el dueño la configura — MéTRIK lo hace vía Clarity.
-- La policy permite lectura para renderizar los campos en formularios.
CREATE POLICY "tenant_read" ON custom_fields FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY "admin_write" ON custom_fields FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID AND is_admin_or_owner());
```

### §2.2 Almacenamiento de valores

Los valores se guardan en una columna JSONB dentro de cada entidad. **No crear tablas adicionales.**

```sql
-- Agregar columna a entidades existentes
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';
ALTER TABLE contactos ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

-- Índice GIN para consultas sobre campos custom
CREATE INDEX idx_oportunidades_custom ON oportunidades USING GIN (custom_data);
CREATE INDEX idx_proyectos_custom ON proyectos USING GIN (custom_data);
CREATE INDEX idx_contactos_custom ON contactos USING GIN (custom_data);
CREATE INDEX idx_empresas_custom ON empresas USING GIN (custom_data);
```

### §2.3 Ejemplo de datos

Definición del campo (tabla `custom_fields`):
```json
{
  "id": "uuid-1",
  "tenant_id": "tenant-constructora",
  "entidad": "oportunidad",
  "nombre": "Tipo de obra",
  "slug": "tipo_obra",
  "tipo": "select",
  "opciones": ["Residencial", "Comercial", "Industrial", "Infraestructura"],
  "obligatorio": true,
  "orden": 1
}
```

Valor almacenado (columna `oportunidades.custom_data`):
```json
{
  "tipo_obra": "Comercial",
  "area_m2": 1500,
  "requiere_interventoria": true
}
```

### §2.4 Renderizado dinámico en UI

El frontend lee `custom_fields` del tenant y renderiza los campos adicionales debajo de los campos estándar en cada formulario.

```typescript
// Hook para obtener campos custom de una entidad
function useCustomFields(entidad: 'oportunidad' | 'proyecto' | 'contacto' | 'empresa') {
  const { data } = useQuery(
    ['custom_fields', entidad],
    () => supabase
      .from('custom_fields')
      .select('*')
      .eq('entidad', entidad)
      .eq('activo', true)
      .order('orden')
  );
  return data || [];
}

// Componente genérico que renderiza campos custom
function CustomFieldsSection({ entidad, values, onChange }) {
  const fields = useCustomFields(entidad);
  
  if (fields.length === 0) return null;
  
  return (
    <div className="border-t pt-4 mt-4">
      <h3 className="text-sm font-medium text-gray-500 mb-3">
        Campos adicionales
      </h3>
      {fields.map(field => (
        <CustomFieldInput
          key={field.id}
          field={field}
          value={values[field.slug]}
          onChange={(val) => onChange(field.slug, val)}
        />
      ))}
    </div>
  );
}
```

Componente `CustomFieldInput` renderiza según `field.tipo`:
- `text` → input text
- `number` → input number
- `select` → dropdown con `field.opciones`
- `boolean` → toggle
- `date` → date picker

### §2.5 Validación

```typescript
// Edge Function: validar custom_data antes de INSERT/UPDATE
function validateCustomData(
  customData: Record<string, any>,
  fieldDefinitions: CustomField[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (const field of fieldDefinitions) {
    const value = customData[field.slug];
    
    // Obligatorio
    if (field.obligatorio && (value === undefined || value === null || value === '')) {
      errors.push(`Campo "${field.nombre}" es obligatorio`);
      continue;
    }
    
    if (value === undefined || value === null) continue;
    
    // Tipo
    switch (field.tipo) {
      case 'number':
        if (typeof value !== 'number') errors.push(`"${field.nombre}" debe ser numérico`);
        break;
      case 'boolean':
        if (typeof value !== 'boolean') errors.push(`"${field.nombre}" debe ser verdadero/falso`);
        break;
      case 'select':
        if (!field.opciones?.includes(value)) errors.push(`"${field.nombre}": opción no válida`);
        break;
      case 'date':
        if (isNaN(Date.parse(value))) errors.push(`"${field.nombre}": fecha no válida`);
        break;
    }
  }
  
  return { valid: errors.length === 0, errors };
}
```

### §2.6 Visibilidad de campos custom en listados y cards

Los campos custom marcados como `obligatorio` se muestran como pills/tags en las cards del kanban y en las filas de tabla. Los opcionales solo se ven en el detalle de la entidad.

---

## §3. Nivel 1.5 — Herencia de campos entre módulos

### §3.1 Modelo de datos

```sql
CREATE TABLE custom_field_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  origen_entidad TEXT NOT NULL,            -- 'oportunidad'
  origen_slug TEXT NOT NULL,               -- 'tipo_obra'
  destino_entidad TEXT NOT NULL,           -- 'proyecto'
  destino_slug TEXT NOT NULL,              -- 'tipo_obra' (puede ser diferente)
  activo BOOLEAN DEFAULT true,
  
  UNIQUE(tenant_id, origen_entidad, origen_slug, destino_entidad)
);

ALTER TABLE custom_field_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read" ON custom_field_mappings FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY "admin_write" ON custom_field_mappings FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID AND is_admin_or_owner());
```

### §3.2 Lógica de herencia en handoff

Cuando una oportunidad se marca como ganada y se crea el proyecto (handoff existente en [98C]), la Edge Function copia los campos custom según los mappings configurados:

```typescript
// Dentro de la Edge Function de handoff oportunidad → proyecto
async function heredarCamposCustom(
  tenantId: string,
  oportunidadCustomData: Record<string, any>,
  proyectoId: string
) {
  // Obtener mappings activos
  const { data: mappings } = await supabase
    .from('custom_field_mappings')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('origen_entidad', 'oportunidad')
    .eq('destino_entidad', 'proyecto')
    .eq('activo', true);
  
  if (!mappings || mappings.length === 0) return;
  
  const proyectoCustomData: Record<string, any> = {};
  
  for (const mapping of mappings) {
    const value = oportunidadCustomData[mapping.origen_slug];
    if (value !== undefined && value !== null) {
      proyectoCustomData[mapping.destino_slug] = value;
    }
  }
  
  if (Object.keys(proyectoCustomData).length > 0) {
    await supabase
      .from('proyectos')
      .update({ custom_data: proyectoCustomData })
      .eq('id', proyectoId);
  }
}
```

---

## §4. Nivel 2 — Reglas Condicionales

### §4.1 Modelo de datos

```sql
CREATE TABLE tenant_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nombre TEXT NOT NULL,                    -- "Marcar alta complejidad"
  descripcion TEXT,                        -- "Proyectos comerciales >$100M"
  entidad TEXT NOT NULL CHECK (entidad IN ('oportunidad', 'proyecto', 'contacto', 'empresa')),
  evento TEXT NOT NULL CHECK (evento IN ('create', 'update', 'status_change', 'handoff')),
  condiciones JSONB NOT NULL,             -- Array de condiciones (AND)
  acciones JSONB NOT NULL,                -- Array de acciones a ejecutar
  prioridad INT DEFAULT 0,                -- Orden de evaluación (mayor = primero)
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tenant_rules_eval ON tenant_rules(tenant_id, entidad, evento, activo);

ALTER TABLE tenant_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read" ON tenant_rules FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY "admin_write" ON tenant_rules FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID AND is_admin_or_owner());
```

### §4.2 Estructura de condiciones

Cada condición evalúa un campo (estándar o custom) contra un valor:

```json
{
  "condiciones": [
    {
      "campo": "custom_data.tipo_obra",
      "operador": "eq",
      "valor": "Comercial"
    },
    {
      "campo": "valor_estimado",
      "operador": "gt",
      "valor": 100000000
    }
  ]
}
```

Operadores soportados:

| Operador | Significado | Tipos válidos |
|----------|-------------|---------------|
| `eq` | Igual a | Todos |
| `neq` | Diferente de | Todos |
| `gt` | Mayor que | number, date |
| `gte` | Mayor o igual | number, date |
| `lt` | Menor que | number, date |
| `lte` | Menor o igual | number, date |
| `in` | Está en lista | text, select |
| `contains` | Contiene texto | text |
| `is_empty` | Está vacío | Todos |
| `is_not_empty` | No está vacío | Todos |

Todas las condiciones se evalúan con AND. Si se necesita OR, se crean reglas separadas.

### §4.3 Estructura de acciones

```json
{
  "acciones": [
    {
      "tipo": "set_field",
      "campo": "custom_data.complejidad",
      "valor": "Alta"
    },
    {
      "tipo": "set_label",
      "etiqueta": "proyecto_prioritario",
      "color": "#EF4444"
    },
    {
      "tipo": "notify",
      "destinatario": "dueño",
      "mensaje": "Nuevo proyecto de alta complejidad: {nombre}"
    }
  ]
}
```

Acciones soportadas:

| Tipo | Qué hace | Parámetros |
|------|----------|------------|
| `set_field` | Actualiza campo (estándar o custom) | campo, valor |
| `set_label` | Agrega etiqueta visible en card | etiqueta, color |
| `remove_label` | Quita etiqueta | etiqueta |
| `notify` | Envía notificación in-app | destinatario (dueño/admin/responsable), mensaje |
| `block_transition` | Impide cambio de estado/etapa | mensaje_error |

### §4.4 Motor de evaluación (Edge Function)

```typescript
// Edge Function: evaluar reglas del tenant
async function evaluarReglas(
  tenantId: string,
  entidad: string,
  evento: string,
  registro: Record<string, any>,
  registroAnterior?: Record<string, any>
) {
  const { data: reglas } = await supabase
    .from('tenant_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('entidad', entidad)
    .eq('evento', evento)
    .eq('activo', true)
    .order('prioridad', { ascending: false });
  
  if (!reglas || reglas.length === 0) return;
  
  for (const regla of reglas) {
    const cumple = evaluarCondiciones(regla.condiciones, registro);
    
    if (cumple) {
      await ejecutarAcciones(regla.acciones, tenantId, entidad, registro);
    }
  }
}

function evaluarCondiciones(
  condiciones: Condicion[],
  registro: Record<string, any>
): boolean {
  return condiciones.every(cond => {
    const valor = getNestedValue(registro, cond.campo); // Soporta "custom_data.tipo_obra"
    
    switch (cond.operador) {
      case 'eq': return valor === cond.valor;
      case 'neq': return valor !== cond.valor;
      case 'gt': return valor > cond.valor;
      case 'gte': return valor >= cond.valor;
      case 'lt': return valor < cond.valor;
      case 'lte': return valor <= cond.valor;
      case 'in': return Array.isArray(cond.valor) && cond.valor.includes(valor);
      case 'contains': return typeof valor === 'string' && valor.includes(cond.valor);
      case 'is_empty': return valor === null || valor === undefined || valor === '';
      case 'is_not_empty': return valor !== null && valor !== undefined && valor !== '';
      default: return false;
    }
  });
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}
```

### §4.5 Ejemplo completo

Cliente: constructora. Quiere que cuando una oportunidad de tipo "Comercial" con valor > $100M se marque como ganada, el proyecto heredado se etiquete como "Alta complejidad" y se notifique al dueño.

Definición de la regla:
```json
{
  "tenant_id": "tenant-constructora",
  "nombre": "Alta complejidad comercial",
  "descripcion": "Proyectos comerciales >$100M se marcan prioritarios",
  "entidad": "proyecto",
  "evento": "create",
  "condiciones": [
    { "campo": "custom_data.tipo_obra", "operador": "eq", "valor": "Comercial" },
    { "campo": "valor_estimado", "operador": "gt", "valor": 100000000 }
  ],
  "acciones": [
    { "tipo": "set_label", "etiqueta": "Alta complejidad", "color": "#EF4444" },
    { "tipo": "notify", "destinatario": "dueño", "mensaje": "Nuevo proyecto alta complejidad: {nombre}" }
  ],
  "prioridad": 10,
  "activo": true
}
```

---

## §5. Nivel 3 — Módulos Satélite (Module Federation)

### §5.1 Arquitectura

```
ONE (Host App)                         Módulo Custom (Remote)
┌──────────────────────┐              ┌──────────────────────┐
│ Next.js Host          │              │ Next.js Remote        │
│                       │              │                       │
│ ┌───────────────────┐ │   Module    │ ┌───────────────────┐ │
│ │ NavigationBar     │ │   Federation│ │ ComponenteCustom  │ │
│ │ ┌─────┐ ┌──────┐ │ │◄───────────►│ │                   │ │
│ │ │Tabs │ │Tab 6 │ │ │   Runtime   │ │ Lee/escribe vía   │ │
│ │ │1-5  │ │Custom│─┼─┼─────────────┼─┤ Supabase client   │ │
│ │ └─────┘ └──────┘ │ │             │ │ del tenant         │ │
│ └───────────────────┘ │              │ └───────────────────┘ │
│                       │              │                       │
│ Supabase client       │              │ Hereda auth session   │
│ (tenant_id en JWT)    │              │ Hereda theme/tokens   │
│                       │              │ Hereda componentes UI │
└──────────────────────┘              └──────────────────────┘
        Vercel                                 Vercel
      (repo ONE)                          (repo cliente)
```

### §5.2 Registro de módulos por tenant

```sql
CREATE TABLE tenant_modules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nombre TEXT NOT NULL,                    -- "Control de Obra"
  slug TEXT NOT NULL,                      -- "control-obra"
  icono TEXT DEFAULT 'puzzle',             -- Lucide icon name para el tab
  remote_url TEXT NOT NULL,                -- URL del módulo en Vercel
  remote_scope TEXT NOT NULL,              -- Scope de Module Federation
  remote_module TEXT NOT NULL,             -- Módulo expuesto: "./ControlObra"
  orden INT DEFAULT 99,                    -- Posición del tab (después de los 5 estándar)
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, slug)
);

ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read" ON tenant_modules FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY "admin_write" ON tenant_modules FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID AND is_admin_or_owner());
```

### §5.3 Navegación dinámica

El componente de navegación global lee `tenant_modules` y renderiza tabs adicionales:

```typescript
function NavigationBar() {
  const standardTabs = [
    { name: 'Números', path: '/numeros', icon: 'bar-chart-2' },
    { name: 'Oportunidades', path: '/oportunidades', icon: 'target' },
    { name: 'Proyectos', path: '/proyectos', icon: 'folder' },
    { name: 'Directorio', path: '/directorio', icon: 'users' },
    { name: 'Ajustes', path: '/ajustes', icon: 'settings' },
  ];
  
  const { data: customModules } = useQuery(
    ['tenant_modules'],
    () => supabase
      .from('tenant_modules')
      .select('*')
      .eq('activo', true)
      .order('orden')
  );
  
  const allTabs = [
    ...standardTabs,
    ...(customModules || []).map(mod => ({
      name: mod.nombre,
      path: `/modulos/${mod.slug}`,
      icon: mod.icono,
      isCustom: true,
      remoteConfig: {
        url: mod.remote_url,
        scope: mod.remote_scope,
        module: mod.remote_module,
      }
    }))
  ];
  
  return <TabBar tabs={allTabs} />;
}
```

### §5.4 SDK de integración para módulos remotos

Paquete npm liviano (`@metrik/one-sdk`) que el módulo custom importa:

```typescript
// @metrik/one-sdk — lo que expone ONE al módulo remoto
export interface OneSDK {
  // Auth
  getSession(): Promise<Session>;
  getTenantId(): string;
  
  // Supabase pre-configurado con tenant_id
  supabase: SupabaseClient;
  
  // Theme
  getTheme(): ThemeTokens;  // Colores del tenant (Mi Marca [99])
  
  // Componentes UI compartidos
  components: {
    Button, Input, Select, Toggle, DatePicker,
    Card, Modal, Table, Badge, EmptyState
  };
  
  // Navegación
  navigateTo(path: string): void;
  
  // Eventos (para comunicarse con ONE)
  emit(event: string, data: any): void;
  on(event: string, callback: (data: any) => void): void;
}
```

### §5.5 Webhooks (comunicación ONE → módulo)

```sql
CREATE TABLE webhook_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  modulo_id UUID REFERENCES tenant_modules(id),
  evento TEXT NOT NULL CHECK (evento IN (
    'oportunidad.created', 'oportunidad.updated', 'oportunidad.won', 'oportunidad.lost',
    'proyecto.created', 'proyecto.updated', 'proyecto.completed',
    'gasto.created', 'cobro.created',
    'contacto.created', 'contacto.updated'
  )),
  url TEXT NOT NULL,                       -- Endpoint del módulo que recibe el webhook
  secret TEXT NOT NULL,                    -- HMAC secret para verificación
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_only" ON webhook_subscriptions FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID AND is_admin_or_owner());
```

Edge Function que dispara webhooks:

```typescript
// Trigger genérico: se invoca desde los triggers de cada tabla
async function dispararWebhooks(
  tenantId: string,
  evento: string,
  payload: Record<string, any>
) {
  const { data: subs } = await supabase
    .from('webhook_subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('evento', evento)
    .eq('activo', true);
  
  if (!subs || subs.length === 0) return;
  
  for (const sub of subs) {
    const signature = createHmac('sha256', sub.secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    // Fire-and-forget con retry (Supabase pg_net o Edge Function fetch)
    await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ONE-Signature': signature,
        'X-ONE-Event': evento,
      },
      body: JSON.stringify({
        evento,
        tenant_id: tenantId,
        timestamp: new Date().toISOString(),
        data: payload,
      }),
    }).catch(err => {
      // Log error, no bloquear flujo principal
      console.error(`Webhook failed: ${sub.url}`, err);
    });
  }
}
```

---

## §6. Etiquetas (Labels)

Las reglas condicionales y la UI necesitan un sistema de etiquetas por entidad:

```sql
CREATE TABLE labels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entidad TEXT NOT NULL CHECK (entidad IN ('oportunidad', 'proyecto', 'contacto', 'empresa')),
  nombre TEXT NOT NULL,                    -- "Alta complejidad"
  color TEXT NOT NULL DEFAULT '#6B7280',   -- Hex color para badge
  created_by TEXT DEFAULT 'system',        -- 'system' | 'rule' | 'manual'
  
  UNIQUE(tenant_id, entidad, nombre)
);

-- Relación many-to-many: una entidad puede tener múltiples etiquetas
CREATE TABLE entity_labels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entidad TEXT NOT NULL,
  entidad_id UUID NOT NULL,
  label_id UUID NOT NULL REFERENCES labels(id),
  applied_by TEXT DEFAULT 'manual',        -- 'manual' | 'rule:{rule_id}'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, entidad_id, label_id)
);

CREATE INDEX idx_entity_labels_lookup ON entity_labels(tenant_id, entidad, entidad_id);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_access" ON labels
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
CREATE POLICY "tenant_access" ON entity_labels
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
```

---

## §7. Restricción de acceso MVP

**D154: Solo MéTRIK configura campos custom.** En el MVP, NO existe UI de configuración de campos custom ni reglas en la sección de Ajustes. MéTRIK configura directamente en base de datos (vía Supabase dashboard o script SQL) como parte del servicio Clarity.

Implicaciones para Max:

1. **No construir UI de administración de custom_fields en MVP.** Solo el renderizado dinámico en formularios.
2. **No construir UI de administración de tenant_rules.** Solo el motor de evaluación en Edge Functions.
3. **Documentar un script SQL de configuración** que MéTRIK ejecuta por cada cliente que compre el servicio.

Roadmap futuro (no MVP): UI en Ajustes → "Campos personalizados" y "Reglas automáticas", accesible solo para rol Dueño. Esto se habilita cuando se quiera dar self-service al cliente.

---

## §8. Plan de implementación

### Dentro del MVP v2 (12-15 horas adicionales)

| Sprint | Entregable | Horas |
|--------|-----------|:-----:|
| Sprint 0 | CREATE `custom_fields`, `custom_field_mappings`. Columnas `custom_data` JSONB en oportunidades, proyectos, contactos, empresas. Índices GIN. RLS | 3-4 |
| Sprint 0 | CREATE `labels`, `entity_labels`. RLS | 2 |
| Sprint 2 | Componente `CustomFieldsSection` + `CustomFieldInput` (renderizado dinámico) | 4-5 |
| Sprint 3 | Herencia de campos custom en handoff oportunidad → proyecto | 2-3 |
| Sprint 2-3 | Labels visibles en cards del kanban y filas de tabla | 2-3 |
| | **Subtotal MVP** | **13-18** |

### Post-MVP — Reglas condicionales (~15-20 horas)

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | CREATE `tenant_rules`. Motor de evaluación Edge Function | 6-8 |
| 2 | Integración: trigger en INSERT/UPDATE de oportunidades y proyectos que invoca `evaluarReglas()` | 3-4 |
| 3 | Acciones: `set_field`, `set_label`, `remove_label`, `notify` | 4-5 |
| 4 | Acción: `block_transition` (evalúa antes de permitir cambio de etapa/estado) | 2-3 |
| | **Subtotal reglas** | **15-20** |

### Post-MVP estable — Módulos satélite (~30-35 horas)

| # | Entregable | Horas |
|---|-----------|:-----:|
| 1 | Module Federation config en Next.js (host) | 6-8 |
| 2 | CREATE `tenant_modules`, `webhook_subscriptions`. RLS | 2-3 |
| 3 | Navegación dinámica con tabs custom | 4-5 |
| 4 | SDK `@metrik/one-sdk` (auth, supabase, theme, components, events) | 8-10 |
| 5 | Sistema de webhooks (Edge Function dispatcher) | 4-5 |
| 6 | Template de módulo remoto (repo boilerplate para Projects) | 3-4 |
| 7 | Documentación API pública ONE + contrato de estabilidad | 3 |
| | **Subtotal satélites** | **30-38** |

---

## §9. Verificaciones de implementación

### MVP (campos custom)

- [ ] Tenant sin campos custom: formularios se ven idénticos (zero visual impact)
- [ ] Tenant con 3 campos custom en oportunidad: aparecen debajo de campos estándar
- [ ] Campo obligatorio custom bloquea guardado si está vacío
- [ ] Campo tipo `select` muestra dropdown con opciones configuradas
- [ ] Handoff oportunidad → proyecto copia campos custom según mappings
- [ ] Labels aparecen como badges de color en cards del kanban
- [ ] `custom_data` se indexa correctamente (GIN) — query por campo custom < 100ms
- [ ] RLS: usuario de un tenant no ve campos custom de otro tenant

### Post-MVP (reglas)

- [ ] Regla con 2 condiciones AND: solo se ejecuta si ambas se cumplen
- [ ] Acción `set_label`: label aparece en card después del trigger
- [ ] Acción `notify`: notificación aparece en campana del destinatario
- [ ] Acción `block_transition`: muestra error y no permite el cambio
- [ ] Regla inactiva: no se evalúa
- [ ] Prioridad: regla con prioridad 10 se evalúa antes que prioridad 5

### Post-MVP (satélites)

- [ ] Tenant sin módulos: navegación muestra 5 tabs estándar
- [ ] Tenant con módulo: aparece tab 6 con nombre e ícono configurado
- [ ] Módulo remoto carga dentro de ONE sin recarga de página
- [ ] Módulo remoto hereda sesión de auth (no pide login)
- [ ] Módulo remoto lee datos del tenant vía SDK
- [ ] Webhook se dispara al crear oportunidad, módulo lo recibe
- [ ] Webhook con firma HMAC inválida: módulo lo rechaza

---

## §10. Impacto en specs existentes

| Spec | Cambio requerido | Cuándo |
|------|-----------------|--------|
| [98B] Pipeline | Agregar `custom_data JSONB` a oportunidades. Renderizar `CustomFieldsSection` en formulario. Labels en cards kanban | Sprint 2 MVP |
| [98C] Proyectos | Agregar `custom_data JSONB` a proyectos. Herencia en handoff. Labels en cards | Sprint 3 MVP |
| [98G] Roles | Sin cambio — RLS de custom_fields usa mismas funciones helper (`is_admin_or_owner()`) | N/A |
| [99] Mi Negocio | Sin cambio en MVP (UI de config no existe aún) | Futuro |
| [21] Ficha ONE | Actualizar descripción de extensibilidad y niveles de personalización | Post-aprobación |
| [23] Ficha Projects | Agregar "Módulos satélite ONE" como tipo de proyecto con pricing por sprint | Post-aprobación |

---

## §11. Notas para el equipo comercial

**Santiago:** cuando un prospect pida personalización, clasificar así:

| El cliente dice... | Nivel | Se vende como |
|-------------------|-------|---------------|
| "Necesito un campo extra en oportunidades" | 1 — Campos custom | Clarity Express |
| "Quiero que cuando X pase, automáticamente Y" | 2 — Reglas | Clarity Standard |
| "Necesito una pantalla completa para [proceso]" | 3 — Módulo satélite | Projects (sprint) |

**Carmen:** los módulos satélite generan doble revenue: el proyecto de construcción (one-time) + la suscripción ONE del cliente (MRR). El cliente necesita mantener su plan Pro+ para que el módulo funcione.
