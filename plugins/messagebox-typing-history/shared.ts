export interface Settings {
	/** Show the undo and redo pill next to the message box. */
	buttons: boolean
	/** Two finger tap to undo, two finger hold or double tap to redo. */
	gestures: boolean
}

export const DefaultSettings: Settings = {
	buttons: true,
	gestures: true,
}
