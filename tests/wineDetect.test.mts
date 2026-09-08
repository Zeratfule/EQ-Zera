// Wine detection (src/shared/wineDetect.ts) — JOS-31.
//
// THE ASYMMETRY IS THE WHOLE SUITE. A false negative costs one Wine user an automatic fallback
// they can still reach by hand (two switches, an env var, a support reply). A false positive costs
// EVERY Windows user their hardware acceleration and their see-through overlays, for a problem
// they do not have. So the negative cases here are adversarial and the positive cases are plain —
// and the last test asks the REAL machine this suite is running on, which is a Windows box, and
// requires the answer 'no' with the actual filesystem underneath.
//
// What this suite CANNOT do is prove the positive against a real prefix: nothing here has run
// under Wine, and the claim that a stock prefix carries `wineboot.exe` in system32 rests on Wine's
// documented layout. The fixtures below describe that layout; the reporter verifies it.
//
// Pure module, injected probe, no Electron and no filesystem except in the last test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import {
  NO_GRAPHICS_ENVIRONMENT,
  WINE_CHROMIUM_FLAGS,
  WINE_ENV_VARS,
  WINE_GRAPHICS_AUTO,
  WINE_SYSTEM_BINARIES,
  chromiumFlagsFor,
  detectWine,
  graphicsEnvironmentOf,
  systemDirectory,
  type WineProbe
} from '../src/shared/wineDetect'

/** A machine with nothing Wine about it: the default probe every test starts from. */
function windows(over: Partial<WineProbe> = {}): WineProbe {
  return {
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    fileExists: () => false,
    ...over
  }
}

/** A probe whose filesystem holds exactly the given absolute paths. */
function withFiles(paths: string[], over: Partial<WineProbe> = {}): WineProbe {
  const set = new Set(paths.map((p) => p.toLowerCase()))
  return windows({ fileExists: (p) => set.has(p.toLowerCase()), ...over })
}

test('an ordinary Windows machine is NOT Wine — and stays that way under provocation', () => {
  assert.deepEqual(detectWine(windows()), { wine: false, signals: [] })

  // The environment a Windows user can genuinely arrive with. Every one of these has been a
  // tempting "Unix-looking, so probably Wine" signal at some point, and every one of them is
  // reachable on a real Windows box: git-bash and MSYS export HOME/SHELL, an X server or WSLg
  // exports DISPLAY, and USER/LANG come along with any POSIX-ish shell. NONE of them may count.
  const posixish = windows({
    env: {
      SystemRoot: 'C:\\Windows',
      HOME: '/c/Users/jmoye',
      SHELL: '/usr/bin/bash',
      USER: 'jmoye',
      DISPLAY: ':0',
      LANG: 'en_US.UTF-8',
      XDG_RUNTIME_DIR: '/run/user/1000',
      TERM: 'xterm-256color',
      MSYSTEM: 'MINGW64'
    }
  })
  assert.deepEqual(detectWine(posixish), { wine: false, signals: [] })

  // Windows' own system32 contents, including the near-misses. `winevt` is a real Windows
  // directory whose name starts with "wine" — the reason the signal is a list of exact filenames
  // and never a `wine*` pattern.
  const realSystem32 = withFiles([
    'C:\\Windows\\system32\\winevt',
    'C:\\Windows\\system32\\winver.exe',
    'C:\\Windows\\system32\\winhlp32.exe',
    'C:\\Windows\\system32\\wininit.exe',
    'C:\\Windows\\system32\\winlogon.exe',
    'C:\\Windows\\system32\\ntdll.dll'
  ])
  assert.deepEqual(detectWine(realSystem32), { wine: false, signals: [] })

  // A variable that exists but is EMPTY is not a variable that is set — the `envDisablesGpu`
  // rule, applied here: an exporter that cleared it was declining, not asking.
  for (const raw of ['', '   ']) {
    assert.equal(detectWine(windows({ env: { WINEHOMEDIR: raw } })).wine, false, JSON.stringify(raw))
  }
})

test('the LAUNCHER-set Wine variables do not count, and that is the false-positive guard', () => {
  // These are the ones everybody reaches for, and every one of them is set by the user or the
  // launcher rather than by Wine: Lutris/Bottles/Heroic set some, Proton actively DELETES
  // WINEARCH, a bare `wine app.exe` sets none — and, the disqualifying half, a developer who
  // cross-builds for Wine can have them exported in a shell profile ON REAL WINDOWS. Detection
  // rests on what Wine's ntdll injects itself, so none of these may fire on their own.
  const launcherSet = {
    WINEPREFIX: '/home/u/.wine',
    WINEDEBUG: '-all',
    WINEARCH: 'win64',
    WINEDLLOVERRIDES: 'libglesv2.dll=d',
    WINESERVER: '/usr/bin/wineserver',
    WINEDLLPATH: '/usr/lib/wine',
    WINEFSYNC: '1',
    WINEESYNC: '1',
    // Impossible rather than merely unreliable: __wine_main() unsetenv()s this one before the
    // Win32 environment is built, so it can never reach process.env in the first place.
    WINELOADERNOEXEC: '1',
    // Proton's marker. Real, but Steam-specific — it says nothing about a Lutris or bare-wine run,
    // and the injected variables cover Proton anyway.
    STEAM_COMPAT_DATA_PATH: '/steam/compatdata/12345'
  }
  assert.deepEqual(detectWine(windows({ env: { SystemRoot: 'C:\\Windows', ...launcherSet } })), {
    wine: false,
    signals: []
  })
  for (const name of Object.keys(launcherSet)) {
    assert.ok(!WINE_ENV_VARS.includes(name), `${name} must not be a signal`)
  }
})

