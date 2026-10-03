/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { On } from 'claude-code'

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

export function register(on: On) {
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
}
