-- Story 6.3: the objects of the public bucket (name, mimetype, size,
-- updated_at) as one JSON array. Read-only; `psql -X -At -f media-list.sql`.
-- media.mjs downloads the new ones; drill.sh compares them with the files.
-- media-drafts is not backed up (decision 2026-11-20): after a restore the
-- site shows every image, and re-cropping an old one needs a re-upload.
select coalesce(
  json_agg(
    json_build_object(
      'name', o.name,
      'mimetype', o.metadata ->> 'mimetype',
      'size', (o.metadata ->> 'size')::bigint,
      'updated_at', to_char(o.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
    order by o.name
  ),
  '[]'::json
)
from storage.objects o
where o.bucket_id = 'media-public';
