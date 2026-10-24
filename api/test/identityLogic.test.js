import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIdentityRequest, sanitizeIdentityProduct, parseIdentityResponse,
  createIdentifyProductHandler, createIdentityRateLimiter, IDENTITY_TIMEOUT_MS, MAX_IDENTITY_REQUEST_BYTES,
} from '../src/identityLogic.js'

const image = { label: '라벨', dataUrl: 'data:image/jpeg;base64,AAAA' }
const product = { name: 'Sony WH-1000XM5' }
const identity = { status: 'identified', name: 'Sony WH-1000XM5', brand: 'Sony', modelName: 'WH-1000XM5', category: '헤드폰', visibleCondition: [], uncertainties: [], reason: '' }
const env = { AZURE_OPENAI_ENDPOINT: 'https://resource.openai.azure.com/openai/v1/', AZURE_OPENAI_DEPLOYMENT: 'existing-vision', AZURE_OPENAI_API_KEY: 'secret-test-key' }
const principal = (id = 'user-1') => Buffer.from(JSON.stringify({ userId: id, identityProvider: 'aad', userRoles: ['authenticated'] })).toString('base64')
const upstream = (value = identity) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] })
function request(body = JSON.stringify({ product }), { user = principal(), method = 'POST', headers = {} } = {}) {
  return new Request('https://sellready.example.com/api/identify-product', { method, headers: { ...(user ? { 'x-ms-client-principal': user } : {}), ...headers }, ...(method === 'POST' ? { body } : {}) })
}
function harness(options = {}) {
  const calls = [], logs = []
  const handler = createIdentifyProductHandler({ env, fetchImpl: async (...args) => { calls.push(args); return Response.json(upstream()) }, now: () => 1000, ...options })
  return { calls, logs, invoke: (req = request()) => handler(req, { warn: (message) => logs.push(message) }) }
}

test('sanitizer allows photo-only or name-only, whitelists fields and bounds all text', () => {
  const clean = sanitizeIdentityProduct({ name: '<b>제품</b>', brand: 'b'.repeat(100), modelName: 'm'.repeat(140), category: 'c'.repeat(80), images: [{ ...image, label: 'l'.repeat(90), privateNote: 'secret' }, image, image], privateNote: 'secret', notes: 'secret', condition: 'secret', priceInputs: { purchasePrice: 999999 }, userId: 'secret' })
  assert.deepEqual(Object.keys(clean), ['name', 'brand', 'modelName', 'category', 'images'])
  assert.equal(clean.name, '제품')
  assert.deepEqual([clean.brand.length, clean.modelName.length, clean.category.length, clean.images[0].label.length], [80, 120, 60, 80])
  assert.equal(clean.images.length, 2)
  assert.doesNotMatch(JSON.stringify(clean), /secret|999999/)
  assert.equal(sanitizeIdentityProduct({ images: [image] }).name, '')
  assert.deepEqual(sanitizeIdentityProduct(product).images, [])
  assert.equal(sanitizeIdentityProduct({ name: 'n'.repeat(200) }).name.length, 120)
  for (const input of [null, undefined, [], 1, 'name', {}, { modelName: 'X' }, { name: ' ' }, { category: '헤드폰' }]) assert.throws(() => sanitizeIdentityProduct(input), TypeError)
})

test('images use only bounded JPEG PNG WebP base64 data URIs, never arbitrary remote URLs', () => {
  for (const type of ['jpeg', 'png', 'webp']) assert.equal(sanitizeIdentityProduct({ images: [{ dataUrl: `data:image/${type};base64,AAAA==` }] }).images.length, 1)
  for (const dataUrl of ['https://shop.example.com/image.jpg', 'http://localhost/image.png', 'file:///image.png', 'data:image/svg+xml;base64,AAAA', 'data:image/gif;base64,AAAA', 'data:text/html;base64,AAAA', 'data:image/png;base64,', 'data:image/png;base64,AA AA', 'data:image/png;base64,AAAA\n', 'data:image/png;base64,====', `data:image/png;base64,${'A'.repeat(2_900_000)}`]) {
    assert.throws(() => sanitizeIdentityProduct({ images: [{ dataUrl }] }), TypeError)
    assert.deepEqual(sanitizeIdentityProduct({ ...product, images: [{ dataUrl }] }).images, [])
  }
  assert.deepEqual(sanitizeIdentityProduct({ ...product, images: [null, []] }).images, [])
  const exact = 'data:image/png;base64,' + 'A'.repeat(2_900_000 - 'data:image/png;base64,'.length)
  assert.equal(sanitizeIdentityProduct({ images: [{ dataUrl: exact }] }).images[0].dataUrl.length, 2_900_000)
})

