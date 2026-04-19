import { Component } from "react";
import { tokens } from "../../styles/tokens.js";

export class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("App crash:", error, info);
    try {
      sessionStorage.setItem(
        "milka_last_runtime_error",
        JSON.stringify({
          message: error?.message || "Unknown error",
          stack: error?.stack || "",
          when: new Date().toISOString(),
        })
      );
    } catch {}
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: tokens.font,
          background: tokens.colors.canvas,
          gap: 16,
        }}
      >
        <div style={{ fontSize: tokens.fontSize.lg, fontWeight: 700, letterSpacing: 2 }}>
          SOMETHING WENT WRONG
        </div>
        <div
          style={{
            fontSize: tokens.fontSize.sm,
            color: tokens.colors.gray500,
            maxWidth: 400,
            textAlign: "center",
          }}
        >
          {this.state.error?.message || "Unknown error"}
        </div>
        <button
          onClick={() => {
            this.setState({ hasError: false, error: null });
            window.location.reload();
          }}
          style={{
            fontFamily: tokens.font,
            fontSize: tokens.fontSize.sm,
            letterSpacing: 2,
            padding: "8px 24px",
            border: tokens.borderBold,
            borderRadius: tokens.radius.sm,
            background: tokens.colors.ink,
            color: tokens.colors.white,
            cursor: "pointer",
            boxShadow: tokens.shadow.sm,
          }}
        >
          RELOAD
        </button>
        <button
          onClick={() => {
            try {
              localStorage.removeItem("milka_menu_layout_profiles_v1");
              localStorage.removeItem("milka_active_layout_profile_v1");
              localStorage.removeItem("milka_menu_template_v2");
              localStorage.removeItem("milka_menu_layout");
              localStorage.removeItem("milka_menu_rules");
            } catch {}
            window.location.reload();
          }}
          style={{
            fontFamily: tokens.font,
            fontSize: tokens.fontSize.xs,
            letterSpacing: 1.5,
            padding: "6px 16px",
            border: tokens.borderSubtle,
            borderRadius: tokens.radius.sm,
            background: tokens.colors.elevated,
            color: tokens.colors.gray700,
            cursor: "pointer",
            boxShadow: tokens.shadow.sm,
          }}
        >
          RESET LAYOUT CACHE
        </button>
      </div>
    );
  }
}
