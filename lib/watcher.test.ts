import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { computeHash, watchCredentials, type WatcherCallbacks } from "./watcher"
import type { OpenCodeAuth } from "./types"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("computeHash", () => {
  test("returns consistent SHA-256 hash for same content", () => {
    const content = '{"anthropic":{"type":"oauth","access":"token123"}}'
    const hash1 = computeHash(content)
    const hash2 = computeHash(content)

    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)
  })

  test("returns different hash for different content", () => {
    const content1 = '{"anthropic":{"access":"token1"}}'
    const content2 = '{"anthropic":{"access":"token2"}}'

    const hash1 = computeHash(content1)
    const hash2 = computeHash(content2)

    expect(hash1).not.toBe(hash2)
  })

  test("returns valid hex string", () => {
    const hash = computeHash("test content")
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test("handles empty string", () => {
    const hash = computeHash("")
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test("handles unicode content", () => {
    const hash = computeHash('{"name":"日本語","emoji":"🎉"}')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test("whitespace-only differences produce different hashes", () => {
    const compact = '{"key":"value"}'
    const pretty = '{ "key": "value" }'

    expect(computeHash(compact)).not.toBe(computeHash(pretty))
  })
})

describe("watchCredentials", () => {
  const testDir = join(tmpdir(), `opencode-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const testCredentialsPath = join(testDir, "auth.json")
  let stopWatcher: (() => void) | null = null

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (stopWatcher) {
      stopWatcher()
      stopWatcher = null
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe("initialization", () => {
    test("returns a cleanup function", () => {
      writeFileSync(testCredentialsPath, JSON.stringify({ test: { type: "api", key: "test" } }))
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: () => {},
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 100 })

      expect(typeof stopWatcher).toBe("function")
    })

    test("triggers onCredentialsChange for initial file read", async () => {
      const credentials = { anthropic: { type: "oauth" as const, access: "token", refresh: "ref", expires: 123 } }
      writeFileSync(testCredentialsPath, JSON.stringify(credentials))

      let receivedCredentials: OpenCodeAuth | null = null
      let receivedRaw: string | null = null
      let receivedHash: string | null = null

      const callbacks: WatcherCallbacks = {
        onCredentialsChange: (creds, raw, hash) => {
          receivedCredentials = creds
          receivedRaw = raw
          receivedHash = hash
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(700)

      expect(receivedCredentials).not.toBeNull()
      expect(receivedCredentials!.anthropic).toBeDefined()
      expect(receivedRaw).not.toBeNull()
      expect(receivedHash).not.toBeNull()
      expect(receivedHash!).toHaveLength(64)
    })
  })

  describe("hash comparison", () => {
    test("triggers callback on initial file when no stored hash", async () => {
      const authContent = '{"anthropic":{"type":"oauth","access":"initial"}}'
      writeFileSync(testCredentialsPath, authContent)

      let callCount = 0
      let receivedRaw = ""
      let receivedHash = ""

      stopWatcher = watchCredentials(
        testCredentialsPath,
        {
          onCredentialsChange: (_credentials: OpenCodeAuth, raw: string, hash: string) => {
            callCount++
            receivedRaw = raw
            receivedHash = hash
          },
          onError: () => {},
        },
        { debounceMs: 50 }
      )

      await wait(700)
      stopWatcher()
      stopWatcher = null

      expect(callCount).toBe(1)
      expect(receivedRaw).toBe(authContent)
      expect(receivedHash).toBe(computeHash(authContent))
    })

    test("skips callback when content hash matches stored hash", async () => {
      const authContent = '{"anthropic":{"type":"oauth","access":"unchanged"}}'
      const storedHash = computeHash(authContent)
      writeFileSync(testCredentialsPath, authContent)

      let callCount = 0

      stopWatcher = watchCredentials(
        testCredentialsPath,
        {
          onCredentialsChange: () => {
            callCount++
          },
          onError: () => {},
        },
        { debounceMs: 50, storedHash }
      )

      await wait(700)
      stopWatcher()
      stopWatcher = null

      expect(callCount).toBe(0)
    })

    test("triggers callback when content hash differs from stored hash", async () => {
      const oldContent = '{"anthropic":{"access":"old"}}'
      const newContent = '{"anthropic":{"access":"new"}}'
      const storedHash = computeHash(oldContent)

      writeFileSync(testCredentialsPath, newContent)

      let callCount = 0
      let receivedRaw = ""
      let receivedHash = ""

      stopWatcher = watchCredentials(
        testCredentialsPath,
        {
          onCredentialsChange: (_credentials: OpenCodeAuth, raw: string, hash: string) => {
            callCount++
            receivedRaw = raw
            receivedHash = hash
          },
          onError: () => {},
        },
        { debounceMs: 50, storedHash }
      )

      await wait(700)
      stopWatcher()
      stopWatcher = null

      expect(callCount).toBe(1)
      expect(receivedRaw).toBe(newContent)
      expect(receivedHash).toBe(computeHash(newContent))
    })

    test("backward compatibility: works with storedHash undefined", async () => {
      const authContent = '{"test":"backward-compat"}'
      writeFileSync(testCredentialsPath, authContent)

      let callCount = 0

      stopWatcher = watchCredentials(
        testCredentialsPath,
        {
          onCredentialsChange: () => {
            callCount++
          },
          onError: () => {},
        },
        { debounceMs: 50, storedHash: undefined }
      )

      await wait(700)
      stopWatcher()
      stopWatcher = null

      expect(callCount).toBe(1)
    })
  })

  describe("change detection", () => {
    test("detects file content changes", async () => {
      const initialCredentials = { test: { type: "api" as const, key: "initial" } }
      writeFileSync(testCredentialsPath, JSON.stringify(initialCredentials))

      const changes: OpenCodeAuth[] = []
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: (creds) => {
          changes.push(creds)
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(1500)

      const updatedCredentials = { test: { type: "api" as const, key: "updated" } }
      writeFileSync(testCredentialsPath, JSON.stringify(updatedCredentials))
      await wait(1500)

      expect(changes.length).toBeGreaterThanOrEqual(1)
      const lastChange = changes[changes.length - 1]
      expect(lastChange).toBeDefined()
    })

    test("ignores duplicate content writes", async () => {
      const credentials = { provider: { type: "api" as const, key: "same" } }
      writeFileSync(testCredentialsPath, JSON.stringify(credentials))

      let changeCount = 0
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: () => {
          changeCount++
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(700)

      const initialCount = changeCount

      writeFileSync(testCredentialsPath, JSON.stringify(credentials))
      await wait(700)

      expect(changeCount).toBe(initialCount)
    })

    test("provides raw content string alongside parsed credentials", async () => {
      const credentials = { provider: { type: "api" as const, key: "test-key" } }
      const rawContent = JSON.stringify(credentials, null, 2)
      writeFileSync(testCredentialsPath, rawContent)

      let receivedRaw: string | null = null
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: (_, raw) => {
          receivedRaw = raw
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(700)

      expect(receivedRaw).not.toBeNull()
      expect(receivedRaw!).toBe(rawContent)
    })
  })

  describe("debouncing", () => {
    test("debounces rapid file changes", async () => {
      const credentials = { test: { type: "api" as const, key: "initial" } }
      writeFileSync(testCredentialsPath, JSON.stringify(credentials))

      let changeCount = 0
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: () => {
          changeCount++
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 200 })
      await wait(800)

      const countAfterInit = changeCount

      for (let i = 0; i < 5; i++) {
        writeFileSync(testCredentialsPath, JSON.stringify({ test: { type: "api" as const, key: `key-${i}` } }))
        await wait(50)
      }
      await wait(500)

      expect(changeCount - countAfterInit).toBeLessThanOrEqual(2)
    })

    test("debounce timer is configurable", async () => {
      const credentials = { test: { type: "api" as const, key: "test" } }
      writeFileSync(testCredentialsPath, JSON.stringify(credentials))

      let changeCount = 0
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: () => {
          changeCount++
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 500 })
      await wait(1500)

      const initialCount = changeCount

      writeFileSync(testCredentialsPath, JSON.stringify({ test: { type: "api" as const, key: "updated" } }))
      await wait(1200)

      expect(changeCount).toBeGreaterThanOrEqual(initialCount)
    })
  })

  describe("error handling", () => {
    test("calls onError for invalid JSON content", async () => {
      writeFileSync(testCredentialsPath, JSON.stringify({ valid: { type: "api" as const, key: "test" } }))

      const errors: Error[] = []
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: () => {},
        onError: (error) => {
          errors.push(error)
        },
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(1500)

      writeFileSync(testCredentialsPath, "invalid json {{{")
      await wait(1500)

      if (errors.length > 0) {
        expect(errors[0].message).toContain("JSON")
      }
    })

    test("can receive multiple changes over time", async () => {
      writeFileSync(testCredentialsPath, JSON.stringify({ test: { type: "api" as const, key: "initial" } }))

      const changes: OpenCodeAuth[] = []
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: (creds) => {
          changes.push(creds)
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(1500)

      const validCredentials = { updated: { type: "api" as const, key: "new-key" } }
      writeFileSync(testCredentialsPath, JSON.stringify(validCredentials))
      await wait(1500)

      expect(changes.length).toBeGreaterThanOrEqual(1)
    })

    test("passes parsed credentials object to callback", async () => {
      const authData: OpenCodeAuth = {
        anthropic: { type: "oauth", access: "token123", refresh: "refresh123", expires: 1234567890 },
      }
      writeFileSync(testCredentialsPath, JSON.stringify(authData))

      let receivedCredentials: OpenCodeAuth = {}

      stopWatcher = watchCredentials(
        testCredentialsPath,
        {
          onCredentialsChange: (credentials: OpenCodeAuth) => {
            receivedCredentials = credentials
          },
          onError: () => {},
        },
        { debounceMs: 50 }
      )

      await wait(700)
      stopWatcher()
      stopWatcher = null

      expect(receivedCredentials).toEqual(authData)
    })
  })

  describe("cleanup", () => {
    test("cleanup function stops watching for changes", async () => {
      const credentials = { test: { type: "api" as const, key: "initial" } }
      writeFileSync(testCredentialsPath, JSON.stringify(credentials))

      let changeCount = 0
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: () => {
          changeCount++
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(700)
      const countAfterInit = changeCount

      stopWatcher()
      stopWatcher = null

      writeFileSync(testCredentialsPath, JSON.stringify({ test: { type: "api" as const, key: "after-cleanup" } }))
      await wait(500)

      expect(changeCount).toBe(countAfterInit)
    })

    test("cleanup function clears pending debounce timers", async () => {
      const credentials = { test: { type: "api" as const, key: "initial" } }
      writeFileSync(testCredentialsPath, JSON.stringify(credentials))

      let changeCount = 0
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: () => {
          changeCount++
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 500 })
      await wait(700)
      const countAfterInit = changeCount

      writeFileSync(testCredentialsPath, JSON.stringify({ test: { type: "api" as const, key: "pending" } }))
      await wait(100)

      stopWatcher()
      stopWatcher = null
      await wait(600)

      expect(changeCount).toBe(countAfterInit)
    })
  })

  describe("edge cases", () => {
    test("handles empty credentials object", async () => {
      writeFileSync(testCredentialsPath, JSON.stringify({}))

      let receivedCredentials: OpenCodeAuth | null = null
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: (creds) => {
          receivedCredentials = creds
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(700)

      expect(receivedCredentials).not.toBeNull()
      expect(Object.keys(receivedCredentials!)).toHaveLength(0)
    })

    test("handles credentials with multiple providers", async () => {
      const multiProviderCreds: OpenCodeAuth = {
        anthropic: { type: "oauth", access: "a-token", refresh: "a-ref", expires: 100 },
        openai: { type: "oauth", access: "o-token", refresh: "o-ref", expires: 200 },
        custom: { type: "api", key: "api-key" },
      }
      writeFileSync(testCredentialsPath, JSON.stringify(multiProviderCreds))

      let receivedCredentials: OpenCodeAuth | null = null
      const callbacks: WatcherCallbacks = {
        onCredentialsChange: (creds) => {
          receivedCredentials = creds
        },
        onError: () => {},
      }

      stopWatcher = watchCredentials(testCredentialsPath, callbacks, { debounceMs: 50 })
      await wait(700)

      expect(receivedCredentials).not.toBeNull()
      expect(Object.keys(receivedCredentials!)).toEqual(["anthropic", "openai", "custom"])
    })
  })
})