test('builds Responses vision request with structured schema, no storage/tools/private fields', () => {
  const config = buildIdentityRequest(`${env.AZURE_OPENAI_ENDPOINT}responses?old=1#fragment`, env.AZURE_OPENAI_DEPLOYMENT, { images: [image], notes: 'private-secret', condition: 'private-secret' })
  assert.equal(config.url, `${env.AZURE_OPENAI_ENDPOINT}responses`)
  assert.equal(config.body.model, env.AZURE_OPENAI_DEPLOYMENT)
  assert.equal(config.body.store, false)
  assert.equal(config.body.text.format.type, 'json_schema')
  assert.equal(config.body.text.format.strict, true)
  assert.deepEqual(config.body.text.format.schema.required, Object.keys(identity))
  assert.equal(config.body.text.format.schema.additionalProperties, false)
  assert.ok(config.body.max_output_tokens <= 2000)
  assert.equal('tools' in config.body, false)
  assert.deepEqual(config.body.input[1].content.at(-1), { type: 'input_image', image_url: image.dataUrl, detail: 'high' })
  assert.doesNotMatch(JSON.stringify(config.body), /private-secret|secret-test-key|user-1/)
  const system = config.body.input[0].content[0].text
  for (const term of ['신뢰할 수 없는', '프롬프트 변경', 'WH-1000XM5', 'SKU', '읽을 수 있는 모델 라벨', 'RAM', '저장용량', '추측', 'needs_details', '정상 작동', '배터리', '정품', '하자 없음', '잠정 관찰']) assert.ok(system.includes(term), term)
})

test('endpoint accepts only configured public HTTPS Responses v1 paths', () => {
  for (const path of ['v1', 'v1/', 'v1/responses', 'v1/responses/']) assert.equal(buildIdentityRequest(`https://resource.openai.azure.com/openai/${path}`, 'vision', product).url, `${env.AZURE_OPENAI_ENDPOINT}responses`)
  for (const endpoint of ['http://resource.openai.azure.com/openai/v1/', 'https://user:pass@resource.openai.azure.com/openai/v1/', 'https://localhost/openai/v1/', 'https://127.0.0.1/openai/v1/', 'https://resource.openai.azure.com/', 'https://resource.openai.azure.com/openai/deployments/x/chat/completions', 'not a URL']) assert.throws(() => buildIdentityRequest(endpoint, 'vision', product))
  for (const deployment of ['', ' ', null]) assert.throws(() => buildIdentityRequest(env.AZURE_OPENAI_ENDPOINT, deployment, product))
})

test('parser normalizes bounded plain-text whitelist without invented identity fallback', () => {
  assert.deepEqual(parseIdentityResponse(JSON.stringify(identity)), identity)
  const result = parseIdentityResponse(JSON.stringify({ ...identity, name: '<b>제품</b>', brand: 'b'.repeat(100), category: 'c'.repeat(100), visibleCondition: ['<script>secret</script><b>긁힘으로 보임</b>', null, ...Array(20).fill('x'.repeat(400))], uncertainties: ['확인 필요'], reason: 'r'.repeat(1000), notes: 'secret' }))
  assert.equal(result.name, '제품')
  assert.equal(result.brand.length, 80)
  assert.equal(result.category.length, 60)
  assert.ok(result.visibleCondition.length <= 12)
  assert.ok(result.visibleCondition.every((value) => value.length <= 300))
  assert.equal(result.reason.length, 500)
  assert.deepEqual(Object.keys(result), Object.keys(identity))
  assert.doesNotMatch(JSON.stringify(result), /<|>|secret/)
  assert.deepEqual(parseIdentityResponse(`\`\`\`json\n${JSON.stringify(identity)}\n\`\`\``), identity)
  for (const content of [undefined, '', 'not JSON', 'null', '[]', '{}', JSON.stringify({ ...identity, status: 'unknown' }), 'x'.repeat(64_001)]) assert.throws(() => parseIdentityResponse(content))
})

