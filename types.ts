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

export interface PartyStats {
	averageAc: number;
	totalHp: number;
	averageDpr: number;
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
	party: PartyStats;
	creatures: EncounterCreature[];
}

export function emptyBuilderState(): BuilderState {
	return {
		party: { averageAc: 15, totalHp: 100, averageDpr: 20 },
		creatures: [],
	};
}

export function newId(): string {
	return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
