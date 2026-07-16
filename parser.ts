import { AbilityScores, CreatureAttack, ParsedCreature } from "./types";

const ABILITY_HEADER_RE =
	/\|\s*STR\s*\|\s*DEX\s*\|\s*CON\s*\|\s*INT\s*\|\s*WIS\s*\|\s*CHA\s*\|/i;
const ABILITY_CELL_RE = /(-?\d+)\s*\(([+-]\d+)\)/g;

const AC_RE = /\*\*Armor Class\*\*\s*(\d+)/i;
const HP_RE = /\*\*Hit Points\*\*\s*(\d+)/i;
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
const MULTIATTACK_CLAUSE_RE =
	/(\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\d+)\s+([a-zA-Z][a-zA-Z\s]*?)\s+attacks?/gi;

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
 * Parses every individual attack line under ***Actions***, computing the
 * average damage from its dice notation directly (the Eit statblock
 * format doesn't include a pre-computed flat average, unlike stock 5e).
 * Then attempts to resolve a Multiattack trait's counts per named attack;
 * falls back to "each parsed attack happens once per round" if that
 * phrasing can't be confidently parsed.
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
		const dieSize = parseInt(m[4], 10);
		const modSign = m[5];
		const modVal = m[6] ? parseInt(m[6], 10) : 0;
		const modifier = modSign === "-" ? -modVal : modVal;

		const avgDamage = diceCount * ((dieSize + 1) / 2) + modifier;

		attacks.push({ name, toHit, avgDamage: round1(avgDamage), count: 1 });
	}

	applyMultiattackCounts(content, attacks);
	return attacks;
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
		// Multiattack explicitly named specific attacks — anything not
		// mentioned isn't part of the standard routine, so it drops to 0.
		for (const attack of attacks) {
			attack.count = resolvedCounts.get(attack.name) ?? 0;
		}
	}
	// If nothing resolved (generic phrasing like "three attacks" with
	// multiple distinct attack types and no name given), leave every
	// attack at its default count of 1 — safest fallback.
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}
