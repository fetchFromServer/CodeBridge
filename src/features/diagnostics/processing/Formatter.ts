import { AnalyzedGroup } from '../types'

export class ReportFormatter {
  public static render(items: AnalyzedGroup[]): string {
    const parts: string[] = []

    const errCount = items.filter((i) => i.icon === '❌').length
    const warnCount = items.length - errCount
    const systemIcon = errCount > 0 ? '❌' : '⚠️'
    const systemStatus = errCount > 0 ? 'FAILED' : 'WARNINGS'

    parts.push(
      `█ ${systemIcon} SYSTEM STATUS: ${systemStatus} (Errors: ${errCount} | Warnings: ${warnCount})`,
    )
    parts.push(`█ Generated: ${new Date().toLocaleTimeString()}`)
    parts.push('━'.repeat(60))

    let currentFile = ''

    for (const item of items) {
      if (item.location !== currentFile) {
        if (currentFile !== '') parts.push('')
        parts.push(`📂 ${item.location}`)
        currentFile = item.location
      }

      parts.push(`${item.icon} L${item.lineNum.padEnd(4)} ${item.messages[0]}`)

      for (let i = 1; i < item.messages.length; i++) {
        const branch = item.icon === '❌' ? '↓' : '·'
        parts.push(`   ${branch}       ${item.messages[i]}`)
      }

      parts.push('')
      parts.push(item.codeWindow)

      if (item.traces.length) {
        item.traces.forEach((t) => parts.push(`   ↳ ${t}`))
      }

      if (item.fixes.length) {
        parts.push('')
        item.fixes.forEach((f) => parts.push(`   💡 ${f}`))
      }

      parts.push('')
    }

    return parts.join('\n')
  }
}
