// CLI contract layer: command construction and JSON/output extraction.
// Single source of truth for how the WebUI reads the nzapret CLI.

export const MODDIR = '/data/adb/modules/nzapret';
export const CLI = `sh ${MODDIR}/system/bin/nzapret`;

// Collapse a ksu.exec result's stdout/stderr into a single trimmed message,
// dropping empty parts. Used for surfacing CLI errors to the user.
export function combineOutput(res) {
    return [(res && res.stdout) || '', (res && res.stderr) || '']
        .map((part) => part.trim())
        .filter(Boolean)
        .join('\n');
}

// Extract the JSON payload string from a CLI result's stdout.
// The CLI prints clean JSON for `--json` commands; the regex is a defensive
// guard against stray leading/trailing output. Returns the matched JSON text,
// or null when none is present. Callers JSON.parse the result so they can also
// use the raw payload string (e.g. to dedupe unchanged polls).
export function matchJson(res, options = {}) {
    const { array = false } = options;
    const raw = String((res && res.stdout) || '').trim();
    const match = raw.match(array ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
    return match ? match[0] : null;
}
