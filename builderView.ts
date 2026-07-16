import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { BuilderStore } from "./state";
import {
	CreatureAttack,
	DieType,
	EncounterCreature,
	PartyMember,
	avgDamageForAttack,
	newId,
} from "./types";
import { getBestiaryFiles, getPlayerFiles } from "./vaultIndex";
import { parseCreature, parsePlayerSheet } from "./parser";
import { averagePartyAcFromMembers, buildReport } from "./calculations";
import { saveEncounterNote } from "./saveEncounter";

export const VIEW_TYPE_BUILDER = "eit-encounter-builder-view";

const DIE_TYPES: DieType[] = [4, 6, 8, 10, 12, 20];

export class BuilderView extends ItemView {
	store: BuilderStore;
	unsubscribe: (() => void) | null = null;

	private partyCardsEl: HTMLElement | null = null;
	private creatureCardsEl: HTMLElement | null = null;
	private reportEl: HTMLElement | null = null;
	private encounterNameInput: HTMLInputElement | null = null;
	private acInput: HTMLInputElement | null = null;

	private playerFiles: TFile[] = [];
	private bestiaryFiles: TFile[] = [];

	constructor(leaf: WorkspaceLeaf, store: BuilderStore) {
		super(leaf);
		this.store = store;
	}

	getViewType(): string {
		return VIEW_TYPE_BUILDER;
	}

	getDisplayText(): string {
		return "Encounter Builder";
	}

	getIcon(): string {
		return "swords";
	}

	async onOpen() {
		this.playerFiles = getPlayerFiles(this.app);
		this.bestiaryFiles = getBestiaryFiles(this.app);
		this.buildLayout();
		this.unsubscribe = this.store.subscribe(() => this.renderDynamic());
		this.renderDynamic();
	}

	async onClose() {
		if (this.unsubscribe) this.unsubscribe();
	}

	private buildLayout() {
		const container = this.contentEl;
		container.empty();
		container.addClass("eit-eb-view");

		const toolbar = container.createDiv({ cls: "eit-eb-toolbar" });
		this.encounterNameInput = toolbar.createEl("input", {
			attr: { type: "text", placeholder: "Encounter name..." },
			cls: "eit-eb-name-input",
		});
		const saveBtn = toolbar.createEl("button", { text: "Save as Note" });
		saveBtn.onclick = () => this.handleSave();

		const resetBtn = toolbar.createEl("button", {
			text: "Reset",
			cls: "eit-eb-danger-btn",
		});
		resetBtn.onclick = () => this.handleReset();

		const split = container.createDiv({ cls: "eit-eb-split" });

		const partyPanel = split.createDiv({ cls: "eit-eb-panel" });
		partyPanel.createEl("h3", { text: "Party" });

		const acRow = partyPanel.createDiv({ cls: "eit-eb-ac-row" });
		acRow.createEl("label", { text: "Average Party AC:" });
		this.acInput = acRow.createEl("input", {
			attr: { type: "number", style: "width: 4em;" },
		});
		this.acInput.value = String(this.store.state.partyAverageAc);
		acRow.createEl("span", {
			text: "(auto-set from added players' AC — edit freely to override)",
			cls: "eit-eb-hint",
		});
		this.acInput.onchange = () => {
			const val = parseInt(this.acInput!.value, 10);
			this.store.update((s) => {
				if (!isNaN(val)) s.partyAverageAc = val;
			});
		};

		this.buildPlayerSearch(partyPanel);
		this.partyCardsEl = partyPanel.createDiv({ cls: "eit-eb-cards" });

		const creaturePanel = split.createDiv({ cls: "eit-eb-panel" });
		creaturePanel.createEl("h3", { text: "Creatures" });
		this.buildCreatureSearch(creaturePanel);
		this.creatureCardsEl = creaturePanel.createDiv({ cls: "eit-eb-cards" });

		this.reportEl = container.createDiv({ cls: "eit-eb-report" });
	}

