import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPriceSearchRequest, createPriceSearchRateLimiter, createSearchNewPriceHandler,
  MAX_REQUEST_BYTES, normalizePriceSourceUrl, parsePriceSearchResponse,
  PRICE_SEARCH_DISCLAIMER, PRICE_SEARCH_TIMEOUT_MS, sanitizePriceSearchProduct,
} from '../src/priceSearchLogic.js'

// Synthetic fixtures only; none of these values are returned by production code.
const product = { name: '테스트 헤드폰', brand: 'Test', modelName: 'TEST-100 black', category: '헤드폰' }
const offer = { title: 'TEST-100 black 신품', price: 123000, currency: 'KRW', seller: '테스트 판매처', url: 'https://shop.example.com/product/100', note: '배송비 별도' }
const date = new Date('2026-10-24T10:00:00.000Z')
const citation = (url = offer.url) => ({ type: 'url_citation', url, title: '<b>인용 제목</b>', start_index: 0, end_index: 10 })
function response(offers = [offer], annotations = [citation()], reason = '') {
  return {
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: offer.url }] } },
      { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ offers, reason }), annotations }] },
    ],
  }
}
const parse = (result) => parsePriceSearchResponse(result, date)
const principal = (id = 'user-1') => Buffer.from(JSON.stringify({ userId: id, identityProvider: 'aad', userRoles: ['authenticated'] })).toString('base64')
const env = { AZURE_OPENAI_ENDPOINT: 'https://resource.openai.azure.com/openai/v1/', AZURE_OPENAI_DEPLOYMENT: 'existing-deployment', AZURE_OPENAI_API_KEY: 'offline-test-key' }
function request(body = JSON.stringify({ product }), { user = principal(), method = 'POST', headers = {} } = {}) {
  return new Request('https://sellready.example.com/api/search-new-price', { method, headers: { ...(user ? { 'x-ms-client-principal': user } : {}), ...headers }, ...(method === 'POST' ? { body } : {}) })
}
function harness(options = {}) {
  const calls = []
  const logs = []
  const handler = createSearchNewPriceHandler({ env, now: () => date.getTime(), fetchImpl: async (...args) => { calls.push(args); return Response.json(response()) }, ...options })
  return { calls, logs, invoke: (req = request()) => handler(req, { warn: (message) => logs.push(message) }) }
}

test('sanitizer whitelists four bounded plain-text fields and drops every private field', () => {
  const clean = sanitizePriceSearchProduct({ ...product, name: '<b>제품</b>', brand: 'x'.repeat(100), modelName: 'm'.repeat(150), category: 'c'.repeat(100), purchasePrice: 900000, priceInputs: { currentNewPrice: 800000 }, photos: ['secret'], images: ['secret'], privateNote: 'secret', userId: 'secret' })
  assert.deepEqual(Object.keys(clean), ['name', 'brand', 'modelName', 'category'])
  assert.equal(clean.name, '제품')
  assert.equal(clean.brand.length, 80)
  assert.equal(clean.modelName.length, 120)
  assert.equal(clean.category.length, 60)
  assert.equal(sanitizePriceSearchProduct({ ...product, name: 'n'.repeat(150) }).name.length, 120)
  assert.equal(JSON.stringify(clean).includes('secret'), false)
  assert.deepEqual(sanitizePriceSearchProduct({ name: '제품', modelName: 'EXACT-1' }), { name: '제품', modelName: 'EXACT-1', brand: '', category: '' })
})

test('accepts name OR modelName and rejects malformed products or both identifiers missing', () => {
  for (const input of [null, undefined, [], 'product', 1, {}, { name: ' ', modelName: 123 }, { name: '<b></b>', modelName: '<b></b>' }]) assert.throws(() => sanitizePriceSearchProduct(input), TypeError)
  assert.equal(sanitizePriceSearchProduct({ name: 'Sony WH-1000XM5' }).modelName, '')
  assert.equal(sanitizePriceSearchProduct({ modelName: 'EXACT' }).name, '')
  assert.equal(sanitizePriceSearchProduct({ name: '제품', modelName: 123 }).name, '제품')
})

