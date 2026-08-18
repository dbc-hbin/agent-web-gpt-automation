import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'awgpt-package-e2e-'));
try {
const packed = execFileSync('npm', ['pack', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const pack = JSON.parse(packed.slice(packed.indexOf('[')))[0];
const tar = execFileSync('tar', ['-tf', join(temp, pack.filename)], { encoding: 'utf8' });
const prefix = join(temp, 'prefix');
execFileSync('npm', ['install', '--prefix', prefix, '--ignore-scripts', join(temp, pack.filename)], { cwd: root, stdio: 'pipe' });
const cli = join(prefix, 'node_modules', 'awgpt', 'dist', 'index.js');
const help = execFileSync(process.execPath, [cli, 'install', '--help'], { encoding: 'utf8' });
if (!help.includes('--source') || !help.includes('--agent-home')) throw new Error('packaged help missing lifecycle options');
const manifest = JSON.parse(readFileSync(join(prefix, 'node_modules', 'awgpt', 'install-manifest.json'), 'utf8'));
const skills = manifest.include.filter(x => x.startsWith('skills/')).map(x => x.split('/')[1]);
if (skills.length !== 6 || new Set(skills).size !== 6) throw new Error(`expected six skills, got ${skills.join(',')}`);
for (const skill of skills) {
  for (const file of [`package/skills/${skill}/SKILL.md`, ...(existsSync(join(root, `skills/${skill}/agents/openai.yaml`)) ? [`package/skills/${skill}/agents/openai.yaml`] : [])]) {
    if (!tar.split('\n').includes(file)) throw new Error(`tar missing ${file}`);
  }
}
const home = join(temp, 'home');
const install = JSON.parse(execFileSync(process.execPath, [cli, 'install', '--agent-home', home], { cwd: temp, encoding: 'utf8' }));
if (!install.ok || install.count < 6) throw new Error('packaged install failed');
const receipt = JSON.parse(readFileSync(install.receipt, 'utf8'));
const installedRoot = join(prefix, 'node_modules', 'awgpt');
if (realpathSync(receipt.source_root) !== realpathSync(installedRoot)) throw new Error(`wrong source_root ${receipt.source_root}`);
const rollback = JSON.parse(execFileSync(process.execPath, [cli, 'rollback', '--agent-home', home], { cwd: temp, encoding: 'utf8' }));
if (!rollback.ok) throw new Error('packaged rollback failed');
console.log('package e2e ok');
} finally { rmSync(temp, { recursive: true, force: true }); }
