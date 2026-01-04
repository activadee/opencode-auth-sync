import chokidar from "chokidar"
import { createHash } from "crypto"
import { readFile } from "fs/promises"
import type { OpenCodeAuth } from "./types"

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export interface WatcherCallbacks {
  onCredentialsChange: (credentials: OpenCodeAuth, raw: string, hash: string) => void
  onError: (error: Error) => void
}

export interface WatcherOptions {
  debounceMs?: number
  storedHash?: string
}

export function watchCredentials(
  credentialsPath: string,
  callbacks: WatcherCallbacks,
  options: WatcherOptions = {}
): () => void {
  const { debounceMs = 1000, storedHash } = options
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let lastHash: string | null = storedHash ?? null

  const watcher = chokidar.watch(credentialsPath, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  })

  const handleChange = async () => {
    try {
      const content = await readFile(credentialsPath, "utf-8")
      const currentHash = computeHash(content)

      if (currentHash === lastHash) {
        return
      }
      lastHash = currentHash

      const credentials = JSON.parse(content) as OpenCodeAuth
      callbacks.onCredentialsChange(credentials, content, currentHash)
    } catch (error) {
      callbacks.onError(error as Error)
    }
  }

  const debouncedHandler = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(handleChange, debounceMs)
  }

  watcher.on("change", debouncedHandler)
  watcher.on("add", debouncedHandler)
  watcher.on("error", callbacks.onError)

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    watcher.close()
  }
}
