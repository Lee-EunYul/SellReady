import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Exercise the real browser orchestrator without a build, emitted files or paid APIs.
const source = await readFile(new URL('../../src/services/listingGenerator.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { generateAutomaticValuation, ListingGenerationError } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

const identity = {
  status: 'identified', name: 'Sony WH-1000XM5', brand: 'Sony', modelName: 'WH-1000XM5',
  category: '헤드폰', visibleCondition: ['AI 외관 추측'], uncertainties: [], reason: '모델 확인',
}
const offer = {
  title: 'WH-1000XM5 신품', price: 300000, currency: 'KRW', seller: '판매처',
  url: 'https://shop.example.com/product', note: '동일 모델',
}
const suggestion = {
  low: 100000, high: 200000, recommended: 150000, confidence: 'low',
  basis: '신품가격과 상태 참고', disclaimer: '참고 가격',
}
const draft = {
  title: '헤드폰 판매', description: '판매자가 기록한 상태입니다.',
  priceSuggestion: suggestion, priceSuggestionReason: '',
}
const facts = (overrides = {}) => ({
  name: '', brand: '', modelName: '', category: '기타', purchaseDate: '', usageDuration: '',
  condition: '', components: '', checkedItems: [], issues: [], ...overrides,
})
const searchResult = (offers = [offer]) => ({
  offers, reason: '', checkedAt: '2026-10-24T12:34:56Z', disclaimer: '검색 시점 가격',
})
const identifyStep = (response = identity) => ({ path: '/api/identify-product', response })
const searchStep = (response = searchResult()) => ({ path: '/api/search-new-price', response })
const listingStep = () => ({ path: '/api/generate-listing', response: draft })

// Every top-level test is serial and restores fetch even when an assertion rejects.
function serialTest(name, run) {
  test(name, { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch
    let calls
    let steps
    try {
      globalThis.fetch = async () => { throw new Error('Unexpected fetch before mock setup') }
      const mockApi = (expectedSteps) => {
        assert.equal(steps, undefined, 'install only one mock per test')
        steps = expectedSteps
        calls = []
        globalThis.fetch = async (path, options) => {
          const step = steps[calls.length]
          const product = JSON.parse(options.body).product
          calls.push({ path, product })
          assert.ok(step, `unexpected API call: ${path}`)
          assert.equal(path, step.path)
          assert.equal(options.method, 'POST')
          assert.equal(options.credentials, 'same-origin')
          assert.equal(options.headers['Content-Type'], 'application/json')
          if (step.error) throw step.error
          return new Response(JSON.stringify(step.response), {
            status: step.status ?? 200, headers: { 'Content-Type': 'application/json' },
          })
        }
        return calls
      }
      await run(mockApi)
      assert.ok(steps, 'fetch must be mocked')
      assert.equal(calls.length, steps.length, 'all and only expected API calls must occur')
      assert.deepEqual(calls.map(({ path }) => path), steps.map(({ path }) => path))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
}

serialTest('name-only one-click valuation identifies, searches and lists using the lowest valid offer without purchasePrice', async (mockApi) => {
  const cheapest = { ...offer, price: 250000, url: 'https://cheap.example.com/product' }
  const offers = [{ ...offer, price: 450000 }, cheapest, offer]
  const calls = mockApi([identifyStep(), searchStep(searchResult(offers)), listingStep()])
  const stages = []
  const result = await generateAutomaticValuation(facts({ name: '소니 헤드폰' }), (stage) => stages.push(stage))

  assert.deepEqual(stages, ['identify', 'search', 'value'])
  assert.deepEqual(calls[0].product, {
    name: '소니 헤드폰', brand: '', modelName: '', category: '기타', images: [],
  })
  assert.deepEqual(calls[1].product, {
    name: identity.name, brand: identity.brand, modelName: identity.modelName, category: identity.category,
  })
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.identity, identity)
  assert.deepEqual(result.search, searchResult(offers))
  assert.deepEqual(result.selectedOffer, cheapest)
  assert.deepEqual(result.draft, draft)
  assert.equal(result.reason, '')
  assert.deepEqual(calls[2].product.priceInputs, {
    currentNewPrice: cheapest.price, checkedAt: '2026-10-24', source: cheapest.url,
  })
  assert.equal(Object.hasOwn(calls[2].product.priceInputs, 'purchasePrice'), false)
})

serialTest('photo-only valuation sends bounded identity images but no price information to identification or search', async (mockApi) => {
  const images = [
    { label: '모델 라벨', dataUrl: 'data:image/jpeg;base64,AAAA', privateNote: 'IMAGE_SECRET' },
    { label: '외관', dataUrl: 'data:image/png;base64,BBBB' },
    { label: '제외할 세 번째 사진', dataUrl: 'data:image/png;base64,CCCC' },
  ]
  const safeImages = images.slice(0, 2).map(({ label, dataUrl }) => ({ label, dataUrl }))
  const calls = mockApi([identifyStep(), searchStep(), listingStep()])
  const result = await generateAutomaticValuation(facts({
    images, priceInputs: { purchasePrice: 490000, currentNewPrice: 999999, source: 'OLD_SOURCE', checkedAt: '2000-01-01' },
  }))

  assert.equal(result.status, 'completed')
  assert.deepEqual(calls[0].product, { name: '', brand: '', modelName: '', category: '기타', images: safeImages })
  assert.deepEqual(calls[1].product, {
    name: identity.name, brand: identity.brand, modelName: identity.modelName, category: identity.category,
  })
  assert.deepEqual(calls[2].product.images, safeImages)
  assert.deepEqual(calls[2].product.priceInputs, {
    purchasePrice: 490000, currentNewPrice: offer.price, checkedAt: '2026-10-24', source: offer.url,
  })
})

serialTest('final listing preserves recorded age, condition, issues and checklist category without leaking private fields', async (mockApi) => {
  const product = facts({
    name: '내 헤드폰', category: '기타', purchaseDate: '2024-10-25', usageDuration: '23개월',
    condition: '이어패드 사용감 있음', components: '본체와 케이스',
    checkedItems: ['블루투스 정상'], issues: ['오른쪽 힌지 흠집'],
    privateNote: 'PRIVATE_NOTE', ownerId: 'PRIVATE_OWNER', warrantyInfo: 'PRIVATE_WARRANTY',
    saleThoughts: 'PRIVATE_THOUGHTS', otherProducts: ['PRIVATE_PRODUCT'],
    priceInputs: { purchasePrice: 490000, privateNote: 'PRIVATE_PRICE' },
  })
  const calls = mockApi([
    identifyStep({ ...identity, privateNote: 'PRIVATE_IDENTITY' }), searchStep(), listingStep(),
  ])
  await generateAutomaticValuation(product)

  assert.deepEqual(calls[2].product, {
    name: identity.name, brand: identity.brand, modelName: identity.modelName,
    category: product.category, purchaseDate: product.purchaseDate, usageDuration: product.usageDuration,
    condition: product.condition, components: product.components,
    checkedItems: product.checkedItems, issues: product.issues, images: [],
    priceInputs: { purchasePrice: 490000, currentNewPrice: offer.price, checkedAt: '2026-10-24', source: offer.url },
  })
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE_|AI 외관 추측/)
  for (const { product: request } of calls.slice(0, 2)) {
    for (const key of ['purchaseDate', 'usageDuration', 'condition', 'components', 'checkedItems', 'issues', 'priceInputs']) {
      assert.equal(Object.hasOwn(request, key), false, `${key} must not reach identification/search`)
    }
  }
})

serialTest('needs_details stops after identification without search or final listing', async (mockApi) => {
  const incomplete = { ...identity, status: 'needs_details', modelName: '', reason: '모델 라벨 사진이 필요합니다.' }
  mockApi([identifyStep(incomplete)])
  const stages = []
  const result = await generateAutomaticValuation(facts({ name: '헤드폰' }), (stage) => stages.push(stage))

  assert.deepEqual(stages, ['identify'])
  assert.deepEqual(result, {
    status: 'needs_details', identity: incomplete, search: null, selectedOffer: null, draft: null, reason: incomplete.reason,
  })
})

for (const [label, offers] of [
  ['empty search', []],
  ['missing source URL', [{ ...offer, url: '' }]],
  ['omitted source URL', [{ ...offer, url: undefined }]],
]) {
  serialTest(`${label} produces no valuation and never falls back to the old recorded price`, async (mockApi) => {
    const search = { ...searchResult(offers), reason: '검증된 판매처 가격이 없습니다.' }
    const calls = mockApi([identifyStep(), searchStep(search), listingStep()])
    const result = await generateAutomaticValuation(facts({
      name: '헤드폰', priceInputs: { purchasePrice: 490000, currentNewPrice: 888888, source: 'OLD_SOURCE', checkedAt: '2000-01-01' },
    }))

    assert.equal(result.status, 'completed')
    assert.deepEqual(result.search, JSON.parse(JSON.stringify(search)))
    assert.equal(result.selectedOffer, null)
    assert.deepEqual(calls[2].product.priceInputs, { purchasePrice: 490000 })
    assert.equal(result.draft.title, draft.title)
    assert.equal(result.draft.description, draft.description)
    assert.equal(result.draft.priceSuggestion, null, 'discard even a price suggested by the final API')
    assert.equal(result.draft.priceSuggestionReason, search.reason)
    assert.equal(result.reason, search.reason)
    assert.doesNotMatch(JSON.stringify(calls), /888888|OLD_SOURCE|2000-01-01/)
  })
}

for (const [label, failure] of [
  ['HTTP 503', { status: 503, response: { error: '검색 일시 중단' } }],
  ['network rejection', { error: new TypeError('Network unavailable') }],
]) {
  serialTest(`non-auth search failure (${label}) still generates a listing with null price`, async (mockApi) => {
    const calls = mockApi([identifyStep(), { path: '/api/search-new-price', ...failure }, listingStep()])
    const stages = []
    const result = await generateAutomaticValuation(facts({
      name: '헤드폰', priceInputs: { currentNewPrice: 888888, source: 'OLD_SOURCE', checkedAt: '2000-01-01' },
    }), (stage) => stages.push(stage))

    assert.deepEqual(stages, ['identify', 'search', 'value'])
    assert.equal(result.status, 'completed')
    assert.equal(result.search, null)
    assert.equal(result.selectedOffer, null)
    assert.deepEqual(calls[2].product.priceInputs, {})
    assert.equal(result.draft.title, draft.title)
    assert.equal(result.draft.description, draft.description)
    assert.equal(result.draft.priceSuggestion, null)
    assert.match(result.reason, /검색에 실패/)
    assert.equal(result.draft.priceSuggestionReason, result.reason)
  })
}

for (const status of [401, 403]) {
  serialTest(`auth search failure (${status}) aborts before the final paid listing call`, async (mockApi) => {
    mockApi([identifyStep(), { path: '/api/search-new-price', status, response: { error: '인증 필요' } }])
    const stages = []
    await assert.rejects(
      generateAutomaticValuation(facts({ name: '헤드폰' }), (stage) => stages.push(stage)),
      (error) => error instanceof ListingGenerationError && error.status === status && error.message === '인증 필요',
    )
    assert.deepEqual(stages, ['identify', 'search'])
  })
}

for (const [label, invalid] of [
  ['zero price', { price: 0 }],
  ['negative price', { price: -100 }],
  ['string price', { price: '100' }],
  ['null price', { price: null }],
  ['missing price', { price: undefined }],
  ['wrong currency', { price: 1, currency: 'USD' }],
  ['insecure source', { price: 1, url: 'http://shop.example.com/product' }],
  ['credentialed source', { price: 1, url: 'https://user:secret@shop.example.com/product' }],
  ['blank seller', { price: 1, seller: ' ' }],
  ['blank title', { price: 1, title: ' ' }],
]) {
  serialTest(`invalid offer (${label}) is never automatically selected`, async (mockApi) => {
    const calls = mockApi([identifyStep(), searchStep(searchResult([{ ...offer, ...invalid }])), listingStep()])
    const result = await generateAutomaticValuation(facts({ name: '헤드폰' }))

    assert.equal(result.selectedOffer, null)
    assert.deepEqual(calls[2].product.priceInputs, {})
    assert.equal(result.draft.priceSuggestion, null)
    assert.ok(result.reason)
    assert.equal(result.draft.priceSuggestionReason, result.reason)
  })
}

serialTest('invalid cheaper offers are skipped when a valid new-price offer is available', async (mockApi) => {
  const calls = mockApi([
    identifyStep(),
    searchStep(searchResult([{ ...offer, price: 0 }, { ...offer, price: 1, url: '' }, { ...offer, price: '2' }, offer])),
    listingStep(),
  ])
  const result = await generateAutomaticValuation(facts({ name: '헤드폰' }))

  assert.deepEqual(result.selectedOffer, offer)
  assert.equal(calls[2].product.priceInputs.currentNewPrice, offer.price)
  assert.deepEqual(result.draft.priceSuggestion, suggestion)
})