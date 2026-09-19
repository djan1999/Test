export default function DraftConflict({ onReload }) {
  return <div role="alert" style={{ marginBottom: 12 }}>
    Another device changed these settings. Your draft is still here; saving is paused.
    <button type="button" onClick={() => {
      if (window.confirm("Discard this draft and load the latest saved settings?")) onReload();
    }}>Reload latest settings</button>
  </div>;
}
