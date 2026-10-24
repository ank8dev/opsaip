// "+" in the composer: Photo, Camera, File, or mention a connector. Preview only —
// picking adds a sample attachment chip; no photo library or camera is opened.

import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useStore } from '../../state/store';
import { useMotion, usePalette } from '../../theme/theme';
import { enter, exit } from '../../theme/motion';
import { timeOf } from '../../lib/time';
import { Group, Row, SheetPage, SheetTitle, minutesAgo } from '../../components/Sheet';
import { CameraIcon, FileIcon, HashIcon, PhotoIcon } from '../../components/Icons';

const PHOTOS = ['IMG_2041.HEIC', 'IMG_2038.HEIC', 'Screenshot 09.14.png'];
const FILES = ['p95-latency-eu.csv', 'fjord-pilot-notes.pdf', 'trace-0418.json'];

export default function AttachSheet() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { ws, state, attach } = useStore();
  const [connectors, setConnectors] = useState(false);
  const n = state.composer.attachments.length;

  const add = (kind: 'photo' | 'camera' | 'file' | 'connector', label: string) => {
    attach({ kind, label });
    router.back();
  };
  const icon = (node: React.ReactNode) => <View style={{ width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: p.hover }}>{node}</View>;

  return (
    <SheetPage>
      <SheetTitle title="Add to message" sub="Attachments go along with what you send." />
      <Group footer="Preview: picking adds a sample file. The Opsaip server uploads the real thing.">
        <Row icon={icon(<PhotoIcon color={p.text} size={18} />)} title="Photo" sub="From your library" onPress={() => add('photo', PHOTOS[n % PHOTOS.length])} />
        <Row icon={icon(<CameraIcon color={p.text} size={18} />)} title="Camera" sub="Take a photo now" onPress={() => add('camera', `Photo ${timeOf(Date.now())}`)} />
        <Row icon={icon(<FileIcon color={p.text} size={18} />)} title="File" sub="A log, a CSV, a PDF" onPress={() => add('file', FILES[n % FILES.length])} />
        <Row icon={icon(<HashIcon color={p.text} size={18} />)} title="Mention a connector" sub="Point the agent at Linear, GitHub…" chevron open={connectors} onPress={() => setConnectors((o) => !o)} />
        {connectors ? (
          <Animated.View entering={enter(m)} exiting={exit(m)}>
            {ws.connectors.map((c) => (
              <Row key={c.name} icon={<View style={{ width: 32 }} />} title={c.name} sub={`${c.source} · seen ${minutesAgo(c.lastSeen)}`} onPress={() => add('connector', `/${c.name}`)} />
            ))}
          </Animated.View>
        ) : null}
      </Group>
    </SheetPage>
  );
}
