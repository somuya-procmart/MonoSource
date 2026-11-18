-- ARCs are group-level: a live contract applies at every plant. Plant applicability is no longer a step,
-- so open "confirm this ARC applies at plant X" tasks and coverage requests are closed as settled by that rule.
UPDATE human_tasks SET status = 'done', resolution = '{"action":"group_arc","note":"ARCs apply group-wide"}'::jsonb, resolved_at = now()
 WHERE kind = 'arc_applicability' AND status IN ('open', 'waiting');
UPDATE coverage_requests SET status = 'resolved', resolution = 'group_arc', resolved_by = requested_by, resolved_at = now() WHERE status = 'open';