test('name-only search explicitly stops ambiguous categories and forbids invented models/options', () => {
  const result = buildPriceSearchRequest(env.AZURE_OPENAI_ENDPOINT, env.AZURE_OPENAI_DEPLOYMENT, { name: '헤드폰' })
  assert.equal(JSON.parse(result.body.input[1].content).product.modelName, '')
  for (const term of ['modelName이 없어도', 'WH-1000XM5', '모호한 이름', 'offers=[]', 'reason', '추측하거나 만들지']) assert.ok(result.body.input[0].content.includes(term))
  const empty = parse(response([], [], '모델을 구분할 구체적인 제품명이 필요합니다.'))
  assert.deepEqual(empty.offers, [])
  assert.match(empty.reason, /제품명/)
})

test('builds only minimal documented Responses v1 request, without private extras or JSON mode', () => {
  const result = buildPriceSearchRequest(`${env.AZURE_OPENAI_ENDPOINT}responses?api-version=old#fragment`, env.AZURE_OPENAI_DEPLOYMENT, { ...product, privateNote: 'secret-private', purchasePrice: 987654, images: ['secret-photo'] })
  assert.equal(result.url, `${env.AZURE_OPENAI_ENDPOINT}responses`)
  assert.equal(result.body.model, env.AZURE_OPENAI_DEPLOYMENT)
  assert.equal(result.body.store, false)
  assert.equal(result.body.tool_choice, 'required')
  assert.equal(result.body.max_tool_calls, 2)
  assert.deepEqual(result.body.tools, [{ type: 'web_search' }])
  assert.deepEqual(result.body.include, ['web_search_call.action.sources'])
  assert.deepEqual(JSON.parse(result.body.input[1].content), { product })
  assert.equal('text' in result.body, false)
  assert.doesNotMatch(JSON.stringify(result.body), /secret-private|secret-photo|987654/)
  for (const term of ['KRW', '동일', '중고', '렌탈', '리퍼비시', '액세서리', '할부금', '번들', '인덱스', 'url_citation']) assert.ok(result.body.input[0].content.includes(term))
})

test('normalizes supported endpoints and rejects classic, credentials, private and non-HTTPS endpoints', () => {
  for (const suffix of ['v1', 'v1/', 'v1/responses', 'v1/responses/']) assert.equal(buildPriceSearchRequest(`https://resource.openai.azure.com/openai/${suffix}`, 'deployment', product).url, `${env.AZURE_OPENAI_ENDPOINT}responses`)
  for (const endpoint of ['https://resource.openai.azure.com/', 'https://resource.openai.azure.com/openai/deployments/x/chat/completions', 'https://resource.openai.azure.com/other/openai/v1/', 'http://resource.openai.azure.com/openai/v1/', 'https://user:pass@resource.openai.azure.com/openai/v1/', 'https://localhost/openai/v1/', 'https://10.0.0.1/openai/v1/', 'invalid']) assert.throws(() => buildPriceSearchRequest(endpoint, 'deployment', product))
  assert.throws(() => buildPriceSearchRequest(env.AZURE_OPENAI_ENDPOINT, '', product))
})

test('accepts only completed searches with actual final-message URL citations', () => {
  const result = parse(response())
  assert.deepEqual(result.offers, [offer])
  assert.deepEqual(result.sources, [{ title: '인용 제목', url: offer.url }])
  assert.equal(result.checkedAt, date.toISOString())
  assert.equal(result.priceBasis, 'search-index')
  assert.equal(result.requiresModelConfirmation, true)
  assert.equal(result.disclaimer, PRICE_SEARCH_DISCLAIMER)
  assert.match(result.disclaimer, /실시간 재고|최종 결제가격/)
  assert.equal('selectedPrice' in result, false)
  assert.equal('recommendedPrice' in result, false)
})

test('fails closed without search, with failed/pending calls or incomplete responses', () => {
  for (const status of ['failed', 'searching', 'in_progress', undefined]) {
    const result = response()
    result.output[1].status = status
    assert.deepEqual(parse(result).offers, [])
  }
  const noSearch = response()
  noSearch.output.splice(1, 1)
  assert.deepEqual(parse(noSearch).offers, [])
  const openOnly = response()
  openOnly.output[1].action.type = 'open_page'
  assert.deepEqual(parse(openOnly).offers, [])
  for (const status of ['incomplete', 'failed', 'in_progress', 'cancelled']) assert.deepEqual(parse({ ...response(), status }).offers, [])
  assert.deepEqual(parse({ ...response(), error: { message: 'secret' } }).offers, [])
})

