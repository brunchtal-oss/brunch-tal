// How full a session is: a 4px track in the border colour, filled in
// primary. Decorative: the places are in the text. Shared by the admin
// home's session-tile and the /admin/sessions rows (2026-10-10).
export function OccupancyBar({ percent }: { percent: number }) {
  return (
    <span
      aria-hidden
      className="block h-1 overflow-hidden rounded-full bg-border"
    >
      <span
        data-fill={percent}
        className="block h-full rounded-full bg-primary"
        style={{ width: `${percent}%` }}
      />
    </span>
  )
}
