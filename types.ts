export interface AbilityScores {
	str: number;
	dex: number;
	con: number;
	int: number;
	wis: number;
	cha: number;
}

export type DieType = 4 | 6 | 8 | 10 | 12 | 20;

export interface CreatureAttack {
	id: string;
	name: string;
	toHit: number;
	diceCount: number;
	dieType: DieType;
	bonus: number;
	count: number; // how many times per round
}

export function avgDamageForAttack(a: CreatureAttack): number {
	return a.diceCount * ((a.dieType + 1) / 2) + a.bonus;
}

export interface ParsedCreature {
	name: string;
	ac: number | null;
	hp: number | null;
	abilityScores: AbilityScores | null;
	attacks: CreatureAttack[];
	sourcePath: string;
}

export interface PartyMember {
	id: string;
	name: string;
	sourcePath: string | null;
	currentHp: number;
	ac: number;

	// Offense inputs (granular, per your spec)
	abilityMod: number;
	proficiencyBonus: number;
	magicBonus: number;
	damageDiceAvg: number; // e.g. 2d6 -> enter 7
	attacksPerRound: number;
}

export interface EncounterCreature {
	id: string;
	name: string;
	sourcePath: string | null;
	baseAc: number;
	baseHp: number;
	attacks: CreatureAttack[];

	// Sliders / toggles
	acBonus: number; // flat, -5 to +10
	hpPercent: number; // -50 to +100, in steps of 5
	resistances: number; // +100 effective HP each
	immunities: number; // +200 effective HP each
}

export interface BuilderState {
	partyMembers: PartyMember[];
	partyAverageAc: number;
	creatures: EncounterCreature[];
}

export function emptyBuilderState(): BuilderState {
	return { partyMembers: [], partyAverageAc: 15, creatures: [] };
}

export function newId(): string {
	return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
