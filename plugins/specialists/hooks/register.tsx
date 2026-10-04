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
/**
 * Fallback cadence when the server has no blocking wait (an older runtime strips the
 * wait arguments and answers instantly) or when it is failing fast: the band then polls
 * at this interval, exactly the pre-4218 behaviour. With a server that blocks, calls run
 * ~WAIT_TIMEOUT_S apart and this timer only re-arms the watch between calls.
 */
export const POLL_MS = 2000
/** Server-side block per watch call. Under the common 30s MCP client tool timeout. */
export const WAIT_TIMEOUT_S = 25
/** A call that returns faster than this did not block: the server lacks the wait (or answered a change instantly). */
const FAST_RETURN_MS = 1000
/** Consecutive instant returns before the watch parks on the POLL_MS tick: three instant answers are an unsupported wait, not three coincidences. */
const FAST_STREAK_MAX = 3
export const FLEET_MAX_ROWS = 6
/** Above this many activations the band folds to one line and the pane holds the list. */
export const COLLAPSE_AT = 3
export const PANE_ID = 'specialists-fleet'
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
  'Usage: /specialists [status [activation]|show|hide|expand|collapse] · result <activation> · ' +
  'feed <activation> [lines] · reply <message_id> <answer> · steer <activation> <message> · ' +
  'resume <activation> <prompt> · stop <activation> [reason]'

/** Feed lines the pane's feed view asks for; the newest are kept. */
export const FEED_LINES = 30
/** Detail lines drawn in the pane; the band draws fewer so the prompt stays in view. */
export const DETAIL_PANE_LINES = 24
export const DETAIL_BAND_LINES = 6
/** How long a transition toast stays up. */
export const TOAST_MS = 6000

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

/**
 * The toasts one fleet read owes the operator: an activation that newly finished or failed,
 * and an ask that newly appeared — the Claude Code twin of the Pi extension's `ui.notify`.
 * Pure over two reads, so a missed read cannot replay old events: the FIRST read after start
 * (prev null) owes nothing, since everything in it predates this session's view.
 */
export function transitionsOf(prev: Fleet | null, next: Fleet): string[] {
  if (!prev) return []
  const before = new Map(prev.activations.map(a => [a.activation_id, a.state]))
  const askedBefore = new Set(prev.asks.map(a => a.message_id))
  const out: string[] = []
  for (const row of next.activations) {
    if (before.get(row.activation_id) === row.state) continue
    const who = `${row.specialist ?? 'specialist'}:${shortId(row.activation_id)}`
    if (row.state === 'settled') out.push(`Specialist ${who} finished${row.bead_id ? ` · ${row.bead_id}` : ''}`)
    if (row.state === 'failed') out.push(`Specialist ${who} FAILED${row.bead_id ? ` · ${row.bead_id}` : ''}`)
  }
  for (const ask of next.asks) {
    if (askedBefore.has(ask.message_id)) continue
    const row = next.activations.find(a => a.activation_id === ask.activation_id)
    const who = `${row?.specialist ?? ask.from ?? 'specialist'}:${shortId(ask.activation_id)}`
    out.push(`Specialist ${who} ${ask.kind === 'escalation' ? 'escalated' : 'asked a question'}`)
  }
  return out
}

/** The lines a result read draws: the output, or why there is none yet. */
export function resultLinesOf(value: Record<string, unknown>): string[] {
  if (typeof value.output === 'string') {
    const head = [value.status, value.resolved_model].filter(v => typeof v === 'string' && v).join(' · ')
    const body = value.output.trim() ? value.output.replace(/\n+$/, '').split('\n') : ['(empty output)']
    return head ? [head, ...body] : body
  }
  if (typeof value.next === 'string') return [`${String(value.state ?? 'not settled')} · use ${value.next}`]
  return ['no result']
}

/** The lines a feed read draws. */
export function feedLinesOf(value: Record<string, unknown>): string[] {
  const events = Array.isArray(value.events) ? value.events.filter((e): e is string => typeof e === 'string') : []
  if (events.length === 0) return ['no events yet']
  return value.truncated === true ? [`… ${Number(value.total ?? 0) - events.length} earlier events`, ...events] : events
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
  paneOpen: boolean
  /** A blocking specialist_status call is in flight (SPECIALISTS-4218). */
  watching: boolean
  /** Consecutive sub-second watch returns; parking on the tick after FAST_STREAK_MAX. */
  fastStreak: number
  /** The result or feed view open under the selected row; null when none is. */
  detail: { kind: 'result' | 'feed'; id: string; lines: string[] } | null
  /** The previous successful read, for transition toasts; null until the first one. */
  last: Fleet | null
  /** SPECIALISTS_WAKE=off silences toasts, as the Pi extension's --no-specialist-wake does. */
  quiet: boolean
}

