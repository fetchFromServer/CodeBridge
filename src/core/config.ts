import * as vscode from 'vscode'

export type DynamicConfig = Record<string, any>

const SCOPE_LAYERS: Record<string, string[]> = {
  global: [],
  tree: ['tree'],
  copy: ['copy', 'diagnostics', 'analysis'],
  generator: ['generator'],
  diagnostics: ['diagnostics'],
}

export class ConfigEngine {
  private static SECTION = 'codeBridge'

  public static get(scope: string, overrides: DynamicConfig = {}): DynamicConfig {
    const raw = vscode.workspace.getConfiguration(this.SECTION)

    let config: DynamicConfig = this.loadBaseLayer(raw)

    const layers = SCOPE_LAYERS[scope] || []
    for (const layer of layers) {
      const layerData = raw.get<DynamicConfig>(layer, {})
      config = this.mergeLayers(config, layerData)
    }

    config = this.mergeLayers(config, overrides)
    config.excludePatterns = this.resolveExcludes(config.excludes || [])
    config.isNotificationsEnabled = config.notifications !== 'none'
    config.showSuccessNotifications = config.notifications === 'all'
    config.showErrorNotifications = config.notifications !== 'none'

    return config
  }

  private static loadBaseLayer(raw: vscode.WorkspaceConfiguration): DynamicConfig {
    return {
      notifications: raw.get('general.notifications', 'all'),
      prompts: raw.get('general.prompts', {}),
      excludes: raw.get('filters.excludes', []),
      binaryExtensions: raw.get('filters.binaryExtensions', []),
      limits: {
        maxFileSize: raw.get<number>('safety.maxFileSizeKB', 10240) * 1024,
        clipboardThreshold: raw.get<number>('safety.clipboardWarningKB', 5120) * 1024,
      },
    }
  }

  private static mergeLayers(base: DynamicConfig, layer: DynamicConfig): DynamicConfig {
    const result = { ...base }
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) {
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          typeof result[key] === 'object' &&
          result[key] !== null &&
          !Array.isArray(result[key])
        ) {
          result[key] = { ...result[key], ...value }
        } else {
          result[key] = value
        }
      }
    }
    return result
  }

  private static resolveExcludes(extensionExcludes: string[]): string[] {
    const vscodeConfig = vscode.workspace.getConfiguration()
    const filesExclude = vscodeConfig.get<Record<string, boolean>>('files.exclude') || {}
    const searchExclude = vscodeConfig.get<Record<string, boolean>>('search.exclude') || {}

    const patterns = new Set<string>([...extensionExcludes, '**/.git'])

    Object.entries(filesExclude).forEach(([k, v]) => v && patterns.add(k))
    Object.entries(searchExclude).forEach(([k, v]) => v && patterns.add(k))

    return Array.from(patterns)
  }
}
