import { describe, test, expect, mock, afterEach } from "bun:test"
import { syncToRepositoriesHttp, verifyGithubToken, getGithubReposHttp } from "./github-http"

// Store the original fetch for restoration
const originalFetch = globalThis.fetch

// Helper to create mock fetch that satisfies TypeScript
function mockFetch(impl: (url: string) => Promise<Response>): typeof fetch {
  return mock(impl) as unknown as typeof fetch
}

describe("verifyGithubToken", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns true for valid token", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({ login: "testuser" }), { status: 200 })
    )

    const result = await verifyGithubToken("valid-token")
    expect(result).toBe(true)
  })

  test("returns false for invalid token", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })
    )

    const result = await verifyGithubToken("invalid-token")
    expect(result).toBe(false)
  })

  test("returns false on network error", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("Network error")
    })

    const result = await verifyGithubToken("any-token")
    expect(result).toBe(false)
  })
})

describe("getGithubReposHttp", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns repositories for valid token", async () => {
    const mockRepos = [
      { full_name: "owner/repo1", private: false, description: "Test repo 1" },
      { full_name: "owner/repo2", private: true, description: null },
    ]
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify(mockRepos), { status: 200 })
    )

    const repos = await getGithubReposHttp("valid-token")
    expect(repos).toHaveLength(2)
    expect(repos[0].nameWithOwner).toBe("owner/repo1")
    expect(repos[0].isPrivate).toBe(false)
    expect(repos[1].nameWithOwner).toBe("owner/repo2")
    expect(repos[1].isPrivate).toBe(true)
  })

  test("returns empty array for invalid token", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })
    )

    const repos = await getGithubReposHttp("invalid-token")
    expect(repos).toHaveLength(0)
  })

  test("returns empty array on network error", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("Network error")
    })

    const repos = await getGithubReposHttp("any-token")
    expect(repos).toHaveLength(0)
  })
})

describe("syncToRepositoriesHttp", () => {
  // A valid 32-byte public key (base64 encoded)
  // This is a test key, not used for any real encryption
  const validPublicKey = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("successfully syncs to a single repository", async () => {
    globalThis.fetch = mockFetch(async (url: string) => {
      if (url.includes("/public-key")) {
        return new Response(
          JSON.stringify({ key_id: "key123", key: validPublicKey }),
          { status: 200 }
        )
      }
      if (url.includes("/secrets/")) {
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    })

    const summary = await syncToRepositoriesHttp(
      "valid-token",
      ["owner/repo"],
      "SECRET_NAME",
      "secret-value"
    )

    expect(summary.total).toBe(1)
    expect(summary.successful).toBe(1)
    expect(summary.failed).toBe(0)
    expect(summary.results[0].success).toBe(true)
  })

  test("handles failed public key fetch", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({ message: "Not found" }), { status: 404 })
    )

    const summary = await syncToRepositoriesHttp(
      "valid-token",
      ["owner/repo"],
      "SECRET_NAME",
      "secret-value"
    )

    expect(summary.total).toBe(1)
    expect(summary.successful).toBe(0)
    expect(summary.failed).toBe(1)
    expect(summary.results[0].success).toBe(false)
    expect(summary.results[0].error).toContain("Failed to get public key")
  })

  test("handles failed secret set", async () => {
    globalThis.fetch = mockFetch(async (url: string) => {
      if (url.includes("/public-key")) {
        return new Response(
          JSON.stringify({ key_id: "key123", key: validPublicKey }),
          { status: 200 }
        )
      }
      if (url.includes("/secrets/")) {
        return new Response(
          JSON.stringify({ message: "Permission denied" }),
          { status: 403 }
        )
      }
      return new Response(null, { status: 404 })
    })

    const summary = await syncToRepositoriesHttp(
      "valid-token",
      ["owner/repo"],
      "SECRET_NAME",
      "secret-value"
    )

    expect(summary.total).toBe(1)
    expect(summary.successful).toBe(0)
    expect(summary.failed).toBe(1)
    expect(summary.results[0].success).toBe(false)
  })

  test("handles multiple repositories with mixed results", async () => {
    globalThis.fetch = mockFetch(async (url: string) => {
      if (url.includes("/public-key")) {
        if (url.includes("failing-repo")) {
          return new Response(
            JSON.stringify({ message: "Not found" }),
            { status: 404 }
          )
        }
        return new Response(
          JSON.stringify({ key_id: "key123", key: validPublicKey }),
          { status: 200 }
        )
      }
      if (url.includes("/secrets/")) {
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    })

    const summary = await syncToRepositoriesHttp(
      "valid-token",
      ["owner/repo1", "owner/failing-repo", "owner/repo2"],
      "SECRET_NAME",
      "secret-value"
    )

    expect(summary.total).toBe(3)
    expect(summary.successful).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.results[0].success).toBe(true)
    expect(summary.results[1].success).toBe(false)
    expect(summary.results[2].success).toBe(true)
  })

  test("returns empty summary for empty repository list", async () => {
    const summary = await syncToRepositoriesHttp(
      "valid-token",
      [],
      "SECRET_NAME",
      "secret-value"
    )

    expect(summary.total).toBe(0)
    expect(summary.successful).toBe(0)
    expect(summary.failed).toBe(0)
    expect(summary.results).toHaveLength(0)
  })
})
