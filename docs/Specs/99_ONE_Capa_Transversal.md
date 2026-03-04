---
doc_id: 99
version: 2.0
updated: 2026-02-20
depends_on: [21]
depended_by: [98A], [98B], [98C], [98D], [98E], [98F]
decisiones: D119-D128
sesion: Diseño Mi Negocio (sesión 6)
revisado_por: Max (Tech Lead), Kaori (Documentación), Hana (QA), Sofía (CS), Carmen (CFO), Santiago (CCO), Mateo (CMO), Felipe (Tributario)
---

# Spec: Mi Negocio — Capa Transversal v2.0

Tab 5 de navegación principal. Anteriormente "Configuración". Contiene los 7 cimientos que el negocio necesita para que los 4 módulos funcionales (Números, Pipeline, Proyectos, Directorio) tengan contexto.

**Pregunta central:** *"¿Quién soy, cómo opera mi negocio, con quién trabajo y a dónde voy?"*

### Changelog v1.0 → v2.0

| Cambio | Decisión |
|--------|----------|
| Tab renombrada de "Configuración" a "Mi Negocio" | D119 |
| Barra de progreso global con pesos ponderados | D120 |
| Nueva sección "Mi marca" (logo + colores corporativos) | D121 |
| Fusión "Mi Equipo" + "Personal" en una sola sección | D122 |
| Orden con storytelling en 4 capítulos narrativos | D123 |
| Onboarding con checklist previo | D124 |
| Eliminación de "Mi tarifa" — costo hora se calcula en Mi equipo | D125 |
| 7 secciones finales con contenido detallado | D126 |
| Campos, consumidores, estados y pesos por sección | D127 |
| Nombres personalizados con posesivo "mi/mis" | D127-ext |
| Navegación global: orden de tabs, layout mobile/desktop, rutas | D128 |

---

## §1. Navegación global — Las 5 tabs (D46 + D128)

### Principio de orden

El orden de las tabs sigue la lógica de **frecuencia + importancia**, no de secuencia cronológica del flujo de trabajo. El usuario abre la app para ver cómo va (Números), no para registrar un contacto (Directorio). La navegación cruzada entre módulos (ej: tocar un contacto en Pipeline → navega a Directorio) resuelve el flujo temporal sin depender del orden de tabs.

### Orden definitivo

| Posición | Tab | Ícono | Ruta | Lógica de posición |
|----------|-----|-------|------|-------------------|
| 1 | **Mis Números** | 📊 | `/numeros` | Home/Dashboard — lo primero que ves cada mañana. El "hook" de ONE |
| 2 | **Pipeline** | 🎯 | `/pipeline` | Acción principal — donde generas dinero (prospectar, cotizar, negociar) |
| 3 | **Proyectos** | 📂 | `/proyectos` | Ejecución — donde entregas, registras horas/gastos, facturas y cobras |
| 4 | **Directorio** | 👥 | `/directorio` | Relaciones — contactos y empresas. Referencia, no acción diaria |
| 5 | **Mi Negocio** | 💼 | `/mi-negocio` | Setup — los cimientos del negocio. Se configura una vez, se visita poco |

### Relación entre tabs (flujo del dinero)

```
Mi Negocio ──(alimenta contexto)──→ Todo el sistema
                                         │
Directorio ──(contacto + empresa)──→ Pipeline ──(oportunidad ganada)──→ Proyectos
                                         │                                   │
                                         └──────────────┬──────────────────┘
                                                        ▼
                                                  Mis Números
                                              (consolida todo)
```

El usuario navega entre tabs de dos formas:
- **Tab bar:** Toque directo en cualquier tab (siempre visible)
- **Navegación cruzada:** Links internos entre módulos (ej: "Ver en Pipeline →" desde drill-down de Números, o tocar nombre de contacto en Pipeline → abre Directorio)

### Layout — Móvil (bottom navigation bar)

5 tabs fijos en barra inferior. Siempre visibles. Tab activa con ícono relleno + color primario. Tabs inactivas en gris.

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│              [Contenido de la tab activa]             │
│                                                      │
│                                                      │
├──────┬──────┬──────┬──────┬──────────────────────────┤
│  📊  │  🎯  │  📂  │  👥  │  💼                      │
│Números│Pipe- │Proyec│Direc-│Mi Negocio                │
│      │line  │tos   │torio │                          │
└──────┴──────┴──────┴──────┴──────────────────────────┘
```

**Specs móvil:**
- Altura barra: 56px (Material Design) / 49pt (iOS HIG)
- Labels: siempre visibles (no ocultar en scroll)
- Ícono activo: color primario del tenant (default: #10B981)
- Ícono inactivo: #9CA3AF (gris 400)
- Badge numérico: dot rojo sin número en Pipeline si hay oportunidades sin actividad >14 días
- Safe area: respetar notch y home indicator en iOS

### Layout — Desktop (sidebar vertical)

Sidebar fija izquierda con agrupación visual en 3 zonas: Branding, Operación, Setup.

```
┌──────────────────────┬───────────────────────────────────┐
│                      │                                    │
│  [LOGO usuario]      │                                    │
│  Nombre negocio      │                                    │
│                      │                                    │
├──────────────────────┤      [Contenido de la tab activa]  │
│                      │                                    │
│  📊 Mis Números      │                                    │
│                      │                                    │
├──────────────────────┤                                    │
│                      │                                    │
│  🎯 Pipeline         │                                    │
│  📂 Proyectos        │                                    │
│  👥 Directorio       │                                    │
│                      │                                    │
├──────────────────────┤                                    │
│                      │                                    │
│  💼 Mi Negocio       │                                    │
│                      │                                    │
└──────────────────────┴───────────────────────────────────┘
```

**Specs desktop:**
- Ancho sidebar: 240px expandida, 64px colapsada (solo íconos)
- Toggle expandir/colapsar: botón hamburguesa o hover
- Header sidebar: logo del tenant (de Mi marca §4). Si no tiene logo → iniciales del negocio en círculo con color primario
- Nombre negocio: debajo del logo, truncado con ellipsis si >20 chars
- Separadores: línea sutil `border-bottom: 1px solid #E5E7EB` entre las 3 zonas
- Tab activa: fondo `bg-primary/10` + borde izquierdo 3px color primario + texto bold
- Tab inactiva: texto #6B7280, hover → `bg-gray-50`
- Zona 1 (Números): separada arriba como "home" — siempre el destino principal
- Zona 2 (Pipeline, Proyectos, Directorio): módulos operativos agrupados
- Zona 3 (Mi Negocio): separada abajo como setup, presencia visual más discreta

