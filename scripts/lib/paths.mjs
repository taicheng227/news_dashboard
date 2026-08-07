import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const vaultRoot = path.resolve(process.env.AI_RADAR_VAULT || path.join(projectRoot, 'AI_Radar'));
export const websiteRoot = path.join(projectRoot, 'website');
export const statePath = path.join(vaultRoot, 'system', 'state.json');

export const vaultPath = (...parts) => path.join(vaultRoot, ...parts);
