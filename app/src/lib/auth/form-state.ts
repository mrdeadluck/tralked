/**
 * State of the account forms (useActionState). `values` echoes what was typed (never a password),
 * because React resets a form after its action runs.
 */
export type AuthFormState = {
  /** First problem of each field, shown under it and linked with aria-describedby. */
  errors?: Partial<Record<string, string>>;
  /** Form-level message (wrong credentials, too many attempts, success). */
  message?: string;
  /** The message reports a success. */
  done?: boolean;
  values?: Partial<Record<string, string>>;
};

export const INITIAL_AUTH_FORM_STATE: AuthFormState = {};
