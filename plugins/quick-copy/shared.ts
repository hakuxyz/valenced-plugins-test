export interface CommandInfo {
	command: string
	description: string
}

export const COMMANDS: CommandInfo[] = [
	{
		command: '/uid [user]',
		description: 'Copy your own or another user id.',
	},
	{
		command: '/avatar [user]',
		description: 'Copy your own or another user avatar URL.',
	},
	{
		command: '/channelid',
		description: 'Copy the id of the current channel.',
	},
]
