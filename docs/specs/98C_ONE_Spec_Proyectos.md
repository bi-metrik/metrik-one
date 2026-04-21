---
doc_id: 98C
version: 2.1
updated: 2026-02-20
depends_on: [21], [99]
depended_by: [98A]
decisiones: D68-D97
sesion: Diseño Proyectos + Facturación + Gastos (sesión 4)
revisado_por: Max (Tech Lead), Kaori (Documentación), Hana (QA), Vera (COO)
vigente: false
nota_vigencia: "Modulo /proyectos es LEGACY. Reemplazado por modulo /negocios (decision 2026-04-09). Ver metrik-one/CLAUDE.md para estado actual."
---

# Spec Técnica: Módulo Proyectos + Adiciones Pipeline v2.1

Documento ejecutable para Max en Claude Code. Contiene modelo de datos completo, lógica de negocio, Edge Functions, flujos UI, validaciones y orden de ejecución paso a paso.

Pregunta central: **"¿Cómo voy ejecutando y al final gané o perdí?"**

### Changelog v2.0 -> v2.1

Todo lo marcado con 🆕 es nuevo en esta versión. Max: busca `🆕` para implementar solo los cambios incrementales.

| Sección | Cambio |
|---------|--------|
| §1 | Añadida distinción proyectos cliente vs interno |
| §3.1 | Campos `tipo`, `roi_descripcion`, `roi_retorno_estimado`. `presupuesto_total` ahora nullable para internos |
| §5.6 🆕 | Validaciones backend para bloqueo de facturación/cobros en internos |
| §6.3 | Reglas de estado ampliadas con restricciones por tipo |
| §6.4 🆕 | Reglas de protección contra abuso del flujo interno |
| §7.9 🆕 | UI: Tabs separados, creación con fricción, detalle interno |
| §8 | Nueva fila de clasificación para gastos de proyectos internos |
| §9 | Decisiones D93-D97 añadidas |
| §10 | Pasos de ejecución ampliados |
| §11 | Verificaciones nuevas para internos |

---

## §0. Prerrequisitos — Tablas CRM existentes

Estas tablas ya existen y funcionan (CRM ejecutado). NO recrear. Solo se listan para referencia de FK y para las modificaciones necesarias.

| Tabla | Campos relevantes para Proyectos | Notas |
|-------|----------------------------------|-------|
| `tenants` | id, nombre | Multitenancy base |
| `contactos` | id, tenant_id, nombre, telefono, email, empresa_id | Directorio |
| `empresas` | id, tenant_id, nombre, nit, tipo_persona, gran_contribuyente, agente_retenedor, regimen_tributario | Perfil fiscal cliente |
| `oportunidades` | id, tenant_id, nombre, empresa_id, contacto_id, estado, etapa, valor_estimado | Pipeline |
| `cotizaciones` | id, tenant_id, oportunidad_id, total_con_impuestos, ganancia_real, retenciones_total, modo ('rapido'/'detallado') | Costeo |
| `cotizacion_items` | id, cotizacion_id, descripcion, subtotal, tipo | Rubros de cotización detallada |
| `gastos` | id, tenant_id, proyecto_id, categoria, monto, fecha, descripcion, soporte_url, canal_registro | Registro de gastos |
| `personal` | id, tenant_id, nombre, cargo, salario_mensual, horas_disponibles_mes, es_principal | Setup personal. `costo_hora` = salario_mensual / horas_disponibles_mes |

**Verificación pre-ejecución:** Antes de ejecutar este spec, confirmar que las tablas arriba existen con los campos listados. Si algún campo no existe, agregarlo primero.

---

## §1. Principio de diseño

ONE Proyectos es un **contenedor financiero**, NO un gestor de tareas. Responde "¿estoy ganando o perdiendo en este trabajo?". El usuario registra 4 cosas y el sistema calcula todo lo demás.

**Features incluidas:** Horas, gastos directos por rubro, facturas fraccionadas, cobros por factura, avance manual, cierre con comparativo, retroalimentación a costos, link a carpeta en la nube.

**Features excluidas explícitamente (D68):** Tareas/subtareas, asignación de recursos, Gantt, archivos adjuntos almacenados, comentarios/chat, milestones, dependencias, calendarios, notificaciones internas. Cada exclusión = sprint no construido + botón que no confunde.

### 🆕 Dos tipos de proyecto (D93)

| Tipo | Pregunta que responde | Origen | Facturación |
|------|----------------------|--------|-------------|
| **Cliente** | "¿Estoy ganando o perdiendo en este trabajo?" | Pipeline -> Cotización -> Hard gate -> Proyecto (automático) | Si Facturas + cobros + cartera |
| **Interno** | "¿Cuánto me está costando esta inversión?" | Creación manual con fricción (solo desde tab Internos) | No Bloqueado a nivel de backend |

Un proyecto interno consume tiempo y dinero pero no genera ingresos facturables. Ejemplos: desarrollo de producto propio, campaña de marketing ejecutada internamente, capacitación, reestructuración de procesos.

**Principio de fricción (D94):** Crear un proyecto de cliente por el flujo correcto debe sentirse natural. Crear un proyecto interno debe sentirse como una decisión deliberada. El flujo interno NO es un atajo para evadir Pipeline -> Cotización -> Hard gate.

---

## §2. Modificaciones a tablas existentes

Ejecutar ANTES de crear tablas nuevas.

### §2.1 Agregar carpeta_url a oportunidades (D90)

```sql
-- Adición a Pipeline: campo para link a carpeta en la nube
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS carpeta_url TEXT;

COMMENT ON COLUMN oportunidades.carpeta_url IS 
 'URL a carpeta en la nube (Google Drive, OneDrive, Dropbox). Se hereda al proyecto al ganar.';
```

UI: En vista detalle de Oportunidad, mostrar botón " Carpeta" si `carpeta_url IS NOT NULL`. Abre link en nueva pestaña.

### §2.2 Agregar campos a tabla gastos (D72, D78, D84)

```sql
-- Vincular gasto a rubro presupuestario del proyecto
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS rubro_id UUID;
-- FK se agrega después de crear tabla proyecto_rubros

-- Vincular gasto a borrador de gasto fijo (para reconciliación multi-canal)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS gasto_fijo_ref_id UUID;
-- FK se agrega después de crear tabla gastos_fijos_borradores

-- ID externo para integración futura con Alegra/Siigo
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS external_ref TEXT;

COMMENT ON COLUMN gastos.rubro_id IS 'Rubro presupuestario del proyecto. NULL si gasto operativo general.';
COMMENT ON COLUMN gastos.gasto_fijo_ref_id IS 'Borrador de gasto fijo que este registro confirma. Para reconciliación multi-canal D84.';
COMMENT ON COLUMN gastos.external_ref IS 'ID externo Alegra/Siigo para integración Phase 2.';
```

---

## §3. Tablas nuevas — Crear en este orden (respeta FK)

### §3.1 Tabla: proyectos

```sql
CREATE TABLE proyectos (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 oportunidad_id UUID REFERENCES oportunidades(id),
 cotizacion_id UUID REFERENCES cotizaciones(id),
 empresa_id UUID REFERENCES empresas(id),
 contacto_id UUID REFERENCES contactos(id),
 
 nombre TEXT NOT NULL,
 estado TEXT NOT NULL DEFAULT 'en_ejecucion' 
 CHECK (estado IN ('en_ejecucion', 'pausado', 'cerrado')),
 
 -- 🆕 Tipo de proyecto (D93)
 tipo TEXT NOT NULL DEFAULT 'cliente'
 CHECK (tipo IN ('cliente', 'interno')),
 
 -- Financieros (heredados de cotización para cliente, manuales/opcionales para interno)
 presupuesto_total NUMERIC(15,2), -- 🆕 Ahora nullable: internos pueden no tener presupuesto
 ganancia_estimada NUMERIC(15,2),
 retenciones_estimadas NUMERIC(15,2),
 horas_estimadas NUMERIC(10,2), -- Vacío Max #2: heredado de cotización o calculado
 
 -- Avance (manual, slider 0-100)
 avance_porcentaje INTEGER DEFAULT 0 CHECK (avance_porcentaje BETWEEN 0 AND 100),
 
 -- Carpeta en la nube (D90)
 carpeta_url TEXT,
 
 -- Fechas
 fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
 fecha_fin_estimada DATE,
 fecha_cierre TIMESTAMP WITH TIME ZONE,
 
 -- Cierre (D71)
 lecciones_aprendidas TEXT,
 cierre_snapshot JSONB, -- Comparativo final automático
 
 -- 🆕 ROI para proyectos internos (D97) — opcional, solo aplica tipo = 'interno'
 roi_descripcion TEXT,
 roi_retorno_estimado NUMERIC(15,2),
 
 -- Tracking
 canal_creacion TEXT DEFAULT 'app' CHECK (canal_creacion IN ('app', 'whatsapp', 'auto')),
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS
ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_proyectos" ON proyectos
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Índices
CREATE INDEX idx_proyectos_tenant_estado ON proyectos(tenant_id, estado);
CREATE INDEX idx_proyectos_tenant_tipo ON proyectos(tenant_id, tipo, estado); -- 🆕
CREATE INDEX idx_proyectos_empresa ON proyectos(empresa_id);
CREATE INDEX idx_proyectos_oportunidad ON proyectos(oportunidad_id);
```

