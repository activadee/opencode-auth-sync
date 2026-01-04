import { readFile, writeFile } from "fs/promises"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { AuthSyncConfig } from "./types"

export const DEFAULT_CONFIG: AuthSyncConfig = {
  enabled: true,
  credentialsPath: "~/.local/share/opencode/auth.json",
  secretName: "OPENCODE_AUTH_JSON",
  repositories: [],
  debounceMs: 1000,
}

export function loadPluginConfigSync(configPath: string): Partial<AuthSyncConfig> {
  if (!existsSync(configPath)) {
    return {}
  }
  try {
    const content = readFileSync(configPath, "utf-8")
    return JSON.parse(content) as Partial<AuthSyncConfig>
  } catch {
    return {}
  }
}

export function mergeConfig(
  existing: Partial<AuthSyncConfig>,
  updates: Partial<AuthSyncConfig>
): AuthSyncConfig {
  return {
    ...DEFAULT_CONFIG,
    ...existing,
    ...updates,
  }
}

export async function loadConfig(projectDir?: string): Promise<AuthSyncConfig> {
  const locations = [
    projectDir && join(projectDir, "opencode-auth-sync.json"),
    join(homedir(), ".config", "opencode", "opencode-auth-sync.json"),
  ].filter(Boolean) as string[]

  for (const configPath of locations) {
    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, "utf-8")
        const userConfig = JSON.parse(content) as Partial<AuthSyncConfig>
        return { ...DEFAULT_CONFIG, ...userConfig }
      } catch {
        continue
      }
    }
  }

  return DEFAULT_CONFIG
}

export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1))
  }
  return path
}

export function getConfigPath(projectDir?: string): string | null {
  const locations = [
    projectDir && join(projectDir, "opencode-auth-sync.json"),
    join(homedir(), ".config", "opencode", "opencode-auth-sync.json"),
  ].filter(Boolean) as string[]

  for (const configPath of locations) {
    if (existsSync(configPath)) {
      return configPath
    }
  }

  return null
}

export async function saveConfig(
  configPath: string,
  config: Partial<AuthSyncConfig>
): Promise<void> {
  const content = JSON.stringify(config, null, 2)
  await writeFile(configPath, content, "utf-8")
}
