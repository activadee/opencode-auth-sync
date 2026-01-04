import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("cli-utils", () => {
  const testDir = join(tmpdir(), `opencode-cli-utils-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe("isPluginInstalled", () => {
    test("returns true when plugin is in config", async () => {
      const { isPluginInstalled } = await import("./cli-utils")
      const config = { plugin: ["@activade/opencode-auth-sync"] }
      
      expect(isPluginInstalled(config)).toBe(true)
    })

    test("returns true when plugin with version is in config", async () => {
      const { isPluginInstalled } = await import("./cli-utils")
      const config = { plugin: ["@activade/opencode-auth-sync@1.0.0"] }
      
      expect(isPluginInstalled(config)).toBe(true)
    })

    test("returns false when plugin is not in config", async () => {
      const { isPluginInstalled } = await import("./cli-utils")
      const config = { plugin: ["other-plugin"] }
      
      expect(isPluginInstalled(config)).toBe(false)
    })

    test("returns false when plugin array is empty", async () => {
      const { isPluginInstalled } = await import("./cli-utils")
      const config = { plugin: [] }
      
      expect(isPluginInstalled(config)).toBe(false)
    })

    test("returns false when plugin key is missing", async () => {
      const { isPluginInstalled } = await import("./cli-utils")
      const config = {}
      
      expect(isPluginInstalled(config)).toBe(false)
    })

    test("returns false when config is empty", async () => {
      const { isPluginInstalled } = await import("./cli-utils")
      
      expect(isPluginInstalled({})).toBe(false)
    })

    test("returns true when plugin name is substring match", async () => {
      const { isPluginInstalled } = await import("./cli-utils")
      const config = { plugin: ["some-prefix-opencode-auth-sync-suffix"] }
      
      expect(isPluginInstalled(config)).toBe(true)
    })
  })

  describe("addPluginToConfig", () => {
    test("adds plugin to empty plugin array", async () => {
      const { addPluginToConfig, PLUGIN_NAME } = await import("./cli-utils")
      const config = { plugin: [] }
      
      const result = addPluginToConfig(config)
      
      expect(result.plugin).toContain(PLUGIN_NAME)
    })

    test("adds plugin when key does not exist", async () => {
      const { addPluginToConfig, PLUGIN_NAME } = await import("./cli-utils")
      const config = {}
      
      const result = addPluginToConfig(config)
      
      expect(result.plugin).toContain(PLUGIN_NAME)
    })

    test("does not duplicate plugin if already present", async () => {
      const { addPluginToConfig, PLUGIN_NAME } = await import("./cli-utils")
      const config = { plugin: [PLUGIN_NAME] }
      
      const result = addPluginToConfig(config)
      
      expect((result.plugin as string[]).filter((p) => p === PLUGIN_NAME)).toHaveLength(1)
    })

    test("preserves existing plugins", async () => {
      const { addPluginToConfig } = await import("./cli-utils")
      const config = { plugin: ["existing-plugin", "another-plugin"] }
      
      const result = addPluginToConfig(config)
      
      expect(result.plugin).toContain("existing-plugin")
      expect(result.plugin).toContain("another-plugin")
    })

    test("preserves other config values", async () => {
      const { addPluginToConfig } = await import("./cli-utils")
      const config = { plugin: [], model: "claude-3", someKey: "value" }
      
      const result = addPluginToConfig(config)
      
      expect(result.model).toBe("claude-3")
      expect(result.someKey).toBe("value")
    })

    test("returns new object without mutating input", async () => {
      const { addPluginToConfig } = await import("./cli-utils")
      const config = { plugin: [], existing: "value" }
      
      const result = addPluginToConfig(config)
      
      expect(result).not.toBe(config)
      expect(config.existing).toBe("value")
    })
  })

  describe("validateSecretName", () => {
    test("returns undefined for valid secret names", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      expect(validateSecretName("OPENCODE_AUTH_JSON")).toBeUndefined()
      expect(validateSecretName("MY_SECRET")).toBeUndefined()
      expect(validateSecretName("SECRET_123")).toBeUndefined()
      expect(validateSecretName("_PRIVATE")).toBeUndefined()
    })

    test("returns error for lowercase letters", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      const error = validateSecretName("my_secret")
      expect(error).toBeDefined()
      expect(error).toContain("uppercase")
    })

    test("returns error for names starting with numbers", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      const error = validateSecretName("123_SECRET")
      expect(error).toBeDefined()
    })

    test("returns error for names with hyphens", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      const error = validateSecretName("MY-SECRET")
      expect(error).toBeDefined()
    })

    test("returns error for names with spaces", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      const error = validateSecretName("MY SECRET")
      expect(error).toBeDefined()
    })

    test("returns error for mixed case", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      const error = validateSecretName("MySecret")
      expect(error).toBeDefined()
    })

    test("returns undefined for empty string", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      expect(validateSecretName("")).toBeUndefined()
    })

    test("accepts single uppercase letter", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      expect(validateSecretName("A")).toBeUndefined()
    })

    test("accepts underscore at start", async () => {
      const { validateSecretName } = await import("./cli-utils")
      
      expect(validateSecretName("_SECRET")).toBeUndefined()
    })
  })

  describe("savePluginConfig", () => {
    test("creates directory and writes config file", async () => {
      const { savePluginConfig } = await import("./cli-utils")
      const configPath = join(testDir, "nested", "dir", "config.json")
      const config = { enabled: true, repositories: ["user/repo"] }
      
      savePluginConfig(configPath, config)
      
      expect(existsSync(configPath)).toBe(true)
      const saved = JSON.parse(readFileSync(configPath, "utf-8"))
      expect(saved).toEqual(config)
    })

    test("writes formatted JSON with newline", async () => {
      const { savePluginConfig } = await import("./cli-utils")
      const configPath = join(testDir, "config.json")
      const config = { key: "value" }
      
      savePluginConfig(configPath, config)
      
      const content = readFileSync(configPath, "utf-8")
      expect(content).toContain("\n")
      expect(content.endsWith("\n")).toBe(true)
    })

    test("overwrites existing config file", async () => {
      const { savePluginConfig } = await import("./cli-utils")
      const configPath = join(testDir, "config.json")
      
      savePluginConfig(configPath, { old: "value" })
      savePluginConfig(configPath, { new: "value" })
      
      const saved = JSON.parse(readFileSync(configPath, "utf-8"))
      expect(saved).toEqual({ new: "value" })
      expect(saved.old).toBeUndefined()
    })

    test("writes pretty-printed JSON with 2-space indent", async () => {
      const { savePluginConfig } = await import("./cli-utils")
      const configPath = join(testDir, "config.json")
      const config = { nested: { key: "value" } }
      
      savePluginConfig(configPath, config)
      
      const content = readFileSync(configPath, "utf-8")
      expect(content).toContain("  ")
    })

    test("handles complex nested config", async () => {
      const { savePluginConfig } = await import("./cli-utils")
      const configPath = join(testDir, "config.json")
      const config = {
        enabled: true,
        repositories: ["user/repo1", "org/repo2"],
        nested: { level1: { level2: "deep" } },
        array: [1, 2, 3],
      }
      
      savePluginConfig(configPath, config)
      
      const saved = JSON.parse(readFileSync(configPath, "utf-8"))
      expect(saved).toEqual(config)
    })
  })

  describe("config path constants", () => {
    test("PLUGIN_NAME is correct", async () => {
      const { PLUGIN_NAME } = await import("./cli-utils")
      expect(PLUGIN_NAME).toBe("@activade/opencode-auth-sync")
    })

    test("config paths use .config/opencode directory", async () => {
      const { OPENCODE_CONFIG_DIR, OPENCODE_CONFIG_PATH, PLUGIN_CONFIG_PATH } = await import("./cli-utils")
      
      expect(OPENCODE_CONFIG_DIR).toContain(".config")
      expect(OPENCODE_CONFIG_DIR).toContain("opencode")
      expect(OPENCODE_CONFIG_PATH).toContain("opencode.json")
      expect(PLUGIN_CONFIG_PATH).toContain("opencode-auth-sync.json")
    })

    test("OPENCODE_CONFIG_PATH is inside OPENCODE_CONFIG_DIR", async () => {
      const { OPENCODE_CONFIG_DIR, OPENCODE_CONFIG_PATH } = await import("./cli-utils")
      
      expect(OPENCODE_CONFIG_PATH.startsWith(OPENCODE_CONFIG_DIR)).toBe(true)
    })

    test("PLUGIN_CONFIG_PATH is inside OPENCODE_CONFIG_DIR", async () => {
      const { OPENCODE_CONFIG_DIR, PLUGIN_CONFIG_PATH } = await import("./cli-utils")
      
      expect(PLUGIN_CONFIG_PATH.startsWith(OPENCODE_CONFIG_DIR)).toBe(true)
    })
  })

  describe("GhRepo interface", () => {
    test("can represent public repo", async () => {
      const { getGhRepos } = await import("./cli-utils")
      type GhRepo = ReturnType<typeof getGhRepos>[number]
      
      const repo: GhRepo = {
        nameWithOwner: "user/repo",
        isPrivate: false,
        description: "A public repository",
      }
      
      expect(repo.nameWithOwner).toBe("user/repo")
      expect(repo.isPrivate).toBe(false)
      expect(repo.description).toBe("A public repository")
    })

    test("can represent private repo with null description", async () => {
      const { getGhRepos } = await import("./cli-utils")
      type GhRepo = ReturnType<typeof getGhRepos>[number]
      
      const repo: GhRepo = {
        nameWithOwner: "org/private",
        isPrivate: true,
        description: null,
      }
      
      expect(repo.isPrivate).toBe(true)
      expect(repo.description).toBeNull()
    })
  })
})
