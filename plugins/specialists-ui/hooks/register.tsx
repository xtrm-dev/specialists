/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { EngineInterface, On } from 'claude-code'

// Teammate-style transcript rows for Specialists. The Specialists wakes and MCP calls reach
// the coordinator as raw machine text; these hooks draw them like Claude Code's own teammate
// rows. Presentation only: the stored row, and everything the model reads, is untouched, and
// ctrl+o still shows the original.
//
// Why a plugin of its own: Claude Code never runs a plugin's ui.render hooks on a row that
// plugin raised ("skipped: re-entry ... the plugin's own code raised it"). The channel wake
// comes from the specialists plugin's own MCP server, so only another plugin can draw it.

/** The specialists plugin's MCP server as /mcp lists it (`plugin:<plugin>:<server>`). */
export const MCP_SERVER = 'plugin:specialists:specialists'

/** The rewakeSummary the specialists plugin's wake-watch hook raises (its hooks.json). */
export const FALLBACK_WAKE_TEXT = 'Specialist activation needs attention'

const ACCENT = '#9a8bff'

/**
 * The marker class a channel wake is acknowledged under: 'settled' for a
 * finished activation, 'needs_reply' for one waiting on the coordinator.
 * Mirrors wake-watch.mjs's own class for the same states.
 */
export function ackClassFor(event: string): string {
  return event === 'escalation' || event === 'needs_reply' ? 'needs_reply' : 'settled'
}

/**
 * Records that a Specialists channel wake for `activationId` reached this
 * session, so the wake-watch fallback can drop its duplicate. Best-effort:
 * false when HOME is unreadable or the write fails; never throws.
 */
export async function recordWakeAck($: EngineInterface, activationId: string, event: string): Promise<boolean> {
  const home = await $.env.get('HOME')
  if (!home) return false
  await $.fs.write(`${home}/.xtrm/wake-acks/${activationId}.${ackClassFor(event)}`, '')
  return true
}

const SPECIALISTS_TOOL = /^mcp__(?:plugin_specialists_)?specialists__(.+)$/

const shortId = (id: string) => (id.startsWith('act:') ? id.slice(4, 12) : id.slice(0, 8))

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

/** One Specialists call as a native tool row heads it: `Name(args)`. */
export type ToolCall = { name: string; args?: string }

const joined = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined

/**
 * The native head one Specialists tool call draws under, or null when the name
 * is not a Specialists tool this Mod knows. Covers both MCP name spellings.
 */
export function specialistToolCall(tool: string, input: unknown): ToolCall | null {
  const match = SPECIALISTS_TOOL.exec(tool)
  if (!match) return null
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const activation = stringArg(args.activation_id)
  const short = activation ? shortId(activation) : undefined
  const head = (name: string, text?: string): ToolCall => (text ? { name, args: text } : { name })
  switch (match[1]) {
    case 'specialist_dispatch':
      return head(
        'Dispatch',
        joined(stringArg(args.specialist) ?? 'specialist', stringArg(args.issue_ref) ?? stringArg(args.bead_id) ?? 'inline contract'),
      )
    case 'specialist_status':
      return head('Status', short)
    case 'specialist_result':
      return head('Result', short)
    case 'specialist_list':
      return head('List specialists', stringArg(args.name))
    case 'specialist_reply':
      return head('Reply', stringArg(args.message_id))
    case 'specialist_steer':
      return head('Steer', short)
    case 'specialist_resume':
      return head('Resume', short)
    case 'specialist_stop_activation':
      return head('Stop', short)
    case 'specialist_retry':
      return head('Retry', short)
    case 'substrate_issue':
      return head('Issue', joined(stringArg(args.op), stringArg(args.ref) ?? stringArg(args.issue_id)))
    case 'substrate_journal':
      return head('Journal', joined(stringArg(args.op), stringArg(args.issue_id)))
    case 'substrate_provenance':
      return head(
        'Provenance',
        joined(stringArg(args.op), stringArg(args.issue_id) ?? stringArg(args.pr) ?? stringArg(args.sha)?.slice(0, 8) ?? stringArg(args.receipt_id)),
      )
    default:
      return null
  }
}