test('action.sources, model JSON sources, top-level output_text and unrelated citations cannot authorize offers', () => {
  for (const annotations of [[], [{ type: 'file_citation', url: offer.url }], [citation('https://other.example.com/')]]) assert.deepEqual(parse(response([offer], annotations)).offers, [])
  const result = response([offer], [])
  result.output_text = JSON.stringify({ offers: [offer], sources: [citation()], reason: '' })
  result.output.push({ type: 'message', status: 'incomplete', role: 'assistant', content: [{ type: 'output_text', text: '{}', annotations: [citation()] }] })
  assert.deepEqual(parse(result).offers, [])
  result.output[2].role = 'user'
  assert.deepEqual(parse(result).offers, [])
})

test('citations from earlier/commentary messages do not authorize the final uncited JSON', () => {
  const result = response()
  result.output.push({ ...result.output[2], content: [{ type: 'output_text', text: JSON.stringify({ offers: [offer], reason: '' }), annotations: [] }] })
  assert.deepEqual(parse(result).offers, [])
  result.output.at(-1).phase = 'commentary'
  result.output[2].phase = 'commentary'
  assert.deepEqual(parse(result).offers, [])
})

test('rejects unsafe, credentialed, private, localhost and non-HTTPS source URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'http://shop.example.com/', '//shop.example.com', 'https://user:pass@shop.example.com/', 'https://localhost/', 'https://sub.localhost./', 'https://printer.local/', 'https://host.internal/', 'https://router.lan/', 'https://router.home.arpa/', 'https://intranet/', 'https://127.0.0.1/', 'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://10.0.0.1/', 'https://172.16.1.1/', 'https://192.168.1.1/', 'https://169.254.169.254/', 'https://100.64.0.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fc00::1]/', 'https://shop.example.com:8080/', 'https://shop.example.com/\npath', 'https://shop.example.com/<img>', 'https://shop.example.com/"', 'not a url', null]) {
    assert.equal(normalizePriceSourceUrl(url), null, String(url))
    assert.deepEqual(parse(response([{ ...offer, url }], [citation(url)])).offers, [])
  }
  assert.equal(normalizePriceSourceUrl('https://SHOP.example.com:443/p#details'), 'https://shop.example.com/p')
  for (const host of ['localhost.localdomain', 'sub.localdomain', 'host.localnet']) {
    assert.equal(normalizePriceSourceUrl(`https://${host}/`), null)
  }
})

test('rejects offers missing usable titles or sellers and ignores malformed citation annotations', () => {
  for (const fields of [{ title: '' }, { title: '<img src=x>' }, { seller: null }, { seller: '<b></b>' }]) {
    assert.deepEqual(parse(response([{ ...offer, ...fields }])).offers, [])
  }
  for (const annotations of [null, {}, [null], [{ type: 'url_citation' }]]) {
    assert.deepEqual(parse(response([offer], annotations)).offers, [])
  }
})

test('rejects invalid prices and non-KRW currencies rather than coercing values', () => {
  for (const price of [0, -1, 1.5, '123000', null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 10_000_000_001]) assert.deepEqual(parse(response([{ ...offer, price }])).offers, [])
  for (const currency of ['USD', 'krw', '₩', null, undefined]) assert.deepEqual(parse(response([{ ...offer, currency }])).offers, [])
  assert.equal(parse(response([{ ...offer, price: 10_000_000_000 }])).offers.length, 1)
})

test('deduplicates normalized cited URLs, limits to five, and exposes only accepted citation titles', () => {
  const offers = Array.from({ length: 8 }, (_, index) => ({ ...offer, url: `https://shop.example.com/p/${index}` }))
  const result = parse(response([{ ...offers[0], url: `${offers[0].url}#details` }, ...offers], offers.map((item) => citation(item.url))))
  assert.equal(result.offers.length, 5)
  assert.equal(result.sources.length, 5)
  assert.equal(new Set(result.offers.map((item) => item.url)).size, 5)
  assert.deepEqual(result.offers.map((item) => item.url), result.sources.map((item) => item.url))
})

