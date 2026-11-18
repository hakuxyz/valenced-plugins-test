import { Dispatcher } from '@valenced/discord/common/flux'
import { DefaultSettings } from './shared'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings } from './shared'

let storage: JsonStorage<Settings> | undefined

export function setStorage(next: JsonStorage<Settings>) {
	storage = next
}

export function currentSettings(): Settings {
	return { ...DefaultSettings, ...(storage?.cache ?? {}) }
}

interface TrackedMessage {
	channelId?: string
	guildId?: string
	deadline: number
}

const tracked = new Map<string, TrackedMessage>()
const MaxTracked = 500
let timer: ReturnType<typeof setInterval> | undefined

function redraw(id: string, info: TrackedMessage) {
	try {
		Dispatcher.dispatch({
			type: 'MESSAGE_UPDATE',
			guildId: info.guildId,
			message: { id, channel_id: info.channelId },
		})
	} catch {}
}

function tick() {
	const now = Date.now()
	for (const [id, info] of tracked) {
		if (info.deadline <= now) tracked.delete(id)
		redraw(id, info)
	}
	if (tracked.size === 0) stopTicker()
}

function ensureTicker() {
	if (timer !== undefined || tracked.size === 0) return
	timer = setInterval(tick, 1000)
}

export function stopTicker() {
	if (timer !== undefined) {
		clearInterval(timer)
		timer = undefined
	}
	tracked.clear()
}

export function trackMessage(
	id: string | undefined,
	channelId: string | undefined,
	guildId: string | undefined,
	deadline: number,
) {
	if (!id) return
	tracked.set(id, { channelId, guildId, deadline })
	if (tracked.size > MaxTracked) {
		const oldest = tracked.keys().next().value
		if (oldest !== undefined) tracked.delete(oldest)
	}
	ensureTicker()
}

export function untrackMessage(id: string | undefined) {
	if (!id) return
	if (tracked.delete(id) && tracked.size === 0) stopTicker()
}
