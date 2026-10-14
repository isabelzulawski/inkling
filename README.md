# Elastic Score

A working, single-voice, multi-stroke browser artwork studying how drawing and sound change bodily awareness of time. No dependencies, framework, build step, external assets, or network requests.

## Run

Open `index.html` in a modern browser, or run `python3 -m http.server 8000` in this folder and visit http://localhost:8000. Click **Begin** to unlock browser audio. Draw a stroke and release to loop it. Add more strokes to build the same drawing. Switch to **Stretch**, grab near part of the phrase, and drag horizontally. Right expands; left compresses. The deformation persists until reset paper. New strokes append to the phrase in drawing order. pause and erase drawing release the voice smoothly.

## The mappings

- Original vertical position selects one of eleven C-major pentatonic pitches, C3–C5. Higher means higher pitch. Frequency transitions use a 25 ms smoothing time. Drawing remains freehand; no visual snapping.
- Every point stores its position, pentatonic pitch, and elapsed drawing time. Playback follows recorded order, including backwards paths, crossings, and time spent holding still.
- A Gaussian region of horizontal density is controlled by drag distance. Its integral maps original coordinates onto the deformed paper. Density remains strictly positive, so the page cannot fold. The map is normalized to keep the paper edges in view: local expansion entails gentle compression elsewhere.
- The spatial map's derivative is the local duration multiplier. Each original time interval takes longer where the paper is wider, shorter where it is compressed. Original pitches never depend on the deformed coordinates.
- A shared phase, advanced using the Web Audio clock in small integration steps, controls both the voice and playback mark. There is a brief quiet breath between loops. The duration display reports the sounding phrase; the breath is additional.
- Noteheads are selected at pitch changes with a minimum spacing and occasional temporal landmarks. Recorded holds create hollow heads and sustained lines. Notation is generated once at release and stays attached to original coordinates. Playback flex and ink impressions are temporary.

## Research / iteration log

The supplied syllabus asks for a working foundational prototype testing one core mechanic and ongoing documentation. This build tests drawing → repeating sound → local time deformation. The journal's repetition and lingering moments and the proposal's translation across media guide the interaction. Later proposal features (multiple voices, tools, lighting) are deliberately outside this prototype's scope.

