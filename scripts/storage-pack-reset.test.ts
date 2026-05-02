/**
 * Sanity-check workspace fields after pack-focused resets.
 * Run: `npx tsx scripts/storage-pack-reset.test.ts`
 */
import assert from "node:assert/strict";
import { emptyStudyState } from "../src/lib/storage";

assert.equal(emptyStudyState.activePackId, "");
assert.equal(emptyStudyState.revisionItems.length, 0);
assert.equal(emptyStudyState.reviewSessions.length, 0);
assert.equal(emptyStudyState.practiceQuestions?.length ?? 0, 0);

const afterReplace = {
  ...emptyStudyState,
  activePackId: "ws_demo",
  notesFiles: [],
};
assert.ok(afterReplace.activePackId.startsWith("ws_"));

console.log("storage pack reset sanity test passed.");
