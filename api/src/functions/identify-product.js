import { app } from '@azure/functions'
import dotenv from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createIdentifyProductHandler } from '../identityLogic.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(repositoryRoot, '.env'), quiet: true })

app.http('identifyProduct', {
  methods: ['POST'],
  authLevel: 'anonymous', // SWA protects /api/*; the handler also validates its trusted principal.
  route: 'identify-product',
  handler: createIdentifyProductHandler(),
})