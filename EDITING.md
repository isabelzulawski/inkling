# Editing an inkling

Everything is plain text. Open these files in a code editor (VS Code, for example), save your changes, then refresh the browser. There is no build command or framework. Keep all three files in the same folder.

| File | What it controls |
| --- | --- |
| `index.html` | The title, labels, buttons, menus, and which interface elements exist |
| `style.css` | Fonts, colors, spacing, layout, and responsive screen sizes |
| `script.js` | Drawing, playback, pitch, stretching, notation, Undo, and sound processing |

## Easy places to start

Use your editor's Find command to locate the names below.

### Title and labels — index.html

- `<title>` controls the browser tab name.
- `<h1>` controls the visible artwork name. Each letter of “an inkling” has its own span to give it a slightly uneven angle and height. `--tilt` is degrees; `--lift` is pixels. If you change the name, update both the visible letters and `aria-label` (the accessible name).
- Text between button tags is the visible label. Keep each `id` as it is: JavaScript uses those IDs to find the controls.
- Keep the fish ornaments inside the spans with `class="fish"` so they retain their smaller size.

### Fonts and ink — style.css

Look near the bottom for the commented appearance blocks. Later CSS rules override earlier ones, so these are the current settings to edit.

- `--script`: the title font stack; the first installed font wins.
- `--hand`: the other handwritten lettering.
- `h1 .hand-title { color: #716958; }`: title ink color.
- `.hand-title > span { opacity: 0.82; }`: title ink strength. Values range from 0 (invisible) to 1 (opaque).
- `-webkit-text-stroke: 0.55px #eee4cf`: a paper-colored edge that makes the fixed-weight title font's strokes finer. Larger values erase more of each letter's edge; use small changes.
- `.title-row` and `h1`: header spacing. `fitTitle()` in JavaScript automatically reduces the title size if it would overflow.
- `#instrument`: the expression-tools area. `footer` and `nav`: the main controls.
- `@media` blocks: special layout rules for narrow browser windows.

The main paper texture and staff lines are drawn on the canvas, so their colors are in JavaScript rather than CSS.

### Drawing and paper — script.js

- `paper()`: the ivory color (`#eee4cf`), grain, and aged patches.
- `printed()`: staff groups and margin diagrams.
- `frame()`: rendering and playback. Find `0.4 + 1.7 * inkAt(pts[i])` for the drawn line width in pixels. The first number sets minimum width; the second controls how much Dynamics thickens the ink. Changing these does not change volume.
- `notation()` and `drawNotation()`: which musical events become marks and how those marks look.
- `scale`: MIDI note numbers, currently C-major pentatonic from C3 to C5. `pitch()` maps drawing height to this array. If you change the number of notes, also update the multiplier and upper limit in `pitch()`.
- `levelAt()`: ink-to-loudness mapping (`0.12 + 0.56 * ink`). Keep output conservative.
- `audio()`: starting master gain is the Volume value multiplied by `0.22`. The Volume input handler uses that same multiplier; update both together if you change it.
- `sigma`: width of the local stretch region, in normalized paper coordinates (currently `0.115`).
- `frequency()`: pitch preservation versus tape-like stretching.
- `buildDSP()`: creates and connects audio nodes. `applyDSP()`: maps the sound shapes to real parameters.
- `steps`: walkthrough text. `showStep()` and the demo handler below it control the examples.

Coordinates `x` and `y` run from 0 to 1 across the paper; `t` is recorded seconds. Each source point also stores pitch, ink, and stroke identity. Dynamics edits live separately. Render transforms never rewrite the source drawing.

## After editing

1. Save and refresh the page. Click **begin** again after a reload.
2. Draw two strokes. Listen to them loop, then stretch one region.
3. Try Undo, reset paper, and erase drawing.
4. Resize the browser and check that the title and controls fit.

For code checks, run `node --check script.js` and `node tests/core.cjs` if Node.js is installed. The local browser page `tests/audio.html` provides actual rendered-audio checks. You do not need Node.js to run the artwork.

The README contains the fuller musical mappings, effect ranges, and limitations.
