import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeStaticWebAppsPrincipal, buildAzureOpenAIRequest, createListingMessages, extractAzureOpenAIText, parseListingResponse, sanitizeProductFacts } from '../src/listingLogic.js'

test('accepts only bounded product facts and excludes private fields', () => {
  const product = sanitizeProductFacts({
    name: 'Galaxy Book5',
    category: '기타',
    brand: 'Samsung',
    purchasePrice: 3_000_000,
    privateNote: '비공개 메모',
    components: '노트북 본체, 충전기',
    issues: ['외관 사용감 있음'],
  })

  assert.equal(product.name, 'Galaxy Book5')
  assert.equal(product.components, '노트북 본체, 충전기')
  assert.equal('purchasePrice' in product, false)
  assert.equal('privateNote' in product, false)
  assert.equal(product.issues.length, 1)
})

test('rejects a missing required product name', () => {
  assert.throws(() => sanitizeProductFacts({ category: '기타' }), /제품명과 카테고리/)
})

test('limits issue details to twelve facts', () => {
  const product = sanitizeProductFacts({ name: 'Notebook', category: '기타', issues: Array.from({ length: 20 }, (_, index) => `issue-${index}`) })
  assert.equal(product.issues.length, 12)
})

test('creates instructions that prohibit inventing facts', () => {
  const product = sanitizeProductFacts({ name: 'Notebook', category: '기타', issues: ['외관 사용감 있음'] })
  const messages = createListingMessages(product)
  assert.match(messages[0].content, /확인되지 않은/)
  assert.match(messages[0].content, /하자/)
  assert.match(messages[1].content, /Notebook/)
})

test('parses valid AI JSON and rejects malformed output', () => {
  assert.deepEqual(parseListingResponse('{"title":"Galaxy Book5","description":"외관 사용감이 있습니다."}'), {
    title: 'Galaxy Book5',
    description: '외관 사용감이 있습니다.',
  })
  assert.throws(() => parseListingResponse('not json'))
})

test('requires an authenticated Static Web Apps principal', () => {
  assert.equal(authorizeStaticWebAppsPrincipal(null, 'owner@example.com').status, 401)
})

test('fails closed when the email allowlist is missing', () => {
  const principal = Buffer.from(JSON.stringify({ userDetails: 'owner@example.com', userRoles: ['authenticated'] })).toString('base64')
  assert.equal(authorizeStaticWebAppsPrincipal(principal, '').status, 503)
})

test('allows only configured authenticated emails', () => {
  const principal = Buffer.from(JSON.stringify({ userDetails: 'Owner@Example.com', userRoles: ['anonymous', 'authenticated'] })).toString('base64')
  assert.deepEqual(authorizeStaticWebAppsPrincipal(principal, 'owner@example.com'), { email: 'owner@example.com' })
  assert.equal(authorizeStaticWebAppsPrincipal(principal, 'other@example.com').status, 403)
})

test('uses Azure OpenAI Responses v1 endpoint when the supplied endpoint includes /openai/v1/responses', () => {
  const product = sanitizeProductFacts({ name: 'Galaxy Book5', category: '노트북' })
  const request = buildAzureOpenAIRequest('https://resource.services.ai.azure.com/openai/v1/responses', 'deployment-name', '', product)
  assert.equal(request.url, 'https://resource.services.ai.azure.com/openai/v1/responses')
  assert.equal(request.body.model, 'deployment-name')
  assert.match(request.body.input, /Galaxy Book5/)
  assert.equal(request.body.text.format.type, 'json_object')
})

test('uses chat completions endpoint when a classic Azure OpenAI resource endpoint is supplied', () => {
  const product = sanitizeProductFacts({ name: 'Headphones', category: '헤드폰' })
  const request = buildAzureOpenAIRequest('https://resource.openai.azure.com/', 'deployment-name', '2024-10-21', product)
  assert.equal(request.url, 'https://resource.openai.azure.com/openai/deployments/deployment-name/chat/completions?api-version=2024-10-21')
  assert.equal(request.body.response_format.type, 'json_object')
})

test('extracts Responses API output_text and Chat Completions content', () => {
  assert.equal(extractAzureOpenAIText({ output_text: '{"title":"A","description":"B"}' }), '{"title":"A","description":"B"}')
  assert.equal(extractAzureOpenAIText({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'response text' }] }] }), 'response text')
  assert.equal(extractAzureOpenAIText({ choices: [{ message: { content: 'chat text' } }] }), 'chat text')
})
