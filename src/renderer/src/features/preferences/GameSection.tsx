// GameSection - Preferences -> Game: the EverQuest install folder and the Luclin character models.
// The descriptor lives here rather than in PreferencesView for the same reason the other sections'
// do: that file is at the 400-code-line factoring ceiling.

import SportsEsportsIcon from '@mui/icons-material/SportsEsports'
import { EqFolderSetting } from './EqFolderSetting'
import { LuclinModelsSetting } from './LuclinModelsSetting'
import type { PrefSection } from './PreferencesView'

export function gameSection(): PrefSection {
  return {
    id: 'game',
    label: 'Game',
    icon: <SportsEsportsIcon fontSize="small" />,
    items: [
      {
        id: 'eq-folder',
        label: 'EverQuest install folder',
        keywords: 'path directory logs eqlog character detect override install location',
        content: <EqFolderSetting />
      },
      {
        id: 'luclin-models',
        label: 'Luclin character models',
        keywords:
          'luclin models skins character player race races new old classic globalload globalload.txt patchme launcher launchpad play shortcut ogre iksar',
        content: <LuclinModelsSetting />
      }
    ]
  }
}
