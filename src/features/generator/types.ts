export interface FileData {
  filePath: string
  content: string
}

export interface GeneratorConfig {
  overwriteExisting: boolean
  confirmBeforeWrite: boolean
}

export type OverwritePolicy = {
  value: 'ask' | 'overwrite' | 'skip'
}
