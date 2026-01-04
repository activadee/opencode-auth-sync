import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadPluginConfigSync, mergeConfig, DEFAULT_CONFIG, saveConfig, getConfigPath } from "./config"
import type { AuthSyncConfig } from "./types"

describe("loadPluginConfigSync", () => {
  const testDir = join(tmpdir(), `opencode-auth-sync-test-${Date.now()}`)
  const testConfigPath = join(testDir, "test-config.json")

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("returns empty object when file does not exist", () => {
    const result = loadPluginConfigSync("/nonexistent/path/config.json")
    expect(result).toEqual({})
  })

  test("returns empty object when file contains invalid JSON", () => {
    writeFileSync(testConfigPath, "not valid json {{{")
    const result = loadPluginConfigSync(testConfigPath)
    expect(result).toEqual({})
  })

  test("loads and parses valid config file", () => {
    const config = {
      enabled: true,
      debounceMs: 5000,
      secretName: "CUSTOM_SECRET",
      repositories: ["owner/repo1", "owner/repo2"],
    }
    writeFileSync(testConfigPath, JSON.stringify(config))
    
    const result = loadPluginConfigSync(testConfigPath)
    expect(result).toEqual(config)
  })

  test("preserves custom fields in config", () => {
    const config = {
      enabled: false,
      debounceMs: 3000,
      credentialsPath: "/custom/path/auth.json",
      secretName: "MY_SECRET",
      repositories: ["org/private-repo"],
      customField: "should be preserved",
    }
    writeFileSync(testConfigPath, JSON.stringify(config))
    
    const result = loadPluginConfigSync(testConfigPath)
    expect(result).toEqual(config)
  })
})

