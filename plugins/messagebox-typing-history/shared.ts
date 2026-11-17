export type ButtonSize = 'small' | 'normal' | 'large' | 'extraLarge'

export interface Settings {
	/** Show the undo and redo pill next to the message box. */
	buttons: boolean
	/** Two finger tap to undo, two finger hold or double tap to redo. */
	gestures: boolean
	/** Size of the undo and redo buttons. */
	size: ButtonSize
}

export const DefaultSettings: Settings = {
	buttons: true,
	gestures: true,
	size: 'normal',
}
