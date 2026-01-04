import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadPluginConfigSync, mergeConfig, DEFAULT_CONFIG } from "./config"
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
      secretName: "OPENCODE_AUTH",
      repositories: ["org/repo1", "org/repo2"],
    }
    writeFileSync(testConfigPath, JSON.stringify(originalConfig))
    
    const loaded = loadPluginConfigSync(testConfigPath)
    const reinstallUpdates = {
      repositories: ["org/repo1", "org/repo3"],
      secretName: "OPENCODE_AUTH",
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
    expect(DEFAULT_CONFIG.secretName).toBe("OPENCODE_AUTH")
    expect(DEFAULT_CONFIG.repositories).toEqual([])
    expect(DEFAULT_CONFIG.debounceMs).toBe(1000)
  })
})
