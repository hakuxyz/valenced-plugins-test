import { Design } from '@valenced/discord/design'
import { useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
	canRedo,
	canUndo,
	channelFor,
	currentSettings,
	lastApplied,
	redo,
	report,
	subscribe,
	undo,
} from './state'
import type { ButtonSize } from './shared'

const { Text } = Design

interface Props {
	channelId: string
}

/** Geometry of the pill for one button size. */
interface Metrics {
	/** Width of a single button. */
	width: number
	/** Height of a single button. */
	height: number
	fontSize: number
	lineHeight: number
	/** Padding of the pill around the buttons. */
	padH: number
	padV: number
	/** Radius of the pill. */
	radius: number
	/** Height of the divider between the buttons. */
	divider: number
}

const METRICS: Record<ButtonSize, Metrics> = {
	small: {
		width: 22,
		height: 18,
		fontSize: 12,
		lineHeight: 14,
		padH: 2,
		padV: 1,
		radius: 11,
		divider: 10,
	},
	normal: {
		width: 28,
		height: 24,
		fontSize: 15,
		lineHeight: 18,
		padH: 2,
		padV: 2,
		radius: 14,
		divider: 14,
	},
	large: {
		width: 34,
		height: 29,
		fontSize: 18,
		lineHeight: 22,
		padH: 3,
		padV: 3,
		radius: 17,
		divider: 18,
	},
	extraLarge: {
		width: 42,
		height: 36,
		fontSize: 22,
		lineHeight: 26,
		padH: 4,
		padV: 4,
		radius: 22,
		divider: 24,
	},
}

/** Gap between the pill and the message box, same for every size. */
const GAP = 6

/** Snapshot is a string so React can compare it by value. */
function snapshot(channelId: string) {
	const settings = currentSettings()
	return `${settings.buttons ? 1 : 0}${settings.gestures ? 1 : 0}${settings.size}${settings.pillVisibility}${canUndo(channelId) ? 1 : 0}${canRedo(channelId) ? 1 : 0}`
}

function Button({
	label,
	accessibilityLabel,
	available,
	onPress,
	metrics,
}: {
	label: string
	accessibilityLabel: string
	/** Whether there is history to act on. The button stays pressable so a
	 * tap always reports what happened. */
	available: boolean
	onPress: () => void
	metrics: Metrics
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			onPress={onPress}
			style={({ pressed }) => [
				styles.button,
				{
					width: metrics.width,
					height: metrics.height,
					borderRadius: metrics.height / 2,
				},
				pressed && styles.pressed,
				!available && styles.disabled,
			]}
		>
			<Text
				variant="text-sm/semibold"
				style={[
					styles.glyph,
					{ fontSize: metrics.fontSize, lineHeight: metrics.lineHeight },
				]}
			>
				{label}
			</Text>
		</Pressable>
	)
}

/**
 * Small undo and redo pill that floats above the message box.
 * Re-renders whenever the channel history or the settings change.
 */
export default function TypingHistoryPill({ channelId }: Props) {
	const settings = currentSettings()
	const metrics = METRICS[settings.size] ?? METRICS.normal
	const state = useSyncExternalStore(
		subscribe,
		() => snapshot(channelFor(channelId)),
		() => snapshot(channelFor(channelId)),
	)

	const canGoBack = state[state.length - 2] === '1'
	const canGoForward = state[state.length - 1] === '1'

	if (
		settings.pillVisibility === 'whenAvailable' &&
		!canGoBack &&
		!canGoForward
	)
		return null

	const run = (action: 'undo' | 'redo') => {
		const channel = channelFor(channelId)
		const ok = action === 'undo' ? undo(channel) : redo(channel)
		report(action, channel, ok, ok ? lastApplied() : undefined)
	}

	return (
		<View
			style={[
				styles.pill,
				{
					top: -(metrics.height + metrics.padV * 2 + GAP),
					borderRadius: metrics.radius,
					paddingHorizontal: metrics.padH,
					paddingVertical: metrics.padV,
				},
			]}
			pointerEvents="box-none"
		>
			<Button
				label="↶"
				accessibilityLabel="Undo typing"
				available={settings.buttons && canGoBack}
				onPress={() => run('undo')}
				metrics={metrics}
			/>
			<View style={[styles.divider, { height: metrics.divider }]} />
			<Button
				label="↷"
				accessibilityLabel="Redo typing"
				available={settings.buttons && canGoForward}
				onPress={() => run('redo')}
				metrics={metrics}
			/>
		</View>
	)
}

const styles = StyleSheet.create({
	pill: {
		position: 'absolute',
		// In line with the message box instead of hanging off its right edge.
		right: 16,
		zIndex: 5,
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#2b2d31',
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: '#1e1f22',
	},
	button: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	pressed: {
		backgroundColor: '#3f4147',
	},
	disabled: {
		opacity: 0.35,
	},
	glyph: {
		color: '#dbdee1',
	},
	divider: {
		width: StyleSheet.hairlineWidth,
		backgroundColor: '#3f4147',
	},
})
