import { Component } from "react";
import { tokens } from "../../styles/tokens.js";

export class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("App crash:", error, info);
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
          background: tokens.colors.offWhite,
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
            background: tokens.colors.black,
            color: tokens.colors.white,
            cursor: "pointer",
          }}
        >
          RELOAD
        </button>
      </div>
    );
  }
}
