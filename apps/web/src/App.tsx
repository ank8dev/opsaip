import { WorkspaceProvider, useWorkspace } from './state/workspace';
import { UiProvider } from './state/ui';
import { AppShell } from './components/shell/AppShell';
import { ConnectScreen } from './components/connect/ConnectScreen';

/** Without a server connection the app is the Connect screen: no sample data for users. */
function Gate() {
  const { source } = useWorkspace();
  return source.status === 'disconnected' ? <ConnectScreen /> : <AppShell />;
}

export function App() {
  return (
    <WorkspaceProvider>
      <UiProvider>
        <Gate />
      </UiProvider>
    </WorkspaceProvider>
  );
}
