// Module-level mirror of App's sqlite-primary decision, so code outside the
// App component tree (modals, admin panels, the shared stateStore helpers)
// can pick the right store without prop drilling. LIGHT module — no SDK
// imports, safe to import anywhere. App.jsx is the only writer.

let primary = false;

export const setSqlitePrimaryFlag = (value) => { primary = Boolean(value); };
export const isSqlitePrimary = () => primary;
