import React from 'react';
import { tokens } from '../../styles/tokens';

const { ink, signal, typeScale, space, rule, font, surface } = tokens;

const s = {
  card: {
    fontFamily: font,
    backgroundColor: surface.card,
    borderRadius: 0,
    borderTop:    `${rule.hairline} solid ${ink[4]}`,
    borderBottom: `${rule.hairline} solid ${ink[4]}`,
    paddingTop:    space[5],
    paddingBottom: space[5],
    paddingLeft:   space[4],
    paddingRight:  space[4],
    cursor: 'default',
  },

  // ── Header strip ────────────────────────────────────────────
  header: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingBottom:  space[3],
    marginBottom:   space[4],
    borderBottom:   `${rule.hairline} solid ${ink[4]}`,
  },
  headerText: {
    ...typeScale.meta,
    fontFamily: font,
    color:      ink[2],
    letterSpacing: '0.08em',
  },

  // ── Course progression bar ───────────────────────────────────
  progressBar: {
    display:       'flex',
    gap:           '2px',
    height:        '3px',
    marginBottom:  space[4],
  },

  // ── Course label / name ──────────────────────────────────────
  courseLabel: {
    ...typeScale.label,
    fontFamily:   font,
    color:        ink[3],
    marginBottom: space[1],
  },
  courseValue: {
    ...typeScale.prominent,
    fontFamily:   font,
    color:        ink[0],
    marginBottom: space[4],
  },

  // ── Restrictions ─────────────────────────────────────────────
  restrictionsLabel: {
    ...typeScale.label,
    fontFamily:   font,
    color:        ink[3],
    marginBottom: space[2],
  },
  guestRow: {
    display:      'flex',
    flexWrap:     'wrap',
    gap:          space[3],
    marginBottom: space[4],
  },
  guestEntry: {
    display:    'flex',
    alignItems: 'center',
    gap:        space[1],
  },
  guestId: {
    ...typeScale.meta,
    fontFamily: font,
    color:      ink[2],
  },
  allergenFlag: {
    ...typeScale.label,
    fontFamily: font,
    color:      signal.alert,
  },

  // ── Footer ───────────────────────────────────────────────────
  footer: {
    display:    'flex',
    gap:        space[4],
    borderTop:  `${rule.hairline} solid ${ink[4]}`,
    paddingTop: space[3],
    marginTop:  space[1],
  },
  ghostBtn: {
    background:    'none',
    border:        'none',
    padding:       0,
    cursor:        'pointer',
    ...typeScale.meta,
    fontFamily:    font,
    color:         ink[2],
    textDecoration: 'none',
  },
};

function statusColor(status) {
  if (status === 'active') return signal.active;
  if (status === 'warn')   return signal.warn;
  if (status === 'done')   return signal.done;
  return ink[4];
}

function segmentColor(segState) {
  if (segState === 'active')    return signal.active;
  if (segState === 'completed') return ink[3];
  return ink[4];
}

export default function TableCard({
  tableNumber,
  covers,
  seatedAt,
  status = 'active',
  courses = 4,
  activeCourse = 1,
  courseName = '',
  courseItem = '',
  restrictions = [],
  actions = [],
  onClick,
  dragHandleProps,
}) {
  const segments = Array.from({ length: courses }, (_, i) => {
    const n = i + 1;
    if (n < activeCourse)  return 'completed';
    if (n === activeCourse) return 'active';
    return 'pending';
  });

  const headerParts = [
    tableNumber != null && `TABLE_${String(tableNumber).padStart(2, '0')}`,
    covers      != null && `COVERS_${String(covers).padStart(2, '0')}`,
    seatedAt               && `SEATED_${seatedAt}`,
  ].filter(Boolean);

  return (
    <div style={s.card} onClick={onClick} {...dragHandleProps}>

      {/* HEADER STRIP */}
      <div style={s.header}>
        <span style={s.headerText}>{headerParts.join('   ')}</span>
        <div style={{
          width:           '6px',
          height:          '6px',
          borderRadius:    0,
          flexShrink:      0,
          backgroundColor: statusColor(status),
        }} />
      </div>

      {/* COURSE PROGRESSION */}
      <div style={s.progressBar}>
        {segments.map((seg, i) => (
          <div key={i} style={{ flex: 1, height: '100%', backgroundColor: segmentColor(seg) }} />
        ))}
      </div>

      {/* CURRENT COURSE */}
      <div style={s.courseLabel}>
        {`COURSE_${String(activeCourse).padStart(2, '0')} / ${courseName.toUpperCase()}`}
      </div>
      <div style={s.courseValue}>{courseItem}</div>

      {/* GUEST RESTRICTIONS */}
      {restrictions.length > 0 && (
        <div>
          <div style={s.restrictionsLabel}>RESTRICTIONS</div>
          <div style={s.guestRow}>
            {restrictions.map(({ guest, flags }) => (
              <div key={guest} style={s.guestEntry}>
                <span style={s.guestId}>{guest}</span>
                {flags.map(flag => (
                  <span key={flag} style={s.allergenFlag}>[{flag}]</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FOOTER ACTIONS */}
      {actions.length > 0 && (
        <div style={s.footer}>
          {actions.map(({ label, onClick: onAction }) => (
            <button
              key={label}
              style={s.ghostBtn}
              onClick={e => { e.stopPropagation(); onAction?.(); }}
              onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

    </div>
  );
}