test('strips HTML, controls and all model-invented metadata from returned text', () => {
  const result = parse(response([{ ...offer, title: '<script>alert(1)</script><b>TEST-100</b>', seller: '<img src=x onerror=alert(1)>판매처', note: '<svg onload=alert(1)>메모</svg>\u0000', privateNote: 'secret', checkedAt: 'invented', selected: true }], [citation()], '<b>참고</b>'))
  assert.equal(result.offers[0].title, 'TEST-100')
  assert.equal(result.offers[0].seller, '판매처')
  assert.equal(result.offers[0].note, '메모')
  assert.equal(result.reason, '참고')
  assert.doesNotMatch(JSON.stringify(result), /<|>|onerror|onload|secret|invented/)
  assert.deepEqual(Object.keys(result.offers[0]), ['title', 'price', 'currency', 'seller', 'url', 'note'])
})

test('returns honest empty results and never substitutes a mock price', () => {
  const result = parse(response([], [], '<b>동일 모델 신품 없음</b>'))
  assert.deepEqual(result.offers, [])
  assert.deepEqual(result.sources, [])
  assert.equal(result.reason, '동일 모델 신품 없음')
  assert.equal(result.checkedAt, date.toISOString())
  assert.ok(parse(response([], [], '')).reason)
})

test('malformed output fails closed and code-fenced valid JSON is tolerated', () => {
  for (const input of [null, undefined, {}, { output: null }, { output: [null] }]) assert.deepEqual(parse(input).offers, [])
  for (const text of ['not json', 'null', '[]', '{}', '{"offers":null,"reason":""}', '{"offers":[],"reason":null}', 'x'.repeat(20001), '{"offers":[null,1,{}],"reason":""}']) {
    const result = response()
    result.output[2].content[0].text = text
    assert.deepEqual(parse(result).offers, [])
  }
  const fenced = response()
  fenced.output[2].content[0].text = `\`\`\`json\n${fenced.output[2].content[0].text}\n\`\`\``
  assert.equal(parse(fenced).offers.length, 1)
})

test('rate limit permits three per rolling minute per user and cleans expired entries', () => {
  const limited = createPriceSearchRateLimiter()
  assert.equal(limited('a', 0), false)
  assert.equal(limited('a', 100), false)
  assert.equal(limited('a', 200), false)
  assert.equal(limited('a', 59999), true)
  assert.equal(limited('b', 59999), false)
  assert.equal(limited('a', 60000), false)
  assert.equal(limited('a', 60000), true)
  assert.equal(limited('c', 120001), false) // Cleans expired a/b windows on another user's request.
  assert.equal(limited('a', 120001), false)
  assert.equal(limited('b', 120001), false)
})

test('handler requires existing SWA authorization before reading body or calling Azure', async () => {
  const h = harness()
  for (const user of [null, 'invalid', Buffer.from('null').toString('base64'), Buffer.from(JSON.stringify({ userRoles: ['anonymous'] })).toString('base64')]) assert.equal((await h.invoke(request('{}', { user }))).status, 401)
  assert.equal(h.calls.length, 0)
})

test('handler rejects malformed/null JSON and missing both identifiers without upstream calls', async () => {
  const h = harness({ isRateLimited: () => false })
  for (const body of ['', 'not json', 'null', '[]', '{}', '{"product":null}', '{"product":{"category":"헤드폰"}}']) assert.equal((await h.invoke(request(body))).status, 400)
  assert.equal((await h.invoke(request('', { method: 'GET' }))).status, 405)
  assert.equal(h.calls.length, 0)
})

test('handler accepts name-only and model-only requests', async () => {
  const h = harness()
  for (const input of [{ name: 'Sony WH-1000XM5' }, { modelName: 'WH-1000XM5' }]) assert.equal((await h.invoke(request(JSON.stringify({ product: input })))).status, 200)
  assert.equal(h.calls.length, 2)
})

test('handler caps actual UTF-8 body at 4KB, including missing/dishonest length headers', async () => {
  const h = harness({ isRateLimited: () => false })
  assert.equal(MAX_REQUEST_BYTES, 4096)
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '5000' }]) assert.equal((await h.invoke(request(JSON.stringify({ product, extra: '가'.repeat(1400) }), { headers }))).status, 413)
  assert.equal((await h.invoke(request(' '.repeat(4097)))).status, 413)
  assert.equal(h.calls.length, 0)
})