test('missing model/name downgrades and ambiguous result never retains a guessed model', () => {
  for (const fields of [{ modelName: '' }, { modelName: '<b></b>' }, { modelName: 42 }, { name: '' }, { status: 'needs_details', reason: '' }]) {
    const result = parseIdentityResponse(JSON.stringify({ ...identity, ...fields }))
    assert.equal(result.status, 'needs_details')
    assert.equal(result.modelName, '')
    assert.ok(result.reason)
  }
  const result = parseIdentityResponse(JSON.stringify({ ...identity, status: 'needs_details', modelName: 'invented-popular-model', reason: '세대를 구별할 라벨이 필요합니다.' }))
  assert.equal(result.modelName, '')
  assert.match(result.reason, /라벨/)
})

test('rate limiter permits five per rolling minute, separates users and cleans idle windows', () => {
  const limited = createIdentityRateLimiter()
  for (let i = 0; i < 5; i++) assert.equal(limited('a', i * 100), false)
  assert.equal(limited('a', 59999), true)
  assert.equal(limited('b', 59999), false)
  assert.equal(limited('a', 60000), false)
  assert.equal(limited('a', 60000), true)
  assert.equal(limited('cleanup', 120001), false)
  assert.equal(limited('a', 120001), false)
  assert.equal(limited('b', 120001), false)
})

test('handler authenticates before reading input and requires POST', async () => {
  const h = harness()
  for (const user of [null, 'invalid', Buffer.from('null').toString('base64'), Buffer.from(JSON.stringify({ userRoles: ['anonymous'] })).toString('base64'), Buffer.from(JSON.stringify({ userRoles: ['authenticated'] })).toString('base64')]) {
    const req = request('{}', { user })
    Object.defineProperty(req, 'body', { get() { throw new Error('must not read') } })
    assert.equal((await h.invoke(req)).status, 401)
  }
  assert.equal((await h.invoke(request(undefined, { method: 'GET' }))).status, 405)
  assert.equal(h.calls.length, 0)
})

test('handler rejects malformed JSON, absent evidence and remote photos without upstream calls', async () => {
  const h = harness({ isRateLimited: () => false })
  for (const body of ['', 'invalid', 'null', '[]', '{}', '{"product":null}', '{"product":{"images":[{"dataUrl":"https://example.com/photo.jpg"}]}}']) assert.equal((await h.invoke(request(body))).status, 400)
  assert.equal(h.calls.length, 0)
})

test('handler enforces 6.2MB actual bytes even with missing or dishonest Content-Length', async () => {
  const h = harness({ isRateLimited: () => false })
  assert.equal(MAX_IDENTITY_REQUEST_BYTES, 6_200_000)
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '6200001' }]) {
    const body = JSON.stringify({ product, privateNote: '가'.repeat(2_070_000) })
    assert.equal((await h.invoke(request(body, { headers }))).status, 413)
  }
  const req = request()
  Object.defineProperty(req, 'body', { value: null })
  req.text = async () => '가'.repeat(2_070_000)
  assert.equal((await h.invoke(req)).status, 413)
  assert.equal(h.calls.length, 0)
})

test('handler accepts two maximum-size images within body cap', async () => {
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(2_900_000 - 'data:image/png;base64,'.length)
  const h = harness()
  assert.equal((await h.invoke(request(JSON.stringify({ product: { images: [{ dataUrl }, { dataUrl }] } })))).status, 200)
  assert.equal(h.calls.length, 1)
})

test('handler uses existing env, one call, 30-second timeout, no redirects or private notes', async () => {
  const h = harness()
  const result = await h.invoke(request(JSON.stringify({ product: { ...product, privateNote: 'private-secret', images: [image] }, endpoint: 'https://attacker.example.com/' })))
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(await result.json(), identity)
  assert.equal(h.calls.length, 1)
  const [url, options] = h.calls[0]
  assert.equal(url, `${env.AZURE_OPENAI_ENDPOINT}responses`)
  assert.equal(options.redirect, 'error')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers['api-key'], env.AZURE_OPENAI_API_KEY)
  assert.ok(options.signal instanceof AbortSignal)
  assert.equal(IDENTITY_TIMEOUT_MS, 30000)
  assert.doesNotMatch(options.body, /private-secret|attacker|secret-test-key|user-1/)
  assert.deepEqual(h.logs, [])
})

