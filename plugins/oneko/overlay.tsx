import { useEffect, useState } from 'react'
import { Animated, Image, StyleSheet, View } from 'react-native'
import { SizeValues, SpeedMultipliers } from './shared'
import {
	FRAME_SIZE,
	ONEKO_SHEETS,
	SHEET_HEIGHT,
	SHEET_WIDTH,
	SPRITE_SETS,
} from './sprites'
import { getSettings, touch } from './state'
import type { SkinKey } from './shared'
import type { SpriteName } from './sprites'

const sheets = Object.fromEntries(
	(Object.keys(ONEKO_SHEETS) as SkinKey[]).map(key => [
		key,
		{ uri: `data:image/png;base64,${ONEKO_SHEETS[key]}` },
	]),
) as Record<SkinKey, { uri: string }>

/** How long after the last touch the cat keeps chasing it. */
const FOLLOW_WINDOW = 2500
/** Time without a touch before the cat can fall asleep (when enabled). */
const SLEEP_DELAY = 12000

type Sprite = readonly [number, number]

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]
}

// Shared animation state so every mounted overlay shows the same cat.
const sharedX = new Animated.Value(-240)
const sharedY = new Animated.Value(-240)
const sharedPos = { x: 32, y: 32 }
const sharedArea = { w: 360, h: 640 }

let frameCount = 0
let idleTime = 0
let idleAnimation: string | null = null
let idleAnimationFrame = 0
let interval: ReturnType<typeof setInterval> | null = null
let listeners = 0

let sharedSprite: Sprite = SPRITE_SETS.idle[0]
let sharedSize = SizeValues.medium
let sharedEnabled = true
let sharedSkin: SkinKey = 'classic'
let sharedSheet = sheets.classic

const subs = new Set<() => void>()

function emit() {
	for (const fn of subs) {
		try {
			fn()
		} catch {}
	}
}

function setSharedSprite(name: SpriteName, frame: number) {
	const set = SPRITE_SETS[name] as readonly Sprite[]
	const next = set[frame % set.length]
	if (sharedSprite[0] === next[0] && sharedSprite[1] === next[1]) return
	sharedSprite = next
	emit()
}

function resetIdle() {
	idleAnimation = null
	idleAnimationFrame = 0
}

function idle(canSleep: boolean) {
	idleTime += 1

	if (
		idleTime > 10 &&
		Math.floor(Math.random() * 200) === 0 &&
		idleAnimation == null
	) {
		const available: string[] = []
		if (canSleep) available.push('sleeping')
		available.push('scratchSelf')
		if (sharedPos.x < 32) available.push('scratchWallW')
		if (sharedPos.y < 32) available.push('scratchWallN')
		if (sharedArea.w && sharedPos.x > sharedArea.w - 32)
			available.push('scratchWallE')
		if (sharedArea.h && sharedPos.y > sharedArea.h - 32)
			available.push('scratchWallS')
		idleAnimation = pick(available.length ? available : ['scratchSelf'])
	}

	switch (idleAnimation) {
		case 'sleeping':
			if (idleAnimationFrame < 8) {
				setSharedSprite('tired', 0)
				break
			}
			setSharedSprite('sleeping', Math.floor(idleAnimationFrame / 4))
			if (idleAnimationFrame > 192) resetIdle()
			break
		case 'scratchWallN':
		case 'scratchWallS':
		case 'scratchWallE':
		case 'scratchWallW':
		case 'scratchSelf':
			setSharedSprite(idleAnimation as SpriteName, idleAnimationFrame)
			if (idleAnimationFrame > 9) resetIdle()
			break
		default:
			setSharedSprite('idle', 0)
			return
	}
	idleAnimationFrame += 1
}

