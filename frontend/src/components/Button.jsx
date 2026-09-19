import "./Button.css";

export default function Button({
  children,
  startIcon,
  endIcon,
  variant = "primary",
  size = "medium",
  className = "",
  type = "button",
  ...props
}) {
  const classes = [
    "ui-button",
    `ui-button-${variant}`,
    `ui-button-${size}`,
    className,
  ].filter(Boolean).join(" ");

  return (
    <button type={type} className={classes} {...props}>
      {startIcon && <span className="ui-button-icon" aria-hidden="true">{startIcon}</span>}
      <span className="ui-button-label">{children}</span>
      {endIcon && <span className="ui-button-icon" aria-hidden="true">{endIcon}</span>}
    </button>
  );
}
