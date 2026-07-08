import { InputHTMLAttributes, TextareaHTMLAttributes, useId } from "react";

type FieldProps = {
  label: string;
  help?: string;
  className?: string;
} & InputHTMLAttributes<HTMLInputElement>;

type TextareaFieldProps = {
  label: string;
  help?: string;
  className?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Field({ label, help, id, className = "", ...props }: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const helpId = help ? `${fieldId}-help` : undefined;

  return (
    <label className={`field-label ${className}`} htmlFor={fieldId}>
      <span>{label}</span>
      <input id={fieldId} className="input-field" aria-describedby={helpId} {...props} />
      {help ? (
        <span id={helpId} className="field-help">
          {help}
        </span>
      ) : null}
    </label>
  );
}

export function TextareaField({ label, help, id, className = "", ...props }: TextareaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const helpId = help ? `${fieldId}-help` : undefined;

  return (
    <label className={`field-label ${className}`} htmlFor={fieldId}>
      <span>{label}</span>
      <textarea id={fieldId} className="textarea-field" aria-describedby={helpId} {...props} />
      {help ? (
        <span id={helpId} className="field-help">
          {help}
        </span>
      ) : null}
    </label>
  );
}