/** Apply one specialist_status read to the band state and redraw. */
function apply($: EngineInterface, s: State, read: { ok: true; value: Record<string, unknown> } | { ok: false; error: string }): void {
  if (read.ok) {
    s.fleet = fleetOf(read.value)
    s.error = null
    if (!s.quiet) for (const text of transitionsOf(s.last, s.fleet)) $.ui.toast(text, { timeoutMs: TOAST_MS })
    s.last = s.fleet
    if (s.selected && !s.fleet.activations.some(a => a.activation_id === s.selected)) s.selected = null
    if (s.detail && s.detail.id !== s.selected) s.detail = null
    // A live feed keeps up with the activation; a settled one is read once.
    const row = s.detail?.kind === 'feed' ? s.fleet.activations.find(a => a.activation_id === s.detail!.id) : undefined
    if (row && isActive(row.state)) void loadDetail($, s, 'feed', row.activation_id)
  } else {
    s.error = read.error
  }
  $.ui.invalidate('ui.render')
}

async function refresh($: EngineInterface, s: State): Promise<void> {
  if (s.polling) return
  s.polling = true
  try {
    apply($, s, await callTool($, 'specialist_status'))
  } finally {
    s.polling = false
  }
}

/**
 * One blocking-watch cycle (SPECIALISTS-4218): call specialist_status with
 * wait_for_change so the SERVER parks until the fleet changes or the timeout passes, then
 * redraw and re-arm. Replaces the fixed 2s poll — the steady request stream that cost every
 * idle session 0.03-0.1 core of MCP-server CPU. Self-sustaining while the server blocks; a
 * server that answers instantly (no wait support, or failing fast) is detected by the
 * streak and parks on the POLL_MS tick instead of spinning.
 */
async function watchOnce($: EngineInterface, s: State): Promise<void> {
  if (s.watching) return
  s.watching = true
  try {
    const startedAt = Date.now()
    const read = await callTool($, 'specialist_status', { wait_for_change: true, timeout_s: WAIT_TIMEOUT_S })
    const took = Date.now() - startedAt
    apply($, s, read)
    if (took >= FAST_RETURN_MS) {
      s.fastStreak = 0
      void watchOnce($, s) // blocked server: re-arm immediately, one call per WAIT_TIMEOUT_S
    } else if (s.fastStreak < FAST_STREAK_MAX) {
      s.fastStreak += 1 // maybe a real change answered in <1s: allow a couple before concluding
      void watchOnce($, s)
    } // else: instant answers are an unsupported wait — park on the POLL_MS tick
  } finally {
    s.watching = false
  }
}

/** Read a result or feed into the detail view under the selected row. */
async function loadDetail($: EngineInterface, s: State, kind: 'result' | 'feed', id: string): Promise<void> {
  const read = kind === 'result'
    ? await callTool($, 'specialist_result', { activation_id: id })
    : await callTool($, 'specialist_feed', { activation_id: id, limit: FEED_LINES })
  // The operator may have closed or switched the view while the call was in flight.
  if (s.detail && (s.detail.id !== id || s.detail.kind !== kind)) return
  s.detail = {
    kind,
    id,
    lines: read.ok ? (kind === 'result' ? resultLinesOf(read.value) : feedLinesOf(read.value)) : [`${kind} unavailable · ${read.error}`],
  }
  $.ui.invalidate('ui.render')
}

