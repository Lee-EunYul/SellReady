import { app } from '@azure/functions'
import dotenv from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSearchNewPriceHandler } from '../priceSearchLogic.js'

// Same repository-root dotenv pattern as the existing listing handler; Azure's
// injected settings take precedence. Suppress dotenv's startup output.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(repositoryRoot, '.env'), quiet: true })

app.http('searchNewPrice', {
  methods: ['POST'],
  authLevel: 'anonymous', // SWA protects /api/*; the handler also validates its trusted principal.
  route: 'search-new-price',
  handler: createSearchNewPriceHandler(),
})