import type { SyncResult, SyncSummary } from "./types"

const GITHUB_API_BASE = "https://api.github.com"

interface GithubPublicKey {
  key_id: string
  key: string
}

interface GithubRepo {
  full_name: string
  private: boolean
  description: string | null
}

interface GithubUser {
  login: string
}

async function githubFetch<T>(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { ok: false, status: response.status, error: errorText }
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return { ok: true, status: response.status }
    }

    const data = (await response.json()) as T
    return { ok: true, status: response.status, data }
  } catch (error) {
    return { ok: false, status: 0, error: (error as Error).message }
  }
}

/**
 * Encrypt a secret value using libsodium sealed box encryption
 * GitHub requires secrets to be encrypted with the repository's public key
 */
async function encryptSecret(publicKeyBase64: string, secretValue: string): Promise<string> {
  // Dynamically import tweetnacl-sealedbox-js
  const nacl = await import("tweetnacl")
  const { seal } = await import("tweetnacl-sealedbox-js")

  // Decode the public key from base64
  const publicKeyBytes = Uint8Array.from(atob(publicKeyBase64), (c) => c.charCodeAt(0))

  // Convert secret to bytes
  const secretBytes = new TextEncoder().encode(secretValue)

  // Encrypt using sealed box
  const encryptedBytes = seal(secretBytes, publicKeyBytes)

  // Return as base64
  return btoa(String.fromCharCode(...encryptedBytes))
}

/**
 * Get the public key for a repository (needed for secret encryption)
 */
async function getRepoPublicKey(
  token: string,
  owner: string,
  repo: string
): Promise<{ ok: boolean; key?: GithubPublicKey; error?: string }> {
  const result = await githubFetch<GithubPublicKey>(
    `/repos/${owner}/${repo}/actions/secrets/public-key`,
    token
  )

  if (!result.ok) {
    return { ok: false, error: result.error || `HTTP ${result.status}` }
  }

  return { ok: true, key: result.data }
}

/**
 * Set a repository secret using the GitHub API
 */
async function setRepoSecretHttp(
  token: string,
  repository: string,
  secretName: string,
  secretValue: string
): Promise<SyncResult> {
  const [owner, repo] = repository.split("/")

  // Get the public key
  const keyResult = await getRepoPublicKey(token, owner, repo)
  if (!keyResult.ok || !keyResult.key) {
    return {
      repository,
      success: false,
      error: `Failed to get public key: ${keyResult.error}`,
    }
  }

  // Encrypt the secret
  let encryptedValue: string
  try {
    encryptedValue = await encryptSecret(keyResult.key.key, secretValue)
  } catch (error) {
    return {
      repository,
      success: false,
      error: `Failed to encrypt secret: ${(error as Error).message}`,
    }
  }

  // Set the secret
  const result = await githubFetch(
    `/repos/${owner}/${repo}/actions/secrets/${secretName}`,
    token,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        encrypted_value: encryptedValue,
        key_id: keyResult.key.key_id,
      }),
    }
  )

  if (!result.ok) {
    return {
      repository,
      success: false,
      error: result.error || `HTTP ${result.status}`,
    }
  }

  return { repository, success: true }
}

/**
 * Sync secrets to multiple repositories using HTTP API
 */
export async function syncToRepositoriesHttp(
  token: string,
  repositories: string[],
  secretName: string,
  secretValue: string
): Promise<SyncSummary> {
  const results: SyncResult[] = []

  for (const repo of repositories) {
    const result = await setRepoSecretHttp(token, repo, secretName, secretValue)
    results.push(result)
  }

  const successful = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  return {
    total: repositories.length,
    successful,
    failed,
    results,
  }
}

/**
 * Verify that a GitHub token is valid
 */
export async function verifyGithubToken(token: string): Promise<boolean> {
  const result = await githubFetch<GithubUser>("/user", token)
  return result.ok
}

/**
 * Get repositories for the authenticated user via HTTP API
 */
export async function getGithubReposHttp(
  token: string
): Promise<{ nameWithOwner: string; isPrivate: boolean; description: string | null }[]> {
  const result = await githubFetch<GithubRepo[]>(
    "/user/repos?per_page=100&sort=updated",
    token
  )

  if (!result.ok || !result.data) {
    return []
  }

  return result.data.map((repo) => ({
    nameWithOwner: repo.full_name,
    isPrivate: repo.private,
    description: repo.description,
  }))
}
