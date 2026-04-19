import React from 'react';
import { createRoot } from 'react-dom/client';
import TableCard from './components/TableCard/TableCard';
import { tokens } from './styles/tokens';

const { ink, font } = tokens;

const SCENARIOS = [
  {
    label: 'Active — mid-service, restrictions',
    props: {
      tableNumber: 3,
      covers: 8,
      seatedAt: '19:42',
      status: 'active',
      courses: 5,
      activeCourse: 2,
      courseName: 'Appetizer',
      courseItem: 'Beef Tartare',
      restrictions: [
        { guest: 'G_A', flags: ['GLUTEN'] },
        { guest: 'G_C', flags: ['DAIRY', 'NUTS'] },
      ],
      actions: [{ label: 'ADVANCE COURSE', onClick: () => {} }, { label: 'FLAG DELAY', onClick: () => {} }],
    },
  },
  {
    label: 'Active — first course, no restrictions',
    props: {
      tableNumber: 7,
      covers: 2,
      seatedAt: '20:15',
      status: 'active',
      courses: 4,
      activeCourse: 1,
      courseName: 'Amuse-Bouche',
      courseItem: 'Oyster Mignonette',
      restrictions: [],
      actions: [{ label: 'ADVANCE COURSE', onClick: () => {} }],
    },
  },
  {
    label: 'Warn — delayed table',
    props: {
      tableNumber: 12,
      covers: 4,
      seatedAt: '19:10',
      status: 'warn',
      courses: 4,
      activeCourse: 3,
      courseName: 'Main',
      courseItem: 'Duck Confit',
      restrictions: [{ guest: 'G_B', flags: ['GLUTEN'] }],
      actions: [{ label: 'NOTIFY KITCHEN', onClick: () => {} }],
    },
  },
  {
    label: 'Done — table completed',
    props: {
      tableNumber: 5,
      covers: 6,
      seatedAt: '18:30',
      status: 'done',
      courses: 4,
      activeCourse: 4,
      courseName: 'Dessert',
      courseItem: 'Crème Brûlée',
      restrictions: [],
      actions: [],
    },
  },
  {
    label: 'Active — final course, multi-restriction',
    props: {
      tableNumber: 9,
      covers: 3,
      seatedAt: '20:00',
      status: 'active',
      courses: 3,
      activeCourse: 3,
      courseName: 'Dessert',
      courseItem: 'Chocolate Fondant',
      restrictions: [
        { guest: 'G_A', flags: ['NUTS'] },
        { guest: 'G_B', flags: ['DAIRY', 'EGGS'] },
        { guest: 'G_C', flags: ['GLUTEN', 'NUTS'] },
      ],
      actions: [{ label: 'CLOSE TABLE', onClick: () => {} }],
    },
  },
];

function PreviewApp() {
  return (
    <div style={{
      backgroundColor: ink.bg,
      minHeight: '100vh',
      padding: '48px 40px',
      fontFamily: font,
    }}>
      {/* Page header */}
      <div style={{ marginBottom: '48px', borderBottom: `1px solid ${ink[4]}`, paddingBottom: '24px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: ink[3], marginBottom: '8px' }}>
          MILKA SERVICE BOARD
        </div>
        <div style={{ fontSize: '24px', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 500, color: ink[0] }}>
          TABLECARD / VISUAL PREVIEW
        </div>
      </div>

      {/* Card grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '32px',
      }}>
        {SCENARIOS.map(({ label, props }) => (
          <div key={label}>
            <div style={{
              fontSize: '10px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: ink[3],
              marginBottom: '12px',
            }}>
              {label}
            </div>
            <TableCard {...props} />
          </div>
        ))}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('preview-root'));
root.render(<PreviewApp />);
