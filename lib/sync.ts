import type { PluginInput } from "@opencode-ai/plugin"
import type { GithubMethod, SyncResult, SyncSummary } from "./types"
import { syncToRepositoriesHttp, verifyGithubToken } from "./github-http"

type Shell = PluginInput["$"]

async function syncToRepoGh(
  $: Shell,
  repository: string,
  secretName: string,
  secretValue: string
): Promise<SyncResult> {
  try {
    const result = await $`gh secret set ${secretName} --repo ${repository} --body ${secretValue}`.nothrow().quiet()

    return {
      repository,
      success: result.exitCode === 0,
      error: result.exitCode !== 0 ? result.stderr.toString() : undefined,
    }
  } catch (error) {
    return {
      repository,
      success: false,
      error: (error as Error).message,
    }
  }
}

async function syncToRepositoriesGh(
  $: Shell,
  repositories: string[],
  secretName: string,
  secretValue: string
): Promise<SyncSummary> {
  const results: SyncResult[] = []

  for (const repo of repositories) {
    const result = await syncToRepoGh($, repo, secretName, secretValue)
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

export interface SyncOptions {
  method: GithubMethod
  githubToken?: string
}

/**
 * Sync secrets to repositories using either gh CLI or HTTP API
 */
export async function syncToRepositories(
  $: Shell,
  repositories: string[],
  secretName: string,
  secretValue: string,
  options: SyncOptions = { method: "gh" }
): Promise<SyncSummary> {
  if (options.method === "http") {
    if (!options.githubToken) {
      return {
        total: repositories.length,
        successful: 0,
        failed: repositories.length,
        results: repositories.map((repo) => ({
          repository: repo,
          success: false,
          error: "GitHub token is required for HTTP method",
        })),
      }
    }
    return syncToRepositoriesHttp(options.githubToken, repositories, secretName, secretValue)
  }

  return syncToRepositoriesGh($, repositories, secretName, secretValue)
}

/**
 * Verify GitHub authentication based on method
 */
export async function verifyGhAuth($: Shell): Promise<boolean> {
  try {
    const result = await $`gh auth status`.nothrow().quiet()
    return result.exitCode === 0
  } catch {
    return false
  }
}

/**
 * Verify authentication based on method
 */
export async function verifyAuth(
  $: Shell,
  method: GithubMethod,
  githubToken?: string
): Promise<boolean> {
  if (method === "http") {
    if (!githubToken) {
      return false
    }
    return verifyGithubToken(githubToken)
  }
  return verifyGhAuth($)
}
