import { App, TFile, getAllTags } from "obsidian";

export function getBestiaryFiles(app: App): TFile[] {
	return app.vault.getMarkdownFiles().filter((f) => hasTag(app, f, "bestiary"));
}

export function getPlayerFiles(app: App): TFile[] {
	return app.vault.getMarkdownFiles().filter((f) => hasTag(app, f, "PC"));
}

function hasTag(app: App, file: TFile, tag: string): boolean {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return false;
	const tags = getAllTags(cache) ?? [];
	const target = tag.toLowerCase();
	return tags.some((t) => t.replace(/^#/, "").toLowerCase() === target);
}
