import type { PluginInput } from "@opencode-ai/plugin"
import type { SyncResult, SyncSummary } from "./types"

type Shell = PluginInput["$"]

async function syncToRepo(
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

export async function syncToRepositories(
  $: Shell,
  repositories: string[],
  secretName: string,
  secretValue: string
): Promise<SyncSummary> {
  const results: SyncResult[] = []

  for (const repo of repositories) {
    const result = await syncToRepo($, repo, secretName, secretValue)
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

export async function verifyGhAuth($: Shell): Promise<boolean> {
  try {
    const result = await $`gh auth status`.nothrow().quiet()
    return result.exitCode === 0
  } catch {
    return false
  }
}
