import { Dispatcher } from '@valenced/discord/common/flux'

/**
 * Ask Discord to refresh the current user's profile preview.
 * Without this, changing a color only updates the picker state until the
 * profile is fetched again.
 */
export function refreshProfilePreview() {
	void Dispatcher.dispatch({ type: 'USER_SETTINGS_ACCOUNT_SUBMIT_SUCCESS' })
}