test('a Wine prefix is detected by its own tools in system32 — any ONE of them is enough', () => {
  for (const name of WINE_SYSTEM_BINARIES) {
    const probe = withFiles([`C:\\Windows\\system32\\${name}`])
    assert.deepEqual(
      detectWine(probe),
      { wine: true, signals: [`file:${name}`] },
      `${name} alone must be enough — a stripped prefix is still a prefix`
    )
  }
})

test('…and by the WINE environment namespace, which no Windows program sets or reads', () => {
  for (const name of WINE_ENV_VARS) {
    const probe = windows({ env: { SystemRoot: 'C:\\Windows', [name]: '/home/u/.wine' } })
    assert.deepEqual(detectWine(probe), { wine: true, signals: [`env:${name}`] }, name)
  }
})

test('every signal that fired is reported, so a wrong answer is arguable rather than a mood', () => {
  // What a real prefix looks like: Wine's tools in system32 AND the variables its ntdll appends.
  const probe = withFiles(
    ['C:\\Windows\\system32\\wineboot.exe', 'C:\\Windows\\system32\\winecfg.exe'],
    {
      env: {
        SystemRoot: 'C:\\windows',
        WINEHOMEDIR: '\\??\\unix\\home\\u',
        WINEUSERNAME: 'u',
        WINEPREFIX: '/home/u/.wine'
      }
    }
  )
  const { wine, signals } = detectWine(probe)
  assert.equal(wine, true)
  // Files first, then env, each in the module's declared order — a stable string a support reply
  // can compare across two users. The launcher-set WINEPREFIX is present on this machine and is
  // still not listed: only what the module actually consulted is reported.
  assert.deepEqual(signals, [
    'file:wineboot.exe',
    'file:winecfg.exe',
    'env:WINEHOMEDIR',
    'env:WINEUSERNAME'
  ])
})

test('a NATIVE build is never Wine, however Wine-shaped the machine around it looks', () => {
  // Wine hosts a WINDOWS build; a Linux or macOS build of this app is not an emulated Windows
  // process and must never take a compatibility path meant for one. The gate is absolute, which
  // is why it is asserted against a probe where every other signal fires.
  const loaded = withFiles(WINE_SYSTEM_BINARIES.map((n) => `C:\\Windows\\system32\\${n}`), {
    env: { SystemRoot: 'C:\\Windows', WINEPREFIX: '/home/u/.wine' }
  })
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    assert.deepEqual(detectWine({ ...loaded, platform }), { wine: false, signals: [] }, platform)
  }
})

