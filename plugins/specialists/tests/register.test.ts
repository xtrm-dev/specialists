import type { McpToolResult, On, RenderInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  COLLAPSE_AT,
  FALLBACK_WAKE_TEXT,
  channelRow,
  errorTextOf,
  isSpecialistsTool,
  MCP_SERVER,
  PANE_ID,
  parseChannelFrame,
  POLL_MS,
  specialistToolLabel,
  eventColor,
} from '../hooks/register'

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
})

const SURFACES = ['terminal', 'desktop'] as const

const CHANNEL_TEXT =
  'Specialist explorer on XTRM-464: completed (act:f6ab7b21-4a3). Call specialist_status for the authoritative result.'

describe('transcript rows', () => {
  test('colours the wake header by event', () => {
    expect(eventColor('completed')).toBe('green')
    expect(eventColor('failed')).toBe('red')
    expect(eventColor('escalation')).toBe('yellow')
    expect(eventColor('needs_reply')).toBe('yellow')
    expect(eventColor('something_else')).toBe('#9a8bff')
  })

  test('parses the channel frame and falls back on anything else', () => {
    expect(parseChannelFrame(CHANNEL_TEXT)).toEqual({
      specialist: 'explorer',
      issue: 'XTRM-464',
      event: 'completed',
      activationId: 'act:f6ab7b21-4a3',
    })
    expect(parseChannelFrame('Specialist explorer: failed (act:f6ab7b21-4a3). Call specialist_status.')).toEqual({
      specialist: 'explorer',
      event: 'failed',
      activationId: 'act:f6ab7b21-4a3',
    })
    expect(parseChannelFrame('garbage specialist text')).toBeNull()
    expect(channelRow(CHANNEL_TEXT)).toEqual({
      marker: '✓',
      identity: '@explorer:f6ab7b21',
      event: 'completed',
      issue: 'XTRM-464',
    })
    expect(channelRow('Specialist explorer: failed (act:f6ab7b21-4a3). x')?.marker).toBe('✕')
    expect(channelRow('Specialist explorer: escalation (act:f6ab7b21-4a3). x')?.marker).toBe('!')
    expect(channelRow('Specialist explorer: needs_reply (act:f6ab7b21-4a3). x')?.marker).toBe('!')
    expect(channelRow('not a frame')).toBeNull()
    expect(errorTextOf('the refusal')).toBe('the refusal')
    expect(errorTextOf({ error: 'unknown activation' })).toBe('unknown activation')
  })

  test('maps every Specialists tool to its label under both name spellings', () => {
    const cases: [string, unknown, string][] = [
      ['specialist_dispatch', { specialist: 'executor', issue_ref: 'XTRM-4' }, 'Dispatch @executor → XTRM-4'],
      ['specialist_dispatch', { specialist: 'executor', bead_id: 'XTRM-5' }, 'Dispatch @executor → XTRM-5'],
      ['specialist_dispatch', { specialist: 'executor', contract: 'x' }, 'Dispatch @executor → inline contract'],
      ['specialist_status', {}, 'Status'],
      ['specialist_list', {}, 'List specialists'],
      ['specialist_reply', { message_id: 'msg-1' }, 'Reply → msg-1'],
      ['specialist_steer', { activation_id: 'act:1234' }, 'Steer @act:1234'],
      ['specialist_resume', { activation_id: 'act:1234' }, 'Resume @act:1234'],
      ['specialist_stop_activation', { activation_id: 'act:1234' }, 'Stop @act:1234'],
      ['specialist_retry', { activation_id: 'act:1234' }, 'Retry @act:1234'],
      ['substrate_issue', {}, 'Issue'],
      ['substrate_journal', {}, 'Journal'],
      ['substrate_provenance', {}, 'Provenance'],
    ]
    for (const [bare, input, label] of cases) {
      expect(specialistToolLabel(`mcp__specialists__${bare}`, input), bare).toBe(label)
      expect(specialistToolLabel(`mcp__plugin_specialists_specialists__${bare}`, input), bare).toBe(label)
    }
    expect(isSpecialistsTool('mcp__specialists__specialist_status')).toBe(true)
    expect(isSpecialistsTool('mcp__plugin_specialists_specialists__specialist_status')).toBe(true)
    expect(isSpecialistsTool('Bash')).toBe(false)
    expect(specialistToolLabel('mcp__specialists__unknown_tool', {})).toBeNull()
    expect(specialistToolLabel('Bash', {})).toBeNull()
  })

  for (const surface of SURFACES) {
    test(`channel wake draws a teammate line and passes ctrl+o through (${surface})`, async ($, on) => {
      on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Box', props: {}, children: ['engine user row'] }) as never)

      const drawn = textOf(
        await (
          await $.ui.mount({
            plugin: 'specialists',
            surface,
            component: 'UserMessage',
            props: { text: CHANNEL_TEXT, origin: { kind: 'channel', server: MCP_SERVER }, isExpanded: false },
          })
        ).drawn(),
      )
      expect(drawn).toContain('●')
      expect(drawn).toContain('@explorer:f6ab7b21')
      expect(drawn).toContain('completed')
      expect(drawn).toContain('XTRM-464')
      expect(drawn).toContain('use specialist_status for full result')

      const expanded = await (
        await $.ui.mount({
          plugin: 'specialists',
          surface,
          component: 'UserMessage',
          props: { text: CHANNEL_TEXT, origin: { kind: 'channel', server: MCP_SERVER }, isExpanded: true },
        })
      ).drawn()
      expect(textOf(expanded)).toBe('engine user row')
    })

    test(`other user rows pass through (${surface})`, async ($, on) => {
      on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Box', props: {}, children: ['engine user row'] }) as never)

      const other = await (
        await $.ui.mount({
          plugin: 'specialists',
          surface,
          component: 'UserMessage',
          props: { text: CHANNEL_TEXT, origin: { kind: 'channel', server: 'slack' }, isExpanded: false },
        })
      ).drawn()
      expect(textOf(other)).toBe('engine user row')

      const composer = await (
        await $.ui.mount({
          plugin: 'specialists',
          surface,
          component: 'UserMessage',
          props: { text: 'hello', origin: { kind: 'composer' }, isExpanded: false },
        })
      ).drawn()
      expect(textOf(composer)).toBe('engine user row')
    })

    test(`the fallback wake is restyled, other notifications pass (${surface})`, async ($, on) => {
      on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Box', props: {}, children: ['engine user row'] }) as never)

      const wake = textOf(
        await (
          await $.ui.mount({
            plugin: 'specialists',
            surface,
            component: 'UserMessage',
            props: {
              text: FALLBACK_WAKE_TEXT,
              origin: { kind: 'task-notification' },
              isExpanded: false,
              task: { id: 'task-1', status: 'completed' },
            },
          })
        ).drawn(),
      )
      expect(wake).toContain('Specialists fallback wake')
      expect(wake).toContain('use specialist_status for full result')

      const other = textOf(
        await (
          await $.ui.mount({
            plugin: 'specialists',
            surface,
            component: 'UserMessage',
            props: {
              text: 'Some other task finished',
              origin: { kind: 'task-notification' },
              isExpanded: false,
              task: { id: 'task-2', status: 'completed' },
            },
          })
        ).drawn(),
      )
      expect(other).toBe('engine user row')
    })

    test(`a group with a Specialists call unfolds, one without is untouched (${surface})`, async ($, on) => {
      const seen: boolean[] = []
      on('ui.render', { component: 'ToolGroup' }, ($, e) => {
        seen.push(e.props.isExpanded)
        return { type: 'Box', props: {}, children: ['engine group'] } as never
      })

      await (
        await $.ui.mount({
          plugin: 'specialists',
          surface,
          component: 'ToolGroup',
          props: {
            calls: [
              { tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false },
              { tool: 'mcp__specialists__specialist_status', input: {}, isRunning: false, isErrored: false, isInterrupted: false },
            ],
            isActive: false,
            isExpanded: false,
          },
        })
      ).drawn()
      expect(seen).toEqual([true])

      seen.length = 0
      await (
        await $.ui.mount({
          plugin: 'specialists',
          surface,
          component: 'ToolGroup',
          props: {
            calls: [{ tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }],
            isActive: false,
            isExpanded: false,
          },
        })
      ).drawn()
      expect(seen).toEqual([false])
    })

    test(`each Specialists tool draws its native label and state (${surface})`, async ($, on) => {
      on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Box', props: {}, children: ['engine tool row'] }) as never)

      const caseFor = async (
        tool: string,
        input: unknown,
        state: Partial<{ isRunning: boolean; isErrored: boolean; isInterrupted: boolean; output: unknown }> = {},
      ) =>
        textOf(
          await (
            await $.ui.mount({
              plugin: 'specialists',
              surface,
              component: 'ToolUse',
              props: { tool_use_id: 't', tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...state },
            })
          ).drawn(),
        )

      expect(
        await caseFor('mcp__specialists__specialist_dispatch', { specialist: 'executor', issue_ref: 'XTRM-4' }),
      ).toContain('Dispatch @executor → XTRM-4')
      expect(
        await caseFor('mcp__plugin_specialists_specialists__specialist_reply', { message_id: 'msg-1' }),
      ).toContain('Reply → msg-1')
      expect(await caseFor('mcp__specialists__substrate_journal', {})).toContain('Journal')

      const running = await caseFor('mcp__specialists__specialist_status', {}, { isRunning: true })
      expect(running).toContain('Status')
      expect(running, 'a running call stays visible').toContain('running')

      const errored = await caseFor('mcp__specialists__specialist_status', {}, { isErrored: true, output: 'boom: unknown activation' })
      expect(errored).toContain('errored')
      expect(errored, 'an errored call shows its error text').toContain('boom: unknown activation')

      expect(await caseFor('mcp__specialists__specialist_status', {}, { isInterrupted: true })).toContain('interrupted')
      expect(await caseFor('Bash', {}), 'a non-Specialists tool passes through').toBe('engine tool row')
    })
  }
})
