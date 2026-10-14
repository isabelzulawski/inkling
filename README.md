# an inkling

A working, multi-stroke browser artwork, attempting to study how drawing and sound change bodily awareness of time. 

## Play

Click **Begin**; draw a stroke and release to loop it. Add more strokes to build on top of the same drawing. Switch to **Stretch**, grab near part of the phrase, and drag horizontally. Right expands; left compresses. The deformation persists until reset paper is pressed. New strokes append to the phrase in drawing order.

## Research / iteration log

This build tests drawing → repeating sound → local time deformation. The idea of repetition, lingering moments, and translation across media guide the interaction. Later proposal features (multiple voices, tools, lighting) are outside this prototype's scope.

Design choice: the brief fading offset impression is a visual memory of the just-heard moment. It lets repetition leave a trace without accumulating permanent marks or changing the stored gesture.

Current limititations: one active stretch region. A new grab establishes a new region and replaces the preceding field; reset paper restores original timing. Browser animation scheduling drives voice updates, so this is an expressive prototype rather than a sample-accurate sequencer. 

Future ideas only: independent phrases/voices, audio import/export, recorded waveform processing, hardware lights, expanded instruments/scales, persistent sessions, and visitor-study documentation. These are not implemented.

### Sound representations and actual DSP

Open **Shape the sound**. Select a visual tool and manipulate its drawing. There are no effect sliders, effect knobs, or numerical input fields. Arrow keys adjust the selected representation; double-click restores its neutral shape. **Bypass** affects only the currently selected tool and retains its edited shape, allowing comparisons. With sound enabled, shaping a paused score produces a brief C4 audition; during playback it alters the phrase immediately.

Pan, distortion drive/compensation, shelf gain, compressor targets, and wet/dry gains approach new targets with a 40 ms time constant. Distortion uses a fixed tanh curve with input drive and output compensation; its clean/processed branches crossfade over a 25 ms time constant. Oscillator frequency uses 25 ms; note gain 12 ms, silence release 35 ms. Bypass targets are center pan, no wet reverb, clean distortion branch, ratio 1:1, and 0 dB EQ. The impulse duration itself is fixed: Space controls the amount of surrounding reverberation, not an arbitrary simulated room size.

**Signal chain:** sine oscillator → note envelope/dynamics → waveshaper → high-shelf EQ → compressor → stereo panner → parallel dry and convolution-reverb paths → master volume → output stop gate → speakers.

### Visuals and optional guide

**Explore with a guide** is skippable and replayable. Five steps use the real Draw, Dynamics, Stretch, articulation, and Space interfaces. Each has an optional audible example; examples are Undo-able. The first example creates a 4-second rising phrase, replacing the current phrase only after the visitor clicks the example control. 

## Editing the source

 See [EDITING.md](EDITING.md) for common changes and their locations.
