import type { McpToolResult, On, RenderInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { COLLAPSE_AT, MCP_SERVER, PANE_ID, POLL_MS, feedLinesOf, resultLinesOf, transitionsOf } from '../hooks/register'

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
    expect(drawn).toContain('SPECIALISTS')
    expect(drawn).toContain('1 running')
    expect(drawn).toContain('executor:4245711d')
    expect(drawn).toContain('XTRM-464')
    expect(drawn).toContain('Implement the fleet band')
    expect(drawn).toContain('2m14s • 3t • 12k')
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
    expect(textOf(await $.ui.render(BAND))).toContain('SPECIALISTS')
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
