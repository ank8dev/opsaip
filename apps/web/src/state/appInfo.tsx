// What Settings → About and the quiet "Update available" note show: the
// server's versions and the result of its update check. Read when the app is
// live and the update result again every few hours; the server does the check.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { About, UpdateInfo } from '../data/about';
import { useWorkspace } from './workspace';

/** How often the page asks the server for the update result (the server itself checks once a day). */
export const UPDATE_REFRESH_MS = 6 * 60 * 60 * 1000;

interface AppInfoValue {
  about: About | null;
  update: UpdateInfo | null;
}

const AppInfoContext = createContext<AppInfoValue>({ about: null, update: null });

export function AppInfoProvider({ children }: { children: ReactNode }) {
  const { api, readOnly } = useWorkspace();
  const [about, setAbout] = useState<About | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!readOnly) { setAbout(null); setUpdate(null); return; }
    const c = new AbortController();
    void api.about(c.signal).then((r) => { if (!c.signal.aborted && r.ok) setAbout(r.value); });
    const loadUpdate = () => void api.update(c.signal).then((r) => { if (!c.signal.aborted && r.ok) setUpdate(r.value); });
    loadUpdate();
    const timer = window.setInterval(loadUpdate, UPDATE_REFRESH_MS);
    return () => { c.abort(); window.clearInterval(timer); };
  }, [api, readOnly]);

  const value = useMemo(() => ({ about, update }), [about, update]);
  return <AppInfoContext.Provider value={value}>{children}</AppInfoContext.Provider>;
}

export const useAppInfo = () => useContext(AppInfoContext);
