"use client";

import { useFormStatus } from "react-dom";

import styles from "./delete-record-form.module.css";

type DeleteAction = (formData: FormData) => void | Promise<void>;

type DeleteRecordFormProps = {
  action: DeleteAction;
  buttonLabel: string;
  confirmationLabel: string;
  description: string;
  idField: "clientId" | "employeeId" | "projectId" | "taskId";
  idValue: string;
  locale: string;
  pendingLabel: string;
  projectId?: string;
  title: string;
};

function DeleteButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={styles.deleteButton} disabled={pending} type="submit">
      {pending ? pendingLabel : label}
    </button>
  );
}

export function DeleteRecordForm({
  action,
  buttonLabel,
  confirmationLabel,
  description,
  idField,
  idValue,
  locale,
  pendingLabel,
  projectId,
  title,
}: DeleteRecordFormProps) {
  return (
    <section className={styles.dangerZone}>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <form action={action}>
        <input name="locale" type="hidden" value={locale} />
        <input name={idField} type="hidden" value={idValue} />
        {projectId ? <input name="projectId" type="hidden" value={projectId} /> : null}
        <label className={styles.confirmation}>
          <input name="confirmation" required type="checkbox" value="DELETE" />
          <span>{confirmationLabel}</span>
        </label>
        <DeleteButton label={buttonLabel} pendingLabel={pendingLabel} />
      </form>
    </section>
  );
}
