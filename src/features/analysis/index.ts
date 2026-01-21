import * as vscode from 'vscode'
import { getImpactAnalysis } from './strategies'
import { AnalysisStrategy } from './types'

export * from './types'

export class ContextManager {
  static async getFileMetadata(
    uri: vscode.Uri,
    strategy: AnalysisStrategy | undefined,
    enabled: boolean,
  ): Promise<string> {
    if (!enabled || !strategy || strategy === 'none') return ''
    return (await getImpactAnalysis(uri, strategy)).log
  }

  static async expandContext(
    initial: vscode.Uri[],
    config: {
      enabled: boolean
      strategy: AnalysisStrategy
      maxFiles: number
      excludePatterns: string[]
    },
    onProgress: (m: string) => void,
  ): Promise<{ uris: Set<string>; addedCount: number }> {
    const finalUris = new Set<string>(initial.map((u) => u.toString()))
    if (!config.enabled || config.strategy === 'none') return { uris: finalUris, addedCount: 0 }

    onProgress('Analyzing dependencies...')
    let addedCount = 0

    for (const uri of initial) {
      if (addedCount >= config.maxFiles) break
      const analysis = await getImpactAnalysis(uri, config.strategy)
      for (const rUri of analysis.relatedUris) {
        if (addedCount >= config.maxFiles) break
        if (!finalUris.has(rUri.toString())) {
          finalUris.add(rUri.toString())
          addedCount++
        }
      }
    }
    return { uris: finalUris, addedCount }
  }
}
