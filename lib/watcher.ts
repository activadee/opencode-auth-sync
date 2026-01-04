import chokidar from "chokidar"
import { readFile } from "fs/promises"
import type { OpenCodeAuth } from "./types"

export interface WatcherCallbacks {
  onCredentialsChange: (credentials: OpenCodeAuth, raw: string) => void
  onError: (error: Error) => void
}

export function watchCredentials(
  credentialsPath: string,
  callbacks: WatcherCallbacks,
  debounceMs: number = 1000
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let lastContent: string | null = null

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

      if (content === lastContent) {
        return
      }
      lastContent = content

      const credentials = JSON.parse(content) as OpenCodeAuth
      callbacks.onCredentialsChange(credentials, content)
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