**🆕 Restricción de integridad para tipo 'cliente' (D93):** Los proyectos de cliente DEBEN tener presupuesto y oportunidad. Los internos NO. Esto se valida en la Edge Function de creación (§5.1 y §5.6), no con CHECK constraint, porque CHECK no puede referenciar condicionalmente.

```
Validación en Edge Function:
SI tipo = 'cliente':
 -> oportunidad_id REQUIRED
 -> cotizacion_id REQUIRED
 -> presupuesto_total REQUIRED (> 0)
SI tipo = 'interno':
 -> oportunidad_id MUST BE NULL
 -> cotizacion_id MUST BE NULL
 -> empresa_id MUST BE NULL
 -> presupuesto_total OPTIONAL
```

### §3.2 Tabla: proyecto_rubros

Líneas presupuestarias heredadas de cotización. Permiten comparativo presupuesto vs real.

```sql
CREATE TABLE proyecto_rubros (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 proyecto_id UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
 nombre TEXT NOT NULL,
 presupuestado NUMERIC(15,2) NOT NULL,
 tipo TEXT DEFAULT 'general' 
 CHECK (tipo IN ('horas', 'materiales', 'transporte', 'subcontratacion', 'servicios_profesionales', 'general')),
 
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rubros_proyecto ON proyecto_rubros(proyecto_id);

-- Ahora agregar FK de gastos -> proyecto_rubros
ALTER TABLE gastos ADD CONSTRAINT fk_gastos_rubro 
 FOREIGN KEY (rubro_id) REFERENCES proyecto_rubros(id);
```

### §3.3 Tabla: facturas (D74)

Facturación fraccionada: un proyecto puede tener N facturas.

```sql
CREATE TABLE facturas (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 proyecto_id UUID NOT NULL REFERENCES proyectos(id),
 
 numero_factura TEXT, -- Referencia manual o de Alegra
 monto NUMERIC(15,2) NOT NULL CHECK (monto > 0),
 fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
 
 notas TEXT,
 external_ref TEXT, -- (D72) ID externo Alegra/Siigo
 canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app', 'whatsapp')),
 
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- NOTA: El saldo pendiente NUNCA se almacena. Se calcula siempre como:
-- saldo_pendiente = factura.monto - SUM(cobros.monto WHERE factura_id = factura.id)

ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_facturas" ON facturas
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE INDEX idx_facturas_proyecto ON facturas(proyecto_id);
CREATE INDEX idx_facturas_tenant ON facturas(tenant_id);
```

### §3.4 Tabla: cobros (D75)

Cada cobro se asocia a una factura específica. Pagos parciales permitidos.

```sql
CREATE TABLE cobros (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 factura_id UUID NOT NULL REFERENCES facturas(id),
 proyecto_id UUID NOT NULL REFERENCES proyectos(id), -- Redundante pero útil para queries directos
 
 monto NUMERIC(15,2) NOT NULL CHECK (monto > 0),
 fecha DATE NOT NULL DEFAULT CURRENT_DATE,
 
 notas TEXT,
 external_ref TEXT, -- (D72)
 canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app', 'whatsapp')),
 
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE cobros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_cobros" ON cobros
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE INDEX idx_cobros_factura ON cobros(factura_id);
CREATE INDEX idx_cobros_proyecto ON cobros(proyecto_id);
```

### §3.5 Tabla: horas

```sql
CREATE TABLE horas (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 proyecto_id UUID NOT NULL REFERENCES proyectos(id),
 
 fecha DATE NOT NULL DEFAULT CURRENT_DATE,
 horas NUMERIC(5,2) NOT NULL CHECK (horas > 0 AND horas <= 24),
 descripcion TEXT,
 canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app', 'whatsapp')),
 
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE horas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_horas" ON horas
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE INDEX idx_horas_proyecto ON horas(proyecto_id);
CREATE INDEX idx_horas_tenant_fecha ON horas(tenant_id, fecha);
```

### §3.6 Tabla: gastos_fijos_config (D81)

Referencia de gastos fijos recurrentes. Se configura una vez. Alimenta punto de equilibrio y runway.

```sql
CREATE TABLE gastos_fijos_config (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 
 nombre TEXT NOT NULL,
 categoria TEXT NOT NULL CHECK (categoria IN (
 'materiales', 'transporte', 'alimentacion', 'servicios_profesionales',
 'software', 'arriendo', 'marketing', 'capacitacion', 'otros'
 )),
 monto_referencia NUMERIC(15,2) NOT NULL CHECK (monto_referencia > 0),
 activo BOOLEAN DEFAULT true,
 
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE gastos_fijos_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_gf_config" ON gastos_fijos_config
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
```

### §3.7 Tabla: gastos_fijos_borradores (D83)

Borradores mensuales pre-generados desde Config. El usuario confirma con timestamp real.

```sql
CREATE TABLE gastos_fijos_borradores (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 gasto_fijo_config_id UUID NOT NULL REFERENCES gastos_fijos_config(id),
 
 periodo TEXT NOT NULL, -- formato 'YYYY-MM'
 nombre TEXT NOT NULL,
 categoria TEXT NOT NULL,
 monto_esperado NUMERIC(15,2) NOT NULL,
 
 confirmado BOOLEAN DEFAULT false,
 gasto_id UUID REFERENCES gastos(id), -- Apunta al gasto real cuando se confirma
 fecha_confirmacion TIMESTAMP WITH TIME ZONE,
 
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 
 -- Un borrador por gasto fijo por mes, sin duplicados
 UNIQUE(gasto_fijo_config_id, periodo)
);

ALTER TABLE gastos_fijos_borradores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_gf_borradores" ON gastos_fijos_borradores
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE INDEX idx_borradores_pendientes ON gastos_fijos_borradores(tenant_id, periodo, confirmado)
 WHERE confirmado = false;

-- Ahora agregar FK de gastos -> borradores
ALTER TABLE gastos ADD CONSTRAINT fk_gastos_borrador
 FOREIGN KEY (gasto_fijo_ref_id) REFERENCES gastos_fijos_borradores(id);
```

### §3.8 Tabla: costos_referencia (D70)

Promedios históricos para retroalimentar cotizaciones futuras.

```sql
CREATE TABLE costos_referencia (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 tipo_servicio TEXT, -- del catálogo de servicios del tenant
 
 horas_promedio NUMERIC(10,2),
 costo_promedio NUMERIC(15,2),
 margen_promedio NUMERIC(5,2),
 proyectos_base INTEGER DEFAULT 0, -- cuántos proyectos alimentan este promedio
 
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 
 UNIQUE(tenant_id, tipo_servicio)
);

ALTER TABLE costos_referencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_costos_ref" ON costos_referencia
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
```

### §3.9 Tabla: proyecto_notas (para novedades WhatsApp W11)

```sql
CREATE TABLE proyecto_notas (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 proyecto_id UUID NOT NULL REFERENCES proyectos(id),
 
 contenido TEXT NOT NULL,
 canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app', 'whatsapp')),
 
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE proyecto_notas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_notas" ON proyecto_notas
 USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE INDEX idx_notas_proyecto ON proyecto_notas(proyecto_id);
```

---

## §4. Vistas SQL

### §4.1 Vista: resumen financiero por proyecto (D76)

