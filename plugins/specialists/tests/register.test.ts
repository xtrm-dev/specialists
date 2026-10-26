import type { McpToolResult, On, RenderInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { COLLAPSE_AT, MCP_SERVER, PANE_ID, POLL_MS, ROLE_NUDGE_RE, displayEntryOf, feedLinesOf, fleetOf, headerOf, headerTextOf, markerOf, markerTextOf, metricsOf, metricsTextOf, orderedOf, reportOf, resultLinesOf, roleNudgeLine, transitionsOf, workTextOf } from '../hooks/register'

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

const BAND: RenderInput<'AbovePrompt'> = {
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'band',
  viewport: { columns: 120, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
}

const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: PANE_ID,
  viewport: { columns: 160, rows: 40, isFullscreen: true },
  props: {
    title: 'Specialists',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}

const RUNNING = {
  activation_id: 'act:4245711d-4e3',
  specialist: 'executor',
  bead_id: 'XTRM-464',
  state: 'running',
  access: 'HIGH',
  resolved_model: 'claude-sonnet-5',
  thinking_level: 'medium',
  elapsed_s: 134,
  turn_count: 3,
  token_usage: { input_tokens: 9000, output_tokens: 3000 },
  purpose: 'Implement the fleet band',
}

const BLOCKED = {
  activation_id: 'act:67eff6ec-d2f',
  specialist: 'debugger',
  bead_id: 'XTRM-467',
  state: 'running',
  access: 'LOW',
  elapsed_s: 40,
}

const ASK = {
  message_id: 'msg-1',
  kind: 'question',
  activation_id: BLOCKED.activation_id,
  from: 'debugger',
  body: 'Which base branch?',
  asked_at: 0,
}

const json = (value: unknown): McpToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  isError: false,
})

/** The session's Specialists MCP server, answered from memory; every call is recorded. */
function server(on: On, status: () => McpToolResult | Error, answers: Record<string, unknown> = {}) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  on('mcp.call', ($, e) => {
    calls.push(e)
    if (e.tool !== 'specialist_status') return { value: json(answers[e.tool] ?? { status: 'ok' }) }
    const answer = status()
    return answer instanceof Error ? { deny: answer.message } : { value: answer }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: ['engine band'] }) as never)
  on('ui.render', { component: 'Pane' }, () => ({ type: 'Box', props: {}, children: ['engine pane'] }) as never)
  on('ui.open', ($, e) => {
    panes.push({ open: e })
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.push({ close: e.id })
    return { value: undefined }
  })
  return calls
}

let panes: unknown[] = []
let toasts: string[] = []

const RESULT = { activation_id: RUNNING.activation_id, status: 'completed', resolved_model: 'm1', output: 'line one\nline two\n' }
const FEED = { activation_id: RUNNING.activation_id, events: ['12:00:01 #4 tool    read a.ts', '12:00:02 #6 text    done'], last_seq: 6, total: 5, truncated: true }

function textOf(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (!tree || typeof tree !== 'object') return ''
  const props = Reflect.get(tree, 'props') as Record<string, unknown> | undefined
  const lead = typeof props?.label === 'string' ? props.label : ''
  return lead + textOf(Reflect.get(tree, 'children'))
}

const command = (args: string) => ({
  command: 'specialists',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
}) as const

