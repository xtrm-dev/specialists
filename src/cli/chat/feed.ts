export type FeedRowKind = 'token' | 'tool' | 'event' | 'result' | 'meta';

export interface FeedRow {
  kind: FeedRowKind;
  text: string;
  ts: number;
}

export interface ComponentBase {
  render(width: number): string[];
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const RESET = '\x1b[0m';
const DEFAULT_LIMIT = 2000;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
  if (width <= 0) return [''];
  if (text === '') return [''];

  const hasAnsi = ANSI_PATTERN.test(text);
  ANSI_PATTERN.lastIndex = 0;
  const plain = stripAnsi(text);
  const prefix = text.match(/^(?:\x1b\[[0-9;]*m)+/)?.[0] ?? '';
  const lines: string[] = [];

  for (let index = 0; index < plain.length; index += width) {
    const chunk = plain.slice(index, index + width);
    lines.push(hasAnsi ? `${prefix}${chunk}${RESET}` : chunk);
  }

  return lines.length > 0 ? lines : [''];
}

export class ChatFeed implements ComponentBase {
  private readonly rows: FeedRow[] = [];
  private cachedWidth: number | null = null;
  private cachedLines: string[] = [];
  private cachedRowCount = 0;

  appendToken(text: string): void {
    this.appendRow('token', text);
  }

  appendToolStart(name: string, args: string): void {
    this.appendRow('tool', this.formatToolLine(name, args, 'start'));
  }

  appendToolEnd(name: string, result: string): void {
    this.appendRow('tool', this.formatToolLine(name, result, 'end'));
  }

  appendEvent(type: string, details: string): void {
    this.appendRow('event', `${type}: ${details}`);
  }

  appendResult(text: string): void {
    this.appendRow('result', text);
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    if (this.cachedWidth !== width) {
      this.cachedWidth = width;
      this.cachedLines = this.wrapRows(width);
      this.cachedRowCount = this.rows.length;
      return this.cachedLines;
    }

    if (this.cachedRowCount !== this.rows.length) {
      for (const row of this.rows.slice(this.cachedRowCount)) {
        this.cachedLines.push(...wrapTextWithAnsi(row.text, width));
      }
      this.cachedRowCount = this.rows.length;
    }

    return this.cachedLines;
  }

  private appendRow(kind: FeedRowKind, text: string): void {
    this.rows.push({ kind, text, ts: Date.now() });
    if (this.rows.length > DEFAULT_LIMIT) this.rows.splice(0, this.rows.length - DEFAULT_LIMIT);
    this.cachedRowCount = Math.min(this.cachedRowCount, this.rows.length);
  }

  private wrapRows(width: number): string[] {
    const lines: string[] = [];
    for (const row of this.rows) lines.push(...wrapTextWithAnsi(row.text, width));
    return lines;
  }

  private formatToolLine(name: string, details: string, phase: 'start' | 'end'): string {
    const status = phase === 'start' ? '▶' : '✓';
    const summary = this.summarizeDetails(details);
    return `${status} ${name}${summary ? ` ${summary}` : ''}`;
  }

  private summarizeDetails(details: string): string {
    const trimmed = details.trim();
    if (!trimmed) return '';
    const pathMatch = trimmed.match(/(?:['"`])?([^'"`\s]+\/(?:[^'"`\s]+))(?:['"`])?/);
    return pathMatch ? pathMatch[1] : trimmed;
  }
}
