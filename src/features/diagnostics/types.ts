import * as vscode from 'vscode'

export interface DiagnosticGroup {
  line: number
  range: vscode.Range
  maxSeverity: vscode.DiagnosticSeverity
  sources: Set<string>
  messages: Set<string>
  related: vscode.DiagnosticRelatedInformation[]
}

export interface AnalyzedGroup {
  icon: string
  location: string
  lineNum: string
  messages: string[]
  codeWindow: string
  traces: string[]
  fixes: string[]
}