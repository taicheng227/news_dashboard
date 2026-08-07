import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ensureStructure } from './lib/vault.mjs';
import { projectRoot, statePath, vaultPath } from './lib/paths.mjs';

await ensureStructure();
const templates = [
  ['templates/AI_Radar/config/interests.md', vaultPath('config', 'interests.md')],
  ['templates/AI_Radar/config/sources.md', vaultPath('config', 'sources.md')],
  ['templates/AI_Radar/system/state.json', statePath],
];
for (const [source, destination] of templates) {
  try {
    await access(destination);
  } catch {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(projectRoot, source), destination);
  }
}
console.log('AI Radar vault and website directories are ready.');
