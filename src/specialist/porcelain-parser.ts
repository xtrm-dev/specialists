export function parsePorcelainStatus(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 3)
    .map((line) => {
      const payload = line.slice(3);
      if (!payload) return '';
      const renamed = payload.includes(' -> ') ? payload.split(' -> ').at(-1) ?? '' : payload;
      return renamed.trim().replace(/^"|"$/g, '');
    })
    .filter((path) => path.length > 0);
}