```sql
CREATE OR REPLACE VIEW v_proyecto_financiero AS
SELECT 
 p.id AS proyecto_id,
 p.tenant_id,
 p.nombre,
 p.estado,
 p.tipo, -- 🆕 Para filtrar y condicionar UI por tipo
 p.presupuesto_total,
 p.horas_estimadas,
 p.avance_porcentaje,
 p.ganancia_estimada,
 p.retenciones_estimadas,
 p.carpeta_url,
 p.fecha_inicio,
 p.fecha_cierre,
 
 -- Empresa y contacto
 e.nombre AS empresa_nombre,
 ct.nombre AS contacto_nombre,
 
 -- Horas reales
 COALESCE(h.total_horas, 0) AS horas_reales,
 
 -- Costo por horas (horas × costo_hora del personal principal del tenant)
 COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0) AS costo_horas,
 
 -- Gastos directos (gastos con proyecto_id = este proyecto)
 COALESCE(g.total_gastos, 0) AS gastos_directos,
 
 -- Costo acumulado total
 (COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0) AS costo_acumulado,
 
 -- Presupuesto consumido %
 CASE WHEN p.presupuesto_total > 0 THEN
 ROUND((((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total) * 100, 1)
 ELSE 0 END AS presupuesto_consumido_pct,
 
 -- Facturado
 COALESCE(f.total_facturado, 0) AS facturado,
 COALESCE(f.num_facturas, 0) AS num_facturas,
 
 -- Cobrado
 COALESCE(c.total_cobrado, 0) AS cobrado,
 
 -- Cartera = facturado - cobrado
 COALESCE(f.total_facturado, 0) - COALESCE(c.total_cobrado, 0) AS cartera,
 
 -- Por facturar = presupuesto - facturado
 p.presupuesto_total - COALESCE(f.total_facturado, 0) AS por_facturar,
 
 -- Ganancia real en tiempo real
 COALESCE(c.total_cobrado, 0) 
 - ((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0))
 AS ganancia_real

FROM proyectos p

LEFT JOIN empresas e ON e.id = p.empresa_id
LEFT JOIN contactos ct ON ct.id = p.contacto_id

-- Personal principal para costo_hora (MVP: 1 persona por tenant)
LEFT JOIN LATERAL (
 SELECT (salario_mensual / NULLIF(horas_disponibles_mes, 0)) AS costo_hora_calc
 FROM personal
 WHERE tenant_id = p.tenant_id AND es_principal = true
 LIMIT 1
) per ON true

-- Total horas
LEFT JOIN LATERAL (
 SELECT SUM(hr.horas) AS total_horas
 FROM horas hr
 WHERE hr.proyecto_id = p.id
) h ON true

-- Total gastos directos
LEFT JOIN LATERAL (
 SELECT SUM(gs.monto) AS total_gastos
 FROM gastos gs
 WHERE gs.proyecto_id = p.id
) g ON true

-- Total facturado
LEFT JOIN LATERAL (
 SELECT SUM(fa.monto) AS total_facturado, COUNT(*) AS num_facturas
 FROM facturas fa
 WHERE fa.proyecto_id = p.id
) f ON true

-- Total cobrado
LEFT JOIN LATERAL (
 SELECT SUM(co.monto) AS total_cobrado
 FROM cobros co
 WHERE co.proyecto_id = p.id
) c ON true;
```

### §4.2 Vista: presupuesto vs real por rubro (D79)

```sql
CREATE OR REPLACE VIEW v_proyecto_rubros_comparativo AS
SELECT
 pr.id AS rubro_id,
 pr.proyecto_id,
 pr.nombre AS rubro_nombre,
 pr.tipo AS rubro_tipo,
 pr.presupuestado,
 COALESCE(SUM(g.monto), 0) AS gastado_real,
 pr.presupuestado - COALESCE(SUM(g.monto), 0) AS diferencia,
 CASE WHEN pr.presupuestado > 0 THEN
 ROUND((COALESCE(SUM(g.monto), 0) / pr.presupuestado) * 100, 1)
 ELSE 0 END AS consumido_pct
FROM proyecto_rubros pr
LEFT JOIN gastos g ON g.rubro_id = pr.id
GROUP BY pr.id, pr.proyecto_id, pr.nombre, pr.tipo, pr.presupuestado;
```

### §4.3 Vista: estado de cada factura con saldo (D75)

```sql
CREATE OR REPLACE VIEW v_facturas_estado AS
SELECT
 f.id AS factura_id,
 f.tenant_id,
 f.proyecto_id,
 f.numero_factura,
 f.monto,
 f.fecha_emision,
 COALESCE(SUM(c.monto), 0) AS cobrado,
 f.monto - COALESCE(SUM(c.monto), 0) AS saldo_pendiente,
 CASE 
 WHEN f.monto - COALESCE(SUM(c.monto), 0) <= 0 THEN 'pagada'
 WHEN COALESCE(SUM(c.monto), 0) > 0 THEN 'parcial'
 ELSE 'pendiente'
 END AS estado_pago,
 CURRENT_DATE - f.fecha_emision AS dias_antiguedad
FROM facturas f
LEFT JOIN cobros c ON c.factura_id = f.id
GROUP BY f.id, f.tenant_id, f.proyecto_id, f.numero_factura, f.monto, f.fecha_emision;
```

### §4.4 Vista: cartera por antigüedad (para Números)

```sql
CREATE OR REPLACE VIEW v_cartera_antiguedad AS
SELECT
 sub.tenant_id,
 SUM(CASE WHEN sub.dias <= 30 THEN sub.saldo ELSE 0 END) AS rango_0_30,
 SUM(CASE WHEN sub.dias > 30 AND sub.dias <= 60 THEN sub.saldo ELSE 0 END) AS rango_31_60,
 SUM(CASE WHEN sub.dias > 60 AND sub.dias <= 90 THEN sub.saldo ELSE 0 END) AS rango_61_90,
 SUM(CASE WHEN sub.dias > 90 THEN sub.saldo ELSE 0 END) AS rango_90_plus,
 SUM(sub.saldo) AS total_cartera
FROM (
 SELECT 
 f.tenant_id,
 f.monto - COALESCE(SUM(c.monto), 0) AS saldo,
 CURRENT_DATE - f.fecha_emision AS dias
 FROM facturas f
 LEFT JOIN cobros c ON c.factura_id = f.id
 GROUP BY f.id, f.tenant_id, f.monto, f.fecha_emision
 HAVING f.monto - COALESCE(SUM(c.monto), 0) > 0
) sub
GROUP BY sub.tenant_id;
```

### §4.5 Vista: gastos fijos borradores del mes actual

```sql
CREATE OR REPLACE VIEW v_gastos_fijos_mes_actual AS
SELECT
 b.id AS borrador_id,
 b.tenant_id,
 b.nombre,
 b.categoria,
 b.monto_esperado,
 b.confirmado,
 b.fecha_confirmacion,
 g.monto AS monto_real,
 g.fecha AS fecha_pago_real
FROM gastos_fijos_borradores b
LEFT JOIN gastos g ON g.id = b.gasto_id
WHERE b.periodo = TO_CHAR(NOW(), 'YYYY-MM');
```

---

## §5. Edge Functions (pseudocódigo ejecutable)

### §5.1 Crear proyecto al ganar oportunidad (D45, D68)

**Trigger:** Cuando `oportunidades.estado` cambia a `'ganada'` (extender la Edge Function existente del hard gate CRM).

```
FUNCIÓN: crear_proyecto_desde_oportunidad(oportunidad_id)

1. Obtener oportunidad con empresa, contacto
2. Obtener cotización ganadora:
 SELECT * FROM cotizaciones WHERE oportunidad_id = $1 ORDER BY created_at DESC LIMIT 1
 
3. Calcular horas_estimadas:
 SI cotizacion.modo = 'detallado':
 horas_est = SUM(cotizacion_items.subtotal WHERE tipo = 'horas') / costo_hora_personal_principal
 SI cotizacion.modo = 'rapido':
 horas_est = NULL -- No se puede inferir

4. INSERT INTO proyectos:
 - tenant_id = oportunidad.tenant_id
 - oportunidad_id = oportunidad.id
 - cotizacion_id = cotizacion.id
 - empresa_id = oportunidad.empresa_id
 - contacto_id = oportunidad.contacto_id
 - nombre = oportunidad.nombre
 - presupuesto_total = cotizacion.total_con_impuestos
 - ganancia_estimada = cotizacion.ganancia_real
 - retenciones_estimadas = cotizacion.retenciones_total
 - horas_estimadas = horas_est (puede ser NULL)
 - carpeta_url = oportunidad.carpeta_url
 - estado = 'en_ejecucion'
 - canal_creacion = 'auto'

5. SI cotizacion.modo = 'detallado':
 INSERT INTO proyecto_rubros (proyecto_id, nombre, presupuestado, tipo):
 Para cada cotizacion_item:
 - nombre = item.descripcion
 - presupuestado = item.subtotal
 - tipo = mapear item.tipo a enum de proyecto_rubros
 
 SI cotizacion.modo = 'rapido':
 INSERT INTO proyecto_rubros:
 - nombre = 'Presupuesto general'
 - presupuestado = presupuesto_total
 - tipo = 'general'

6. RETURN proyecto.id
```