### Layout — Tablet (breakpoint 768px-1024px)

Sidebar colapsada (solo íconos, 64px) por defecto. Expandible por tap en hamburguesa. Contenido ocupa el resto del ancho. Bottom bar NO se muestra (usa sidebar).

### Breakpoints

| Dispositivo | Ancho | Navegación |
|-------------|-------|------------|
| Móvil | < 768px | Bottom tab bar (56px) |
| Tablet | 768px - 1024px | Sidebar colapsada (64px) |
| Desktop | > 1024px | Sidebar expandida (240px) |

### Comportamiento de navegación

| Acción | Comportamiento |
|--------|---------------|
| Toque en tab activa | Scroll to top / refresh datos |
| Toque en tab inactiva | Navega a la tab, mantiene estado de la anterior (no resetea filtros/scroll) |
| Swipe horizontal (móvil) | NO habilitado entre tabs — evita navegación accidental |
| Deep link | `/numeros`, `/pipeline`, `/proyectos`, `/directorio`, `/mi-negocio` |
| Primera visita post-registro | Redirect a `/mi-negocio` (onboarding §11) |
| Visitas normales | Abre en `/numeros` (home) |

### Mi Negocio — Detalles de la tab 5

| Atributo | Valor |
|----------|-------|
| Nombre tab | Mi Negocio |
| Ícono | 💼 (briefcase) |
| Subtítulo pantalla | "Los cimientos de tu negocio. Entre más completo, más precisos tus Números." |
| Ruta | `/mi-negocio` |

---

## §2. Estructura con storytelling (D123)

Las 7 secciones se organizan en 4 capítulos narrativos. Cada capítulo construye sobre el anterior: no puedes definir gastos sin saber quién eres, ni metas sin saber tus gastos.

```
MI NEGOCIO — "Los cimientos de tu negocio"
│
│ ┌─────────────────────────────────────────────┐
│ │ Tu negocio: 65% ████████████░░░░░░░ 65%    │
│ └─────────────────────────────────────────────┘
│
├── CAPÍTULO 1: TU IDENTIDAD
│   ├── §3. Mi perfil fiscal → "Para que tus cotizaciones y facturas salgan perfectas"
│   └── §4. Mi marca → "Dale tu estilo a ONE — logo y colores"
│
├── CAPÍTULO 2: TU OPERACIÓN
│   ├── §5. Mis servicios → "Lo que ofreces al mercado"
│   ├── §6. Mis gastos fijos → "Lo que necesitas cubrir cada mes para sobrevivir"
│   └── §7. Mi cuenta bancaria → "Donde aterrizan tus cobros"
│
├── CAPÍTULO 3: TU EQUIPO
│   └── §8. Mi equipo → "Quiénes trabajan contigo y cómo se conectan"
│
└── CAPÍTULO 4: TUS METAS
    └── §9. Mis metas → "Cuánto quieres facturar y cobrar este año"
```

**Principio de diseño:** Las secciones se muestran siempre (no es un wizard bloqueante). El usuario puede completarlas en cualquier orden, pero el storytelling de arriba hacia abajo sugiere el flujo natural. Cada sección es un card expandible/colapsable con estado visual (✅ 🟡 ⬜) y badge derecho con resumen.

---

## §3. Mi perfil fiscal

**Capítulo:** Tu Identidad.
**Subtítulo:** "Para que tus cotizaciones y facturas salgan perfectas."
**Peso barra progreso:** Crítico (3).

### Campos

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Tipo persona | Select | Sí | Natural / Jurídica |
| NIT / CC | Text | Sí | Con dígito de verificación. Validación módulo 11 |
| Razón social | Text | Condicional | Solo si Jurídica. Si Natural = nombre del usuario |
| Régimen tributario | Select | Sí | Simple / Común / No Responsable de IVA |
| Responsable IVA | Toggle | Auto + editable | Derivado del régimen. Común → Sí, Simple/No Resp → No. Editable para excepciones |
| CIIU | Text + buscador | Sí | Actividad económica principal. Buscador con autocompletado |
| Autorretenedor | Toggle | Sí | Afecta retenciones en facturación saliente |
| Tarifa ICA | % (decimal) | No | Municipal. Se sugiere automáticamente al seleccionar ciudad |
| Dirección fiscal | Text | Sí | Para facturación electrónica |
| Ciudad / Municipio | Select + buscar | Sí | Determina tarifa ICA sugerida |
| Email de facturación | Email | Sí | Para recibir facturas electrónicas (puede diferir del email de cuenta) |

### Lógica condicional

- Si `tipo_persona = 'Natural'`: ocultar campo "Razón social" (usa nombre del usuario).
- Si `regimen = 'Común'`: auto-activar Responsable IVA = Sí.
- Si `ciudad` seleccionada: sugerir tarifa ICA del municipio (editable).

### Consumidores

| Módulo | Dato consumido | Para qué |
|--------|---------------|----------|
| Pipeline [98B] | Régimen, Responsable IVA, Autorretenedor | Cálculo retenciones en cotización |
| Proyectos [98C] | NIT, Razón social, Dirección, Email facturación | Datos emisor en factura |
| Números [98A] | Régimen, CIIU | Provisiones tributarias estimadas |
| WhatsApp [98F] | — | No consume directamente |

### Estado visual

| Estado | Condición | Ícono | Badge |
|--------|-----------|-------|-------|
| ✅ Completo | Todos los obligatorios llenos | 🟢 | "Completo" |
| 🟡 Parcial | ≥1 obligatorio faltante | 🟡 | "X campos pendientes" |
| ⬜ Sin configurar | 0 campos llenos | ⬜ | "Sin configurar" |

### Tabla SQL

```sql
-- Perfil fiscal vive en la tabla tenants (extensión)
-- Estos campos se agregan a la tabla existente

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tipo_persona TEXT CHECK (tipo_persona IN ('natural', 'juridica'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nit TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS regimen_tributario TEXT CHECK (regimen_tributario IN ('simple', 'comun', 'no_responsable'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS responsable_iva BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ciiu TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS autorretenedor BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tarifa_ica NUMERIC(5,3); -- ej: 0.966%
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS direccion_fiscal TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ciudad TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_facturacion TEXT;

COMMENT ON COLUMN tenants.tarifa_ica IS 'Tarifa ICA municipal en %. Ej: 0.966 para Bogotá servicios profesionales';
```

---

## §4. Mi marca (NUEVA — D121)

