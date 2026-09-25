import type { CSSProperties, FC, ReactNode } from "react";

export const ErrorDetails: FC<{
  children: ReactNode;
  style?: CSSProperties;
  id?: string;
  role?: "alert";
}> = ({ children, style, id, role }) => (
  <p id={id} role={role} style={{
    margin: 0,
    fontSize: 12,
    lineHeight: "18px",
    fontWeight: 400,
    color: "var(--colorNeutralForeground2, #424242)",
    overflowWrap: "anywhere",
    ...style,
  }}>
    {children}
  </p>
);
