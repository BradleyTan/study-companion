# Note download security review

Date: 2026-10-28. Reviewer: security-engineer. Branch `claude/feedback-ai-quality-kgmile`, commit `60a6ea3` only ("Notes: download as PDF or Word; keep toolbar headings when saving", `git show 60a6ea3`).
Scope: the Word export (`src/lib/notes/docx.ts`, dependency `docx@9.11.0`), the Download dialog (`src/components/note-editor.tsx` `DownloadDialog`), the print styles for PDF (`src/app/globals.css` `@media print`, `print:hidden` in `src/app/(app)/layout.tsx` and the editor), and the plain-JSON note save (`note-editor.tsx` `save`).

**Verdict: cleared to merge.** No critical, high or medium findings. Two low findings, both about the student's own file, are left to the developer (DL-1) or accepted (DL-2). Everything here runs in the student's own browser on their own note: no new server code, endpoint, table or secret. I didn't change anything under `src/` or `e2e/`. FB-0 (the `next` and `zod` advisories in `docs/security/feedback-review.md`) is still open and still fails CI's audit step. This commit doesn't change it.

## Findings

| # | Severity | Finding | Where | Fix | Status |
|---|---|---|---|---|---|
| DL-1 | Low | **Control characters make a Word file that won't open.** `docx` escapes `< > & " '`, but it writes C0 control characters (U+0001–U+0008, U+000B, U+000C, U+000E–U+001F) and U+FFFE/U+FFFF into `document.xml` and `core.xml` as they are. XML 1.0 doesn't allow them, so Word reports the file as damaged. I checked this with `\u0001` and `\u0007` in a title and a run. Uploads and web pages can't cause it, because `chunk.ts` strips these characters. A typed note or a pasted title can. This loses nothing and leaks nothing. It only breaks that student's own download. | `src/lib/notes/docx.ts:25-35` (`runs`), `:73` (code blocks), `:99`, `:111` (title) | Remove `[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]` (and lone surrogates) from every text and from the title before they reach `TextRun`/`Document`. Add a test that loads the result with a strict XML parser. | **Open** (developer, not blocking) |
| DL-2 | Low | **Bidi and look-alike characters stay in the file name.** `noteFileName` removes the characters Windows reserves, control characters, leading and trailing dots, and anything past 100 characters. U+202E (right-to-left override) passes through, so a title like `evil‮xcod.exe` can show the name reversed. The extension is always `.docx`, and the browser cleans the name again when it saves. The only person who can set the title is the student who owns the note, and they can rename the file anyway. Reserved device names (`CON`) are handled by the browser. | `src/lib/notes/docx.ts:120-123` | None needed. If the developer touches DL-1, they can also strip `‎‏‪-‮⁦-⁩` here. | **Accepted** |

## Checked, no finding

### Dependency `docx@9.11.0`
- **Version and source**: pinned exactly in `package.json`. The lockfile resolves to `registry.npmjs.org`, and the integrity hash (`sha512-vQLEYi45…`) matches `npm view docx@9.11.0 dist.integrity`. It was published 2026-10-13, 15 days ago, so it's older than the two-week minimum. 9.12–9.15 are all newer than that (9.15.0 came out yesterday), so skipping them is correct. It has one maintainer (`dolanmiu`), the long-standing author.
- **New packages in the tree** (all from the lockfile diff): `docx` (MIT), `hash.js` 1.1.7 (MIT), `minimalistic-assert` 1.0.1 (ISC), `xml` 1.0.1 (MIT), `xml-js` 1.6.11 (MIT), `sax` 1.6.1 (BlueOak-1.0.0, a permissive licence), and copies nested under `docx`: `nanoid` 6.0.2 (MIT), `@types/node` 26.6.5 and `undici-types` 8.9.0 (MIT, types only, no runtime code). `jszip` and `inherits` were already installed. No copyleft licence is added; `jszip`'s `MIT OR GPL-3.0` lets us take MIT, as before.
- **Install scripts**: none. The lockfile's only `hasInstallScript` entries are `fsevents` (twice) and `unrs-resolver`, which were there before. No new package has a `preinstall`/`install`/`postinstall`/`prepare` script.
- **Network**: the entry we load (`exports["."]` → `dist/index.mjs`) has no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or `importScripts` call. The `fetch` matches in `dist/html.mjs` are a local helper of the bundled `domutils` feed parser, not network calls. That subpath isn't imported anyway. `eval(` is only a reference to `EvalError` in the bundled `get-intrinsic`. `new Function` appears only in JSZip's `setImmediate` polyfill, for string callbacks, which nothing passes. The polyfill's `postMessage(…, "*")` is posted to its own window with a random prefix, so it sends nothing out.
- **Advisories**: `npm audit --omit=dev` reports nothing for `docx` or any of its dependencies. The only results are FB-0 (`next`, `zod`), which was there before this commit.
- **Loading**: `src/lib/notes/docx.ts` is imported only by the dynamic `import("@/lib/notes/docx")` in the click handler and by its test. The server bundle never loads it.

### XSS and injection through the note text and title
- **Into the docx**: all text goes through `TextRun` and `Document({ title })`. I checked with `</dc:title><x>&"'` and `<w:p>]]>`. Both are escaped in `word/document.xml` and `docProps/core.xml`, so the XML structure can't be broken out of, and no part can be added. `noteDocument` builds only paragraphs, headings (level clamped to 1–4), lists, code, quotes and rules. Links, images, fields, macros and external relationships aren't built from the note, and the zip's parts are the library's fixed set. Node types it doesn't know are flattened to their text. The unit test "escapes XML in the text" covers the basic case.
- **On the page**: the title appears in the dialog and in the print `<h1>` as React text. The diff has no `dangerouslySetInnerHTML` or `innerHTML`. The editor still uses `StarterKit.configure({ link: false })`.
- **File name**: see DL-2. The name is used only as the anchor's `download` attribute. It never goes into a URL, a path or a header.

### Blob URL
`URL.createObjectURL` gets a blob that `Packer.toBlob` made, with the Word MIME type, so the browser downloads it and never renders it as HTML in our origin. The anchor is added, clicked and removed in the same tick. The URL is revoked after 10 s. Only this tab can read it, and it holds only the student's own note. An error shows a generic message and plays a sound. Nothing is logged.

### Print CSS (PDF)
- `body * { visibility: hidden }` with `.print-note, .print-note *` visible means only the title `<h1>` and the editor content print. The header, toolbar, save state, error text, read-aloud bar, the passage-changed quote box, the delete button and the dialogs are also marked `print:hidden`. No other rule in `globals.css` or `src/components` sets `visibility: visible`, so nothing hidden comes back.
- What prints is what the student already sees on screen, in their own browser, and none of it goes to us. The browser's own header and footer can show the page title and URL, which hold the subject and note uuids. Those aren't secrets: RLS (`user_id = auth.uid()`) still protects the rows, as it does for a shared screenshot.

### Note save change
`JSON.parse(JSON.stringify(editor.getJSON()))` only turns the editor's objects into plain data before the server action is called. `saveNote` is unchanged: it still checks the whole input with `noteUpdate` (zod), loads the note through the `Repo` (RLS) and limits the size as before. Because `JSON.parse` makes a `__proto__` key an ordinary property, it can't pollute prototypes in the browser or on the server.

## Results
- `npx vitest run src/lib/notes/docx.test.ts`: 4 tests passed.
- Escaping and control-character probe: a scratch script against `node_modules/docx/dist/index.mjs`, now deleted.
- `npm audit --omit=dev`: only FB-0 (1 critical `next`, 1 high `zod`), as before.
- I didn't run Playwright or the full suite for this review. Another agent is committing QA fixes on the branch.