**Capítulo:** Tu Identidad.
**Subtítulo:** "Dale tu estilo a ONE — logo y colores."
**Peso barra progreso:** Bajo (1).

### Campos

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Logo | File upload | No | PNG/SVG, fondo transparente, max 2MB |
| Color primario | HEX picker | No | Default: #10B981 (metrik green) |
| Color secundario | HEX picker | No | Default: #1A1A1A (carbon) |

### Validación logo

| Regla | Valor |
|-------|-------|
| Formatos | PNG, SVG |
| Tamaño máximo | 2 MB |
| Dimensiones mínimas | 200×200 px |
| Fondo | Transparente recomendado (validación visual, no bloqueante) |

### Preview en vivo

Al seleccionar colores y/o subir logo, mostrar miniatura de cómo se ve una cotización PDF con esos elementos. Actualización en tiempo real conforme el usuario ajusta los colores.

```
┌─ Preview cotización ─────────────────┐
│ [LOGO]  NOMBRE EMPRESA               │
│ ══════════════════════════ (color 1)  │
│                                       │
│ Cotización COT-2026-001              │
│ ┌─────────────────────────────────┐  │
│ │ Ítem         │ Valor            │  │
│ │──────────────│─────────────(c2)─│  │
│ │ Consultoría  │ $5.000.000       │  │
│ └─────────────────────────────────┘  │
│                                       │
│ Total: $5.000.000        (color 1)    │
└───────────────────────────────────────┘
```

### Consumidores

| Módulo | Dato consumido | Para qué |
|--------|---------------|----------|
| Pipeline [98B] | Logo, colores | PDFs cotización |
| Proyectos [98C] | Logo, colores | PDFs factura (post-MVP) |
| Exportaciones | Logo, colores | Reportes exportados |
| App (post-MVP) | Logo | Header personalizado |

### Estado visual

| Estado | Condición | Ícono | Badge |
|--------|-----------|-------|-------|
| ✅ Configurado | Al menos logo subido | 🟢 | "Logo + colores" |
| 🟡 Parcial | Solo colores, sin logo | 🟡 | "Solo colores" |
| ⬜ Sin configurar | Todo por defecto | ⬜ | "Por defecto" |

### Almacenamiento

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_primario TEXT DEFAULT '#10B981';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_secundario TEXT DEFAULT '#1A1A1A';

COMMENT ON COLUMN tenants.logo_url IS 'URL del logo en Supabase Storage. PNG/SVG, max 2MB';
COMMENT ON COLUMN tenants.color_primario IS 'Color primario HEX para branding. Default: metrik green';
COMMENT ON COLUMN tenants.color_secundario IS 'Color secundario HEX para branding. Default: carbon';
```

Logo se sube a Supabase Storage en bucket `branding/{tenant_id}/logo.{ext}`. URL pública para uso en PDFs.

---

## §5. Mis servicios

**Capítulo:** Tu Operación.
**Subtítulo:** "Lo que ofreces al mercado."
**Peso barra progreso:** Medio (2).

### Campos

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Nombre servicio | Text | Sí | "Diseño arquitectónico", "Consultoría estructural" |
| Precio estándar | Currency | No | Precio de lista sugerido al cotizar |
| Costo estimado | Currency | No | Horas × tarifa + materiales estimados |
| Margen esperado | Calculado | — | (Precio - Costo) ÷ Precio × 100. Se muestra solo si ambos valores existen |
| Activo | Toggle | — | Default: true. Desactivar en vez de borrar |

### Catálogo sugerido por profesión

Al registrarse, según la profesión seleccionada en onboarding, ONE sugiere 3-5 servicios típicos editables:

| Profesión | Servicios sugeridos |
|-----------|-------------------|
| Arquitecto | Diseño arquitectónico, Dirección de obra, Consultoría, Remodelación, Planos |
| Ingeniero civil | Cálculo estructural, Interventoría, Presupuestos, Consultoría técnica |
| Diseñador gráfico | Identidad de marca, Piezas digitales, Packaging, Editorial, Consultoría creativa |
| Consultor | Diagnóstico, Implementación, Capacitación, Acompañamiento, Auditoría |
| Contador | Declaraciones tributarias, Contabilidad mensual, Revisoría fiscal, Asesoría tributaria |
| Abogado | Consultoría legal, Contratos, Representación, Due diligence |
| Otro | (vacío — el usuario crea desde cero) |

El usuario puede editar nombres, agregar nuevos, eliminar sugeridos. El catálogo es punto de partida, no camisa de fuerza.

### Consumidores

| Módulo | Dato consumido | Para qué |
|--------|---------------|----------|
| Pipeline [98B] | servicio_origen_id en ítems de cotización | Pre-llena nombre + precio al cotizar |
| Proyectos [98C] | Margen esperado vs real al cierre | Retroalimentación costos (D70) |
| Números [98A] | Margen promedio por servicio | Cálculo PE |

### Estado visual

| Estado | Condición | Badge |
|--------|-----------|-------|
| ✅ Configurado | ≥1 servicio activo | "X activos" |
| ⬜ Sin configurar | 0 servicios | "Sin servicios" |

### Tabla SQL

```sql
CREATE TABLE IF NOT EXISTS servicios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nombre TEXT NOT NULL,
  precio_estandar NUMERIC(15,2),
  costo_estimado NUMERIC(15,2),
  activo BOOLEAN DEFAULT true,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON servicios
  USING (tenant_id = auth.jwt() ->> 'tenant_id');

