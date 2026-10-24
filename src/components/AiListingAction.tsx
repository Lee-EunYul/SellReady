import { useEffect, useRef, useState } from 'react'
import { generateAutomaticValuation, generateListing, isValidNewPriceOffer, ListingGenerationError } from '../services/listingGenerator'
import type { AutomaticValuationOutcome, ListingFacts, ListingDraft, ValuationStage } from '../services/listingGenerator'
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
  if (!Number.isFinite(start.getTime())) return '구매일 확인 필요'
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
    const issuePhotos = Object.entries(product.checks).flatMap(([item, status]) =>
      status === '사용감 있음' || status === '문제 있음'
        ? (product.checkImages[item] ?? []).map((dataUrl, index) => ({ label: `${item} ${status} 증빙 사진 ${index + 1}`, dataUrl }))
        : [])
    const generalPhotos = product.imageDataUrls.map((dataUrl, index) => ({ label: `제품 전체 사진 ${index + 1}`, dataUrl }))
    // Prefer one general photo + one recorded issue; otherwise allow two general photos.
    images.push(...[...generalPhotos.slice(0, 1), ...issuePhotos, ...generalPhotos.slice(1)].slice(0, 2))
  }

  return {
    name: product.name, brand: product.brand, modelName: product.modelName, category: product.category,
    purchaseDate: product.purchaseDate, usageDuration: getUsageDuration(product.purchaseDate),
    condition: product.condition, components: product.components, checkedItems, issues,
    priceInputs: includePriceInputs ? { purchasePrice: product.purchasePrice > 0 ? product.purchasePrice : undefined } : null,
    images,
  }
}

const stageLabels: Record<ValuationStage, string> = {
  identify: '1/3 제품 식별 중…',
  search: '2/3 신품가격 검색 중…',
  value: '3/3 중고 참고가격 분석·판매글 생성 중…',
}

export function AiListingAction({ product, onGenerated }: { product: ProductFactsSource; onGenerated: (draft: ListingDraft) => void }) {
  // Reset only when source facts change, not when the parent saves the generated draft.
  const factsKey = JSON.stringify(toListingFacts(product, true, true))
  return <AiListingActionForm key={factsKey} product={product} onGenerated={onGenerated} />
}

