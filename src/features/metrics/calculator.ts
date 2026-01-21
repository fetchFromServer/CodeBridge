import { AggregatedMetadata, MetadataBag } from './types'

export function calculateDynamicMetrics(content: string, diagnostics?: string): MetadataBag {
  const lineMatches = content.match(/\n/g)
  return {
    lines: lineMatches ? lineMatches.length + 1 : content.length > 0 ? 1 : 0,
    chars: content.length,
    errors: (diagnostics?.match(/❌/g) || []).length,
    warnings: (diagnostics?.match(/⚠️/g) || []).length,
  }
}

export function aggregateMetadata(
  files: Array<{ metadata?: MetadataBag; size: number }>,
): AggregatedMetadata {
  const summary: AggregatedMetadata = {
    fileCount: files.length,
    bytes: files.reduce((s, f) => s + f.size, 0),
    values: {},
  }

  files.forEach((f) => {
    const meta = f.metadata || {}
    Object.entries(meta).forEach(([key, val]) => {
      if (typeof val === 'number') {
        const current = (summary.values[key] as number) || 0
        summary.values[key] = current + val
      }
    })
  })

  return summary
}
