import { AbilityScores, CreatureAttack, DieType, ParsedCreature, newId } from "./types";

const ABILITY_HEADER_RE =
	/\|\s*STR\s*\|\s*DEX\s*\|\s*CON\s*\|\s*INT\s*\|\s*WIS\s*\|\s*CHA\s*\|/i;
const ABILITY_CELL_RE = /(-?\d+)\s*\(([+-]\d+)\)/g;

const AC_RE = /\*\*Armor Class\*\*\s*(\d+)/i;
const HP_RE = /\*\*Hit Points\*\*\s*(\d+)/i;
const CURRENT_HP_RE = /\*\*Current HP\*\*\s*(\d+)/i;
const PROFICIENCY_RE = /\*\*Proficiency Bonus\*\*\s*\+?(\d+)/i;
const NAME_RE = /^#\s+(.+)$/m;

const ACTIONS_SECTION_RE = /\*\*\*Actions\*\*\*([\s\S]*?)(?:\*\*\*|$)/i;
const ATTACK_LINE_RE =
	/-\s*\*\*(.+?)\.\*\*[^\n]*?\+(\d+)\s*to hit[^\n]*?\*Hit:\*\s*(?:\d+\s*)?\(?(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?\)?/gi;

const MULTIATTACK_RE = /\*\*Multiattack\.\*\*\s*([^\n]+)/i;
const NUMBER_WORDS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
};
// Matches "two claw attacks", "three with its talons", "one Lullaby's Call
// attack" — broadened to allow apostrophes/hyphens in names and an
// optional "with (its/her/his/their)" filler phrase. Free-text Multiattack
// parsing is inherently best-effort; the UI lets you correct counts
// directly when a statblock's phrasing doesn't match.
const MULTIATTACK_CLAUSE_RE =
	/(\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\d+)\s+(?:with\s+(?:its|her|his|their)\s+)?([a-zA-Z][a-zA-Z'\-\s]*?)\s+attacks?/gi;

export function parseCreature(content: string, sourcePath: string): ParsedCreature {
	const nameMatch = content.match(NAME_RE);
	const name = nameMatch ? nameMatch[1].trim() : sourcePath;

	const acMatch = content.match(AC_RE);
	const ac = acMatch ? parseInt(acMatch[1], 10) : null;

	const hpMatch = content.match(HP_RE);
	const hp = hpMatch ? parseInt(hpMatch[1], 10) : null;

	const abilityScores = parseAbilityScores(content);
	const attacks = parseAttacks(content);

	return { name, ac, hp, abilityScores, attacks, sourcePath };
}

export interface ParsedPlayer {
	name: string;
	ac: number | null;
	currentHp: number | null;
	maxHp: number | null;
	proficiencyBonus: number | null;
}

export function parsePlayerSheet(content: string, sourcePath: string): ParsedPlayer {
	const nameMatch = content.match(NAME_RE);
	const name = nameMatch ? nameMatch[1].trim() : sourcePath;

	const acMatch = content.match(AC_RE);
	const ac = acMatch ? parseInt(acMatch[1], 10) : null;

	const maxHpMatch = content.match(HP_RE);
	const maxHp = maxHpMatch ? parseInt(maxHpMatch[1], 10) : null;

	const currentHpMatch = content.match(CURRENT_HP_RE);
	const currentHp = currentHpMatch ? parseInt(currentHpMatch[1], 10) : maxHp;

	const profMatch = content.match(PROFICIENCY_RE);
	const proficiencyBonus = profMatch ? parseInt(profMatch[1], 10) : null;

	return { name, ac, currentHp, maxHp, proficiencyBonus };
}

function parseAbilityScores(content: string): AbilityScores | null {
	const headerMatch = ABILITY_HEADER_RE.exec(content);
	if (!headerMatch) return null;

	const rest = content.slice(headerMatch.index + headerMatch[0].length);
	const lines = rest.split("\n");

	for (const line of lines) {
		ABILITY_CELL_RE.lastIndex = 0;
		const cells: number[] = [];
		let m: RegExpExecArray | null;
		while ((m = ABILITY_CELL_RE.exec(line)) !== null) {
			cells.push(parseInt(m[2], 10));
		}
		if (cells.length === 6) {
			const [str, dex, con, int, wis, cha] = cells;
			return { str, dex, con, int, wis, cha };
		}
	}
	return null;
}

/**
 * Parses every individual attack line under ***Actions***, keeping the
 * dice count/type/bonus as separate editable fields rather than a flat
 * average — so the UI can let you correct or fully rewrite any attack
 * (die type, count, bonus, attacks/round) when a statblock's phrasing
 * doesn't parse cleanly, or when you just want to test "what if."
 */
function parseAttacks(content: string): CreatureAttack[] {
	const sectionMatch = ACTIONS_SECTION_RE.exec(content);
	if (!sectionMatch) return [];
	const section = sectionMatch[1];

	const attacks: CreatureAttack[] = [];
	ATTACK_LINE_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = ATTACK_LINE_RE.exec(section)) !== null) {
		const name = m[1].trim();
		const toHit = parseInt(m[2], 10);
		const diceCount = parseInt(m[3], 10);
		const dieType = normalizeDieType(parseInt(m[4], 10));
		const modSign = m[5];
		const modVal = m[6] ? parseInt(m[6], 10) : 0;
		const bonus = modSign === "-" ? -modVal : modVal;

		attacks.push({ id: newId(), name, toHit, diceCount, dieType, bonus, count: 1 });
	}

	applyMultiattackCounts(content, attacks);
	return attacks;
}

function normalizeDieType(n: number): DieType {
	const valid: DieType[] = [4, 6, 8, 10, 12, 20];
	return valid.includes(n as DieType) ? (n as DieType) : 6;
}

function applyMultiattackCounts(content: string, attacks: CreatureAttack[]) {
	if (attacks.length === 0) return;

	const maMatch = MULTIATTACK_RE.exec(content);
	if (!maMatch) return; // no Multiattack trait — leave everything at count 1

	const text = maMatch[1];
	const resolvedCounts = new Map<string, number>();

	MULTIATTACK_CLAUSE_RE.lastIndex = 0;
	let clause: RegExpExecArray | null;
	let anyResolved = false;
	while ((clause = MULTIATTACK_CLAUSE_RE.exec(text)) !== null) {
		const rawNum = clause[1].toLowerCase();
		const count = NUMBER_WORDS[rawNum] ?? parseInt(rawNum, 10);
		const namePart = clause[2].trim().toLowerCase();
		if (!count || !namePart) continue;

		const matchedAttack = attacks.find(
			(a) =>
				a.name.toLowerCase().includes(namePart) || namePart.includes(a.name.toLowerCase())
		);
		if (matchedAttack) {
			resolvedCounts.set(matchedAttack.name, count);
			anyResolved = true;
		}
	}

	if (anyResolved) {
		for (const attack of attacks) {
			attack.count = resolvedCounts.get(attack.name) ?? 0;
		}
	}
	// If nothing resolved, leave every attack at its default count of 1 —
	// safest fallback. Always double-check Multiattack counts in the UI
	// against the actual statblock, especially for unusually-phrased ones.
}
