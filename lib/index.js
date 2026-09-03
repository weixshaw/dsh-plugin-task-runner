// dsh-plugin-task-runner bootstrap.
//
// On host start, installs the bundled `presets/task-runner` agent preset into
// <dshHome>/.agent-presets/task-runner when that directory does not exist yet.
// It never overwrites an existing preset directory, so user edits survive
// plugin upgrades (delete the directory to reinstall the bundled version).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const name = 'dsh-plugin-task-runner';

/** The dsh home directory (defaults to ~/.dsh, honors DSH_HOME). */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** Where the bundled preset lives inside this package. */
export function presetSource() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'presets', 'task-runner');
}

/** Where the preset is installed for the roster to discover. */
export function presetDestination() {
  return join(dshHome(), '.agent-presets', 'task-runner');
}

export function apply(ctx) {
  const source = presetSource();
  const dest = presetDestination();

  if (!existsSync(source)) {
    ctx.logger.warn(`[task-runner] bundled preset not found at ${source}; skipping install`);
    return;
  }
  try {
    if (existsSync(dest)) {
      ctx.logger.info(`[task-runner] agent preset already installed at ${dest} (skipped; delete it to reinstall)`);
      return;
    }
    mkdirSync(dest, { recursive: true });
    cpSync(source, dest, { recursive: true });
    ctx.logger.info(`[task-runner] installed agent preset to ${dest}`);
  } catch (error) {
    ctx.logger.warn(`[task-runner] failed to install agent preset: ${error instanceof Error ? error.message : String(error)}`);
  }
}