### §5.2 Generar borradores gastos fijos mensuales (D83)

**Trigger:** Cron job, día 1 de cada mes a las 06:00 COT. También ejecutar al crear primer gasto fijo en config.

```
FUNCIÓN: generar_borradores_gastos_fijos()

1. Para cada tenant con gastos_fijos_config activos:
 
 INSERT INTO gastos_fijos_borradores (tenant_id, gasto_fijo_config_id, periodo, nombre, categoria, monto_esperado)
 SELECT tenant_id, id, TO_CHAR(NOW(), 'YYYY-MM'), nombre, categoria, monto_referencia
 FROM gastos_fijos_config
 WHERE activo = true
 ON CONFLICT (gasto_fijo_config_id, periodo) DO NOTHING;
```

### §5.3 Match de gasto fijo al registrar gasto (D84)

**Trigger:** Llamar desde cualquier endpoint de registro de gasto (app, FAB, WhatsApp).

```
FUNCIÓN: match_gasto_fijo(tenant_id, categoria, monto, fecha) -> { match, borrador_id, accion }

1. periodo = TO_CHAR(fecha, 'YYYY-MM')

2. Buscar borradores pendientes:
 SELECT * FROM gastos_fijos_borradores
 WHERE tenant_id = $1 AND periodo = $4 AND confirmado = false AND categoria = $2

3. SI no hay resultados -> RETURN { match: false }

4. SI hay resultado:
 borrador = primer resultado
 
 SI ABS(monto - borrador.monto_esperado) / borrador.monto_esperado <= 0.20:
 -> RETURN { match: true, borrador_id: borrador.id, accion: 'auto_confirm' }
 SINO:
 -> RETURN { match: true, borrador_id: borrador.id, accion: 'ask_user', 
 monto_esperado: borrador.monto_esperado, nombre: borrador.nombre }

5. ADICIONAL: Si borrador ya confirmado para ese periodo:
 SELECT * FROM gastos_fijos_borradores
 WHERE tenant_id = $1 AND periodo = $4 AND confirmado = true AND categoria = $2
 
 SI existe -> RETURN { match: false, warning: 'already_confirmed', 
 fecha_confirmacion: borrador.fecha_confirmacion }
```

### §5.4 Confirmar borrador de gasto fijo

**Trigger:** Después de crear gasto que matcheó con borrador.

```
FUNCIÓN: confirmar_borrador(borrador_id, gasto_id)

1. UPDATE gastos_fijos_borradores
 SET confirmado = true, gasto_id = $2, fecha_confirmacion = NOW()
 WHERE id = $1 AND confirmado = false

2. UPDATE gastos
 SET gasto_fijo_ref_id = $1
 WHERE id = $2
```

### §5.5 Cierre de proyecto — snapshot + retroalimentación (D70, D71)

**Trigger:** Cuando `proyectos.estado` cambia a `'cerrado'`.

```
FUNCIÓN: cerrar_proyecto(proyecto_id)

1. Obtener datos financieros de v_proyecto_financiero WHERE proyecto_id = $1
2. Obtener rubros de v_proyecto_rubros_comparativo WHERE proyecto_id = $1
3. Obtener horas: SELECT SUM(horas) FROM horas WHERE proyecto_id = $1

4. Construir snapshot JSON:
 {
 presupuesto: datos.presupuesto_total,
 costo_real: datos.costo_acumulado,
 delta_costo_pct: ROUND(((costo_acumulado - presupuesto_total) / presupuesto_total) * 100, 1),
 horas_estimadas: datos.horas_estimadas,
 horas_reales: horas_sum,
 delta_horas_pct: SI horas_estimadas NOT NULL THEN ROUND(((horas_reales - horas_estimadas) / horas_estimadas) * 100, 1) ELSE NULL,
 facturado: datos.facturado,
 cobrado: datos.cobrado,
 pendiente_cobro: datos.cartera,
 ganancia_real: datos.ganancia_real,
 rentabilidad_pct: ROUND((ganancia_real / presupuesto_total) * 100, 1),
 rentabilidad_estimada_pct: ROUND((ganancia_estimada / presupuesto_total) * 100, 1),
 rubros: [array de rubros con presupuestado, real, delta_pct]
 }

5. UPDATE proyectos SET cierre_snapshot = snapshot, fecha_cierre = NOW()
 WHERE id = $1

6. Retroalimentar costos_referencia:
 -- Buscar o crear registro por tipo_servicio del tenant
 INSERT INTO costos_referencia (tenant_id, tipo_servicio, horas_promedio, costo_promedio, margen_promedio, proyectos_base)
 VALUES ($tenant, $tipo, $horas_reales, $costo_real, $rentabilidad, 1)
 ON CONFLICT (tenant_id, tipo_servicio) DO UPDATE SET
 horas_promedio = (costos_referencia.horas_promedio * costos_referencia.proyectos_base + $horas_reales) / (costos_referencia.proyectos_base + 1),
 costo_promedio = (costos_referencia.costo_promedio * costos_referencia.proyectos_base + $costo_real) / (costos_referencia.proyectos_base + 1),
 margen_promedio = (costos_referencia.margen_promedio * costos_referencia.proyectos_base + $rentabilidad) / (costos_referencia.proyectos_base + 1),
 proyectos_base = costos_referencia.proyectos_base + 1,
 updated_at = NOW();
```

### 🆕 §5.6 Validaciones backend para proyectos internos (D93, D94)

**Trigger:** Toda operación de escritura sobre proyecto. Cinturón y tirantes — la UI oculta los botones, pero el backend TAMBIÉN rechaza.

```
FUNCIÓN: validar_operacion_proyecto(proyecto_id, accion) -> { permitido, mensaje_error }

1. Obtener proyecto: SELECT tipo FROM proyectos WHERE id = $1

2. SI tipo = 'interno' AND accion IN ('crear_factura', 'crear_cobro'):
 -> REJECT: { permitido: false, mensaje: "Los proyectos internos no admiten facturación ni cobros." }

3. SI accion = 'crear_proyecto_interno':
 Validar que NO tenga:
 - oportunidad_id (debe ser NULL)
 - cotizacion_id (debe ser NULL)
 - empresa_id (debe ser NULL)
 SI alguno tiene valor -> REJECT: "Un proyecto interno no puede tener cliente, oportunidad ni cotización asociada."

4. SI accion = 'crear_proyecto_cliente':
 Validar que SÍ tenga:
 - oportunidad_id NOT NULL
 - cotizacion_id NOT NULL
 - presupuesto_total NOT NULL y > 0
 SI falta alguno -> REJECT: "Un proyecto de cliente requiere oportunidad, cotización y presupuesto."
```

**WhatsApp — manejo de intenciones bloqueadas para internos:**

```
SI usuario dice "me pagaron X del proyecto Y" Y proyecto Y es tipo = 'interno':
 Bot responde: "El proyecto {nombre} es interno y no admite cobros.
 Si necesitas facturar este trabajo, créalo como proyecto
 de cliente desde Pipeline en la app.
 ¿Querías registrar el cobro en otro proyecto?"
 -> Listar proyectos tipo = 'cliente' con facturas con saldo > 0
```

---

## §6. Reglas de negocio y alertas (D77)

### §6.1 Semáforo barras duales (D38)

| Barra | Dato | Fuente |
|-------|------|--------|
| Izquierda | Avance % | `proyectos.avance_porcentaje` (slider manual) |
| Derecha | Presupuesto consumido % | `v_proyecto_financiero.presupuesto_consumido_pct` (calculado) |

Semáforo barra derecha: Verde <70%, Amarillo 70-90%, Rojo >90%.

🆕 **Para internos sin presupuesto:** Solo barra de avance (izquierda). Barra derecha no se muestra si `presupuesto_total IS NULL`.

### §6.2 Alertas del proyecto

