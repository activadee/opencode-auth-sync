# @activade/opencode-auth-sync

OpenCode plugin that automatically syncs your authentication credentials to GitHub repositories as secrets whenever they change.

## Why?

When using OpenCode with Claude Max, OpenAI, or other OAuth providers, your tokens refresh periodically. This plugin watches for those changes and automatically syncs the updated credentials to your GitHub repositories, keeping your CI/CD workflows authenticated.

## Quick Start

```bash
bunx @activade/opencode-auth-sync
```

The interactive setup wizard will:
1. Check prerequisites (GitHub CLI)
2. List your repositories
3. Let you select which repos to sync
4. Configure the plugin automatically

Running the wizard again will merge your changes with the existing configuration, preserving any custom settings like `debounceMs` or `credentialsPath` that you've modified.

## Manual Installation

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "@activade/opencode-auth-sync"
  ]
}
```

Create `~/.config/opencode/opencode-auth-sync.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/activadee/opencode-auth-sync/main/schema.json",
  "enabled": true,
  "repositories": [
    "your-username/repo1",
    "your-org/private-repo"
  ]
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `credentialsPath` | string | `~/.local/share/opencode/auth.json` | Path to OpenCode auth file |
| `secretName` | string | `OPENCODE_AUTH_JSON` | GitHub secret name |
| `repositories` | string[] | `[]` | Repositories to sync (`owner/repo` format) |
| `debounceMs` | number | `1000` | Debounce delay for file changes |
| `authFileHash` | string | (auto-managed) | SHA-256 hash of last synced auth.json (managed by plugin) |

## Prerequisites

- [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)
- Write access to target repositories

## How It Works

1. Plugin watches `~/.local/share/opencode/auth.json` for changes
2. When tokens refresh, the file updates
3. Plugin computes a SHA-256 hash of the file content and compares it against the stored hash
4. If the hash differs (content actually changed), syncs to configured repositories via `gh secret set`
5. Toast notifications show sync status

The hash-based change detection reduces unnecessary GitHub API calls when file metadata changes but content remains the same.

## Using the Secret in GitHub Actions

```yaml
# .github/workflows/example.yml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Setup OpenCode Auth
        run: |
          mkdir -p ~/.local/share/opencode
          echo '${{ secrets.OPENCODE_AUTH_JSON }}' > ~/.local/share/opencode/auth.json
```

### Extracting Specific Tokens

```yaml
- name: Extract Anthropic Token
  run: |
    ANTHROPIC_TOKEN=$(echo '${{ secrets.OPENCODE_AUTH_JSON }}' | jq -r '.anthropic.access')
    echo "::add-mask::$ANTHROPIC_TOKEN"
    echo "ANTHROPIC_API_KEY=$ANTHROPIC_TOKEN" >> $GITHUB_ENV
```

## Synced Providers

The auth file contains credentials for all configured OpenCode providers:

- `anthropic` - Claude Max (OAuth)
- `openai` - ChatGPT Plus/Pro (OAuth)
- `google` - Gemini (OAuth)
- API key providers

## License

MIT
