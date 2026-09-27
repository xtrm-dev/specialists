/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { EngineInterface, McpToolResult, On } from 'claude-code'

// The live Specialists fleet of THIS session, drawn in the band above the prompt: the
// Claude-native twin of the Pi specialist-subagents footer section
// (config/pi-extensions/specialist-subagents). Presentation and control only — every read
// and every action goes through the session's own Specialists MCP server, whose in-process
// host is the fleet this session dispatched. No state of its own beyond the last read.

/** The plugin's MCP server as /mcp lists it (`plugin:<plugin>:<server>`). */
export const MCP_SERVER = 'plugin:specialists:specialists'
export const COMMAND = 'specialists'
export const POLL_MS = 2000
export const FLEET_MAX_ROWS = 6
export const PURPOSE_ROW_MAX = 60

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒']
const ACCENT = '#9a8bff'

export type Activation = {
  activation_id: string
  specialist?: string
  bead_id?: string
  state?: string
  resolved_model?: string
  thinking_level?: string
  elapsed_s?: number
  turn_count?: number
  token_usage?: Record<string, number | undefined>
  purpose?: string
  result_status?: string
}

export type Ask = {
  message_id: string
  kind?: string
  activation_id: string
  from?: string
  body?: string
  asked_at?: number
}

export type Fleet = { activations: Activation[]; asks: Ask[] }

const USAGE =
  'Usage: /specialists [show|hide|expand|collapse] · reply <message_id> <answer> · ' +
  'steer <activation> <message> · resume <activation> <prompt> · stop <activation> [reason]'

const isActive = (state?: string) => state === 'running' || state === 'starting'

