/**
 * Reusable AccountCodeBadge component
 * Provides visual separation between account code and name.
 * Account code is displayed in a badge-like styling with monospace font,
 * and account name follows as normal text.
 *
 * Usage:
 * <AccountCodeBadge code="1100" name="العملاء" />
 * <AccountCodeBadge code={account.code} name={account.name} size="sm" />
 */
interface AccountCodeBadgeProps {
  code: string;
  name?: string;
  /** Size variant: "sm" for compact inline, "md" for default */
  size?: 'sm' | 'md';
}

export function AccountCodeBadge({ code, name, size = 'md' }: AccountCodeBadgeProps) {
  const badgeClasses =
    size === 'sm'
      ? 'inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground'
      : 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-muted text-muted-foreground';

  return (
    <>
      <span className={badgeClasses} dir="ltr">
        {code}
      </span>
      {name && <span className="mr-1.5">{name}</span>}
    </>
  );
}

/**
 * Inline variant that renders code and name inside a flex container
 * for use in table cells and dropdowns where alignment matters.
 */
export function AccountCodeBadgeInline({ code, name, size = 'md' }: AccountCodeBadgeProps) {
  const badgeClasses =
    size === 'sm'
      ? 'inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground'
      : 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-muted text-muted-foreground';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={badgeClasses} dir="ltr">
        {code}
      </span>
      {name && <span>{name}</span>}
    </span>
  );
}
