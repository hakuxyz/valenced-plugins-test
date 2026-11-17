import { useEffect, useRef, useState } from 'react'
import { Animated, Image, StyleSheet, View } from 'react-native'
import { SizeValues, SpeedMultipliers } from './shared'
import {
	CAT_IDLE_PNG,
	CAT_SLEEP_PNG,
	CAT_WALK1_PNG,
	CAT_WALK2_PNG,
} from './sprites'
import { getSettings, touch } from './state'

const png = (data: string) => ({ uri: `data:image/png;base64,${data}` })

const FRAMES = {
	idle: png(CAT_IDLE_PNG),
	walk1: png(CAT_WALK1_PNG),
	walk2: png(CAT_WALK2_PNG),
	sleep: png(CAT_SLEEP_PNG),
}

type FrameKey = keyof typeof FRAMES

/** How long after the last touch the cat keeps chasing it. */
const FOLLOW_WINDOW = 1500
/** Idle time before the cat walks home and sleeps. */
const SLEEP_DELAY = 20000
/** Milliseconds per walk step at normal speed. */
const STEP_INTERVAL = 150

/**
 * Absolutely positioned cat that chases the last touch point.
 * Rendered inside the app root view by the plugin's view patch.
 */
export default function OnekoOverlay() {
	const x = useRef(new Animated.Value(-240)).current
	const y = useRef(new Animated.Value(-240)).current
	const flip = useRef(new Animated.Value(1)).current
	const pos = useRef({ x: -240, y: -240 })
	const area = useRef({ w: 0, h: 0 })
	const prev = useRef(0)
	const lastStep = useRef(0)
	const toggled = useRef(false)
	const raf = useRef(0)
	const frameRef = useRef<FrameKey>('idle')
	const sizeRef = useRef(SizeValues.medium)
	const enabledRef = useRef(true)

	const [frame, setFrame] = useState<FrameKey>('idle')
	const [size, setSize] = useState(SizeValues.medium)
	const [enabled, setEnabled] = useState(true)

	useEffect(() => {
		const setFrameKey = (next: FrameKey) => {
			if (frameRef.current === next) return
			frameRef.current = next
			setFrame(next)
		}

		const step = (now: number) => {
			raf.current = requestAnimationFrame(step)
			try {
				const settings = getSettings()
				const dt = prev.current
					? Math.min(0.05, (now - prev.current) / 1000)
					: 0.016
				prev.current = now

				const px = SizeValues[settings.size]
				const speed = SpeedMultipliers[settings.speed]

				if (sizeRef.current !== px) {
					sizeRef.current = px
					setSize(px)
				}
				if (enabledRef.current !== settings.enabled) {
					enabledRef.current = settings.enabled
					setEnabled(settings.enabled)
				}
				if (!settings.enabled) return

				const nowMs = Date.now()
				const touched = touch.t > 0 && nowMs - touch.t < FOLLOW_WINDOW
				const sleepy =
					settings.sleep && touch.t > 0 && nowMs - touch.t > SLEEP_DELAY

				let targetX = pos.current.x
				let targetY = pos.current.y
				if (touched) {
					// Sit right above the touch point so the finger does not cover it.
					targetX = touch.x - px / 2
					targetY = touch.y - px
				} else if (sleepy || touch.t === 0) {
					targetX = 16
					targetY = area.current.h ? area.current.h - px - 16 : 160
				}

				const dx = targetX - pos.current.x
				const dy = targetY - pos.current.y
				const dist = Math.sqrt(dx * dx + dy * dy)

				if (dist > 2) {
					const t = Math.min(1, dt * 7 * speed)
					pos.current.x += dx * t
					pos.current.y += dy * t
					x.setValue(pos.current.x)
					y.setValue(pos.current.y)
					if (Math.abs(dx) > 0.5) flip.setValue(dx < 0 ? -1 : 1)

					if (now - lastStep.current > STEP_INTERVAL / speed) {
						lastStep.current = now
						toggled.current = !toggled.current
						setFrameKey(toggled.current ? 'walk1' : 'walk2')
					}
				} else if (sleepy && !touched) {
					x.setValue(pos.current.x)
					y.setValue(pos.current.y)
					setFrameKey('sleep')
				} else {
					x.setValue(pos.current.x)
					y.setValue(pos.current.y)
					setFrameKey('idle')
				}
			} catch {}
		}

		raf.current = requestAnimationFrame(step)
		return () => cancelAnimationFrame(raf.current)
	}, [])

	if (!enabled) return null

	return (
		<View
			pointerEvents="none"
			collapsable={false}
			// Drawn above the screen content, matching the proven overlays.
			style={[StyleSheet.absoluteFillObject, { zIndex: 9999 }]}
			onLayout={e => {
				area.current = {
					w: e.nativeEvent.layout.width,
					h: e.nativeEvent.layout.height,
				}
			}}
		>
			<Animated.View
				style={[
					{
						position: 'absolute',
						left: 0,
						top: 0,
						width: size,
						height: size,
					},
					{
						transform: [{ translateX: x }, { translateY: y }, { scaleX: flip }],
					},
				]}
			>
				<Image
					source={FRAMES[frame]}
					style={{ width: size, height: size }}
					resizeMode="contain"
				/>
			</Animated.View>
		</View>
	)
}
