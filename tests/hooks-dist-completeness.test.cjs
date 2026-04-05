/**
 * Hooks dist completeness test
 *
 * Ensures every hook registered by install.js in settings.json is included
 * in build-hooks.js HOOKS_TO_COPY, so it actually gets built into hooks/dist/
 * and deployed. Catches the class of bug where install.js registers hooks
 * pointing to files that were never packaged, causing persistent "hook error"
 * on every tool call at runtime.
 *
 * See #1711, #1656, #1657.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INSTALL_JS = path.join(ROOT, 'bin', 'install.js');
const BUILD_HOOKS_JS = path.join(ROOT, 'scripts', 'build-hooks.js');
const HOOKS_DIR = path.join(ROOT, 'hooks');

/**
 * Extract hook filenames from settings.json registration blocks in install.js.
 * Matches the command strings that get pushed into settings.hooks — these are
 * the hooks that will actually execute at runtime.
 *
 * Patterns matched:
 *   command: 'node "..." + '/hooks/gsd-check-update.js"'
 *   command: 'bash ' + targetDir + '/hooks/gsd-validate-commit.sh'
 *   command: buildHookCommand(targetDir, 'gsd-statusline.js')
 */
function extractRegisteredHooks() {
  const src = fs.readFileSync(INSTALL_JS, 'utf8');
  const hooks = new Set();

  // Match buildHookCommand calls: buildHookCommand(configDir, 'gsd-foo.js')
  const buildHookRe = /buildHookCommand\([^,]+,\s*'(gsd-[\w-]+\.(?:js|sh))'\)/g;
  let m;
  while ((m = buildHookRe.exec(src)) !== null) {
    hooks.add(m[1]);
  }

  // Match command strings with hook paths in settings push blocks:
  //   'bash ' + targetDir.replace(...) + '/hooks/gsd-validate-commit.sh'
  //   'node ' + dirName + '/hooks/gsd-check-update.js'
  const cmdRe = /(?:bash |node ).*?\/hooks\/(gsd-[\w-]+\.(?:js|sh))/g;
  while ((m = cmdRe.exec(src)) !== null) {
    // Skip lines that are in comments or orphaned/cleanup arrays
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index));
    if (line.includes('//') && line.indexOf('//') < line.indexOf(m[1])) continue;
    if (line.includes('orphan') || line.includes('Removed in')) continue;
    hooks.add(m[1]);
  }

  return hooks;
}

/**
 * Extract HOOKS_TO_COPY array entries from build-hooks.js.
 */
function extractHooksToCopy() {
  const src = fs.readFileSync(BUILD_HOOKS_JS, 'utf8');
  const hooks = new Set();
  const re = /['"]gsd-[\w-]+\.(?:js|sh)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    hooks.add(m[0].replace(/['"]/g, ''));
  }
  return hooks;
}

describe('hooks dist completeness (#1711)', () => {
  const registered = extractRegisteredHooks();
  const hooksToCopy = extractHooksToCopy();

  test('install.js registers at least one hook', () => {
    assert.ok(registered.size > 0, 'should find hook registrations in install.js');
  });

  test('build-hooks.js HOOKS_TO_COPY is not empty', () => {
    assert.ok(hooksToCopy.size > 0, 'should find entries in HOOKS_TO_COPY');
  });

  test('every registered hook has a source file in hooks/', () => {
    const missing = [];
    for (const hook of registered) {
      if (!fs.existsSync(path.join(HOOKS_DIR, hook))) {
        missing.push(hook);
      }
    }
    assert.deepStrictEqual(missing, [],
      `install.js registers hooks with no source file in hooks/: ${missing.join(', ')}`);
  });

  test('every registered hook is in HOOKS_TO_COPY so it gets built into dist', () => {
    const missing = [];
    for (const hook of registered) {
      if (!hooksToCopy.has(hook)) {
        missing.push(hook);
      }
    }
    assert.deepStrictEqual(missing, [],
      `install.js registers hooks missing from build-hooks.js HOOKS_TO_COPY: ${missing.join(', ')}. ` +
      `These will not be packaged into hooks/dist/ and will cause "hook error" at runtime.`);
  });
});
