import { DynamicConfig } from '../../../core/config'
import { aggregateMetadata, formatFileStatsLine, formatMetricsHeader } from '../../metrics/index'
import { FileContent } from './FileProcessor'

export class OutputFormatter {
  public static format(
    files: FileContent[],
    config: DynamicConfig,
    prompt?: string,
    meta?: Record<string, string>,
  ): string {
    if (config.format === 'text') {
      return files.map((f) => f.content).join('\n\n')
    }

    const parts: string[] = []

    if (prompt) {
      parts.push(`${prompt}\n\n---\n`)
    }

    const aggregated = aggregateMetadata(files)
    parts.push(formatMetricsHeader(aggregated, config.metadata || {}, meta))

    const transform = config.transform || {}
    const fenceStyle = config.fenceStyle || transform.codeFence || '```'

    for (const f of files) {
      const fence = this.getDynamicFence(f.content, fenceStyle)
      const lang = f.extension.replace(/^\./, '') || 'txt'

      let header = `## ${f.path}`

      const metaConfig = config.metadata || {}
      if (metaConfig.fileMetadata && f.lastModified) {
        header += ` (Modified: ${f.lastModified})`
      }

      parts.push(header)

      const statsLine = formatFileStatsLine(
        { size: f.size, metadata: f.metadata, impact: f.impact },
        metaConfig,
      )
      if (statsLine) parts.push(statsLine)

      if (f.diagnostics) {
        parts.push(f.diagnostics.trimEnd())
      }

      parts.push(`${fence}${lang}\n${f.content}\n${fence}\n`)
    }

    return parts.join('\n')
  }

  private static getDynamicFence(content: string, defaultFence: string): string {
    const matches = content.match(/`+/g)
    if (!matches) return defaultFence
    const maxLength = Math.max(...matches.map((m) => m.length))
    return maxLength >= defaultFence.length ? '`'.repeat(maxLength + 1) : defaultFence
  }
}
