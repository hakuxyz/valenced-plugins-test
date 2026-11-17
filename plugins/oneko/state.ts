import { DefaultSettings } from './shared'
import type { Settings } from './shared'

export const touch = {
	/** Last touch position in root view coordinates. */
	x: 0,
	y: 0,
	/** Timestamp of the last touch, 0 when there never was one. */
	t: 0,
	/** Whether a finger is currently down. */
	down: false,
}

let getter: () => Settings = () => DefaultSettings

export function setSettingsGetter(fn: () => Settings) {
	getter = fn
}

export function getSettings(): Settings {
	try {
		return { ...DefaultSettings, ...getter() }
	} catch {
		return DefaultSettings
	}
}

export function trackTouch(event: any) {
	try {
		const touches = event?.nativeEvent?.touches
		if (!Array.isArray(touches) || touches.length === 0) return
		const first = touches[0]
		if (typeof first.pageX !== 'number' || typeof first.pageY !== 'number') {
			return
		}
		touch.x = first.pageX
		touch.y = first.pageY
		touch.t = Date.now()
	} catch {}
}