CREATE INDEX idx_servicios_tenant ON servicios(tenant_id) WHERE activo = true;
```

---

## §6. Mis gastos fijos

**Capítulo:** Tu Operación.
**Subtítulo:** "Lo que necesitas cubrir cada mes para sobrevivir."
**Peso barra progreso:** Crítico (3).

### Campos

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Concepto | Text | Sí | "Arriendo oficina", "Internet", "Contador" |
| Monto mensual | Currency | Sí | Lo que paga cada mes |
| Categoría | Select | Sí | 9 categorías predefinidas [98E] |
| Día habitual de pago | Number (1-31) | No | Para timing de borradores mensuales (D83) |
| Deducible | Toggle | Auto + editable | Según categoría, pero el usuario puede ajustar |

### 9 categorías predefinidas

| # | Categoría | Deducible default | Concepto tributario |
|---|-----------|------------------|-------------------|
| 1 | Arriendo | Sí | Arrendamientos |
| 2 | Servicios públicos | Sí | Servicios |
| 3 | Internet y telecomunicaciones | Sí | Comunicaciones |
| 4 | Software y herramientas | Sí | Tecnología |
| 5 | Transporte | Parcial | Transporte |
| 6 | Alimentación | Parcial | Representación |
| 7 | Servicios profesionales | Sí | Honorarios |
| 8 | Marketing y publicidad | Sí | Publicidad |
| 9 | Otros | No (default) | Otros |

### Consumidores

| Módulo | Dato consumido | Para qué |
|--------|---------------|----------|
| Números [98A] | Suma gastos fijos | P4 (punto de equilibrio), Semáforo completitud (≥3 = verde), P&L línea gastos fijos |
| Proyectos [98C] | Conceptos + montos | Borradores mensuales (D83), reconciliación (D84) |
| WhatsApp [98F] | W17 | "¿Cómo van mis gastos fijos?" — consulta estado borradores |

### Estado visual

| Estado | Condición | Ícono | Badge |
|--------|-----------|-------|-------|
| ✅ Completo | ≥3 gastos fijos | 🟢 | "$X/mes" (suma total) |
| 🟡 Parcial | 1-2 gastos fijos | 🟡 | "$X/mes" |
| ⬜ Sin configurar | 0 gastos fijos | ⬜ | "Sin gastos fijos" |

### Tabla SQL

Tabla ya definida en [98C §3.6]. Referencia:

```sql
-- Tabla gastos_fijos_config ya existe (creada por Proyectos [98C])
-- Campos: id, tenant_id, concepto, monto_esperado, categoria, dia_pago, deducible, activo

-- Mi Negocio es la UI de gestión. Proyectos [98C] es el consumidor (borradores).
```

---

## §7. Mi cuenta bancaria

**Capítulo:** Tu Operación.
**Subtítulo:** "Donde aterrizan tus cobros."
**Peso barra progreso:** Alto (2).

### Campos

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Nombre banco | Select | Sí | Lista bancos Colombia + neobancos (Bold, Nequi, Daviplata) |
| Tipo cuenta | Select | Sí | Ahorros / Corriente / Billetera digital |
| Últimos 4 dígitos | Text (4 chars) | No | Para identificación visual. No se almacena número completo |
| Saldo inicial | Currency | Sí | "¿Cuánto tienes hoy en la cuenta?" — primer saldo real |
| Fecha saldo inicial | Date | Auto | Fecha de registro = NOW() |

### Saldo inicial

El saldo inicial crea el primer registro en la tabla `saldos_banco` y arranca todo el motor de conciliación:

```sql
-- Al guardar saldo inicial:
INSERT INTO saldos_banco (tenant_id, saldo_real, saldo_teorico, diferencia, fecha, registrado_via)
VALUES (:tenant_id, :saldo_inicial, :saldo_inicial, 0, NOW(), 'app_setup');

-- Iniciar streak
INSERT INTO streaks (tenant_id, tipo, semanas_actuales, semanas_record)
VALUES (:tenant_id, 'conciliacion', 1, 1)
ON CONFLICT (tenant_id, tipo) DO NOTHING;
```

### Lista bancos Colombia (MVP)

Bancolombia, Davivienda, BBVA, Banco de Bogotá, Banco de Occidente, Banco Popular, Scotiabank Colpatria, Banco Agrario, Banco AV Villas, Banco Itaú, Bold, Nequi, Daviplata, Nu Colombia, Rappipay, Otro.

### Consumidores

| Módulo | Dato consumido | Para qué |
|--------|---------------|----------|
| Números [98A] | Saldo real (último registro) | P1 (caja), P5 (runway), Franja conciliación |
| Números [98A] | Fecha último saldo | Semáforo completitud (>7 días = baja score) |
| WhatsApp [98F] | W32 | Actualizar saldo, cálculo diferencia vs teórico |
| Streak engine | Fecha último saldo | Evaluación semanal, milestones |

### Estado visual

| Estado | Condición | Ícono | Badge |
|--------|-----------|-------|-------|
| ✅ Configurado | Cuenta + saldo registrado | 🟢 | "1 cuenta" |
| ⬜ Sin configurar | Sin cuenta | ⬜ | "Sin cuenta" |

### Tabla SQL

```sql
-- Tabla config para la cuenta (nueva)
CREATE TABLE IF NOT EXISTS cuentas_bancarias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nombre_banco TEXT NOT NULL,
  tipo_cuenta TEXT NOT NULL CHECK (tipo_cuenta IN ('ahorros', 'corriente', 'billetera_digital')),
  ultimos_4 TEXT CHECK (length(ultimos_4) = 4 OR ultimos_4 IS NULL),
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id) -- MVP: una sola cuenta por tenant (D110)
);

ALTER TABLE cuentas_bancarias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON cuentas_bancarias
  USING (tenant_id = auth.jwt() ->> 'tenant_id');

