import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot, vaultPath } from './lib/paths.mjs';
import { ensureStructure, recentSourceFiles, serializeFrontmatter } from './lib/vault.mjs';

const dateLabel = (date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' }).format(date);

export function buildSynthesisPrompt({ date, sourceFiles, stats, interestsPath }) {
  const relative = (file) => path.relative(projectRoot, file).replaceAll('\\', '/');
  return `Create today's personal AI Radar brief as Markdown.\n\nRead these inputs from the workspace:\n- Interests: ${relative(interestsPath)}\n- New source files:\n${sourceFiles.map((file) => `  - ${relative(file)}`).join('\n') || '  - none'}\n\nRules:\n- Return only the finished Markdown document, with no code fence or preamble.\n- Be aggressively selective and short. The reader wants permission to stop checking AI news.\n- Prioritize the interests file. Ignore hype, duplicates, memes, and weak claims.\n- Never present Reddit as authoritative. Separate consensus, confirmed experiences, contradictions, bugs, workarounds, caveats, and unresolved claims.\n- Prefer official information when it conflicts with community discussion.\n- Use evidence labels: Official, Community finding, Community benchmark, or Long-form analysis.\n- Include links to canonical source URLs where useful.\n- Include at most 5 developments total. If nothing matters, say so plainly.\n- End exactly with a section titled \"Nothing else requires your attention\" and the sentence \"You're caught up.\"\n\nStart with this exact frontmatter shape, using integer counts:\n---\ntype: ai-brief\ndate: ${date.toISOString().slice(0, 10)}\nrefreshed: ${date.toISOString()}\nimportant_count: <integer>\nworth_knowing_count: <integer>\nreddit_filtered_count: ${stats.redditFiltered || 0}\n---\n\nThen use this structure:\n# AI Brief — ${dateLabel(date)}\n\n<N> things worth knowing.\n${stats.redditFiltered || 0} Reddit posts ignored.\n\n## Important\n...\n\n## Worth knowing\n...\n\n## Community findings\n...\n\n## From YouTube\n...\n\n## Nothing else requires your attention\n\nYou're caught up.`;
}

function emptyBrief(date, stats) {
  return `${serializeFrontmatter({
    type: 'ai-brief', date: date.toISOString().slice(0, 10), refreshed: date.toISOString(),
    important_count: 0, worth_knowing_count: 0, reddit_filtered_count: stats.redditFiltered || 0,
  })}\n# AI Brief — ${dateLabel(date)}\n\n0 things worth knowing.\n${stats.redditFiltered || 0} Reddit posts ignored.\n\n## Important\n\nNo important developments were captured in this run.\n\n## Worth knowing\n\nNothing cleared your relevance threshold.\n\n## Community findings\n\nNo qualifying community discussion was captured.\n\n## From YouTube\n\nNo new selected transcripts.\n\n## Nothing else requires your attention\n\nYou're caught up.\n`;
}

export async function synthesizeBrief({ since = null, date = new Date(), stats = {}, dryRun = false } = {}) {
  await ensureStructure();
  const sourceFiles = await recentSourceFiles(since);
  const interestsPath = vaultPath('config', 'interests.md');
  const prompt = buildSynthesisPrompt({ date, sourceFiles, stats, interestsPath });
  if (dryRun) return { prompt, sourceFiles, briefPath: null };
  const briefPath = vaultPath('briefs', `${date.toISOString().slice(0, 10)}.md`);
  if (!sourceFiles.length) {
    await writeFile(briefPath, emptyBrief(date, stats), 'utf8');
    return { briefPath, sourceFiles, usedCodex: false };
  }
  const temporaryPath = `${briefPath}.tmp`;
  await mkdir(path.dirname(briefPath), { recursive: true });
  const codexArgs = [
    'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--color', 'never', '--cd', projectRoot, '--output-last-message', temporaryPath,
  ];
  let command = 'codex';
  let args = codexArgs;
  if (process.platform === 'win32') {
    const shim = path.join(process.env.APPDATA || '', 'npm', 'codex.ps1');
    if (!existsSync(shim)) throw new Error('Could not find the Codex PowerShell shim. Install the Codex CLI and sign in, then retry.');
    command = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', shim, ...codexArgs];
  }
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8', input: prompt, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    const message = result.error?.message || result.stderr?.trim().slice(-1200);
    const detail = message ? ` (${message})` : '';
    throw new Error(`Codex synthesis failed with exit code ${result.status ?? 'unknown'}${detail}.`);
  }
  const brief = (await readFile(temporaryPath, 'utf8')).trim().replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/, '');
  if (!brief.includes('# AI Brief') || !brief.includes("You're caught up.")) {
    await unlink(temporaryPath).catch(() => {});
    throw new Error('Codex returned a brief that did not match the required finite format.');
  }
  await writeFile(temporaryPath, `${brief}\n`, 'utf8');
  await rename(temporaryPath, briefPath);
  return { briefPath, sourceFiles, usedCodex: true };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const result = await synthesizeBrief({ dryRun });
  console.log(dryRun ? result.prompt : `Brief written to ${result.briefPath}`);
}
