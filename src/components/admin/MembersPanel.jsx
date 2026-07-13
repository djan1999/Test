import { useCallback, useEffect, useState } from "react";
import { requestWorkspaceMembers } from "../../lib/workspaceMembers.js";
import { tokens } from "../../styles/tokens.js";
import { baseInp, dangerBtn, primaryBtn, sectionHeader } from "./adminStyles.js";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin", description: "Everything, including setup and staff accounts." },
  { value: "service", label: "Service", description: "Service board, reservations, menu and service archive." },
  { value: "kitchen", label: "Kitchen", description: "Kitchen display and kitchen floor only." },
];

export default function MembersPanel({ accessToken, workspaceId, currentUserId }) {
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("service");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  const loadMembers = useCallback(async () => {
    if (!accessToken || !workspaceId) return;
    setLoading(true);
    try {
      const data = await requestWorkspaceMembers({ accessToken, workspaceId });
      setMembers(data.members || []);
      setMessage(null);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const invite = async (event) => {
    event.preventDefault();
    if (!email.trim() || busyId) return;
    setBusyId("invite");
    setMessage(null);
    try {
      const data = await requestWorkspaceMembers({
        accessToken, workspaceId, method: "POST", payload: { email, role },
      });
      setEmail("");
      await loadMembers();
      setMessage({
        type: "success",
        text: data.invited
          ? "Invitation sent. The new staff member will choose a password from the email."
          : "That existing account is now linked to this restaurant.",
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = async (member, nextRole) => {
    if (nextRole === member.role || busyId) return;
    setBusyId(member.user_id);
    setMessage(null);
    try {
      await requestWorkspaceMembers({
        accessToken, workspaceId, method: "PATCH", payload: { userId: member.user_id, role: nextRole },
      });
      setMembers((previous) => previous.map((item) => (
        item.user_id === member.user_id ? { ...item, role: nextRole } : item
      )));
      setMessage({ type: "success", text: "Role updated. Open devices will gain or lose screens automatically." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (member) => {
    if (busyId) return;
    const label = member.email || "this staff account";
    if (!window.confirm(`Remove ${label} from this restaurant? Their account remains, but it cannot access this restaurant.`)) return;
    setBusyId(member.user_id);
    setMessage(null);
    try {
      await requestWorkspaceMembers({
        accessToken, workspaceId, method: "DELETE", payload: { userId: member.user_id },
      });
      setMembers((previous) => previous.filter((item) => item.user_id !== member.user_id));
      setMessage({ type: "success", text: "Staff access removed." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <div style={sectionHeader}>Staff & Roles</div>
      <p style={{ fontSize: 11, color: tokens.ink[2], lineHeight: 1.55, maxWidth: 650, margin: "0 0 18px" }}>
        Each person gets their own login. Their role controls both the screens they see and what the database lets them change.
        The last Admin is protected and cannot be removed or downgraded.
      </p>

      <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
        {ROLE_OPTIONS.map((option) => (
          <div key={option.value} style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 12, fontSize: 10, lineHeight: 1.4 }}>
            <strong style={{ color: tokens.ink[0] }}>{option.label}</strong>
            <span style={{ color: tokens.ink[3] }}>{option.description}</span>
          </div>
        ))}
      </div>

      <form onSubmit={invite} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", padding: 14, border: `1px solid ${tokens.ink[4]}`, marginBottom: 18 }}>
        <label style={{ display: "grid", gap: 6, flex: "1 1 250px", fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase", color: tokens.ink[3] }}>
          Staff email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="name@example.com"
            style={{ ...baseInp, fontSize: tokens.mobileInputSize }}
          />
        </label>
        <label style={{ display: "grid", gap: 6, flex: "0 1 150px", fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase", color: tokens.ink[3] }}>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)} style={{ ...baseInp, fontSize: tokens.mobileInputSize }}>
            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busyId === "invite"} style={{ ...primaryBtn, minHeight: 42, opacity: busyId === "invite" ? 0.55 : 1 }}>
          {busyId === "invite" ? "SENDING..." : "INVITE / LINK"}
        </button>
      </form>

      {message ? (
        <div role={message.type === "error" ? "alert" : "status"} style={{
          padding: "10px 12px", marginBottom: 14, fontSize: 10, lineHeight: 1.45,
          color: message.type === "error" ? tokens.red.text : tokens.green.text,
          background: message.type === "error" ? tokens.red.bg : tokens.green.bg,
          border: `1px solid ${message.type === "error" ? tokens.red.border : tokens.green.border}`,
        }}>
          {message.text}
        </div>
      ) : null}

      {loading ? <div style={{ fontSize: 10, color: tokens.ink[3] }}>Loading staff...</div> : (
        <div style={{ display: "grid", gap: 8 }}>
          {members.map((member) => {
            const isBusy = busyId === member.user_id;
            const isCurrent = member.user_id === currentUserId;
            return (
              <div key={member.user_id} style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                border: `1px solid ${tokens.ink[4]}`, padding: "10px 12px", background: tokens.neutral[0],
              }}>
                <div style={{ flex: "1 1 230px", minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: tokens.ink[0], overflowWrap: "anywhere" }}>
                    {member.email || member.user_id}{isCurrent ? " (you)" : ""}
                  </div>
                  <div style={{ fontSize: 8, color: tokens.ink[4], marginTop: 4 }}>
                    Added {new Date(member.created_at).toLocaleDateString()}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 8, letterSpacing: 1, color: tokens.ink[3], textTransform: "uppercase" }}>
                  Role
                  <select
                    aria-label={`Role for ${member.email || member.user_id}`}
                    value={member.role}
                    disabled={isBusy}
                    onChange={(event) => changeRole(member, event.target.value)}
                    style={{ ...baseInp, minWidth: 120, fontSize: 14 }}
                  >
                    {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <button type="button" disabled={isBusy} onClick={() => removeMember(member)} style={{ ...dangerBtn, opacity: isBusy ? 0.5 : 1 }}>
                  REMOVE
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
