import vm from 'node:vm';
import type { SafeRegexOptions, SafeRegexResult } from '../types/index.js';

// Caller-supplied regular expressions (grep `query`, search_code
// `regex_filter`) run against every line of every file on this single
// thread. V8's backtracking engine makes `(a+)+$` take seconds on a
// 30-character line, which freezes the server for every client. Three
// layers, all cheap:
//   1. static:  length cap, no backreferences, no quantified group that
//               itself contains an unbounded quantifier (star height ≥ 2);
//   2. dynamic: the compiled regex is probed against adversarial inputs
//               derived from the pattern inside a vm context with a timeout —
//               a vm timeout DOES interrupt regex backtracking;
//   3. runtime: scans carry a wall-clock deadline (config grep.scanTimeoutMs),
//               lines longer than grep.maxScanLineChars are skipped (a single
//               regex test is uninterruptible and even `\s+$` is quadratic on
//               a multi-MB minified line), and src/index.ts opts V8 into its
//               linear-time fallback engine. Note: with that flag active the
//               probe no longer times out on engine-supported patterns — which
//               is fine, because execution is then linear too; patterns the
//               fallback cannot handle (lookarounds) still hit the probe.

const PROBE_LENGTHS = [32, 64, 256];
const PROBE_TAILS = ['', '!', '\u0000', ' '];

