export interface AuthSyncConfig {
  enabled: boolean
  credentialsPath: string
  secretName: string
  repositories: string[]
  debounceMs?: number
  authFileHashes?: Record<string, string>
}

export interface OAuthEntry {
  type: "oauth"
  refresh: string
  access: string
  expires: number
}

export interface ApiKeyEntry {
  type: "api"
  key: string
}

export interface OpenCodeAuth {
  [provider: string]: OAuthEntry | ApiKeyEntry
}

export interface SyncResult {
  repository: string
  success: boolean
  error?: string
}

export interface SyncSummary {
  total: number
  successful: number
  failed: number
  results: SyncResult[]
}