-- Tabla saldos_banco ya definida en [98A §14]. Mi Negocio solo crea el primer registro.
```

**MVP (D110):** Una sola cuenta. Constraint UNIQUE(tenant_id) lo garantiza. Post-MVP: eliminar constraint, agregar campo `principal BOOLEAN` para consolidación multi-cuenta.

---

## §8. Mi equipo (D122 + D125)

**Capítulo:** Tu Equipo.
**Subtítulo:** "Quiénes trabajan contigo y cómo se conectan."
**Peso barra progreso:** Medio (2).

### Primer campo — Tamaño del equipo

Al entrar a la sección por primera vez:

**"¿Cuántas personas trabajan contigo, incluyéndote?"** → Input numérico.

| Respuesta | Comportamiento |
|-----------|---------------|
| 1 | Se muestra solo ficha "YO". Al completar salario + horas, sección = ✅ |
| >1 | Se muestra ficha "YO" + botón "Agregar persona". Badge: "X de Y registradas" |

Este número alimenta la barra de progreso: si dijo 5, la sección está completa cuando hay 5 fichas registradas.

### Ficha "YO" (dueño — siempre primera, no eliminable)

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Nombre | Text | Pre-filled | Del registro de cuenta. Editable |
| Cargo | Text | Sí | Default: "Director" / "Fundador". Editable |
| Ingreso mensual esperado | Currency | Sí | "¿Cuánto te pagas al mes?" |
| Horas disponibles/mes | Number | Sí | Default: 160. "¿Cuántas horas trabajas al mes?" |
| **Costo hora** | **Calculado** | **—** | **= Ingreso ÷ Horas. Display-only** |
| Teléfono WhatsApp | Phone | Pre-filled | Del registro de cuenta |
| Tipo acceso | Read-only | — | "Admin (Licencia app)" — no editable |

**Texto educativo costo hora:**

> 💡 *Tu hora de trabajo cuesta $[X]. Esto es lo que ONE usa para calcular si tus proyectos ganan o pierden.*

Este es un "aha moment" para el usuario — la primera vez que ve el costo real de su tiempo.

### Ficha personas adicionales

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Nombre | Text | Sí | — |
| Cargo | Text | Sí | — |
| Salario/Honorarios mensual | Currency | Sí | Label contextual según tipo vínculo |
| Horas disponibles/mes | Number | Sí | Default: 160 |
| **Costo hora** | **Calculado** | **—** | **= Salario ÷ Horas. Display-only** |
| Teléfono WhatsApp | Phone | Condicional | Obligatorio si tipo acceso incluye WhatsApp |
| Tipo acceso | Select | Sí | Ver tabla abajo |
| Tipo vínculo | Select | No | Empleado / Contratista / Freelance |

### Tipos de acceso

| Tipo | Label | Qué puede hacer | Consume licencia app | Requiere plan |
|------|-------|-----------------|---------------------|--------------|
| 📱 Licencia app | "Acceso a la app" | Login web/móvil, ver dashboard, crear cotizaciones | Sí (+$50K Pro / +$100K Pro+) | Pro o Pro+ |
| 💬 Campo WhatsApp | "Solo WhatsApp" | Registrar horas, gastos, notas desde WhatsApp | No (ilimitados) | Pro+ |
| 📱💬 Ambos | "App + WhatsApp" | Todo lo anterior | Sí | Pro+ |

### Costo hora — Lógica (D125)

```
costo_hora = salario_mensual / horas_disponibles_mes
```

- Se calcula automáticamente al cambiar salario o horas.
- Se muestra inline debajo de los campos con texto educativo.
- Es read-only en la ficha de persona.
- **No se almacena** — se calcula on-the-fly o vía computed column/view.

**Nota para v2 (Felipe):** Costo hora ajustado = (salario + provisión seg. social + provisión tributaria) ÷ horas. Para independientes: seg. social = 11.4% de facturación esperada. Esto se implementará cuando ONE pueda sugerir "Tu hora realmente cuesta $167K, no $150K".

### Resumen pie de sección

```
┌─ Resumen Mi equipo ───────────────────────────────────┐
│ 👥 3 de 5 personas registradas                        │
│ 📱 2 licencias app (Plan Pro: 1 incluida, 1 adicional)│
│ 💬 3 personas con WhatsApp campo                      │
│                                                        │
│ [Agregar persona]                                      │
│                                                        │
│ ⚡ ¿Necesitas más licencias? → [Ver planes]            │
└────────────────────────────────────────────────────────┘
```

El link "Ver planes" navega a la sección de suscripción. Se muestra solo si el usuario está cerca del límite de su plan.

### Consumidores

| Módulo | Dato consumido | Para qué |
|--------|---------------|----------|
| Pipeline [98B] | costo_hora del dueño | Valor unitario sugerido en rubros `mo_propia` |
| Pipeline [98B] | costo_hora de personas | Valor unitario sugerido en rubros `mo_terceros` (si son del equipo) |
| Proyectos [98C] | costo_hora × horas registradas | Costo real de mano de obra por proyecto |
| Números [98A] | Costo total horas del dueño | P2 (utilidad), P&L |
| WhatsApp [98F] | Lista de personas autorizadas | W03 (registro horas), validación de quién puede registrar |
| WhatsApp [98F] | costo_hora por persona | Feedback post-registro: "Costo acumulado horas: $X" |

### Estado visual

| Estado | Condición | Ícono | Badge |
|--------|-----------|-------|-------|
| ✅ Completo | X de X personas registradas con salario + horas | 🟢 | "X personas" |
| 🟡 Parcial | Algunas personas sin completar, o faltan por registrar | 🟡 | "X de Y registradas" |
| ⬜ Solo número | Dijo cuántas personas pero no registró ninguna más allá de sí mismo | ⬜ | "Solo tú" |

### Tabla SQL

```sql
-- Tabla personal ya existe (referenciada en [98C §0]).
-- Se extiende con campos de acceso y equipo.

ALTER TABLE personal ADD COLUMN IF NOT EXISTS tipo_acceso TEXT DEFAULT 'app'
  CHECK (tipo_acceso IN ('app', 'whatsapp', 'ambos'));
ALTER TABLE personal ADD COLUMN IF NOT EXISTS tipo_vinculo TEXT
  CHECK (tipo_vinculo IN ('empleado', 'contratista', 'freelance'));
ALTER TABLE personal ADD COLUMN IF NOT EXISTS telefono_whatsapp TEXT;
ALTER TABLE personal ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;

-- Configuración de tamaño de equipo declarado
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS equipo_declarado INTEGER DEFAULT 1;

COMMENT ON COLUMN personal.tipo_acceso IS 'app = licencia web/móvil, whatsapp = solo campo, ambos = las dos';
COMMENT ON COLUMN tenants.equipo_declarado IS 'Número de personas que el usuario declaró en Mi equipo. Para barra de progreso.';
```

---

## §9. Mis metas

**Capítulo:** Tus Metas.
**Subtítulo:** "Cuánto quieres facturar y cobrar este año."
**Peso barra progreso:** Crítico (3).

### Campos

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Meta ventas mensual | Currency | Sí | "¿Cuánto quieres facturar este mes?" |
| Meta recaudo mensual | Currency | Auto + editable | Default: ventas × 0.8. "¿Cuánto esperas cobrar?" |
| Modo | Toggle | Sí | "Mismo valor cada mes" / "Diferente por mes" |

### Modo "Mismo cada mes"

Un solo input → se replica automáticamente para los 12 meses del año.

### Modo "Diferente por mes"

Grid de 12 meses, cada uno editable. Si un mes no se llena, hereda del último configurado.

```
┌─ Mis metas 2026 ──────────────────────────────┐
│ Modo: ○ Mismo cada mes  ● Diferente por mes    │
│                                                  │
│ Mes       Ventas        Recaudo                 │
│ Ene       $12.000.000   $9.600.000              │
│ Feb       $15.000.000   $12.000.000             │
│ Mar       $15.000.000   $12.000.000 (heredado)  │
│ ...       ...           ...                      │
│ Dic       $20.000.000   $16.000.000             │
│                                                  │
│ Total año: $180.000.000  $144.000.000           │
└──────────────────────────────────────────────────┘
```

### PE automático

Punto de equilibrio = gastos fijos / margen promedio. **No configurable directamente.** Cambia automáticamente cuando cambian los gastos fijos (§6) o al cierre de proyectos (retroalimentación D70).

### Consumidores

| Módulo | Dato consumido | Para qué |
|--------|---------------|----------|
| Números [98A] | Meta ventas, meta recaudo | P4 barras (ventas vs meta), Semáforo completitud |
| WhatsApp [98F] | Meta del mes actual | W16 "Ventas: $12.5M / $15M (83%)", W29 resumen semanal |

### Estado visual

| Estado | Condición | Ícono | Badge |
|--------|-----------|-------|-------|
| ✅ Configurado | ≥1 mes configurado | 🟢 | "12 meses configurados" o "$15M/mes" |
| ⬜ Sin configurar | Sin metas | ⬜ | "Sin metas" |

### Tabla SQL

```sql
-- Tabla config_metas ya definida en [98A §11]. Referencia:
-- id, tenant_id, mes (DATE primer día), meta_ventas_mensual, meta_recaudo_mensual

