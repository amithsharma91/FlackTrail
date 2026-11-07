import { statusConfig } from '../lib/utils';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const { bg, text, border, label } = statusConfig(status);
  const base = 'inline-flex items-center rounded-full font-medium border';
  const sizes = {
    sm: 'px-2 py-0.5 text-[10px] leading-4',
    md: 'px-2.5 py-1 text-xs leading-5',
  };
  return (
    <span className={`${base} ${border} ${bg} ${text} ${sizes[size]}`}>
      {label}
    </span>
  );
}
