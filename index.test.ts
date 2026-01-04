import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { OpenCodeAuthSyncPlugin } from "./index"
import type { PluginInput } from "@opencode-ai/plugin"

type MockShellResult = {
  exitCode: number
  stderr: { toString: () => string }
  stdout: { toString: () => string }
}

function createMockShell(authSuccess = true) {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const command = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "")
    return {
      nothrow: () => ({
        quiet: async (): Promise<MockShellResult> => {
          if (command.includes("gh auth status")) {
            return {
              exitCode: authSuccess ? 0 : 1,
              stderr: { toString: () => authSuccess ? "" : "Not logged in" },
              stdout: { toString: () => "" },
            }
          }
          if (command.includes("gh secret set")) {
            return {
              exitCode: 0,
              stderr: { toString: () => "" },
              stdout: { toString: () => "" },
            }
          }
          return { exitCode: 0, stderr: { toString: () => "" }, stdout: { toString: () => "" } }
        },
      }),
    }
  }
}

function createMockClient() {
  const toastCalls: Array<{ title: string; message: string; variant: string }> = []
  return {
    tui: {
      showToast: ({ body }: { body: { title: string; message: string; variant: string } }) => {
        toastCalls.push(body)
      },
    },
    _getToastCalls: () => toastCalls,
  }
}

function createMockPluginInput(
  testDir: string,
  authSuccess = true
): PluginInput {
  return {
    $: createMockShell(authSuccess),
    client: createMockClient(),
    directory: testDir,
    project: {},
    worktree: {},
    serverUrl: "http://localhost:3000",
  } as unknown as PluginInput
}

describe("OpenCodeAuthSyncPlugin", () => {
  const testDir = join(tmpdir(), `opencode-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const testConfigPath = join(testDir, "opencode-auth-sync.json")

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe("plugin initialization", () => {
    test("returns empty object when plugin is disabled", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ enabled: false, repositories: ["user/repo"] }))
      
      const input = createMockPluginInput(testDir)
      const result = await OpenCodeAuthSyncPlugin(input)
      
      expect(result).toEqual({})
    })

    test("returns event handler when no repositories configured", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ enabled: true, repositories: [] }))
      
      const input = createMockPluginInput(testDir)
      const result = await OpenCodeAuthSyncPlugin(input)
      
      expect(result.event).toBeDefined()
    })

    test("shows warning toast on session.created when no repos configured", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ enabled: true, repositories: [] }))
      
      const mockClient = createMockClient()
      const input = {
        ...createMockPluginInput(testDir),
        client: mockClient,
      } as unknown as PluginInput
      const result = await OpenCodeAuthSyncPlugin(input)
      
      await result.event!({ event: { type: "session.created", properties: {} } } as Parameters<NonNullable<typeof result.event>>[0])
      
      const toasts = mockClient._getToastCalls()
      expect(toasts.length).toBe(1)
      expect(toasts[0].variant).toBe("warning")
      expect(toasts[0].message).toContain("No repositories configured")
    })

    test("returns event handler when gh auth fails", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ enabled: true, repositories: ["user/repo"] }))
      
      const input = createMockPluginInput(testDir, false)
      const result = await OpenCodeAuthSyncPlugin(input)
      
      expect(result.event).toBeDefined()
    })

    test("shows error toast on session.created when gh not authenticated", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ enabled: true, repositories: ["user/repo"] }))
      
      const mockClient = createMockClient()
      const input = {
        ...createMockPluginInput(testDir, false),
        client: mockClient,
      } as unknown as PluginInput
      const result = await OpenCodeAuthSyncPlugin(input)
      
      await result.event!({ event: { type: "session.created", properties: {} } } as Parameters<NonNullable<typeof result.event>>[0])
      
      const toasts = mockClient._getToastCalls()
      expect(toasts.length).toBe(1)
      expect(toasts[0].variant).toBe("error")
      expect(toasts[0].message).toContain("gh auth login")
    })
  })

  describe("config loading", () => {
    test("uses project directory config over home config", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ enabled: true, repositories: [] }))
      
      const input = createMockPluginInput(testDir)
      const result = await OpenCodeAuthSyncPlugin(input)
      
      expect(result.event).toBeDefined()
    })

    test("loads config from project directory", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ 
        enabled: true, 
        repositories: ["user/repo"],
        secretName: "CUSTOM_SECRET",
      }))
      
      const input = createMockPluginInput(testDir)
      const result = await OpenCodeAuthSyncPlugin(input)
      
      expect(result).toEqual({})
    })
  })

  describe("plugin exports", () => {
    test("exports OpenCodeAuthSyncPlugin as named export", async () => {
      const module = await import("./index")
      expect(module.OpenCodeAuthSyncPlugin).toBeDefined()
      expect(typeof module.OpenCodeAuthSyncPlugin).toBe("function")
    })

    test("exports OpenCodeAuthSyncPlugin as default export", async () => {
      const module = await import("./index")
      expect(module.default).toBeDefined()
      expect(module.default).toBe(module.OpenCodeAuthSyncPlugin)
    })
  })

  describe("event handler behavior", () => {
    test("event handler ignores non-session.created events when no repos", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ enabled: true, repositories: [] }))
      
      const mockClient = createMockClient()
      const input = {
        ...createMockPluginInput(testDir),
        client: mockClient,
      } as unknown as PluginInput
      const result = await OpenCodeAuthSyncPlugin(input)
      
      await result.event!({ event: { type: "session.updated", properties: {} } } as Parameters<NonNullable<typeof result.event>>[0])
      
      const toasts = mockClient._getToastCalls()
      expect(toasts.length).toBe(0)
    })

    test("event handler ignores non-session.created events when auth fails", async () => {
      writeFileSync(testConfigPath, JSON.stringify({ enabled: true, repositories: ["user/repo"] }))
      
      const mockClient = createMockClient()
      const input = {
        ...createMockPluginInput(testDir, false),
        client: mockClient,
      } as unknown as PluginInput
      const result = await OpenCodeAuthSyncPlugin(input)
      
      await result.event!({ event: { type: "session.updated", properties: {} } } as Parameters<NonNullable<typeof result.event>>[0])
      
      const toasts = mockClient._getToastCalls()
      expect(toasts.length).toBe(0)
    })
  })
})