export function compileSafeRegex(pattern: string, opts: SafeRegexOptions): SafeRegexResult {
  if (pattern.length > opts.maxLength) {
    return { ok: false, reason: `pattern is longer than ${opts.maxLength} characters` };
  }
  if (/\\[1-9]|\\k</.test(pattern)) {
    return { ok: false, reason: 'backreferences are not supported (they can backtrack exponentially)' };
  }
  if (hasNestedUnboundedQuantifier(pattern)) {
    return {
      ok: false,
      reason:
        'a quantified group contains another quantifier (e.g. `(a+)+`, `(\\w+\\s*)*`), which can backtrack exponentially — ' +
        'rewrite with a single quantifier level (e.g. `[\\w\\s]+`)',
    };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, opts.flags);
  } catch (e) {
    return { ok: false, reason: `invalid regex: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!probeWithTimeout(regex, pattern, opts.probeTimeoutMs)) {
    return {
      ok: false,
      reason: `pattern backtracks catastrophically on adversarial input (probe exceeded ${opts.probeTimeoutMs} ms) — simplify it`,
    };
  }
  return { ok: true, regex };
}

/**
 * Detects the exponential nesting shape: an UNBOUNDED quantifier (`*`, `+`,
 * `{n,}`) applied to a group that (a) contains a variable-width quantifier
 * and (b) has no unquantified literal delimiter in every alternative. With a
 * delimiter (`(\\w+/)+`, `(\\.\\d+)*`, `(foo|bar\\d+)+`) iterations are
 * unambiguous, so those common patterns pass; `(a+)+`, `(\\w+\\s*)*`, `(a?)*`
 * do not. Bounded outer repeats (`{3}`, `{1,5}`) and fixed inner repeats
 * (`{2}`) are not flagged — the probe decides those. Handles escapes,
 * character classes, lookarounds, named groups and lazy quantifiers.
 */
export function hasNestedUnboundedQuantifier(src: string): boolean {
  type ClosedGroup = { varQuant: boolean; allDelim: boolean };
  type Frame = { varQuant: boolean; branchDelim: boolean; allDelim: boolean; pendingLiteral: boolean; lastGroup: ClosedGroup | null };
  const newFrame = (): Frame => ({ varQuant: false, branchDelim: false, allDelim: true, pendingLiteral: false, lastGroup: null });
  const stack: Frame[] = [];
  let f = newFrame();
  // A literal becomes a delimiter only once we know no quantifier follows it.
  const commitPending = (): void => {
    if (f.pendingLiteral) {
      f.branchDelim = true;
      f.pendingLiteral = false;
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      commitPending();
      f.lastGroup = null;
      const next = src[i + 1] ?? '';
      if (next === 'p' || next === 'P') {
        const close = src.indexOf('}', i);
        i = close === -1 ? src.length : close + 1;
      } else if ('dDwWsS'.includes(next)) {
        i += 2; // class escape: not a delimiter
      } else if (next === 'b' || next === 'B') {
        i += 2; // zero-width
      } else {
        f.pendingLiteral = true; // escaped literal (\\. \\/ \\- \\( …)
        i += 2;
      }
      continue;
    }
    if (c === '[') {
      commitPending();
      f.lastGroup = null;
      i += 1;
      if (src[i] === '^') i += 1;
      if (src[i] === ']') i += 1;
      while (i < src.length && src[i] !== ']') {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '(') {
      commitPending();
      stack.push(f);
      f = newFrame();
      i += 1;
      if (src[i] === '?') {
        i += 1;
        if (src[i] === '<' && src[i + 1] !== '=' && src[i + 1] !== '!') {
          while (i < src.length && src[i] !== '>') i += 1;
          i += 1;
        } else {
          i += 1; // ':' '=' '!' or '<' of lookbehind
          if (src[i - 1] === '<') i += 1;
        }
      }
      continue;
    }
    if (c === '|') {
      commitPending();
      f.allDelim = f.allDelim && f.branchDelim;
      f.branchDelim = false;
      f.lastGroup = null;
      i += 1;
      continue;
    }
    if (c === ')') {
      commitPending();
      f.allDelim = f.allDelim && f.branchDelim;
      const closed: ClosedGroup = { varQuant: f.varQuant, allDelim: f.allDelim };
      const parent = stack.pop() ?? newFrame();
      parent.varQuant = parent.varQuant || closed.varQuant;
      parent.lastGroup = closed;
      parent.pendingLiteral = false;
      f = parent;
      i += 1;
      continue;
    }
    const quant = quantifierAt(src, i);
    if (quant) {
      if (f.lastGroup && quant.unbounded && f.lastGroup.varQuant && !f.lastGroup.allDelim) return true;
      if (quant.variable) f.varQuant = true;
      f.pendingLiteral = false; // a quantified literal is not a delimiter
      f.lastGroup = null;
      i += quant.length;
      if (src[i] === '?') i += 1; // lazy modifier
      continue;
    }
    commitPending();
    f.lastGroup = null;
    if (c !== '^' && c !== '$' && c !== '.') f.pendingLiteral = true; // anchors / dot are not delimiters
    i += 1;
  }
  return false;
}

function quantifierAt(src: string, i: number): { length: number; unbounded: boolean; variable: boolean } | null {
  const c = src[i];
  if (c === '*' || c === '+') return { length: 1, unbounded: true, variable: true };
  if (c === '?') return { length: 1, unbounded: false, variable: true };
  if (c === '{') {
    const m = /^\{(\d+)(?:,(\d*))?\}/.exec(src.slice(i));
    if (!m) return null;
    const min = Number(m[1]);
    const max = m[2] === undefined ? min : m[2] === '' ? Infinity : Number(m[2]);
    return { length: m[0].length, unbounded: max === Infinity, variable: max !== min };
  }
  return null;
}

/** Adversarial inputs: runs of each literal/class-representative character, with and without a non-matching tail. */
function probeInputs(pattern: string): string[] {
  const chars = new Set<string>(['a', '1', ' ', '-', '_', '.', '/']);
  for (const ch of pattern.replace(/\\./g, '')) {
    if (/[A-Za-z0-9 _\-.,;:/=<>"']/.test(ch)) chars.add(ch);
  }
  const literal = pattern.replace(/[\\^$.*+?()[\]{}|]/g, '');
  const inputs: string[] = [];
  for (const n of PROBE_LENGTHS) {
    for (const ch of chars) for (const tail of PROBE_TAILS) inputs.push(ch.repeat(n) + tail);
    if (literal.length > 0) {
      for (const tail of PROBE_TAILS) inputs.push(literal.repeat(Math.ceil(n / literal.length)).slice(0, n) + tail);
    }
  }
  return inputs;
}

function probeWithTimeout(regex: RegExp, pattern: string, timeoutMs: number): boolean {
  const context = vm.createContext({ regex, inputs: probeInputs(pattern) });
  try {
    vm.runInContext('for (const s of inputs) regex.test(s); true', context, { timeout: timeoutMs });
    return true;
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return false;
    return true; // a non-timeout failure is not a ReDoS signal
  } finally {
    regex.lastIndex = 0;
  }
}
