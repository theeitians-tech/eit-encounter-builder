import { App, normalizePath, TFile } from "obsidian";
import { BuilderState, avgDamageForAttack } from "./types";
import { EncounterReport } from "./calculations";

const ENCOUNTER_FOLDER = "Encounters";

export async function saveEncounterNote(
	app: App,
	state: BuilderState,
	report: EncounterReport,
	encounterName: string
): Promise<string> {
	const folderPath = normalizePath(ENCOUNTER_FOLDER);
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!folder) {
		await app.vault.createFolder(folderPath);
	}

	const date = new Date().toISOString().slice(0, 10);
	const safeName = encounterName.trim() || "Untitled Encounter";
	const fileName = `Encounter - ${safeName} - ${date}.md`;
	const filePath = normalizePath(`${ENCOUNTER_FOLDER}/${fileName}`);

	const content = renderNote(state, report, safeName, date);

	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
	} else {
		await app.vault.create(filePath, content);
	}

	return filePath;
}

function renderNote(
	state: BuilderState,
	report: EncounterReport,
	name: string,
	date: string
): string {
	const lines: string[] = [];
	lines.push(`# Encounter - ${name}`);
	lines.push(`*Built ${date}*`);
	lines.push("");
	lines.push("## Report");
	lines.push(`- **Party DPR:** ${report.partyDpr}`);
	lines.push(`- **Party Total HP:** ${report.partyTotalHp}`);
	lines.push(`- **Creature-side DPR:** ${report.creatureSideDpr}`);
	lines.push(`- **Creature-side Effective HP:** ${report.creatureSideEffectiveHp}`);
	lines.push(
		`- **Rounds for party to win:** ${report.roundsForPartyToWin ?? "never (0 party DPR)"}`
	);
	lines.push(
		`- **Rounds for creatures to win:** ${
			report.roundsForCreaturesToWin ?? "never (0 creature DPR)"
		}`
	);
	lines.push(`- **Predicted winner:** ${report.winner}`);
	lines.push("");

	lines.push("## Party");
	lines.push(`- **Average AC:** ${state.party.averageAc}`);
	lines.push(`- **Average To-Hit:** +${state.party.averageToHit}`);
	lines.push(`- **Total HP:** ${state.party.totalHp}`);
	lines.push(`- **Average DPR (if every attack hits):** ${state.party.averageDpr}`);
	lines.push("");

	lines.push("## Creatures");
	for (const c of state.creatures) {
		lines.push(
			`- **${c.name}**${c.quantity > 1 ? ` ×${c.quantity}` : ""} — AC ${c.baseAc}${
				c.acBonus >= 0 ? "+" : ""
			}${c.acBonus}, ` +
				`HP ${c.baseHp} each (${c.hpPercent >= 0 ? "+" : ""}${c.hpPercent}%), ` +
				`Resistances ${c.resistances}, Immunities ${c.immunities}`
		);
		for (const a of c.attacks) {
			const sign = a.bonus >= 0 ? "+" : "";
			lines.push(
				`  - ${a.name}: +${a.toHit} to hit, ${a.diceCount}d${a.dieType}${sign}${a.bonus} ` +
					`(avg ${avgDamageForAttack(a).toFixed(1)}), ×${a.count}/round`
			);
		}
	}
	lines.push("");
	lines.push("#AOE");

	return lines.join("\n");
}