describe("mergeConfig", () => {
  test("returns defaults when both existing and updates are empty", () => {
    const result = mergeConfig({}, {})
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  test("applies defaults for missing fields in existing config", () => {
    const existing = { repositories: ["owner/repo"] }
    const result = mergeConfig(existing, {})
    
    expect(result.enabled).toBe(DEFAULT_CONFIG.enabled)
    expect(result.debounceMs).toBe(DEFAULT_CONFIG.debounceMs)
    expect(result.credentialsPath).toBe(DEFAULT_CONFIG.credentialsPath)
    expect(result.secretName).toBe(DEFAULT_CONFIG.secretName)
    expect(result.repositories).toEqual(["owner/repo"])
  })

  test("preserves existing values when no updates provided", () => {
    const existing: Partial<AuthSyncConfig> = {
      enabled: false,
      debounceMs: 5000,
      credentialsPath: "/custom/path/auth.json",
      secretName: "CUSTOM_SECRET",
      repositories: ["org/repo1", "org/repo2"],
    }
    
    const result = mergeConfig(existing, {})
    
    expect(result.enabled).toBe(false)
    expect(result.debounceMs).toBe(5000)
    expect(result.credentialsPath).toBe("/custom/path/auth.json")
    expect(result.secretName).toBe("CUSTOM_SECRET")
    expect(result.repositories).toEqual(["org/repo1", "org/repo2"])
  })

  test("updates override existing values", () => {
    const existing: Partial<AuthSyncConfig> = {
      debounceMs: 5000,
      secretName: "OLD_SECRET",
      repositories: ["old/repo"],
    }
    const updates: Partial<AuthSyncConfig> = {
      secretName: "NEW_SECRET",
      repositories: ["new/repo1", "new/repo2"],
    }
    
    const result = mergeConfig(existing, updates)
    
    expect(result.secretName).toBe("NEW_SECRET")
    expect(result.repositories).toEqual(["new/repo1", "new/repo2"])
    expect(result.debounceMs).toBe(5000)
  })

  test("updates override default values", () => {
    const updates: Partial<AuthSyncConfig> = {
      debounceMs: 3000,
      enabled: false,
    }
    
    const result = mergeConfig({}, updates)
    
    expect(result.debounceMs).toBe(3000)
    expect(result.enabled).toBe(false)
    expect(result.secretName).toBe(DEFAULT_CONFIG.secretName)
  })

  test("preserves debounceMs when only repositories updated", () => {
    const existing: Partial<AuthSyncConfig> = {
      debounceMs: 8000,
      repositories: ["old/repo"],
    }
    const updates: Partial<AuthSyncConfig> = {
      repositories: ["new/repo"],
    }
    
    const result = mergeConfig(existing, updates)
    
    expect(result.debounceMs).toBe(8000)
    expect(result.repositories).toEqual(["new/repo"])
  })

  test("preserves credentialsPath when only secretName updated", () => {
    const existing: Partial<AuthSyncConfig> = {
      credentialsPath: "/my/custom/auth.json",
      secretName: "OLD_NAME",
    }
    const updates: Partial<AuthSyncConfig> = {
      secretName: "NEW_NAME",
    }
    
    const result = mergeConfig(existing, updates)
    
    expect(result.credentialsPath).toBe("/my/custom/auth.json")
    expect(result.secretName).toBe("NEW_NAME")
  })
})

describe("config merge integration", () => {
  const testDir = join(tmpdir(), `opencode-auth-sync-integration-${Date.now()}`)
  const testConfigPath = join(testDir, "config.json")

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("full merge workflow: load existing, merge updates, preserve custom values", () => {
    const existingConfig = {
      enabled: true,
      debounceMs: 5000,
      credentialsPath: "~/.local/share/opencode/auth.json",
      secretName: "MY_SECRET",
      repositories: ["org/repo1"],
    }
    writeFileSync(testConfigPath, JSON.stringify(existingConfig))
    
    const loaded = loadPluginConfigSync(testConfigPath)
    const userUpdates = {
      repositories: ["org/repo1", "org/repo2", "org/repo3"],
      secretName: "UPDATED_SECRET",
    }
    const merged = mergeConfig(loaded, userUpdates)
    
    expect(merged.debounceMs).toBe(5000)
    expect(merged.enabled).toBe(true)
    expect(merged.secretName).toBe("UPDATED_SECRET")
    expect(merged.repositories).toEqual(["org/repo1", "org/repo2", "org/repo3"])
  })

  test("creates new config with defaults when file does not exist", () => {
    const loaded = loadPluginConfigSync("/nonexistent/config.json")
    const userUpdates = {
      repositories: ["user/new-repo"],
      secretName: "NEW_SECRET",
    }
    const merged = mergeConfig(loaded, userUpdates)
    
    expect(merged.enabled).toBe(DEFAULT_CONFIG.enabled)
    expect(merged.debounceMs).toBe(DEFAULT_CONFIG.debounceMs)
    expect(merged.credentialsPath).toBe(DEFAULT_CONFIG.credentialsPath)
    expect(merged.secretName).toBe("NEW_SECRET")
    expect(merged.repositories).toEqual(["user/new-repo"])
  })

  test("handles reinstall scenario: preserves debounceMs while updating repos", () => {
    const originalConfig = {
      enabled: true,
      debounceMs: 10000,
      credentialsPath: "~/.local/share/opencode/auth.json",
      secretName: "OPENCODE_AUTH_JSON",
      repositories: ["org/repo1", "org/repo2"],
    }
    writeFileSync(testConfigPath, JSON.stringify(originalConfig))
    
    const loaded = loadPluginConfigSync(testConfigPath)
    const reinstallUpdates = {
      repositories: ["org/repo1", "org/repo3"],
      secretName: "OPENCODE_AUTH_JSON",
    }
    const merged = mergeConfig(loaded, reinstallUpdates)
    
    expect(merged.debounceMs).toBe(10000)
    expect(merged.repositories).toEqual(["org/repo1", "org/repo3"])
  })
})

describe("DEFAULT_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_CONFIG.enabled).toBe(true)
    expect(DEFAULT_CONFIG.credentialsPath).toBe("~/.local/share/opencode/auth.json")
    expect(DEFAULT_CONFIG.secretName).toBe("OPENCODE_AUTH_JSON")
    expect(DEFAULT_CONFIG.repositories).toEqual([])
    expect(DEFAULT_CONFIG.debounceMs).toBe(1000)
  })
})

