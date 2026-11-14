// Patch migrations are one-shot (APP_POLICY §1).
// Convert every stored patch, then delete the migrator in the same change.
// migrateNodeGraphPatchToCurrent stays as an empty hook so the load path
// does not grow a second copy. A future migrator must be run over all patches
// (scripts/migrate_all_patches.js --write) and removed before the next commit
// that keeps it.
//
// Empty since 2026-11-14: the last eight migrators (retired RMS Mono, Pulse
// Train antialiasing / Stretch / Count step, DSF Partials step, ƒ instead of
// BPM, Keyboard face display type, MIDI Lag -> MIDI CC) were run over every
// stored patch and deleted. A patch still in an older format is loaded as it
// is: unknown names are ignored, nothing is translated.

function migrateNodeGraphPatchToCurrent(patch) {
  return patch;
}
