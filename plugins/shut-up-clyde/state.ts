import { DefaultSettings, mergeSettings } from './shared'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings } from './shared'

let storage: JsonStorage<Settings> | undefined

export function setStorage(next: JsonStorage<Settings>) {
	storage = next
}

export function currentSettings(): Settings {
	return mergeSettings(storage?.cache ?? DefaultSettings)
}
