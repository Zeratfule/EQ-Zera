// character/share/DiscordShareControls — the two small pieces of the share dialog that are about
// Discord rather than about sharing (owner, 2026-09-11; docs/plans/discord-connect.md).
//
// Their own file because ShareDialog.tsx is AT the repo's 400-code-line factoring ceiling and the
// house answer to that is a split, not a widened threshold. The button itself stays there - it is
// one of the six ways out and belongs in the row with them; what moved is the CHANNEL PICKER and
// the failure row, both of which exist only when Discord is in the picture.

import type { JSX } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import { DiscordChannelPicker, showsSettingsLink } from '../../../lib/discordChannels'
import type { DiscordPostState } from './useDiscordPost'

// The hint the disabled button wears, and the picker it sits beside, are both `lib/discordChannels`'s
// now that a second dialog posts too (2026-09-11). Re-exported so ShareDialog keeps its import.
export { DISCORD_HINT } from '../../../lib/discordChannels'

/** WHICH CHANNEL - the shared picker, wearing the name this dialog's harness looks for. */
export function DiscordChannelPick({ discord }: { discord: DiscordPostState }): JSX.Element | null {
  return <DiscordChannelPicker state={discord} testId="character-share-discord-channel" />
}

/**
 * What went wrong with a Discord post, and - when what went wrong is that nothing is set up yet -
 * the way to go and set it up. The door is offered ONLY for that one sentence: a rate limit or an
 * unreachable Discord is not something Preferences can fix, and a button that pretended otherwise
 * would send the reader somewhere useless.
 */
export function DiscordRow({
  discord,
  onOpenSharingPrefs
}: {
  discord: DiscordPostState
  onOpenSharingPrefs: () => void
}): JSX.Element | null {
  if (discord.error === '') return null
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
      <Typography variant="body2" color="error" data-testid="character-share-discord-error">
        {discord.error}
      </Typography>
      {showsSettingsLink(discord.error) && (
        <Button size="small" data-testid="character-share-discord-settings" onClick={onOpenSharingPrefs}>
          Open Preferences, Sharing
        </Button>
      )}
    </Stack>
  )
}
