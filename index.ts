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
  let isFirstSync = true
  let currentConfig: AuthSyncConfig = { ...config }
  let stopWatching: (() => void) | null = null

  const persistHash = async (hash: string) => {
    if (!configPath) return

    try {
      currentConfig = { ...currentConfig, authFileHash: hash }
      await saveConfig(configPath, currentConfig)
    } catch {
      showToast("Could not save config hash, sync will work but may repeat on restart", "warning", 3000)
    }
  }

  const handleCredentialsChange = async (_credentials: OpenCodeAuth, raw: string, hash: string) => {
    const action = isFirstSync ? "Initial sync" : "Syncing"
    showToast(`${action} to ${config.repositories.length} repo(s)...`, "info", 2000)

    const summary = await syncToRepositories($, config.repositories, config.secretName, raw)

    if (summary.failed === 0) {
      showToast(`Synced to ${summary.successful} repo(s)`, "success", 3000)
      await persistHash(hash)
    } else {
      const failedRepos = summary.results
        .filter((r) => !r.success)
        .map((r) => r.repository)
        .join(", ")
      showToast(`${summary.successful} synced, ${summary.failed} failed: ${failedRepos}`, "warning", 5000)
    }

    isFirstSync = false
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
      storedHash: config.authFileHash,
    }
  )

  return {}
}

export default OpenCodeAuthSyncPlugin
