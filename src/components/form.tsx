"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, buttonClass, cx } from "./ui";
import type { ActionResult } from "@/lib/action-result";
import { t } from "@/lib/i18n/bn";

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
    // A failed submit: put the cursor on the first field to fix (or on the message),
    // so phone users and screen readers land on the problem instead of the button.
    if (state && !state.ok) {
      const form = ref.current;
      const target =
        form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form?.querySelector<HTMLElement>("[data-form-message]");
      target?.focus();
    }
  }, [state, resetOnSuccess]);
  return (
    <FormCtx.Provider value={state}>
      <form ref={ref} action={formAction} className={cx("space-y-4", className)} noValidate>
        {state?.message && (
          <div data-form-message tabIndex={-1} className="outline-none">
            <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
          </div>
        )}
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
  /** Ask this question in a Bangla dialog before submitting (for destructive actions). */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        ref={buttonRef}
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        aria-haspopup={confirm ? "dialog" : undefined}
        className={buttonClass(variant, size, className)}
        onClick={(e) => {
          if (!confirm) return;
          e.preventDefault();
          dialogRef.current?.showModal();
        }}
      >
        {pending ? pendingLabel : children}
      </button>
      {confirm && (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
          className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-ink backdrop:bg-black/50"
        >
          <div className="p-5">
            <h2 id={titleId} className="text-lg font-bold">
              {t.common.confirmTitle}
            </h2>
            <p className="mt-2">{confirm}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {/* type="button": these must not submit the surrounding form themselves */}
              <button type="button" autoFocus className={buttonClass("secondary")} onClick={() => dialogRef.current?.close()}>
                {t.common.confirmNo}
              </button>
              <button
                type="button"
                className={buttonClass(variant === "danger" ? "danger" : "primary")}
                onClick={() => {
                  dialogRef.current?.close();
                  // Submits with this button as the submitter; no click event, so no second dialog.
                  const b = buttonRef.current;
                  b?.form?.requestSubmit(b);
                }}
              >
                {children}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
