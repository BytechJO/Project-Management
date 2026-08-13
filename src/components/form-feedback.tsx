import styles from "./form-feedback.module.css";

export function FormFeedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  if (!error && !success) return null;

  return (
    <div className={error ? styles.error : styles.success} role={error ? "alert" : "status"}>
      {error ?? success}
    </div>
  );
}
