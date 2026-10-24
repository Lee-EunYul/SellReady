import { app } from '@azure/functions'
import dotenv from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorizeStaticWebAppsPrincipal, buildAzureOpenAIRequest, extractAzureOpenAIText, parseListingResponse, sanitizeProductFacts } from '../listingLogic.js'

// Locally read the repository-root .env regardless of the Functions host working directory.
// Azure settings are injected by Static Web Apps and take precedence over this optional file.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(repositoryRoot, '.env') })

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
})
const requestWindows = new Map()
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60_000

function isRateLimited(email, now = Date.now()) {
  const timestamps = (requestWindows.get(email) ?? []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS)
  if (timestamps.length >= RATE_LIMIT) {
    requestWindows.set(email, timestamps)
    return true
  }
  timestamps.push(now)
  requestWindows.set(email, timestamps)
  return false
}

app.http('generateListing', {
  methods: ['POST'],
  authLevel: 'anonymous', // Azure Static Web Apps route authorization protects /api/*.
  route: 'generate-listing',
  handler: async (request, context) => {
    const authorization = authorizeStaticWebAppsPrincipal(
      request.headers.get('x-ms-client-principal'),
      process.env.AZURE_OPENAI_ALLOWED_EMAILS,
    )
    if (authorization.error) return jsonResponse(authorization.status, { error: authorization.error })
    if (isRateLimited(authorization.email)) return jsonResponse(429, { error: '분당 AI 요청 한도(5회)에 도달했습니다. 잠시 후 다시 시도해주세요.' })

    let rawBody
    try {
      rawBody = await request.text()
    } catch {
      return jsonResponse(400, { error: '요청 본문을 읽지 못했습니다.' })
    }
    if (rawBody.length > 6_200_000) return jsonResponse(413, { error: '요청이 너무 큽니다. 사진 수를 줄이거나 더 작은 사진을 사용해주세요.' })

    let body
    try { body = JSON.parse(rawBody) } catch { return jsonResponse(400, { error: 'JSON 요청 본문이 필요합니다.' }) }

    let product
    try {
      product = sanitizeProductFacts(body?.product)
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : '제품 정보가 올바르지 않습니다.' })
    }

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim()
    const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim()
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim()
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() || '2024-10-21'

    if (!endpoint || !apiKey || !deployment) {
      context.warn('Azure OpenAI server settings are incomplete.')
      return jsonResponse(503, { error: 'Azure OpenAI 서버 설정이 아직 완료되지 않았습니다.' })
    }

    let requestConfig
    try {
      requestConfig = buildAzureOpenAIRequest(endpoint, deployment, apiVersion, product)
    } catch {
      return jsonResponse(503, { error: 'Azure OpenAI endpoint 설정을 확인해주세요.' })
    }

    try {
      const upstream = await fetch(requestConfig.url, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify(requestConfig.body),
      })

      if (!upstream.ok) {
        context.warn(`Azure OpenAI returned status ${upstream.status}.`)
        const status = upstream.status === 429 ? 429 : 502
        return jsonResponse(status, {
          error: upstream.status === 429
            ? 'AI 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.'
            : 'Azure OpenAI 요청이 실패했습니다. 배포 이름과 서버 설정을 확인해주세요.',
        })
      }

      const result = await upstream.json()
      const content = extractAzureOpenAIText(result)
      return jsonResponse(200, parseListingResponse(content))
    } catch (error) {
      context.warn(`Listing generation failed (${error instanceof Error ? error.name : 'unknown error'}).`)
      if (error instanceof TypeError) return jsonResponse(502, { error: 'AI 응답을 판매글로 변환하지 못했습니다. 다시 시도해주세요.' })
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return jsonResponse(504, { error: 'AI 응답 시간이 초과되었습니다. 다시 시도해주세요.' })
      }
      return jsonResponse(502, { error: 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' })
    }
  },
})