/** The text an MCP result carries: its text blocks joined, or the string itself. */
function payloadText(output: unknown): string {
  if (typeof output === 'string') return output
  const blocks = Array.isArray(output)
    ? output
    : output && typeof output === 'object' && Array.isArray((output as { content?: unknown }).content)
      ? (output as { content: unknown[] }).content
      : null
  if (!blocks) return ''
  return blocks
    .map(block => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' ? String((block as { text?: unknown }).text ?? '') : ''))
    .join('\n')
}

function payloadOf(output: unknown): Record<string, unknown> | null {
  if (output && typeof output === 'object' && !Array.isArray(output) && !('content' in output)) return output as Record<string, unknown>
  try {
    const value: unknown = JSON.parse(payloadText(output))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const firstLine = (text: string) => text.trim().split('\n')[0]!.slice(0, 120)

/** The text an errored call's `output` carries, for the row that shows it. */
export function errorTextOf(output: unknown): string {
  const record = payloadOf(output)
  const text = record ? stringArg(record.error) ?? stringArg(record.message) ?? stringArg(record.text) : undefined
  if (text) return text
  const raw = payloadText(output)
  if (raw) return firstLine(raw)
  return output == null ? 'failed' : JSON.stringify(output)
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The one line under a finished Specialists call (the indented result line), read from its JSON
 * result. A `{ status: 'error' }` payload is an error even when the call itself was not.
 */
export function toolResultLine(tool: string, output: unknown): { text: string; isError: boolean } | null {
  const match = SPECIALISTS_TOOL.exec(tool)
  if (!match || output == null) return null
  const record = payloadOf(output)
  if (!record) {
    const raw = payloadText(output)
    return raw ? { text: firstLine(raw), isError: false } : null
  }
  if (record.status === 'error') return { text: errorTextOf(output), isError: true }
  switch (match[1]) {
    case 'specialist_dispatch': {
      const id = stringArg(record.activation_id)
      const text = joined(id ? shortId(id) : undefined, stringArg(record.created_issue_ref) ?? stringArg(record.bead_id), stringArg(record.state))
      return text ? { text, isError: false } : null
    }
    case 'specialist_status': {
      const activations = Array.isArray(record.activations) ? (record.activations as { state?: unknown }[]) : []
      const asks = Array.isArray(record.pending_asks) ? record.pending_asks.length : 0
      const running = activations.filter(a => a?.state === 'running' || a?.state === 'starting').length
      const parts = [count(activations.length, 'activation'), running ? `${running} running` : undefined, asks ? `${asks} waiting on you` : undefined]
      return { text: parts.filter(Boolean).join(', '), isError: false }
    }
    case 'specialist_result': {
      if (record.output == null) {
        const pending = stringArg(record.state)
        return pending ? { text: pending, isError: false } : null
      }
      const body = typeof record.output === 'string' ? record.output : JSON.stringify(record.output)
      const lines = body === '' ? 0 : body.split('\n').length
      return { text: joined(stringArg(record.status), count(lines, 'line')), isError: false }
    }
    case 'specialist_list':
      return Array.isArray(record.specialists) ? { text: count(record.specialists.length, 'specialist'), isError: false } : null
    default: {
      const text = stringArg(record.state) ?? stringArg(record.status)
      return text ? { text, isError: false } : null
    }
  }
}

export function register(on: On) {
  // A channel wake's prompt.submit is how the coordinator actually receives the
  // push; record it so the slow fallback watcher does not wake the session again
  // for the same activation. The prompt always passes through unchanged.
  on('prompt.submit', { origin: { kind: 'channel', server: MCP_SERVER } }, async ($, e, next) => {
    const frame = parseChannelFrame(e.text)
    if (frame) await recordWakeAck($, frame.activationId, frame.event).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'channel' } } }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.origin.kind !== 'channel' || e.props.origin.server !== MCP_SERVER) return next(e)
    const row = channelRow(e.props.text)
    if (!row) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    // Shaped like Claude Code's own teammate row: a coloured ● header, then a dim detail line.
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={eventColor(row.event)}>● </Text>
          <Text>Specialist </Text>
          <Text bold color={ACCENT}>{row.identity}</Text>
          <Text> {row.event}</Text>
          {row.issue ? <Text dimColor> · {row.issue}</Text> : null}
        </Box>
        <Text dimColor italic>  use specialist_result for full result</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'task-notification' } } }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.text !== FALLBACK_WAKE_TEXT) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={WAITING_COLOR}>● </Text>
          <Text bold color={ACCENT}>Specialists</Text>
          <Text> fallback wake</Text>
        </Box>
        <Text dimColor italic>  use specialist_result for full result</Text>
      </Box>
    )
  })

  // A Specialists call never draws on its own inside a folded group: unfold the group
  // where it is, then each call draws as a ToolUse row the hook below labels.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    if (e.props.isExpanded || !e.props.calls.some(call => isSpecialistsTool(call.tool))) return next(e)
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  // Drawn the way Claude Code draws its own tools: a state-coloured ●, the bold name with
  // its arguments, and an indented line with the result, the running state or the error.
  on('ui.render', { component: 'ToolUse', props: { tool: /^mcp__(?:plugin_specialists_)?specialists__/ } }, async ($, e, next) => {
    const call = specialistToolCall(e.props.tool, e.props.input)
    if (!call) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    const result = toolResultLine(e.props.tool, e.props.output)
    const failed = e.props.isErrored || result?.isError === true
    const line = e.props.isRunning
      ? { text: 'Running…', color: undefined }
      : e.props.isInterrupted
        ? { text: 'Interrupted', color: FAILED_COLOR }
        : failed
          ? { text: result?.isError ? result.text : errorTextOf(e.props.output), color: FAILED_COLOR }
          : result
            ? { text: result.text, color: undefined }
            : null
    const dot = e.props.isRunning ? undefined : e.props.isInterrupted || failed ? FAILED_COLOR : DONE_COLOR
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={dot} dimColor={e.props.isRunning}>● </Text>
          <Text bold>{call.name}</Text>
          {call.args ? <Text>({call.args})</Text> : null}
        </Box>
        {line ? (
          <Box>
            <Text>  </Text>
            <Text color={line.color} dimColor={!line.color}>{line.text}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })

  // A standalone call's result row would repeat the result line the call row already drew.
  on('ui.render', { component: 'ToolResult', props: { tool: /^mcp__(?:plugin_specialists_)?specialists__/ } }, async ($, e, next) => {
    if (!specialistToolCall(e.props.tool, undefined)) return next(e)
    const { Box } = await $.ui.resolve(e)
    return <Box />
  })
}