-- Mi Negocio es la UI de gestión. Números [98A] es el consumidor.
```

---

## §10. Barra de progreso global (D120)

### Ubicación

Fija en el header de Mi Negocio, siempre visible. No hace scroll con el contenido.

### Fórmula

```
progreso = Σ(peso_seccion × estado_seccion) / Σ(peso_seccion) × 100

Pesos:
  §3 Mi perfil fiscal:    3 (Crítico)
  §4 Mi marca:            1 (Bajo)
  §5 Mis servicios:       2 (Medio)
  §6 Mis gastos fijos:    3 (Crítico)
  §7 Mi cuenta bancaria:  2 (Alto)
  §8 Mi equipo:           2 (Medio)
  §9 Mis metas:           3 (Crítico)

  Total pesos: 16

Estado:
  Completo (✅) = 1.0
  Parcial (🟡) = 0.5
  Sin configurar (⬜) = 0.0
```

### Ejemplo de cálculo

| Sección | Peso | Estado | Score |
|---------|------|--------|-------|
| Mi perfil fiscal | 3 | ✅ (1.0) | 3.0 |
| Mi marca | 1 | ⬜ (0.0) | 0.0 |
| Mis servicios | 2 | ✅ (1.0) | 2.0 |
| Mis gastos fijos | 3 | 🟡 (0.5) | 1.5 |
| Mi cuenta bancaria | 2 | ✅ (1.0) | 2.0 |
| Mi equipo | 2 | 🟡 (0.5) | 1.0 |
| Mis metas | 3 | ✅ (1.0) | 3.0 |
| **Total** | **16** | | **12.5** |

**Progreso = 12.5 / 16 × 100 = 78%**

### Visualización

```
┌──────────────────────────────────────────────────┐
│ Tu negocio: 78% ██████████████████░░░░░ 78%      │
│ 2 secciones por completar                         │
└──────────────────────────────────────────────────┘
```

### Celebración al 100%

Cuando todas las secciones están completas:
- Animación confetti (sutil, 2 segundos)
- Mensaje: *"¡Tu negocio está listo! Tus Números ahora son confiables."*
- CTA: **[Ir a Mis Números →]**
- La barra permanece en 100% con ícono ✅

### Relación con Semáforo Números [98A]

| Mi Negocio (barra) | Semáforo Capa 1 [98A] | Diferencia |
|--------------------|-----------------------|------------|
| Evalúa setup estático | Evalúa datos operativos en movimiento | Scope |
| Incluye: logo, servicios | No evalúa logo ni servicios | Alcance |
| No evalúa: saldo reciente, oportunidades activas, gastos confirmados | Sí evalúa estos | Alcance |
| Se alimenta del estado de 7 secciones | Se alimenta de 8 indicadores dinámicos | Fuente |
| Vive en tab Mi Negocio | Vive en tab Números | Ubicación |

Ambos comparten fuentes (gastos fijos, metas, saldo bancario) pero evalúan cosas diferentes. Son complementarios, no redundantes.

---

## §11. Onboarding — Primera vez (D124)

### Pantalla de bienvenida

Se muestra **solo la primera vez** que el usuario entra a Mi Negocio (progreso = 0%).

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  Vamos a configurar tu negocio en ONE                   │
│                                                          │
│  Son 7 secciones y te tomará unos 15 minutos.           │
│  Antes de empezar, ten a la mano:                       │
│                                                          │
│  📄 Tu RUT o datos fiscales                             │
│  🏦 Tu extracto bancario reciente (para el saldo)       │
│  💸 La lista de gastos que pagas cada mes               │
│  🎯 Tu meta de ventas del mes                           │
│  🖼️ Tu logo (opcional — lo puedes agregar después)      │
│                                                          │
│  ┌──────────────────────────────────────────┐           │
│  │          [Empezar →]                      │           │
│  └──────────────────────────────────────────┘           │
│                                                          │
│  ¿Ya tienes todo? Puedes completar las 7                │
│  secciones en cualquier orden.                           │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Post-bienvenida

Después de tocar "Empezar", se muestra la vista normal con las 7 secciones, la barra de progreso en 0%, y los capítulos con subtítulos motivacionales. El usuario va completando a su ritmo.

### Flujo sugerido (no obligatorio)

El orden visual de arriba a abajo sugiere:

1. Mi perfil fiscal → porque es lo primero que preguntan y lo que más usuarios ya tienen a la mano
2. Mi marca → opcional, rápido, genera sentido de ownership
3. Mis servicios → define qué ofrece, catálogo sugerido lo acelera
4. Mis gastos fijos → requiere reflexión, pero es crítico
5. Mi cuenta bancaria → dato puntual, rápido
6. Mi equipo → salario y horas del dueño como mínimo
7. Mis metas → cierra el setup con la ambición del mes

### Notificación de completitud parcial

Si el usuario abandona Mi Negocio con progreso < 100%:
- **Día 1:** Push: *"Tu negocio va al [X]%. Completa [sección faltante más importante] para activar tus Números."*
- **Día 3:** Push: *"Solo te faltan [N] secciones. 10 minutos y tu negocio está listo."*
- **Día 7:** WhatsApp (si bot activo): *"Hola [nombre], vi que tu negocio está al [X]%. ¿Quieres que te ayude a completar lo que falta?"*

---

## §12. Componentes transversales (NO en tab Mi Negocio)

Estos componentes viven en otros tabs pero forman parte de la capa transversal. Se mantienen del v1.0 para referencia.

### Mis Clientes (→ vive en Directorio)

Catálogo de clientes con perfil fiscal. Consumido por todos los módulos.

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Nombre / Razón social | Text | Sí | — |
| NIT / CC | Text | Sí | Con dígito verificación |
| Tipo persona | Select | Sí | Natural / Jurídica |
| Gran Contribuyente | Toggle | Sí | Afecta retenciones |
| Agente retenedor | Toggle | Sí | Afecta retenciones |
| Régimen tributario | Select | Sí | Común / Simple / No Responsable |
| Contacto principal | Text | No | Nombre + teléfono |
| Email | Email | No | Para facturación electrónica |

Hard gate (D41): datos fiscales del cliente obligatorios antes de marcar oportunidad como Ganada.

### Mis Promotores (→ vive en Directorio)

| Campo | Tipo | Notas |
|-------|------|-------|
| Nombre | Text | — |
| Teléfono | Text | — |
| Comisión % | Number | Default: 10% |
| Clientes referidos | Relación | Lista de clientes asociados |
| Comisiones generadas | Calculado | Suma de primeros proyectos × % |
| Comisiones pagadas | Currency | Registro de pagos |

Regla: comisión solo sobre primer proyecto del cliente referido. No aplica en recompra ni retainer.

### Categorías de Gasto

9 categorías predefinidas (detalle en §6 y en [98E]). Configuración fija — el usuario no crea categorías nuevas en MVP.

### Usuarios y Permisos

Ahora gestionados dentro de Mi equipo (§8). Los roles se derivan del tipo de acceso:
- **Admin:** Dueño (siempre), o persona con Licencia app marcada como admin
- **Operador:** Persona con Licencia app sin permisos admin
- **Campo:** Persona con acceso WhatsApp solamente

Clarity expande esto con roles granulares (Admin, Vendedor, Operador, Visualizador) por módulo.

---

## §13. Stack Técnico

Supabase (PostgreSQL + Auth + Edge Functions + Realtime + Storage). Row Level Security para multitenancy. Cada organización = tenant aislado.

### Tablas creadas o modificadas por este spec

| Tabla | Acción | Sección |
|-------|--------|---------|
| `tenants` | ALTER (agregar campos fiscales + marca + equipo_declarado) | §3, §4, §8 |
| `servicios` | CREATE | §5 |
| `cuentas_bancarias` | CREATE | §7 |
| `personal` | ALTER (agregar tipo_acceso, tipo_vinculo, telefono_whatsapp, activo) | §8 |
| `gastos_fijos_config` | Ya existe ([98C]) — Mi Negocio es solo UI | §6 |
| `config_metas` | Ya existe ([98A]) — Mi Negocio es solo UI | §9 |
| `saldos_banco` | Ya existe ([98A]) — Mi Negocio crea primer registro | §7 |
| `streaks` | Ya existe ([98A]) — Mi Negocio inicia streak | §7 |

### Edge Functions requeridas

| Función | Trigger | Qué hace |
|---------|---------|----------|
| `calcular_progreso_negocio` | On-demand (al cargar Mi Negocio) | Evalúa estado de 7 secciones, retorna % y detalle |
| `upload_logo` | POST con file | Sube a Storage `branding/{tenant_id}/logo.{ext}`, actualiza `tenants.logo_url` |

---

## §14. Registro de decisiones

| # | Decisión | Definición | Quién decidió |
|---|----------|-----------|---------------|
| D119 | Renombrar tab | De "Configuración" a "Mi Negocio". Ícono: 💼. Subtítulo: "Los cimientos de tu negocio..." | Consenso (Sofía + Santiago + Mateo + Hana) → Mauricio ✅ |
| D120 | Barra de progreso global | Fija en header, pesos ponderados, celebración al 100% | Sofía + Hana → Mauricio ✅ |
| D121 | Sección Mi marca | Logo (PNG/SVG, 2MB) + color primario + secundario. Preview cotización en vivo | Mateo + Santiago → Mauricio ✅ |
| D122 | Fusión Mi Equipo + Personal | Una sola sección. Input "¿Cuántas personas?". Tipos acceso: App/WhatsApp/Ambos | Sofía + Hana → Mauricio ✅ |
| D123 | Orden storytelling | 4 capítulos: Identidad → Operación → Equipo → Metas. 7 secciones en orden narrativo | Hana → Mauricio ✅ |
| D124 | Onboarding checklist previo | Pantalla bienvenida con lista de lo que necesita tener a la mano. Solo primera vez | Sofía → Mauricio ✅ |
| D125 | Eliminar Mi tarifa | Costo hora = salario ÷ horas. Se calcula y muestra inline en Mi equipo con texto educativo | Carmen + equipo completo → Mauricio ✅ |
| D126 | 7 secciones finales | Perfil fiscal, Marca, Servicios, Gastos fijos, Cuenta bancaria, Equipo, Metas | Consenso → Mauricio ✅ |
| D127 | Contenido detallado + nombres con posesivo | Campos, consumidores, estados, pesos por sección. Nombres: "Mi perfil fiscal", "Mis gastos fijos", etc. | Max + Kaori → Mauricio ✅ |
| D128 | Navegación global 5 tabs | Orden: Números → Pipeline → Proyectos → Directorio → Mi Negocio. Lógica: frecuencia + importancia. Mobile: bottom bar. Desktop: sidebar 3 zonas. Tablet: sidebar colapsada. Primera visita → Mi Negocio, después → Números | Consenso (Hana + Sofía + Santiago + Mateo) → Mauricio ✅ |

---

## §15. Plan de ejecución

**Prerrequisito:** Tablas base de tenants y personal ya existen (infraestructura inicial).

### Sprint CONFIG-1: Navegación global + Estructura + Secciones estáticas

| Entregable | Descripción |
|-----------|-------------|
| **Navigation shell** | **5 tabs: bottom bar móvil (56px) + sidebar desktop (240px/64px) + breakpoints 768/1024. Rutas, íconos, estados activo/inactivo. Primera visita → `/mi-negocio`, después → `/numeros`** |
| **Sidebar branding** | **Header sidebar desktop: logo tenant + nombre negocio. Fallback: iniciales en círculo** |
| ALTER tenants | Campos fiscales + marca + equipo_declarado |
| ALTER personal | tipo_acceso, tipo_vinculo, telefono_whatsapp, activo |
| CREATE servicios | Tabla + RLS + seed catálogo sugerido por profesión |
| CREATE cuentas_bancarias | Tabla + RLS + constraint unique MVP |
| Tab Mi Negocio | Ruta `/mi-negocio`, 4 capítulos, 7 secciones colapsables |
| Barra progreso | Componente fijo header, fórmula ponderada, estados 3 niveles |
| Onboarding | Pantalla bienvenida primera vez |
| §3 Mi perfil fiscal | Formulario completo con lógica condicional |
| §5 Mis servicios | CRUD + catálogo sugerido por profesión |
| §6 Mis gastos fijos | UI de gestión sobre tabla existente |
| §9 Mis metas | Grid 12 meses + modo flat/diferente |

### Sprint CONFIG-2: Marca + Equipo + Cuenta

| Entregable | Descripción |
|-----------|-------------|
| §4 Mi marca | Upload logo → Storage, HEX pickers, preview PDF en vivo |
| §7 Mi cuenta bancaria | Formulario + creación primer saldo en `saldos_banco` + inicio streak |
| §8 Mi equipo | Input tamaño, ficha YO con costo hora educativo, CRUD personas, resumen licencias |
| Notificaciones completitud | Push día 1/3, WhatsApp día 7 si <100% |
| Celebración 100% | Confetti + CTA → Números |

### Sprint CONFIG-3: Integración + Polish

| Entregable | Descripción |
|-----------|-------------|
| Logo en PDFs cotización | Insertar logo + colores en template PDF [98B] |
| Costo hora en cotización | Sugerir valor_unitario desde personal.costo_hora en rubros mo_propia |
| Responsive móvil | Secciones stack, barra sticky, formularios full-width |
| Tests de integración | Verificar que cada sección alimenta correctamente sus consumidores |

---

## §16. Verificación post-ejecución

```
NAVEGACIÓN GLOBAL (D128)
□ Móvil: 5 tabs visibles en bottom bar con íconos correctos
□ Móvil: tab activa muestra color primario del tenant
□ Móvil: badge dot rojo en Pipeline si hay oportunidades sin actividad >14 días
□ Desktop: sidebar expandida (240px) con 3 zonas separadas
□ Desktop: sidebar muestra logo del tenant en header (o iniciales si no hay logo)
□ Desktop: tab activa con borde izquierdo + fondo primario/10
□ Desktop: toggle colapsar sidebar → solo íconos (64px)
□ Tablet (768-1024px): sidebar colapsada por defecto
□ Primera visita post-registro → redirect a /mi-negocio
□ Visitas normales → abre en /numeros
□ Toque en tab activa → scroll to top
□ Toque en tab inactiva → navega sin resetear estado anterior
□ Swipe horizontal entre tabs → NO funciona (deshabilitado)
□ Deep links funcionan: /numeros, /pipeline, /proyectos, /directorio, /mi-negocio
□ Navegación cruzada: desde Pipeline tocar contacto → abre Directorio
□ Navegación cruzada: desde Números drill-down → link "Ir a Pipeline" funciona
PERFIL FISCAL
□ Crear tenant con tipo Natural → verificar que Razón social se oculta
□ Cambiar a Jurídica → verificar que Razón social aparece
□ Seleccionar régimen Común → verificar Responsable IVA = auto true
□ Seleccionar ciudad → verificar sugerencia tarifa ICA