	private buildPlayerSearch(panel: HTMLElement) {
		const searchWrap = panel.createDiv({ cls: "eit-eb-search-wrap" });
		const searchInput = searchWrap.createEl("input", {
			attr: { type: "text", placeholder: "Search #PC notes..." },
			cls: "eit-it-search",
		});
		const listEl = searchWrap.createDiv({ cls: "eit-it-dropdown-list" });

		const renderList = () => {
			listEl.empty();
			const term = searchInput.value.trim().toLowerCase();
			const filtered = this.playerFiles.filter((f) =>
				f.basename.toLowerCase().includes(term)
			);
			if (filtered.length === 0) {
				listEl.createDiv({
					text: term ? "No matching players." : "No #PC notes found.",
					cls: "eit-it-dropdown-empty",
				});
				return;
			}
			for (const file of filtered) {
				const row = listEl.createDiv({ cls: "eit-it-dropdown-item" });
				row.createEl("span", { text: file.basename, cls: "eit-it-dropdown-name" });
				const addBtn = row.createEl("button", { text: "Add" });
				addBtn.onclick = async () => {
					const content = await this.app.vault.read(file);
					const parsed = parsePlayerSheet(content, file.path);
					const member: PartyMember = {
						id: newId(),
						name: parsed.name,
						sourcePath: file.path,
						currentHp: parsed.currentHp ?? 1,
						ac: parsed.ac ?? 10,
						abilityMod: 3,
						proficiencyBonus: parsed.proficiencyBonus ?? 2,
						magicBonus: 0,
						damageDiceAvg: 5,
						attacksPerRound: 1,
					};
					this.store.update((s) => {
						s.partyMembers.push(member);
						this.recomputeAverageAc(s);
					});
					const missing: string[] = [];
					if (parsed.ac === null) missing.push("AC");
					if (parsed.proficiencyBonus === null) missing.push("Proficiency Bonus");
					new Notice(
						`Added ${member.name}.` +
							(missing.length
								? ` Couldn't find ${missing.join("/")} on the sheet — using a default, check the card.`
								: " Fill in the remaining offense stats.")
					);
					row.addClass("eit-it-dropdown-item-added");
				};
			}
		};

		searchInput.oninput = renderList;
		renderList();
	}

	private buildCreatureSearch(panel: HTMLElement) {
		const searchWrap = panel.createDiv({ cls: "eit-eb-search-wrap" });
		const searchInput = searchWrap.createEl("input", {
			attr: { type: "text", placeholder: "Search #bestiary notes..." },
			cls: "eit-it-search",
		});
		const listEl = searchWrap.createDiv({ cls: "eit-it-dropdown-list" });

		const renderList = () => {
			listEl.empty();
			const term = searchInput.value.trim().toLowerCase();
			const filtered = this.bestiaryFiles.filter((f) =>
				f.basename.toLowerCase().includes(term)
			);
			if (filtered.length === 0) {
				listEl.createDiv({
					text: term ? "No matching creatures." : "No #bestiary notes found.",
					cls: "eit-it-dropdown-empty",
				});
				return;
			}
			for (const file of filtered) {
				const row = listEl.createDiv({ cls: "eit-it-dropdown-item" });
				row.createEl("span", { text: file.basename, cls: "eit-it-dropdown-name" });
				const addBtn = row.createEl("button", { text: "Add" });
				addBtn.onclick = async () => {
					const content = await this.app.vault.read(file);
					const parsed = parseCreature(content, file.path);
					const creature: EncounterCreature = {
						id: newId(),
						name: parsed.name,
						sourcePath: parsed.sourcePath,
						baseAc: parsed.ac ?? 10,
						baseHp: parsed.hp ?? 1,
						attacks: parsed.attacks,
						acBonus: 0,
						hpPercent: 0,
						resistances: 0,
						immunities: 0,
					};
					this.store.update((s) => s.creatures.push(creature));
					new Notice(
						`Added ${creature.name} with ${parsed.attacks.length} attack(s) parsed. ` +
							`Double-check counts against Multiattack — free-text parsing is best-effort.`
					);
					row.addClass("eit-it-dropdown-item-added");
				};
			}
		};

		searchInput.oninput = renderList;
		renderList();
	}

	private recomputeAverageAc(s: { partyMembers: PartyMember[]; partyAverageAc: number }) {
		const avg = averagePartyAcFromMembers(s.partyMembers);
		if (avg !== null) {
			s.partyAverageAc = avg;
			if (this.acInput) this.acInput.value = String(avg);
		}
	}

