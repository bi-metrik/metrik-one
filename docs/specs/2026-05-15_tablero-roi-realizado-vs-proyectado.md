---
tipo: spec-tecnico
fecha: 2026-05-15
origen: gap-critico-brand-key
contexto: Especificacion tecnica del tablero ROI Realizado vs Proyectado que sustenta operacionalmente el compromiso de ROI comprometido firmado contractualmente con clientes Clarity. Producida por Mik en sesion 2026-05-15 como cierre del gap critico #1 del Brand Key. Owner ejecucion: Max. Owner producto: Vera. Primer cliente piloto: SOENA
resumen: Modulo dentro de MeTRIK ONE que mide ROI realizado vs proyectado contra linea base firmada en Radiografia. Visible para cliente + MeTRIK desde mes 1. Alerta automatica si ROI realizado < 60% del proyectado pro rata temporis. Soporta hitos mes 6 y 12 con firma electronica de revision
refs: [[2026-05-14_roi-comprometido]], [[compromiso-roi]], [[clausula-roi-comprometido]], [[reserva-contable-roi-comprometido]], [[brand-key-metrik]], [[radiografia-con-roi]]
vigente: spec — pendiente implementacion Max
---

# Tablero ROI Realizado vs Proyectado — Spec tecnico

## Objetivo

Construir un modulo dentro de MeTRIK ONE que permita:

1. Registrar la **Linea Base firmada** de indicadores del proyecto Clarity (Anexo B del contrato)
2. Capturar el **valor mensual realizado** de cada indicador
3. Calcular y mostrar el **ROI Realizado vs ROI Proyectado** en tiempo real
4. Alertar automaticamente cuando el ROI Realizado caiga por debajo del 60% del proyectado pro rata temporis
5. Soportar los **Hitos Mes 6 y Mes 12** con revision formal firmada por ambas partes
6. Trazabilidad completa para auditoria y, eventualmente, defensa contractual

## Audiencia del modulo

| Usuario | Que ve | Que puede hacer |
|---------|--------|-----------------|
| Cliente final (rol propio del workspace) | Su propio ROI Realizado vs Proyectado, valores actuales por indicador, semaforos | Validar mediciones mensuales, firmar revisiones de hitos |
| Sofia (CS MeTRIK) | Tablero de todos los clientes Clarity con ROI activo | Convocar war-rooms, registrar acciones, escalar a Vera |
| Vera (COO) | Tablero agregado de salud del portafolio Clarity | Validar revisiones de hito, escalar a Mauricio si activacion de remedio |
| Carmen (CFO) | Vista financiera: reserva 5% por cliente + activacion potencial de remedio | Disparar liberacion anual o aplicacion de remedio |
| Mauricio | Vista ejecutiva agregada | Decision final en escalaciones |

## Modelo de datos

### Tabla 1: `roi_proyectos`

Registra el contrato de compromiso ROI activo por proyecto Clarity.

