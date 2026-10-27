# Ghost In The Script v1.5.0: design direction

The workspace uses a clean, quiet layout with a light theme by default and a navy dark theme. The original ghost logo and its blue accent remain the visual identity.

## Layout

- A shared header holds the logo, version, and accessible light/dark switch.
- The script library sits on a soft background, with a filled blue New script action and a quiet Import action.
- The editor is an open writing surface with a compact toolbar, clear title, and word count footer.
- The Present panel is wider, with more space between sections. Its controls scroll independently while the footer stays visible.
- Recording visibility is plain status text with a small indicator. One divider separates it from the Recording settings action below. Other notices also put their actions underneath the message.
- Settings and shortcut sheets remain available on demand.

## Themes and typography

Light mode uses white and pale cool surfaces throughout, including the welcome screen, dialogs, settings, and error messages. Dark mode uses deep navy surfaces with muted blue dividers and brighter text. Blue connects both themes to the logo; green indicates recording protection, and gold denotes cues or warnings.

The switch remembers the theme locally and updates the Windows title bar. Changing the controls theme preserves the user's separately configured teleprompter text, colours, and opacity. Segoe UI supplies the working typography; the logo wordmark retains Fredoka.

## Interaction

Buttons have hover, keyboard focus, pressed, and brief click feedback. Selection remains visible on scripts, scroll modes, settings tabs, and segmented controls. The prompting button changes its label, icon, and colour while running. Disabled buttons remain muted. Reduced-motion preferences disable animated feedback.

The welcome screen retains the author credit and ghost transition. The footer keeps the author and GitHub link reachable. Recording protection, shortcuts, voice scrolling, script editing, and importing retain their existing behaviour.
