import { loadStatuses } from '../../specialist/status-load.js';
// TODO(u4fdd.6): @earendil-works/pi-tui dep is installed by u4fdd.6; if tsc fails locally before install, change to 'import type' with explicit todo.
import { truncateToWidth } from '@earendil-works/pi-tui';
import type { SupervisorStatus } from '../../specialist/supervisor.js';

const DEFAULT_POLL_INTERVAL_MS = 500;
const STATUS_ORDER: ReadonlyArray<SupervisorStatus['status']> = ['running', 'waiting', 'starting', 'done', 'error', 'cancelled'];

type ChatTui = { requestRender(): void };

interface ChatStatusOptions {
  pollIntervalMs?: number;
}

interface StatusSignature {
  status: SupervisorStatus['status'];
  totalTokens: number | null;
  model: string;
}

export class ChatStatus {
  private readonly pollIntervalMs: number;
  private currentStatus: SupervisorStatus | null = null;
  private lastSignature: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private targetJobId: string | null = null;

  constructor(private readonly tui: ChatTui, options: ChatStatusOptions = {}) {
    this.pollIntervalMs = Math.max(DEFAULT_POLL_INTERVAL_MS, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  start(): void {
    if (this.disposed || this.timer) return;
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.disposed = true;
  }

  setJobId(jobId: string): void {
    this.targetJobId = jobId;
    void this.poll();
  }

  render(width: number): string {
    if (!this.currentStatus) return truncateToWidth('', width);

    const jobId = this.currentStatus.id;
    const beadId = this.currentStatus.bead_id ?? '-';
    const state = this.currentStatus.status;
    const tokenUsage = this.currentStatus.metrics?.token_usage?.total_tokens;
    const model = formatModel(this.currentStatus);
    const specialist = this.currentStatus.specialist ?? 'job';

    const line = `${specialist}/${jobId}/${beadId} · ${state} · ${formatTokenCount(tokenUsage)} tok · ${model}`;
    return truncateToWidth(line, width);
  }

  async poll(): Promise<void> {
    if (this.disposed) return;

    const status = this.readCurrentStatus();
    const nextSignature = status ? signatureOf(status) : null;

    if (nextSignature === this.lastSignature) return;

    this.currentStatus = status;
    this.lastSignature = nextSignature;
    this.tui.requestRender();
  }

  private readCurrentStatus(): SupervisorStatus | null {
    try {
      const statuses = loadStatuses();
      if (this.targetJobId) {
        const target = statuses.find((status) => status.id === this.targetJobId);
        if (target) return target;
      }
      return selectCurrentStatus(statuses);
    } catch {
      return null;
    }
  }
}

function selectCurrentStatus(statuses: readonly SupervisorStatus[]): SupervisorStatus | null {
  if (statuses.length === 0) return null;

  for (const desiredState of STATUS_ORDER) {
    const match = statuses.find((status) => status.status === desiredState);
    if (match) return match;
  }

  return statuses[0] ?? null;
}

function signatureOf(status: SupervisorStatus): string {
  const signature: StatusSignature = {
    status: status.status,
    totalTokens: status.metrics?.token_usage?.total_tokens ?? null,
    model: formatModel(status),
  };

  return JSON.stringify(signature);
}

function formatTokenCount(totalTokens: number | undefined): string {
  if (totalTokens === undefined || !Number.isFinite(totalTokens)) return '--';
  if (totalTokens < 1000) return String(totalTokens);
  const value = totalTokens / 1000;
  return `${value.toFixed(1).replace(/\.0$/, '')}k`;
}

function formatModel(status: Pick<SupervisorStatus, 'backend' | 'model'>): string {
  if (status.model) {
    const parts = status.model.split('/');
    return parts[parts.length - 1] ?? status.model;
  }

  if (status.backend) return status.backend;
  return '-';
}

