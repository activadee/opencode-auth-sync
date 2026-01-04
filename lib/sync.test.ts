import { describe, test, expect } from "bun:test"
import { syncToRepositories, verifyGhAuth } from "./sync"

// Mock shell function type matching PluginInput["$"]
type MockShellResult = {
  exitCode: number
  stderr: { toString: () => string }
  stdout: { toString: () => string }
}

type MockShellFn = {
  (strings: TemplateStringsArray, ...values: unknown[]): {
    nothrow: () => { quiet: () => Promise<MockShellResult> }
  }
}

function createMockShell(results: Map<string, MockShellResult>): MockShellFn {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const command = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "")
    return {
      nothrow: () => ({
        quiet: async () => {
          for (const [pattern, result] of results) {
            if (command.includes(pattern)) {
              return result
            }
          }
          return { exitCode: 0, stderr: { toString: () => "" }, stdout: { toString: () => "" } }
        },
      }),
    }
  }
}

function createSuccessResult(stdout = ""): MockShellResult {
  return {
    exitCode: 0,
    stderr: { toString: () => "" },
    stdout: { toString: () => stdout },
  }
}

function createErrorResult(errorMessage: string, exitCode = 1): MockShellResult {
  return {
    exitCode,
    stderr: { toString: () => errorMessage },
    stdout: { toString: () => "" },
  }
}

describe("syncToRepositories", () => {
  describe("single repository sync", () => {
    test("successfully syncs to a single repository", async () => {
      const mockResults = new Map([["gh secret set", createSuccessResult()]])
      const $ = createMockShell(mockResults)

      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        ["owner/repo"],
        "SECRET_NAME",
        "secret-value"
      )

      expect(summary.total).toBe(1)
      expect(summary.successful).toBe(1)
      expect(summary.failed).toBe(0)
      expect(summary.results[0].repository).toBe("owner/repo")
      expect(summary.results[0].success).toBe(true)
      expect(summary.results[0].error).toBeUndefined()
    })

    test("handles failed sync to a single repository", async () => {
      const mockResults = new Map([
        ["gh secret set", createErrorResult("HTTP 403: Permission denied")],
      ])
      const $ = createMockShell(mockResults)

      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        ["owner/repo"],
        "SECRET_NAME",
        "secret-value"
      )

      expect(summary.total).toBe(1)
      expect(summary.successful).toBe(0)
      expect(summary.failed).toBe(1)
      expect(summary.results[0].repository).toBe("owner/repo")
      expect(summary.results[0].success).toBe(false)
      expect(summary.results[0].error).toBe("HTTP 403: Permission denied")
    })

    test("reports correct error message from stderr", async () => {
      const errorMsg = "Repository not found or access denied"
      const mockResults = new Map([["gh secret set", createErrorResult(errorMsg)]])
      const $ = createMockShell(mockResults)

      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        ["nonexistent/repo"],
        "SECRET",
        "value"
      )

      expect(summary.results[0].error).toBe(errorMsg)
    })
  })

  describe("multiple repository sync", () => {
    test("successfully syncs to multiple repositories", async () => {
      const mockResults = new Map([["gh secret set", createSuccessResult()]])
      const $ = createMockShell(mockResults)

      const repos = ["owner/repo1", "owner/repo2", "owner/repo3"]
      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        repos,
        "SECRET_NAME",
        "secret-value"
      )

      expect(summary.total).toBe(3)
      expect(summary.successful).toBe(3)
      expect(summary.failed).toBe(0)
      expect(summary.results).toHaveLength(3)
      expect(summary.results.every((r) => r.success)).toBe(true)
    })

    test("handles partial failures in batch sync", async () => {
      const $ = ((strings: TemplateStringsArray, ...values: unknown[]) => {
        const command = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "")
        return {
          nothrow: () => ({
            quiet: async () => {
              if (command.includes("owner/failing-repo")) {
                return createErrorResult("Access denied")
              }
              return createSuccessResult()
            },
          }),
        }
      }) as unknown as Parameters<typeof syncToRepositories>[0]

      const repos = ["owner/repo1", "owner/failing-repo", "owner/repo2"]
      const summary = await syncToRepositories($, repos, "SECRET", "value")

      expect(summary.total).toBe(3)
      expect(summary.successful).toBe(2)
      expect(summary.failed).toBe(1)
      expect(summary.results[0].success).toBe(true)
      expect(summary.results[1].success).toBe(false)
      expect(summary.results[1].error).toBe("Access denied")
      expect(summary.results[2].success).toBe(true)
    })

    test("handles all repositories failing", async () => {
      const mockResults = new Map([["gh secret set", createErrorResult("Network error")]])
      const $ = createMockShell(mockResults)

      const repos = ["owner/repo1", "owner/repo2"]
      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        repos,
        "SECRET",
        "value"
      )

      expect(summary.total).toBe(2)
      expect(summary.successful).toBe(0)
      expect(summary.failed).toBe(2)
      expect(summary.results.every((r) => !r.success)).toBe(true)
    })

    test("maintains order of results matching input repositories", async () => {
      const mockResults = new Map([["gh secret set", createSuccessResult()]])
      const $ = createMockShell(mockResults)

      const repos = ["alpha/repo", "beta/repo", "gamma/repo"]
      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        repos,
        "SECRET",
        "value"
      )

      expect(summary.results[0].repository).toBe("alpha/repo")
      expect(summary.results[1].repository).toBe("beta/repo")
      expect(summary.results[2].repository).toBe("gamma/repo")
    })
  })

  describe("empty repository list", () => {
    test("returns empty summary for empty repository list", async () => {
      const mockResults = new Map([["gh secret set", createSuccessResult()]])
      const $ = createMockShell(mockResults)

      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        [],
        "SECRET",
        "value"
      )

      expect(summary.total).toBe(0)
      expect(summary.successful).toBe(0)
      expect(summary.failed).toBe(0)
      expect(summary.results).toHaveLength(0)
    })
  })

  describe("special characters handling", () => {
    test("handles repository names with hyphens and underscores", async () => {
      const mockResults = new Map([["gh secret set", createSuccessResult()]])
      const $ = createMockShell(mockResults)

      const repos = ["my-org/my_repo-name", "user-123/test_repo"]
      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        repos,
        "SECRET",
        "value"
      )

      expect(summary.total).toBe(2)
      expect(summary.successful).toBe(2)
      expect(summary.results[0].repository).toBe("my-org/my_repo-name")
      expect(summary.results[1].repository).toBe("user-123/test_repo")
    })

    test("handles secret names with underscores", async () => {
      const mockResults = new Map([["gh secret set", createSuccessResult()]])
      const $ = createMockShell(mockResults)

      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        ["owner/repo"],
        "MY_LONG_SECRET_NAME",
        "value"
      )

      expect(summary.successful).toBe(1)
    })

    test("handles large secret values (JSON content)", async () => {
      const mockResults = new Map([["gh secret set", createSuccessResult()]])
      const $ = createMockShell(mockResults)

      const largeJson = JSON.stringify({
        provider1: { type: "oauth", access: "a".repeat(1000), refresh: "r".repeat(1000), expires: 123456 },
        provider2: { type: "api", key: "k".repeat(500) },
      })

      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        ["owner/repo"],
        "AUTH_SECRET",
        largeJson
      )

      expect(summary.successful).toBe(1)
    })
  })

  describe("error message propagation", () => {
    test("captures authentication errors", async () => {
      const mockResults = new Map([
        ["gh secret set", createErrorResult("gh: Not logged into any GitHub hosts")],
      ])
      const $ = createMockShell(mockResults)

      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        ["owner/repo"],
        "SECRET",
        "value"
      )

      expect(summary.results[0].error).toContain("Not logged into any GitHub hosts")
    })

    test("captures rate limit errors", async () => {
      const mockResults = new Map([
        ["gh secret set", createErrorResult("API rate limit exceeded", 1)],
      ])
      const $ = createMockShell(mockResults)

      const summary = await syncToRepositories(
        $ as unknown as Parameters<typeof syncToRepositories>[0],
        ["owner/repo"],
        "SECRET",
        "value"
      )

      expect(summary.results[0].error).toContain("rate limit")
    })
  })
})

