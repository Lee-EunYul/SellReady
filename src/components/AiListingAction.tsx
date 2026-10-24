import { useState } from 'react'
import { generateListing, ListingGenerationError } from '../services/listingGenerator'
import type { ListingFacts, ListingDraft } from '../services/listingGenerator'
import './AiListingAction.css'

type ProductFactsSource = {
  name: string
  brand: string
  modelName: string
  category: string
  purchaseDate: string
  condition: string
  components: string
  checks: Record<string, string>
  checkNotes: Record<string, string>
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

function toListingFacts(product: ProductFactsSource): ListingFacts {
  const checkedItems = Object.entries(product.checks)
    .filter(([, status]) => status === '정상')
    .map(([item]) => item)
  const issues = Object.entries(product.checks)
    .filter(([, status]) => status === '사용감 있음' || status === '문제 있음')
    .map(([item, status]) => `${item}: ${status}${product.checkNotes[item] ? ` (${product.checkNotes[item]})` : ''}`)

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
  }
}

export function AiListingAction({ product, onGenerated }: { product: ProductFactsSource; onGenerated: (draft: ListingDraft) => void }) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresSignIn, setRequiresSignIn] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleGenerate() {
    setIsGenerating(true)
    setError(null)
    setMessage(null)
    setRequiresSignIn(false)
    setAccessDenied(false)

    try {
      const draft = await generateListing(toListingFacts(product))
      onGenerated(draft)
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
      <div>
        <strong>AI 판매글 작성</strong>
        <p>기록된 제품 정보와 점검 결과만 사용합니다. 구매가격과 개인 메모는 전송하지 않습니다.</p>
      </div>
      <button className="primary-button" type="button" onClick={() => void handleGenerate()} disabled={isGenerating}>
        {isGenerating ? '생성 중…' : 'AI로 판매글 생성'}
      </button>
      {message && <p className="ai-message" role="status">{message}</p>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      {requiresSignIn && !accessDenied && <a className="ai-signin-link" href="/.auth/login/aad?post_login_redirect_uri=%2F">Microsoft 계정으로 로그인</a>}
      {accessDenied && <a className="ai-signin-link" href="/.auth/logout?post_logout_redirect_uri=%2F">다른 Microsoft 계정으로 다시 로그인</a>}
    </section>
  )
}
