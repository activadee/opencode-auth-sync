import { execSync } from "child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { verifyGithubToken, getGithubReposHttp } from "./github-http"
import type { GithubMethod } from "./types"

export const OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode")
export const OPENCODE_CONFIG_PATH = join(OPENCODE_CONFIG_DIR, "opencode.json")
export const PLUGIN_CONFIG_PATH = join(OPENCODE_CONFIG_DIR, "opencode-auth-sync.json")
export const PLUGIN_NAME = "@activade/opencode-auth-sync"

export interface GhRepo {
  nameWithOwner: string
  isPrivate: boolean
  description: string | null
}

export { verifyGithubToken, getGithubReposHttp }

export function checkGhCli(): boolean {
  try {
    execSync("gh --version", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function checkGhAuth(): boolean {
  try {
    execSync("gh auth status", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function getGhRepos(): GhRepo[] {
  try {
    const output = execSync(
      'gh repo list --limit 100 --json nameWithOwner,isPrivate,description',
      { encoding: "utf-8" }
    )
    return JSON.parse(output)
  } catch {
    return []
  }
}

export function loadOpencodeConfig(): Record<string, unknown> {
  if (!existsSync(OPENCODE_CONFIG_PATH)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(OPENCODE_CONFIG_PATH, "utf-8"))
  } catch {
    return {}
  }
}

export function saveOpencodeConfig(config: Record<string, unknown>): void {
  mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true })
  writeFileSync(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n")
}

export function isPluginInstalled(config: Record<string, unknown>): boolean {
  const plugins = (config.plugin as string[]) || []
  return plugins.some((p) => p.includes("opencode-auth-sync"))
}

export function addPluginToConfig(config: Record<string, unknown>): Record<string, unknown> {
  const plugins = (config.plugin as string[]) || []
  if (!isPluginInstalled(config)) {
    plugins.push(PLUGIN_NAME)
  }
  return { ...config, plugin: plugins }
}

export function validateSecretName(value: string): string | undefined {
  if (value && !/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    return "Use uppercase letters, numbers, and underscores only"
  }
  return undefined
}

export function savePluginConfig(
  configPath: string,
  config: Record<string, unknown>
): void {
  const dir = join(configPath, "..")
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}
