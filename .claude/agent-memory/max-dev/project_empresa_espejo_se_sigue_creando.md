---
name: empresa-espejo-se-sigue-creando
description: La empresa espejo de una persona natural NO se deja de crear — decisión cerrada de Mauricio; el directorio solo dejó de listarla
metadata:
  type: project
---

En SOENA, cada persona natural tiene una fila en `empresas` que es su espejo fiscal
(`tipo_persona = 'natural'` + `contacto_id`). **Esa fila se sigue creando igual.** Lo único
que se cerró (PR #505, 2026-09-02) es de presentación: el directorio de empresas dejó de
listarla por defecto, con un toggle `espejos` en la URL para verlas.

**Why:** Mauricio evaluó dejar de crearla en esa misma sesión y **decidió que no**. No es una
ficha vacía: es el recipiente fiscal que leen el contrato, la cotización en PDF, la cuenta de
cobro y `ve-documentos`. Medido ese día: de 178 espejos con negocio, **107 ya tenían cobros
colgando**. Sacarla del modelo es un frente propio con datos de plata de por medio, no un
ajuste de pantalla.

**How to apply:** si al trabajar en el directorio, en la creación de negocios o en el frente
de plata parece "mejor" no crear la empresa espejo —o migrar las existentes—, la respuesta ya
está dada: **no**, salvo que Mauricio reabra el frente explícitamente. No tocar
`crearNegocioV2` ni ninguna ruta de creación por este motivo.

**El predicado son DOS condiciones, y hay un caso que lo prueba.** `esEspejoDeContacto`
(`src/lib/contactos/empresa-espejo.ts`) exige `natural` **y** `contacto_id`. En SOENA existe
**una `juridica` con `contacto_id`** —empresa C9, negocio V0276— que **sí** es una empresa y
no se puede esconder. Relajar el criterio a una sola condición la desaparece del directorio.
Es el mismo caso que ya protegía `esEmpresaEspejo` dentro del negocio.

Relacionado: [[soena-ve-pipeline]], [[venta-primer-pago]].
