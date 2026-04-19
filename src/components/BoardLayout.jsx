import { tokens } from '../styles/tokens';

const { ink, space } = tokens;

// Canvas that holds the service board grid.
// Drop-in replacement for the inline grid wrapper in App.jsx once that
// refactor lands. Props are intentionally minimal — layout only, no state.
export default function BoardLayout({ children }) {
  return (
    <div style={{
      backgroundColor: ink.bg,
      minHeight: '100vh',
      padding: space[5],
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: space[5],
        alignItems: 'start',
      }}>
        {children}
      </div>
    </div>
  );
}
