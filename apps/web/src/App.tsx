import { WorkspaceProvider } from './state/workspace';
import { UiProvider } from './state/ui';
import { AppShell } from './components/shell/AppShell';

export function App() {
  return (
    <WorkspaceProvider>
      <UiProvider>
        <AppShell />
      </UiProvider>
    </WorkspaceProvider>
  );
}
