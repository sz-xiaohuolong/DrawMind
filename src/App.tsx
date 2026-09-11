import { DrawioEditor } from './components/Editor/DrawioEditor';
import { PageTabs } from './components/Editor/PageTabs';
import { AgentPanel } from './components/AgentPanel/AgentPanel';
import { Toolbar } from './components/Toolbar/Toolbar';
import { useDiagramStore } from './store/diagramStore';

// Debug/E2E hook: read-only view of the store from the console/tests.
declare global {
  interface Window {
    __drawmind?: { getState: () => unknown };
  }
}

export default function App() {
  const panelOpen = useDiagramStore((s) => s.panelOpen);

  if (typeof window !== 'undefined') {
    window.__drawmind = { getState: () => useDiagramStore.getState() };
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <main className={`flex min-w-0 flex-col ${panelOpen ? 'w-[70%]' : 'w-full'}`}>
          <div className="min-h-0 flex-1">
            <DrawioEditor />
          </div>
          <PageTabs />
        </main>
        {panelOpen && (
          <section className="w-[30%] min-w-[300px]">
            <AgentPanel />
          </section>
        )}
      </div>
    </div>
  );
}
