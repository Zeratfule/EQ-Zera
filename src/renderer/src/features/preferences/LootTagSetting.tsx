// Preferences -> Loot: which tags a loot row wears. The descriptor lives beside its card because
// PreferencesView.tsx sits at the 400-code-line factoring ceiling.

import type { JSX } from 'react'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import { useTradeskillTagPref } from '../loot/lootTagPrefs'
import type { PrefSection } from './PreferencesView'

function TradeskillTagSetting(): JSX.Element {
  const [show, setShow] = useTradeskillTagPref()
  return (
    <Stack spacing={1} data-testid="pref-loot-tags">
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={show}
            data-testid="pref-tradeskill-tag"
            onChange={(e) => setShow(e.target.checked)}
          />
        }
        label={<Typography variant="body2">Show Tradeskill tag on loot</Typography>}
      />
      <Typography variant="caption" color="text.secondary">
        {show
          ? 'Loot used in a tradeskill recipe is tagged tradeskill, alongside its quest and LORE tags.'
          : 'Off. Loot rows show only quest and LORE tags; recipes still appear when you open an item.'}
      </Typography>
    </Stack>
  )
}

export function lootSection(): PrefSection {
  return {
    id: 'loot',
    label: 'Loot',
    icon: <LocalOfferIcon fontSize="small" />,
    items: [
      {
        id: 'tradeskill-tag',
        label: 'Show Tradeskill tag on loot',
        keywords:
          'tradeskill tradeskills crafting crafter craft recipe recipes ingredient component tag tags chip chips badge quest lore loot item items',
        content: <TradeskillTagSetting />
      }
    ]
  }
}
