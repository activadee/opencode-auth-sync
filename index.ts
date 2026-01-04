import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { loadConfig, expandPath, getConfigPath, saveConfig } from "./lib/config"
import { watchCredentials } from "./lib/watcher"
import { syncToRepositories, verifyGhAuth } from "./lib/sync"
import type { AuthSyncConfig, OpenCodeAuth } from "./lib/types"

const PLUGIN_NAME = "opencode-auth-sync"

export const OpenCodeAuthSyncPlugin: Plugin = async ({ $, client, directory }: PluginInput) => {
  const config = await loadConfig(directory)

  const showToast = (
    message: string,
    variant: "info" | "success" | "warning" | "error",
    duration = 3000
  ) => {
    client.tui.showToast({
      body: {
        title: PLUGIN_NAME,
        message,
        variant,
        duration,
      },
    })
  }

  if (!config.enabled) {
    return {}
  }

  if (config.repositories.length === 0) {
    return {
      event: async ({ event }) => {
        if (event.type === "session.created") {
          showToast("No repositories configured in ~/.config/opencode/opencode-auth-sync.json", "warning", 5000)
        }
      },
    }
  }

  const ghAuthed = await verifyGhAuth($)
  if (!ghAuthed) {
    return {
      event: async ({ event }) => {
        if (event.type === "session.created") {
          showToast("GitHub CLI not authenticated. Run: gh auth login", "error", 8000)
        }
      },
    }
  }

  const credentialsPath = expandPath(config.credentialsPath)
  const configPath = getConfigPath(directory)
  let currentHashes: Record<string, string> = { ...config.authFileHashes }
  let stopWatching: (() => void) | null = null

  const persistHashes = async (hashes: Record<string, string>) => {
    if (!configPath) return

    try {
      currentHashes = { ...hashes }
      const updatedConfig: AuthSyncConfig = { ...config, authFileHashes: currentHashes }
      await saveConfig(configPath, updatedConfig)
    } catch {
      showToast("Could not save config, sync may repeat on restart", "warning", 3000)
    }
  }

  const handleCredentialsChange = async (_credentials: OpenCodeAuth, raw: string, hash: string) => {
    const reposNeedingSync = config.repositories.filter(
      (repo) => currentHashes[repo] !== hash
    )

    if (reposNeedingSync.length === 0) {
      return
    }

    const isInitialSync = Object.keys(currentHashes).length === 0
    const action = isInitialSync ? "Initial sync" : "Syncing"
    showToast(`${action} to ${reposNeedingSync.length} repo(s)...`, "info", 2000)

    const summary = await syncToRepositories($, reposNeedingSync, config.secretName, raw)

    const updatedHashes = { ...currentHashes }
    for (const result of summary.results) {
      if (result.success) {
        updatedHashes[result.repository] = hash
      } else {
        showToast(`Failed to sync to ${result.repository}: ${result.error}`, "error", 5000)
      }
    }

    if (summary.successful > 0) {
      await persistHashes(updatedHashes)
      showToast(`Synced to ${summary.successful} repo(s)`, "success", 3000)
    }
  }

  const handleError = async (error: Error) => {
    showToast(`Error: ${error.message}`, "error", 5000)
  }

  stopWatching = watchCredentials(
    credentialsPath,
    {
      onCredentialsChange: handleCredentialsChange,
      onError: handleError,
    },
    {
      debounceMs: config.debounceMs,
    }
  )

  return {}
}

export default OpenCodeAuthSyncPlugin