MI MARCA
□ Subir logo PNG < 2MB → verificar almacenamiento en Storage
□ Subir archivo > 2MB → debe rechazar con mensaje
□ Subir JPG → debe rechazar (solo PNG/SVG)
□ Cambiar colores → verificar preview en vivo se actualiza
□ Generar cotización PDF → verificar logo + colores aplicados

MIS SERVICIOS
□ Registrar con profesión "Arquitecto" → verificar 5 servicios sugeridos
□ Editar servicio sugerido → verificar que se guarda
□ Eliminar servicio → verificar que se desactiva (no delete)
□ Crear cotización → verificar que servicios aparecen como opciones

MIS GASTOS FIJOS
□ Crear 3 gastos fijos → verificar badge "$X/mes"
□ Verificar que semáforo Números [98A] pasa de rojo a verde en indicador gastos
□ Verificar que se generan borradores mensuales [98C D83]

MI CUENTA BANCARIA
□ Registrar cuenta + saldo → verificar INSERT en saldos_banco
□ Verificar que streak se inicializa
□ Verificar que Números P1 muestra saldo correcto
□ Intentar crear segunda cuenta → debe bloquear (MVP)

MI EQUIPO
□ Declarar equipo = 1 → verificar que solo muestra ficha YO
□ Completar salario + horas → verificar costo hora calculado
□ Declarar equipo = 3 → verificar badge "1 de 3 registradas"
□ Agregar persona con tipo WhatsApp → verificar teléfono obligatorio
□ Agregar persona con tipo App → verificar que cuenta como licencia
□ Crear cotización con rubro mo_propia → verificar que sugiere costo_hora del dueño

