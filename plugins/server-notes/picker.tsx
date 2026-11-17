import { Design } from '@valenced/discord/design'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

const LAYERS = 16
const HUE_SEGMENTS = 36

function clamp01(value: number): number {
	if (value < 0) return 0
	if (value > 1) return 1
	return value
}

export interface Hsv {
	h: number
	s: number
	v: number
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	const c = v * s
	const hp = (((h % 360) + 360) % 360) / 60
	const x = c * (1 - Math.abs((hp % 2) - 1))
	let r = 0
	let g = 0
	let b = 0
	if (hp < 1) [r, g, b] = [c, x, 0]
	else if (hp < 2) [r, g, b] = [x, c, 0]
	else if (hp < 3) [r, g, b] = [0, c, x]
	else if (hp < 4) [r, g, b] = [0, x, c]
	else if (hp < 5) [r, g, b] = [x, 0, c]
	else [r, g, b] = [c, 0, x]
	const m = v - c
	return [r + m, g + m, b + m]
}

export function hsvToHex(h: number, s: number, v: number): string {
	const [r, g, b] = hsvToRgb(h, s, v)
	const toHex = (n: number) =>
		Math.round(clamp01(n) * 255)
			.toString(16)
			.padStart(2, '0')
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function hexToHsv(hex: string): Hsv {
	const match = hex.trim().match(/^#?([a-fA-F0-9]{6})$/)
	if (!match) return { h: 0, s: 1, v: 1 }
	const value = Number.parseInt(match[1], 16)
	const r = ((value >> 16) & 0xff) / 255
	const g = ((value >> 8) & 0xff) / 255
	const b = (value & 0xff) / 255
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const delta = max - min
	let h = 0
	if (delta !== 0) {
		if (max === r) h = ((g - b) / delta) % 6
		else if (max === g) h = (b - r) / delta + 2
		else h = (r - g) / delta + 4
		h *= 60
		if (h < 0) h += 360
	}
	return { h, s: max === 0 ? 0 : delta / max, v: max }
}

function fill(): Record<string, unknown> {
	return { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }
}

interface Props {
	value: string
	onChange: (hex: string) => void
}

/**
 * Hand rolled saturation/value picker with a hue slider.
 * No text input, no Discord action sheet.
 */
export default function ColorPicker({ value, onChange }: Props) {
	const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))
	const [area, setArea] = useState({ w: 0, h: 0 })
	const [barWidth, setBarWidth] = useState(0)
	const lastEmitted = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (value !== lastEmitted.current) setHsv(hexToHsv(value))
	}, [value])

	const apply = (next: Hsv) => {
		const clamped: Hsv = {
			h: ((next.h % 360) + 360) % 360,
			s: clamp01(next.s),
			v: clamp01(next.v),
		}
		const hex = hsvToHex(clamped.h, clamped.s, clamped.v)
		lastEmitted.current = hex
		setHsv(clamped)
		onChange(hex)
	}

	const baseHex = hsvToHex(hsv.h, 1, 1)
	const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v)
	const { w, h } = area

	return (
		<View>
			<View
				style={{
					height: 150,
					borderRadius: 10,
					backgroundColor: baseHex,
					overflow: 'hidden',
				}}
				onLayout={e =>
					setArea({
						w: e.nativeEvent.layout.width,
						h: e.nativeEvent.layout.height,
					})
				}
				onStartShouldSetResponder={() => true}
				onResponderGrant={e => {
					if (!w || !h) return
					const { locationX, locationY } = e.nativeEvent
					apply({
						h: hsv.h,
						s: clamp01(locationX / w),
						v: 1 - clamp01(locationY / h),
					})
				}}
				onResponderMove={e => {
					if (!w || !h) return
					const { locationX, locationY } = e.nativeEvent
					apply({
						h: hsv.h,
						s: clamp01(locationX / w),
						v: 1 - clamp01(locationY / h),
					})
				}}
			>
				<View pointerEvents="none" style={[fill(), { flexDirection: 'row' }]}>
					{Array.from({ length: LAYERS }, (_, i) => (
						<View
							key={`w${i}`}
							style={{
								flex: 1,
								backgroundColor: `rgba(255,255,255,${1 - i / (LAYERS - 1)})`,
							}}
						/>
					))}
				</View>
				<View
					pointerEvents="none"
					style={[fill(), { flexDirection: 'column' }]}
				>
					{Array.from({ length: LAYERS }, (_, i) => (
						<View
							key={`b${i}`}
							style={{
								flex: 1,
								backgroundColor: `rgba(0,0,0,${i / (LAYERS - 1)})`,
							}}
						/>
					))}
				</View>
				<View
					pointerEvents="none"
					style={{
						position: 'absolute',
						left: w ? hsv.s * w - 9 : -20,
						top: w && h ? (1 - hsv.v) * h - 9 : -20,
						width: 18,
						height: 18,
						borderRadius: 9,
						borderWidth: 2.5,
						borderColor: '#ffffff',
						backgroundColor: currentHex,
						shadowColor: '#000000',
						shadowOpacity: 0.45,
						shadowRadius: 3,
						shadowOffset: { width: 0, height: 1 },
						elevation: 3,
					}}
				/>
			</View>

			<View
				style={{
					height: 26,
					marginTop: 12,
					justifyContent: 'center',
				}}
				onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
				onStartShouldSetResponder={() => true}
				onResponderGrant={e => {
					if (!barWidth) return
					apply({
						...hsv,
						h: (clamp01(e.nativeEvent.locationX / barWidth) * 360) % 360,
					})
				}}
				onResponderMove={e => {
					if (!barWidth) return
					apply({
						...hsv,
						h: (clamp01(e.nativeEvent.locationX / barWidth) * 360) % 360,
					})
				}}
			>
				<View
					style={{
						height: 12,
						borderRadius: 6,
						overflow: 'hidden',
						flexDirection: 'row',
					}}
					pointerEvents="none"
				>
					{Array.from({ length: HUE_SEGMENTS }, (_, i) => (
						<View
							key={`h${i}`}
							style={{
								flex: 1,
								backgroundColor: hsvToHex((i / HUE_SEGMENTS) * 360, 1, 1),
							}}
						/>
					))}
				</View>
				<View
					pointerEvents="none"
					style={{
						position: 'absolute',
						left: barWidth ? (hsv.h / 360) * barWidth - 8 : -20,
						top: 5,
						width: 16,
						height: 16,
						borderRadius: 8,
						borderWidth: 2.5,
						borderColor: '#ffffff',
						backgroundColor: hsvToHex(hsv.h, 1, 1),
						shadowColor: '#000000',
						shadowOpacity: 0.45,
						shadowRadius: 3,
						shadowOffset: { width: 0, height: 1 },
						elevation: 3,
					}}
				/>
			</View>

			<View
				style={{
					flexDirection: 'row',
					alignItems: 'center',
					gap: 8,
					marginTop: 4,
				}}
				pointerEvents="none"
			>
				<View
					style={{
						width: 18,
						height: 18,
						borderRadius: 9,
						backgroundColor: currentHex,
						borderWidth: 1,
						borderColor: 'rgba(255,255,255,0.2)',
					}}
				/>
				<Design.Text variant="text-sm/medium">
					{currentHex.toUpperCase()}
				</Design.Text>
			</View>
		</View>
	)
}