describe('register', () => {
  test('polls the plugin server by its /mcp name and draws the live fleet', async ($, on) => {
    const clock = mock.clock(on)
    let fleet = { activations: [] as unknown[], pending_asks: [] as unknown[] }
    const calls = server(on, () => json(fleet))

    await $.session.start(SESSION)
    await clock.settle()

    expect(calls[0]).toEqual({ server: MCP_SERVER, tool: 'specialist_status', args: {} })
    expect(textOf(await $.ui.render(BAND)), 'an empty fleet leaves the band to the engine').toBe('engine band')

    fleet = { activations: [RUNNING], pending_asks: [] }
    await clock.advance(POLL_MS)

    const drawn = textOf(await $.ui.render(BAND))
    expect(drawn).toContain('specialists')
    expect(drawn).toContain('1 running')
    expect(drawn).toContain('executor:4245711d')
    expect(drawn).toContain('XTRM-464')
    expect(drawn).toContain('2m14s • 3 turns • 12k')
    // The purpose lives in the selected-row detail (the band stays compact):
    // unselected rows carry no purpose, selecting reveals it.
    expect(drawn).not.toContain('Implement the fleet band')
    const ui = await $.ui.mount({ ...BAND, plugin: 'specialists' })
    await ui.press({ key: `row:${RUNNING.activation_id}` })
    await ui.redraw()
    expect(textOf(await ui.drawn())).toContain('Implement the fleet band')
  })

  test('the watch parks server-side instead of polling at a fixed rate (SPECIALISTS-4218)', async ($, on) => {
    const clock = mock.clock(on)
    const fleet = { activations: [] as unknown[], pending_asks: [] as unknown[] }
    const calls = server(on, () => json(fleet))

    await $.session.start(SESSION)
    await clock.settle()

    // The immediate paint stays a plain read; the watch itself asks the server to block.
    expect(calls[0]).toEqual({ server: MCP_SERVER, tool: 'specialist_status', args: {} })
    expect(calls.slice(1).some(c => (c.args as Record<string, unknown> | undefined)?.wait_for_change === true)).toBe(true)

    // An instantly-answering server (no wait support) must not be hammered: the fast-return
    // streak parks the watch and the tick takes over — one call per POLL_MS, the pre-4218
    // cadence, never a spin.
    const before = calls.length
    await clock.advance(POLL_MS * 3)
    expect(calls.length - before).toBe(3)
  })

  test('a failing server is reported, never shown as an empty fleet', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => ({ content: [{ type: 'text', text: 'server not connected' }], isError: true }))

    await $.session.start(SESSION)
    await clock.settle()

    const { text } = await $.command.run(command('status'))
    expect(text).toContain('status unavailable · server not connected')
    expect(textOf(await $.ui.render(BAND))).toContain('status unavailable · server not connected')
  })

  test('a thrown call is reported too', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => new Error('no such server'))

    await $.session.start(SESSION)
    await clock.settle()

    expect((await $.command.run(command('status'))).text).toMatch(/status unavailable · .*no such server/)
  })

  test('a blocked specialist sorts first and is answered from the band', async ($, on) => {
    const clock = mock.clock(on)
    const calls = server(on, () => json({ activations: [RUNNING, BLOCKED], pending_asks: [ASK] }))

    await $.session.start(SESSION)
    await clock.settle()

    const ui = await $.ui.mount({ ...BAND, plugin: 'specialists' })
    const band = textOf(await ui.drawn())
    expect(band).toContain('1 running • ! 1 blocked')
    expect(band.indexOf('debugger:67eff6ec'), 'blocked row first').toBeLessThan(band.indexOf('executor:4245711d'))
    expect(band).toContain('waiting')

    await ui.press({ key: `row:${BLOCKED.activation_id}` })
    await ui.redraw()
    expect(textOf(await ui.drawn())).toContain('Which base branch?')

    await ui.input({ key: 'reply:msg-1', text: 'master' })
    await clock.settle()
    expect(calls.find(c => c.tool === 'specialist_reply')?.args).toEqual({ message_id: 'msg-1', body: 'master' })
  })

  test('commands resolve a short id and tell the model what the operator did', async ($, on) => {
    const clock = mock.clock(on)
    const calls = server(on, () => json({ activations: [RUNNING, BLOCKED], pending_asks: [] }))

    await $.session.start(SESSION)
    await clock.settle()

    const stopped = await $.command.run(command('stop 4245711d wrong approach'))
    expect(calls.find(c => c.tool === 'specialist_stop_activation')?.args).toEqual({
      activation_id: RUNNING.activation_id,
      reason: 'wrong approach',
    })
    expect(stopped.text).toBe(`Stopped ${RUNNING.activation_id}.`)
    expect(stopped.context?.[0]).toContain('The operator ran /specialists stop')

    await $.command.run(command('steer 67eff6ec look at the lockfile first'))
    expect(calls.find(c => c.tool === 'specialist_steer')?.args).toEqual({
      activation_id: BLOCKED.activation_id,
      message: 'look at the lockfile first',
    })

    expect((await $.command.run(command('resume nope go'))).text).toBe('Unknown activation: nope')
    expect((await $.command.run(command('reply msg-1'))).text).toContain('Usage:')
  })

  test('a refused action is shown as refused', async ($, on) => {
    const clock = mock.clock(on)
    on('mcp.call', ($, e) =>
      e.tool === 'specialist_status'
        ? { value: json({ activations: [RUNNING], pending_asks: [] }) }
        : { value: json({ status: 'error', error: 'Unknown activation: act:4245711d-4e3' }) },
    )
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.invalidate', () => ({ value: undefined }))

    await $.session.start(SESSION)
    await clock.settle()

    expect((await $.command.run(command('stop 4245711d'))).text).toBe(
      'specialist_stop_activation refused: Unknown activation: act:4245711d-4e3',
    )
  })

  test('hide gives the band back; collapse keeps only the header', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => json({ activations: [RUNNING], pending_asks: [] }))

    await $.session.start(SESSION)
    await clock.settle()

    await $.command.run(command('collapse'))
    const collapsed = textOf(await $.ui.render(BAND))
    expect(collapsed).toContain('1 running')
    expect(collapsed).not.toContain('executor:')

    await $.command.run(command('hide'))
    expect(textOf(await $.ui.render(BAND))).toBe('engine band')

    await $.command.run(command('show'))
    expect(textOf(await $.ui.render(BAND))).toContain('specialists')
  })

  test('a survey keeps the band', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => json({ activations: [RUNNING], pending_asks: [] }))

    await $.session.start(SESSION)
    await clock.settle()

    expect(textOf(await $.ui.render({ ...BAND, props: { ...BAND.props, hasSurvey: true } }))).toBe('engine band')
  })
  test(`above ${COLLAPSE_AT} the band folds to one line and keeps blocked rows`, async ($, on) => {
    const clock = mock.clock(on)
    const many = [RUNNING, BLOCKED, ...[1, 2].map(n => ({ ...RUNNING, activation_id: `act:0000000${n}-aaa`, specialist: `worker${n}` }))]
    server(on, () => json({ activations: many, pending_asks: [ASK] }))

    await $.session.start(SESSION)
    await clock.settle()

    const band = textOf(await $.ui.render(BAND))
    expect(band).toContain('3 running • ! 1 blocked')
    expect(band).toContain('open')
    expect(band, 'the blocked row stays in the band').toContain('debugger:67eff6ec')
    expect(band, 'running rows move to the pane').not.toContain('executor:4245711d')
    expect(band).not.toContain('worker1')
  })

  test('/specialists opens the fleet pane and closes it again', async ($, on) => {
    const clock = mock.clock(on)
    panes = []
    server(on, () => json({ activations: [RUNNING, BLOCKED], pending_asks: [] }))

    await $.session.start(SESSION)
    await clock.settle()

    expect((await $.command.run(command(''))).text).toBe('Specialists pane shown')
    expect(panes[0]).toMatchObject({ open: { id: PANE_ID, focus: true, closeOnEscape: true } })

    const pane = textOf(await $.ui.render({ ...PANE, requestId: PANE_ID }))
    expect(pane).toContain('executor:4245711d')
    expect(pane).toContain('debugger:67eff6ec')

    const band = textOf(await $.ui.render(BAND))
    expect(band, 'the band folds while the pane holds the list').toContain('close')
    expect(band).not.toContain('executor:4245711d')

    expect((await $.command.run(command(''))).text).toBe('Specialists pane hidden')
    expect(panes).toContainEqual({ close: PANE_ID })
    expect(textOf(await $.ui.render(BAND))).toContain('executor:4245711d')
  })

  test('the band open button opens the pane', async ($, on) => {
    const clock = mock.clock(on)
    panes = []
    const many = [1, 2, 3, 4].map(n => ({ ...RUNNING, activation_id: `act:0000000${n}-aaa` }))
    server(on, () => json({ activations: many, pending_asks: [] }))

    await $.session.start(SESSION)
    await clock.settle()

    const ui = await $.ui.mount({ ...BAND, plugin: 'specialists' })
    await ui.press({ key: 'open' })
    await clock.settle()
    expect(panes[0]).toMatchObject({ open: { id: PANE_ID } })
  })

  test('transitions owe a toast once, and the first read owes none', () => {
    const before = { activations: [RUNNING, BLOCKED], asks: [] }
    const after = {
      activations: [{ ...RUNNING, state: 'settled' }, { ...BLOCKED, state: 'failed' }],
      asks: [ASK],
    }
    expect(transitionsOf(null, after)).toEqual([])
    expect(transitionsOf(before, after)).toEqual([
      'Specialist executor:4245711d finished · XTRM-464',
      'Specialist debugger:67eff6ec FAILED · XTRM-467',
      'Specialist debugger:67eff6ec asked a question',
    ])
    expect(transitionsOf(after, after)).toEqual([])
  })

  test('result and feed reads become lines', () => {
    expect(resultLinesOf(RESULT)).toEqual(['completed · m1', 'line one', 'line two'])
    expect(resultLinesOf({ state: 'running', next: 'specialist_steer' })).toEqual(['running · use specialist_steer'])
    expect(feedLinesOf(FEED)).toEqual(['… 3 earlier events', ...FEED.events])
    expect(feedLinesOf({ events: [] })).toEqual(['no events yet'])
  })

  test('a finished activation toasts once while the band watches', async ($, on) => {
    const clock = mock.clock(on)
    toasts = []
    let fleet = { activations: [RUNNING], pending_asks: [] as unknown[] }
    server(on, () => json(fleet))

    await $.session.start(SESSION)
    await clock.settle()
    expect(toasts).toEqual([])

    fleet = { activations: [{ ...RUNNING, state: 'settled' }], pending_asks: [] }
    await clock.advance(POLL_MS)
    await clock.advance(POLL_MS)
    expect(toasts).toEqual(['Specialist executor:4245711d finished · XTRM-464'])
  })

  test('/specialists result, feed and status <id> read one activation', async ($, on) => {
    const clock = mock.clock(on)
    const calls = server(on, () => json({ activations: [RUNNING], pending_asks: [] }), {
      specialist_result: RESULT,
      specialist_feed: FEED,
    })
    await $.session.start(SESSION)
    await clock.settle()

    expect((await $.command.run(command('result 4245711d'))).text).toBe('completed · m1\nline one\nline two')
    expect(calls.find(c => c.tool === 'specialist_result')?.args).toEqual({ activation_id: RUNNING.activation_id })

    expect((await $.command.run(command('feed 4245711d 12'))).text).toContain('read a.ts')
    expect(calls.find(c => c.tool === 'specialist_feed')?.args).toEqual({ activation_id: RUNNING.activation_id, limit: 12 })

    // An earlier-session id the live fleet does not know still reaches the server.
    await $.command.run(command('result act:deadbeef-000'))
    expect(calls.filter(c => c.tool === 'specialist_result').at(-1)?.args).toEqual({ activation_id: 'act:deadbeef-000' })

    const status = (await $.command.run(command('status 4245711d'))).text
    expect(status).toContain('executor act:4245711d-4e3 · running')
    expect(status).toContain('purpose: Implement the fleet band')
  })

  test('the pane shows a selected row\'s result and feed', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => json({ activations: [RUNNING], pending_asks: [] }), {
      specialist_result: RESULT,
      specialist_feed: FEED,
    })
    await $.session.start(SESSION)
    await clock.settle()

    const ui = await $.ui.mount({ ...PANE, plugin: 'specialists' })
    await ui.press({ key: `row:${RUNNING.activation_id}` })
    await ui.redraw()
    await ui.press({ key: `result:${RUNNING.activation_id}` })
    await clock.settle()
    await ui.redraw()
    expect(textOf(await ui.drawn())).toContain('line two')

    await ui.press({ key: `feed:${RUNNING.activation_id}` })
    await clock.settle()
    await ui.redraw()
    const drawn = textOf(await ui.drawn())
    expect(drawn).toContain('read a.ts')
    expect(drawn).not.toContain('line two')
  })
})

