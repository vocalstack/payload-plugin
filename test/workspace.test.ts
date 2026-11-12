import assert from 'node:assert/strict'
import { test } from 'node:test'

import { workspaceOf } from '../src/workspace.ts'

const API = 'https://api.vocalstack.com'

test("the icon's link is made absolute against the API's address", () => {
  const w = workspaceOf({ iconUrl: '/workspace-icons/abc?v=3&exp=9&sig=xyz', id: 'abc', name: 'Acme studio', personal: false }, API)
  assert.deepEqual(w, { iconUrl: 'https://api.vocalstack.com/workspace-icons/abc?v=3&exp=9&sig=xyz', id: 'abc', name: 'Acme studio', personal: false })
  assert.equal(workspaceOf({ iconUrl: '/workspace-icons/abc', id: 'abc', name: 'A' }, 'http://localhost:8080/')?.iconUrl, 'http://localhost:8080/workspace-icons/abc')
})

test('a workspace with no icon has none', () => {
  assert.deepEqual(workspaceOf({ iconUrl: null, id: 'p1', name: 'Personal workspace', personal: true }, API), { iconUrl: null, id: 'p1', name: 'Personal workspace', personal: true })
  assert.equal(workspaceOf({ id: 'p1', name: 'N' }, API)?.iconUrl, null)
  assert.equal(workspaceOf({ iconUrl: 'javascript:alert(1)', id: 'p1', name: 'N' }, API)?.iconUrl, null)
})

test('an older API that leaves the workspace out gives none', () => {
  assert.equal(workspaceOf(undefined, API), undefined)
  assert.equal(workspaceOf(null, API), undefined)
  assert.equal(workspaceOf({}, API), undefined)
  assert.equal(workspaceOf({ id: 'x', name: '  ' }, API), undefined)
  assert.equal(workspaceOf('Acme', API), undefined)
})
