/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { On } from 'claude-code'

const PANE_ID = 'xtrm.specialists.fleet'
const COMMAND = 'specialists'
const MCP_SERVER = 'specialists'

type Activation = {
  activation_id?: string
  specialist?: string
  issue_ref?: string
  bead_id?: string
  state?: string
  access?: string
  purpose?: string
  elapsed_s?: number
  token_usage?: unknown
  last_activity_at?: string
  result?: unknown
}

function textOf(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      const value = (block as { text?: unknown }).text
      return typeof value === 'string' ? value : ''
    })
    .filter(Boolean)
    .join('\n')
}

function activationsOf(result: unknown): Activation[] {
  const text = textOf(result)
  if (!text) return []

  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return parsed as Activation[]
    if (parsed && typeof parsed === 'object') {
      const rows =
        (parsed as { activations?: unknown }).activations ??
        (parsed as { rows?: unknown }).rows ??
        (parsed as { data?: unknown }).data
      if (Array.isArray(rows)) return rows as Activation[]
    }
  } catch {
    return []
  }

  return []
}

export function register(on: On) {
  let open = false
  let loading = false
  let error: string | null = null
  let rows: Activation[] = []
  let selected: string | null = null

  const refresh = async ($: Parameters<Parameters<On>[1]>[0]) => {
    if (loading) return
    loading = true
    error = null
    $.ui.invalidate('ui.render')

    try {
      const result = await $.mcp.call(MCP_SERVER, 'specialist_status', {})
      rows = activationsOf(result)
      if (selected && !rows.some(row => row.activation_id === selected)) {
        selected = null
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
      $.ui.invalidate('ui.render')
    }
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Open the native Specialists fleet pane',
      })
    } catch {
      // The command may already be provided by another Specialists surface.
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e, next) => {
    if (open) {
      await $.ui.close({ id: PANE_ID }).catch(() => undefined)
      open = false
      return { text: 'Specialists pane hidden' }
    }

    await $.ui.open({
      id: PANE_ID,
      title: 'Specialists',
      holdToasts: true,
    })
    open = true
    void refresh($)
    return { text: 'Specialists pane shown' }
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) open = false
    return result
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)

    const { Box, Text, Button } = await $.ui.resolve(e)
    const selectedRow = rows.find(row => row.activation_id === selected)

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>Fleet</Text>
          <Text dimColor>{loading ? ' · refreshing' : ` · ${rows.length} activations`}</Text>
          <Button plain onPress={() => void refresh($)}> refresh </Button>
        </Box>

        {error ? <Text>status unavailable · {error}</Text> : null}

        {rows.length === 0 && !loading && !error ? (
          <Text dimColor>No live activations.</Text>
        ) : null}

        {rows.map(row => {
          const id = row.activation_id ?? 'unknown'
          const state = row.state ?? 'unknown'
          const name = row.specialist ?? 'specialist'
          const issue = row.issue_ref ?? row.bead_id ?? ''
          const active = selected === id

          return (
            <Button
              key={id}
              plain
              onPress={() => {
                selected = active ? null : id
                $.ui.invalidate('ui.render')
              }}
            >
              {active ? '▾' : '›'} {name} · {state}{issue ? ` · ${issue}` : ''}
            </Button>
          )
        })}

        {selectedRow ? (
          <Box flexDirection="column">
            <Text dimColor>────────────────────────</Text>
            <Text bold>{selectedRow.specialist ?? 'specialist'}</Text>
            <Text>activation  {selectedRow.activation_id ?? 'unknown'}</Text>
            <Text>state       {selectedRow.state ?? 'unknown'}</Text>
            <Text>issue       {selectedRow.issue_ref ?? selectedRow.bead_id ?? '—'}</Text>
            <Text>access      {selectedRow.access ?? '—'}</Text>
            <Text>elapsed     {selectedRow.elapsed_s ?? 0}s</Text>
            {selectedRow.purpose ? <Text>{selectedRow.purpose}</Text> : null}
            <Text dimColor>Management actions remain on the authoritative MCP surface in this first spike.</Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
