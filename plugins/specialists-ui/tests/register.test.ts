import { describe, expect, test, mock } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import {
  BRIEF_ROW_LINES,
  FALLBACK_WAKE_TEXT,
  ackClassFor,
  channelWakeOf,
  channelRow,
  errorTextOf,
  eventColor,
  isSpecialistsTool,
  MCP_SERVER,
  parseChannelFrame,
  recordWakeAck,
  specialistToolCall,
  toolResultLine,
  type ToolCall,
} from '../hooks/register'

/** An MCP tool result as the ToolUse row's `output` carries it: text blocks of JSON. */
const mcpText = (value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

function textOf(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (!tree || typeof tree !== 'object') return ''
  const props = Reflect.get(tree, 'props') as Record<string, unknown> | undefined
  const lead = typeof props?.label === 'string' ? props.label : ''
  return lead + textOf(Reflect.get(tree, 'children'))
}

const SURFACES = ['terminal', 'desktop'] as const

const CHANNEL_TEXT =
  'Specialist explorer on XTRM-464: completed (act:f6ab7b21-4a3). Call specialist_result for the full result.'

/** The same frame with the brief the server writes under the identity line. */
const BRIEF_TEXT = `${CHANNEL_TEXT}\n42s • 3 turns · purpose: map the wake path\n> Found two paths.`

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
      detail: [],
      hint: 'use specialist_result for full result',
    })
    expect(channelRow(BRIEF_TEXT)?.detail).toEqual(['42s • 3 turns · purpose: map the wake path', '> Found two paths.'])
    expect(channelRow('Specialist explorer: needs_reply (act:f6ab7b21-4a3). x')?.hint).toContain('specialist_reply')
    const long = [CHANNEL_TEXT, ...Array.from({ length: 8 }, (_, i) => `> line ${i}`)].join('\n')
    expect(channelRow(long)?.detail).toHaveLength(BRIEF_ROW_LINES + 1)
    expect(channelRow(long)?.detail.at(-1)).toBe('… +3 lines · ctrl+o expands')
    expect(channelRow('Specialist explorer: failed (act:f6ab7b21-4a3). x')?.marker).toBe('✕')
    expect(channelRow('Specialist explorer: escalation (act:f6ab7b21-4a3). x')?.marker).toBe('!')
    expect(channelRow('Specialist explorer: needs_reply (act:f6ab7b21-4a3). x')?.marker).toBe('!')
    expect(channelRow('not a frame')).toBeNull()
    expect(errorTextOf('the refusal')).toBe('the refusal')
    expect(errorTextOf({ error: 'unknown activation' })).toBe('unknown activation')
    expect(errorTextOf(mcpText({ status: 'error', error: 'Unknown activation: act:x' }))).toBe('Unknown activation: act:x')
  })

  test('maps every Specialists tool to its native head under both name spellings', () => {
    const cases: [string, unknown, ToolCall][] = [
      ['specialist_dispatch', { specialist: 'executor', issue_ref: 'XTRM-4' }, { name: 'Dispatch', args: 'executor · XTRM-4' }],
      ['specialist_dispatch', { specialist: 'executor', bead_id: 'XTRM-5' }, { name: 'Dispatch', args: 'executor · XTRM-5' }],
      ['specialist_dispatch', { specialist: 'executor', contract: 'x' }, { name: 'Dispatch', args: 'executor · inline contract' }],
      ['specialist_status', {}, { name: 'Status' }],
      ['specialist_status', { activation_id: 'act:ac8e294a-3a0' }, { name: 'Status', args: 'ac8e294a' }],
      ['specialist_result', { activation_id: 'act:ac8e294a-3a0' }, { name: 'Result', args: 'ac8e294a' }],
      ['specialist_list', {}, { name: 'List specialists' }],
      ['specialist_reply', { message_id: 'msg-1' }, { name: 'Reply', args: 'msg-1' }],
      ['specialist_steer', { activation_id: 'act:ac8e294a-3a0' }, { name: 'Steer', args: 'ac8e294a' }],
      ['specialist_resume', { activation_id: 'act:ac8e294a-3a0' }, { name: 'Resume', args: 'ac8e294a' }],
      ['specialist_stop_activation', { activation_id: 'act:ac8e294a-3a0' }, { name: 'Stop', args: 'ac8e294a' }],
      ['specialist_retry', { activation_id: 'act:ac8e294a-3a0' }, { name: 'Retry', args: 'ac8e294a' }],
      ['substrate_issue', { op: 'get', issue_id: 'XTRM-4' }, { name: 'Issue', args: 'get · XTRM-4' }],
      ['substrate_journal', { op: 'append', issue_id: 'XTRM-4' }, { name: 'Journal', args: 'append · XTRM-4' }],
      ['substrate_provenance', { op: 'find_by_pr', pr: '426' }, { name: 'Provenance', args: 'find_by_pr · 426' }],
    ]
    for (const [bare, input, head] of cases) {
      expect(specialistToolCall(`mcp__specialists__${bare}`, input), bare).toEqual(head)
      expect(specialistToolCall(`mcp__plugin_specialists_specialists__${bare}`, input), bare).toEqual(head)
    }
    expect(isSpecialistsTool('mcp__specialists__specialist_status')).toBe(true)
    expect(isSpecialistsTool('mcp__plugin_specialists_specialists__specialist_status')).toBe(true)
    expect(isSpecialistsTool('Bash')).toBe(false)
    expect(specialistToolCall('mcp__specialists__unknown_tool', {})).toBeNull()
    expect(specialistToolCall('Bash', {})).toBeNull()
  })

  test('reads one result line from each JSON result', () => {
    const dispatch = 'mcp__plugin_specialists_specialists__specialist_dispatch'
    expect(
      toolResultLine(dispatch, mcpText({ status: 'dispatched', activation_id: 'act:ac8e294a-3a0', created_issue_ref: 'SPECIALISTS-4243', state: 'starting' })),
    ).toEqual({ text: 'ac8e294a · SPECIALISTS-4243 · starting', isError: false })
    expect(
      toolResultLine('mcp__specialists__specialist_status', mcpText({ activations: [{ state: 'running' }, { state: 'settled' }], pending_asks: [{}] })),
    ).toEqual({ text: '2 activations, 1 running, 1 waiting on you', isError: false })
    expect(toolResultLine('mcp__specialists__specialist_status', mcpText({ activations: [] }))).toEqual({ text: '0 activations', isError: false })
    expect(toolResultLine('mcp__specialists__specialist_list', mcpText({ specialists: [{}, {}, {}] }))).toEqual({ text: '3 specialists', isError: false })
    expect(toolResultLine('mcp__specialists__specialist_stop_activation', mcpText({ status: 'stopped' }))).toEqual({ text: 'stopped', isError: false })
    expect(toolResultLine('mcp__specialists__specialist_stop_activation', mcpText({ status: 'error', error: 'Unknown activation: act:x' }))).toEqual({
      text: 'Unknown activation: act:x',
      isError: true,
    })
    expect(
      toolResultLine('mcp__specialists__specialist_result', mcpText({ status: 'done', output: 'a\nb\nc', source: 'memory' })),
    ).toEqual({ text: 'done · 3 lines', isError: false })
    expect(
      toolResultLine('mcp__specialists__specialist_result', mcpText({ status: 'error', error: 'Unknown activation: x' })),
    ).toEqual({ text: 'Unknown activation: x', isError: true })
    expect(toolResultLine('mcp__specialists__specialist_status', undefined)).toBeNull()
    expect(toolResultLine('Bash', mcpText({ status: 'ok' }))).toBeNull()
  })

  for (const surface of SURFACES) {
    test(`channel wake draws a teammate line and passes ctrl+o through (${surface})`, async ($, on) => {
      on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Box', props: {}, children: ['engine user row'] }) as never)

      const tree = await (
        await $.ui.mount({
          plugin: 'specialists-ui',
          surface,
          component: 'UserMessage',
          props: { text: CHANNEL_TEXT, origin: { kind: 'channel', server: MCP_SERVER }, isExpanded: false },
        })
      ).drawn()
      expect(Reflect.get(tree as object, 'props'), 'a blank line above, like native rows').toMatchObject({ marginTop: 1 })
      const drawn = textOf(tree)
      expect(drawn).toContain('●')
      expect(drawn).toContain('@explorer:f6ab7b21')
      expect(drawn).toContain('completed')
      expect(drawn).toContain('XTRM-464')
      expect(drawn).toContain('use specialist_result for full result')

      const brief = textOf(
        await (
          await $.ui.mount({
            plugin: 'specialists-ui',
            surface,
            component: 'UserMessage',
            props: { text: BRIEF_TEXT, origin: { kind: 'channel', server: MCP_SERVER }, isExpanded: false },
          })
        ).drawn(),
      )
      expect(brief).toContain('42s • 3 turns · purpose: map the wake path')
      expect(brief).toContain('Found two paths.')
      expect(brief).not.toContain('> Found')

      const expanded = await (
        await $.ui.mount({
          plugin: 'specialists-ui',
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
          plugin: 'specialists-ui',
          surface,
          component: 'UserMessage',
          props: { text: CHANNEL_TEXT, origin: { kind: 'channel', server: 'slack' }, isExpanded: false },
        })
      ).drawn()
      expect(textOf(other)).toBe('engine user row')

      const composer = await (
        await $.ui.mount({
          plugin: 'specialists-ui',
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
            plugin: 'specialists-ui',
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
      expect(wake).toContain('use specialist_result for full result')

      const other = textOf(
        await (
          await $.ui.mount({
            plugin: 'specialists-ui',
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
          plugin: 'specialists-ui',
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
          plugin: 'specialists-ui',
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
              plugin: 'specialists-ui',
              surface,
              component: 'ToolUse',
              props: { tool_use_id: 't', tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...state },
            })
          ).drawn(),
        )

      const dispatched = await caseFor(
        'mcp__specialists__specialist_dispatch',
        { specialist: 'executor', issue_ref: 'XTRM-4' },
        { output: mcpText({ activation_id: 'act:ac8e294a-3a0', bead_id: 'XTRM-4', state: 'starting' }) },
      )
      expect(dispatched, 'a native head').toContain('● Dispatch(executor · XTRM-4)')
      expect(dispatched, 'a native result line').toContain('  ac8e294a · XTRM-4 · starting')
      expect(await caseFor('mcp__plugin_specialists_specialists__specialist_reply', { message_id: 'msg-1' })).toContain('Reply(msg-1)')
      expect(await caseFor('mcp__specialists__substrate_journal', {})).toContain('● Journal')

      const running = await caseFor('mcp__specialists__specialist_status', {}, { isRunning: true })
      expect(running).toContain('Status')
      expect(running, 'a running call stays visible').toContain('Running…')

      const errored = await caseFor('mcp__specialists__specialist_status', {}, { isErrored: true, output: 'boom: unknown activation' })
      expect(errored, 'an errored call shows its error text').toContain('  boom: unknown activation')

      const refused = await caseFor(
        'mcp__specialists__specialist_stop_activation',
        { activation_id: 'act:d65bbed4-fb7' },
        { output: mcpText({ status: 'error', error: 'Unknown activation: act:d65bbed4-fb7' }) },
      )
      expect(refused, 'an error payload shows as an error').toContain('  Unknown activation: act:d65bbed4-fb7')

      expect(await caseFor('mcp__specialists__specialist_status', {}, { isInterrupted: true })).toContain('Interrupted')
      expect(await caseFor('Bash', {}), 'a non-Specialists tool passes through').toBe('engine tool row')
    })

    test(`a standalone Specialists result row is folded into the call row (${surface})`, async ($, on) => {
      on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Box', props: {}, children: ['engine result'] }) as never)
      const resultFor = async (tool: string) =>
        textOf(
          await (
            await $.ui.mount({
              plugin: 'specialists-ui',
              surface,
              component: 'ToolResult',
              props: { tool_use_id: 't', tool, output: mcpText({ status: 'stopped' }), isErrored: false },
            })
          ).drawn(),
        )
      expect(await resultFor('mcp__specialists__specialist_stop_activation')).toBe('')
      expect(await resultFor('Bash')).toBe('engine result')
    })
  }
})

describe('wake dedupe markers', () => {
  /** A captured engine: env.get returns HOME, fs.write records the path written. */
  const capture = (home?: string) => {
    const writes: string[] = []
    const engine = {
      env: { get: async (name: string) => (name === 'HOME' ? home : undefined) },
      fs: { write: async (path: string) => { writes.push(path) } },
    } as unknown as EngineInterface
    return { writes, engine }
  }

  test('channelWakeOf reads the wrapped channel prompt prompt.submit receives', () => {
    // The real queued text (sp-probe, 2026-10-03): the whole <channel> element, not the bare frame.
    const wrapped =
      '<channel source="plugin:specialists:specialists" activation_id="act:a5be0de5-9e0" specialist="explorer" event="completed" read_with="specialist_status">\n' +
      'Specialist explorer: completed (act:a5be0de5-9e0). Call specialist_status for the authoritative result.\n' +
      '</channel>'
    expect(channelWakeOf(wrapped)).toEqual({ activationId: 'act:a5be0de5-9e0', event: 'completed' })
    expect(channelWakeOf('<channel source="x">\nSpecialist explorer: needs_reply (act:ab12cd34-567). x\n</channel>')).toEqual({
      activationId: 'act:ab12cd34-567',
      event: 'needs_reply',
    })
    expect(channelWakeOf(CHANNEL_TEXT)).toEqual({ activationId: 'act:f6ab7b21-4a3', event: 'completed' })
    expect(channelWakeOf('hello')).toBeNull()
  })

  test('recordWakeAck writes <HOME>/.xtrm/wake-acks/<id>.<class> for every event class', async () => {
    const { writes, engine } = capture('/home/tester')
    expect(await recordWakeAck(engine, 'act:f6ab7b21-4a3', 'completed')).toBe(true)
    expect(await recordWakeAck(engine, 'act:f6ab7b21-4a3', 'failed')).toBe(true)
    expect(await recordWakeAck(engine, 'act:f6ab7b21-4a3', 'escalation')).toBe(true)
    expect(await recordWakeAck(engine, 'act:f6ab7b21-4a3', 'needs_reply')).toBe(true)
    expect(writes).toEqual([
      '/home/tester/.xtrm/wake-acks/act:f6ab7b21-4a3.settled',
      '/home/tester/.xtrm/wake-acks/act:f6ab7b21-4a3.settled',
      '/home/tester/.xtrm/wake-acks/act:f6ab7b21-4a3.needs_reply',
      '/home/tester/.xtrm/wake-acks/act:f6ab7b21-4a3.needs_reply',
    ])
  })

  test('event classes map to their marker class', () => {
    expect(ackClassFor('completed')).toBe('settled')
    expect(ackClassFor('failed')).toBe('settled')
    expect(ackClassFor('escalation')).toBe('needs_reply')
    expect(ackClassFor('needs_reply')).toBe('needs_reply')
  })

  test('recordWakeAck writes nothing when HOME is unreadable', async () => {
    const { writes, engine } = capture(undefined)
    expect(await recordWakeAck(engine, 'act:x', 'completed')).toBe(false)
    expect(writes).toEqual([])
  })

  test('a specialists channel prompt passes through unchanged', async ($, on) => {
    mock.env(on, { HOME: '/tmp/xtrm-wake-ack-ui-dispatch' })
    on('prompt.submit', async ($, e) => ({ text: e.text })) // the engine answer beneath the plugin

    const text = 'Specialist explorer: completed (act:disp-eeee). Call specialist_result for the full result.'
    const result = await $.prompt.submit({ text, wait: false, origin: { kind: 'channel', server: MCP_SERVER } } as never)

    expect((result as { text?: string }).text).toBe(text)
  })

  test('a non-specialists or composer prompt passes through with the hook untouched', async ($, on) => {
    mock.env(on, { HOME: '/tmp/xtrm-wake-ack-ui-dispatch' })
    on('prompt.submit', async ($, e) => ({ text: e.text }))

    const text = 'Specialist explorer: completed (act:other-ffff). Call specialist_result for the full result.'
    const viaSlack = await $.prompt.submit({ text, wait: false, origin: { kind: 'channel', server: 'slack' } } as never)
    const viaComposer = await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } } as never)

    expect((viaSlack as { text?: string }).text).toBe(text)
    expect((viaComposer as { text?: string }).text).toBe('hello')
  })
})
