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
  assert.match(messages[1].content[0].text, /Notebook/)
})

test('parses valid AI JSON and rejects malformed output', () => {
  assert.deepEqual(parseListingResponse('{"title":"Galaxy Book5","description":"외관 사용감이 있습니다."}'), {
    title: 'Galaxy Book5',
    description: '외관 사용감이 있습니다.',
    priceSuggestion: null,
    priceSuggestionReason: '',
  })
  assert.throws(() => parseListingResponse('not json'))
})

test('returns an explicitly non-market reference price range when provided valid inputs', () => {
  const parsed = parseListingResponse(JSON.stringify({
    title: 'Galaxy Book5',
    description: '외관 사용감이 있습니다.',
    priceSuggestion: { low: 800000, high: 1100000, recommended: 950000, confidence: 'high', basis: '입력 가격과 상태 참고' },
  }))
  assert.equal(parsed.priceSuggestion.recommended, 950000)
  assert.equal(parsed.priceSuggestion.confidence, 'low')
  assert.match(parsed.priceSuggestion.disclaimer, /실제 중고 거래 시세/)
})

test('preserves a valid listing when the optional price range is invalid', () => {
  const draft = parseListingResponse(JSON.stringify({
    title: '제품', description: '설명',
    priceSuggestion: { low: 1000, high: 500, recommended: 700, confidence: 'low', basis: '입력' },
  }))
  assert.equal(draft.title, '제품')
  assert.equal(draft.priceSuggestion, null)
  assert.match(draft.priceSuggestionReason, /검증하지 못/)
})

test('requires an authenticated Static Web Apps principal', () => {
  assert.equal(authorizeStaticWebAppsPrincipal(null).status, 401)
})

test('allows all authenticated accounts without an email allowlist', () => {
  for (const userId of ['owner', 'another-account']) {
    const principal = Buffer.from(JSON.stringify({ userId, identityProvider: 'aad', userDetails: `${userId}@example.com`, userRoles: ['anonymous', 'authenticated'] })).toString('base64')
    assert.deepEqual(authorizeStaticWebAppsPrincipal(principal), { userKey: JSON.stringify(['aad', userId]) })
  }
})

test('uses stable account identifiers even when email is absent', () => {
  const principal = Buffer.from(JSON.stringify({ userId: 'account-id', identityProvider: 'aad', userRoles: ['authenticated'] })).toString('base64')
  assert.deepEqual(authorizeStaticWebAppsPrincipal(principal), { userKey: '["aad","account-id"]' })
})

test('rejects malformed, anonymous and incomplete principals', () => {
  for (const value of [null, {}, { userId: 'id', identityProvider: 'aad', userRoles: ['anonymous'] }, { userRoles: ['authenticated'] }]) {
    assert.equal(authorizeStaticWebAppsPrincipal(Buffer.from(JSON.stringify(value)).toString('base64')).status, 401)
  }
  assert.equal(authorizeStaticWebAppsPrincipal('invalid').status, 401)
})

test('uses Azure OpenAI Responses v1 endpoint when the supplied endpoint includes /openai/v1/responses', () => {
  const product = sanitizeProductFacts({ name: 'Galaxy Book5', category: '노트북' })
  const request = buildAzureOpenAIRequest('https://resource.services.ai.azure.com/openai/v1/responses', 'deployment-name', '', product)
  assert.equal(request.url, 'https://resource.services.ai.azure.com/openai/v1/responses')
  assert.equal(request.body.model, 'deployment-name')
  assert.equal(request.body.input[1].content[0].type, 'input_text')
  assert.match(request.body.input[1].content[0].text, /Galaxy Book5/)
  assert.equal(request.body.text.format.type, 'json_schema')
  assert.equal(request.body.text.format.strict, true)
  assert.equal(request.body.store, false)
})

test('sends opted-in photos and price inputs to Responses as structured image inputs', () => {
  const product = sanitizeProductFacts({
    name: 'Camera', category: '기타',
    priceInputs: { purchasePrice: 300000, currentNewPrice: 250000, checkedAt: '2026-10-18', source: '판매처' },
    images: [{ label: '외관 사진', dataUrl: 'data:image/jpeg;base64,AAAA' }],
  })
  const request = buildAzureOpenAIRequest('https://resource.services.ai.azure.com/openai/v1/responses', 'deployment-name', '', product)
  const contents = request.body.input[1].content
  assert.match(contents[0].text, /purchasePrice/)
  assert.deepEqual(contents[2], { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA', detail: 'low' })
})

test('uses chat completions endpoint when a classic Azure OpenAI resource endpoint is supplied', () => {
  const product = sanitizeProductFacts({ name: 'Headphones', category: '헤드폰' })
  const request = buildAzureOpenAIRequest('https://resource.openai.azure.com/', 'deployment-name', '2024-10-21', product)
  assert.equal(request.url, 'https://resource.openai.azure.com/openai/deployments/deployment-name/chat/completions?api-version=2024-10-21')
  assert.equal(request.body.response_format.type, 'json_object')
  assert.equal(request.body.messages[1].content[0].type, 'text')
})

test('extracts Responses API output_text and Chat Completions content', () => {
  assert.equal(extractAzureOpenAIText({ output_text: '{"title":"A","description":"B"}' }), '{"title":"A","description":"B"}')
  assert.equal(extractAzureOpenAIText({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'response text' }] }] }), 'response text')
  assert.equal(extractAzureOpenAIText({ choices: [{ message: { content: 'chat text' } }] }), 'chat text')
})