| ID | Alerta | Condición SQL / lógica | Mensaje usuario | Severidad | 🆕 Aplica a |
|----|--------|----------------------|-----------------|-----------|-------------|
| A01 | Desvío presupuestal | presupuesto_consumido_pct > 80 AND avance_porcentaje < 60 | "Estás gastando más rápido de lo que avanzas" | | cliente + interno (si tiene presupuesto) |
| A02 | Horas excedidas | horas_reales > horas_estimadas * 1.10 AND horas_estimadas IS NOT NULL | "Llevas {n}% más horas de las estimadas" | | cliente + interno (si tiene horas_estimadas) |
| A03 | Factura vencida | v_facturas_estado.saldo_pendiente > 0 AND dias_antiguedad > 30 | "Factura #{num} lleva {n} días sin cobro" | | solo cliente |
| A04 | Desfase facturación | avance > 80 AND (facturado / presupuesto_total) < 0.40 | "Vas adelante en ejecución pero atrasado en facturación" | | solo cliente |
| A05 | Pago sin factura | Se registra cobro pero proyecto no tiene facturas con saldo | "Recibiste pago sin factura. ¿Registrar factura?" | | solo cliente |
| A06 | Tip Régimen Simple | usuario es RST AND tiene > 1 factura por proyecto | "Facturar por avance distribuye tu carga fiscal bimestral" | | solo cliente |

### §6.3 Reglas de estado

| Transición | Permitida | Efecto |
|-----------|-----------|--------|
| en_ejecucion -> pausado | Si | No se permiten nuevos registros de horas/gastos/facturas |
| en_ejecucion -> cerrado | Si | Ejecuta §5.5. Inmutable después. Solo cobros permitidos post-cierre (tipo cliente). |
| pausado -> en_ejecucion | Si | Se reactivan registros |
| pausado -> cerrado | Si | Ejecuta §5.5 |
| cerrado -> cualquier | No | Estado terminal |

**Excepción cobros post-cierre:** Un proyecto cerrado de tipo **cliente** PUEDE recibir cobros nuevos. 🆕 Un proyecto cerrado de tipo **interno** NO tiene cobros en ningún momento.

### 🆕 §6.4 Protección contra abuso del flujo interno (D94)

El proyecto interno NO debe convertirse en atajo para evadir el flujo comercial. Estas reglas protegen la integridad del proceso:

| Regla | Implementación | Nivel |
|-------|---------------|-------|
| No crear internos desde FAB | El FAB (+) NO incluye opción "Proyecto interno" | UI |
| No crear internos desde WhatsApp | El bot NO tiene intención "crear proyecto interno" | Bot |
| No convertir interno -> cliente | NO existe botón ni endpoint para cambiar tipo | Backend + UI |
| No facturar en interno | Endpoint rechaza. UI oculta sección. Bot rechaza. | Backend + UI + Bot |
| No cobrar en interno | Endpoint rechaza. UI oculta sección. Bot rechaza. | Backend + UI + Bot |
| Único punto de entrada | Tab "Internos" -> botón "Nuevo proyecto interno" con confirmación | UI |
| Confirmación educativa | Modal con mensaje + shortcut a Pipeline (ver §7.9) | UI |

**¿Y si el usuario se equivocó?** Si creó un interno pero necesita facturar -> debe crear el proyecto correctamente desde Pipeline (oportunidad -> cotización -> hard gate). Los registros de horas y gastos del interno quedan como referencia histórica, pero NO se migran.

---

## §7. Flujos UI completos

### §7.1 Registro de gasto desde dentro del proyecto

Ruta: `/proyectos/{id}` -> botón "Registrar gasto"

| Campo | Tipo | Obligatorio | Comportamiento |
|-------|------|-------------|----------------|
| Monto | Currency input | Sí | — |
| Rubro | Select dropdown | Sí* | Pre-poblado con `proyecto_rubros WHERE proyecto_id = actual`. *Si solo hay rubro 'general' (cotización flash) -> no mostrar selector, asignar automático |
| Descripción | Text input | No | Placeholder: "Ej: Compra tornillos ferretería" |
| Fecha | Date picker | Sí | Default: hoy |
| Soporte | File upload (imagen/PDF) | No | Guardar en Supabase Storage, URL en `gastos.soporte_url` |

**Al seleccionar rubro, mostrar inline:** "Llevas $X de $Y presupuestados en este rubro (Z%)" -> datos de `v_proyecto_rubros_comparativo`.

**Al guardar:**
1. Ejecutar match_gasto_fijo (§5.3) con la categoría equivalente
2. Si match auto_confirm -> confirmar borrador + crear gasto con `gasto_fijo_ref_id`
3. Si match ask_user -> mostrar modal: "¿Este gasto de $X es tu {nombre} mensual ($Y esperado)?"
4. Si no match -> crear gasto normal con `proyecto_id` y `rubro_id`

### §7.2 Registro de gasto desde FAB (cualquier pantalla)

Ruta: FAB (+) -> "Gasto"

| Campo | Tipo | Obligatorio | Comportamiento |
|-------|------|-------------|----------------|
| Monto | Currency input | Sí | — |
| Categoría | Select | Sí | 9 categorías: materiales, transporte, alimentacion, servicios_profesionales, software, arriendo, marketing, capacitacion, otros |
| Proyecto | Select | **No** | Opciones: lista de `proyectos WHERE estado = 'en_ejecucion'` + "Sin proyecto (gasto general)". 🆕 Incluye AMBOS tipos (cliente e interno). Internos se muestran con badge gris "Interno" para distinguir. |
| Rubro | Select | Condicional | **Solo aparece SI seleccionó proyecto**. Opciones: `proyecto_rubros WHERE proyecto_id = seleccionado`. Si solo rubro 'general' -> no mostrar. |
| Descripción | Text | No | — |
| Fecha | Date | Sí | Default: hoy |
| Soporte | File upload | No | — |

**Lógica condicional (D80):**
- Proyecto = NULL -> `gastos.proyecto_id = NULL` -> gasto operativo -> solo P&L
- Proyecto seleccionado -> campo Rubro aparece -> `gastos.proyecto_id` + `gastos.rubro_id` -> gasto directo -> proyecto + P&L

### §7.3 Registro de factura

Ruta: `/proyectos/{id}` -> sección "Facturación" -> "Registrar factura"

| Campo | Tipo | Obligatorio | Comportamiento |
|-------|------|-------------|----------------|
| Monto | Currency | Sí | — |
| Fecha emisión | Date | Sí | Default: hoy |
| # Factura | Text | No | Referencia manual. Placeholder: "Ej: FV-0042" |
| Notas | Text | No | — |

**Contexto visible arriba del formulario:**
```
Presupuesto: $15.000.000 | Facturado: $10.000.000 | Disponible: $5.000.000
```
Datos de `v_proyecto_financiero`.

**Validación:** Si monto > por_facturar -> warning (no bloqueo): "Este monto supera el presupuesto pendiente. ¿Hay una adición al contrato?"

### §7.4 Registro de cobro

Ruta: `/proyectos/{id}` -> sección "Cobros" -> "Registrar cobro"

| Campo | Tipo | Obligatorio | Comportamiento |
|-------|------|-------------|----------------|
| Factura | Select | Sí | Solo facturas con `saldo_pendiente > 0` de `v_facturas_estado WHERE proyecto_id = actual` |
| Monto | Currency | Sí | Default: `saldo_pendiente` de la factura seleccionada |
| Fecha | Date | Sí | Default: hoy |
| Notas | Text | No | — |

**Al seleccionar factura, mostrar:** "Factura #{num} — Emitida {fecha} — Saldo: $X"

**Validación:** Si monto > saldo_pendiente -> warning: "El monto excede el saldo de esta factura. ¿Es un pago adicional?"

### §7.5 Gastos fijos del mes (D83)

Ruta: En Números o como sección flotante / card en dashboard.

**Query:** `SELECT * FROM v_gastos_fijos_mes_actual WHERE tenant_id = actual`

**Render por cada borrador no confirmado:**
```
☐ {nombre} ${monto_esperado} [Confirmar pago] [Ajustar monto]
```

**[Confirmar pago]:**
1. Crear gasto con: categoria = borrador.categoria, monto = borrador.monto_esperado, proyecto_id = NULL, fecha = NOW()
2. Ejecutar confirmar_borrador(borrador_id, gasto_id)
3. UI actualiza: ☑ {nombre} — Pagado ${monto} el {fecha}

