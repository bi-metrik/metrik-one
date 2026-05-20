/**
 * Tests para can-edit.ts — Modelo roles · areas · stages Fase 2
 *
 * Ejecutar:
 *   npx tsx --test src/lib/permissions/can-edit.test.mjs
 *
 * O traves de node con loader TS:
 *   node --import tsx --test src/lib/permissions/can-edit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canEditBloque,
  canEditHeader,
  canViewNegocio,
  canWriteActivityLog,
  getAreasEfectivas,
  STAGE_TO_AREA,
} from './can-edit.ts'

// ── Helpers ────────────────────────────────────────────────────────
const user = (role, areas = [], id = 'u1') => ({ id, role, areas })
const venta = { stage: 'venta' }
const ejec = { stage: 'ejecucion' }
const cobro = { stage: 'cobro' }
const cerrado = { stage: 'cerrado' }

// ── STAGE_TO_AREA ──────────────────────────────────────────────────
test('STAGE_TO_AREA mapping', () => {
  assert.equal(STAGE_TO_AREA.venta, 'comercial')
  assert.equal(STAGE_TO_AREA.ejecucion, 'operaciones')
  assert.equal(STAGE_TO_AREA.cobro, 'financiera')
  assert.equal(STAGE_TO_AREA.cerrado, null)
})

// ── getAreasEfectivas: direccion expande a las 3 operativas ────────
test('getAreasEfectivas: direccion expande a 3 operativas', () => {
  const set = getAreasEfectivas(user('supervisor', ['direccion']))
  assert.equal(set.has('direccion'), true)
  assert.equal(set.has('comercial'), true)
  assert.equal(set.has('operaciones'), true)
  assert.equal(set.has('financiera'), true)
})

test('getAreasEfectivas: sin direccion no expande', () => {
  const set = getAreasEfectivas(user('operator', ['comercial']))
  assert.equal(set.has('comercial'), true)
  assert.equal(set.has('operaciones'), false)
  assert.equal(set.has('direccion'), false)
})

test('getAreasEfectivas: combina direccion con area explicita', () => {
  const set = getAreasEfectivas(user('operator', ['comercial', 'direccion']))
  assert.equal(set.size, 4) // direccion + las 3 expandidas
})

// ── canEditBloque: owner / admin passthrough ───────────────────────
test('canEditBloque: owner edita todo en cualquier stage', () => {
  for (const stage of [venta, ejec, cobro, cerrado]) {
    assert.equal(canEditBloque(user('owner'), stage, []), true)
  }
})

test('canEditBloque: admin edita todo en cualquier stage', () => {
  for (const stage of [venta, ejec, cobro, cerrado]) {
    assert.equal(canEditBloque(user('admin'), stage, []), true)
  }
})

// ── canEditBloque: read_only / contador siempre NO ─────────────────
test('canEditBloque: read_only nunca edita', () => {
  for (const stage of [venta, ejec, cobro, cerrado]) {
    assert.equal(canEditBloque(user('read_only', []), stage, ['u1']), false)
  }
})

test('canEditBloque: contador nunca edita', () => {
  for (const stage of [venta, ejec, cobro, cerrado]) {
    assert.equal(canEditBloque(user('contador', []), stage, ['u1']), false)
  }
})

// ── canEditBloque: cerrado solo owner/admin ────────────────────────
test('canEditBloque: cerrado bloquea supervisor', () => {
  assert.equal(
    canEditBloque(user('supervisor', ['comercial']), cerrado, []),
    false
  )
})

test('canEditBloque: cerrado bloquea operator responsable', () => {
  assert.equal(
    canEditBloque(user('operator', ['comercial']), cerrado, ['u1']),
    false
  )
})

// ── canEditBloque: supervisor por area ─────────────────────────────
test('canEditBloque: supervisor comercial edita venta', () => {
  assert.equal(
    canEditBloque(user('supervisor', ['comercial']), venta, []),
    true
  )
})

test('canEditBloque: supervisor comercial NO edita ejecucion', () => {
  assert.equal(
    canEditBloque(user('supervisor', ['comercial']), ejec, []),
    false
  )
})

test('canEditBloque: supervisor operaciones edita ejecucion', () => {
  assert.equal(
    canEditBloque(user('supervisor', ['operaciones']), ejec, []),
    true
  )
})

test('canEditBloque: supervisor financiera edita cobro', () => {
  assert.equal(
    canEditBloque(user('supervisor', ['financiera']), cobro, []),
    true
  )
})

test('canEditBloque: supervisor financiera NO edita venta', () => {
  assert.equal(
    canEditBloque(user('supervisor', ['financiera']), venta, []),
    false
  )
})

test('canEditBloque: supervisor con multiple areas (D3 sin limites)', () => {
  const u = user('supervisor', ['comercial', 'operaciones'])
  assert.equal(canEditBloque(u, venta, []), true)
  assert.equal(canEditBloque(u, ejec, []), true)
  assert.equal(canEditBloque(u, cobro, []), false)
})

// ── canEditBloque: supervisor con direccion (transversal) ──────────
test('canEditBloque: supervisor direccion edita los 3 stages operativos', () => {
  const u = user('supervisor', ['direccion'])
  assert.equal(canEditBloque(u, venta, []), true)
  assert.equal(canEditBloque(u, ejec, []), true)
  assert.equal(canEditBloque(u, cobro, []), true)
  assert.equal(canEditBloque(u, cerrado, []), false) // cerrado sigue cerrado
})

// ── canEditBloque: operator necesita area + ser responsable ────────
test('canEditBloque: operator con area y responsable -> SI', () => {
  assert.equal(
    canEditBloque(user('operator', ['comercial']), venta, ['u1']),
    true
  )
})

test('canEditBloque: operator con area pero NO responsable -> NO', () => {
  assert.equal(
    canEditBloque(user('operator', ['comercial']), venta, ['u2']),
    false
  )
})

test('canEditBloque: operator responsable pero SIN area duena -> NO', () => {
  assert.equal(
    canEditBloque(user('operator', ['operaciones']), venta, ['u1']),
    false
  )
})

test('canEditBloque: operator direccion + responsable -> SI en 3 stages', () => {
  const u = user('operator', ['direccion'])
  assert.equal(canEditBloque(u, venta, ['u1']), true)
  assert.equal(canEditBloque(u, ejec, ['u1']), true)
  assert.equal(canEditBloque(u, cobro, ['u1']), true)
})

test('canEditBloque: operator direccion sin ser responsable -> NO', () => {
  const u = user('operator', ['direccion'])
  assert.equal(canEditBloque(u, venta, ['otro']), false)
})

// ── canEditHeader ──────────────────────────────────────────────────
test('canEditHeader: owner/admin siempre SI', () => {
  assert.equal(canEditHeader(user('owner', [])), true)
  assert.equal(canEditHeader(user('admin', [])), true)
})

test('canEditHeader: supervisor comercial SI', () => {
  assert.equal(canEditHeader(user('supervisor', ['comercial'])), true)
})

test('canEditHeader: supervisor operaciones NO', () => {
  assert.equal(canEditHeader(user('supervisor', ['operaciones'])), false)
})

test('canEditHeader: supervisor direccion SI (transversal)', () => {
  assert.equal(canEditHeader(user('supervisor', ['direccion'])), true)
})

test('canEditHeader: operator comercial SI (independiente de responsable)', () => {
  assert.equal(canEditHeader(user('operator', ['comercial'])), true)
})

test('canEditHeader: operator operaciones NO', () => {
  assert.equal(canEditHeader(user('operator', ['operaciones'])), false)
})

test('canEditHeader: contador y read_only NO', () => {
  assert.equal(canEditHeader(user('contador', [])), false)
  assert.equal(canEditHeader(user('read_only', [])), false)
})

// ── canViewNegocio ─────────────────────────────────────────────────
test('canViewNegocio: owner/admin/supervisor/read_only ven todo', () => {
  for (const role of ['owner', 'admin', 'supervisor', 'read_only']) {
    assert.equal(canViewNegocio(user(role, []), []), true)
  }
})

test('canViewNegocio: contador NO ve negocios', () => {
  assert.equal(canViewNegocio(user('contador', []), []), false)
  assert.equal(canViewNegocio(user('contador', []), ['u1']), false)
})

test('canViewNegocio: operator solo si responsable', () => {
  assert.equal(canViewNegocio(user('operator', ['comercial']), ['u1']), true)
  assert.equal(canViewNegocio(user('operator', ['comercial']), ['u2']), false)
})

// ── canWriteActivityLog ────────────────────────────────────────────
test('canWriteActivityLog == canViewNegocio', () => {
  const op = user('operator', ['comercial'])
  assert.equal(
    canWriteActivityLog(op, ['u1']),
    canViewNegocio(op, ['u1'])
  )
  assert.equal(
    canWriteActivityLog(user('contador', []), ['u1']),
    false
  )
})
