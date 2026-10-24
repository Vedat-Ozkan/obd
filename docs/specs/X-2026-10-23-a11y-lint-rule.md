# X-2026-10-23: local TextInput accessibilityLabel lint rule and worktree ignore

## Goal
Make `pnpm lint` (the lint step of `pnpm check`) fail when a JSX `TextInput` under `apps/mobile` has no `accessibilityLabel`, and stop it scanning in-flight implementer worktrees. Both changes are in the root `eslint.config.js`. Main passes today: every `<TextInput` in `apps/mobile` is labelled (grep finds 9 lines: `ConsoleScreen.tsx` x4, `AddVehicleScreen.tsx` x3, `DevelopmentSummary.tsx` x2; the owner's count of 7 from T2.19 A1 differs, so the implementer reports the grep count). Owner approved this follow-up on 2026-10-23; it fulfils docs/ACCESSIBILITY.md item 4 (Lint), which allows a small local rule instead of `eslint-plugin-react-native-a11y`.

## Non-goals
- No new dependency, no `eslint-plugin-react-native-a11y`, no other a11y rules (roles, touch targets, `Pressable`).
- No separate rule file or package; the plugin object is inline in the config.
- No change to application code or tests.
- No attempt to catch aliased imports (`import { TextInput as Input }`) or wrapper components.

## Interfaces
Config only. Before: ignores list plus one `files`/`extends` block. After: ignores gain `'**/.claude/worktrees/**'`, and one new config object:

```js
{
  files: ['apps/mobile/**/*.tsx'],
  plugins: { local: { rules: { 'textinput-accessibility-label': <rule> } } },
  rules: { 'local/textinput-accessibility-label': 'error' },
}
```
`<rule>` is a standard ESLint rule object (`meta.type: 'problem'`, `meta.messages`, `schema: []`, `create(context)` returning a `JSXOpeningElement` visitor). It reports when the element name is `TextInput` (also `X.TextInput` member form) and no `JSXAttribute` named `accessibilityLabel` is present.

## Files
- `eslint.config.js` — modify (toolchain file; the lead must create `.claude/ALLOW_TOOLCHAIN` before the implementer starts and delete it afterwards) — add the ignore and the inline rule.

## Sources
| Constant / behavior | Source |
|---|---|
| Inline plugin objects supported in flat config | Installed ESLint 10.10.0 (`node_modules/eslint/package.json` `"version": "10.10.0"`); flat config `plugins` takes any object with `rules`. The implementer confirms by the verification below, not by memory. |
| Rule requirement ("every `TextInput` needs an `accessibilityLabel`") | docs/ACCESSIBILITY.md, item 4 (Lint) |
| All inputs labelled today (grep shows 9 lines vs. the brief's 7) | `grep -rn "<TextInput" apps/mobile --include=*.tsx` on main |
| `.claude/worktrees/` is gitignored and holds worktrees | `.gitignore` line 43; `.claude/worktrees/agent-*` exist |
| JSX node type `JSXOpeningElement` with `name`/`attributes` | espree/typescript-estree AST already used by the TS parser in this config |

No OBD PID, AT command, DTC, or header is touched.

## Verification
Shared: `pnpm lint` runs from the repo root of the implementer's worktree. Artifact: the command output pasted in the report.

Failure modes of the rule, listed before code:
1. Misses a `TextInput` with no props at all or with other props only → probe A.
2. False positive on a labelled input, breaking main → main passes (check 1).
3. Rule does not run on `.tsx` in `apps/mobile` (wrong `files` glob) → probe A fails to report.
4. Counts a spread (`{...props}`) as a label, or crashes on it. Decision: a spread does not count; the input is reported → probe B.
5. Counts `accessibilityLabel=""` as labelled. Decision: only presence of the attribute is checked; an empty literal is not detected (accepted, noted in report).
6. Crashes on `Foo.TextInput` or a non-identifier element name → probe C (labelled member form passes, unlabelled is reported).
7. Fires on unrelated elements (`<Text>`) → check 1 (main has many).
8. The ignore does not exclude `.claude/worktrees/**` → check 3.

Checks:
- [ ] 1. On the implementer's branch with only `eslint.config.js` changed: `pnpm lint` exits 0.
- [ ] 2. Probes (E2E through `pnpm lint`). Create `apps/mobile/src/lintProbe.tsx` (uncommitted; it must sit inside the TS project for `projectService`, so a copy outside the repo will not lint) containing a component that renders (A) `<TextInput value="" />`, (B) `<TextInput {...props} />`, (C) `<RN.TextInput accessibilityLabel="x" />` and `<RN.TextInput />`. Run `pnpm lint`: expect `local/textinput-accessibility-label` errors for A, B and the unlabelled C only, and nonzero exit. Then `rm apps/mobile/src/lintProbe.tsx`; `git status --short` shows only `eslint.config.js`. Unrelated type errors in the probe from `strictTypeChecked` are acceptable provided the three expected rule reports appear; if the file's own type noise obscures them, run `pnpm exec eslint apps/mobile/src/lintProbe.tsx`.
- [ ] 3. Worktree ignore: from the main checkout, `pnpm exec eslint --debug . 2>&1 | grep -c "\.claude/worktrees"` is 0 (or `pnpm exec eslint --print-config .claude/worktrees/<any>/AGENTS.md` / lint of a file there reports it as ignored). Alternatively, with a worktree present holding a file with an unused import, `pnpm lint` on main still passes.
- [ ] 4. `pnpm check` green.
- Hardware: none; NOT RUN is not applicable.

## Risks / open questions
- Aliased imports and wrapper components escape the rule (stated limitation).
- If `'**/.claude/worktrees/**'` does not match because ESLint treats dot-directories differently, the implementer uses `'.claude/worktrees/**'` instead and says so; check 3 decides.
- No blocker: ESLint 10.10.0 supports inline plugin objects. No open questions for the owner.

## Decisions
- 2026-10-23 owner: approved both changes, inline rule with no new dependency, `eslint.config.js` only.
