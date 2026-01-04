#!/usr/bin/env bun
import * as p from "@clack/prompts"
import color from "picocolors"
import { writeFileSync, mkdirSync } from "fs"
import { loadPluginConfigSync, mergeConfig } from "./lib/config"
import {
  OPENCODE_CONFIG_DIR,
  PLUGIN_CONFIG_PATH,
  checkGhCli,
  checkGhAuth,
  getGhRepos,
  loadOpencodeConfig,
  saveOpencodeConfig,
  isPluginInstalled,
  addPluginToConfig,
} from "./lib/cli-utils"

async function main() {
  console.clear()

  p.intro(color.bgCyan(color.black(" opencode-auth-sync setup ")))

  const s = p.spinner()

  s.start("Checking prerequisites")

  const hasGh = checkGhCli()
  if (!hasGh) {
    s.stop("GitHub CLI not found")
    p.cancel("Please install GitHub CLI: https://cli.github.com")
    process.exit(1)
  }

  const hasGhAuth = checkGhAuth()
  if (!hasGhAuth) {
    s.stop("GitHub CLI not authenticated")
    p.cancel("Please run: gh auth login")
    process.exit(1)
  }

  s.stop("Prerequisites OK")

  const opencodeConfig = loadOpencodeConfig()
  const alreadyInstalled = isPluginInstalled(opencodeConfig)

  if (alreadyInstalled) {
    p.log.info("Plugin already installed in opencode.json")
  }

  s.start("Fetching your GitHub repositories")
  const repos = getGhRepos()
  s.stop(`Found ${repos.length} repositories`)

  if (repos.length === 0) {
    p.cancel("No repositories found. Make sure you have access to at least one repository.")
    process.exit(1)
  }

  const existingConfig = loadPluginConfigSync(PLUGIN_CONFIG_PATH)
  const existingRepos = existingConfig.repositories || []

  const repoOptions = repos.map((repo) => ({
    value: repo.nameWithOwner,
    label: repo.nameWithOwner,
    hint: repo.isPrivate ? "private" : "public",
  }))

  const selectedRepos = await p.multiselect({
    message: "Select repositories to sync auth credentials to",
    options: repoOptions,
    initialValues: existingRepos.filter((r) => repos.some((repo) => repo.nameWithOwner === r)),
    required: true,
  })

  if (p.isCancel(selectedRepos)) {
    p.cancel("Setup cancelled")
    process.exit(0)
  }

  const existingSecretName = existingConfig.secretName || "OPENCODE_AUTH"
  const secretName = await p.text({
    message: "GitHub secret name",
    placeholder: existingSecretName,
    defaultValue: existingSecretName,
    validate: (value) => {
      if (value && !/^[A-Z_][A-Z0-9_]*$/.test(value)) {
        return "Use uppercase letters, numbers, and underscores only"
      }
    },
  })

  if (p.isCancel(secretName)) {
    p.cancel("Setup cancelled")
    process.exit(0)
  }

  const confirmed = await p.confirm({
    message: `Install plugin and sync to ${(selectedRepos as string[]).length} repositories?`,
    initialValue: true,
  })

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Setup cancelled")
    process.exit(0)
  }

  s.start("Configuring plugin")

  mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true })
  
  const userUpdates = {
    repositories: selectedRepos as string[],
    secretName: secretName || existingSecretName,
  }
  const mergedConfig = mergeConfig(existingConfig, userUpdates)
  const pluginConfig = {
    $schema: "https://raw.githubusercontent.com/activadee/opencode-auth-sync/main/schema.json",
    ...mergedConfig,
  }
  writeFileSync(PLUGIN_CONFIG_PATH, JSON.stringify(pluginConfig, null, 2) + "\n")

  if (!alreadyInstalled) {
    const updatedConfig = addPluginToConfig(opencodeConfig)
    saveOpencodeConfig(updatedConfig)
  }

  s.stop("Configuration saved")

  p.note(
    [
      `${color.dim("Plugin config:")} ~/.config/opencode/opencode-auth-sync.json`,
      `${color.dim("Secret name:")}   ${secretName || "OPENCODE_AUTH"}`,
      `${color.dim("Repositories:")}  ${(selectedRepos as string[]).length} selected`,
      "",
      ...((selectedRepos as string[]).map((r) => `  ${color.green("✓")} ${r}`)),
    ].join("\n"),
    "Configuration"
  )

  p.outro(
    `${color.green("Done!")} Restart OpenCode to activate the plugin.`
  )
}

main().catch((err) => {
  p.cancel(`Error: ${err.message}`)
  process.exit(1)
})
