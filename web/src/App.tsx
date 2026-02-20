import AppRouter from "./router/AppRouter";
import PerformanceMonitor from "./components/PerformanceMonitor";
import { ActiveGameProvider } from "./context/ActiveGameContext";

function App() {
  return (
    <ActiveGameProvider>
      <AppRouter />
      <PerformanceMonitor />
    </ActiveGameProvider>
  );
}

export default App;