MIS METAS
□ Configurar meta flat $15M → verificar que 12 meses se llenan
□ Cambiar a diferente por mes → verificar que se mantienen valores
□ Verificar que Números P4 muestra barra con meta correcta
□ Verificar que W16 incluye meta en respuesta

BARRA DE PROGRESO
□ Todo vacío → 0%
□ Completar solo perfil fiscal (peso 3) → 3/16 = ~19%
□ Completar todo → 100% + confetti + CTA
□ Quitar un dato obligatorio → verificar que baja y se recalcula

ONBOARDING
□ Primera visita → pantalla bienvenida visible
□ Tocar "Empezar" → vista normal con secciones
□ Segunda visita → pantalla bienvenida NO aparece
□ Push día 1 con progreso < 100% → verificar notificación
```

---

## §17. Mapa de dependencias

```
                    ┌─────────────┐
                    │  Mi Negocio  │
                    │    [99]      │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
    │ Pipeline   │   │ Proyectos │   │  Números   │
    │   [98B]    │   │   [98C]   │   │   [98A]    │
    └────────────┘   └───────────┘   └────────────┘
    Consume:          Consume:        Consume:
    · Perfil fiscal   · Perfil fiscal · Gastos fijos (PE)
    · Servicios       · Costo hora    · Metas (barras)
    · Costo hora      · Gastos fijos  · Saldo banco (P1,P5)
    · Logo + colores  · Logo (post)   · Costo hora (P2)
                                      · Saldo > 7d (semáforo)

                    ┌─────────────┐
                    │  WhatsApp    │
                    │   [98F]      │
                    └─────────────┘
                    Consume:
                    · Personas autorizadas
                    · Costo hora (feedback)
                    · Metas (W16, W29)
```
