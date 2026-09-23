import { formatExactDate, formatRelative } from "@/lib/dates";

export default function RelativeTime({
  date,
  className,
}: {
  date: string | null | undefined;
  className?: string;
}) {
  if (!date) {
    return <span className={className}>Never</span>;
  }

  return (
    <time dateTime={date} title={formatExactDate(date)} className={className}>
      {formatRelative(date)}
    </time>
  );
}
