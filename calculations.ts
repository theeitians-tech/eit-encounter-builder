import { EncounterCreature, PartyMember } from "./types";

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

export function memberDpr(member: PartyMember, targetAc: number): number {
	const toHit = member.abilityMod + member.proficiencyBonus + member.magicBonus;
	const avgDamagePerHit = member.damageDiceAvg + member.abilityMod + member.magicBonus;
	const chance = hitChance(toHit, targetAc);
	return member.attacksPerRound * chance * avgDamagePerHit;
}

export function partyDpr(members: PartyMember[], targetAc: number): number {
	return members.reduce((sum, m) => sum + memberDpr(m, targetAc), 0);
}

export function partyTotalHp(members: PartyMember[]): number {
	return members.reduce((sum, m) => sum + m.currentHp, 0);
}

export function creatureEffectiveAc(creature: EncounterCreature): number {
	return creature.baseAc + creature.acBonus;
}

export function creatureEffectiveHp(creature: EncounterCreature): number {
	const scaledHp = creature.baseHp * (1 + creature.hpPercent / 100);
	return scaledHp + creature.resistances * 100 + creature.immunities * 200;
}

export function creatureDpr(creature: EncounterCreature, targetAc: number): number {
	const dmgMultiplier = 1 + creature.dmgPercent / 100;
	return creature.attacks.reduce((sum, attack) => {
		const chance = hitChance(attack.toHit, targetAc);
		return sum + attack.count * chance * attack.avgDamage * dmgMultiplier;
	}, 0);
}

export interface EncounterReport {
	partyDpr: number;
	partyTotalHp: number;
	creatureSideDpr: number;
	creatureSideEffectiveHp: number;
	roundsForPartyToWin: number | null; // null = party can never win (0 DPR)
	roundsForCreaturesToWin: number | null;
	winner: "party" | "creatures" | "tie" | "undetermined";
}

export function buildReport(
	members: PartyMember[],
	partyAc: number,
	creatures: EncounterCreature[]
): EncounterReport {
	const pDpr = partyDpr(members, averageCreatureAc(creatures));
	const pHp = partyTotalHp(members);

	const totalCreatureHp = creatures.reduce((sum, c) => sum + creatureEffectiveHp(c), 0);
	const totalCreatureDpr = creatures.reduce(
		(sum, c) => sum + creatureDpr(c, partyAc),
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

function averageCreatureAc(creatures: EncounterCreature[]): number {
	if (creatures.length === 0) return 10;
	const sum = creatures.reduce((s, c) => s + creatureEffectiveAc(c), 0);
	return sum / creatures.length;
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}
