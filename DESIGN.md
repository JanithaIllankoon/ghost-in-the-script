# Ghost In The Script v1.5.0: design direction

The workspace uses a clean, quiet layout with a light theme by default and a navy dark theme. The original ghost logo and its blue accent remain the visual identity.

## Layout

- A left sidebar holds the logo, navigation (Scripts, Settings, Hotkeys, Appearance, About), New script and Import file, the searchable script list, and a footer with the author credit, version and the light/dark switch.
- The editor is a rounded card with the script title and word count in its header, Duplicate, Save and Delete beside them, a formatting toolbar, and a footer with the word count and save state.
- The Present panel on the right starts with the Start prompting button and its hotkey, then playback progress, three scrolling-mode cards, speed and text size sliders, a sentence-by-sentence Preview & test, Show prompter and Minimise to tray, and a Recording protection switch with its status line. It scrolls on its own.
- Settings and shortcut sheets remain available on demand.

## Prompter toolbar

The prompter's hover toolbar uses icons over small labels: Play, Previous and Next line, Speed with minus and plus, a Scrolling mode menu, a Click-through switch, a light/dark Theme button, Controls, Help and Close. Previous and next arrows also float at the sides while the toolbar shows, and the timer reads elapsed / total. Narrower prompters drop the labels first, then less-used buttons, so the toolbar always fits. The Theme button (and Settings > Colours > Prompter theme) swaps the prompter's text, background, cue, highlight and guide colours between a navy dark palette and a light one.

## Themes and typography

Light mode uses white and pale cool surfaces throughout, including the welcome screen, dialogs, settings, and error messages. Dark mode uses deep navy surfaces with muted blue dividers and brighter text. Blue connects both themes to the logo; green indicates recording protection, and gold denotes cues or warnings.

The switch remembers the theme locally and updates the Windows title bar. Changing the controls theme preserves the user's separately configured teleprompter text, colours, and opacity. Segoe UI supplies the working typography; the logo wordmark retains Fredoka.

## Interaction

Buttons have hover, keyboard focus, pressed, and brief click feedback. Selection remains visible on scripts, scroll modes, settings tabs, and segmented controls. The prompting button changes its label, icon, and colour while running. Disabled buttons remain muted. Reduced-motion preferences disable animated feedback.

The welcome screen retains the author credit and ghost transition. The footer keeps the author and GitHub link reachable. Recording protection, shortcuts, voice scrolling, script editing, and importing retain their existing behaviour.
