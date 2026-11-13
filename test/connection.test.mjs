// The connection endpoints, as built (run `pnpm test`, which builds first), against a
// stand-in VocalStack API and an in-memory settings global.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { NOT_IN_WORKSPACE, VocalStackAPI } from '../dist/api.js'
import { connectionEndpoints, forgetOwners } from '../dist/endpoints/connection.js'
import { checkJob } from '../dist/endpoints/transcribe.js'

const API = 'https://api.test'
const ACME = { iconUrl: '/workspace-icons/w-acme?v=2&exp=9&sig=s', id: 'w-acme', name: 'Acme studio', personal: false }
const PERSONAL = { iconUrl: null, id: 'w-me', name: 'Personal workspace', personal: true }

let store
let calls
let answers
const realFetch = globalThis.fetch

const reply = (body, status = 200) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status })

beforeEach(() => {
  store = {}
  calls = []
  answers = {}
  forgetOwners()
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const auth = new Headers(init?.headers ?? input.headers).get('authorization')
    calls.push({ auth, path: url.pathname })
    const answer = answers[url.pathname]
    if (!answer) return reply({ code: 'not_found', message: `no route for GET ${url.pathname}` }, 404)
    return answer({ auth, init, url })
  }
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const request = (over = {}) => ({
  json: async () => over.body ?? {},
  origin: 'https://cms.test',
  payload: {
    config: { routes: { api: '/api' }, serverURL: 'https://cms.test' },
    findGlobal: async () => ({ ...store }),
    updateGlobal: async ({ data }) => void Object.assign(store, data),
  },
  searchParams: new URLSearchParams(over.query ?? ''),
  user: 'user' in over ? over.user : { id: 1 },
})

const run = async (options, method, path, over) => {
  const endpoint = connectionEndpoints({ apiURL: API, ...options }).find((e) => e.method === method && e.path === path)
  const res = await endpoint.handler(request(over))
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { body, status: res.status }
}

const startConnect = async () => {
  const { body } = await run({}, 'post', '/vocalstack/connect')
  // Starting a connect may ask /v1/me which workspace the key in use is in; the tests below count what follows.
  calls.length = 0
  return new URL(body.url).searchParams.get('state')
}

const connectLink = async (options = {}) => new URL((await run(options, 'post', '/vocalstack/connect')).body.url)

test('connecting again opens the consent screen on the workspace in use', async () => {
  store = { account: 'Acme studio', apiKey: 'vs_key_a' }
  answers['/v1/me'] = () => reply({ workspace: ACME })
  const url = await connectLink()
  assert.equal(url.origin + url.pathname, 'https://app.vocalstack.com/connect')
  assert.equal(url.searchParams.get('workspace'), 'w-acme')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.ok(url.searchParams.get('state'))
  assert.deepEqual(calls.map((c) => [c.path, c.auth]), [['/v1/me', 'Bearer vs_key_a']])
  // The workspace of a key is read once: later links need no answer from VocalStack.
  answers['/v1/me'] = () => reply({ code: 'internal', message: 'down' }, 503)
  assert.equal((await connectLink()).searchParams.get('workspace'), 'w-acme')
  assert.equal(calls.length, 1)
})

test('a workspace already shown in Settings is sent without asking VocalStack again', async () => {
  answers['/v1/me'] = () => reply({ workspace: PERSONAL })
  await run({}, 'post', '/vocalstack/key', { body: { apiKey: 'vs_key_pasted' } })
  assert.equal((await connectLink()).searchParams.get('workspace'), 'w-me')
  assert.equal(calls.length, 1)
})

test('a key from the plugin config sends its workspace too', async () => {
  answers['/v1/me'] = () => reply({ workspace: ACME })
  assert.equal((await connectLink({ apiKey: 'vs_key_config' })).searchParams.get('workspace'), 'w-acme')
  assert.equal(calls[0].auth, 'Bearer vs_key_config')
})

test('not connected: the connect link names no workspace and VocalStack is not asked', async () => {
  const url = await connectLink()
  assert.equal(url.searchParams.has('workspace'), false)
  assert.ok(url.searchParams.get('state'))
  assert.equal(calls.length, 0)
})

test('a workspace that cannot be told is left out, and the connect still starts', async () => {
  store = { account: 'ada@example.com', apiKey: 'vs_key_old' }
  answers['/v1/me'] = () => reply({ user: { email: 'ada@example.com' } })
  assert.equal((await connectLink()).searchParams.has('workspace'), false)
  forgetOwners()
  answers['/v1/me'] = () => reply({ code: 'internal', message: 'down' }, 503)
  const down = await run({}, 'post', '/vocalstack/connect')
  assert.equal(down.status, 200)
  assert.equal(new URL(down.body.url).searchParams.has('workspace'), false)
  forgetOwners()
  answers['/v1/me'] = () => {
    throw new Error('network')
  }
  const failed = await run({}, 'post', '/vocalstack/connect')
  assert.equal(failed.status, 200)
  assert.equal(new URL(failed.body.url).searchParams.has('workspace'), false)
  assert.ok(store.connectState)
})

test('a key from the plugin config shows its workspace, with the icon link made absolute', async () => {
  answers['/v1/me'] = () => reply({ principal: { name: 'ignored' }, workspace: ACME })
  const { body } = await run({ apiKey: 'vs_key_config' }, 'get', '/vocalstack/connection')
  assert.deepEqual(body, {
    account: 'Acme studio',
    connected: true,
    source: 'options',
    workspace: { ...ACME, iconUrl: 'https://api.test/workspace-icons/w-acme?v=2&exp=9&sig=s' },
  })
  assert.equal(calls[0].auth, 'Bearer vs_key_config')
})

test('an older API that names no workspace reads as before', async () => {
  store = { account: 'ada@example.com', apiKey: 'vs_key_old' }
  answers['/v1/me'] = () => reply({ user: { email: 'ada@example.com' } })
  const { body } = await run({}, 'get', '/vocalstack/connection')
  assert.deepEqual(body, { account: 'ada@example.com', connected: true, source: 'admin' })
})

test('a rename or a new icon in VocalStack reaches the next check, and one minute of checks asks once', async () => {
  store = { account: 'Acme studio', apiKey: 'vs_key_a' }
  let me = { workspace: ACME }
  answers['/v1/me'] = () => reply(me)
  assert.equal((await run({}, 'get', '/vocalstack/connection')).body.workspace.name, 'Acme studio')
  me = { workspace: { ...ACME, iconUrl: '/workspace-icons/w-acme?v=3&exp=9&sig=t', name: 'Acme radio' } }
  assert.equal((await run({}, 'get', '/vocalstack/connection')).body.workspace.name, 'Acme studio')
  assert.equal(calls.length, 1)
  forgetOwners()
  const { body } = await run({}, 'get', '/vocalstack/connection')
  assert.equal(body.workspace.name, 'Acme radio')
  assert.equal(body.account, 'Acme radio')
  assert.equal(body.workspace.iconUrl, 'https://api.test/workspace-icons/w-acme?v=3&exp=9&sig=t')
  assert.equal(store.account, 'Acme radio')
})

test('when VocalStack does not answer, the connection still shows, by its stored name', async () => {
  store = { account: 'Acme studio', apiKey: 'vs_key_a' }
  answers['/v1/me'] = () => reply({ code: 'internal', message: 'down' }, 503)
  const { body } = await run({}, 'get', '/vocalstack/connection')
  assert.deepEqual(body, { account: 'Acme studio', connected: true, source: 'admin' })
})

test('not connected', async () => {
  const { body } = await run({}, 'get', '/vocalstack/connection')
  assert.deepEqual(body, { connected: false })
  assert.equal(calls.length, 0)
})

test('a pasted key shows its workspace, not the key or the person', async () => {
  answers['/v1/me'] = () => reply({ principal: { name: 'my key' }, workspace: PERSONAL })
  const { body } = await run({}, 'post', '/vocalstack/key', { body: { apiKey: ' vs_key_pasted ' } })
  assert.deepEqual(body, { account: 'Personal workspace', connected: true, source: 'admin', workspace: PERSONAL })
  assert.equal(store.apiKey, 'vs_key_pasted')
  assert.equal(store.account, 'Personal workspace')
  const again = await run({}, 'get', '/vocalstack/connection')
  assert.deepEqual(again.body.workspace, PERSONAL)
  assert.equal(calls.length, 1)
})

test('changing the workspace swaps the stored key for the new one and shows the new workspace', async () => {
  store = { account: 'Personal workspace', apiKey: 'vs_key_old' }
  const state = await startConnect()
  assert.equal(store.apiKey, 'vs_key_old')
  answers['/v1/connect/token'] = ({ init }) => {
    assert.equal(new URLSearchParams(String(init.body)).get('code'), 'c0de')
    return reply({ access_token: 'vs_key_new', account: { name: 'Ada' }, token_type: 'api_key', workspace: ACME })
  }
  const done = await run({}, 'get', '/vocalstack/callback', { query: `code=c0de&state=${state}` })
  assert.equal(done.status, 200)
  assert.match(done.body, /Connected to the VocalStack workspace Acme studio\./)
  assert.equal(store.apiKey, 'vs_key_new')
  assert.equal(store.account, 'Acme studio')
  // The answer already named the workspace: /v1/me is not asked, now or at the next check.
  const { body } = await run({}, 'get', '/vocalstack/connection')
  assert.equal(body.workspace.id, 'w-acme')
  assert.deepEqual(calls.map((c) => c.path), ['/v1/connect/token'])
})

test('a connect answer from an older API falls back to /v1/me, then to the name it gave', async () => {
  const state = await startConnect()
  answers['/v1/connect/token'] = () => reply({ access_token: 'vs_key_new', account: { name: 'Ada' } })
  answers['/v1/me'] = () => reply({ user: { email: 'ada@example.com' } })
  const done = await run({}, 'get', '/vocalstack/callback', { query: `code=c&state=${state}` })
  assert.match(done.body, /Connected to VocalStack as Ada\./)
  assert.equal(store.account, 'Ada')
})

test('cancelling on the consent screen leaves the connection in use untouched', async () => {
  store = { account: 'Personal workspace', apiKey: 'vs_key_old' }
  const state = await startConnect()
  const done = await run({}, 'get', '/vocalstack/callback', { query: `error=access_denied&state=${state}` })
  assert.equal(done.status, 400)
  assert.match(done.body, /Connection cancelled\./)
  assert.equal(store.apiKey, 'vs_key_old')
  assert.equal(store.account, 'Personal workspace')
  assert.equal(calls.length, 0)
})

test('a code VocalStack refuses leaves the connection in use untouched', async () => {
  store = { account: 'Personal workspace', apiKey: 'vs_key_old' }
  const state = await startConnect()
  answers['/v1/connect/token'] = () => reply({ error: 'invalid_grant', error_description: 'the code was used' }, 400)
  const done = await run({}, 'get', '/vocalstack/callback', { query: `code=c&state=${state}` })
  assert.equal(done.status, 400)
  assert.equal(store.apiKey, 'vs_key_old')
  assert.equal(store.account, 'Personal workspace')
})

test('Cancel in the admin ends the pending connect: its link no longer swaps the key', async () => {
  store = { account: 'Personal workspace', apiKey: 'vs_key_old' }
  const state = await startConnect()
  assert.deepEqual((await run({}, 'delete', '/vocalstack/connect')).body, { ok: true })
  answers['/v1/connect/token'] = () => reply({ access_token: 'vs_key_new', workspace: ACME })
  const done = await run({}, 'get', '/vocalstack/callback', { query: `code=c&state=${state}` })
  assert.equal(done.status, 400)
  assert.equal(store.apiKey, 'vs_key_old')
  assert.equal(calls.length, 0)
})

test('only someone who may manage the connection can cancel a connect', async () => {
  const res = await run({ access: () => false }, 'delete', '/vocalstack/connect')
  assert.equal(res.status, 403)
})

test("a job the new workspace's key cannot see fails with a plain sentence instead of staying in progress", async () => {
  answers['/v1/transcriptions/tx-1/job'] = () => reply({ code: 'not_found', message: 'no such transcription' }, 404)
  const saved = []
  const target = { data: { status: 'processing', transcriptionId: 'tx-1' }, save: async (patch) => (saved.push(patch), { ...patch }) }
  const res = await checkJob(new VocalStackAPI('vs_key_new', API), target, 'tx-1')
  assert.equal(res.status, 'failed')
  assert.equal(res.error, NOT_IN_WORKSPACE)
  assert.deepEqual(saved, [{ error: NOT_IN_WORKSPACE, status: 'failed' }])
})

test('a finished transcript in another workspace reads as a plain sentence', async () => {
  answers['/v1/transcriptions/tx-1/transcript'] = () => reply({ code: 'not_found', message: 'no such transcription' }, 404)
  await assert.rejects(new VocalStackAPI('vs_key_new', API).transcript('tx-1'), (err) => err.status === 404 && err.message === NOT_IN_WORKSPACE)
  answers['/v1/transcriptions/tx-1/voice'] = () => reply({ code: 'not_found', message: 'no such transcription' }, 404)
  await assert.rejects(new VocalStackAPI('vs_key_new', API).speak('tx-1', ['fr']), (err) => err.status === 404 && err.message === NOT_IN_WORKSPACE)
})

test('a reading is asked for by transcription, in the voices chosen', async () => {
  let sent
  answers['/v1/transcriptions/tx-1/voice'] = ({ init }) => ((sent = init), reply([{ clips: [], lang: 'fr', state: 'queued', voiceKey: '' }]))
  const tracks = await new VocalStackAPI('vs_key', API).speak('tx-1', ['fr'], { cloned: true })
  assert.equal(tracks[0].lang, 'fr')
  assert.equal(sent.method, 'POST')
  assert.deepEqual(JSON.parse(sent.body), { langs: ['fr'], voices: 'cloned' })
})

test('a wrong API address is not mistaken for a transcript in another workspace', async () => {
  await assert.rejects(new VocalStackAPI('vs_key_new', API).job('tx-1'), (err) => err.status === 404 && /^no route/.test(err.message))
})
