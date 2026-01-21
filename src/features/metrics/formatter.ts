import { AggregatedMetadata, FileMetricsContext, MetadataConfig } from './types'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i]
}

type MetricRule = {
  key: string
  section: 'volume' | 'issues'
  enabledBy?: string
  resolveHeader?: (metrics: AggregatedMetadata) => number | string | undefined
  resolveFile?: (file: FileMetricsContext) => number | string | undefined
  formatHeader?: (
    value: number | string | undefined,
    metrics: AggregatedMetadata,
  ) => string | undefined
  formatFile?: (value: number | string | undefined, file: FileMetricsContext) => string | undefined
}

const DISPLAY_MAP: MetricRule[] = [
  {
    key: 'bytes',
    section: 'volume',
    enabledBy: 'stats',
    resolveHeader: (m) => m.bytes,
    formatHeader: (v) => (typeof v === 'number' ? formatBytes(v) : undefined),
    resolveFile: (f) => f.size,
    formatFile: (v) => (typeof v === 'number' ? `Size: ${v} B` : undefined),
  },
  {
    key: 'lines',
    section: 'volume',
    enabledBy: 'stats',
    resolveHeader: (m) => m.values.lines,
    formatHeader: (v) => (typeof v === 'number' ? `${v.toLocaleString()} Lines` : undefined),
    resolveFile: (f) => f.metadata['lines'] as number | undefined,
    formatFile: (v) => (typeof v === 'number' ? `Lines: ${v}` : undefined),
  },
  {
    key: 'chars',
    section: 'volume',
    enabledBy: 'chars',
    resolveHeader: (m) => m.values.chars,
    formatHeader: (v) => (typeof v === 'number' ? `${v.toLocaleString()} Chars` : undefined),
  },
  {
    key: 'issues',
    section: 'issues',
    enabledBy: 'issuesSummary',
    formatHeader: (_, m) => {
      const err = m.values.errors || 0
      const warn = m.values.warnings || 0
      if (err > 0 || warn > 0) return `${err} Errors, ${warn} Warnings`
      return undefined
    },
  },
]

function isEnabled(config: MetadataConfig, key?: string): boolean {
  if (!key) return false
  return Boolean(config?.[key])
}

function renderHeaderParts(
  metrics: AggregatedMetadata,
  config: MetadataConfig,
  section: MetricRule['section'],
): string[] {
  return DISPLAY_MAP.filter((r) => r.section === section)
    .filter((r) => isEnabled(config, r.enabledBy || r.key))
    .map((r) => {
      const value = r.resolveHeader ? r.resolveHeader(metrics) : metrics.values[r.key]
      return r.formatHeader ? r.formatHeader(value, metrics) : undefined
    })
    .filter((v): v is string => Boolean(v))
}

export function formatFileStatsLine(
  file: FileMetricsContext,
  config: MetadataConfig,
): string | undefined {
  if (!isEnabled(config, 'stats')) return undefined

  const parts = DISPLAY_MAP.filter((r) => r.formatFile)
    .filter((r) => isEnabled(config, r.enabledBy || r.key))
    .map((r) => {
      const value = r.resolveFile ? r.resolveFile(file) : undefined
      return r.formatFile ? r.formatFile(value, file) : undefined
    })
    .filter((v): v is string => Boolean(v))

  if (!parts.length) return undefined

  return `> ${parts.join(' | ')}${file.impact ? ' | ' + file.impact : ''}`
}

export function formatMetricsHeader(
  metrics: AggregatedMetadata,
  config: MetadataConfig,
  enhancedMeta?: Record<string, string>,
): string {
  const hasEnhancedMeta = Boolean(enhancedMeta && Object.keys(enhancedMeta).length > 0)
  const hasMetrics =
    renderHeaderParts(metrics, config, 'volume').length > 0 ||
    renderHeaderParts(metrics, config, 'issues').length > 0

  const hasContent = Boolean(config?.['banner'] || hasMetrics || hasEnhancedMeta)

  if (!hasContent) return ''

  const parts: string[] = []
  const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const line = '─'.repeat(50)
  const dblLine = '═'.repeat(50)

  if (config.banner) {
    parts.push(dblLine)
    parts.push(`  CONTEXT SUMMARY`)
    parts.push(dblLine)
  } else {
    parts.push(line)
  }

  parts.push(`  Generated : ${dateStr}`)
  parts.push(`  Files     : ${metrics.fileCount}`)

  if (enhancedMeta && Object.keys(enhancedMeta).length > 0) {
    if (config.banner) parts.push(line)
    for (const [key, value] of Object.entries(enhancedMeta)) {
      parts.push(`  ${key.padEnd(10)}: ${value}`)
    }
  }

  if (hasMetrics) {
    parts.push(line)
    const volumeParts = renderHeaderParts(metrics, config, 'volume')
    if (volumeParts.length) parts.push(`  Volume      : ${volumeParts.join(' | ')}`)

    const issueParts = renderHeaderParts(metrics, config, 'issues')
    if (issueParts.length) parts.push(`  Issues      : ${issueParts.join(' | ')}`)
  }

  parts.push(config.banner ? dblLine + '\n' : '\n')
  return parts.join('\n')
}
