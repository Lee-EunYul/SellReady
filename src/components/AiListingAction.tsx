import { useState } from 'react'
import { generateListing, ListingGenerationError } from '../services/listingGenerator'
import type { ListingFacts, ListingDraft, PriceSuggestion } from '../services/listingGenerator'
import './AiListingAction.css'

type ProductFactsSource = {
  name: string
  brand: string
  modelName: string
  category: string
  purchaseDate: string
  condition: string
  components: string
  purchasePrice: number
  currentPrice?: number
  priceSource?: string
  currentPriceCheckedAt?: string
  imageDataUrls: string[]
  checks: Record<string, string>
  checkNotes: Record<string, string>
  checkImages: Record<string, string[]>
}

function getUsageDuration(purchaseDate: string) {
  const start = new Date(`${purchaseDate}T00:00:00`)
  const today = new Date()
  let months = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth()
  if (today.getDate() < start.getDate()) months -= 1
  if (months < 0) return '아직 사용 전'
  const years = Math.floor(months / 12)
  return years ? `${years}년 ${months % 12}개월` : `${months}개월`
}

function toListingFacts(product: ProductFactsSource, includePriceInputs: boolean, includePhotos: boolean): ListingFacts {
  const checkedItems = Object.entries(product.checks)
    .filter(([, status]) => status === '정상')
    .map(([item]) => item)
  const issues = Object.entries(product.checks)
    .filter(([, status]) => status === '사용감 있음' || status === '문제 있음')
    .map(([item, status]) => `${item}: ${status}${product.checkNotes[item] ? ` (${product.checkNotes[item]})` : ''}`)

  const images: NonNullable<ListingFacts['images']> = []
  if (includePhotos) {
    product.imageDataUrls.slice(0, 1).forEach((dataUrl, index) => images.push({ label: `제품 전체 사진 ${index + 1}`, dataUrl }))
    for (const [item, status] of Object.entries(product.checks)) {
      if (status !== '사용감 있음' && status !== '문제 있음') continue
      for (const [index, dataUrl] of (product.checkImages[item] ?? []).entries()) {
        if (images.length >= 2) break
        images.push({ label: `${item} ${status} 증빙 사진 ${index + 1}`, dataUrl })
      }
      if (images.length >= 2) break
    }
  }

  return {
    name: product.name,
    brand: product.brand,
    modelName: product.modelName,
    category: product.category,
    purchaseDate: product.purchaseDate,
    usageDuration: getUsageDuration(product.purchaseDate),
    condition: product.condition,
    components: product.components,
    checkedItems,
    issues,
    priceInputs: includePriceInputs ? {
      purchasePrice: product.purchasePrice,
      currentNewPrice: product.currentPrice,
      checkedAt: product.currentPriceCheckedAt,
      source: product.priceSource,
    } : null,
    images,
  }
}

export function AiListingAction({ product, onGenerated }: { product: ProductFactsSource; onGenerated: (draft: ListingDraft) => void }) {
  const [includePriceInputs, setIncludePriceInputs] = useState(false)
  const [includePhotos, setIncludePhotos] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresSignIn, setRequiresSignIn] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [priceSuggestion, setPriceSuggestion] = useState<PriceSuggestion | null>(null)
  const [priceSuggestionReason, setPriceSuggestionReason] = useState('')

  async function handleGenerate() {
    setIsGenerating(true)
    setError(null)
    setMessage(null)
    setPriceSuggestion(null)
    setPriceSuggestionReason('')
    setRequiresSignIn(false)
    setAccessDenied(false)

    try {
      const draft = await generateListing(toListingFacts(product, includePriceInputs, includePhotos))
      onGenerated(draft)
      setPriceSuggestion(draft.priceSuggestion)
      setPriceSuggestionReason(draft.priceSuggestionReason)
      setMessage('AI 판매글 초안을 만들었습니다. 내용을 검토하고 수정해주세요.')
    } catch (cause) {
      const requestError = cause instanceof ListingGenerationError ? cause : new ListingGenerationError('AI 판매글을 생성하지 못했습니다.')
      setError(requestError.message)
      setRequiresSignIn(requestError.status === 401 || requestError.status === 403)
      setAccessDenied(requestError.status === 403)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <section className="ai-listing-action" aria-label="AI 판매글 생성">
      <div className="ai-listing-heading">
        <strong>AI 판매글 작성</strong>
        <p>점검한 사실만 사용합니다. AI 요청에는 개인 메모를 포함하지 않습니다.</p>
      </div>
      <div className="ai-consent-options">
        <label><input type="checkbox" checked={includePriceInputs} onChange={(event) => setIncludePriceInputs(event.target.checked)} /> 참고 가격 제안 (구매가·현재 신품가 전송)</label>
        <label><input type="checkbox" checked={includePhotos} onChange={(event) => setIncludePhotos(event.target.checked)} /> 사진으로 외관 참고 (최대 2장 전송)</label>
      </div>
      <button className="primary-button" type="button" onClick={() => void handleGenerate()} disabled={isGenerating}>
        {isGenerating ? '생성 중…' : 'AI로 판매글 생성'}
      </button>
      {priceSuggestion && <div className="ai-price-suggestion"><span>AI 참고 가격대 · {priceSuggestion.confidence === 'high' ? '근거 충분' : priceSuggestion.confidence === 'medium' ? '참고 수준' : '불확실성 높음'}</span><strong>{priceSuggestion.low.toLocaleString('ko-KR')}원 ~ {priceSuggestion.high.toLocaleString('ko-KR')}원</strong><p>추천 시작가 {priceSuggestion.recommended.toLocaleString('ko-KR')}원 · {priceSuggestion.basis}</p><small>{priceSuggestion.disclaimer}</small></div>}
      {priceSuggestionReason && <p className="ai-message" role="status">가격 제안 생략: {priceSuggestionReason}</p>}
      {message && <p className="ai-message" role="status">{message}</p>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      {requiresSignIn && !accessDenied && <a className="ai-signin-link" href="/.auth/login/aad?post_login_redirect_uri=%2F">Microsoft 계정으로 로그인</a>}
      {accessDenied && <a className="ai-signin-link" href="/.auth/logout?post_logout_redirect_uri=%2F">다른 Microsoft 계정으로 다시 로그인</a>}
    </section>
  )
}
