export type MetadataBag = Record<string, unknown>

export interface AggregatedMetadata {
  fileCount: number
  bytes: number
  values: Record<string, number>
}

export type MetadataConfig = Record<string, boolean>

export interface FileMetricsContext {
  size: number
  metadata: MetadataBag
  impact?: string
}
