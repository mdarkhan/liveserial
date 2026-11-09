"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, buttonClass, cx } from "./ui";
import type { ActionResult } from "@/lib/action-result";

type FormState = ActionResult | null;
const FormCtx = createContext<FormState>(null);

/**
 * A form bound to a server action via useActionState. Shows the action's
 * message, and passes field errors + previously typed values to <Field>s.
 * The server action receives (prevState, formData) and returns ActionResult.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
}: {
  action: (prev: FormState, formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <FormCtx.Provider value={state}>
      <form ref={ref} action={formAction} className={cx("space-y-4", className)} noValidate>
        {state?.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

type FieldProps = {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
} & Omit<ComponentProps<"input">, "name">;

const inputClass =
  "block w-full min-h-12 rounded-lg border-2 border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-muted/70 aria-[invalid=true]:border-danger";

export function Field({ name, label, hint, required, className, defaultValue, ...props }: FieldProps) {
  const state = useContext(FormCtx);
  const id = useId();
  const error = state?.fieldErrors?.[name];
  const kept = !state?.ok ? state?.values?.[name] : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
        {required && <span className="text-danger" aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(hint && `${id}-hint`, error && `${id}-err`) || undefined}
        defaultValue={kept ?? defaultValue}
        key={kept === undefined ? "d" : `k-${kept}`}
        className={inputClass}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<FieldProps, "type"> & { showLabel: string }) {
  const { showLabel, ...rest } = props;
  const [show, setShow] = useState(false);
  return (
    <div>
      <Field type={show ? "text" : "password"} {...rest} />
      <label className="mt-1 inline-flex min-h-12 items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-primary" checked={show} onChange={(e) => setShow(e.target.checked)} />
        {showLabel}
      </label>
    </div>
  );
}

export function SelectField({
  name,
  label,
  required,
  options,
  defaultValue,
  hint,
  className,
}: {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  className?: string;
}) {
  const state = useContext(FormCtx);
  const id = useId();
  const error = state?.fieldErrors?.[name];
  const kept = !state?.ok ? state?.values?.[name] : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
        {required && <span className="text-danger" aria-hidden="true"> *</span>}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={kept ?? defaultValue}
        key={kept === undefined ? "d" : `k-${kept}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(hint && `${id}-hint`, error && `${id}-err`) || undefined}
        className={inputClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function CheckboxField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex min-h-12 items-center gap-3 font-medium">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-6 accent-primary" />
      {label}
    </label>
  );
}

/** Submit button that disables itself and shows a pending label while the action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  confirm,
}: {
  children: ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "lg" | "xl";
  className?: string;
  /** Native confirm dialog text before submitting (for destructive actions). */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
