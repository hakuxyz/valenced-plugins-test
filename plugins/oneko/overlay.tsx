import { useEffect, useRef, useState } from 'react'

let activeOverlay: symbol | null = null

function claim(id: symbol): boolean {
	activeOverlay ??= id
	return activeOverlay === id
}

function release(id: symbol) {
	if (activeOverlay === id) activeOverlay = null
}

import { Animated, Image, StyleSheet, View } from 'react-native'
import { SizeValues, SpeedMultipliers } from './shared'
import {
	FRAME_SIZE,
	ONEKO_SHEET_BASE64,
	SHEET_HEIGHT,
	SHEET_WIDTH,
	SPRITE_SETS,
} from './sprites'
import { getSettings, touch } from './state'
import type { SpriteName } from './sprites'

const sheet = { uri: `data:image/png;base64,${ONEKO_SHEET_BASE64}` }

/** How long after the last touch the cat keeps chasing it. */
const FOLLOW_WINDOW = 2500
/** Time without a touch before the cat can fall asleep (when enabled). */
const SLEEP_DELAY = 12000

type Sprite = readonly [number, number]

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Absolutely positioned cat that chases the last touch point.
 * Rendered inside the app root view by the plugin's view patch.
 */
export default function OnekoOverlay() {
	const id = useRef(Symbol('oneko')).current
	const [active, setActive] = useState(() => claim(id))

	const x = useRef(new Animated.Value(-240)).current
	const y = useRef(new Animated.Value(-240)).current
	const pos = useRef({ x: 32, y: 32 })
	const area = useRef({ w: 0, h: 0 })

	const frameCount = useRef(0)
	const idleTime = useRef(0)
	const idleAnimation = useRef<string | null>(null)
	const idleAnimationFrame = useRef(0)
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

	const spriteRef = useRef<Sprite>(SPRITE_SETS.idle[0])
	const sizeRef = useRef(SizeValues.medium)
	const enabledRef = useRef(true)

	const [sprite, setSpriteState] = useState<Sprite>(SPRITE_SETS.idle[0])
	const [size, setSize] = useState(SizeValues.medium)
	const [enabled, setEnabled] = useState(true)

	useEffect(() => {
		if (!active) {
			// Another overlay became active first; try to claim if it released.
			const timer = setInterval(() => {
				if (claim(id)) setActive(true)
			}, 500)
			return () => {
				clearInterval(timer)
				release(id)
			}
		}

		const setSprite = (name: SpriteName, frame: number) => {
			const set = SPRITE_SETS[name] as readonly Sprite[]
			const next = set[frame % set.length]
			if (spriteRef.current[0] === next[0] && spriteRef.current[1] === next[1])
				return
			spriteRef.current = next
			setSpriteState(next)
		}

		const resetIdle = () => {
			idleAnimation.current = null
			idleAnimationFrame.current = 0
		}

		const idle = (canSleep: boolean) => {
			idleTime.current += 1

			if (
				idleTime.current > 10 &&
				Math.floor(Math.random() * 200) === 0 &&
				idleAnimation.current == null
			) {
				const available: string[] = []
				if (canSleep) available.push('sleeping')
				available.push('scratchSelf')
				if (pos.current.x < 32) available.push('scratchWallW')
				if (pos.current.y < 32) available.push('scratchWallN')
				if (area.current.w && pos.current.x > area.current.w - 32)
					available.push('scratchWallE')
				if (area.current.h && pos.current.y > area.current.h - 32)
					available.push('scratchWallS')
				idleAnimation.current = pick(available)
			}

			switch (idleAnimation.current) {
				case 'sleeping':
					if (idleAnimationFrame.current < 8) {
						setSprite('tired', 0)
						break
					}
					setSprite('sleeping', Math.floor(idleAnimationFrame.current / 4))
					if (idleAnimationFrame.current > 192) resetIdle()
					break
				case 'scratchWallN':
				case 'scratchWallS':
				case 'scratchWallE':
				case 'scratchWallW':
				case 'scratchSelf':
					setSprite(
						idleAnimation.current as SpriteName,
						idleAnimationFrame.current,
					)
					if (idleAnimationFrame.current > 9) resetIdle()
					break
				default:
					setSprite('idle', 0)
					return
			}
			idleAnimationFrame.current += 1
		}

		const tick = () => {
			try {
				const settings = getSettings()
				const px = SizeValues[settings.size]
				const speed = 10 * SpeedMultipliers[settings.speed]

				if (sizeRef.current !== px) {
					sizeRef.current = px
					setSize(px)
				}
				if (enabledRef.current !== settings.enabled) {
					enabledRef.current = settings.enabled
					setEnabled(settings.enabled)
				}
				if (!settings.enabled) return

				frameCount.current += 1

				const nowMs = Date.now()
				const hasTouch = touch.t > 0
				const recent = hasTouch && nowMs - touch.t < FOLLOW_WINDOW
				const sleepyIdle =
					settings.sleep && hasTouch && nowMs - touch.t > SLEEP_DELAY

				let mousePosX = pos.current.x
				let mousePosY = pos.current.y
				if (recent) {
					mousePosX = touch.x
					mousePosY = touch.y - px / 2
				} else if (!hasTouch) {
					mousePosX = 16
					mousePosY = area.current.h ? area.current.h - 16 : 160
				}

				const diffX = pos.current.x - mousePosX
				const diffY = pos.current.y - mousePosY
				const distance = Math.sqrt(diffX ** 2 + diffY ** 2)

				if (recent && distance < speed + 8) {
					// Close to the touch point: stay alert/idle, don't jitter.
					setSprite('idle', 0)
					x.setValue(pos.current.x - px / 2)
					y.setValue(pos.current.y - px / 2)
					return
				}

				if (!recent) {
					if (sleepyIdle || !hasTouch) {
						idle(settings.sleep)
						x.setValue(pos.current.x - px / 2)
						y.setValue(pos.current.y - px / 2)
						return
					}
					// Brief pause after touch ended before idling.
					idle(false)
					x.setValue(pos.current.x - px / 2)
					y.setValue(pos.current.y - px / 2)
					return
				}

				idleAnimation.current = null
				idleAnimationFrame.current = 0

				if (idleTime.current > 1) {
					setSprite('alert', 0)
					idleTime.current = Math.min(idleTime.current, 7)
					idleTime.current -= 1
					return
				}

				let direction = ''
				direction = diffY / distance > 0.5 ? 'N' : ''
				direction += diffY / distance < -0.5 ? 'S' : ''
				direction += diffX / distance > 0.5 ? 'W' : ''
				direction += diffX / distance < -0.5 ? 'E' : ''
				setSprite((direction || 'idle') as SpriteName, frameCount.current)

				pos.current.x -= (diffX / distance) * speed
				pos.current.y -= (diffY / distance) * speed

				const w = area.current.w || 360
				const h = area.current.h || 640
				pos.current.x = Math.min(Math.max(px / 2, pos.current.x), w - px / 2)
				pos.current.y = Math.min(Math.max(px / 2, pos.current.y), h - px / 2)

				x.setValue(pos.current.x - px / 2)
				y.setValue(pos.current.y - px / 2)
			} catch {}
		}

		intervalRef.current = setInterval(tick, 100)
		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current)
			release(id)
		}
	}, [active])

	if (!active || !enabled) return null

	const AnimatedView = Animated.View
	const scale = size / FRAME_SIZE
	const [gx, gy] = sprite

	return (
		<View
			pointerEvents="none"
			collapsable={false}
			style={[StyleSheet.absoluteFillObject, { zIndex: 9999 }]}
			onLayout={e => {
				area.current = {
					w: e.nativeEvent.layout.width,
					h: e.nativeEvent.layout.height,
				}
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
					},
					{ transform: [{ translateX: x }, { translateY: y }] },
				]}
			>
				<View style={{ width: size, height: size, overflow: 'hidden' }}>
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
