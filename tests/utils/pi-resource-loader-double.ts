/**
 * Minimal stand-in for pi's `DefaultResourceLoader`, shared by every native-host
 * test double.
 *
 * The native host now hands `createAgentSession` a resource loader built from the
 * resolved specialist definition (SPECIALISTS-4), and refuses to dispatch when the
 * SDK cannot supply one — a runtime that silently fell back to `DefaultResourceLoader`
 * over the worktree cwd is exactly the bug being fixed. A double that omitted the
 * class would model a runtime where nothing is isolable, and every dispatch would be
 * refused; that refusal would be the guard working, not an artefact. So the double
 * models the real surface.
 *
 * `options` is the constructor argument as given, which is what the tests assert
 * against: `noSkills`, `additionalSkillPaths` and `noContextFiles` are the isolation
 * contract, not implementation detail.
 */
export class FakeResourceLoader {
  reloadCalls = 0;
  constructor(public readonly options: Record<string, unknown>) {}

  async reload(): Promise<void> {
    this.reloadCalls += 1;
  }

  getSkills(): { skills: Array<{ name: string; filePath: string; baseDir: string }>; diagnostics: never[] } {
    const paths = (this.options.additionalSkillPaths as string[] | undefined) ?? [];
    return {
      skills: paths.map((path) => ({
        name: skillNameFromPath(path),
        filePath: path,
        baseDir: path,
      })),
      diagnostics: [],
    };
  }
}

/** `~/.xtrm/skills/default/gitnexus` -> `gitnexus`; `.../research/SKILL.md` -> `research`. */
export function skillNameFromPath(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  const last = parts[parts.length - 1] ?? path;
  return last === 'SKILL.md' ? (parts[parts.length - 2] ?? last) : last;
}

/** Deterministic agent dir so doubles never touch the operator's real `~/.pi/agent`. */
export const FAKE_AGENT_DIR = '/tmp/specialists-test-agent-dir';
