export type ListingFacts = {
  name: string
  brand: string
  modelName: string
  category: string
  purchaseDate: string
  usageDuration: string
  condition: string
  components: string
  checkedItems: string[]
  issues: string[]
  priceInputs?: {
    purchasePrice?: number
    currentNewPrice?: number
    checkedAt?: string
    source?: string
  } | null
  images?: Array<{ label: string; dataUrl: string }>
}

export type PriceSuggestion = {
  low: number
  high: number
  recommended: number
  confidence: 'low' | 'medium' | 'high'
  basis: string
  disclaimer: string
}

export type ListingDraft = {
  title: string
  description: string
  priceSuggestion: PriceSuggestion | null
  priceSuggestionReason: string
}

export type NewPriceOffer = {
  title: string
  price: number
  currency: 'KRW'
  seller: string
  url: string
  note: string
}

export type NewPriceSearch = {
  offers: NewPriceOffer[]
  reason: string
  checkedAt: string
  disclaimer: string
}

export type ProductIdentity = {
  status: 'identified' | 'needs_details'
  name: string
  brand: string
  modelName: string
  category: string
  visibleCondition: string[]
  uncertainties: string[]
  reason: string
}

export type ValuationStage = 'identify' | 'search' | 'value'

export type AutomaticValuationOutcome = {
  status: 'completed' | 'needs_details'
  identity: ProductIdentity
  search: NewPriceSearch | null
  selectedOffer: NewPriceOffer | null
  draft: ListingDraft | null
  reason: string
}

export async function identifyProduct(product: ListingFacts): Promise<ProductIdentity> {
  const { name, brand, modelName, category } = product
  const images = (product.images ?? []).slice(0, 2).map(({ label, dataUrl }) => ({ label, dataUrl }))
  const response = await fetch('/api/identify-product', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // Purchase information, condition notes and private fields must not reach identification.
    body: JSON.stringify({ product: { name, brand, modelName, category, images } }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new ListingGenerationError(result?.error || '제품 식별에 실패했습니다.', response.status)
  if (!result || !['identified', 'needs_details'].includes(result.status)
    || !['name', 'brand', 'modelName', 'category', 'reason'].every((key) => typeof result[key] === 'string')
    || !Array.isArray(result.visibleCondition) || !result.visibleCondition.every((item: unknown) => typeof item === 'string')
    || !Array.isArray(result.uncertainties) || !result.uncertainties.every((item: unknown) => typeof item === 'string')) {
    throw new ListingGenerationError('제품 식별 응답 형식이 올바르지 않습니다.')
  }
  if (result.status === 'identified' && (!result.name.trim() || !result.modelName.trim())) {
    return { ...result, status: 'needs_details', modelName: '', reason: '제품을 명확히 식별하지 못했습니다. 제품명 또는 모델 라벨 사진을 보완해주세요.' }
  }
  return result as ProductIdentity
}

export function isValidNewPriceOffer(offer: NewPriceOffer): boolean {
  if (!offer || offer.currency !== 'KRW' || !Number.isFinite(offer.price) || offer.price <= 0
    || typeof offer.title !== 'string' || !offer.title.trim()
    || typeof offer.seller !== 'string' || !offer.seller.trim() || typeof offer.url !== 'string') return false
  try {
    const url = new URL(offer.url)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

/** Only call after explicit consent. Images supplied here must already be opted in. */
export async function generateAutomaticValuation(
  product: ListingFacts,
  onProgress: (stage: ValuationStage) => void = () => {},
): Promise<AutomaticValuationOutcome> {
  onProgress('identify')
  const identity = await identifyProduct(product)
  if (identity.status === 'needs_details') {
    return { status: 'needs_details', identity, search: null, selectedOffer: null, draft: null, reason: identity.reason }
  }

  onProgress('search')
  let search: NewPriceSearch | null = null
  let reason = ''
  try {
    search = await searchNewPrice({
      name: identity.name, brand: identity.brand, modelName: identity.modelName, category: identity.category,
    })
  } catch (cause) {
    if (cause instanceof ListingGenerationError && (cause.status === 401 || cause.status === 403)) throw cause
    reason = '신품가격 검색에 실패해 가격 추정 없이 판매글만 생성했습니다. 잠시 후 자동 분석을 다시 시도할 수 있습니다.'
  }
  const selectedOffer = search?.offers.filter(isValidNewPriceOffer)
    .reduce<NewPriceOffer | null>((lowest, offer) => !lowest || offer.price < lowest.price ? offer : lowest, null) ?? null
  if (!selectedOffer && !reason) {
    reason = search?.reason || '유효한 KRW 신품 판매가격을 찾지 못해 가격 추정을 생략했습니다.'
  }

  onProgress('value')
  const draft = await generateListing({
    name: identity.name, brand: identity.brand, modelName: identity.modelName,
    // Keep the user's checklist category and recorded facts, not AI category/condition guesses.
    category: product.category,
    purchaseDate: product.purchaseDate, usageDuration: product.usageDuration,
    condition: product.condition, components: product.components,
    checkedItems: [...product.checkedItems], issues: [...product.issues],
    images: (product.images ?? []).slice(0, 2).map(({ label, dataUrl }) => ({ label, dataUrl })),
    priceInputs: {
      purchasePrice: product.priceInputs?.purchasePrice,
      // Never reuse a previously recorded manual price, source or date.
      currentNewPrice: selectedOffer?.price,
      checkedAt: selectedOffer ? search?.checkedAt.slice(0, 10) : undefined,
      source: selectedOffer?.url,
    },
  })
  if (!selectedOffer) {
    draft.priceSuggestion = null
    draft.priceSuggestionReason = reason
  }
  return { status: 'completed', identity, search, selectedOffer, draft, reason }
}

export async function searchNewPrice(product: Pick<ListingFacts, 'name' | 'brand' | 'modelName' | 'category'>): Promise<NewPriceSearch> {
  const { name, brand, modelName, category } = product
  const response = await fetch('/api/search-new-price', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ product: { name, brand, modelName, category } }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new ListingGenerationError(result?.error || '신품가격 검색에 실패했습니다.', response.status)
  if (!Array.isArray(result?.offers) || typeof result.checkedAt !== 'string') throw new ListingGenerationError('가격 검색 응답 형식이 올바르지 않습니다.')
  return result as NewPriceSearch
}

export class ListingGenerationError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ListingGenerationError'
    this.status = status
  }
}

export async function generateListing(facts: ListingFacts): Promise<ListingDraft> {
  let response: Response
  try {
    response = await fetch('/api/generate-listing', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ product: facts }),
    })
  } catch {
    throw new ListingGenerationError('AI API에 연결할 수 없습니다. 배포된 백엔드 설정을 확인해주세요.')
  }

  const result = await response.json().catch(() => null) as Partial<ListingDraft> & { error?: string } | null
  if (!response.ok) {
    throw new ListingGenerationError(result?.error || `AI 요청이 실패했습니다. (${response.status})`, response.status)
  }
  if (typeof result?.title !== 'string' || typeof result.description !== 'string') {
    throw new ListingGenerationError('AI 응답 형식이 올바르지 않습니다.')
  }
  const priceSuggestion = result.priceSuggestion && typeof result.priceSuggestion === 'object'
    ? result.priceSuggestion as PriceSuggestion
    : null

  return {
    title: result.title,
    description: result.description,
    priceSuggestion,
    priceSuggestionReason: typeof result.priceSuggestionReason === 'string' ? result.priceSuggestionReason : '',
  }
}
