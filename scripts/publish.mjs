import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from './lib/paths.mjs';

const publishRoot = path.resolve(process.env.AI_RADAR_PUBLISH_DIR || projectRoot);

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: publishRoot, encoding: 'utf8' });
  if (!allowFailure && result.status !== 0) throw new Error((result.stderr || result.stdout || 'Git command failed').trim());
  return result;
}

export async function publishSite() {
  if (publishRoot !== projectRoot) {
    const allowlist = [
      ['website/index.html', 'website/index.html'],
      ['website/styles.css', 'website/styles.css'],
      ['package.json', 'package.json'],
      ['railway.json', 'railway.json'],
      ['scripts/serve.mjs', 'scripts/serve.mjs'],
      ['scripts/lib/paths.mjs', 'scripts/lib/paths.mjs'],
    ];
    for (const [source, destination] of allowlist) {
      const target = path.join(publishRoot, destination);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(projectRoot, source), target);
    }
  }
  if (git(['rev-parse', '--is-inside-work-tree'], { allowFailure: true }).status !== 0) {
    throw new Error('Publishing needs a Git repository. Run git init, add a GitHub remote, and retry.');
  }
  const trackedVault = git(['ls-files', 'AI_Radar'], { allowFailure: true }).stdout.trim();
  if (trackedVault) throw new Error('Privacy guard: AI_Radar contains tracked files. Remove them from Git before publishing.');
  git(['add', '--', 'website', 'package.json', 'railway.json', 'scripts/serve.mjs', 'scripts/lib/paths.mjs']);
  const stagedVault = git(['diff', '--cached', '--name-only', '--', 'AI_Radar'], { allowFailure: true }).stdout.trim();
  if (stagedVault) throw new Error('Privacy guard: a vault file is staged; publish aborted.');
  const changed = git(['diff', '--cached', '--quiet'], { allowFailure: true }).status !== 0;
  if (!changed) return { published: false, reason: 'no changes' };
  const date = new Date().toISOString().slice(0, 10);
  git(['commit', '-m', `Update AI Radar for ${date}`]);
  git(['push']);
  return { published: true };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await publishSite();
  console.log(result.published ? 'Dashboard pushed; Railway can deploy it.' : 'Nothing new to publish.');
}
