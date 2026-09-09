import {
  listDirChildren,
  searchProjectFiles,
  type ProjectDirPage,
  type ProjectFileSearchPage,
} from "@/lib/sources"
import { perfOperation, type PerfCacheState } from "@/lib/fleet/perf"

const MAX_BYTES_PER_ROOT = 2 * 1024 * 1024

interface CachedPage<T> {
  root: string
  value: T
  bytes: number
  touchedAt: number
}

export interface ProjectPageResult<T> {
  page: T
  cache: PerfCacheState
  generation: number
}

const directoryCache = new Map<string, CachedPage<ProjectDirPage>>()
const searchCache = new Map<string, CachedPage<ProjectFileSearchPage>>()
interface InFlightPage {
  root: string
  promise: Promise<ProjectPageResult<unknown>>
}

const inFlight = new Map<string, InFlightPage>()
const generations = new Map<string, number>()
const revisions = new Map<string, string>()
const latestRevisionRequest = new Map<string, number>()
let requestSequence = 0

function generationOf(root: string): number {
  return generations.get(root) ?? 0
}

function key(parts: readonly unknown[]): string {
  return JSON.stringify(parts)
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function cacheBytesFor(root: string): number {
  let total = 0
  for (const [, item] of [...directoryCache, ...searchCache]) {
    if (item.root === root) total += item.bytes
  }
  return total
}

function evictRoot(root: string): void {
  const candidates = [...directoryCache.entries(), ...searchCache.entries()]
    .filter(([, item]) => item.root === root)
    .sort((left, right) => left[1].touchedAt - right[1].touchedAt)
  let bytes = cacheBytesFor(root)
  for (const [cacheKey, item] of candidates) {
    if (bytes <= MAX_BYTES_PER_ROOT) break
    directoryCache.delete(cacheKey)
    searchCache.delete(cacheKey)
    bytes -= item.bytes
  }
}

function clearRoot(root: string): void {
  for (const [cacheKey, item] of directoryCache) {
    if (item.root === root) directoryCache.delete(cacheKey)
  }
  for (const [cacheKey, item] of searchCache) {
    if (item.root === root) searchCache.delete(cacheKey)
  }
}

function remember<T extends ProjectDirPage | ProjectFileSearchPage>(
  root: string,
  cache: Map<string, CachedPage<T>>,
  cacheKey: string,
  value: T,
  requestId: number,
): number {
  const previousRevision = revisions.get(root)
  const latestRequest = latestRevisionRequest.get(root) ?? 0
  if (
    previousRevision &&
    previousRevision !== value.rootRevision &&
    requestId < latestRequest
  ) {
    // Sentinela que nenhum `projectFilesGeneration` válido pode assumir. O
    // consumidor descarta a resposta velha sem apagar o cache mais recente.
    return -1
  }
  if (previousRevision && previousRevision !== value.rootRevision) {
    clearRoot(root)
    generations.set(root, generationOf(root) + 1)
  }
  revisions.set(root, value.rootRevision)
  latestRevisionRequest.set(root, Math.max(latestRequest, requestId))
  cache.set(cacheKey, {
    root,
    value,
    bytes: encodedBytes(value),
    touchedAt: Date.now(),
  })
  evictRoot(root)
  return generationOf(root)
}

function cached<T>(cache: Map<string, CachedPage<T>>, cacheKey: string): T | null {
  const found = cache.get(cacheKey)
  if (!found) return null
  found.touchedAt = Date.now()
  return found.value
}

async function singleFlight<T>(
  root: string,
  cacheKey: string,
  start: () => Promise<ProjectPageResult<T>>,
): Promise<ProjectPageResult<T>> {
  const current = inFlight.get(cacheKey)
  if (current) return current.promise as Promise<ProjectPageResult<T>>
  const promise = start().finally(() => {
    if (inFlight.get(cacheKey)?.promise === promise) inFlight.delete(cacheKey)
  })
  inFlight.set(cacheKey, {
    root,
    promise: promise as Promise<ProjectPageResult<unknown>>,
  })
  return promise
}

export async function loadProjectDirectory(input: {
  root: string
  relPath?: string
  cursor?: string | null
  limit?: number
}): Promise<ProjectPageResult<ProjectDirPage>> {
  const relPath = input.relPath ?? ""
  const cursor = input.cursor ?? null
  const limit = input.limit ?? 200
  const cacheKey = key([input.root, "directory", relPath, cursor, limit])
  const hit = cached(directoryCache, cacheKey)
  if (hit) return { page: hit, cache: "hit", generation: generationOf(input.root) }
  return singleFlight(input.root, cacheKey, async () => {
    const generation = generationOf(input.root)
    const requestId = ++requestSequence
    const finish = perfOperation("files.root.request", { cache: "miss" })
    try {
      const page = await listDirChildren({ ...input, relPath, cursor, limit })
      const resultGeneration =
        generation === generationOf(input.root)
          ? remember(input.root, directoryCache, cacheKey, page, requestId)
          : generation
      finish({
        outcome: resultGeneration < 0 ? "stale" : "ok",
        bytes: encodedBytes(page),
      })
      return { page, cache: "miss", generation: resultGeneration }
    } catch (error) {
      finish({ outcome: "error" })
      throw error
    }
  })
}

export async function searchProjectFileIndex(input: {
  root: string
  query: string
  cursor?: string | null
  limit?: number
}): Promise<ProjectPageResult<ProjectFileSearchPage>> {
  const normalizedQuery = input.query.trim().toLocaleLowerCase("pt-BR")
  const cursor = input.cursor ?? null
  const limit = input.limit ?? 80
  const cacheKey = key([input.root, "search", normalizedQuery, cursor, limit])
  const hit = cached(searchCache, cacheKey)
  if (hit) return { page: hit, cache: "hit", generation: generationOf(input.root) }
  return singleFlight(input.root, cacheKey, async () => {
    const generation = generationOf(input.root)
    const requestId = ++requestSequence
    const finish = perfOperation("files.search.request", { cache: "miss" })
    try {
      const page = await searchProjectFiles({
        ...input,
        query: normalizedQuery,
        cursor,
        limit,
      })
      const resultGeneration =
        generation === generationOf(input.root)
          ? remember(input.root, searchCache, cacheKey, page, requestId)
          : generation
      finish({
        outcome: resultGeneration < 0 ? "stale" : "ok",
        bytes: encodedBytes(page),
      })
      return { page, cache: "miss", generation: resultGeneration }
    } catch (error) {
      finish({ outcome: "error" })
      throw error
    }
  })
}

export function invalidateProjectFiles(root: string): number {
  clearRoot(root)
  revisions.delete(root)
  latestRevisionRequest.delete(root)
  for (const [cacheKey, flight] of inFlight) {
    if (flight.root === root) inFlight.delete(cacheKey)
  }
  const generation = generationOf(root) + 1
  generations.set(root, generation)
  return generation
}

export function projectFilesGeneration(root: string): number {
  return generationOf(root)
}

export function _resetProjectFilesServiceForTests(): void {
  directoryCache.clear()
  searchCache.clear()
  inFlight.clear()
  generations.clear()
  revisions.clear()
  latestRevisionRequest.clear()
  requestSequence = 0
}
