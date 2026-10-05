// The primary call to action. The name is kept for compatibility with every
// screen that imports it; the styling is now an Apple style pill in sage.
export default function GoldButton({
  children,
  onClick,
  variant = 'primary',
  size = 'medium',
  icon,
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
}) {
  return (
    <button
      type={type}
      className={`gold-button gold-button--${variant} gold-button--${size} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? (
        <span className="button-spinner" aria-hidden="true" />
      ) : (
        icon && <span className="button-icon" aria-hidden="true">{icon}</span>
      )}

      <span>{loading ? 'Please wait' : children}</span>
    </button>
  );
}
