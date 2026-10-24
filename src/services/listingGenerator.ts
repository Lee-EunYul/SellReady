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
}

export type ListingDraft = {
  title: string
  description: string
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

  return { title: result.title, description: result.description }
}
