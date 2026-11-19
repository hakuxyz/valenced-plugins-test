export type ButtonSize = 'small' | 'normal' | 'large' | 'extraLarge'
export type PillVisibility = 'always' | 'whenAvailable'
/** Where the undo and redo pill sits around the message box. */
export type ButtonPosition = 'right' | 'center' | 'left'

/** Valid positions, also used to discard stale stored values. */
export const ButtonPositions: ButtonPosition[] = ['right', 'center', 'left']

export interface Settings {
	/** Show the undo and redo pill next to the message box. */
	buttons: boolean
	/** Two finger tap to undo, two finger hold or double tap to redo. */
	gestures: boolean
	/** Size of the undo and redo buttons. */
	size: ButtonSize
	/** Show the pill permanently or only when there is something to undo or redo. */
	pillVisibility: PillVisibility
	/** Horizontal position of the pill relative to the message box. */
	position: ButtonPosition
}

export const DefaultSettings: Settings = {
	buttons: true,
	gestures: true,
	size: 'normal',
	pillVisibility: 'whenAvailable',
	position: 'right',
}
