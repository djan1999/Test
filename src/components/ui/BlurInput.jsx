import { useRef, useState } from "react";

export default function BlurInput({ committedValue, onCommit, placeholder, style }) {
  const [local, setLocal] = useState(committedValue ?? "");
  const prev = useRef(committedValue);
  if (prev.current !== committedValue) {
    prev.current = committedValue;
    setLocal(committedValue ?? "");
  }
  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== committedValue) onCommit(local);
      }}
      placeholder={placeholder}
      style={style}
    />
  );
}