test('the system directory comes from the environment, and always resolves to something', () => {
  assert.equal(systemDirectory({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\system32')
  assert.equal(systemDirectory({ windir: 'D:\\WinNT' }), 'D:\\WinNT\\system32')
  assert.equal(systemDirectory({ SystemRoot: 'C:\\Windows\\' }), 'C:\\Windows\\system32')
  assert.equal(systemDirectory({ SystemRoot: '  C:\\Windows  ' }), 'C:\\Windows\\system32')
  // SystemRoot wins over windir when both are present (they normally agree).
  assert.equal(systemDirectory({ SystemRoot: 'C:\\Windows', windir: 'D:\\Other' }), 'C:\\Windows\\system32')
  // Neither set, or set to nothing: the conventional path, so the check still HAPPENS. A skipped
  // probe would be a silent false negative.
  assert.equal(systemDirectory({}), 'C:\\Windows\\system32')
  assert.equal(systemDirectory({ SystemRoot: '' }), 'C:\\Windows\\system32')
  assert.equal(systemDirectory({ SystemRoot: '\\' }), 'C:\\Windows\\system32')

  // …and the detector really looks THERE, not at a hardcoded C: — a prefix on another drive is
  // still a prefix.
  const relocated = withFiles(['D:\\WinNT\\system32\\wineboot.exe'], {
    env: { SystemRoot: 'D:\\WinNT' }
  })
  assert.equal(detectWine(relocated).wine, true)
  assert.equal(detectWine({ ...relocated, env: { SystemRoot: 'C:\\Windows' } }).wine, false)
})

test('every probed binary name is Wine-exclusive by construction', () => {
  // The property that makes the primary signal safe: Windows ships no executable in system32
  // whose name begins with "wine". If a name that does not start with "wine" is ever added here,
  // this is where the reasoning has to be redone rather than quietly widened.
  for (const name of WINE_SYSTEM_BINARIES) {
    assert.ok(name.startsWith('wine'), `${name} is not in Wine's name space`)
    assert.ok(name.endsWith('.exe'), `${name} should be one of Wine's own tools`)
  }
  for (const name of WINE_ENV_VARS) assert.ok(name.startsWith('WINE'), name)
  assert.ok(WINE_SYSTEM_BINARIES.includes('wineboot.exe'), 'creating a prefix IS running wineboot')
  // THE NEAR-MISS. Wine installs winhlp32.exe, and so did Windows XP/Vista/7 — and the WinHlp32
  // redistributable still installs it on Windows 10/11. It lands in C:\Windows rather than
  // system32, so probing for it HERE would probably be safe, and "probably safe" is not the
  // standard a signal that costs every Windows user their GPU is held to.
  assert.ok(!WINE_SYSTEM_BINARIES.includes('winhlp32.exe'), 'winhlp32 is a real Windows binary too')
})

test('a detected prefix asks for OPAQUE OVERLAYS AND KEEPS THE GPU; an ordinary machine asks for nothing', () => {
  // JOS-352, and the inversion is the point: safe mode is `false` under Wine. It shipped `true`,
  // and safe mode on Windows means Chromium's D3D11 WARP software renderer — which Wine does not
  // implement, so the compatibility path was the ONLY one that could not paint (issue 28).
  assert.deepEqual(WINE_GRAPHICS_AUTO, { safeMode: false, opaqueOverlays: true })
  const wine = graphicsEnvironmentOf({ wine: true, signals: ['file:wineboot.exe'] })
  assert.deepEqual(wine, {
    wine: true,
    signals: ['file:wineboot.exe'],
    auto: { safeMode: false, opaqueOverlays: true }
  })
  assert.deepEqual(graphicsEnvironmentOf({ wine: false, signals: [] }), NO_GRAPHICS_ENVIRONMENT)
  // The renderer's pre-hydration state is the ordinary machine, so a card that has not heard back
  // from main yet never flashes a claim it has to take back.
  assert.deepEqual(NO_GRAPHICS_ENVIRONMENT.auto, { safeMode: false, opaqueOverlays: false })
})

test('the Chromium flags are gated on the PREFIX, and real Windows gets an empty list', () => {
  // The two measured on issue 28: DirectComposition is E_NOTIMPL under Wine, and the GPU process
  // takes an access violation (0xC0000005) three times before Chromium gives up — running it
  // in-process is what makes the app paint.
  assert.deepEqual(WINE_CHROMIUM_FLAGS, ['disable-direct-composition', 'in-process-gpu'])
  assert.deepEqual(chromiumFlagsFor({ wine: true, signals: ['env:WINELOADER'] }), WINE_CHROMIUM_FLAGS)

  // THE HALF THAT MATTERS TO EVERY OTHER USER. `--in-process-gpu` gives up crash containment, so
  // it may not reach a machine that has no Wine problem to solve — and the gate is the DETECTION,
  // never the stored preference, so no combination of settings can conjure it onto real Windows.
  assert.deepEqual(chromiumFlagsFor({ wine: false, signals: [] }), [])
  assert.deepEqual(chromiumFlagsFor(detectWine(windows())), [])
  assert.deepEqual(
    chromiumFlagsFor(detectWine({ platform: process.platform, env: process.env, fileExists: existsSync })),
    [],
    'this machine is real Windows and must append nothing'
  )
  // A native build is gated out one level up, so it cannot reach the list either.
  const loaded = withFiles(WINE_SYSTEM_BINARIES.map((n) => `C:\\Windows\\system32\\${n}`))
  assert.deepEqual(chromiumFlagsFor(detectWine({ ...loaded, platform: 'linux' })), [])
  assert.deepEqual(chromiumFlagsFor(detectWine(loaded)), WINE_CHROMIUM_FLAGS)
})

test('THIS machine, with a real filesystem, is not mistaken for Wine', () => {
  // The false-positive guard with nothing stubbed: the actual `process.env` and the actual
  // `existsSync` of the box running this suite. CI and every developer machine here is real
  // Windows, so the required answer is `false` — and if someone's environment ever trips a
  // signal, this fails HERE rather than in a user's blank overlay.
  const found = detectWine({ platform: process.platform, env: process.env, fileExists: existsSync })
  if (process.platform !== 'win32') {
    assert.equal(found.wine, false, 'a non-win32 host is gated out before anything is read')
    return
  }
  assert.deepEqual(found, { wine: false, signals: [] }, `signals fired on a real Windows box: ${found.signals.join(', ')}`)
})
