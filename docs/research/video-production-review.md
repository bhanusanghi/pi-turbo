# Video production review: visual explanation, tools, and free narration

Researched **2026-10-08** with extra-high reasoning. This is a production decision report,
not an implementation or a rendered movie. Reviewed [the current script](../video/video-plan.md),
[12 scenes](../video/scenes.json), and [browser storyboard renderer](../video/storyboard.html).
Canonical scenes, script, and runtime were not changed by this research.

## Recommendation

Keep the agreed **why → intuition → architecture → small integration functions** order.
The main production gap is that the preview reveals diagrams but does not yet make the
viewer *see a decision changing*. Establish that with a **30–60-second pilot**: a ticket
travels through the routine path; an ambiguous variant requests help; returned evidence
changes the next judgment.

For a deliberate investment in mathematical-style explanatory animation, use **Manim
Community + manim-composer + manimce-best-practices**, with **Kokoro 82M through MLX-Audio**
as the first local synthetic-voice audition. **Kitten Nano 15M or Micro 40M** is the strict
size alternative. If preserving the browser/SVG layout is the priority, **Remotion + its
official skills** is a practical alternative. These are fit judgments, not benchmark rankings.

Latest constraint: **anything under 500 MB works**. This report interprets that as the
downloaded **model checkpoint repository**, not peak RAM or the whole Python environment.
Kokoro’s roughly **352 MB** checkpoint fits, so narration quality should drive the choice
ahead of minimizing parameter count. The runtime and first-use auxiliary assets are additional.

## How 3Blue1Brown actually makes videos