**[Ajustar monto]:**
1. Abrir modal con monto editable pre-llenado
2. Crear gasto con monto ajustado
3. Confirmar borrador

### §7.6 Vista lista de proyectos — 🆕 Con tabs separados (D96)

Ruta: `/proyectos`

```
┌─────────────────────────────────────────┐
│ Mis Proyectos │
│ │
│ [De clientes (3)] [Internos (1)] │
│ ═══════════════ ────────────── │
│ │
│ (contenido del tab activo) │
└─────────────────────────────────────────┘
```

**Tab "De clientes" (default al entrar):**

**Query:** `SELECT * FROM v_proyecto_financiero WHERE tenant_id = actual AND tipo = 'cliente' ORDER BY CASE estado WHEN 'en_ejecucion' THEN 1 WHEN 'pausado' THEN 2 WHEN 'cerrado' THEN 3 END, updated_at DESC`

Cada proyecto como EntityCard con:
- Nombre + empresa
- Estado badge (verde/amarillo/gris)
- Barras duales: avance vs presupuesto consumido
- Ganancia real (verde si > 0, rojo si < 0)

**Tab "Internos":**

**Query:** `SELECT * FROM v_proyecto_financiero WHERE tenant_id = actual AND tipo = 'interno' ORDER BY CASE estado WHEN 'en_ejecucion' THEN 1 WHEN 'pausado' THEN 2 WHEN 'cerrado' THEN 3 END, updated_at DESC`

Cada proyecto como EntityCard con:
- Nombre (sin empresa — no tiene)
- Badge "Interno" gris
- Estado badge
- Barra de avance (solo izquierda si no tiene presupuesto)
- Barra presupuesto consumido (solo si `presupuesto_total IS NOT NULL`)
- Costo acumulado (horas + gastos) — siempre visible
- **Botón "Nuevo proyecto interno"** visible solo en este tab (ver §7.9)

### §7.7 Vista detalle del proyecto

Ruta: `/proyectos/{id}`

```
┌───────────────────────────────────────────────┐
│ [◀ Proyectos] [ Carpeta]* │
│ │
│ {nombre} [{estado}] │
│ {contacto_nombre} — {empresa_nombre} │
│ │
│ ┌─ Avance ─────────────┐ ┌─ Presupuesto ────┐ │
│ │ ████████░░░░ {av}% │ │ ██████░░░░ {pc}% │ │
│ └──────────────────────┘ └───────────────────┘ │
│ │
│ ┌─ Resumen financiero ───────────────────────┐ │
│ │ Presupuesto: ${presupuesto_total} │ │
│ │ Costo acumulado: ${costo_acumulado} │ │
│ │ Facturado: ${facturado} │ │
│ │ Cobrado: ${cobrado} │ │
│ │ Cartera: ${cartera} │ │
│ │ Por facturar: ${por_facturar} │ │
│ │ Ganancia actual: ${ganancia_real} Si/ │ │
│ └────────────────────────────────────────────┘ │
│ │
│ ┌─ Presupuesto vs Real por rubro ────────────┐ │
│ │ (v_proyecto_rubros_comparativo) │ │
│ │ {rubro} ${gastado} / ${presup} {%} Si/[ATENCION]│ │
│ │ ... │ │
│ │ * Solo visible si > 1 rubro (cot detallada)│ │
│ └────────────────────────────────────────────┘ │
│ │
│ ┌─ Facturas ─────────────────────────────────┐ │
│ │ (v_facturas_estado WHERE proyecto_id) │ │
│ │ #{num} ${monto} {fecha} {estado} {dias} │ │
│ │ ... │ │
│ │ [+ Registrar factura] │ │
│ └────────────────────────────────────────────┘ │
│ │
│ ┌─ Últimos registros ────────────────────────┐ │
│ │ Últimas 10 entradas (horas+gastos+cobros) │ │
│ │ ORDER BY fecha DESC, created_at DESC │ │
│ └────────────────────────────────────────────┘ │
│ │
│ [Slider avance: ████████░░░░ {av}%] │
│ │
│ [+ Gasto] [+ Horas] [+ Cobro] [Pausar/Cerrar]│
└───────────────────────────────────────────────┘

* Botón solo visible si carpeta_url IS NOT NULL
```

### §7.8 Vista cierre del proyecto

Ruta: `/proyectos/{id}/cierre` (o modal sobre detalle)

**Paso 1:** Confirmación: "¿Cerrar proyecto {nombre}? Esta acción es permanente."

**Paso 2:** Campo opcional: "¿Qué aprendiste en este proyecto?" (textarea)

**Paso 3:** Al confirmar -> ejecutar Edge Function §5.5 -> mostrar comparativo:

```
┌─ Comparativo Final ──────────────────────────┐
│ Estimado Real Δ │
│ Presupuesto: $15M — — │
│ Costo total: $12M $10.5M -12% │
│ Horas: 50 42 -16% │
│ Facturado: $15M $15M 0% │
│ Cobrado: — $14M — │
│ Cartera pendiente: — $1M — │
│ Rentabilidad: 18% 23% +5pp │
│ │
│ Por rubro: │
│ Horas diseño: $3M / $2.4M (-20%) Si │
│ Materiales: $1.5M / $1.8M (+20%) [ATENCION] │
│ Transporte: $500K / $200K (-60%) Si │
└──────────────────────────────────────────────┘
```

### 🆕 §7.9 Proyectos internos — UI completa (D94, D96, D97)

#### §7.9.1 Creación de proyecto interno (con fricción)

**Único punto de entrada:** Tab "Internos" (en §7.6) -> botón "Nuevo proyecto interno"

**Paso 1 — Confirmación educativa (modal obligatorio):**

```
┌─────────────────────────────────────────────┐
│ │
│ [ATENCION] Proyecto interno │
│ │
│ Este proyecto no genera ingresos │
│ facturables. Los costos se registrarán │
│ como inversión operativa. │
│ │
│ Si este trabajo es para un cliente, │
│ créalo desde Pipeline para poder │
│ cotizar, facturar y cobrar. │
│ │
│ [Ir a Pipeline ->] [Entendido, es interno]│
└─────────────────────────────────────────────┘
```

"Ir a Pipeline" -> navega a `/pipeline` directamente.
"Entendido, es interno" -> abre formulario de creación.

**Paso 2 — Formulario de creación:**

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| Nombre | Text | **Sí** | "Desarrollo MéTRIK ONE", "Campaña LinkedIn Q1" |
| Presupuesto | Currency | **No** | Si lo pone -> habilita barras duales y alertas de desvío |
| Fecha inicio | Date | Sí | Default hoy |
| Fecha fin estimada | Date | No | — |
| Carpeta URL | Text | No | Link a carpeta en la nube |

**Al guardar:** `INSERT INTO proyectos` con:
- `tipo = 'interno'`
- `oportunidad_id = NULL`
- `cotizacion_id = NULL`
- `empresa_id = NULL`
- `contacto_id = NULL`
- `canal_creacion = 'app'`

**Opcional post-creación:** El usuario puede agregar rubros manuales desde la vista detalle del proyecto interno (botón "Agregar rubro"). Esto crea registros en `proyecto_rubros` con `presupuestado` manual.

#### §7.9.2 Vista detalle de proyecto interno

Ruta: `/proyectos/{id}` (mismo componente que §7.7, condiciona por `tipo`)

```
┌───────────────────────────────────────────────┐
│ [◀ Internos] [ Carpeta]* │
│ │
│ {nombre} [Interno] [En ejecución] │
│ │
│ ┌─ Avance ─────────────┐ ┌─ Presupuesto** ──┐ │
│ │ ████████░░░░ {av}% │ │ ██████░░░░ {pc}% │ │
│ └──────────────────────┘ └───────────────────┘ │
│ │
│ ┌─ Inversión acumulada ──────────────────────┐ │
│ │ Presupuesto: ${presupuesto} (o N/A) │ │
│ │ Horas invertidas: {n} hrs × ${costo_hora} │ │
│ │ Costo horas: ${costo_horas} │ │
│ │ Gastos directos: ${gastos_directos} │ │
│ │ INVERSIÓN TOTAL: ${costo_acumulado} │ │
│ └────────────────────────────────────────────┘ │
│ │
│ ┌─ Por rubro (si tiene rubros) ──────────────┐ │
│ │ Diseño $2.4M / $3M 80% Si │ │
│ │ Desarrollo $4.1M / $5M 82% [ATENCION] │ │
│ │ Infra $200K / $1M 20% Si │ │
│ └────────────────────────────────────────────┘ │
│ │
│ ┌─ Últimos registros ────────────────────────┐ │
│ │ (solo horas y gastos — NO facturas/cobros) │ │
│ └────────────────────────────────────────────┘ │
│ │
│ [Slider avance: ████████░░░░ {av}%] │
│ │
│ [+ Gasto] [+ Horas] [Pausar/Cerrar]│
│ │
│ No SIN botón [+ Factura] ni [+ Cobro] │
└───────────────────────────────────────────────┘

* solo visible si carpeta_url IS NOT NULL
** Barra presupuesto solo visible si presupuesto_total IS NOT NULL
```

