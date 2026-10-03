/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, EngineInterface, McpToolResult, On } from 'claude-code'

// The live Specialists fleet of THIS session, drawn in the band above the prompt: the
// Claude-native twin of the Pi native-specialists footer section
// (config/pi-extensions/native-specialists). Presentation and control only — every read
// and every action goes through the session's own Specialists MCP server, whose in-process
// host is the fleet this session dispatched. No state of its own beyond the last read.

/** The plugin's MCP server as /mcp lists it (`plugin:<plugin>:<server>`). */
export const MCP_SERVER = 'plugin:specialists:specialists'
export const COMMAND = 'specialists'
export const POLL_MS = 2000
export const FLEET_MAX_ROWS = 6
/** Above this many activations the band folds to one line and the pane holds the list. */
export const COLLAPSE_AT = 3
export const PANE_ID = 'specialists-fleet'
export const PURPOSE_ROW_MAX = 60

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒']
const ACCENT = '#9a8bff'

/** A wake-watch notification's exact summary line (`hooks.json` `rewakeSummary`). */
export const FALLBACK_WAKE_TEXT = 'Specialist activation needs attention'
/** Tool names the Specialists MCP server answers to, bare or plugin-qualified. */
const SPECIALISTS_TOOL = /^mcp__(?:plugin_specialists_)?specialists__(.+)$/

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
  'Usage: /specialists [status|show|hide|expand|collapse] · reply <message_id> <answer> · ' +
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

/**
 * The channel frame `buildChannelFrame` writes, as far as a reader needs:
 * `Specialist <specialist>[ on <issue>]: <event> (<activation_id>). <action>`.
 *
 * Deliberately strict: a row the parser cannot read falls back to the engine's
 * own drawing rather than guessing at a half-frame.
 */
export function parseChannelFrame(
  text: string,
): { specialist: string; issue?: string; event: string; activationId: string } | null {
  const match = /^Specialist (.+?)(?: on (.+?))?: (\S+) \((act:[^)]+)\)\. [\s\S]*$/.exec(text)
  if (!match) return null
  const [, specialist, issue, event, activationId] = match
  return issue
    ? { specialist: specialist!, issue, event: event!, activationId: activationId! }
    : { specialist: specialist!, event: event!, activationId: activationId! }
}

const DONE_COLOR = 'green'
const FAILED_COLOR = 'red'
const WAITING_COLOR = 'yellow'

/** The ● colour a wake row's header takes: done green, failed red, waiting on you yellow. */
export function eventColor(event: string): string {
  if (event === 'completed') return DONE_COLOR
  if (event === 'failed') return FAILED_COLOR
  if (event === 'escalation' || event === 'needs_reply') return WAITING_COLOR
  return ACCENT
}

const EVENT_MARKER: Record<string, string> = {
  completed: '✓',
  failed: '✕',
  escalation: '!',
  needs_reply: '!',
}

export function markerForEvent(event: string): string {
  return EVENT_MARKER[event] ?? '●'
}

/** The parts one teammate-style channel row draws, or null when unreadable. */
export type ChannelRow = { marker: string; identity: string; event: string; issue?: string }

export function channelRow(text: string): ChannelRow | null {
  const frame = parseChannelFrame(text)
  if (!frame) return null
  return {
    marker: markerForEvent(frame.event),
    identity: `@${frame.specialist}:${shortId(frame.activationId)}`,
    event: frame.event,
    ...(frame.issue ? { issue: frame.issue } : {}),
  }
}

export function isSpecialistsTool(tool: string): boolean {
  return SPECIALISTS_TOOL.test(tool)
}

const stringArg = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/**
 * The native label one Specialists tool call draws under, or null when the name
 * is not a Specialists tool this Mod knows. Covers both MCP name spellings.
 */