function toggleDetail($: EngineInterface, s: State, kind: 'result' | 'feed', id: string): void {
  if (s.detail?.kind === kind && s.detail.id === id) {
    s.detail = null
    $.ui.invalidate('ui.render')
    return
  }
  s.detail = { kind, id, lines: ['loading…'] }
  $.ui.invalidate('ui.render')
  void loadDetail($, s, kind, id)
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
    rows: Math.min(48, s.fleet.activations.length * 2 + 8 + DETAIL_PANE_LINES),
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
function fleetBody($: EngineInterface, s: State, ui: Kit, rows: Activation[], site: string, detailLines: number) {
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
          <Box>
            <Button key={`result:${selectedRow.activation_id}`} hotkey="r" onPress={() => toggleDetail($, s, 'result', selectedRow.activation_id)}>
              {s.detail?.kind === 'result' ? 'hide result' : 'result'}
            </Button>
            <Text> </Text>
            <Button key={`feed:${selectedRow.activation_id}`} hotkey="f" onPress={() => toggleDetail($, s, 'feed', selectedRow.activation_id)}>
              {s.detail?.kind === 'feed' ? 'hide feed' : 'feed'}
            </Button>
            <Text> </Text>
            <Button
              key={`stop:${selectedRow.activation_id}`}
              hotkey="x"
              onPress={() => void act($, s, 'specialist_stop_activation', { activation_id: selectedRow.activation_id, reason: 'operator request' }, `Stopped ${selectedRow.activation_id}.`)}
            >
              stop
            </Button>
          </Box>
          {s.detail && s.detail.id === selectedRow.activation_id ? (
            <Box flexDirection="column">
              {(s.detail.kind === 'feed' ? s.detail.lines.slice(-detailLines) : s.detail.lines.slice(0, detailLines)).map((line, i) => (
                <Text key={`${site}:detail:${i}`} dimColor={s.detail!.kind === 'feed'} wrap="truncate-end">{line}</Text>
              ))}
              {s.detail.lines.length > detailLines ? (
                <Text dimColor italic>{`… ${s.detail.lines.length - detailLines} more lines · /specialists ${s.detail.kind} ${shortId(selectedRow.activation_id)}`}</Text>
              ) : null}
            </Box>
          ) : null}
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
    watching: false,
    fastStreak: 0,
    detail: null,
    last: null,
    quiet: false,
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Live Specialists fleet: status, result, feed, reply, steer, resume, stop',
        argumentHint: '[status|result|feed|show|hide|expand|collapse|reply|steer|resume|stop] …',
        immediate: true,
      })
    } catch {
      // Another Specialists surface may already serve the command.
    }
    s.quiet = String((await $.env.get('SPECIALISTS_WAKE').catch(() => undefined)) ?? '').toLowerCase() === 'off'
    s.timer?.cancel()
    // The tick is the skeleton, not the heartbeat: it re-arms the blocking watch whenever
    // no call is in flight (server without wait support, or between re-arms), while a
    // server that blocks makes each call last WAIT_TIMEOUT_S — the request rate of an
    // idle session drops from one per POLL_MS to one per WAIT_TIMEOUT_S (SPECIALISTS-4218).
    s.timer = $.clock.every(POLL_MS, () => void watchOnce($, s))
    void refresh($, s)
    void watchOnce($, s)
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

    if (verb === 'status' && !ref) {
      await refresh($, s)
      return { text: reportOf(s.fleet, s.error, Date.now()) }
    }

    if (verb === 'status' || verb === 'result' || verb === 'feed') {
      if (!ref) return { text: USAGE }
      // result and feed reach earlier-session activations too, so an id the live fleet does
      // not know goes to the server as given; only an ambiguous live prefix is refused here.
      await refresh($, s)
      const target = resolveActivation(s.fleet, ref)
      if (typeof target === 'string' && target.startsWith('Ambiguous')) return { text: target }
      const id = typeof target === 'string' ? ref : target.activation_id
      if (verb === 'status') {
        if (typeof target === 'string') return { text: target }
        const ask = s.fleet.asks.find(a => a.activation_id === id)
        return {
          text: [
            `${markerOf(target, ask, Date.now())} ${target.specialist ?? 'specialist'} ${id} · ${target.state ?? 'unknown'}`,
            `  issue ${target.bead_id ?? '—'} · ${target.resolved_model ?? '?model'}${target.thinking_level ? ` · ${target.thinking_level}` : ''}`,
            `  ${metricsOf(target, ask, Date.now())}`,
            ...(target.purpose ? [`  purpose: ${target.purpose}`] : []),
            ...(ask ? [`  ${ask.kind ?? 'ask'} ${ask.message_id}: ${ask.body ?? ''}`] : []),
          ].join('\n'),
        }
      }
      if (verb === 'result') {
        const read = await callTool($, 'specialist_result', { activation_id: id })
        return { text: read.ok ? resultLinesOf(read.value).join('\n') : `specialist_result refused: ${read.error}` }
      }
      const lines = Math.min(200, Math.max(1, Number(rest[0]) || FEED_LINES))
      const read = await callTool($, 'specialist_feed', { activation_id: id, limit: lines })
      return { text: read.ok ? feedLinesOf(read.value).join('\n') : `specialist_feed refused: ${read.error}` }
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
        {rows.length > 0 || s.flash ? fleetBody($, s, { Box, Text, Button, Input }, rows, 'band', DETAIL_BAND_LINES) : null}
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
        {fleetBody($, s, { Box, Text, Button, Input }, orderedOf(s.fleet), 'pane', DETAIL_PANE_LINES)}
        <Text dimColor>esc closes · select a row to read its result or feed, or to reply, steer, resume or stop</Text>
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