describe('fleet display fallback and preference (SPECIALISTS-4365)', () => {
  test('a payload without display renders the old output with zero errors', () => {
    const fleet = fleetOf({ activations: [RUNNING, BLOCKED], pending_asks: [ASK] })
    expect(fleet.display).toBeUndefined()
    expect(headerOf(fleet)).toBe('1 running • ! 1 blocked')
    expect(headerTextOf(fleet)).toBe('1 running • ! 1 blocked')
    // nowMs 0 pins the spinner to its first frame.
    const row = fleet.activations.find(a => a.activation_id === RUNNING.activation_id)!
    const ask = fleet.asks.find(a => a.activation_id === RUNNING.activation_id)
    expect(markerOf(row, ask, 0)).toBe('◐')
    expect(markerTextOf(fleet, row, ask, 0)).toBe('◐')
    expect(metricsOf(row, ask, 0)).toBe('2m14s • 3 turns • 12k')
    expect(metricsTextOf(fleet, row, ask, 0)).toBe('2m14s • 3 turns • 12k')
    expect(workTextOf(fleet, row)).toBe('XTRM-464')
    expect(reportOf(fleet, null, 0)).toContain('◐ executor act:4245711d-4e3  XTRM-464  2m14s • 3 turns • 12k')
    expect(orderedOf(fleet).map(a => a.activation_id)).toEqual([BLOCKED.activation_id, RUNNING.activation_id])
  })

  test('a payload with display prefers the runtime strings', () => {
    const fleet = fleetOf({
      activations: [RUNNING, BLOCKED],
      pending_asks: [ASK],
      display: {
        header: '1 running 1 blocked',
        activations: [
          { activation_id: RUNNING.activation_id, marker: '◐', metrics: '2m14s 3 turns 12k', work: 'XTRM-464' },
          { activation_id: BLOCKED.activation_id, marker: '!', metrics: 'asked 19s', work: 'XTRM-467' },
        ],
      },
    })
    expect(headerTextOf(fleet)).toBe('1 running 1 blocked')
    const blocked = fleet.activations.find(a => a.activation_id === BLOCKED.activation_id)!
    const ask = fleet.asks.find(a => a.activation_id === BLOCKED.activation_id)
    expect(displayEntryOf(fleet, BLOCKED.activation_id)).toMatchObject({ marker: '!', metrics: 'asked 19s', work: 'XTRM-467' })
    expect(markerTextOf(fleet, blocked, ask, 0)).toBe('!')
    expect(metricsTextOf(fleet, blocked, ask, 0)).toBe('asked 19s')
    expect(workTextOf(fleet, blocked)).toBe('XTRM-467')
    const report = reportOf(fleet, null, 0)
    expect(report).toContain('Specialists · 1 running 1 blocked')
    expect(report).toContain('! debugger act:67eff6ec-d2f  XTRM-467  asked 19s')
    expect(report).not.toContain('waiting 19s')
    // A malformed display block is ignored, never fatal.
    const broken = fleetOf({ activations: [RUNNING], pending_asks: [], display: { header: 42, activations: 'nope' } })
    expect(headerTextOf(broken)).toBe(headerOf(broken))
    expect(displayEntryOf(broken, RUNNING.activation_id)).toBeUndefined()
  })
})