	private renderDynamic() {
		if (!this.partyCardsEl || !this.creatureCardsEl || !this.reportEl) return;

		this.partyCardsEl.empty();
		for (const member of this.store.state.partyMembers) {
			this.renderPartyCard(this.partyCardsEl, member);
		}

		this.creatureCardsEl.empty();
		for (const creature of this.store.state.creatures) {
			this.renderCreatureCard(this.creatureCardsEl, creature);
		}

		if (this.acInput) this.acInput.value = String(this.store.state.partyAverageAc);

		this.renderReport();
	}

	private renderReport() {
		if (!this.reportEl) return;
		this.reportEl.empty();

		const report = buildReport(
			this.store.state.partyMembers,
			this.store.state.partyAverageAc,
			this.store.state.creatures
		);

		this.reportEl.createEl("h3", { text: "Report" });
		const grid = this.reportEl.createDiv({ cls: "eit-eb-report-grid" });

		this.reportStat(grid, "Party DPR", String(report.partyDpr));
		this.reportStat(grid, "Party Total HP", String(report.partyTotalHp));
		this.reportStat(grid, "Creature-side DPR", String(report.creatureSideDpr));
		this.reportStat(grid, "Creature-side Effective HP", String(report.creatureSideEffectiveHp));
		this.reportStat(
			grid,
			"Rounds for Party to Win",
			report.roundsForPartyToWin === null ? "—" : String(report.roundsForPartyToWin)
		);
		this.reportStat(
			grid,
			"Rounds for Creatures to Win",
			report.roundsForCreaturesToWin === null ? "—" : String(report.roundsForCreaturesToWin)
		);

		const winnerEl = this.reportEl.createDiv({ cls: "eit-eb-winner" });
		winnerEl.addClass(`eit-eb-winner-${report.winner}`);
		const label =
			report.winner === "party"
				? "Party wins"
				: report.winner === "creatures"
				? "Creatures win"
				: report.winner === "tie"
				? "Too close to call"
				: "Add combatants to both sides";
		winnerEl.setText(label);
	}

	private reportStat(grid: HTMLElement, label: string, value: string) {
		const cell = grid.createDiv({ cls: "eit-eb-report-stat" });
		cell.createDiv({ text: label, cls: "eit-eb-report-label" });
		cell.createDiv({ text: value, cls: "eit-eb-report-value" });
	}

