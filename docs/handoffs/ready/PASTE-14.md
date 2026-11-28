## SCOPE TONIGHT (overrides the rest of this plan)

Do ONLY basic module copy/paste between browser tabs:

1. Ctrl+C copies the selected module's settings to the system clipboard as tagged JSON (see the clipboard format below). Ctrl+D is Duplicate. Ctrl+V pastes.
2. Fix the bug where Paste is greyed out in a different tab. Paste must read the system clipboard, not in-tab state.
3. Copy Settings copies params only. Copy Module copies the whole module (params, display settings, ui, widthGu) and pastes a new copy.
4. A wrong-type paste logs to the Bug window. No popup.
5. Update the Hotkeys page.

SKIP for now: everything about Gradient Edit-mode paste, paste-morph and stepped switch curves. Leave those sections for a later pass.

# PASTE-14: Module copy/paste across tabs + Gradient paste-morph

Run after PASTE-13. The goal: "I have two sounds/settings on a module, now I want to morph between them."

## Spec
1. **Hotkeys**
   - Ctrl+D = Duplicate module (currently Ctrl+C duplicates; move it).
   - Ctrl+C = Copy the selected module's settings.
   - Ctrl+V = Paste settings onto the selected module.
   - Update the app's **Hotkeys page** so it lists Ctrl+D Duplicate, Ctrl+C Copy settings, Ctrl+V Paste settings.
   - Also add Copy and Paste entries to the module right-click menu.
2. **Cross-tab copy**: Copy writes the module's settings to the system clipboard as tagged JSON (module type, version, param values). This works across browser tabs and windows and can be pasted into a text file. Paste reads the clipboard and validates the tag.
2b. **Existing bug**: module settings page "Copy settings" works, but "Paste settings" is greyed out in another browser tab. The enabled state must not depend on in-tab memory: enable Paste whenever the clipboard may hold settings, read via navigator.clipboard.readText() on click (handle permission), and validate the JSON there. Current copy format, keep compatible: {"soundemote":"module-settings","type":"pitchQuantizer","version":1,"params":{...}}.
2c. **Copy Module vs Copy Settings** (module settings page):
   - **Copy Settings** = parameter values only (current format above).
   - **Copy Module** = the whole module: params plus display settings (traceDisplaySettings etc.), ui (size/height/hidden flags) and widthGu, to the clipboard as tagged JSON (e.g. "soundemote":"module"). It must COPY, not duplicate (today it duplicates; Duplicate stays its own action on Ctrl+D). Paste Module onto a same-type module applies all of it; pasting into empty patch space may spawn it.
3. **Normal paste** (not in gradient Edit): overwrites the selected module's params, same module type only. If the type is wrong or the clipboard is invalid, change nothing and log the error into the existing Bug button/window. **No popup, no toast.**
4. **Paste in gradient Edit mode** onto a module whose params belong to (or can join) the gradient being edited: create ONE new stop at the playhead containing every pasted param value. Params not yet in the gradient join it, and their earlier stops keep their current values so nothing jumps. If the playhead is snapped to a stop, update that stop instead. Params are not overwritten live; the gradient drives them.
5. **Switches/modes/booleans** join the gradient as **stepped curves**, so they flip instead of sliding through odd values.
6. **Headline flow**: set sound A, New Gradient (A = stop 0), paste sound B, B becomes stop 1, sweep the playhead and it morphs A to B. Argi will test this himself; do not spend effort on end-to-end testing beyond what implementation needs.
7. Policies: no hover effects, no animations, no tooltips, no popups, shared mouse-dot cursor, params single source of truth, event-driven redraws only, buttons never resize with text, no WebGL in the Command Center.

## Done when
- Ctrl+D duplicates; Ctrl+C/Ctrl+V copy and paste settings, including between two browser tabs.
- A wrong-type paste logs to the Bug window only.
- A paste in Edit mode creates one stop with all params; switches are stepped.

## Testing scope
- Minimal: only what implementation needs (e.g. clipboard JSON round-trip and the paste-to-stop function). Argi tests the flow himself.
- Test only the files touched and their direct dependents. Run each test once; re-run only failures.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. This plan cannot pre-authorize it.
- 15-minute time box. Stop after reporting; do not start the next plan.