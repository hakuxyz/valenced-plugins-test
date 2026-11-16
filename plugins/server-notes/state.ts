import { DefaultSettings, hasMeaningfulNote } from './shared'
import type { JsonStorage } from '@valenced/json-storage'
import type { ServerNote, Settings } from './shared'

export let storage: JsonStorage<Settings> | undefined

export function setStorage(next: JsonStorage<Settings>) {
	storage = next
}

export function currentSettings(): Settings {
	return { ...DefaultSettings, ...(storage?.cache ?? {}) }
}

export function getNote(guildId: string): ServerNote | undefined {
	return currentSettings().notes[guildId]
}

export function setNote(guildId: string, note: ServerNote | null) {
	if (!storage) return
	const notes = { ...(storage.cache?.notes ?? {}) }
	if (note && hasMeaningfulNote(note)) {
		notes[guildId] = { color: note.color, note: note.note.trim() }
	} else {
		delete notes[guildId]
	}
	storage.set({ notes })
}

export function setPendingGuildId(guildId: string | null) {
	if (!storage) return
	storage.set({ pendingGuildId: guildId })
}
