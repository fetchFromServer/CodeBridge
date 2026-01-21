import * as vscode from 'vscode'
import { AnalyzedGroup, DiagnosticGroup } from '../types'

export interface AnalyzerSettings {
  contextPadding: number
  maxFixes: number
  minSeverity: vscode.DiagnosticSeverity
}

const GENERIC_FIX_FILTERS = new Set([
  'fix',
  'explain',
  'fix all',
  'quick fix',
  'learn more',
  'documentation',
  'ignore',
  'disable',
  'show fixes',
  'insert',
  'replace',
  'generate',
])

export class DiagnosticAnalyzer {
  constructor(private settings: AnalyzerSettings) {}

  /**
   * Scannt nur die angegebenen Dateien.
   */
  public groupDiagnostics(uris: vscode.Uri[]): { uri: vscode.Uri; group: DiagnosticGroup }[] {
    const result: { uri: vscode.Uri; group: DiagnosticGroup }[] = []

    for (const uri of uris) {
      const diags = vscode.languages
        .getDiagnostics(uri)
        .filter((d) => d.severity <= this.settings.minSeverity)

      if (diags.length > 0) {
        result.push(...this.processDiagnostics(uri, diags))
      }
    }
    return result
  }

  /**
   * NEU: Scannt den gesamten Workspace (Fallback).
   * Nutzt die globale Diagnostic Collection von VS Code.
   */
  public getWorkspaceDiagnostics(): { uri: vscode.Uri; group: DiagnosticGroup }[] {
    const result: { uri: vscode.Uri; group: DiagnosticGroup }[] = []

    const all = vscode.languages.getDiagnostics()

    for (const [uri, diags] of all) {
      const relevant = diags.filter((d) => d.severity <= this.settings.minSeverity)

      if (relevant.length > 0) {
        result.push(...this.processDiagnostics(uri, relevant))
      }
    }

    return result.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath))
  }

  /**
   * Helper: Wandelt VS Code Diagnostics in unsere Gruppen-Struktur um.
   */
  private processDiagnostics(
    uri: vscode.Uri,
    diags: vscode.Diagnostic[],
  ): { uri: vscode.Uri; group: DiagnosticGroup }[] {
    const groups = new Map<number, DiagnosticGroup>()
    const out: { uri: vscode.Uri; group: DiagnosticGroup }[] = []

    for (const d of diags) {
      const line = d.range.start.line
      if (!groups.has(line)) {
        groups.set(line, {
          line,
          range: d.range,
          maxSeverity: d.severity,
          sources: new Set(),
          messages: new Set(),
          related: [],
        })
      }

      const g = groups.get(line)!
      if (d.severity < g.maxSeverity) g.maxSeverity = d.severity
      if (d.source) g.sources.add(d.source)
      g.messages.add(d.message)
      if (d.relatedInformation) g.related.push(...d.relatedInformation)
      g.range = g.range.union(d.range)
    }

    Array.from(groups.values())
      .sort((a, b) => a.line - b.line)
      .forEach((g) => out.push({ uri, group: g }))

    return out
  }

  public async analyzeGroup(item: {
    uri: vscode.Uri
    group: DiagnosticGroup
  }): Promise<AnalyzedGroup> {
    const { uri, group } = item
    const relativePath = vscode.workspace.asRelativePath(uri)
    const icon = group.maxSeverity === vscode.DiagnosticSeverity.Error ? '❌' : '⚠️'

    const [codeWindow, traces, fixes] = await Promise.all([
      this.readCodeWindow(uri, group.line),
      this.resolveTraces(group.related),
      this.getFixes(uri, group.range),
    ])

    return {
      icon,
      location: relativePath,
      lineNum: (group.line + 1).toString(),
      messages: Array.from(group.messages),
      codeWindow,
      traces,
      fixes,
    }
  }

  private async readCodeWindow(uri: vscode.Uri, centerLine: number): Promise<string> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri)

      const pad = this.settings.contextPadding
      const isUnlimited = pad === 0

      const start = isUnlimited ? 0 : Math.max(0, centerLine - pad)
      const end = isUnlimited ? doc.lineCount - 1 : Math.min(doc.lineCount - 1, centerLine + pad)

      const text = doc.getText(new vscode.Range(start, 0, end, 9999))

      return text
        .split('\n')
        .map((l, i) => {
          const current = start + i
          const marker = current === centerLine ? '>> ' : '   '
          return `${marker}${(current + 1).toString().padEnd(4)}| ${l}`
        })
        .join('\n')
    } catch {
      return '   (Source unavailable)'
    }
  }

  private async resolveTraces(related: vscode.DiagnosticRelatedInformation[]): Promise<string[]> {
    if (!related.length) return []
    const unique = new Set<string>()
    const out: string[] = []

    for (const r of related) {
      const key = `${r.message}@${r.location.uri.fsPath}:${r.location.range.start.line}`
      if (unique.has(key)) continue
      unique.add(key)

      try {
        const file = vscode.workspace.asRelativePath(r.location.uri)
        out.push(`${r.message} @ ${file}:${r.location.range.start.line + 1}`)
      } catch {
        out.push(r.message)
      }
    }
    return out
  }

  private async getFixes(uri: vscode.Uri, range: vscode.Range): Promise<string[]> {
    try {
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        uri,
        range,
      )
      if (!actions) return []

      const relevant = actions
        .filter((a) => a.kind && vscode.CodeActionKind.QuickFix.contains(a.kind))
        .map((a) => a.title.trim())
        .filter((title) => {
          const t = title.toLowerCase()
          if (GENERIC_FIX_FILTERS.has(t)) return false
          if (t.startsWith('learn more')) return false
          return true
        })

      return Array.from(new Set(relevant)).slice(0, this.settings.maxFixes)
    } catch {
      return []
    }
  }
}