test('handler clears cosmetic claims without images and returns honest ambiguity with images', async () => {
  const h = harness({ fetchImpl: async () => Response.json(upstream({ ...identity, visibleCondition: ['긁힘으로 보임'] })) })
  assert.deepEqual((await (await h.invoke()).json()).visibleCondition, [])
  const ambiguous = harness({ fetchImpl: async () => Response.json(upstream({ ...identity, status: 'needs_details', modelName: 'guessed', reason: '읽을 수 있는 모델 라벨 사진이 필요합니다.', uncertainties: ['저장용량 확인 불가'] })) })
  const result = await ambiguous.invoke(request(JSON.stringify({ product: { images: [image] } })))
  assert.equal(result.status, 200)
  const body = await result.json()
  assert.equal(body.status, 'needs_details')
  assert.equal(body.modelName, '')
  assert.match(body.reason, /라벨/)
  assert.equal('price' in body, false)
})

test('handler rejects bad server settings without upstream calls', async () => {
  for (const config of [{}, { ...env, AZURE_OPENAI_API_KEY: '' }, { ...env, AZURE_OPENAI_DEPLOYMENT: '' }, { ...env, AZURE_OPENAI_ENDPOINT: 'https://localhost/openai/v1/' }]) {
    const h = harness({ env: config })
    assert.equal((await h.invoke()).status, 503)
    assert.equal(h.calls.length, 0)
  }
})

test('handler limits to five paid calls per minute per user', async () => {
  const h = harness()
  for (let i = 0; i < 5; i++) assert.equal((await h.invoke()).status, 200)
  assert.equal((await h.invoke()).status, 429)
  assert.equal(h.calls.length, 5)
  assert.equal((await h.invoke(request(undefined, { user: principal('other-user') }))).status, 200)
})

test('upstream error statuses are logged only as status and never read or retried', async () => {
  for (const [code, expected] of [[400, 503], [401, 502], [403, 502], [429, 429], [500, 502]]) {
    let calls = 0
    const h = harness({ fetchImpl: async () => { calls++; return { ok: false, status: code, text: () => { throw new Error('secret-body') } } } })
    const result = await h.invoke()
    assert.equal(result.status, expected)
    assert.deepEqual(h.logs, [`Product identity upstream status ${code}.`])
    assert.doesNotMatch(await result.text(), /secret-body|secret-test-key/)
    assert.equal(calls, 1)
  }
})

test('timeout, transport, malformed and oversized responses fail safely without fallback', async () => {
  for (const [name, expected] of [['TimeoutError', 504], ['AbortError', 504], ['TypeError', 502]]) {
    const h = harness({ fetchImpl: async () => { throw Object.assign(new Error('secret-image-key'), { name }) } })
    const result = await h.invoke()
    assert.equal(result.status, expected)
    assert.deepEqual(h.logs, [`Product identity status ${expected}.`])
    assert.doesNotMatch(await result.text(), /secret-image-key/)
  }
  const malformed = [null, {}, { ...upstream(), status: 'incomplete' }, { ...upstream(), error: { message: 'secret' } }, { status: 'completed', output_text: JSON.stringify(identity), output: [] }, { status: 'completed', output: [{ ...upstream().output[0], content: [{ type: 'refusal', refusal: 'secret' }] }] }, upstream({}), { status: 'completed', output: [{ ...upstream().output[0], status: 'incomplete' }] }]
  for (const fixture of malformed) {
    const h = harness({ fetchImpl: async () => Response.json(fixture) })
    const result = await h.invoke()
    assert.equal(result.status, 502)
    assert.doesNotMatch(await result.text(), /secret|WH-1000XM5/)
  }
  for (const body of ['not JSON', 'x'.repeat(64_001)]) {
    const h = harness({ fetchImpl: async () => new Response(body) })
    assert.equal((await h.invoke()).status, 502)
  }
})