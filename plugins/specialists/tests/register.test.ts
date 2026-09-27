import type { McpToolResult, On, RenderInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { MCP_SERVER, POLL_MS } from '../hooks/register'

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
function server(on: On, status: () => McpToolResult | Error) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  on('mcp.call', ($, e) => {
    calls.push(e)
    if (e.tool !== 'specialist_status') return { value: json({ status: 'ok' }) }
    const answer = status()
    return answer instanceof Error ? { deny: answer.message } : { value: answer }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: ['engine band'] }) as never)
  return calls
}

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

  test('a failing server is reported, never shown as an empty fleet', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => ({ content: [{ type: 'text', text: 'server not connected' }], isError: true }))

    await $.session.start(SESSION)
    await clock.settle()

    const { text } = await $.command.run(command(''))
    expect(text).toContain('status unavailable · server not connected')
    expect(textOf(await $.ui.render(BAND))).toContain('status unavailable · server not connected')
  })

  test('a thrown call is reported too', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => new Error('no such server'))

    await $.session.start(SESSION)
    await clock.settle()

    expect((await $.command.run(command(''))).text).toMatch(/status unavailable · .*no such server/)
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
})
