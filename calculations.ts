import { avgDamageForAttack, EncounterCreature, PartyStats } from "./types";

/**
 * Standard 5e hit-chance approximation: roll needed on d20 to hit,
 * clamped so a nat 1 always misses (5% floor) and a nat 20 always hits
 * (95% ceiling).
 */
export function hitChance(toHit: number, targetAc: number): number {
	const needed = targetAc - toHit;
	const chance = (21 - needed) / 20;
	return Math.max(0.05, Math.min(0.95, chance));
}

export function creatureEffectiveAc(creature: EncounterCreature): number {
	return creature.baseAc + creature.acBonus;
}

export function creatureEffectiveHp(creature: EncounterCreature): number {
	const scaledHp = creature.baseHp * (1 + creature.hpPercent / 100);
	return scaledHp + creature.resistances * 25 + creature.immunities * 100;
}

export function creatureDprSingle(creature: EncounterCreature, targetAc: number): number {
	return creature.attacks.reduce((sum, attack) => {
		const chance = hitChance(attack.toHit, targetAc);
		return sum + attack.count * chance * avgDamageForAttack(attack);
	}, 0);
}

/** Quantity-weighted average AC across all creatures — used as the party's target. */
function quantityWeightedAverageAc(creatures: EncounterCreature[]): number {
	const totalQty = creatures.reduce((s, c) => s + c.quantity, 0);
	if (totalQty === 0) return 10;
	const weightedSum = creatures.reduce(
		(s, c) => s + creatureEffectiveAc(c) * c.quantity,
		0
	);
	return weightedSum / totalQty;
}

/**
 * Party's effective DPR: the entered "on-hit" damage, reduced by hit
 * chance against the creatures' (quantity-weighted average) AC — mirrors
 * how creature DPR is calculated, so AC sliders actually move the needle
 * on both sides of the report.
 */
export function partyEffectiveDpr(party: PartyStats, creatures: EncounterCreature[]): number {
	const targetAc = quantityWeightedAverageAc(creatures);
	return party.averageDpr * hitChance(party.averageToHit, targetAc);
}

export interface EncounterReport {
	partyDpr: number;
	partyTotalHp: number;
	creatureSideDpr: number;
	creatureSideEffectiveHp: number;
	roundsForPartyToWin: number | null;
	roundsForCreaturesToWin: number | null;
	winner: "party" | "creatures" | "tie" | "undetermined";
}

export function buildReport(party: PartyStats, creatures: EncounterCreature[]): EncounterReport {
	const pDpr = partyEffectiveDpr(party, creatures);
	const pHp = party.totalHp;

	const totalCreatureHp = creatures.reduce(
		(sum, c) => sum + creatureEffectiveHp(c) * c.quantity,
		0
	);
	const totalCreatureDpr = creatures.reduce(
		(sum, c) => sum + creatureDprSingle(c, party.averageAc) * c.quantity,
		0
	);

	const roundsForPartyToWin = pDpr > 0 ? Math.ceil(totalCreatureHp / pDpr) : null;
	const roundsForCreaturesToWin = totalCreatureDpr > 0 ? Math.ceil(pHp / totalCreatureDpr) : null;

	let winner: EncounterReport["winner"] = "undetermined";
	if (roundsForPartyToWin !== null && roundsForCreaturesToWin !== null) {
		if (roundsForPartyToWin < roundsForCreaturesToWin) winner = "party";
		else if (roundsForCreaturesToWin < roundsForPartyToWin) winner = "creatures";
		else winner = "tie";
	} else if (roundsForPartyToWin !== null) {
		winner = "party";
	} else if (roundsForCreaturesToWin !== null) {
		winner = "creatures";
	}

	return {
		partyDpr: round1(pDpr),
		partyTotalHp: pHp,
		creatureSideDpr: round1(totalCreatureDpr),
		creatureSideEffectiveHp: round1(totalCreatureHp),
		roundsForPartyToWin,
		roundsForCreaturesToWin,
		winner,
	};
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}