describe("verifyGhAuth", () => {
  test("returns true when gh auth status succeeds", async () => {
    const mockResults = new Map([["gh auth status", createSuccessResult("Logged in")]])
    const $ = createMockShell(mockResults)

    const result = await verifyGhAuth($ as unknown as Parameters<typeof verifyGhAuth>[0])
    expect(result).toBe(true)
  })

  test("returns false when gh auth status fails", async () => {
    const mockResults = new Map([["gh auth status", createErrorResult("Not logged in")]])
    const $ = createMockShell(mockResults)

    const result = await verifyGhAuth($ as unknown as Parameters<typeof verifyGhAuth>[0])
    expect(result).toBe(false)
  })

  test("returns false when gh cli not installed (throws)", async () => {
    const $ = (() => {
      throw new Error("command not found: gh")
    }) as unknown as Parameters<typeof verifyGhAuth>[0]

    const result = await verifyGhAuth($)
    expect(result).toBe(false)
  })

  test("returns false on non-zero exit code", async () => {
    const mockResults = new Map([["gh auth status", { exitCode: 2, stderr: { toString: () => "" }, stdout: { toString: () => "" } }]])
    const $ = createMockShell(mockResults)

    const result = await verifyGhAuth($ as unknown as Parameters<typeof verifyGhAuth>[0])
    expect(result).toBe(false)
  })
})
