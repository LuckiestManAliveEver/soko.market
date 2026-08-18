export interface ReportRowProps {
  eyebrow: string;
  title: string;
  body: string;
  value: string;
}

export function ReportRow(props: ReportRowProps) {
  return (
    <article className="record-row">
      <div>
        <p className="eyebrow">{props.eyebrow}</p>
        <h4>{props.title}</h4>
        <p>{props.body}</p>
      </div>
      <strong>{props.value}</strong>
    </article>
  );
}
