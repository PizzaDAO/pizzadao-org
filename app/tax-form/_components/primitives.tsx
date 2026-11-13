// Ported from rsv-pizza@f04ad2a1 frontend/src/components/{IconInput,Checkbox}.tsx
// (same props; restyled to the pizzadao field look). Keep props in sync.
import React, { forwardRef } from "react";
import { Square as SquareIcon, CheckSquare2, type LucideIcon } from "lucide-react";

interface IconInputBaseProps {
  icon?: LucideIcon;
  customIcon?: React.ReactNode;
  iconSize?: number;
}

type SingleLineProps = IconInputBaseProps &
  React.InputHTMLAttributes<HTMLInputElement> & { multiline?: false };

type MultilineProps = IconInputBaseProps &
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true; rows?: number };

export type IconInputProps = SingleLineProps | MultilineProps;

const FIELD =
  "w-full min-h-11 rounded border border-[hsl(var(--rule-warm)/0.55)] bg-card text-foreground px-3 text-sm";

export const IconInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, IconInputProps>(
  (allProps, ref) => {
    const {
      icon: Icon,
      customIcon,
      iconSize = 20,
      className = "",
      placeholder,
      required,
      multiline,
      ...props
    } = allProps;
    const displayPlaceholder =
      placeholder && required && !placeholder.endsWith("*") ? `${placeholder} *` : placeholder;

    const iconElement =
      customIcon ||
      (Icon ? (
        <Icon
          size={iconSize}
          className={`absolute left-3 ${multiline ? "top-3" : "top-1/2 -translate-y-1/2"} text-muted-foreground pointer-events-none`}
        />
      ) : null);

    if (multiline) {
      const { rows = 3, ...textareaProps } = props as React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
        rows?: number;
      };
      return (
        <div className="relative">
          {iconElement}
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            className={`${FIELD} py-2 !pl-14 resize-none ${className}`}
            placeholder={displayPlaceholder}
            required={required}
            rows={rows}
            {...textareaProps}
          />
        </div>
      );
    }

    return (
      <div className="relative">
        {iconElement}
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          className={`${FIELD} !pl-14 ${className}`}
          placeholder={displayPlaceholder}
          required={required}
          {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      </div>
    );
  },
);

IconInput.displayName = "IconInput";

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  size?: number;
  disabled?: boolean;
  labelClassName?: string;
  children?: React.ReactNode;
  className?: string;
  checkboxRole?: boolean;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  size = 18,
  disabled = false,
  labelClassName = "text-sm text-foreground",
  children,
  className = "",
  checkboxRole = false,
}) => (
  <button
    type="button"
    onClick={disabled ? undefined : onChange}
    {...(checkboxRole ? { role: "checkbox", "aria-checked": checked, "aria-disabled": disabled || undefined } : {})}
    className={`flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
  >
    {checked ? (
      <CheckSquare2 size={size} className="text-[#ff393a] flex-shrink-0" aria-hidden={checkboxRole || undefined} />
    ) : (
      <SquareIcon size={size} className="text-muted-foreground flex-shrink-0" aria-hidden={checkboxRole || undefined} />
    )}
    <span className={labelClassName}>{label}</span>
    {children}
  </button>
);