function AiListingActionForm({ product, onGenerated }: { product: ProductFactsSource; onGenerated: (draft: ListingDraft) => void }) {
  const [includePhotos, setIncludePhotos] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [stage, setStage] = useState<ValuationStage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requiresSignIn, setRequiresSignIn] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<AutomaticValuationOutcome | null>(null)
  const [draft, setDraft] = useState<ListingDraft | null>(null)
  // The keyed form unmounts on source edits; ignore its in-flight results and later stages.
  const requestId = useRef(0)
  useEffect(() => () => { requestId.current += 1 }, [])

  async function handleGenerate(automatic: boolean) {
    if (isGenerating) return
    const id = ++requestId.current
    setIsGenerating(true)
    setError(null)
    setMessage(null)
    setOutcome(null)
    setDraft(null)
    setRequiresSignIn(false)
    setAccessDenied(false)
    setStage(automatic ? 'identify' : null)
    try {
      const facts = toListingFacts(product, automatic, includePhotos)
      let generated: ListingDraft | null
      if (automatic) {
        const result = await generateAutomaticValuation(facts, (nextStage) => {
          if (id !== requestId.current) throw new Error('제품 정보가 변경되었습니다.')
          setStage(nextStage)
        })
        if (id !== requestId.current) return
        setOutcome(result)
        if (result.status === 'needs_details') {
          setMessage(result.reason || '제품명 또는 모델 라벨 사진을 보완해주세요. 가격 검색과 판매글 생성은 진행하지 않았습니다.')
          return
        }
        generated = result.draft
      } else {
        generated = await generateListing(facts)
        // Standalone listing never depends on recorded prices or an AI price guess.
        generated = { ...generated, priceSuggestion: null, priceSuggestionReason: '' }
      }
      if (id !== requestId.current || !generated) return
      setDraft(generated)
      onGenerated(generated)
      setMessage('AI 판매글 초안을 만들었습니다. 제품·옵션·가격·하자 내용을 검토하고 수정해주세요.')
    } catch (cause) {
      if (id !== requestId.current) return
      const failure = cause instanceof ListingGenerationError ? cause : new ListingGenerationError('AI 요청에 연결하지 못했습니다. 잠시 후 다시 시도해주세요. 판매글만 생성도 이용할 수 있습니다.')
      setError(failure.message)
      setRequiresSignIn(failure.status === 401 || failure.status === 403)
      setAccessDenied(failure.status === 403)
    } finally {
      if (id === requestId.current) {
        setIsGenerating(false)
        setStage(null)
      }
    }
  }

  const identity = outcome?.identity
  const search = outcome?.search
  const selectedOffer = outcome?.selectedOffer
  const priceSuggestion = draft?.priceSuggestion
  const noPriceReason = outcome?.reason || draft?.priceSuggestionReason
  const hasIdentityInput = Boolean(product.name.trim() || (includePhotos && toListingFacts(product, false, true).images?.length))

  return (
    <section className="ai-listing-action" aria-label="AI 자동 가격 분석 및 판매글 생성" aria-busy={isGenerating}>
      <div className="ai-listing-heading">
        <strong>제품 식별부터 가격 분석·판매글까지 한 번에</strong>
        <p>사진 또는 제품명으로 식별 → 신품가 검색 → 구매일·사용기간·상태·하자를 반영한 중고 참고가격과 판매글 생성</p>
        <p>식별에는 제품명·브랜드·모델명·카테고리와 선택한 사진만 전송합니다. 식별된 제품명·모델 정보는 외부 웹 검색에 전송되며, 구매정보와 사진은 외부 가격 검색에 보내지 않습니다.</p>
        <p>판매글·가격 분석 AI에는 구매일·사용기간·상태·점검결과·구성품 및 입력된 구매가(선택 정보)를 전송합니다. 사진은 아래 동의 시에만 식별·판매글 AI에 최대 2장 전송합니다. 개인 메모는 전송하지 않습니다.</p>
        <p>AI·검색 도구 사용에 추가 비용이 발생할 수 있습니다. 검색 결과는 캐시·검색 색인 기반으로 실시간 재고나 결제가격을 보장하지 않습니다.</p>
      </div>
      <div className="ai-consent-options">
        <label><input type="checkbox" checked={includePhotos} disabled={isGenerating} onChange={(event) => setIncludePhotos(event.target.checked)} /> 사진 전송에 동의 (제품 식별·외관 참고, 최대 2장)</label>
      </div>
      <button className="primary-button" type="button" onClick={() => void handleGenerate(true)} disabled={isGenerating || !hasIdentityInput}>
        {isGenerating && stage ? stageLabels[stage] : '동의하고 자동 가격 분석·판매글 생성'}
      </button>
      {!hasIdentityInput && <p className="ai-message">제품명을 입력하거나 사진을 등록한 뒤 사진 전송에 동의해주세요. 모델명 직접 입력은 필수가 아닙니다.</p>}
      <button className="ai-search-button ai-listing-only" type="button" disabled={isGenerating} onClick={() => void handleGenerate(false)}>판매글만 생성</button>
      <p className="ai-secondary-note">판매글만 생성: 외부 가격 검색·가격 추정 없이 기록한 사실로 작성합니다. 구매가·신품가는 보내지 않습니다.</p>
      {isGenerating && <p className="ai-progress" role="status" aria-live="polite">{stage ? stageLabels[stage] : '기록한 사실로 판매글 생성 중…'}</p>}
      {identity && <div className="ai-identity-result">
        <strong>{identity.status === 'identified' ? '인식한 제품' : '제품 식별에 추가 정보가 필요합니다'}</strong>
        <p>{[identity.brand, identity.name, identity.modelName].filter(Boolean).join(' · ')}</p>
        {identity.reason && <p>{identity.reason}</p>}
        {identity.uncertainties.length > 0 && <><p>확인 필요 (모델·옵션을 직접 확인해주세요)</p><ul>{identity.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        {identity.visibleCondition.length > 0 && <><p>사진의 잠정 관찰 · 확인된 하자가 아니며 판매글의 하자로 자동 추가하지 않습니다.</p><ul>{identity.visibleCondition.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      </div>}
      {search && <div className="ai-price-search">
        <strong>신품가격 검색 결과</strong>
        <p>검색 조회 시각: {Number.isFinite(Date.parse(search.checkedAt)) ? new Date(search.checkedAt).toLocaleString('ko-KR') : search.checkedAt} · 판매처 실시간 확인 시각이 아닙니다.</p>
        <p>{search.disclaimer}</p>
        {search.reason && <p>{search.reason}</p>}
        {selectedOffer && <p className="ai-selected-price">검색 후보 중 최저 표시가격 기준: {selectedOffer.price.toLocaleString('ko-KR')}원 · {selectedOffer.seller}. 동일 모델·용량·옵션·배송비·할인 조건은 판매처에서 직접 확인해주세요. 전체 시장 최저가는 아닙니다.</p>}
        <ul className="ai-price-offers">{search.offers.filter(isValidNewPriceOffer).map((offer, index) => <li key={`${offer.url}-${index}`}>
          <strong>{offer.price.toLocaleString('ko-KR')}원 · {offer.seller}{selectedOffer === offer ? ' · 자동 선택' : ''}</strong>
          <a href={offer.url} target="_blank" rel="noopener noreferrer">{offer.title} · 판매처 확인 ↗</a>
          {offer.note && <p>{offer.note}</p>}
        </li>)}</ul>
      </div>}
      {priceSuggestion && <div className="ai-price-suggestion">
        <span>AI 중고 참고가격 · {priceSuggestion.confidence === 'high' ? 'AI 근거 수준: 높음' : priceSuggestion.confidence === 'medium' ? 'AI 근거 수준: 보통' : '신뢰도 낮음'}</span>
        <strong>{priceSuggestion.low.toLocaleString('ko-KR')}원 ~ {priceSuggestion.high.toLocaleString('ko-KR')}원</strong>
        <p>추천 시작가 {priceSuggestion.recommended.toLocaleString('ko-KR')}원 · {priceSuggestion.basis}</p>
        <small>{priceSuggestion.disclaimer}</small>
        <small>실제 중고 거래 완료 시세가 아닌 제한된 신품 검색 후보와 자가점검 기반의 낮은 확실성 추정입니다. AI 근거 수준과 관계없이 실제 판매가격·품질을 보장하지 않으며 최종 가격은 직접 결정해주세요.</small>
      </div>}
      {noPriceReason && outcome?.status !== 'needs_details' && <p className="ai-message" role="status">가격 제안 생략: {noPriceReason}</p>}
      {message && <p className="ai-message" role="status">{message}</p>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      {requiresSignIn && !accessDenied && <a className="ai-signin-link" href="/.auth/login/aad?post_login_redirect_uri=%2F">Microsoft 계정으로 로그인</a>}
      {accessDenied && <a className="ai-signin-link" href="/.auth/logout?post_logout_redirect_uri=%2F">다른 Microsoft 계정으로 다시 로그인</a>}
    </section>
  )
}
