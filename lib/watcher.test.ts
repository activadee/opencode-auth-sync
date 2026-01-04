import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { computeHash, watchCredentials } from "./watcher"
import type { OpenCodeAuth } from "./types"

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

describe("watchCredentials hash comparison", () => {
  let testDir: string
  let authFilePath: string

  beforeEach(() => {
    testDir = join(tmpdir(), `watcher-test-${Date.now()}-${Math.random()}`)
    authFilePath = join(testDir, "auth.json")
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("triggers callback on initial file when no stored hash", async () => {
    const authContent = '{"anthropic":{"type":"oauth","access":"initial"}}'
    writeFileSync(authFilePath, authContent)

    let callCount = 0
    let receivedRaw = ""
    let receivedHash = ""

    const stop = watchCredentials(
      authFilePath,
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

    await new Promise((r) => setTimeout(r, 200))
    stop()

    expect(callCount).toBe(1)
    expect(receivedRaw).toBe(authContent)
    expect(receivedHash).toBe(computeHash(authContent))
  })

  test("skips callback when content hash matches stored hash", async () => {
    const authContent = '{"anthropic":{"type":"oauth","access":"unchanged"}}'
    const storedHash = computeHash(authContent)
    writeFileSync(authFilePath, authContent)

    let callCount = 0

    const stop = watchCredentials(
      authFilePath,
      {
        onCredentialsChange: () => {
          callCount++
        },
        onError: () => {},
      },
      { debounceMs: 50, storedHash }
    )

    await new Promise((r) => setTimeout(r, 200))
    stop()

    expect(callCount).toBe(0)
  })

  test("triggers callback when content hash differs from stored hash", async () => {
    const oldContent = '{"anthropic":{"access":"old"}}'
    const newContent = '{"anthropic":{"access":"new"}}'
    const storedHash = computeHash(oldContent)

    writeFileSync(authFilePath, newContent)

    let callCount = 0
    let receivedRaw = ""
    let receivedHash = ""

    const stop = watchCredentials(
      authFilePath,
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

    await new Promise((r) => setTimeout(r, 200))
    stop()

    expect(callCount).toBe(1)
    expect(receivedRaw).toBe(newContent)
    expect(receivedHash).toBe(computeHash(newContent))
  })

  test("skips duplicate changes with same content", async () => {
    const authContent = '{"test":"data"}'
    writeFileSync(authFilePath, authContent)

    let callCount = 0

    const stop = watchCredentials(
      authFilePath,
      {
        onCredentialsChange: () => {
          callCount++
        },
        onError: () => {},
      },
      { debounceMs: 50 }
    )

    await new Promise((r) => setTimeout(r, 200))
    expect(callCount).toBe(1)

    writeFileSync(authFilePath, authContent)
    await new Promise((r) => setTimeout(r, 200))
    expect(callCount).toBe(1)

    writeFileSync(authFilePath, authContent)
    await new Promise((r) => setTimeout(r, 200))

    stop()

    expect(callCount).toBe(1)
  })

  test("provides correct hash to callback on initial read", async () => {
    const content = '{"version":1}'
    const expectedHash = computeHash(content)

    writeFileSync(authFilePath, content)

    let receivedHash = ""

    const stop = watchCredentials(
      authFilePath,
      {
        onCredentialsChange: (_credentials: OpenCodeAuth, _raw: string, hash: string) => {
          receivedHash = hash
        },
        onError: () => {},
      },
      { debounceMs: 50 }
    )

    await new Promise((r) => setTimeout(r, 800))
    stop()

    expect(receivedHash).toBe(expectedHash)
  })

  test("calls onError for invalid JSON", async () => {
    writeFileSync(authFilePath, "not valid json {{{")

    let changeCount = 0
    let errorCount = 0

    const stop = watchCredentials(
      authFilePath,
      {
        onCredentialsChange: () => {
          changeCount++
        },
        onError: () => {
          errorCount++
        },
      },
      { debounceMs: 50 }
    )

    await new Promise((r) => setTimeout(r, 200))
    stop()

    expect(changeCount).toBe(0)
    expect(errorCount).toBe(1)
  })

  test("passes parsed credentials object to callback", async () => {
    const authData: OpenCodeAuth = {
      anthropic: { type: "oauth", access: "token123", refresh: "refresh123", expires: 1234567890 },
    }
    writeFileSync(authFilePath, JSON.stringify(authData))

    let receivedCredentials: OpenCodeAuth = {}

    const stop = watchCredentials(
      authFilePath,
      {
        onCredentialsChange: (credentials: OpenCodeAuth) => {
          receivedCredentials = credentials
        },
        onError: () => {},
      },
      { debounceMs: 50 }
    )

    await new Promise((r) => setTimeout(r, 200))
    stop()

    expect(receivedCredentials).toEqual(authData)
  })

  test("backward compatibility: works with storedHash undefined", async () => {
    const authContent = '{"test":"backward-compat"}'
    writeFileSync(authFilePath, authContent)

    let callCount = 0

    const stop = watchCredentials(
      authFilePath,
      {
        onCredentialsChange: () => {
          callCount++
        },
        onError: () => {},
      },
      { debounceMs: 50, storedHash: undefined }
    )

    await new Promise((r) => setTimeout(r, 200))
    stop()

    expect(callCount).toBe(1)
  })
})