describe('role-to-specialist nudge (SPECIALISTS-4343)', () => {
  const submit = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as never

  test('the trigger matches every listed word and nothing else', () => {
    for (const word of ['review', 'dispatch', 'subagent', 'teammate', 'monitor', 'deploy']) {
      expect(ROLE_NUDGE_RE.test(`please ${word} this`), word).toBe(true)
    }
    expect(ROLE_NUDGE_RE.test('Please Review This Diff')).toBe(true)
    expect(ROLE_NUDGE_RE.test('hello there')).toBe(false)
    expect(ROLE_NUDGE_RE.test('')).toBe(false)
  })

  test('the nudge line ends with the specialist_list verify and names no absent role', () => {
    const line = roleNudgeLine()
    expect(line).toContain('reviewer')
    expect(line?.endsWith('verify with specialist_list')).toBe(true)
    for (const absent of ['pr-reviewer', 'deploy-watcher', 'production-monitor']) {
      expect(line).not.toContain(absent)
    }
  })

  test('a matching prompt carries one context line, a non-matching prompt passes through', async ($, on) => {
    on('prompt.submit', ($, e) => ({ text: e.text, ...(e.context !== undefined && { context: e.context }) })) // the engine answer beneath the plugin

    const matched = await $.prompt.submit(submit('please review this diff'))
    expect(matched.deny).toBeUndefined()
    expect(matched.context).toHaveLength(1)
    expect(matched.context?.[0]).toContain('reviewer')
    expect(matched.context?.[0]?.endsWith('verify with specialist_list')).toBe(true)
    expect(matched.text).toBe('please review this diff')
  })

  test('a non-matching prompt adds no context', async ($, on) => {
    on('prompt.submit', ($, e) => ({ text: e.text, ...(e.context !== undefined && { context: e.context }) })) // the engine answer beneath the plugin

    const plain = await $.prompt.submit(submit('hello there'))
    expect(plain.deny).toBeUndefined()
    expect(plain.context).toBeUndefined()
    expect(plain.text).toBe('hello there')
  })

  test('the notice appears at most once per session', async ($, on) => {
    on('prompt.submit', ($, e) => ({ text: e.text, ...(e.context !== undefined && { context: e.context }) })) // the engine answer beneath the plugin

    const first = await $.prompt.submit(submit('please review this diff'))
    expect(first.context).toHaveLength(1)
    const second = await $.prompt.submit(submit('deploy the thing now'))
    expect(second.deny).toBeUndefined()
    expect(second.context, 'a second matching prompt stays silent').toBeUndefined()
  })
})

