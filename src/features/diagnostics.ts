import * as vscode from 'vscode'
import { getConfig, Logger } from '../utils'

interface DiagnosticSeverityConfig {
  error: boolean
  warning: boolean
  info: boolean
  hint: boolean
}

const IGNORED_FIX_TITLES = new Set([
  'fix',
  'explain',
  'fix all',
  'quick fix',
  'learn more',
  'documentation',
  'ignore',
  'disable',
  'show fixes',
  'more actions...',
  'configure',
])

async function fetchContextualSnippet(uri: vscode.Uri, range: vscode.Range): Promise<string | null> {
  try {
    const position = range.start
    let locs = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
      'vscode.executeTypeDefinitionProvider',
      uri,
      position
    )

    if (!locs || locs.length === 0) {
      locs = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
        'vscode.executeDefinitionProvider',
        uri,
        range
      )
    }

    if (!locs || locs.length === 0) return null

    const loc = Array.isArray(locs) ? locs[0] : locs
    let targetUri: vscode.Uri
    let targetRange: vscode.Range

    if ('targetUri' in loc) {
      targetUri = loc.targetUri
      targetRange = loc.targetRange
    } else {
      targetUri = loc.uri
      targetRange = loc.range
    }

    if (targetUri.toString() === uri.toString()) {
      const lineDiff = Math.abs(targetRange.start.line - range.start.line)
      if (lineDiff < 5) return null
    }

    const doc = await vscode.workspace.openTextDocument(targetUri)
    const startLine = Math.max(0, targetRange.start.line)
    const endLine = Math.min(doc.lineCount - 1, targetRange.end.line + 8)

    const snippetRange = new vscode.Range(startLine, 0, endLine, 1000)
    const snippet = doc.getText(snippetRange)
    const cleanSnippet = snippet.length > 500 ? snippet.substring(0, 500) + '\n// ... (truncated)' : snippet
    const fileName = targetUri.fsPath.split(/[\\/]/).pop()

    return `\n      -> Context (${fileName}:${targetRange.start.line + 1}):\n         \`${cleanSnippet
      .trim()
      .replace(/\n/g, '\n         ')}\``
  } catch (e) {
    return null
  }
}

export async function getFileDiagnostics(uri: vscode.Uri, enabled: boolean): Promise<string> {
  if (!enabled) return ''

  try {
    return await collectDiagnostics(uri)
  } catch (error) {
    Logger.getInstance().error(`Failed to collect diagnostics for ${uri.fsPath}`, error)
    return ''
  }
}

export async function collectDiagnostics(uri: vscode.Uri): Promise<string> {
  const diagnostics = vscode.languages.getDiagnostics(uri)

  if (!diagnostics || diagnostics.length === 0) {
    return ''
  }

  const severityConfig = getConfig<DiagnosticSeverityConfig>('codeBridge', 'diagnostics.allowedSeverities', {
    error: true,
    warning: true,
    info: false,
    hint: false,
  })

  const filteredDiagnostics = diagnostics.filter((d) => {
    switch (d.severity) {
      case vscode.DiagnosticSeverity.Error:
        return severityConfig.error
      case vscode.DiagnosticSeverity.Warning:
        return severityConfig.warning
      case vscode.DiagnosticSeverity.Information:
        return severityConfig.info
      case vscode.DiagnosticSeverity.Hint:
        return severityConfig.hint
      default:
        return false
    }
  })

  if (filteredDiagnostics.length === 0) return ''

  const sortedDiagnostics = filteredDiagnostics.slice().sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity
    return a.range.start.line - b.range.start.line
  })

  const topDiagnostics = sortedDiagnostics.slice(0, 5)

  const detailedEntries = await Promise.all(
    topDiagnostics.map(async (d) => {
      const line = d.range.start.line + 1
      const severityMap = ['ERROR', 'WARN', 'INFO', 'HINT']
      const severity = severityMap[d.severity] || 'UNK'

      let codeStr = ''
      if (d.code) {
        const val = typeof d.code === 'object' ? d.code.value : d.code
        codeStr = ` (${val})`
      }

      const sourceStr = d.source ? `[${d.source}]` : ''

      let cleanMessage = d.message
        .replace(/\[Click for full compiler diagnostic\]/g, '')
        .replace(/for further information visit https:\/\/\S+/g, '')
        .replace(/\(https:\/\/[^\)]+\)/g, '')
        .replace(/\s+/g, ' ')
        .trim()

      let contextStr = ''
      if (d.severity <= vscode.DiagnosticSeverity.Warning) {
        const ctx = await fetchContextualSnippet(uri, d.range)
        if (ctx) contextStr = ctx
      }

      let relatedStr = ''
      if (d.relatedInformation && d.relatedInformation.length > 0) {
        const uniqueRelated = new Set<string>()
        d.relatedInformation.forEach((ri) => {
          const fileName = ri.location.uri.fsPath.split(/[\\/]/).pop()
          const msg = `\n      -> Related: ${fileName}:${ri.location.range.start.line + 1}: ${ri.message}`
          uniqueRelated.add(msg)
        })
        relatedStr = Array.from(uniqueRelated).join('')
      }

      let fixesStr = ''
      try {
        const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider',
          uri,
          d.range
        )

        if (codeActions) {
          const validFixes = codeActions
            .filter((a) => a.kind && vscode.CodeActionKind.QuickFix.contains(a.kind))
            .filter((a) => {
              const t = a.title.trim().toLowerCase()
              return t.length >= 3 && !IGNORED_FIX_TITLES.has(t) && !t.startsWith('fix all')
            })
            .sort((a, b) => (a.isPreferred === b.isPreferred ? 0 : a.isPreferred ? -1 : 1))
            .map((a) => (a.isPreferred ? `"${a.title.trim()}" (Preferred)` : `"${a.title.trim()}"`))

          const uniqueFixes = [...new Set(validFixes)].slice(0, 2)
          if (uniqueFixes.length > 0) fixesStr = `\n      -> Suggest: ${uniqueFixes.join(', ')}`
        }
      } catch (e) {}

      return `> [${severity}] Line ${line}${codeStr} ${sourceStr}: ${cleanMessage}${contextStr}${relatedStr}${fixesStr}`
    })
  )

  return [...new Set(detailedEntries)].join('\n')
}
