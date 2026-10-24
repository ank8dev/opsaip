// Settings › Notifications › Per workspace: everything, approvals only, or muted.

import { View } from 'react-native';
import { useStore } from '../../state/store';
import { useSettings, type Override } from '../../state/settings';
import { T } from '../../theme/theme';
import { Group, Segmented, SheetPage } from '../../components/Sheet';
import { WorkspaceTile } from '../../components/Face';

export default function WorkspaceNotificationsPage() {
  const { spaces } = useStore();
  const { settings, set } = useSettings();
  return (
    <SheetPage style={{ paddingTop: 16 }}>
      <T v="callout" tone="secondary" style={{ paddingHorizontal: 8 }}>
        On top of “What can interrupt me”. Muted workspaces still show up in your morning brief.
      </T>
      {spaces.map((w) => (
        <Group key={w.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 14 }}>
            <WorkspaceTile monogram={w.monogram} size={28} />
            <T v="calloutMedium">{w.name}</T>
          </View>
          <View style={{ padding: 10 }}>
            <Segmented<Override>
              value={settings.overrides[w.id] ?? 'all'}
              options={[['all', 'Everything'], ['approvals', 'Approvals'], ['muted', 'Muted']]}
              onChange={(v) => set('overrides', { ...settings.overrides, [w.id]: v })}
            />
          </View>
        </Group>
      ))}
    </SheetPage>
  );
}