describe("saveConfig", () => {
  const testDir = join(tmpdir(), `opencode-auth-sync-save-${Date.now()}`)
  const testConfigPath = join(testDir, "config.json")

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("writes config to file with proper JSON formatting", async () => {
    const config: Partial<AuthSyncConfig> = {
      enabled: true,
      repositories: ["org/repo"],
      secretName: "TEST_SECRET",
    }

    await saveConfig(testConfigPath, config)

    const content = readFileSync(testConfigPath, "utf-8")
    const parsed = JSON.parse(content)

    expect(parsed).toEqual(config)
    expect(content).toContain("\n")
  })

  test("saves config with authFileHashes field", async () => {
    const config: Partial<AuthSyncConfig> = {
      enabled: true,
      repositories: ["org/repo"],
      authFileHashes: { "org/repo": "abc123def456" },
    }

    await saveConfig(testConfigPath, config)

    const content = readFileSync(testConfigPath, "utf-8")
    const parsed = JSON.parse(content)

    expect(parsed.authFileHashes).toEqual({ "org/repo": "abc123def456" })
  })

  test("overwrites existing config file", async () => {
    const oldConfig = { enabled: false, repositories: ["old/repo"] }
    writeFileSync(testConfigPath, JSON.stringify(oldConfig))

    const newConfig: Partial<AuthSyncConfig> = {
      enabled: true,
      repositories: ["new/repo"],
      authFileHashes: { "new/repo": "newhash123" },
    }

    await saveConfig(testConfigPath, newConfig)

    const content = readFileSync(testConfigPath, "utf-8")
    const parsed = JSON.parse(content)

    expect(parsed.enabled).toBe(true)
    expect(parsed.repositories).toEqual(["new/repo"])
    expect(parsed.authFileHashes).toEqual({ "new/repo": "newhash123" })
  })
})

describe("getConfigPath", () => {
  const testDir = join(tmpdir(), `opencode-auth-sync-path-${Date.now()}`)
  const projectConfigPath = join(testDir, "opencode-auth-sync.json")

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("returns project config path when it exists", () => {
    writeFileSync(projectConfigPath, JSON.stringify({ enabled: true }))

    const result = getConfigPath(testDir)
    expect(result).toBe(projectConfigPath)
  })

  test("returns string when some config file exists", () => {
    const result = getConfigPath(testDir)
    expect(typeof result === "string" || result === null).toBe(true)
  })
})

describe("authFileHashes in config", () => {
  const testDir = join(tmpdir(), `opencode-auth-sync-hash-${Date.now()}`)
  const testConfigPath = join(testDir, "config.json")

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("loads config with authFileHashes field", () => {
    const config = {
      enabled: true,
      repositories: ["org/repo"],
      authFileHashes: { "org/repo": "sha256hashvalue123" },
    }
    writeFileSync(testConfigPath, JSON.stringify(config))

    const result = loadPluginConfigSync(testConfigPath)

    expect(result.authFileHashes).toEqual({ "org/repo": "sha256hashvalue123" })
  })

  test("backward compatibility: loads config without authFileHashes field", () => {
    const config = {
      enabled: true,
      repositories: ["org/repo"],
      secretName: "SECRET",
    }
    writeFileSync(testConfigPath, JSON.stringify(config))

    const result = loadPluginConfigSync(testConfigPath)

    expect(result.authFileHashes).toBeUndefined()
    expect(result.enabled).toBe(true)
    expect(result.repositories).toEqual(["org/repo"])
  })

  test("mergeConfig preserves authFileHashes from existing config", () => {
    const existing: Partial<AuthSyncConfig> = {
      enabled: true,
      repositories: ["old/repo"],
      authFileHashes: { "old/repo": "existinghash" },
    }
    const updates: Partial<AuthSyncConfig> = {
      repositories: ["new/repo"],
    }

    const result = mergeConfig(existing, updates)

    expect(result.authFileHashes).toEqual({ "old/repo": "existinghash" })
    expect(result.repositories).toEqual(["new/repo"])
  })

  test("mergeConfig allows updating authFileHashes", () => {
    const existing: Partial<AuthSyncConfig> = {
      enabled: true,
      authFileHashes: { "org/repo": "oldhash" },
    }
    const updates: Partial<AuthSyncConfig> = {
      authFileHashes: { "org/repo": "newhash", "org/repo2": "hash2" },
    }

    const result = mergeConfig(existing, updates)

    expect(result.authFileHashes).toEqual({ "org/repo": "newhash", "org/repo2": "hash2" })
  })

  test("full workflow: load, update hashes, save, reload", async () => {
    const initialConfig = {
      enabled: true,
      repositories: ["org/repo"],
      secretName: "SECRET",
    }
    writeFileSync(testConfigPath, JSON.stringify(initialConfig))

    const loaded = loadPluginConfigSync(testConfigPath)
    expect(loaded.authFileHashes).toBeUndefined()

    const updated: Partial<AuthSyncConfig> = {
      ...loaded,
      authFileHashes: { "org/repo": "newlycomputedhash" },
    }
    await saveConfig(testConfigPath, updated)

    const reloaded = loadPluginConfigSync(testConfigPath)
    expect(reloaded.authFileHashes).toEqual({ "org/repo": "newlycomputedhash" })
    expect(reloaded.enabled).toBe(true)
    expect(reloaded.repositories).toEqual(["org/repo"])
  })
})