**Diferencias con detalle de proyecto cliente (§7.7):**

| Elemento | Cliente | Interno |
|----------|---------|---------|
| Breadcrumb | [◀ Proyectos] | [◀ Internos] |
| Badge tipo | (ninguno) | "Interno" gris |
| Empresa + contacto | Visible | No existe |
| Sección "Resumen financiero" | Completa (7 indicadores) | Reducida: "Inversión acumulada" (horas + gastos + total) |
| Sección "Facturas" | Visible | **Oculta** |
| Sección "Cobros" | Implícito en facturas | **Oculto** |
| Indicadores facturado/cobrado/cartera | Visible | **Ocultos** |
| Botón [+ Factura] | Visible | **Oculto** |
| Botón [+ Cobro] | Visible | **Oculto** |
| Botón [+ Gasto] | Si | Si |
| Botón [+ Horas] | Si | Si |

#### §7.9.3 Cierre de proyecto interno

Mismo flujo que §7.8 pero el comparativo NO muestra facturación:

```
┌─ Comparativo Final ──────────────────────────┐
│ Estimado* Real Δ │
│ Presupuesto: $8M — — │
│ Costo total: — $6.7M -16% │
│ Horas: 200 185 -8% │
│ │
│ * Solo si tenía presupuesto asignado │
│ │
│ Por rubro (si tiene): │
│ Diseño: $3M / $2.4M (-20%) Si │
│ Desarrollo: $5M / $4.1M (-18%) Si │
│ Infra: — / $200K — │
├──────────────────────────────────────────────┤
│ 🆕 ¿Cuál fue el resultado de esta inversión? │
│ [textarea opcional] │
│ │
│ Retorno estimado (opcional): [$________] │
│ │
│ Si llena retorno: │
│ ROI = ($retorno - $costo) / $costo × 100 │
│ ROI = 124% │
└──────────────────────────────────────────────┘
```

Los campos `roi_descripcion` y `roi_retorno_estimado` se guardan en la tabla `proyectos`. El cálculo de ROI es display-only (no se almacena, se calcula al mostrar).

---

## §8. Clasificación de gastos — Resumen lógico (D78, 🆕 D95)

| Origen | proyecto_id | tipo proyecto | rubro_id | gasto_fijo_ref_id | Clasificación | Impacta en P&L |
|--------|-------------|--------------|----------|--------------------|---------------|----------------|
| Dentro de proyecto cliente | NOT NULL | cliente | NOT NULL | NULL | Gasto directo con rubro | Costos directos (margen bruto) |
| Dentro de proyecto cliente (cot flash) | NOT NULL | cliente | rubro 'general' | NULL | Gasto directo sin rubro | Costos directos (margen bruto) |
| 🆕 Dentro de proyecto interno | NOT NULL | interno | NOT NULL o NULL | NULL | Inversión operativa | **Costos proyectos internos (debajo de margen bruto)** |
| FAB sin proyecto | NULL | — | NULL | NULL | Gasto operativo | Gastos operativos |
| FAB/WA que matchea gasto fijo | NULL | — | NULL | NOT NULL | Gasto fijo confirmado | Gastos fijos |
| Dentro proyecto + matchea gasto fijo | NOT NULL | cualquiera | NOT NULL | NOT NULL | Gasto directo + fijo | Proyecto + Gastos fijos |

**🆕 Impacto en P&L de Números (D95):**

```
Ingresos facturados (solo proyectos tipo = 'cliente')
(-) Costos directos (horas + gastos de proyectos tipo = 'cliente')
= MARGEN BRUTO <- "¿Mis servicios a clientes son rentables?"

(-) 🆕 Inversión proyectos internos (horas + gastos de proyectos tipo = 'interno')
(-) Gastos operativos (gastos sin proyecto asociado)
(-) Gastos fijos (arriendo, servicios, etc.)
= UTILIDAD OPERATIVA <- "¿Mi negocio es rentable considerando lo que invierto?"

(-) Provisión impuestos
= UTILIDAD NETA ESTIMADA
```

Regla de oro actualizada: `proyecto_id IS NOT NULL AND tipo = 'cliente'` -> costo directo (margen bruto). `proyecto_id IS NOT NULL AND tipo = 'interno'` -> inversión operativa (debajo de margen bruto). `proyecto_id IS NULL` -> gasto operativo/fijo.

---

## §9. Registro de decisiones

| # | Decisión | Definición | Sprint sugerido |
|---|----------|-----------|----------------|
| D68 | Proyectos ≠ gestor de tareas | Contenedor financiero. Sin tareas, Gantt, asignaciones. | — |
| D69 | Facturación MVP | Manual, fraccionada, N facturas por proyecto. Integración Alegra pausada. | 3-4 |
| D70 | Retroalimentación a Costos | Automática al cierre. Media móvil ponderada. | 5 |
| D71 | "¿Qué aprendiste?" | Opcional, texto libre, no bloquea cierre. | 5 |
| D72 | Campos external_ref | TEXT NULL en facturas, cobros, gastos. | 3 |
| D73 | Inventario y Compras | Proyecto futuro, no MVP. | — |
| D74 | Estructura facturación | Proyecto -> N facturas -> N cobros. Saldo calculado. | 3-4 |
| D75 | Cobros a factura | Asociado a factura específica. Parciales OK. | 3-4 |
| D76 | 4 indicadores proyecto | Facturado, cobrado, cartera, por facturar. | 3-4 |
| D77 | Alertas proyecto | 6 alertas: desvío, horas, vencida, desfase, pago sin factura, tip RST. | 5 |
| D78 | Directos vs operativos | Directos -> proyecto + rubro. Fijos/operativos -> solo P&L. | 3 |
| D79 | Gasto directo -> rubro | Selecciona rubro de cotización. Ve presupuesto vs real inline. | 3-4 |
| D80 | FAB switch condicional | Con proyecto -> pide rubro. Sin proyecto -> operativo. | 3 |
| D81 | Gastos fijos dual | Config = referencia. Borradores = registro real para flujo caja. | 4 |
| D82 | Cotización flash sin rubros | Comparativo global. Tip educativo. | 3 |
| D83 | Gastos fijos pre-generados | Borradores mensuales desde Config. Un tap para confirmar. | 4 |
| D84 | Reconciliación multi-canal | Match categoría + monto (±20%) + mes. Anti-duplicado. | 4-5 |
| D85 | WhatsApp 4 fases | Parse -> Lookup -> Present -> Confirm + Save. | WA sprint |
| D86 | Gemini hints | Extrae intención + hint. Resolución = Edge Function. | WA sprint |
| D87 | Presentación con contexto | Opciones con datos reales (%, saldo, horas). | WA sprint |
| D88 | Simplificación 1 proyecto | Confirmación directa sin menú. | WA sprint |
| D89 | Confirmación con impacto | Post-registro muestra estado actualizado. | WA sprint |
| D90 | Carpeta de proyecto | `carpeta_url` TEXT opcional en oportunidad + proyecto. Solo link. | 3 |
| **🆕 D93** | **Proyectos internos** | **Campo `tipo` ('cliente'/'interno'). Internos: sin oportunidad, sin cotización, sin empresa. Presupuesto opcional. Horas/gastos sí. Facturación/cobros BLOQUEADOS backend+UI+bot. No convertible a cliente.** | **3** |
| **🆕 D94** | **Creación con fricción** | **Único punto de entrada: Tab "Internos" -> botón con confirmación educativa + shortcut a Pipeline. NO desde FAB, NO desde WhatsApp.** | **3** |
| **🆕 D95** | **P&L separado** | **Costos de internos en línea propia debajo de margen bruto. No contaminan rentabilidad de proyectos de cliente.** | **Números sprint** |
| **🆕 D96** | **UI tabs separados** | **Tabs "De clientes" (default) y "Internos". Nunca mezclados. Badge "Interno" gris. Secciones Facturas/Cobros ocultas y bloqueadas.** | **3** |
| **🆕 D97** | **ROI proyectos internos** | **Al cierre: campos opcionales roi_descripcion y roi_retorno_estimado. Si hay retorno -> calcular ROI y payback (display-only). MVP: solo costo puro.** | **5** |