function tick() {
	try {
		const settings = getSettings()
		const px = SizeValues[settings.size]
		const speed = 10 * SpeedMultipliers[settings.speed]
		let changed = false

		if (sharedSize !== px) {
			sharedSize = px
			changed = true
		}
		if (sharedEnabled !== settings.enabled) {
			sharedEnabled = settings.enabled
			changed = true
		}
		if (sharedSkin !== settings.skin) {
			sharedSkin = settings.skin
			sharedSheet = sheets[settings.skin] ?? sheets.classic
			changed = true
		}
		if (changed) emit()
		if (!settings.enabled) return

		frameCount += 1

		const nowMs = Date.now()
		const hasTouch = touch.t > 0
		const recent = hasTouch && nowMs - touch.t < FOLLOW_WINDOW
		const sleepyIdle =
			settings.sleep && hasTouch && nowMs - touch.t > SLEEP_DELAY

		let mousePosX = sharedPos.x
		let mousePosY = sharedPos.y
		if (recent) {
			mousePosX = touch.x
			mousePosY = touch.y - px / 2
		} else if (!hasTouch) {
			mousePosX = 16
			mousePosY = sharedArea.h ? sharedArea.h - 16 : 160
		}

		const diffX = sharedPos.x - mousePosX
		const diffY = sharedPos.y - mousePosY
		const distance = Math.sqrt(diffX ** 2 + diffY ** 2)

		if (recent && distance < speed + 8) {
			idleTime = 0
			setSharedSprite('idle', 0)
			sharedX.setValue(sharedPos.x - px / 2)
			sharedY.setValue(sharedPos.y - px / 2)
			return
		}

		if (!recent) {
			if (sleepyIdle || !hasTouch) {
				idle(settings.sleep)
				sharedX.setValue(sharedPos.x - px / 2)
				sharedY.setValue(sharedPos.y - px / 2)
				return
			}
			idle(false)
			sharedX.setValue(sharedPos.x - px / 2)
			sharedY.setValue(sharedPos.y - px / 2)
			return
		}

		idleAnimation = null
		idleAnimationFrame = 0

		if (idleTime > 1) {
			setSharedSprite('alert', 0)
			idleTime = Math.min(idleTime, 7)
			idleTime -= 1
			return
		}

		let direction = ''
		direction = diffY / distance > 0.5 ? 'N' : ''
		direction += diffY / distance < -0.5 ? 'S' : ''
		direction += diffX / distance > 0.5 ? 'W' : ''
		direction += diffX / distance < -0.5 ? 'E' : ''
		setSharedSprite((direction || 'idle') as SpriteName, frameCount)

		sharedPos.x -= (diffX / distance) * speed
		sharedPos.y -= (diffY / distance) * speed

		const w = sharedArea.w || 360
		const h = sharedArea.h || 640
		sharedPos.x = Math.min(Math.max(px / 2, sharedPos.x), w - px / 2)
		sharedPos.y = Math.min(Math.max(px / 2, sharedPos.y), h - px / 2)

		sharedX.setValue(sharedPos.x - px / 2)
		sharedY.setValue(sharedPos.y - px / 2)
	} catch {}
}

function ensureRunning() {
	if (!interval) interval = setInterval(tick, 100)
}

function stopIfIdle() {
	if (listeners <= 0 && interval) {
		clearInterval(interval)
		interval = null
	}
}

/**
 * Absolutely positioned cat that chases the last touch point.
 * Rendered inside the app root view by the plugin's view patch.
 */
export default function OnekoOverlay() {
	const [sprite, setSprite] = useState(sharedSprite)
	const [size, setSize] = useState(sharedSize)
	const [enabled, setEnabled] = useState(sharedEnabled)
	const [sheet, setSheet] = useState(sharedSheet)

	useEffect(() => {
		const update = () => {
			setSprite(sharedSprite)
			setSize(sharedSize)
			setEnabled(sharedEnabled)
			setSheet(sharedSheet)
		}
		subs.add(update)
		listeners++
		ensureRunning()
		update()
		return () => {
			subs.delete(update)
			listeners--
			stopIfIdle()
		}
	}, [])

	if (!enabled) return null

	const AnimatedView = Animated.View
	const scale = size / FRAME_SIZE
	const [gx, gy] = sprite

	return (
		<View
			pointerEvents="none"
			collapsable={false}
			style={[
				StyleSheet.absoluteFillObject,
				{ zIndex: 2147483647, elevation: 2147483647 },
			]}
			onLayout={e => {
				sharedArea.w = e.nativeEvent.layout.width
				sharedArea.h = e.nativeEvent.layout.height
			}}
		>
			<AnimatedView
				style={[
					{
						position: 'absolute',
						left: 0,
						top: 0,
						width: size,
						height: size,
						zIndex: 2147483647,
						elevation: 2147483647,
					},
					{ transform: [{ translateX: sharedX }, { translateY: sharedY }] },
				]}
			>
				<View
					style={{
						width: size,
						height: size,
						overflow: 'hidden',
						zIndex: 2147483647,
						elevation: 2147483647,
					}}
				>
					<Image
						source={sheet}
						style={{
							width: SHEET_WIDTH * scale,
							height: SHEET_HEIGHT * scale,
							transform: [
								{ translateX: -gx * size },
								{ translateY: -gy * size },
							],
						}}
						resizeMode="stretch"
					/>
				</View>
			</AnimatedView>
		</View>
	)
}
