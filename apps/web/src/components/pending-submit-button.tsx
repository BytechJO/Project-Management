"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingSubmitButtonProps = Omit<ComponentPropsWithoutRef<"button">, "type"> & {
  pendingLabel: ReactNode;
};

export function PendingSubmitButton({
  children,
  disabled,
  pendingLabel,
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button {...props} aria-busy={pending} data-pending={pending || undefined} disabled={disabled || pending} type="submit">
      {pending ? pendingLabel : children}
    </button>
  );
}