function textOf(result: McpToolResult): string {
  return result.content
    .map(block => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * One MCP tool call, its JSON payload or the reason it failed. A transport error, an
 * `isError` result and a `{ status: 'error' }` payload are all failures: the fleet must
 * never read an unreachable server as an empty one.
 */
export async function callTool(
  $: EngineInterface,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  let result: McpToolResult
  try {
    result = await $.mcp.call(MCP_SERVER, tool, args)
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
  const text = textOf(result)
  if (result.isError) return { ok: false, error: text || `${tool} failed` }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: `${tool} returned non-JSON: ${text.slice(0, 120)}` }
  }
  if (!value || typeof value !== 'object') return { ok: false, error: `${tool} returned no object` }
  const record = value as Record<string, unknown>
  if (record.status === 'error') return { ok: false, error: String(record.error ?? `${tool} failed`) }
  return { ok: true, value: record }
}

export function fleetOf(value: Record<string, unknown>): Fleet {
  const activations = Array.isArray(value.activations) ? (value.activations as Activation[]) : []
  const asks = Array.isArray(value.pending_asks) ? (value.pending_asks as Ask[]) : []
  return {
    activations: activations.filter(a => a && typeof a.activation_id === 'string'),
    asks: asks.filter(a => a && typeof a.message_id === 'string'),
  }
}

/** Buckets are exclusive, so they sum to the entry count (as the Pi header does). */
export function summaryOf({ activations, asks }: Fleet) {
  const blocked = new Set(asks.map(a => a.activation_id))
  const running = activations.filter(a => isActive(a.state) && !blocked.has(a.activation_id)).length
  const blockedCount = activations.filter(a => blocked.has(a.activation_id)).length
  return {
    running,
    blocked: blockedCount,
    waiting: Math.max(0, activations.length - running - blockedCount),
    total: activations.length,
  }
}

export function headerOf(fleet: Fleet): string {
  const { running, waiting, blocked, total } = summaryOf(fleet)
  if (total === 0) return 'idle'
  const parts: string[] = []
  if (running > 0) parts.push(`${running} running`)
  if (waiting > 0) parts.push(`${waiting} waiting`)
  if (blocked > 0) parts.push(`! ${blocked} blocked`)
  return parts.join(' • ')
}

/** `42s`, `2m14s`, `1h05m`. */
export function elapsedShort(seconds?: number): string {
  const total = Math.max(0, Math.floor(seconds ?? 0))
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(total / 3600)}h${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`
}

/** Spend counts only; `total_tokens` is a rollup, never a summand. */
export function spendShort(usage?: Record<string, number | undefined>): string {
  if (!usage) return ''
  const keys = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'reasoning_tokens', 'tool_tokens']
  const total = keys.reduce((n, k) => n + (usage[k] ?? 0), 0)
  if (total <= 0) return ''
  if (total < 1000) return `${total}`
  if (total < 10000) return `${(total / 1000).toFixed(1)}k`
  return `${Math.round(total / 1000)}k`
}

export function purposeShort(purpose?: string): string {
  const flat = String(purpose ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= PURPOSE_ROW_MAX ? flat : `${flat.slice(0, PURPOSE_ROW_MAX - 1)}…`
}

const shortId = (id: string) => (id.startsWith('act:') ? id.slice(4, 12) : id.slice(0, 8))

export function markerOf(row: Activation, ask: Ask | undefined, nowMs: number): string {
  if (ask) return '!'
  if (row.state === 'settled') return '✓'
  if (row.state === 'failed') return '✕'
  if (isActive(row.state)) return SPINNER_FRAMES[Math.floor(nowMs / 250) % SPINNER_FRAMES.length]!
  return '●'
}

export function metricsOf(row: Activation, ask: Ask | undefined, nowMs: number): string {
  if (ask) return `waiting ${elapsedShort((nowMs - (ask.asked_at ?? nowMs)) / 1000)}`
  const parts = [elapsedShort(row.elapsed_s)]
  if (row.turn_count != null) parts.push(`${row.turn_count}t`)
  const spend = spendShort(row.token_usage)
  if (spend) parts.push(spend)
  if (row.result_status) parts.push(row.result_status)
  return parts.join(' • ')
}

/** Blocked first, then live work, then the rest; each group keeps the host's order. */
export function orderedOf({ activations, asks }: Fleet): Activation[] {
  const blocked = new Set(asks.map(a => a.activation_id))
  const rank = (a: Activation) => (blocked.has(a.activation_id) ? 0 : isActive(a.state) ? 1 : 2)
  return [...activations].sort((a, b) => rank(a) - rank(b))
}

/** The plain-text fleet report `/specialists` prints (every surface, not only the band). */
export function reportOf(fleet: Fleet, error: string | null, nowMs: number): string {
  const lines = [`Specialists · ${headerOf(fleet)}`]
  if (error) lines.push(`status unavailable · ${error}`)
  for (const row of orderedOf(fleet)) {
    const ask = fleet.asks.find(a => a.activation_id === row.activation_id)
    lines.push(
      `  ${markerOf(row, ask, nowMs)} ${row.specialist ?? 'specialist'} ${row.activation_id}  ${row.bead_id ?? '—'}  ${metricsOf(row, ask, nowMs)}`,
    )
    if (ask) lines.push(`      ${ask.kind ?? 'ask'} ${ask.message_id}: ${ask.body ?? ''}`)
  }
  return lines.join('\n')
}

/** An activation by its full id or an unambiguous prefix (with or without `act:`). */
export function resolveActivation(fleet: Fleet, ref: string): Activation | string {
  const needle = ref.startsWith('act:') ? ref : `act:${ref}`
  const hits = fleet.activations.filter(a => a.activation_id === ref || a.activation_id.startsWith(needle))
  if (hits.length === 1) return hits[0]!
  return hits.length === 0 ? `Unknown activation: ${ref}` : `Ambiguous activation: ${ref}`
}

/** What the band draws from: the last read and the operator's view choices. */
type State = {
  fleet: Fleet
  error: string | null
  visible: boolean
  expanded: boolean
  selected: string | null
  flash: string | null
  polling: boolean
  timer: { cancel: () => void } | null
}

async function refresh($: EngineInterface, s: State): Promise<void> {
  if (s.polling) return
  s.polling = true
  try {
    const read = await callTool($, 'specialist_status')
    if (read.ok) {
      s.fleet = fleetOf(read.value)
      s.error = null
      if (s.selected && !s.fleet.activations.some(a => a.activation_id === s.selected)) s.selected = null
    } else {
      s.error = read.error
    }
  } finally {
    s.polling = false
    $.ui.invalidate('ui.render')
  }
}

/** One control action; its answer is what the operator sees. */
async function act($: EngineInterface, s: State, tool: string, args: Record<string, unknown>, done: string): Promise<string> {
  const result = await callTool($, tool, args)
  s.flash = result.ok ? done : `${tool} refused: ${result.error}`
  await refresh($, s)
  return s.flash
}

export function register(on: On) {
  const s: State = {
    fleet: { activations: [], asks: [] },
    error: null,
    visible: true,
    expanded: true,
    selected: null,
    flash: null,
    polling: false,
    timer: null,
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Live Specialists fleet: show/hide the band, reply, steer, resume, stop',
        argumentHint: '[show|hide|expand|collapse|reply|steer|resume|stop] …',
        immediate: true,
      })
    } catch {
      // Another Specialists surface may already serve the command.
    }
    s.timer?.cancel()
    s.timer = $.clock.every(POLL_MS, () => void refresh($, s))
    void refresh($, s)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const trimmed = e.args.trim()
    const [verb = '', ref = '', ...rest] = trimmed.split(/\s+/)
    const tail = rest.join(' ')

    if (verb === '' || verb === 'show' || verb === 'hide' || verb === 'expand' || verb === 'collapse') {
      if (verb === 'show' || verb === '') s.visible = true
      if (verb === 'hide') s.visible = false
      if (verb === 'expand') s.expanded = true
      if (verb === 'collapse') s.expanded = false
      await refresh($, s)
      return { text: verb === '' ? reportOf(s.fleet, s.error, Date.now()) : `Specialists band: ${verb}` }
    }

    if (verb === 'reply') {
      if (!ref || !tail) return { text: USAGE }
      const text = await act($, s, 'specialist_reply', { message_id: ref, body: tail }, `Answered ${ref}.`)
      return { text, context: [`The operator answered specialist ask ${ref} directly: ${tail}`] }
    }

    if (verb === 'steer' || verb === 'resume' || verb === 'stop') {
      if (!ref || (verb !== 'stop' && !tail)) return { text: USAGE }
      await refresh($, s)
      const target = resolveActivation(s.fleet, ref)
      if (typeof target === 'string') return { text: target }
      const id = target.activation_id
      const text =
        verb === 'steer'
          ? await act($, s, 'specialist_steer', { activation_id: id, message: tail }, `Steered ${id}.`)
          : verb === 'resume'
            ? await act($, s, 'specialist_resume', { activation_id: id, prompt: tail }, `Resumed ${id}.`)
            : await act($, s, 'specialist_stop_activation', { activation_id: id, reason: tail || 'operator request' }, `Stopped ${id}.`)
      return { text, context: [`The operator ran /specialists ${verb} on ${id}${tail ? `: ${tail}` : ''}. Result: ${text}`] }
    }

    return { text: USAGE }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is raised on the terminal only; narrowing here also types `Input`.
    if (e.surface !== 'terminal') return next(e)
    if (!s.visible || e.props.hasSurvey || (s.fleet.activations.length === 0 && !s.error)) return next(e)

    const { Box, Text, Button, Input } = await $.ui.resolve(e)
    const nowMs = Date.now()
    const ordered = orderedOf(s.fleet)
    const shown = s.expanded ? ordered.slice(0, FLEET_MAX_ROWS) : []
    const selectedRow = s.fleet.activations.find(a => a.activation_id === s.selected)
    const selectedAsk = selectedRow && s.fleet.asks.find(a => a.activation_id === selectedRow.activation_id)

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>╰─</Text>
          <Text inverse bold> SPECIALISTS </Text>
          <Text> {headerOf(s.fleet)}</Text>
          <Button plain dimColor key="toggle" onPress={() => { s.expanded = !s.expanded; $.ui.invalidate('ui.render') }}>
            {s.expanded ? ' [-]' : ' [+]'}
          </Button>
        </Box>

        {s.error ? <Text color="yellow" wrap="truncate-end">    status unavailable · {s.error}</Text> : null}

        {shown.map(row => {
          const ask = s.fleet.asks.find(a => a.activation_id === row.activation_id)
          const purpose = purposeShort(row.purpose)
          const isSelected = row.activation_id === s.selected
          return (
            <Box key={row.activation_id} flexDirection="column">
              <Button
                plain
                key={`row:${row.activation_id}`}
                onPress={() => { s.selected = isSelected ? null : row.activation_id; s.flash = null; $.ui.invalidate('ui.render') }}
              >
                {`${isSelected ? '▾' : ' '} ${markerOf(row, ask, nowMs)} ${row.specialist ?? 'specialist'}:${shortId(row.activation_id)}  ${row.bead_id ?? '—'}${purpose ? `  ${purpose}` : ''}`}
              </Button>
              <Text dimColor wrap="truncate-end">
                {`      ${row.resolved_model ?? '?model'}${row.thinking_level ? ` · ${row.thinking_level}` : ''}  • ${metricsOf(row, ask, nowMs)}`}
              </Text>
            </Box>
          )
        })}

        {s.expanded && ordered.length > shown.length ? <Text dimColor>    +{ordered.length - shown.length} more</Text> : null}

        {s.expanded && selectedRow ? (
          <Box flexDirection="column" paddingLeft={4}>
            <Text dimColor>{selectedRow.activation_id} · {selectedRow.state ?? 'unknown'}</Text>
            {selectedAsk ? (
              <>
                <Text color={ACCENT} wrap="wrap">{selectedAsk.kind ?? 'ask'}: {selectedAsk.body ?? ''}</Text>
                <Input
                  key={`reply:${selectedAsk.message_id}`}
                  label="reply "
                  placeholder="answer the specialist"
                  submitLabel="reply"
                  autoFocus
                  onSubmit={value => { if (value.trim()) void act($, s, 'specialist_reply', { message_id: selectedAsk.message_id, body: value.trim() }, `Answered ${selectedAsk.message_id}.`) }}
                />
              </>
            ) : isActive(selectedRow.state) ? (
              <Input
                key={`steer:${selectedRow.activation_id}`}
                label="steer "
                placeholder="redirect the running specialist"
                submitLabel="steer"
                onSubmit={value => { if (value.trim()) void act($, s, 'specialist_steer', { activation_id: selectedRow.activation_id, message: value.trim() }, `Steered ${selectedRow.activation_id}.`) }}
              />
            ) : (
              <Input
                key={`resume:${selectedRow.activation_id}`}
                label="resume "
                placeholder="next instruction, same session"
                submitLabel="resume"
                onSubmit={value => { if (value.trim()) void act($, s, 'specialist_resume', { activation_id: selectedRow.activation_id, prompt: value.trim() }, `Resumed ${selectedRow.activation_id}.`) }}
              />
            )}
            <Button
              key={`stop:${selectedRow.activation_id}`}
              hotkey="x"
              onPress={() => void act($, s, 'specialist_stop_activation', { activation_id: selectedRow.activation_id, reason: 'operator request' }, `Stopped ${selectedRow.activation_id}.`)}
            >
              stop
            </Button>
          </Box>
        ) : null}

        {s.flash ? <Text dimColor>    {s.flash}</Text> : null}
      </Box>
    )
  })
}
