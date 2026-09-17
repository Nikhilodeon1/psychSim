import { Simulator } from './components/Simulator';

export function App() {
  return (
    <>
      <header className="topbar">
        <h1>Neurotransmitter Mechanism Simulator</h1>
      </header>
      <Simulator />
      <footer className="disclaimer" role="note">
        <svg viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7v4.5M8 4.6v.1" />
        </svg>
        <p>
          Conceptual/educational model of neurotransmitter mechanisms and classification. Not medical guidance. Does not
          represent real dosing, timing, or safety information.
        </p>
      </footer>
    </>
  );
}
