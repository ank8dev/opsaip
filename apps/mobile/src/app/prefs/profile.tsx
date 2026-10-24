// Settings › Profile: name, avatar, status and working hours.

import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PRESENCE, useSettings, type Presence } from '../../state/settings';
import { T, usePalette } from '../../theme/theme';
import { font } from '../../theme/tokens';
import { clock } from '../../lib/time';
import { Choices, Group, Row, Segmented, SheetPage } from '../../components/Sheet';
import { Face } from '../../components/Face';

const STARTS = [7, 8, 9, 10];
const ENDS = [16, 17, 18, 19];

export default function ProfilePage() {
  const p = usePalette();
  const router = useRouter();
  const { settings, set } = useSettings();
  const pr = settings.profile;
  const [name, setName] = useState(pr.name);
  const save = (patch: Partial<typeof pr>) => set('profile', { ...pr, ...patch });

  return (
    <SheetPage style={{ paddingTop: 16 }}>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Face initials={pr.initials} size={84} on={pr.presence === 'working'} ring={p.bg} />
        <T
          v="label"
          tone="secondary"
          onPress={() => router.push({ pathname: '/desktop', params: { title: 'Photos are set on desktop', text: 'Upload a profile photo in Opsaip on your computer. It shows everywhere your teammates see you.' } })}
        >
          Edit photo
        </T>
      </View>

      <Group title="Name">
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => {
            const n = name.trim() || pr.name;
            save({ name: n, initials: n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() });
          }}
          returnKeyType="done"
          keyboardAppearance={p.scheme}
          selectionColor={p.signal}
          style={{ minHeight: 52, paddingHorizontal: 16, color: p.text, fontFamily: font.sans, fontSize: 16 }}
        />
        <Row title="Email" value={pr.email} />
      </Group>

      <Group title="Status" footer="Teammates see it next to your name. Do not disturb holds everything for the next brief.">
        <View style={{ padding: 6 }}>
          <Segmented value={pr.presence} options={(Object.keys(PRESENCE) as Presence[]).map((k) => [k, PRESENCE[k]])} onChange={(presence) => save({ presence })} />
        </View>
      </Group>

      <Group title="Working hours" footer="Opsaip keeps interruptions inside these hours.">
        <View style={{ padding: 16, gap: 10 }}>
          <T v="caption" tone="muted">Start</T>
          <Choices value={clock(pr.hours.start)} options={STARTS.map((h) => clock(h))} onChange={(o) => save({ hours: { ...pr.hours, start: STARTS.find((h) => clock(h) === o) ?? pr.hours.start } })} />
          <T v="caption" tone="muted" style={{ marginTop: 6 }}>End</T>
          <Choices value={clock(pr.hours.end)} options={ENDS.map((h) => clock(h))} onChange={(o) => save({ hours: { ...pr.hours, end: ENDS.find((h) => clock(h) === o) ?? pr.hours.end } })} />
        </View>
      </Group>
    </SheetPage>
  );
}
