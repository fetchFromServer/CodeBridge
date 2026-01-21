import * as vscode from 'vscode'
import { ConfigEngine, DynamicConfig } from '../../core/config'
import { Logger, StatusBarManager } from '../../core/utils'
import { DiagnosticAnalyzer } from './processing/Analyzer'
import { ReportFormatter } from './processing/Formatter'

function mapToSettings(config: DynamicConfig) {
  const sevMap: Record<string, vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
  }

  return {
    contextPadding: config.contextLines ?? 2,
    maxFixes: 5,
    minSeverity: sevMap[config.minimumSeverity] ?? vscode.DiagnosticSeverity.Warning,
  }
}

export async function generateDiagnosticsReport(
  uris: vscode.Uri[],
  logger: Logger,
  statusBar: StatusBarManager,
): Promise<void> {
  statusBar.update('working', 'Scanning for issues...')

  const config = ConfigEngine.get('diagnostics')
  const showSuccess = config.showSuccessNotifications
  const showErrors = config.showErrorNotifications

  try {
    const settings = mapToSettings(config)

    const analyzer = new DiagnosticAnalyzer(settings)

    let groups = analyzer.groupDiagnostics(uris)

    let isFallback = false
    if (groups.length === 0) {
      if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        groups = analyzer.getWorkspaceDiagnostics()
        if (groups.length > 0) {
          isFallback = true
          vscode.window.showInformationMessage(
            `Selection is clean. Found ${groups.length} issues in workspace.`,
          )
        }
      }
    }

    if (groups.length === 0) {
      vscode.window.showInformationMessage(
        'System healthy. No issues found in selection or workspace.',
      )
      statusBar.update('idle')
      return
    }

    const analyzed = await Promise.all(groups.map((g) => analyzer.analyzeGroup(g)))
    const report = ReportFormatter.render(analyzed)

    await vscode.env.clipboard.writeText(report)

    const count = groups.length
    const label = isFallback ? 'Workspace issues' : 'Selection issues'
    if (showSuccess) {
      statusBar.update('success', `Copied ${count} ${label}`, 4000)
    } else {
      statusBar.update('idle')
    }
  } catch (e) {
    logger.error('Diagnostic Report failed', e)
    if (showErrors) statusBar.update('error', 'Report failed')
    else statusBar.update('idle')
  }
}

export async function collectDiagnostics(
  uri: vscode.Uri,
  style: 'compact' | 'detailed' = 'compact',
): Promise<string> {
  const config = ConfigEngine.get('diagnostics')
  const settings = mapToSettings(config)

  if (style === 'compact') {
    const diags = vscode.languages
      .getDiagnostics(uri)
      .filter((d) => d.severity <= settings.minSeverity)
    if (!diags.length) return ''

    const lines = new Set<string>()
    for (const d of diags) {
      const line = d.range.start.line + 1
      const icon = d.severity === vscode.DiagnosticSeverity.Error ? '❌' : '⚠️'
      lines.add(`> ${icon} L${line}: ${d.message}`)
    }
    return Array.from(lines).slice(0, 5).join('\n')
  }

  try {
    const analyzer = new DiagnosticAnalyzer(settings)
    const groups = analyzer.groupDiagnostics([uri])
    if (!groups.length) return ''
    const analyzed = await analyzer.analyzeGroup(groups[0])
    return ReportFormatter.render([analyzed])
  } catch {
    return ''
  }
}