| Layer | Verified practice | What transfers to this film |
| --- | --- | --- |
| Animation | Grant uses his Python engine **ManimGL**. His repository documents Sublime Text, an interactive scene at a chosen line, and checkpoints for iterating or recording selected code. | Work on short clips and revise their meaning quickly. [Workflow and demo](https://github.com/3b1b/videos#workflow), [first-person demonstration](https://www.youtube.com/watch?v=rbu7Zu5X1zI). |
| Engine choice | The original engine and **Manim Community** are separate projects and APIs. Grant recommends Community for newcomers; his fork is his experimental production environment. | Our starter imports `manim`, so keep CE instructions and examples together. [Engine comparison](https://github.com/3b1b/manim), [Grant’s guidance](https://www.3blue1brown.com/about/). |
| Finished film | Grant describes Manim as a way to make individual clips and recommends traditional video editing for final assembly and narration. | Do not turn the browser preview or one giant Manim scene into the whole production system. [Production FAQ](https://www.3blue1brown.com/about/). |
| Teaching | His advice is concrete examples before frameworks, avoiding definitions as an opening, and making every motion reinforce the narration. | Begin with an actual routing problem; reveal the abstraction only after the viewer understands the case. [Teaching advice](https://www.3blue1brown.com/about/). |
| Assets | Manim is MIT, but Grant’s video scene repository is **CC BY-NC-SA 4.0**. | Study the techniques and make original scenes, graphics, and narration. [Repository license distinction](https://github.com/3b1b/videos). |

The transferable quality is **visual reasoning**, rather than a dark background or moving
text. Our interpretation: keep a ticket, evidence packet, or decision visible while its
meaning changes, instead of replacing each idea with another labeled box.

## Evaluation of our 7:30 storyboard

**Good:** the need comes before names; the human analogy is independent of Pi; architecture
comes before code; System Two returns to System One; Pi extensions and connected MCPs are
explicitly preserved; state and business meaning stay with developer code.

**Needs work:** the HTML mainly uses three boxes, four opacity/arrow reveals, and scene-local
redraws. The same visual pattern serves several different ideas. Equal quarters of a scene
drive reveals; integration cards cycle in equal fractions. There is no narration track or
word-level timing. These are source-inspection findings, not a review of a completed film.

| Scene | Concrete shortcoming | Proposed visual repair |
| --- | --- | --- |
| 1–2, problem/value | Broad examples and benefits dominate; there is little specific tension or viewer participation. | Open on **“Charged twice”** with three possible teams. Let the viewer choose, then show that a correct label still has to become a confirmed assignment. Keep other domains as tiny reuse cues. |
| 3, human intuition | “Study / try / feedback” labels describe practice without showing learning. | Route three similar tickets. Show one initial mistake, supervisor correction, and the next familiar case taking fewer visible reasoning steps. Then introduce an unfamiliar case. Clearly mark this as human learning; no automatic model training claim. |
| 4, AI models | Choice, Noul, confidence, a second model, and the efficiency motivation arrive together. | Start with **Choice** only: the same ticket becomes probability bars and a selected category. Then reveal a single yes/no **Noul**. Keep the confidence caveat as a short label. Show a longer investigation path schematically; measured speed/cost remains pending. |
| 5–6, build/reuse | “Machinery” remains a named box. Pi/Turbo introductions are fairly verbal. | Unfold that box into execution, results, records, and helper handover. Move those already-understood pieces into a Pi foundation; add Turbo’s decision driver above it. Put other extensions and MCP tools alongside Turbo in the shared Pi environment. |
| 7, high-level flow | Narration changes the ticket to an ambiguous case; the renderer still shows the routine ticket. Arrows show topology more than execution. | Animate the routine ticket to assignment and a real receipt. Replace it with the ambiguous variant. Send an evidence request to the helper, show two permitted reads, and return an evidence packet to the next judgment. This is the central **aha** scene. |
| 8–9, responsibilities/setup | Multiple new boundaries plus configuration terminology at high narration density. | Zoom the previous working flow into three ownership bands. Place only the current operation in each band. Then connect one existing Pi/MCP tool visibly; explain helper access as a selected subset. |
| 10, functions | Six code cards in 65 seconds compete with diagram and explanation. | In the main film show **prepare facts/questions → map answer → register integration** as three compact blocks. Highlight one value traveling from input to exact tool arguments. Put complete criteria/state helpers in the companion reference. |
| 11, help/state | Three more code cards, business state, helper scope, and session/control ownership share 35 seconds. | Focus on one consultation object and a before/after evidence capsule. The capsule re-enters the same `prepareTurn` seam. Keep the full grants/retention functions in the reference. |
| 12, close | Another verbal list of responsibilities. | Return to the opening ticket stream, now handled through the established paths. Keep one line: **Your logic + Pi capabilities + Turbo’s decision flow**. |

Local count: **1,036 narration words / 450 seconds = 138 words/minute** overall. Scene 8 is
**172 wpm**, scene 9 **163 wpm**; scene 10 has **130 words plus six cards**. The average fits,
but the densest material has the least space for looking and thinking. Trim roughly 40–70
words from the late setup/ownership/closing passages or reallocate time; then measure actual
audio. This is an editorial recommendation, not a universal speaking-speed standard.

## People and workflows worth studying

This shortlist is ordered by relevance and strength of evidence. It is not a global “top
creators” ranking. A tool creator, an educational animator, and an AI demo author demonstrate
different kinds of expertise.

| Person | Verified tools/process | Why relevant / limitation |
| --- | --- | --- |
| **Grant Sanderson** | ManimGL, Sublime, interactive checkpoints, rendered clips. [Source and workflow](https://github.com/3b1b/videos#workflow). | Primary reference for the craft and production loop. A library install alone does not reproduce the pedagogy. |
| **Jacob / aarthificial** | Created **Motion Canvas** to support his programming videos. [First-person explanation](https://github.com/sponsors/aarthificial), [video source examples](https://github.com/motion-canvas/examples). | A close fit for narrated developer concepts and causal vector animation. This is not evidence of an AI workflow. |
| **Jonny Burger** | **Remotion + Claude Code**; public animation source, skill, captions script, render commands, and a linked X demonstration. [Source project](https://github.com/JonnyBurger/vibe-coded-video), [X link](https://x.com/JNYBGR/status/2013313893683085703), [public prompting session](https://gist.github.com/JonnyBurger/5b801182176f1b76447901fbeb5a84ac). | Strong code-plus-AI evidence; the session shows iterative typography/layout/preview work. It establishes a workflow, not 3b1b-equivalent teaching quality. |
| **Adithya S K** | Authored **Manim agent skills**, with separate CE/GL guides and a demo MP4. [Own repository](https://github.com/adithya-s-k/manim_skill), [discovered X demonstration](https://x.com/adithya_s_k/status/2014426458475966649). | Useful AI implementation guidance. Repository/demo verified; sustained educational-video quality was not independently assessed. |
| **Josh Pigford** | Remotion’s official showcase attributes the Presscut demo to **Claude Code + Opus 4.5**, using React UI components and a planning prompt. [Official example and prompt](https://www.remotion.dev/prompts/product-demo-for-presscut), [discovered X post](https://x.com/Shpigford/status/2015250030815584647). | Good product-demo integration example; not a mathematical explanation benchmark. |
| **Benjamin Hackl** | Manim Community maintainer, workshops and internals teaching. [Own site](https://benjamin-hackl.at/), [workshop](https://benjamin-hackl.at/downloads/talks/2021-10-07-manimworkshop/). | Good CE learning reference; the linked workshop is from 2021, so verify code against current official APIs. |

**X evidence boundary:** direct X bodies were inaccessible during research. Jonny’s exact
X URL is linked by his own repository. Adithya’s and Josh’s URLs were discovered through
indexed mirrors and their tool claims corroborated by the creator’s repo or official
showcase. Do not treat reposts, claimed production time, or social popularity as independently
verified quality evidence. No finished-video leaderboard was established.

## Skills and tool choices

| Priority / choice | Use it for | Alternative and tradeoff |
| --- | --- | --- |
| **1. manim-composer** | Plan the hook, conceptual gap, persistent objects, and visual payoff **before writing animation code**. [Skill source](https://raw.githubusercontent.com/adithya-s-k/manim_skill/main/skills/manim-composer/SKILL.md). | Our installed `show-me`/`explain-visually` help with compact diagrams, but do not provide a full rendered-film workflow. |
| **2. manimce-best-practices** | Implement the existing CE starter using the correct engine’s scene, transform, timing, and layout APIs. [Skill source](https://raw.githubusercontent.com/adithya-s-k/manim_skill/main/skills/manimce-best-practices/SKILL.md). | Use `manimgl-best-practices` only if switching deliberately to Grant’s engine. Do not mix `manim` and `manimlib` examples. |
| **Manim Community** | Precise geometric transformations, probability charts, and reusable programmatic scenes. Grant’s suggested starting point; current docs inspected show **0.21.0**. [Official installation](https://docs.manim.community/en/stable/installation.html). | **ManimGL** has Grant’s interactive checkpoint workflow; greater investment in that particular engine. Both can draw our diagrams. |
| **Remotion + official agent skills** | Port browser/SVG/code layouts to React, compose audio/captions, preview and render. [Official skills](https://www.remotion.dev/docs/ai/skills). | Particularly efficient if retaining existing visuals. Rebuild animation as frame-driven code: current CSS transitions and wall-clock playback are not the render pipeline. [Animation rule](https://www.remotion.dev/docs/animating-properties). |
| **Motion Canvas** | Build the narrated developer animation around vector objects and audio time events. [Purpose](https://motion-canvas.io/docs/), [time events](https://motion-canvas.io/docs/time-events/). | Strong fit for this subject if starting the animated scenes afresh; no need to introduce an additional engine alongside Manim or Remotion. |
| **Audacity + Shotcut + FFmpeg** | Free recording/cleanup; final clip/narration edit, captions, export and technical inspection. [Audacity](https://www.audacityteam.org/), [Shotcut features](https://www.shotcut.org/features/). | A conventional edit keeps final pacing easy to change. Do not require a paid narration API. |

The Manim skill repo is **MIT**. Installation/star counts are adoption signals, not quality
scores; current source must still be checked against the chosen API. Remotion’s skills are
official, but the engine’s free license applies to individuals/companies of **up to three
people**; collaboration/company use at four or more requires a paid license. [Current
Remotion licensing](https://www.remotion.dev/docs/license/pricing).

Current local inventory, inspected during this task: Apple Silicon `arm64`; Python, Node,
`uv`, `ffmpeg`, and `ffprobe` available. Manim, LaTeX, MLX, and MLX-Audio were absent in the
active environment. Relevant installed skills include show-me, codebase-design,
explain-visually, and research; no dedicated Manim/Remotion/TTS skill was found in the
inspected top-level skill directories. No packages/models were installed for this report.

### Skill adoption check and optional installation

Directory counts inspected **2026-10-08**, rounded snapshots that may change:

| Skill | Publisher / adoption | Source and role |
| --- | --- | --- |
| `manim-composer` | Adithya S K; about **2.2K installs**; shared source repo about **1.1K stars** | [Directory](https://www.skills.sh/adithya-s-k/manim_skill/manim-composer); planning guidance reviewed against source, not an official Grant skill. |
| `manimce-best-practices` | Adithya S K; about **3.5K installs** | [Directory](https://www.skills.sh/adithya-s-k/manim_skill/manimce-best-practices); CE-specific implementation guidance. |
| `remotion-best-practices` | Official Remotion publisher; about **580K installs** | [Directory](https://www.skills.sh/remotion-dev/skills); official umbrella skill if choosing Remotion. |

Popularity is an adoption signal, not a video-quality ranking. These installation commands
are reference instructions and were **not run**:

```bash
npx skills add adithya-s-k/manim_skill --skill manim-composer
npx skills add adithya-s-k/manim_skill --skill manimce-best-practices
# Alternative engine only:
npx skills add remotion-dev/skills
```

## Free local audio on Apple Silicon

**Start with a blind audition of Kokoro and Kitten on the same 30–45-second paragraph.**
Kokoro is the first recommendation for this English explainer; Kitten answers the stronger
“very small” requirement. No quality, latency, or peak-memory comparison was run on this Mac.

| Model | Size and license | Fit / tradeoff |
| --- | --- | --- |
| **Kokoro 82M — recommended audition** | 82M parameters; **352 MB** 8-bit checkpoint repository; Apache-2.0 weights. MLX-Audio supports its presets and speed control. [Original model](https://huggingface.co/hexgrad/Kokoro-82M), [MLX files](https://huggingface.co/mlx-community/Kokoro-82M-8bit/tree/main). | Fits the 500 MB checkpoint budget. First audition for English narration without voice-cloning complexity. Published quality claims are not our listening results. |
| **Kitten 0.8 Nano / Micro** | **15M / 40M**; MLX repositories around **62 / 137 MB**; English, eight voices; Apache-2.0 weights. [Upstream](https://github.com/KittenML/KittenTTS), [support table](https://github.com/Blaizzy/mlx-audio#supported-models). | Both fit. Smaller alternatives; audition articulation, cadence, and technical names. The newer KittenTTS 2 is a different, larger model and not this recommendation. |
| **Qwen3-TTS 0.6B / 1.7B — over budget** | Apache-2.0, MLX support, but the inspected 8-bit core files alone are around **1.29 / 2.39 GB**. [0.6B files](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit/tree/main), [1.7B files](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit/tree/main). | Excluded from the under-500 MB recommendation. The authoritative [release table](https://github.com/QwenLM/Qwen3-TTS#released-models) reserves instruction control for 1.7B CustomVoice/VoiceDesign, not 0.6B. |
| **Record your own voice** | No model or inference fee; Audacity is free/open source. [Recording/editor](https://www.audacityteam.org/). | Strongest control over emphasis and technical pronunciation if you are willing to narrate. A phone or existing microphone is sufficient for a pilot. |

**Parameter count is not download size or peak memory.** Current model-file listings show
Kokoro 8-bit core weights around **289 MB** and the complete checkpoint repository around
**352 MB**, compared with **327 MB** core weights for the default conversion. The model
does not become an 82 MB download merely because the name says 82M/8-bit. Kitten Nano’s
MLX tensors are around **58 MB** and its repository around **62 MB**; Micro’s repository
is around **137 MB**. Model assets and
Python dependencies add more. Inspect the actual files rather than applying an assumed
bits-per-parameter formula. [Kokoro 8-bit files](https://huggingface.co/mlx-community/Kokoro-82M-8bit/tree/main),
[Kitten Nano conversion](https://huggingface.co/mlx-community/kitten-tts-nano-0.8-bf16).

### Source-verified MLX command, not executed

MLX-Audio requires Apple Silicon and Python 3.10 or newer; its runtime is MIT. Put one
paragraph of the approved spoken script in `scene_01.txt`:

```bash
python3 -m venv .venv-narration
source .venv-narration/bin/activate
python -m pip install -U mlx-audio misaki

python -m mlx_audio.tts.generate \
  --model mlx-community/Kokoro-82M-8bit \
  --voice af_heart \
  --lang_code a \
  --speed 1.0 \
  --output_path narration \
  --file_prefix scene_01 \
  --join_audio \
  < scene_01.txt
```

This is the current CLI shape for `narration/scene_01.wav`; first use downloads the model
and required assets. Do not assume initial setup is offline. Kokoro uses Misaki for
phonemes; its English pipeline can use an eSpeak fallback. Kitten separately needs
`phonemizer-fork` and its eSpeak backend. Neither `espeak-ng` nor `espeak` was on this Mac’s
PATH when inspected. Model-specific dependency setup and a successful first synthesis
are still pending. [MLX-Audio installation](https://github.com/Blaizzy/mlx-audio#installation),
[current CLI parser](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/generate.py).

### How narration becomes a timed film

```text
Short narration paragraphs
  → record or synthesize one WAV per paragraph
  → listen; fix names, emphasis, pauses
  → measure durations and mark spoken cues
  → animate the same visual claim at those cues
  → edit clips + voice + captions
  → inspect final movie at normal speed
```

Keep a pronunciation list for **Pi, Jev, MCP, SOS, T42**, numbers, and code names. The spoken
script can use “em see pee” or “ticket forty-two” while on-screen labels keep their exact
spelling. Choose the desired pronunciation of project-specific names; do not let a model
guess silently. Render paragraph chunks, not the whole 7:30 narration in one pass.

The lowest-dependency Manim route is prerecorded WAVs with native
[`Scene.add_sound`](https://docs.manim.community/en/stable/reference/manim.scene.scene.Scene.html#manim.scene.scene.Scene.add_sound),
plus explicit measured animation timings and final editing. **Manim Voiceover** offers
duration trackers, word bookmarks, and a RecorderService. It does **not** make arbitrary
Kokoro WAVs word-aligned automatically or supply a built-in Kokoro service; that requires
an adapter/alignment step. gTTS examples use an online service, so they are not our local
default. [Voiceover workflow](https://voiceover.manim.community/en/stable/quickstart.html).

## Next production decision

1. Refine the central routine/ambiguous-ticket scene into causal motion rather than fades.
2. Audition **Kokoro 82M vs Kitten Nano/Micro** and choose one voice after listening.
3. Render one 30–60-second pilot with measured audio; check whether viewers can explain the
   return from System Two to System One without reading the script.
4. Select one animation engine for the film; then expand the proven pilot to all scenes.

Pending evidence: voice quality and generation speed on this Mac, visual/text readability
in an actual export, narration alignment, and a viewer comprehension pass. The current
browser storyboard and Python starter do not supply that production evidence.
