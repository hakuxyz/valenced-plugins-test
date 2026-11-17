import { Design } from '@valenced/discord/design'
import { useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
	canRedo,
	canUndo,
	channelFor,
	currentSettings,
	redo,
	subscribe,
	undo,
} from './state'

const { Text } = Design

interface Props {
	channelId: string
}

/** Snapshot is a string so React can compare it by value. */
function snapshot(channelId: string) {
	return `${canUndo(channelId) ? 1 : 0}${canRedo(channelId) ? 1 : 0}`
}

function Button({
	label,
	accessibilityLabel,
	disabled,
	onPress,
}: {
	label: string
	accessibilityLabel: string
	disabled: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.button,
				pressed && styles.pressed,
				disabled && styles.disabled,
			]}
		>
			<Text variant="text-sm/semibold" style={styles.glyph}>
				{label}
			</Text>
		</Pressable>
	)
}

/**
 * Small undo and redo pill that floats above the message box.
 * Re-renders whenever the channel history changes.
 */
export default function TypingHistoryPill({ channelId }: Props) {
	const settings = currentSettings()
	const state = useSyncExternalStore(
		subscribe,
		() => snapshot(channelFor(channelId)),
		() => snapshot(channelFor(channelId)),
	)

	const canGoBack = state[0] === '1'
	const canGoForward = state[1] === '1'

	return (
		<View style={styles.pill} pointerEvents="box-none">
			<Button
				label="↶"
				accessibilityLabel="Undo typing"
				disabled={!settings.buttons || !canGoBack}
				onPress={() => undo(channelFor(channelId))}
			/>
			<View style={styles.divider} />
			<Button
				label="↷"
				accessibilityLabel="Redo typing"
				disabled={!settings.buttons || !canGoForward}
				onPress={() => redo(channelFor(channelId))}
			/>
		</View>
	)
}

const styles = StyleSheet.create({
	pill: {
		position: 'absolute',
		right: 4,
		top: -34,
		zIndex: 5,
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#2b2d31',
		borderRadius: 14,
		paddingHorizontal: 2,
		paddingVertical: 2,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: '#1e1f22',
	},
	button: {
		width: 28,
		height: 24,
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 12,
	},
	pressed: {
		backgroundColor: '#3f4147',
	},
	disabled: {
		opacity: 0.35,
	},
	glyph: {
		color: '#dbdee1',
		fontSize: 15,
		lineHeight: 18,
	},
	divider: {
		width: StyleSheet.hairlineWidth,
		height: 14,
		backgroundColor: '#3f4147',
	},
})
