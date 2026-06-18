#!/usr/bin/env node
// Back-compat shim. The engine is now provider-abstracted in mnemazine-llm.mjs
// (Claude primary, Codex parity). This file keeps the old codex-named exports
// working; it always targets the codex provider.
import { llmJson, llmAvailable, fenceUntrusted } from './mnemazine-llm.mjs'

export { fenceUntrusted }
export function codexAvailable() {
  return llmAvailable('codex')
}
export async function codexJson(prompt, schema, opts = {}) {
  return llmJson(prompt, schema, { ...opts, provider: 'codex' })
}
