# Ghost In The Script: design direction

Direction came from the owner: the ghost logo and its colour theme, a dark-only controls window, and a request to make the UI simpler. This file records those choices and the reason for each one.

Design Read: a desktop teleprompter (controls window + recording overlay) for people recording lectures in Panopto, in a night-sky storybook language taken from the ghost logo.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1 in the working screens, MOTION 2 for the one-time start screen transition (requested by the owner)

## Palette (sampled from the logo)

| Token | Hex | Logo source | Reason |
|---|---|---|---|
| night | `#050d2e` | corner sky `#000c33` | App background. The deepest logo blue keeps the screen dim while you face a camera. |
| ink / ink-2 / ink-3 | `#0b1847` `#13235e` `#1b2f73` | mid sky `#001c6e` | Surfaces step lighter as they come forward, which replaces most shadows. |
| ghost | `#eef0fb` | ghost body `#ebe8f9` | Main text. 15:1 on ink. |
| mist | `#b7c7fb` | ghost shading `#b7c7fb` | Secondary text and labels. 10:1 on ink. |
| dim | `#8d9fd6` | between mist and sky | Hints and metadata. 6.5:1 on ink. |
| spectral | `#2f6fe8`, light `#7fa8ff` | glow `#0371ff` | The one accent: the start button, the selected item and the focus ring. White on spectral is 4.6:1. |
| gold | `#e9b75f` | pen and book corners | Only for script cues. Cues are notes to yourself, and the gold book is where the ghost keeps its notes. |

Core colours: night/ink (one navy family), ghost white, plus one accent (spectral). Gold is a content colour used only for cue text.

## Decisions

- **Dark only:** the owner chose it. It matches the night-sky logo, and a dim screen avoids glare on your face while recording.
- **Layout, three zones of different widths:** Scripts (choose), Editor (write), Present (record). Each step of the job has one place, so settings no longer crowd the screen.
- **Settings in a drawer:** the old always-open panel of 40+ controls was the main cause of the clutter. The Present panel keeps only what changes per recording (mode, speed, text size). Everything else opens on demand in grouped tabs.
- **One focal point:** the "Start prompting" button. It is the only pill shape and the only glow on the main screen, echoing the glow around the ghost. The start screen has its own single glow, around the logo.
- **Identity motif, the ghost's hem:** the wavy lower edge of the ghost forms the bottom of the brand block, so the app looks like this ghost's app rather than any app.
- **Headings in Fredoka:** its rounded strokes match the ghost's soft outline. It is bundled, so it works offline.
- **Body text in Segoe UI Variable:** it is the native Windows UI font, the most readable choice for a Windows desktop tool, with nothing to load.
- **Radius scale:** 14px panels, 10px buttons, 8px inputs, pill only for the focal button. The variation sets hierarchy.
- **Shadow:** only the settings drawer and dialogs, because they sit above the page. Everything else uses lighter surfaces instead.
- **Icons:** the play/pause glyph, a few filled glyphs on the prompter toolbar (where space is tight), the star on the two GitHub buttons, and the logo. Everything else is labelled with words, because a first-time user should not have to decode icons.
- **Motion:** in the working screens, hover and focus colour changes only, plus a 120ms fade when the drawer opens so you can see where it came from. Turned off under reduced-motion.
- **Start screen:** the owner asked for a full screen that credits them and asks for a GitHub star, with a continue button. The ghost logo is the hero because it is the brand, and "Made by Janitha Illankoon" sits directly under the name so the credit reads as part of the title. Continue is the primary button because getting to work is the main action; Star is secondary.
- **Ghost flight:** on Continue, the logo drifts on a swaying arc to the credit badge and fades slightly mid-flight, so the credit feels like the ghost moved in rather than a banner being added. The badge then pulses twice so your eye follows where it landed. Reduced-motion users get no flight, only the badge highlight.
- **Credit badge:** bottom right, in the always-visible footer of the Present panel, so the credit and the star link are reachable without scrolling and never cover the controls.
- **Star icon:** used only on the two GitHub buttons, because starring is the action GitHub itself draws with a star.
- **Discoverability:** nothing should depend on reading the README.
  - **Status strip:** the Present panel lists anything unusual under the Start button (click-through on, prompter hidden, a hotkey taken by another app, a voice mode waiting for Start) with a one-click fix. It sits below Start so the main action never moves out of view.
  - **One shortcuts sheet:** the same list, built from one source, opens from Ctrl+/ in both windows, a link under Start, and a ? on the prompter toolbar.
  - **One-time tips:** the first time the prompter shows, its toolbar stays up with the edges outlined, and the main window explains where it goes when minimised. Each tip is dismissed once and remembered.
  - **Exits say how to come back:** hiding the prompter, sending the window to the tray and turning on click-through all say which key or button undoes them. Quitting while the script scrolls asks first.
- **Prompter overlay:** night background at 80%, ghost-white text, a light spectral guide and gold cues, so the overlay and the controls look like one product.
