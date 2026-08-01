import { Hourglass } from "lucide-react";
import { TaskTimer } from "./screens/TaskTimer";

export default function App() {
  return (
    <div className="app">
      <header className="app__bar">
        <Hourglass size={13} strokeWidth={2} />
        tempo
      </header>
      <main className="app__content">
        <TaskTimer />
      </main>
    </div>
  );
}
