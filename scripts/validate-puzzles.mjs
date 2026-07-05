// CI-style check: every puzzle in js/puzzles.js must be a real mate-in-one.
// Run with: npm run validate:puzzles
import { PUZZLES, validatePuzzles } from '../js/puzzles.js';

const valid = validatePuzzles();
const validIds = new Set(valid.map((p) => p.id));
const broken = PUZZLES.filter((p) => !validIds.has(p.id));

for (const p of PUZZLES) {
  console.log(`${validIds.has(p.id) ? 'OK  ' : 'FAIL'}  ${p.id.padEnd(16)} ${p.theme}`);
}
console.log(`\n${valid.length}/${PUZZLES.length} puzzles valid.`);

if (broken.length) {
  console.error(`\n${broken.length} broken puzzle(s): ${broken.map((p) => p.id).join(', ')}`);
  process.exit(1);
}