---

## §10. Orden de ejecución paso a paso

Para Max en Claude Code. Ejecutar en secuencia estricta.

### Paso 1: Modificaciones a tablas existentes
```
□ ALTER TABLE oportunidades ADD COLUMN carpeta_url TEXT
□ ALTER TABLE gastos ADD COLUMN rubro_id UUID
□ ALTER TABLE gastos ADD COLUMN gasto_fijo_ref_id UUID
□ ALTER TABLE gastos ADD COLUMN external_ref TEXT
```

### Paso 2: Crear tablas nuevas (en orden de FK)
```
□ CREATE TABLE gastos_fijos_config (§3.6)
□ CREATE TABLE proyectos (§3.1) — 🆕 incluye campos tipo, roi_descripcion, roi_retorno_estimado
□ CREATE TABLE proyecto_rubros (§3.2)
 □ ALTER TABLE gastos ADD CONSTRAINT fk_gastos_rubro
□ CREATE TABLE facturas (§3.3)
□ CREATE TABLE cobros (§3.4)
□ CREATE TABLE horas (§3.5)
□ CREATE TABLE gastos_fijos_borradores (§3.7)
 □ ALTER TABLE gastos ADD CONSTRAINT fk_gastos_borrador
□ CREATE TABLE costos_referencia (§3.8)
□ CREATE TABLE proyecto_notas (§3.9)
```

### Paso 3: Crear vistas
```
□ CREATE VIEW v_proyecto_financiero (§4.1) — 🆕 incluye p.tipo en SELECT
□ CREATE VIEW v_proyecto_rubros_comparativo (§4.2)
□ CREATE VIEW v_facturas_estado (§4.3)
□ CREATE VIEW v_cartera_antiguedad (§4.4)
□ CREATE VIEW v_gastos_fijos_mes_actual (§4.5)
```

### Paso 4: Crear Edge Functions
```
□ Extender hard gate CRM -> crear_proyecto_desde_oportunidad (§5.1)
□ Cron: generar_borradores_gastos_fijos (§5.2)
□ Función: match_gasto_fijo (§5.3)
□ Función: confirmar_borrador (§5.4)
□ Función: cerrar_proyecto con snapshot + retroalimentación (§5.5)
□ 🆕 Función: validar_operacion_proyecto — bloqueo backend para internos (§5.6)
```

### Paso 5: UI — Vistas y formularios
```
□ 🆕 Lista proyectos con TABS: "De clientes" + "Internos" (§7.6)
□ Vista detalle proyecto cliente (§7.7)
□ 🆕 Vista detalle proyecto interno (§7.9.2) — mismo componente, condicional por tipo
□ Formulario gasto dentro de proyecto (§7.1) — aplica a ambos tipos
□ Formulario gasto desde FAB con switch condicional (§7.2) — 🆕 muestra ambos tipos en selector
□ Formulario factura (§7.3) — solo tipo = 'cliente'
□ Formulario cobro (§7.4) — solo tipo = 'cliente'
□ Sección gastos fijos del mes (§7.5)
□ Botón carpeta en oportunidad y proyecto
□ Vista cierre proyecto cliente con comparativo (§7.8)
□ 🆕 Vista cierre proyecto interno con inversión + ROI opcional (§7.9.3)
□ 🆕 Creación proyecto interno con fricción: confirmación educativa + formulario (§7.9.1)
```

### Paso 6: Alertas
```
□ Implementar 6 alertas de §6.2 — 🆕 filtrar A03-A06 solo para tipo = 'cliente'
□ Semáforo barras duales (§6.1) — 🆕 barra derecha solo si presupuesto_total IS NOT NULL
```

### Paso 7: Verificación post-ejecución
```
□ Crear proyecto de prueba desde oportunidad ganada -> verificar herencia completa
□ Registrar gasto directo -> verificar que aparece en rubro correcto
□ Registrar gasto desde FAB sin proyecto -> verificar que NO aparece en proyectos
□ Crear gasto fijo en config -> verificar que genera borrador
□ Confirmar borrador -> verificar que crea gasto real con timestamp
□ Registrar gasto que matchea borrador -> verificar reconciliación
□ Crear 2 facturas -> registrar cobros parciales -> verificar saldos
□ Cerrar proyecto -> verificar snapshot JSON + costos_referencia
□ Intentar registrar horas en proyecto cerrado -> debe fallar
□ Registrar cobro en proyecto cerrado -> debe funcionar

🆕 VERIFICACIONES PROYECTOS INTERNOS (D93-D97):
□ Crear proyecto interno desde tab Internos -> verificar confirmación educativa
□ Verificar que proyecto interno tiene tipo = 'interno', oportunidad_id NULL, empresa_id NULL
□ Registrar horas en proyecto interno -> debe funcionar
□ Registrar gasto en proyecto interno -> debe funcionar
□ Intentar crear factura en proyecto interno -> DEBE FALLAR (backend reject)
□ Intentar crear cobro en proyecto interno -> DEBE FALLAR (backend reject)
□ Verificar que FAB NO tiene opción "crear proyecto interno"
□ Verificar que tabs muestran proyectos separados (cliente vs interno)
□ Cerrar proyecto interno -> verificar comparativo SIN facturación + campos ROI opcionales
□ Verificar en P&L que costos de proyecto interno caen en línea separada, no en costos directos
□ WhatsApp: "me pagaron del proyecto [interno]" -> debe rechazar y ofrecer alternativa
```

---

## §11. Barrido de integridad (Hana)

| Verificación | Estado |
|-------------|--------|
| Toda tabla tiene RLS + tenant_id | Si Todas |
| Toda tabla tiene índices en campos de query frecuente | Si |
| Toda FK respeta orden de creación | Si §10 en secuencia |
| Todo campo de UI tiene tipo y obligatoriedad | Si §7 completo |
| Toda vista cubre las métricas mostradas en UI | Si |
| Toda alerta tiene condición SQL verificable | Si §6.2 |
| Toda Edge Function tiene trigger y pseudocódigo completo | Si §5 |
| No hay dato que la UI necesite sin query que lo produzca | Si |
| Clasificación de gastos cubre todos los escenarios | Si §8 |
| Cobros post-cierre documentados como excepción | Si §6.3 |
| Cotización flash (sin rubros) tiene flujo alternativo | Si D82 en §7.1 y §7.2 |
| La tabla horas está completa con schema | Si §3.5 |
| horas_estimadas existe en proyectos | Si §3.1 |
| costo_hora se calcula desde personal | Si §4.1 lateral join |
| proyecto_notas existe para W11 | Si §3.9 |
| Trigger de creación proyecto tiene pseudocódigo | Si §5.1 |
| 🆕 Campo `tipo` en tabla proyectos con CHECK constraint | Si §3.1 |
| 🆕 `presupuesto_total` nullable para internos | Si §3.1 |
| 🆕 Campos ROI opcionales en tabla proyectos | Si §3.1 |
| 🆕 Índice por tipo+estado para queries de tabs | Si §3.1 |
| 🆕 Vista incluye `p.tipo` para filtrar UI | Si §4.1 |
| 🆕 Validación backend bloquea factura/cobro en internos | Si §5.6 |
| 🆕 Alertas A03-A06 filtradas solo para cliente | Si §6.2 |
| 🆕 Protección anti-abuso documentada completa | Si §6.4 |
| 🆕 UI tabs separados con queries diferenciadas | Si §7.6 |
| 🆕 Creación interna con fricción (confirmación + shortcut) | Si §7.9.1 |
| 🆕 Detalle interno sin secciones facturación/cobros | Si §7.9.2 |
| 🆕 Cierre interno con comparativo reducido + ROI | Si §7.9.3 |
| 🆕 FAB muestra ambos tipos en selector de proyecto | Si §7.2 |
| 🆕 WhatsApp rechaza cobros/facturas contra internos | Si §5.6 |
| 🆕 Clasificación gastos internos -> línea separada P&L | Si §8 |
| 🆕 Verificaciones post-ejecución para internos | Si §10 Paso 7 |
