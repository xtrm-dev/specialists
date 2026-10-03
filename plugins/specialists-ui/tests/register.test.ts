import { describe, expect, test } from 'claude-code/testing'

import {
  FALLBACK_WAKE_TEXT,
  channelRow,
  errorTextOf,
  eventColor,
  isSpecialistsTool,
  MCP_SERVER,
  parseChannelFrame,
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
    expect(errorTextOf(mcpText({ status: 'error', error: 'Unknown activation: act:x' }))).toBe('Unknown activation: act:x')
  })

  test('maps every Specialists tool to its native head under both name spellings', () => {
    const cases: [string, unknown, ToolCall][] = [
      ['specialist_dispatch', { specialist: 'executor', issue_ref: 'XTRM-4' }, { name: 'Dispatch', args: 'executor · XTRM-4' }],
      ['specialist_dispatch', { specialist: 'executor', bead_id: 'XTRM-5' }, { name: 'Dispatch', args: 'executor · XTRM-5' }],
      ['specialist_dispatch', { specialist: 'executor', contract: 'x' }, { name: 'Dispatch', args: 'executor · inline contract' }],
      ['specialist_status', {}, { name: 'Status' }],
      ['specialist_status', { activation_id: 'act:ac8e294a-3a0' }, { name: 'Status', args: 'ac8e294a' }],
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
    expect(toolResultLine('mcp__specialists__specialist_status', undefined)).toBeNull()
    expect(toolResultLine('Bash', mcpText({ status: 'ok' }))).toBeNull()
  })

  for (const surface of SURFACES) {
    test(`channel wake draws a teammate line and passes ctrl+o through (${surface})`, async ($, on) => {
      on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Box', props: {}, children: ['engine user row'] }) as never)

      const drawn = textOf(
        await (
          await $.ui.mount({
            plugin: 'specialists-ui',
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
      expect(wake).toContain('use specialist_status for full result')

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
      expect(dispatched, 'a native result line').toContain('⎿  ac8e294a · XTRM-4 · starting')
      expect(await caseFor('mcp__plugin_specialists_specialists__specialist_reply', { message_id: 'msg-1' })).toContain('Reply(msg-1)')
      expect(await caseFor('mcp__specialists__substrate_journal', {})).toContain('● Journal')

      const running = await caseFor('mcp__specialists__specialist_status', {}, { isRunning: true })
      expect(running).toContain('Status')
      expect(running, 'a running call stays visible').toContain('Running…')

      const errored = await caseFor('mcp__specialists__specialist_status', {}, { isErrored: true, output: 'boom: unknown activation' })
      expect(errored, 'an errored call shows its error text').toContain('⎿  boom: unknown activation')

      const refused = await caseFor(
        'mcp__specialists__specialist_stop_activation',
        { activation_id: 'act:d65bbed4-fb7' },
        { output: mcpText({ status: 'error', error: 'Unknown activation: act:d65bbed4-fb7' }) },
      )
      expect(refused, 'an error payload shows as an error').toContain('⎿  Unknown activation: act:d65bbed4-fb7')

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
