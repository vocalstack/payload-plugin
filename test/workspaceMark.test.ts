import assert from 'node:assert/strict'
import { test } from 'node:test'

import { workspaceHue, workspaceInitials } from '../src/workspaceMark.ts'

test('a two-word workspace shows the first letter of each word', () => {
  assert.equal(workspaceInitials('Acme studio'), 'AS')
  assert.equal(workspaceInitials('  north   radio  live '), 'NR')
})

test('a one-word workspace shows its first two letters', () => {
  assert.equal(workspaceInitials('Podcast'), 'PO')
  assert.equal(workspaceInitials('X'), 'X')
})

test('punctuation and emoji-only words are skipped', () => {
  assert.equal(workspaceInitials('— Church & choir'), 'CC')
  assert.equal(workspaceInitials('"Évora" talks'), 'ÉT')
  assert.equal(workspaceInitials('   '), '?')
})

test('the same workspace always gets the same colour', () => {
  assert.equal(workspaceHue('ws_1'), workspaceHue('ws_1'))
  const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(workspaceHue))
  assert.ok(seen.size > 2)
})

test('the colour is the one the Dashboard picks for that id', () => {
  // FNV-1a over the id's UTF-16 units, into the Dashboard's nine hues.
  assert.equal(workspaceHue(''), [252, 200, 160, 128, 85, 40, 12, 330, 296][2166136261 % 9])
  for (const id of ['3f0c1f0e-6f0a-4d53-9d0e-0a1b2c3d4e5f', 'ws_1', 'é']) assert.ok([252, 200, 160, 128, 85, 40, 12, 330, 296].includes(workspaceHue(id)))
})