test('handler returns meaningful 503 for missing credentials or unsupported endpoint', async () => {
  for (const config of [{}, { ...env, AZURE_OPENAI_API_KEY: '' }, { ...env, AZURE_OPENAI_DEPLOYMENT: '' }, { ...env, AZURE_OPENAI_ENDPOINT: 'https://resource.openai.azure.com/' }]) {
    const h = harness({ env: config })
    const result = await h.invoke()
    assert.equal(result.status, 503)
    assert.ok((await result.json()).error)
    assert.equal(h.calls.length, 0)
  }
})

test('handler sends exactly one configured-endpoint request with existing key and no personal extras', async () => {
  const h = harness()
  const result = await h.invoke(request(JSON.stringify({ product: { ...product, purchasePrice: 987654, images: ['secret-photo'], privateNote: 'secret-note' }, endpoint: 'https://attacker.example.com/' })))
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.equal(result.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal((await result.json()).offers.length, 1)
  assert.equal(h.calls.length, 1)
  const [url, options] = h.calls[0]
  assert.equal(url, `${env.AZURE_OPENAI_ENDPOINT}responses`)
  assert.equal(options.headers['api-key'], env.AZURE_OPENAI_API_KEY)
  assert.equal(options.redirect, 'error')
  assert.equal(options.method, 'POST')
  assert.ok(options.signal instanceof AbortSignal)
  assert.equal(PRICE_SEARCH_TIMEOUT_MS, 35000)
  assert.doesNotMatch(options.body, /secret-photo|secret-note|987654|attacker|user-1|offline-test-key/)
  assert.equal(h.logs.length, 0)
})

test('handler enforces per-instance user limit without paying for a fourth request', async () => {
  const h = harness()
  for (let index = 0; index < 3; index++) assert.equal((await h.invoke()).status, 200)
  assert.equal((await h.invoke()).status, 429)
  assert.equal(h.calls.length, 3)
  assert.equal((await h.invoke(request(undefined, { user: principal('other-user') }))).status, 200)
})

test('handler maps upstream statuses safely and never reads/logs private error bodies', async () => {
  for (const [upstreamStatus, expected] of [[400, 503], [429, 429], [401, 502], [403, 502], [500, 502]]) {
    const h = harness({ fetchImpl: async () => ({ ok: false, status: upstreamStatus, json: () => { throw new Error('must not read upstream error body') } }) })
    const result = await h.invoke()
    assert.equal(result.status, expected)
    const body = await result.json()
    if (upstreamStatus === 400) assert.match(body.error, /web_search.*모델/)
    assert.deepEqual(h.logs, [`Price search upstream status ${upstreamStatus}.`])
    assert.doesNotMatch(JSON.stringify(body), /offline-test-key|must not read/)
  }
})

test('handler reports timeout, transport failures and malformed upstream JSON without logging details', async () => {
  for (const [name, expected] of [['TimeoutError', 504], ['AbortError', 504], ['TypeError', 502], ['SyntaxError', 502]]) {
    const h = harness({ fetchImpl: async () => { throw Object.assign(new Error('secret-query-and-key'), { name }) } })
    const result = await h.invoke()
    assert.equal(result.status, expected)
    assert.deepEqual(h.logs, [`Price search status ${expected}.`])
    assert.doesNotMatch(await result.text(), /secret-query-and-key/)
  }
  const h = harness({ fetchImpl: async () => new Response('not JSON') })
  assert.equal((await h.invoke()).status, 502)
})

test('handler returns empty offers for malformed model output and missing citation evidence', async () => {
  for (const fixture of [response([offer], []), { output_text: JSON.stringify({ offers: [offer], reason: '' }) }, response([], [], '판매정보 없음')]) {
    const h = harness({ fetchImpl: async () => Response.json(fixture) })
    const result = await h.invoke()
    assert.equal(result.status, 200)
    assert.deepEqual((await result.json()).offers, [])
  }
})

test('recovers Azure rendered citations inside URL strings only when both targets match actual annotations', () => {
  const decorated = { ...offer, url: `${offer.url} ([shop.example.com](${offer.url}))` }
  assert.equal(parse(response([decorated])).offers[0].url, offer.url)
  assert.equal(parse(response([decorated], [])).offers.length, 0)
  const mismatched = { ...offer, url: `${offer.url} ([shop.example.com](https://evil.example.com/))` }
  assert.equal(parse(response([mismatched])).offers.length, 0)
  const ungrounded = { ...offer, url: `https://shop.example.com/other ([shop.example.com](https://shop.example.com/other))` }
  assert.equal(parse(response([ungrounded])).offers.length, 0)
})