export function specialistToolLabel(tool: string, input: unknown): string | null {
  const match = SPECIALISTS_TOOL.exec(tool)
  if (!match) return null
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const activation = stringArg(args.activation_id)
  switch (match[1]) {
    case 'specialist_dispatch': {
      const target = stringArg(args.issue_ref) ?? stringArg(args.bead_id) ?? 'inline contract'
      return `Dispatch @${stringArg(args.specialist) ?? 'specialist'} → ${target}`
    }
    case 'specialist_status':
      return 'Status'
    case 'specialist_list':
      return 'List specialists'
    case 'specialist_reply':
      return `Reply → ${stringArg(args.message_id) ?? '?'}`
    case 'specialist_steer':
      return `Steer @${activation ?? '?'}`
    case 'specialist_resume':
      return `Resume @${activation ?? '?'}`
    case 'specialist_stop_activation':
      return `Stop @${activation ?? '?'}`
    case 'specialist_retry':
      return `Retry @${activation ?? '?'}`
    case 'substrate_issue':
      return 'Issue'
    case 'substrate_journal':
      return 'Journal'
    case 'substrate_provenance':
      return 'Provenance'
    default:
      return null
  }
}

/** The text an errored call's `output` carries, for the row that shows it. */
export function errorTextOf(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>
    const text = stringArg(record.error) ?? stringArg(record.message) ?? stringArg(record.text)
    if (text) return text
  }
  return output == null ? 'failed' : JSON.stringify(output)
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
  paneOpen: boolean
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

/** The elements both sites draw with; the terminal and desktop tables have all four. */
type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input'>

/** Opens the fleet pane: docked beside a fullscreen transcript, else inline above the prompt. */
async function openPane($: EngineInterface, s: State): Promise<void> {
  await $.ui.open({
    id: PANE_ID,
    title: 'Specialists',
    focus: true,
    closeOnEscape: true,
    rows: Math.min(40, s.fleet.activations.length * 2 + 8),
  })
  s.paneOpen = true
  $.ui.invalidate('ui.render')
}

async function closePane($: EngineInterface, s: State): Promise<void> {
  await $.ui.close({ id: PANE_ID }).catch(() => undefined)
  s.paneOpen = false
  $.ui.invalidate('ui.render')
}

/**
 * Rows and the selected row's controls: the one drawing the band and the pane share, so
 * both sites read and act the same way. `site` keeps element keys apart between them.
 */