describe('fleet snapshots (SPECIALISTS-4346)', () => {
  // The mock engine applies no width-based truncation: the 80/120/144 trees are
  // byte-identical, so one constant pins each scenario and every width asserts
  // against it. `claude plugin test` runs without node:fs/process, so the
  // snapshots live inline here instead of on-disk files.
  const bandAt = (columns: number): RenderInput<'AbovePrompt'> => ({
    ...BAND,
    viewport: { ...BAND.viewport, columns },
    props: { ...BAND.props, bodyColumns: columns },
  })

  const paneAt = (columns: number): RenderInput<'Pane'> => ({
    ...PANE,
    viewport: { ...PANE.viewport, columns },
    props: { ...PANE.props, bodyColumns: columns },
  })

  /** Stable layout serialization: element types, scalar props and text. Literal
   *  spaces stay visible inside quotes; paddingLeft/wrap/color ride on the node. */
  function treeSnapshot(tree: unknown): string {
    const lines: string[] = []
    const walk = (node: unknown, depth: number): void => {
      const pad = '  '.repeat(depth)
      if (node === null || node === undefined) return
      if (typeof node === 'string' || typeof node === 'number') {
        const s = String(node)
        if (s !== '') lines.push(`${pad}"${s}"`)
        return
      }
      if (Array.isArray(node)) { node.forEach(n => walk(n, depth)); return }
      if (typeof node !== 'object') return
      const record = node as Record<string, unknown>
      const props = (Reflect.get(node, 'props') ?? {}) as Record<string, unknown>
      const entries = Object.entries(props)
        .filter(([k, v]) => k !== 'onPress' && k !== 'onSubmit' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .sort()
      lines.push(`${pad}<${String(record.type)}${entries.length > 0 ? ' ' + entries.join(' ') : ''}>`)
      walk(Reflect.get(node, 'children'), depth + 1)
    }
    walk(tree, 0)
    return lines.join('\n')
  }

  /** Wall-clock pieces the mock cannot pin: spinner frames and ask-wait durations. */
  function normalizeSnapshot(snap: string): string {
    return snap.replace(/[◐◓◑◒]/g, '◌').replace(/waiting [\dhms]+/g, 'waiting <dur>')
  }

  const snapOf = (tree: unknown): string => normalizeSnapshot(treeSnapshot(tree))

  /** Every raw string leaf, in order — indentation stays measurable. */
  function stringLeaves(tree: unknown): string[] {
    const out: string[] = []
    const walk = (node: unknown): void => {
      if (typeof node === 'string') { if (node !== '') out.push(node); return }
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (!node || typeof node !== 'object') return
      walk(Reflect.get(node, 'children'))
    }
    walk(tree)
    return out
  }

  /** Every element with its scalar props (handlers excluded). */
  function elementNodes(tree: unknown): { type: unknown; props: Record<string, unknown> }[] {
    const out: { type: unknown; props: Record<string, unknown> }[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (!node || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      if (typeof record.type === 'string') {
        const props = (Reflect.get(node, 'props') ?? {}) as Record<string, unknown>
        const scalar: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(props)) {
          if (k === 'onPress' || k === 'onSubmit') continue
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') scalar[k] = v
        }
        out.push({ type: record.type, props: scalar })
      }
      walk(Reflect.get(node, 'children'))
    }
    walk(tree)
    return out
  }

  const SNAP_BAND_SELECTED = `<Box flexDirection="column">
  <Box flexDirection="row" paddingLeft=2>
    <Text bold=true>
      "specialists"
    <Text>
      " "
      "1 running • ! 1 blocked"
    <Text dimColor=true>
      " · "
    <Button hotkey="o" key="open" label="open (o)" plain=true>
  <Box flexDirection="column">
    <Box flexDirection="column" paddingLeft=4>
      <Box flexDirection="column" key="band:act:67eff6ec-d2f">
        <Button key="row:act:67eff6ec-d2f" label="▸ ! debugger:67eff6ec XTRM-467 ?model · waiting <dur>" plain=true>
      <Box flexDirection="column" key="band:act:4245711d-4e3">
        <Button key="row:act:4245711d-4e3" label="▾ ◌ executor:4245711d XTRM-464 claude-sonnet-5 medium · 2m14s • 3 turns • 12k" plain=true>
    <Box flexDirection="column" paddingLeft=6>
      <Text dimColor=true wrap="wrap">
        "act:4245711d-4e3"
        " · "
        "running"
      <Text dimColor=true wrap="wrap">
        "purpose: "
        "Implement the fleet band"
      <Input key="steer:act:4245711d-4e3" label="steer " placeholder="redirect the running specialist" submitLabel="steer">
      <Box>
        <Button hotkey="r" key="result:act:4245711d-4e3" label="result (r)" plain=true>
        <Text>
          " "
        <Button hotkey="f" key="feed:act:4245711d-4e3" label="feed (f)" plain=true>
      <Box>
        <Button hotkey="x" key="stop:act:4245711d-4e3" label="stop (x)" plain=true>`
  const SNAP_BAND_FOLDED = `<Box flexDirection="column">
  <Box flexDirection="row" paddingLeft=2>
    <Text bold=true>
      "specialists"
    <Text>
      " "
      "5 running • ! 1 blocked"
    <Text dimColor=true>
      " · "
    <Button hotkey="o" key="open" label="open (o)" plain=true>
  <Box paddingLeft=4>
    <Text dimColor=true wrap="wrap">
      "open the pane or /specialists for the full fleet"
  <Box flexDirection="column">
    <Box flexDirection="column" paddingLeft=4>
      <Box flexDirection="column" key="band:act:67eff6ec-d2f">
        <Button key="row:act:67eff6ec-d2f" label="▸ ! debugger:67eff6ec XTRM-467 ?model · waiting <dur>" plain=true>`
  const SNAP_PANE_SELECTED = `<Box flexDirection="column">
  <Text bold=true>
    "1 running • ! 1 blocked"
  <Box flexDirection="column">
    <Box flexDirection="column" paddingLeft=4>
      <Box flexDirection="column" key="pane:act:67eff6ec-d2f">
        <Button key="row:act:67eff6ec-d2f" label="▸ ! debugger:67eff6ec XTRM-467 ?model · waiting <dur>" plain=true>
      <Box flexDirection="column" key="pane:act:4245711d-4e3">
        <Button key="row:act:4245711d-4e3" label="▾ ◌ executor:4245711d XTRM-464 claude-sonnet-5 medium · 2m14s • 3 turns • 12k" plain=true>
    <Box flexDirection="column" paddingLeft=6>
      <Text dimColor=true wrap="wrap">
        "act:4245711d-4e3"
        " · "
        "running"
      <Text dimColor=true wrap="wrap">
        "purpose: "
        "Implement the fleet band"
      <Input key="steer:act:4245711d-4e3" label="steer " placeholder="redirect the running specialist" submitLabel="steer">
      <Box>
        <Button hotkey="r" key="result:act:4245711d-4e3" label="result (r)" plain=true>
        <Text>
          " "
        <Button hotkey="f" key="feed:act:4245711d-4e3" label="feed (f)" plain=true>
      <Box>
        <Button hotkey="x" key="stop:act:4245711d-4e3" label="stop (x)" plain=true>
  <Text dimColor=true wrap="wrap">
    "esc closes · select a row to read its result or feed, or to reply, steer, resume or stop"`

  /** Text elements with their visible string and display props — the unit the H6/H7 verdicts read. */
  function textNodes(tree: unknown): { text: string; wrap: unknown; color: unknown }[] {
    const out: { text: string; wrap: unknown; color: unknown }[] = []
    const stringsOf = (node: unknown): string => {
      if (typeof node === 'string') return node
      if (typeof node === 'number') return String(node)
      if (Array.isArray(node)) return node.map(stringsOf).join('')
      return ''
    }
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (!node || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      const props = (Reflect.get(node, 'props') ?? {}) as Record<string, unknown>
      if (record.type === 'Text') out.push({ text: stringsOf(Reflect.get(node, 'children')), wrap: props.wrap, color: props.color })
      walk(Reflect.get(node, 'children'))
    }
    walk(tree)
    return out
  }

  for (const width of [80, 120, 144]) {
    test(`band pins the selected-row layout at ${width} columns`, async ($, on) => {
      const clock = mock.clock(on)
      server(on, () => json({ activations: [RUNNING, BLOCKED], pending_asks: [ASK] }))
      await $.session.start(SESSION)
      await clock.settle()
      const ui = await $.ui.mount({ ...bandAt(width), plugin: 'specialists' })
      await ui.press({ key: `row:${RUNNING.activation_id}` })
      await ui.redraw()
      expect(snapOf(await ui.drawn())).toBe(SNAP_BAND_SELECTED)
    })
  }

  for (const width of [80, 120, 144]) {
    test(`folded band pins the one-line layout at ${width} columns`, async ($, on) => {
      const clock = mock.clock(on)
      const many = [RUNNING, BLOCKED, ...[1, 2, 3, 4].map(n => ({ ...RUNNING, activation_id: `act:0000000${n}-aaa`, specialist: `worker${n}` }))]
      server(on, () => json({ activations: many, pending_asks: [ASK] }))
      await $.session.start(SESSION)
      await clock.settle()
      expect(snapOf(await $.ui.render(bandAt(width)))).toBe(SNAP_BAND_FOLDED)
    })
  }

  test('the band header is separated from the open button (idle case)', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => ({ content: [{ type: 'text', text: 'server not connected' }], isError: true }))
    await $.session.start(SESSION)
    await clock.settle()
    // With no activations and an error the header reads "idle"; it must not run into "open (o)".
    const band = snapOf(await $.ui.render(bandAt(80)))
    expect(band).toContain('"idle"\n    <Text dimColor=true>\n      " · "\n    <Button hotkey="o" key="open" label="open (o)" plain=true>')
  })

  for (const width of [80, 120, 144]) {
    test(`pane pins the selected-row layout at ${width} columns`, async ($, on) => {
      const clock = mock.clock(on)
      server(on, () => json({ activations: [RUNNING, BLOCKED], pending_asks: [ASK] }))
      await $.session.start(SESSION)
      await clock.settle()
      const ui = await $.ui.mount({ ...paneAt(width), plugin: 'specialists' })
      await ui.press({ key: `row:${RUNNING.activation_id}` })
      await ui.redraw()
      expect(snapOf(await ui.drawn())).toBe(SNAP_PANE_SELECTED)
    })
  }

  test('H1/H2/H3/H8 verdicts on the selected band: each hypothesis is refuted', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => json({ activations: [RUNNING, BLOCKED], pending_asks: [ASK] }))
    await $.session.start(SESSION)
    await clock.settle()
    const ui = await $.ui.mount({ ...bandAt(120), plugin: 'specialists' })
    await ui.press({ key: `row:${RUNNING.activation_id}` })
    await ui.redraw()
    const tree = await ui.drawn()
    const leaves = stringLeaves(tree)
    const buttons = elementNodes(tree).filter(n => n.type === 'Button')
    const spaced = [...leaves, ...buttons.map(b => String(b.props.label ?? ''))]
    expect(spaced.some(l => /^  /.test(l)), 'H1 refuted: no two-or-more leading literal spaces').toBe(false)
    expect(spaced.filter(l => /[^ ]  +[^ ]/.test(l)), 'H1 refuted: no doubled spaces inside labels').toEqual([])
    const boxes = elementNodes(tree).filter(n => n.type === 'Box')
    expect(boxes.some(b => b.props.paddingLeft === 2 || b.props.paddingLeft === 4 || b.props.paddingLeft === 6), 'paddingLeft carries the indentation').toBe(true)
    const labels = buttons.map(b => b.props.label)
    expect(labels.includes('open (o)'), 'H2 refuted: the unfolded band toggles with open (o)').toBe(true)
    expect(labels.some(l => typeof l === 'string' && /\[-\]|\[\+\]/.test(l)), 'H2 refuted: no [-]/[+] grammar remains').toBe(false)
    expect(textOf(tree).includes('result (r)'), 'H3 refuted: result names its hotkey').toBe(true)
    expect(textOf(tree).includes('feed (f)'), 'H3 refuted: feed names its hotkey').toBe(true)
    expect(textOf(tree).includes('stop (x)'), 'H3 refuted: stop names its hotkey').toBe(true)
    for (const key of ['result:', 'feed:', 'stop:']) {
      const button = buttons.filter(b => String(b.props.key ?? '').startsWith(key))[0]
      expect(button !== undefined && button.props.plain === true, `H3 refuted: ${key} is a plain button`).toBe(true)
    }
    const rowLabels = buttons.filter(b => String(b.props.key ?? '').startsWith('row:')).map(b => String(b.props.label ?? ''))
    expect(rowLabels.length, 'two rows render').toBe(2)
    expect(rowLabels.every(l => l.includes('·')), 'H8 refuted: model facts and metrics share the one row line').toBe(true)
    expect(leaves.some(l => l.includes('claude-sonnet-5') && !rowLabels.some(r => r.includes(l))), 'H8 refuted: no model line rides below a row').toBe(false)
  })

  test('H1/H2 verdicts on the folded band: one grammar, padded hint', async ($, on) => {
    const clock = mock.clock(on)
    const many = [RUNNING, BLOCKED, ...[1, 2, 3, 4].map(n => ({ ...RUNNING, activation_id: `act:0000000${n}-aaa`, specialist: `worker${n}` }))]
    server(on, () => json({ activations: many, pending_asks: [ASK] }))
    await $.session.start(SESSION)
    await clock.settle()
    const tree = await $.ui.render(bandAt(120))
    const leaves = stringLeaves(tree)
    expect(leaves.some(l => /^  /.test(l)), 'H1 refuted: the folded band has no literal-space indent').toBe(false)
    const nodes = elementNodes(tree)
    const hint = textNodes(tree).filter(n => n.text.includes('for the full fleet'))
    expect(hint.length).toBe(1)
    expect(hint[0]?.wrap === 'wrap', 'the folded hint wraps').toBe(true)
    const labels = nodes.filter(n => n.type === 'Button').map(n => n.props.label)
    expect(labels.includes('open (o)'), 'H2 refuted: the folded band uses the same open (o) grammar').toBe(true)
  })

  test('H4 verdict: stop arms an inline confirm and fires only on confirm', async ($, on) => {
    const clock = mock.clock(on)
    const calls = server(on, () => json({ activations: [RUNNING], pending_asks: [] }))
    await $.session.start(SESSION)
    await clock.settle()
    const ui = await $.ui.mount({ ...bandAt(120), plugin: 'specialists' })
    await ui.press({ key: `row:${RUNNING.activation_id}` })
    await ui.redraw()
    await ui.press({ key: `stop:${RUNNING.activation_id}` })
    await ui.redraw()
    await clock.settle()
    expect(calls.some(c => c.tool === 'specialist_stop_activation'), 'H4 refuted: stop alone calls nothing').toBe(false)
    expect(textOf(await ui.drawn()).includes('cannot be undone'), 'the inline confirm renders').toBe(true)
    await ui.press({ key: `confirm-stop:${RUNNING.activation_id}` })
    await ui.redraw()
    await clock.settle()
    const stop = calls.find(c => c.tool === 'specialist_stop_activation')
    expect(stop !== undefined, 'H4 refuted: confirm fires specialist_stop_activation').toBe(true)
    expect(stop?.args).toEqual({ activation_id: RUNNING.activation_id, reason: 'operator request' })
    expect(textOf(await ui.drawn()).includes('cannot be undone'), 'the confirm clears after firing').toBe(false)
  })

  test('an armed stop cancels without calling the server', async ($, on) => {
    const clock = mock.clock(on)
    const calls = server(on, () => json({ activations: [RUNNING], pending_asks: [] }))
    await $.session.start(SESSION)
    await clock.settle()
    const ui = await $.ui.mount({ ...bandAt(120), plugin: 'specialists' })
    await ui.press({ key: `row:${RUNNING.activation_id}` })
    await ui.redraw()
    await ui.press({ key: `stop:${RUNNING.activation_id}` })
    await ui.redraw()
    await clock.settle()
    await ui.press({ key: `cancel-stop:${RUNNING.activation_id}` })
    await ui.redraw()
    await clock.settle()
    expect(calls.some(c => c.tool === 'specialist_stop_activation'), 'cancel calls nothing').toBe(false)
    expect(textOf(await ui.drawn()).includes('cannot be undone'), 'cancel clears the confirm').toBe(false)
    expect(textOf(await ui.drawn()).includes('stop (x)'), 'cancel restores the stop button').toBe(true)
  })

  test('H5 verdict: the pane re-opens to follow the content', async ($, on) => {
    const clock = mock.clock(on)
    panes = []
    let fleet = { activations: [RUNNING], pending_asks: [] as unknown[] }
    server(on, () => json(fleet))
    await $.session.start(SESSION)
    await clock.settle()
    expect((await $.command.run(command(''))).text).toBe('Specialists pane shown')
    const opens = panes.filter((p): p is { open: { rows: number } } => 'open' in (p as object))
    expect(opens.length).toBe(1)
    expect(opens[0]?.open.rows > 0, 'pane opens with rows for one activation').toBe(true)
    fleet = { activations: [RUNNING, BLOCKED, ...[1, 2, 3, 4].map(n => ({ ...RUNNING, activation_id: `act:0000000${n}-aaa`, specialist: `worker${n}` }))], pending_asks: [] }
    await clock.advance(POLL_MS)
    await clock.advance(POLL_MS)
    const pane = textOf(await $.ui.render({ ...PANE, requestId: PANE_ID }))
    expect(pane, 'the pane content follows the fleet').toContain('worker1')
    expect(panes.filter(p => 'open' in (p as object)).length, 'H5 refuted: a second open follows the content').toBe(2)
    const reopened = panes.filter((p): p is { open: { rows: number } } => 'open' in (p as object))
    expect(reopened[1]?.open.rows, 'the reopened pane fits six one-line rows').toBe(6 + 8)
  })

  test('H6 verdict: footer and flash lines wrap', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => json({ activations: [RUNNING], pending_asks: [] }))
    await $.session.start(SESSION)
    await clock.settle()
    expect((await $.command.run(command(''))).text).toBe('Specialists pane shown')
    const footer = textNodes(await $.ui.render({ ...PANE, requestId: PANE_ID })).filter(n => n.text.includes('esc closes'))
    expect(footer.length).toBe(1)
    expect(footer[0]?.wrap === 'wrap', 'H6 refuted: the footer line wraps').toBe(true)
    expect((await $.command.run(command('stop 4245711d done'))).text).toBe(`Stopped ${RUNNING.activation_id}.`)
    const flash = textNodes(await $.ui.render(bandAt(120))).filter(n => n.text.includes('Stopped'))
    expect(flash.length, 'the stop flash renders in the band').toBe(1)
    expect(flash[0]?.wrap === 'wrap', 'H6 refuted: the flash line wraps').toBe(true)
  })

  test('H7 verdict: the ask line uses the theme attention key', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => json({ activations: [RUNNING, BLOCKED], pending_asks: [ASK] }))
    await $.session.start(SESSION)
    await clock.settle()
    const ui = await $.ui.mount({ ...bandAt(120), plugin: 'specialists' })
    await ui.press({ key: `row:${BLOCKED.activation_id}` })
    await ui.redraw()
    const colors = new Set(textNodes(await ui.drawn()).map(n => n.color).filter(v => typeof v === 'string'))
    expect([...colors].some(c => c.startsWith('#')), `H7 refuted: no hard-coded hex reaches the tree, saw [${[...colors]}]`).toBe(false)
    expect(colors.has('yellow'), 'the ask line uses the theme attention key').toBe(true)
  })
})
