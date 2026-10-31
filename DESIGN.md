# Ghost In The Script v1.5.0: design direction

The workspace uses a clean, quiet layout with a light theme by default and a navy dark theme. The original ghost logo and its blue accent remain the visual identity.

## Layout

- A left sidebar holds the logo, navigation (Scripts, Settings, Hotkeys, Appearance, About), New script and Import file, the searchable script list, and a footer with the author credit, version and the light/dark switch.
- The editor is a rounded card with the script title and word count in its header, a copy icon to duplicate the script, then Save As and Delete beside them, a formatting toolbar, and a footer with the save state on the left (a spinning ring while saving, then a bold green Saved!) and a bare eye / pencil icon on the right that switches between the formatted preview and the text.
- The Present panel on the right starts with the Start Prompting button and its hotkey, then playback progress, three scrolling-mode cards, plain speed and text size sliders (the same as in Settings), Show Prompter and Minimise to Tray, and a Recording Protection switch (green when on, red when off). It scrolls on its own.
- The prompter stays closed at launch. The first time it opens, three tips appear in turn ("Tip 1 of 3"), each pointing at and pulsing what it's about: the drag handle (with the window edges outlined), the Click Through switch, and the reading guide. The last two have a blue Settings button, which opens that Settings tab in the main window, next to a plain Got It.
- Settings and shortcut sheets remain available on demand. Settings slides in from the right on a soft page colour, with a pill tab switcher (Text, Colours, Voice, Window, Hotkeys). Each tab is split into titled groups, each on its own card with thin lines between rows: for example Font, Layout, Spacing and Outline on the Text tab, and Recording, Prompter Window and While Prompting on the Window tab.

## Prompter toolbar

The prompter's hover toolbar uses icons over small labels: Play, Previous and Next line, Speed with minus and plus, a Scrolling mode menu, a Click Through switch, a light/dark Theme button, Controls, Help and Close. Previous and next arrows also float at the sides while the toolbar shows, and the timer reads elapsed / total. A dotted handle hangs under the toolbar as the place to grab to move the prompter, and the first-run tip points at it. Narrower prompters drop the labels first, then less-used buttons, so the toolbar always fits. The Theme button swaps the prompter's text, background, cue, highlight, guide and outline colours between a light palette (the default for new installs) and a navy dark one.

## Themes and typography

Light mode uses white and pale cool surfaces throughout, including the welcome screen, dialogs, settings, and error messages. Dark mode uses deep navy surfaces with muted blue dividers and brighter text. Blue connects both themes to the logo; green marks the glowing Start Prompting button and recording protection, and gold denotes cues or warnings.

The switch remembers the theme locally and updates the Windows title bar. Changing the controls theme preserves the user's separately configured teleprompter text, colours, and opacity. Segoe UI supplies the working typography; the logo wordmark retains Fredoka.

## Interaction

Buttons change colour on hover and show a focus ring only while moving around with Tab. There's no press or bounce effect when clicking. Selection remains visible on scripts, scroll modes, settings tabs, and segmented controls. The prompting button changes its label, icon, and colour while running. Disabled buttons remain muted. Reduced-motion preferences disable animated feedback.

The welcome screen retains the author credit and ghost transition. The footer keeps the author and GitHub link reachable. Recording protection, shortcuts, voice scrolling, script editing, and importing retain their existing behaviour.
