import { DefaultSettings } from './shared'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings } from './shared'

export let storage: JsonStorage<Settings> | undefined

export function setStorage(next: JsonStorage<Settings>) {
	storage = next
}

export function currentSettings(): Settings {
	return { ...DefaultSettings, ...(storage?.cache ?? {}) }
}
