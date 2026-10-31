/**
 * Minimal LCS line diff used only for contribution previews (TRD §6.1
 * /api/contributions/preview). Not a full unified-diff engine; deterministic
 * and dependency-free.
 */
// TRD §6.1 (contributions/preview)

export function diffLines(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  // LCS dynamic programming table (fine for bounded README-scale files).
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) dp.push(new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < m) {
    lines.push(`- ${a[i]}`);
    i++;
  }
  while (j < n) {
    lines.push(`+ ${b[j]}`);
    j++;
  }
  return lines.join('\n');
}
