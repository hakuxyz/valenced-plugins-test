export type ButtonSize = 'small' | 'normal' | 'large' | 'extraLarge'
export type PillVisibility = 'always' | 'whenAvailable'

export interface Settings {
	/** Show the undo and redo pill next to the message box. */
	buttons: boolean
	/** Two finger tap to undo, two finger hold or double tap to redo. */
	gestures: boolean
	/** Size of the undo and redo buttons. */
	size: ButtonSize
	/** Show the pill permanently or only when there is something to undo or redo. */
	pillVisibility: PillVisibility
}

export const DefaultSettings: Settings = {
	buttons: true,
	gestures: true,
	size: 'normal',
	pillVisibility: 'whenAvailable',
}
