import { currentSettings, redo, undo } from './state'

/** Longest two finger touch that still counts as a tap (undo). */
const TAP_MAX_MS = 400
/** Two finger touch length after which it counts as a hold (redo). */
const HOLD_MS = 550
/** Gap between two single taps that counts as a double tap (redo). */
const DOUBLE_TAP_MS = 300
/** How far a touch may travel and still count as a tap. */
const MOVE_TOLERANCE = 24
/** Grace period after a rejected claim in which the next tap undoes. */
const REJECT_GRACE_MS = 400

let channelGetter: () => string = () => ''

/** Tells the gesture layer which channel the message box currently shows. */
export function setGestureChannelGetter(fn: () => string) {
	channelGetter = fn
}

const attached = new WeakSet<object>()

function touchCount(event: any): number {
	const touches = event?.nativeEvent?.touches
	return Array.isArray(touches) ? touches.length : 0
}

function firstTouch(event: any): any {
	const touches = event?.nativeEvent?.touches
	return Array.isArray(touches) ? touches[0] : undefined
}

function run(channelId: string, action: 'undo' | 'redo') {
	try {
		if (action === 'undo') undo(channelId)
		else redo(channelId)
	} catch {}
}

/**
 * Adds the two finger tap / hold and double tap handlers to the message box
 * row. The row claims the responder for two finger touches so it receives the
 * direct responder events; single finger taps fall back to capture phase
 * heuristics so normal typing is never stolen.
 */
export function attachGestures(props: any) {
	if (!props || typeof props !== 'object' || attached.has(props)) return
	attached.add(props)

	const enabled = () => {
		try {
			return currentSettings().gestures
		} catch {
			return true
		}
	}

	const prevCaptureStart = props.onStartShouldSetResponderCapture
	const prevCaptureMove = props.onMoveShouldSetResponderCapture
	const prevGrant = props.onResponderGrant
	const prevMove = props.onResponderMove
	const prevEnd = props.onResponderEnd
	const prevRelease = props.onResponderRelease
	const prevReject = props.onResponderReject
	const prevTerminate = props.onResponderTerminate

	/** Set when the row itself owns the responder for a two finger touch. */
	let active = false
	let startAt = 0
	let startX = 0
	let startY = 0
	/** Set when a two finger start was seen but the claim got rejected. */
	let rejectedAt = 0
	/** Timestamp of the last single finger start, for double tap detection. */
	let lastSingleStart = 0
	/** Two finger start seen while we were not the responder. */
	let pendingTwoFinger = 0
	/**
	 * Set only when our own capture handler claimed the responder for a two
	 * finger touch. Single finger taps never set it, so the grant/release
	 * handlers below stay completely inert for normal interaction.
	 */
	let claimed = false

	const resolvePending = (now: number) => {
		if (pendingTwoFinger === 0) return false
		if (now - pendingTwoFinger > REJECT_GRACE_MS) {
			pendingTwoFinger = 0
			return false
		}
		pendingTwoFinger = 0
		run(channelGetter(), 'undo')
		return true
	}

	props.onStartShouldSetResponderCapture = (event: any) => {
		let result: any
		try {
			if (typeof prevCaptureStart === 'function') {
				result = prevCaptureStart(event)
			}
		} catch {}

		try {
			if (!enabled()) {
				claimed = false
				return result
			}

			const count = touchCount(event)
			const now = Date.now()

			if (count >= 2) {
				claimed = true
				active = true
				startAt = now
				lastSingleStart = 0
				pendingTwoFinger = 0
				const touch = firstTouch(event)
				startX = touch?.pageX ?? 0
				startY = touch?.pageY ?? 0
				// Claiming makes this row the responder, so the direct
				// responder events below fire for the rest of the gesture.
				return true
			}

			// Only a two finger touch may leave a pending claim behind.
			claimed = false

			if (count === 1) {
				// A rejected two finger claim: the next tap undoes instead.
				if (rejectedAt !== 0 && now - rejectedAt < REJECT_GRACE_MS) {
					rejectedAt = 0
					run(channelGetter(), 'undo')
					lastSingleStart = 0
					return result
				}

				if (lastSingleStart !== 0 && now - lastSingleStart < DOUBLE_TAP_MS) {
					lastSingleStart = 0
					run(channelGetter(), 'redo')
					return result
				}

				lastSingleStart = now
			}
		} catch {}

		return result
	}

	props.onMoveShouldSetResponderCapture = (event: any) => {
		let result: any
		try {
			if (typeof prevCaptureMove === 'function') {
				result = prevCaptureMove(event)
			}
		} catch {}

		try {
			if (!enabled()) {
				claimed = false
				return result
			}

			const count = touchCount(event)
			const now = Date.now()

			if (count >= 2 && !active) {
				// We never became responder, remember the gesture so the
				// next tap or move can still resolve it.
				claimed = true
				if (pendingTwoFinger === 0) pendingTwoFinger = now
				return true
			}

			if (count < 2 && pendingTwoFinger !== 0) resolvePending(now)
		} catch {}

		return result
	}

	props.onResponderGrant = (event: any) => {
		try {
			if (typeof prevGrant === 'function') prevGrant(event)
		} catch {}

		try {
			if (!enabled()) {
				claimed = false
				return
			}
			// Only a claim made by our own two finger capture activates the
			// gesture. Grants that arrive for normal single finger taps (focus
			// the input, press a button) must stay completely inert.
			if (claimed) {
				active = true
				startAt = Date.now()
				const touch = firstTouch(event)
				startX = touch?.pageX ?? 0
				startY = touch?.pageY ?? 0
			} else {
				active = false
			}
			claimed = false
		} catch {}
	}

	props.onResponderMove = (event: any) => {
		try {
			if (typeof prevMove === 'function') prevMove(event)
		} catch {}
		// Movement only matters for deciding tap versus drag, tracked in end.
	}

	props.onResponderEnd = (event: any) => {
		try {
			if (typeof prevEnd === 'function') prevEnd(event)
		} catch {}

		try {
			if (!enabled() || !active) return
			// Another finger is still down, keep waiting for the release.
			if (touchCount(event) > 0) return
			finish(event)
		} catch {}
	}

	props.onResponderRelease = (event: any) => {
		try {
			if (typeof prevRelease === 'function') prevRelease(event)
		} catch {}

		try {
			if (!enabled() || !active) return
			finish(event)
		} catch {}
	}

	props.onResponderReject = (event: any) => {
		try {
			if (typeof prevReject === 'function') prevReject(event)
		} catch {}

		try {
			active = false
			// The grace undo only applies to our own rejected two finger
			// claim, never to rejections of normal single finger taps.
			if (claimed) rejectedAt = Date.now()
			claimed = false
		} catch {}
	}

	props.onResponderTerminate = (event: any) => {
		try {
			if (typeof prevTerminate === 'function') prevTerminate(event)
		} catch {}

		try {
			active = false
			claimed = false
		} catch {}
	}

	function finish(event: any) {
		active = false
		claimed = false
		const now = Date.now()
		const duration = now - startAt

		const touch = firstTouch(event) ?? event?.nativeEvent?.changedTouches?.[0]
		const dx = (touch?.pageX ?? startX) - startX
		const dy = (touch?.pageY ?? startY) - startY
		if (Math.hypot(dx, dy) > MOVE_TOLERANCE) return

		const channel = channelGetter()
		if (duration >= HOLD_MS) run(channel, 'redo')
		else if (duration <= TAP_MAX_MS) run(channel, 'undo')
	}
}