	private renderPartyCard(container: HTMLElement, member: PartyMember) {
		const card = container.createDiv({ cls: "eit-eb-card" });

		const header = card.createDiv({ cls: "eit-eb-card-header" });
		header.createEl("span", { text: member.name, cls: "eit-eb-card-name" });
		const removeBtn = header.createEl("button", { text: "×", cls: "eit-it-remove-btn" });
		removeBtn.onclick = () => {
			this.store.update((s) => {
				s.partyMembers = s.partyMembers.filter((m) => m.id !== member.id);
				this.recomputeAverageAc(s);
			});
		};

		const fields = card.createDiv({ cls: "eit-eb-fields" });

		this.numberField(fields, "HP", member.currentHp, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.currentHp = val;
			});
		});
		this.numberField(fields, "AC", member.ac, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.ac = val;
				this.recomputeAverageAc(s);
			});
		});
		this.numberField(fields, "Ability Mod", member.abilityMod, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.abilityMod = val;
			});
		});
		this.numberField(fields, "Proficiency", member.proficiencyBonus, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.proficiencyBonus = val;
			});
		});
		this.numberField(fields, "Magic Bonus", member.magicBonus, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.magicBonus = val;
			});
		});
		this.numberField(fields, "Dmg Dice Avg", member.damageDiceAvg, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.damageDiceAvg = val;
			});
		});
		this.numberField(fields, "Attacks/Round", member.attacksPerRound, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.attacksPerRound = val;
			});
		});

		const toHit = member.abilityMod + member.proficiencyBonus + member.magicBonus;
		card.createDiv({
			text: `To-hit: +${toHit}`,
			cls: "eit-eb-derived",
		});
	}

	private renderCreatureCard(container: HTMLElement, creature: EncounterCreature) {
		const card = container.createDiv({ cls: "eit-eb-card" });

		const header = card.createDiv({ cls: "eit-eb-card-header" });
		header.createEl("span", { text: creature.name, cls: "eit-eb-card-name" });
		const removeBtn = header.createEl("button", { text: "×", cls: "eit-it-remove-btn" });
		removeBtn.onclick = () => {
			this.store.update((s) => {
				s.creatures = s.creatures.filter((c) => c.id !== creature.id);
			});
		};

		card.createDiv({
			text: `Base AC ${creature.baseAc} · Base HP ${creature.baseHp}`,
			cls: "eit-eb-derived",
		});

		this.sliderField(card, "AC Bonus", creature.acBonus, -5, 10, 1, `${creature.baseAc}`, (val) => {
			this.store.mutateQuiet((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.acBonus = val;
			});
			this.renderReport();
		});

		const hpValueLabel = (percent: number) => {
			const effective = Math.round(creature.baseHp * (1 + percent / 100));
			return `${percent >= 0 ? "+" : ""}${percent}% → ${effective} HP`;
		};
		const hpSlider = this.sliderField(
			card,
			"HP",
			creature.hpPercent,
			-50,
			100,
			5,
			hpValueLabel(creature.hpPercent),
			(val) => {
				this.store.mutateQuiet((s) => {
					const c = s.creatures.find((x) => x.id === creature.id);
					if (c) c.hpPercent = val;
				});
				hpSlider.valueEl.setText(hpValueLabel(val));
				this.renderReport();
			}
		);

		const toggleRow = card.createDiv({ cls: "eit-eb-toggle-row" });
		this.stepperField(toggleRow, "Resistances", creature.resistances, (val) => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.resistances = Math.max(0, val);
			});
		});
		this.stepperField(toggleRow, "Immunities", creature.immunities, (val) => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.immunities = Math.max(0, val);
			});
		});

		// ---- Editable attack list ----
		const attacksWrap = card.createDiv({ cls: "eit-eb-attacks" });
		attacksWrap.createEl("div", { text: "Attacks", cls: "eit-eb-attacks-header" });

		for (const attack of creature.attacks) {
			this.renderAttackRow(attacksWrap, creature, attack);
		}

		const addAttackBtn = attacksWrap.createEl("button", {
			text: "+ Add Attack",
			cls: "eit-eb-add-attack-btn",
		});
		addAttackBtn.onclick = () => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) {
					c.attacks.push({
						id: newId(),
						name: "New Attack",
						toHit: 5,
						diceCount: 1,
						dieType: 6,
						bonus: 0,
						count: 1,
					});
				}
			});
		};
	}

	private renderAttackRow(container: HTMLElement, creature: EncounterCreature, attack: CreatureAttack) {
		const row = container.createDiv({ cls: "eit-eb-attack-row" });

		const nameInput = row.createEl("input", {
			attr: { type: "text" },
			cls: "eit-eb-attack-name",
		});
		nameInput.value = attack.name;
		nameInput.onchange = () => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a) a.name = nameInput.value;
			});
		};

		const toHitWrap = row.createDiv({ cls: "eit-eb-attack-field" });
		toHitWrap.createEl("label", { text: "+hit" });
		const toHitInput = toHitWrap.createEl("input", { attr: { type: "number" } });
		toHitInput.value = String(attack.toHit);
		toHitInput.onchange = () => {
			const val = parseInt(toHitInput.value, 10);
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a && !isNaN(val)) a.toHit = val;
			});
		};

		const diceWrap = row.createDiv({ cls: "eit-eb-attack-field" });
		diceWrap.createEl("label", { text: "dice" });
		const countInput = diceWrap.createEl("input", {
			attr: { type: "number", min: "1", style: "width: 3em;" },
		});
		countInput.value = String(attack.diceCount);
		countInput.onchange = () => {
			const val = parseInt(countInput.value, 10);
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a && !isNaN(val)) a.diceCount = Math.max(1, val);
			});
		};

		const dieSelect = diceWrap.createEl("select");
		for (const d of DIE_TYPES) {
			const opt = dieSelect.createEl("option", { text: `d${d}`, attr: { value: String(d) } });
			if (d === attack.dieType) opt.selected = true;
		}
		dieSelect.onchange = () => {
			const val = parseInt(dieSelect.value, 10) as DieType;
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a) a.dieType = val;
			});
		};

		const bonusWrap = row.createDiv({ cls: "eit-eb-attack-field" });
		bonusWrap.createEl("label", { text: "+bonus" });
		const bonusInput = bonusWrap.createEl("input", {
			attr: { type: "number", style: "width: 3.5em;" },
		});
		bonusInput.value = String(attack.bonus);
		bonusInput.onchange = () => {
			const val = parseInt(bonusInput.value, 10);
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a && !isNaN(val)) a.bonus = val;
			});
		};

		const countPerRoundWrap = row.createDiv({ cls: "eit-eb-attack-field" });
		countPerRoundWrap.createEl("label", { text: "×/round" });
		const countPerRoundInput = countPerRoundWrap.createEl("input", {
			attr: { type: "number", min: "0", style: "width: 3em;" },
		});
		countPerRoundInput.value = String(attack.count);
		countPerRoundInput.onchange = () => {
			const val = parseInt(countPerRoundInput.value, 10);
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a && !isNaN(val)) a.count = Math.max(0, val);
			});
		};

		row.createDiv({
			text: `avg ${avgDamageForAttack(attack).toFixed(1)}`,
			cls: "eit-eb-attack-avg",
		});

		const removeBtn = row.createEl("button", { text: "×", cls: "eit-it-remove-btn" });
		removeBtn.onclick = () => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.attacks = c.attacks.filter((a) => a.id !== attack.id);
			});
		};
	}

	private numberField(
		container: HTMLElement,
		label: string,
		value: number,
		onChange: (val: number) => void
	) {
		const wrap = container.createDiv({ cls: "eit-eb-field" });
		wrap.createEl("label", { text: label });
		const input = wrap.createEl("input", { attr: { type: "number" } });
		input.value = String(value);
		input.onchange = () => {
			const val = parseFloat(input.value);
			if (!isNaN(val)) onChange(val);
		};
	}

	private sliderField(
		container: HTMLElement,
		label: string,
		value: number,
		min: number,
		max: number,
		step: number,
		initialValueText: string,
		onChange: (val: number) => void
	): { valueEl: HTMLElement } {
		const wrap = container.createDiv({ cls: "eit-eb-slider-field" });
		const labelRow = wrap.createDiv({ cls: "eit-eb-slider-label-row" });
		labelRow.createEl("span", { text: label });
		const valueEl = labelRow.createEl("span", {
			text: initialValueText,
			cls: "eit-eb-slider-value",
		});

		const slider = wrap.createEl("input", {
			attr: { type: "range", min: String(min), max: String(max), step: String(step) },
		});
		slider.value = String(value);
		slider.oninput = () => {
			const val = parseFloat(slider.value);
			onChange(val);
		};

		return { valueEl };
	}

	private stepperField(
		container: HTMLElement,
		label: string,
		value: number,
		onChange: (val: number) => void
	) {
		const wrap = container.createDiv({ cls: "eit-eb-stepper-field" });
		wrap.createEl("span", { text: label });
		const minusBtn = wrap.createEl("button", { text: "-" });
		const valueEl = wrap.createEl("span", { text: String(value), cls: "eit-eb-stepper-value" });
		const plusBtn = wrap.createEl("button", { text: "+" });

		let current = value;
		minusBtn.onclick = () => {
			current = Math.max(0, current - 1);
			valueEl.setText(String(current));
			onChange(current);
		};
		plusBtn.onclick = () => {
			current += 1;
			valueEl.setText(String(current));
			onChange(current);
		};
	}

	private async handleSave() {
		const name = this.encounterNameInput?.value.trim() || "Untitled Encounter";
		const report = buildReport(
			this.store.state.partyMembers,
			this.store.state.partyAverageAc,
			this.store.state.creatures
		);
		try {
			const path = await saveEncounterNote(this.app, this.store.state, report, name);
			new Notice(`Saved encounter to ${path}`);
		} catch (err) {
			new Notice(`Couldn't save encounter: ${(err as Error).message}`);
		}
	}

	private handleReset() {
		if (!confirm("Clear the entire encounter builder? This can't be undone.")) return;
		this.store.update((s) => {
			s.partyMembers = [];
			s.creatures = [];
			s.partyAverageAc = 15;
		});
	}
}