function fleetBody($: EngineInterface, s: State, ui: Kit, rows: Activation[], site: string) {
  const { Box, Text, Button, Input } = ui
  const nowMs = Date.now()
  const selectedRow = rows.find(a => a.activation_id === s.selected)
  const selectedAsk = selectedRow && s.fleet.asks.find(a => a.activation_id === selectedRow.activation_id)

  return (
    <Box flexDirection="column">
      {rows.map(row => {
        const ask = s.fleet.asks.find(a => a.activation_id === row.activation_id)
        const purpose = purposeShort(row.purpose)
        const isSelected = row.activation_id === s.selected
        return (
          <Box key={`${site}:${row.activation_id}`} flexDirection="column">
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

      {selectedRow ? (
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
    paneOpen: false,
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

    if (verb === '') {
      await refresh($, s)
      if (s.paneOpen) {
        await closePane($, s)
        return { text: 'Specialists pane hidden' }
      }
      await openPane($, s)
      return { text: 'Specialists pane shown' }
    }

    if (verb === 'status') {
      await refresh($, s)
      return { text: reportOf(s.fleet, s.error, Date.now()) }
    }

    if (verb === 'show' || verb === 'hide' || verb === 'expand' || verb === 'collapse') {
      if (verb === 'show') s.visible = true
      if (verb === 'hide') s.visible = false
      if (verb === 'expand') s.expanded = true
      if (verb === 'collapse') s.expanded = false
      $.ui.invalidate('ui.render')
      return { text: `Specialists band: ${verb}` }
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
    const ordered = orderedOf(s.fleet)
    // Folded above COLLAPSE_AT, and while the pane holds the list: the band keeps the
    // header and the blocked rows only, since an ask must never hide behind a count.
    const isFolded = s.paneOpen || ordered.length > COLLAPSE_AT
    const blocked = new Set(s.fleet.asks.map(a => a.activation_id))
    const rows = !s.expanded
      ? []
      : isFolded
        ? (s.paneOpen ? [] : ordered.filter(a => blocked.has(a.activation_id)))
        : ordered.slice(0, FLEET_MAX_ROWS)

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>╰─</Text>
          <Text inverse bold> SPECIALISTS </Text>
          <Text> {headerOf(s.fleet)}</Text>
          {isFolded ? (
            <Button plain key="open" hotkey="o" onPress={() => void (s.paneOpen ? closePane($, s) : openPane($, s))}>
              {s.paneOpen ? 'close' : 'open'}
            </Button>
          ) : (
            <Button plain dimColor key="toggle" onPress={() => { s.expanded = !s.expanded; $.ui.invalidate('ui.render') }}>
              {s.expanded ? ' [-]' : ' [+]'}
            </Button>
          )}
        </Box>
        {isFolded && !s.paneOpen ? <Text dimColor>    tap open or /specialists for the full fleet</Text> : null}
        {s.error ? <Text color="yellow" wrap="truncate-end">    status unavailable · {s.error}</Text> : null}
        {rows.length > 0 || s.flash ? fleetBody($, s, { Box, Text, Button, Input }, rows, 'band') : null}
        {!isFolded && s.expanded && ordered.length > rows.length ? <Text dimColor>    +{ordered.length - rows.length} more</Text> : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    // The mobile app draws no Input; it keeps /specialists status.
    if (e.requestId !== PANE_ID || e.surface === 'mobile') return next(e)

    const { Box, Text, Button, Input } = await $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold>{headerOf(s.fleet)}</Text>
        {s.error ? <Text color="yellow" wrap="truncate-end">status unavailable · {s.error}</Text> : null}
        {s.fleet.activations.length === 0 ? <Text dimColor>No live activations.</Text> : null}
        {fleetBody($, s, { Box, Text, Button, Input }, orderedOf(s.fleet), 'pane')}
        <Text dimColor>esc closes · select a row to reply, steer, resume or stop</Text>
      </Box>
    )
  })

  // Transcript rows: the Specialists wakes and MCP calls reach the coordinator as raw
  // machine text. Draw them as teammate-style lines instead. Presentation only — the
  // stored row, and everything the model reads, is untouched; ctrl+o still shows it.
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'channel' } } }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.origin.kind !== 'channel' || e.props.origin.server !== MCP_SERVER) return next(e)
    const row = channelRow(e.props.text)
    if (!row) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    // Shaped like Claude Code's own teammate row: a coloured ● header, then a dim detail line.
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={eventColor(row.event)}>● </Text>
          <Text>Specialist </Text>
          <Text bold color={ACCENT}>{row.identity}</Text>
          <Text> {row.event}</Text>
          {row.issue ? <Text dimColor> · {row.issue}</Text> : null}
        </Box>
        <Text dimColor italic>  use specialist_status for full result</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'task-notification' } } }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.text !== FALLBACK_WAKE_TEXT) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={WAITING_COLOR}>● </Text>
          <Text bold color={ACCENT}>Specialists</Text>
          <Text> fallback wake</Text>
        </Box>
        <Text dimColor italic>  use specialist_status for full result</Text>
      </Box>
    )
  })

  // A Specialists call never draws on its own inside a folded group: unfold the group
  // where it is, then each call draws as a ToolUse row the hook below labels.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    if (e.props.isExpanded || !e.props.calls.some(call => isSpecialistsTool(call.tool))) return next(e)
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  on('ui.render', { component: 'ToolUse', props: { tool: /^mcp__(?:plugin_specialists_)?specialists__/ } }, async ($, e, next) => {
    const label = specialistToolLabel(e.props.tool, e.props.input)
    if (!label) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    const state = e.props.isRunning ? 'running' : e.props.isInterrupted ? 'interrupted' : e.props.isErrored ? 'errored' : null
    return (
      <Box>
        <Text color={ACCENT}>{label}</Text>
        {state ? <Text dimColor> · {state}</Text> : null}
        {e.props.isErrored ? <Text color="red"> {errorTextOf(e.props.output)}</Text> : null}
      </Box>
    )
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) {
      s.paneOpen = false
      $.ui.invalidate('ui.render')
    }
    return result
  })
}