```sql
CREATE TABLE roi_proyectos (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  proyecto_clarity_id UUID NOT NULL,
  cliente_nombre TEXT NOT NULL,
  fee_clarity_cop NUMERIC(15,2) NOT NULL,
  fecha_kickoff DATE NOT NULL,
  fecha_hito_mes_6 DATE NOT NULL,
  fecha_hito_mes_12 DATE NOT NULL,
  roi_proyectado_porcentaje NUMERIC(6,2) NOT NULL,
  beneficio_proyectado_mes_12_cop NUMERIC(15,2) NOT NULL,
  inversion_total_cop NUMERIC(15,2) NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('activo','suspendido','hito_mes_6_firmado','hito_mes_12_firmado','remedio_activado','cerrado')),
  url_anexo_a TEXT,
  url_anexo_b TEXT,
  url_anexo_c TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabla 2: `roi_indicadores`

Linea base firmada de indicadores (Anexo B del contrato).

```sql
CREATE TABLE roi_indicadores (
  id UUID PRIMARY KEY,
  roi_proyecto_id UUID NOT NULL REFERENCES roi_proyectos(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  definicion TEXT NOT NULL,
  formula_calculo TEXT NOT NULL,
  unidad TEXT NOT NULL,
  valor_linea_base NUMERIC(15,4) NOT NULL,
  fecha_linea_base DATE NOT NULL,
  fuente_medicion TEXT NOT NULL,
  valor_objetivo_mes_12 NUMERIC(15,4) NOT NULL,
  metodo_monetizacion TEXT NOT NULL,
  factor_monetizacion_cop NUMERIC(15,4),
  peso_en_roi_porcentaje NUMERIC(5,2) NOT NULL CHECK (peso_en_roi_porcentaje BETWEEN 0 AND 100),
  firmado_por_cliente BOOLEAN DEFAULT false,
  firmado_por_metrik BOOLEAN DEFAULT false,
  fecha_firma DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_roi_indicadores_proyecto ON roi_indicadores(roi_proyecto_id);
```

Regla de integridad: la suma de `peso_en_roi_porcentaje` para todos los indicadores de un `roi_proyecto_id` debe ser exactamente 100.

### Tabla 3: `roi_mediciones`

Mediciones mensuales del valor realizado de cada indicador.

```sql
CREATE TABLE roi_mediciones (
  id UUID PRIMARY KEY,
  roi_indicador_id UUID NOT NULL REFERENCES roi_indicadores(id) ON DELETE CASCADE,
  periodo DATE NOT NULL,
  valor_realizado NUMERIC(15,4) NOT NULL,
  fuente_medicion TEXT,
  observaciones TEXT,
  registrado_por_user_id UUID NOT NULL,
  validado_por_cliente BOOLEAN DEFAULT false,
  validado_por_metrik BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (roi_indicador_id, periodo)
);

CREATE INDEX idx_roi_mediciones_indicador_periodo ON roi_mediciones(roi_indicador_id, periodo);
```

### Tabla 4: `roi_hitos`

Hitos formales de revision Mes 6 y Mes 12.

```sql
CREATE TABLE roi_hitos (
  id UUID PRIMARY KEY,
  roi_proyecto_id UUID NOT NULL REFERENCES roi_proyectos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('mes_6','mes_12')),
  fecha_revision DATE NOT NULL,
  roi_realizado_porcentaje NUMERIC(8,4) NOT NULL,
  roi_proyectado_pro_rata_porcentaje NUMERIC(8,4) NOT NULL,
  cumplimiento_porcentaje NUMERIC(6,2) NOT NULL,
  conclusion TEXT NOT NULL CHECK (conclusion IN ('en_curso_ok','war_room_requerido','remedio_aplicable','sin_reclamo')),
  acciones_acordadas TEXT,
  firmado_por_cliente BOOLEAN DEFAULT false,
  firmado_por_metrik BOOLEAN DEFAULT false,
  fecha_firma DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabla 5: `roi_cogestion`

Acciones de cogestion documentadas (Anexo C).

```sql
CREATE TABLE roi_cogestion (
  id UUID PRIMARY KEY,
  roi_proyecto_id UUID NOT NULL REFERENCES roi_proyectos(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  owner_cliente TEXT NOT NULL,
  fecha_compromiso DATE NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','cumplido','incumplido_parcial','incumplido_total')),
  fecha_cierre DATE,
  observaciones TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Calculo del ROI Realizado

Para un periodo dado (al cierre de mes M desde el kickoff):

```
Para cada indicador i:
  delta_i = (valor_realizado_i - valor_linea_base_i)
  beneficio_realizado_i = delta_i × factor_monetizacion_cop_i

ROI Realizado (M) = (sum(beneficio_realizado_i × peso_i) - inversion_pro_rata_M) / inversion_pro_rata_M

ROI Proyectado pro rata (M) = ROI Proyectado × (M / 12)

Cumplimiento (M) = ROI Realizado (M) / ROI Proyectado pro rata (M)
```

Donde `inversion_pro_rata_M = inversion_total × (M / 12)` para normalizar la comparacion mes a mes.

## UI / Vistas

### Vista 1: Tablero principal del cliente

Ubicacion: `/{workspace_slug}/roi`

Componentes:
- Header con nombre del proyecto + fecha kickoff + fecha proximo hito
- Card grande con ROI Realizado vs Proyectado actual (numero grande + barra de progreso + semaforo)
- Lista de indicadores con valor linea base, valor realizado del ultimo periodo, valor objetivo mes 12, % de avance
- Grafica de evolucion mensual del cumplimiento
- Boton "Validar mediciones del mes" si hay mediciones pendientes de validacion del cliente
- Boton "Ver detalle del hito" si esta proximo (15 dias antes del hito formal)

### Vista 2: Tablero portafolio MeTRIK

Ubicacion: `/admin/roi-portfolio` (solo accesible para usuarios MeTRIK)

Componentes:
- Tabla de todos los `roi_proyectos` activos
- Columnas: cliente, fee clarity, mes en curso, cumplimiento actual, semaforo, proximo hito, alerta activa (sino/no)
- Filtros por estado, por owner Sofia, por riesgo
- Click en cliente abre vista 1 del cliente respectivo

### Vista 3: Carga mensual de mediciones

Ubicacion: `/{workspace_slug}/roi/mediciones/{periodo}`

Componentes:
- Tabla con los indicadores del proyecto
- Input de valor realizado para cada indicador
- Campo de observaciones por indicador
- Boton "Guardar y notificar a MeTRIK" o "Guardar como borrador"

### Vista 4: Hito formal de revision

Ubicacion: `/{workspace_slug}/roi/hitos/{hito_id}`

Componentes:
- Resumen del hito (mes 6 o mes 12)
- ROI Realizado vs Proyectado calculado
- Conclusion automatica (en_curso_ok / war_room_requerido / remedio_aplicable / sin_reclamo)
- Comentarios y acciones acordadas
- Firmas electronicas (cliente y MeTRIK)
- Si firmado por ambos, el hito se cierra y dispara los siguientes pasos automaticos

## Alertas automaticas

Cron diario (00:01 hora Colombia):

| Trigger | Accion |
|---------|--------|
| Cumplimiento mes_actual < 60% en proyecto activo | Email + WhatsApp a Sofia y Vera. Crear tarea "Convocar war-room cliente X" en Mi Bolsillo |
| Faltan 15 dias para Hito Mes 6 o Mes 12 | Email recordatorio a Sofia, cliente owner y MeTRIK owner |
| Cliente no valida mediciones en 30 dias seguidos | Email a Sofia + Vera. Si llega a 60 dias, escalar a Mauricio |
| Indicador sin medicion del mes en curso | Email a cliente owner + Sofia |

Cron mensual (dia 5 del mes siguiente al cierre del mes):

| Trigger | Accion |
|---------|--------|
| Mediciones del mes cerradas y validadas | Recalcular ROI Realizado, actualizar dashboards, generar snapshot historico |

Cron anual (1 de enero):

| Trigger | Accion |
|---------|--------|
| Hito Mes 12 cerrado sin reclamo escrito de cliente X | Notificar a Carmen y Valentina para disparar liberacion de subcuenta de reserva del cliente X (ver [[reserva-contable-roi-comprometido]]) |

## Estado del proyecto y transiciones

```
activo
  ├─→ hito_mes_6_firmado (si hito mes 6 firmado por ambas partes)
  │    ├─→ hito_mes_12_firmado (continuacion natural)
  │    └─→ suspendido (si cliente no firma 2 hitos consecutivos)
  ├─→ suspendido (si cliente no firma 2 hitos consecutivos)
  └─→ remedio_activado (si cliente reclama formalmente en mes 12 con ROI realizado < proyectado)

hito_mes_12_firmado
  ├─→ cerrado (sin reclamo en plazo de 30 dias)
  └─→ remedio_activado (con reclamo formal en plazo de 30 dias)

remedio_activado
  └─→ cerrado (tras pago del remedio capped)
```

## API endpoints

```
GET    /api/roi/proyectos              # Lista proyectos del workspace
POST   /api/roi/proyectos              # Crear nuevo proyecto (al firmar contrato)
GET    /api/roi/proyectos/:id          # Detalle de proyecto
PATCH  /api/roi/proyectos/:id          # Actualizar estado

GET    /api/roi/proyectos/:id/indicadores
POST   /api/roi/proyectos/:id/indicadores       # Cargar linea base (Anexo B)
PATCH  /api/roi/indicadores/:id/firmar          # Firma del indicador

POST   /api/roi/indicadores/:id/mediciones      # Cargar medicion mensual
PATCH  /api/roi/mediciones/:id/validar          # Validacion cliente o MeTRIK

GET    /api/roi/proyectos/:id/calculo-actual    # ROI Realizado vs Proyectado en vivo
GET    /api/roi/proyectos/:id/hitos
POST   /api/roi/proyectos/:id/hitos             # Crear hito formal (mes 6 o mes 12)
PATCH  /api/roi/hitos/:id/firmar                # Firma del hito

GET    /api/roi/portfolio                       # Vista admin agregada (MeTRIK only)
```

## Permisos y roles

| Rol | Crear proyecto | Cargar linea base | Cargar medicion mensual | Firmar hito | Ver portfolio agregado |
|-----|----------------|-------------------|-------------------------|-------------|------------------------|
| Cliente owner | NO | NO | SI | SI | NO |
| Cliente read | NO | NO | NO | NO | NO |
| MeTRIK Sofia | SI | SI | SI | SI | SI |
| MeTRIK Vera | SI | SI | SI | SI | SI |
| MeTRIK Carmen | NO | NO | NO | NO | SI (vista financiera) |
| Mauricio | SI | SI | SI | SI | SI |

## Integraciones

### Con Radiografia

Cuando se cierra una Radiografia via skill `/radiografia` con ROI Proyectado positivo y el cliente firma el contrato Clarity, automaticamente se crea el registro en `roi_proyectos` con los datos de la Radiografia precargados. La linea base de indicadores se carga manualmente segun lo firmado en el Anexo B del contrato.

### Con modulo Cobros

Cada cobro Clarity registrado en ONE dispara automaticamente la reserva del 5% en la cuenta de garantias (ver [[reserva-contable-roi-comprometido]]). El monto se calcula sobre el fee Clarity sin IVA, sin licencias, sin viaticos.

### Con WhatsApp Business

Las alertas de war-room y firma de hitos se envian tambien por WhatsApp al owner del cliente y a Sofia. Permite firma de hito con confirmacion WhatsApp si el cliente prefiere.

### Con Activity Log

Cada accion sobre roi_* se registra en activity_log con tipo `roi_compromiso` para auditoria contractual.

## Plan de implementacion sugerido (sin estimacion de tiempo, conforme a regla MeTRIK)

| # | Bloque | Alcance |
|---|--------|---------|
| 1 | Migracion DB | 5 tablas + indices + constraints + politicas RLS |
| 2 | API endpoints CRUD | Endpoints listados arriba con validaciones |
| 3 | Vista 1 — Tablero cliente | UI principal con calculo en vivo |
| 4 | Vista 2 — Portfolio MeTRIK | Vista agregada admin |
| 5 | Vista 3 — Carga mediciones | UI mensual |
| 6 | Vista 4 — Hitos formales | Firma electronica + transiciones |
| 7 | Cron de alertas | Edge function diaria + mensual + anual |
| 8 | Integracion Radiografia | Auto-creacion al firmar contrato |
| 9 | Integracion Cobros (reserva 5%) | Trigger auto al cobrar |
| 10 | Integracion WhatsApp | Alertas y firmas |
| 11 | QA E2E con SOENA | Piloto del primer cliente |

Max define dependencias y orden segun [[execution-model]]. Diseno claro = construir sin pedir validaciones intermedias. Si algo es ambiguo, preguntar antes.

## Cliente piloto

**SOENA** es el primer cliente con tablero ROI activo. Datos iniciales:
- Proyecto Clarity vigente con propuesta PROP-2026-05-001 enviada
- Indicadores a discutir con cliente para Anexo B (linea base) — pendiente sesion con JD Bruce
- Fee Clarity total: $26M COP (cronograma de pagos definido)
- Fecha de kickoff a confirmar tras aprobacion de propuesta

Una vez aprobada la propuesta y firmado el contrato (con clausula ROI comprometido del [[clausula-roi-comprometido]]), Sofia carga la linea base en el modulo.

## Pendientes para activacion

| # | Pendiente | Owner |
|---|-----------|-------|
| 1 | Implementacion DB + API + UI conforme a esta spec | Max |
| 2 | QA cliente piloto SOENA | Max + Sofia + Mauricio |
| 3 | Integracion con reserva 5% en Cobros | Max |
| 4 | Capacitacion Sofia en operacion del modulo | Mik |
| 5 | Validacion final UX con Noor | Noor |

## Caminos descartados

- Esperar a tener Activity Log generalizado antes de construir — no se justifica, este modulo tiene auditoria propia
- Construir solo backend y exponer via API — descartado, los hitos requieren UI firmable por cliente
- Permitir editar linea base despues de firmada — veto operativo. Linea base inmutable salvo adenda contractual
