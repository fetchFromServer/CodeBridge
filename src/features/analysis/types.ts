import * as vscode from 'vscode'

export type AnalysisStrategy = 'none' | 'shallow' | 'deep'

export interface AnalysisResult {
  log: string
  relatedUris: vscode.Uri[]
}