References inspected: both supplied visual images; the syllabus, journal, and project proposal; Music Mouse (https://teropa.info/musicmouse/) for constrained pointer musicianship; Patatap (https://patatap.com/) for immediate gesture feedback. Paper texture, staff lines, fragments, and notation are generated individually in code rather than using the reference as a backdrop.

Design choice: the brief fading offset impression is a visual memory of the just-heard moment. It lets repetition leave a trace without accumulating permanent marks or changing the stored gesture.

Current limits: one active stretch region. A new grab establishes a new region and replaces the preceding field; reset paper restores original timing. Browser animation scheduling drives voice updates, so this is an expressive prototype rather than a sample-accurate sequencer. Audio pauses when the tab loses focus or becomes hidden. Drawing requires a mouse, pen, or touch pointer; controls are keyboard accessible.

## Class demonstration / critique

1. Draw a curve slowly for 3–5 seconds, holding still briefly at its crest.
2. Listen to two repetitions. Notice the hollow notehead marking the hold.
3. Stretch near the crest to the right. Compare the mark's local speed and the longer held sound.
4. Pause, reset, and replay to compare with the original gesture.
5. Ask a visitor: where did time feel changed? Did the visual paper or the sound communicate that first? Could they predict what a pull would do?

Record what surprised you and what critique changes for the syllabus's next phase; this prototype does not substitute for the outside critique or final written reflection.

## Expanded instrument: implemented

The original gesture, staves, single repeating voice, stable noteheads/stems/beams/holds, and monotone local stretch remain. The title uses **Snell Roundhand** (script), and all other lettering uses **Apple Chancery**, with cursive system fallbacks; there is no font download.

### Expression and recovery

- **Ink before drawing:** Fine = 0.25, Medium = 0.5, Bold = 1. Stored with each source point. The rendered line is approximately `0.4 + 1.7 × ink` pixels plus a small deterministic ink variation. Note gain is `0.12 + 0.56 × ink`, capped at 0.68 before the master volume.
- **Dynamics:** grab within 50 display pixels of a recorded stroke point; drag up 100 px to add 1 ink unit, down to subtract 1. Edits are Gaussian weights in *original gesture time*, sigma 0.28 seconds, centered at the nearest recorded point. Effective ink clamps to 0.08–1. Source data is unchanged. The tool edits a temporal section, so at crossings the nearest sampled point wins.
- **Legato:** continuous voice with smoothed pitch and gain. **Detached:** separate envelopes per generated event, attack over the first 6% of its original duration, sustain until 68%, release until 78%, silence for the final 22%. Events come from pitch changes at least 120 ms apart and temporal landmarks after 800 ms, plus the final held interval. Sustained sections remain long events rather than uniform tiny notes. Articulation never changes duration or the stretch field. Detached removes beams and adds short separation marks; notation is rebuilt at committed expression edits and then remains stable.
- **Preserve pitch:** enabled initially. On, frequency is the stored pentatonic frequency. Off, `frequency = source frequency / local spatial derivative`; original time advances at `1 / local spatial derivative` in both modes. The result is continuous and unquantized. This is synthesized-note timing and frequency modulation, **not a recorded-waveform time-stretch algorithm**.
- **Undo:** up to 40 committed actions, including stroke addition, erase drawing, stretch, Dynamics, expression choices, effect edits, bypass, and guide examples. A pointer drag is one action. Restoring pauses playback; press Play to compare. Mode selection, master volume, and walkthrough navigation are not score edits. A new stretch grab replaces the one preceding region, as in the foundational prototype; Undo can recover it.

### Sound representations and actual DSP

Open **Shape the sound**. Select a visual tool and manipulate its drawing. There are no effect sliders, effect knobs, or numerical input fields. Arrow keys adjust the selected representation; double-click restores its neutral shape. **Bypass** affects only the currently selected tool and retains its edited shape, allowing comparisons. With sound enabled, shaping a paused score produces a brief C4 audition; during playback it alters the phrase immediately.

| Representation | Interaction | Actual mapping / range |
| --- | --- | --- |
| Source / Stereo pan | Move the filled sound-source mark horizontally | Normalized horizontal position `x` gives `pan = 2x − 1`, from −1 left to +1 right, using StereoPannerNode |
| Space / Reverb | Pull the surrounding rings open horizontally | `space = x`, wet gain `0.7 × space`, dry gain `1 − 0.2 × space`; deterministic stereo ConvolverNode impulse, 2.4 s long, exponential amplitude decay time constant 0.42 s, unnormalized noise amplitude 0.012 |
| Edge / Distortion | Pull right to roughen the contour | `edge = x`, drive `d = 1 + 19 × edge`; transfer `tanh(d × input) / tanh(d)` sampled at 4096 points, 4× oversampling; edge 0 crossfades to the clean branch (bypass) |
| Boundary / Compression | Pull the enclosure inward (left) | `boundary = 1 − x`; threshold `−6 − 30 × boundary` dB, 4:1 ratio, 12 dB knee, 10 ms attack, 180 ms release. Neutral/bypassed boundary uses 1:1 ratio |
| Tone / EQ | Lift/lower the bright end of the silhouette vertically | `eq = 1 − 2y`, high-shelf gain `12 × eq` dB (−12…+12 dB), fixed 1200 Hz corner |

Pan, distortion drive/compensation, shelf gain, compressor targets, and wet/dry gains approach new targets with a 40 ms time constant. Distortion uses a fixed tanh curve with input drive and output compensation; its clean/processed branches crossfade over a 25 ms time constant. Oscillator frequency uses 25 ms; note gain 12 ms, silence release 35 ms. Bypass targets are center pan, no wet reverb, clean distortion branch, ratio 1:1, and 0 dB EQ. The impulse duration itself is fixed: Space controls the amount of surrounding reverberation, not an arbitrary simulated room size.

**Signal chain:** sine oscillator → note envelope/dynamics → waveshaper → high-shelf EQ → compressor → stereo panner → parallel dry and convolution-reverb paths → master volume → output stop gate → speakers.

Master gain is `0.22 × Volume`, initially 0.077. This is conservative gain staging, not a brickwall limiter; EQ and distortion can change perceived loudness. Pause/Clear and tab hiding release the note and close the post-reverb gate smoothly, so tails cannot keep sounding indefinitely. Pause intentionally silences the tail; normal event gaps and loop breaths let it ring. Drawing reopens the output gate. The audio context starts/resumes through Begin or an explicit Play/guide-example action.

The optional **Behind the sound** panel shows the effective DSP targets and units, current local stretch factor/frequency while sounding, mappings, and processing order. Compressor gain reduction and internal AudioParam ramps are not metered; displayed values are their actual target settings.

### Visuals and optional guide

Effective dynamics control line and notehead thickness. Legato beams and Detached separation marks distinguish touch. Space lengthens fading ink impressions from 0.52 to 2.62 seconds. Edge adds a bounded, deterministic rough contour offset; the original geometry is intact. All score marks still use the shared deformation. Fading impressions represent the amount of reverb; they are not an FFT or a literal measured impulse-response plot.

**Explore with a guide** is skippable and replayable. Five steps use the real Draw, Dynamics, Stretch, articulation, and Space interfaces. Each has an optional audible example; examples are Undo-able. The first example creates a 4-second rising phrase, replacing the current phrase only after the visitor clicks the example control. The guide never advances automatically or blocks free exploration.

### Expanded demonstration checklist

1. Begin; choose Fine, draw 3–5 seconds, release. Choose Bold and redraw; compare gain and thickness. Undo restores the Fine phrase; Play resumes it.
2. Dynamics: grab near a middle section; drag up/down; verify localized thickness and sound. Undo restores the prior dynamics.
3. Stretch right/left. Toggle Preserve pitch: compare duration-preserving pitches with tape-like lowered/raised pitch. Undo and reset paper restore the prior state.
4. Compare Legato/Detached: look for beams versus separated marks; listen for gaps without a duration change.
5. Open Shape the sound. Move Source left/right (headphones help); expand Space and hear a tail; roughen Edge; tighten Boundary; reshape Tone. Compare Bypass for each. Check corresponding technical targets in Behind the sound.
6. Test Pause, Play, Clear, Undo after Clear, a new drawing, pointer release outside the canvas, resize/high-DPI, and hiding/returning to the tab. Playback should remain stopped after tab hiding. Re-enable with Play if needed.
7. Skip/replay the guide, try its examples, and Undo them.

### Verification and remaining limits

`node tests/core.cjs` checks the stretch integral/inverse, preserved and tape-like frequencies, time-local dynamics, Undo restoration, Detached gaps, hold notation, DSP target ranges, bypass, and the output stop gate. Open `tests/audio.html` through a local server and click **Run real DSP checks** for actual OfflineAudioContext renders of stereo isolation, convolution tail, distortion harmonics, compressor reduction, and high-shelf boost. The test page is separate from the instrument.

The browser audio clock is still the timing reference. Original phase advances in 4 ms integration steps inside animation frames. No future audio events are scheduled ahead: frame stalls can hold a note too long, and very short Detached envelopes may be undersampled. This is not a sample-accurate sequencer. Source recording uses pointer timestamps approximately every 12 ms plus release time. Edits remain reversible; reload discards the current session. Controls are keyboard accessible; freehand score/Dynamics/Stretch still require a pointer. Pan requires stereo playback to hear placement.

Future ideas only: independent phrases/voices, audio import/export, recorded waveform processing, hardware lights, expanded instruments/scales, persistent sessions, and visitor-study documentation. These are not implemented.

## Simplified presentation version

The interface is lowercase throughout, with a script title and quill-like handwriting. Removed the edition heading, introductory sentence, Italian annotations, descriptive margin text, and normal mode/status instructions. The optional guide and technical explanations remain tucked away.

**reset paper** restores original stretch timing without erasing ink. **erase drawing** removes all strokes; **undo** restores the preceding action. New strokes add to one drawing, played sequentially through the existing single voice. Each stroke retains its own pitch, recorded timing, and ink choice. Pen lifts insert a 0.18-second original-time breath, stretched by the same local density as playback; time spent waiting between strokes is not recorded. No ink lines, interpolation, or notation beams bridge those breaths. Each stroke receives its own attack/release. Dynamics edits stay scoped to the stroke they were made on. Undo removes the latest stroke addition.

The guide's first example still replaces the drawing as an explicit, reversible demonstration. Multiple simultaneous voices remain out of scope. Tests now cover preservation of both strokes, separate note events, silent pen-up gaps, aggregate duration, and Undo of the most recent stroke.

## Editing the source

The HTML, CSS, JavaScript, and tests are formatted with indentation and section comments. See [EDITING.md](EDITING.md) for common changes and their locations. Formatting adds no runtime dependencies or build step.
