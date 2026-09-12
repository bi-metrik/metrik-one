-- Rechazar un movimiento tiene que hacerlo DESAPARECER.
--
-- Hasta hoy el botón "Rechazar" de /movimientos llamaba a `desmarcarRevisado`, que solo
-- pone `revisado = false`: el movimiento volvía a la fila de pendientes, el motivo que el
-- modal exigía se descartaba, y quien rechazaba lo veía reaparecer. El badge "Rechazado"
-- llevaba tiempo apagado con un `{false && …}`.
--
-- La fila se borra de `gastos`, y antes se guarda entera aquí. Se eligió borrar y no una
-- bandera porque `gastos` se lee desde 42 sitios distintos, incluidas las edge functions
-- de WhatsApp: una bandera obliga a recordar el filtro en cada uno de ellos y el olvido no
-- se nota, aparece como plata que no cuadra. Lo borrado no se pierde: queda la fila
-- completa, el motivo, quién y cuándo.
--
-- Los cobros NO entran aquí. Un cobro no se borra, se anula (`anularCobro`), porque su
-- monto sostiene el saldo del negocio y la cuenta de cobro. Lo que cambia para ellos es
-- que la lista de movimientos deja de mostrar los anulados.

CREATE TABLE IF NOT EXISTS movimientos_rechazados (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tabla         TEXT NOT NULL CHECK (tabla IN ('gastos')),
  fila_id       UUID NOT NULL,
  fila          JSONB NOT NULL,
  motivo        TEXT NOT NULL,
  rechazado_por UUID,
  rechazado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_movimientos_rechazados_workspace
  ON movimientos_rechazados(workspace_id, rechazado_at DESC);

ALTER TABLE movimientos_rechazados ENABLE ROW LEVEL SECURITY;

-- server-only: es el archivo de lo borrado. Se escribe desde el server action que borra
-- la fila y nadie lo consulta desde la app; darle lectura al cliente solo abriría una
-- copia de los gastos que el usuario ya decidió quitar de su vista.
CREATE POLICY "movimientos_rechazados_service" ON movimientos_rechazados
  FOR ALL USING (false);

COMMENT ON TABLE movimientos_rechazados IS
  'Filas de gastos borradas por "Rechazar" en /movimientos. Guarda la fila completa, el motivo y el autor.';
