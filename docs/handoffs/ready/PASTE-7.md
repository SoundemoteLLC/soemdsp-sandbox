# PASTE-7: Release loose ends (ship a live update)

Goal: a releasable build. Unfinished features may ship; nothing may be broken or look broken. Same repo rules as before: work on master, commit each item separately, no push, run your own tests, no REAPER. Skip anything git log shows is done. Moth is fixing showstopper bugs in parallel, so check git status first and don't touch files Moth has dirty.

0. Merge the bugfix worktree first (Argi t566u). Moth's showstopper fixes are on branch bugfix/text-keyboard, in the worktree C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox-bugfix (tip 8027fb8d at the time of writing).
   - Check git -C that worktree status. If it has uncommitted changes, stop and ask Argi, because Moth may still be working.
   - Merge bugfix/text-keyboard into master with a normal merge commit (no squash, rebase or force). Resolve conflicts keeping both sides' intent, and report every conflict you resolved.
   - Run the tests the bugfix branch added, plus the full suite, before moving on.
   - Don't delete the branch or the worktree.
1. Envelope faces draw negative amplitude. Faces that draw the curve with |amplitude| should draw it inverted when amplitude is negative, using the signed_gain rule from HP-24. A negative amp must look the way it sounds.
2. Stop-edit outline on plain sliders. Sliders drawn by node-graph-gl-graph.js (PolyBLEP, for example) carry data-gradient-edit="1" but show no outline. Add the one hook to draw the same solid amber outline. MasterBot owns that file: keep the change to that single hook and say so in the commit message.
3. Typing while editing a stop. When a stop is selected, a typed slider value should write into the stop, the same as dragging (one undo step). Outside stop editing, typing writes the base value as now.
4. Two gradients on one param. Sum the offsets in slider (normalized) units, not real units, so the result matches what the sliders show. If this is risky, skip it and say why.
5. Empty Presets page. HP-01 left the 📄 icon opening an empty Presets page. Until the Preset Explorer (PASTE-2) lands, hide the 📄 icon so users don't see an empty page. One switch, easy to undo.
6. Release smoke pass, with fixes for anything it finds:
   - The full test suite passes.
   - Spawn every module from the store: no console errors, the face renders, and audio doesn't go NaN or silent when it shouldn't.
   - Load every factory patch: no console errors, and saved fields survive a save, load and clone round trip.
   - Phone width: no clipped rows on the main pages (🌈, 🧩, module store, G window).
   - Report a short list of anything you found but didn't fix, ranked by how visible it is to a user.

Report: commits per item, what you skipped and why, and a short list for Argi to quickly check after Ctrl+F5.