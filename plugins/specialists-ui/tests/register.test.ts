import { describe, expect, test } from 'claude-code/testing'

import {
  FALLBACK_WAKE_TEXT,
  channelRow,
  errorTextOf,
  eventColor,
  isSpecialistsTool,
  MCP_SERVER,
  parseChannelFrame,
  specialistToolLabel,
} from '../hooks/register'

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
