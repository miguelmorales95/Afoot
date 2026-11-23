-- Event relationships: track multi-venue events and fuzzy dedup matches
-- Migration: 2026-11-23

CREATE TABLE IF NOT EXISTS afoot.event_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id_1 UUID NOT NULL REFERENCES afoot.events(id) ON DELETE CASCADE,
  event_id_2 UUID NOT NULL REFERENCES afoot.events(id) ON DELETE CASCADE,
  relationship_type TEXT DEFAULT 'multi_venue' CHECK (relationship_type IN ('multi_venue', 'fuzzy_match', 'similar')),
  confidence NUMERIC,  -- fuzzy match score (0-100), null for multi_venue
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id_1, event_id_2),
  CHECK (event_id_1 != event_id_2)  -- prevent self-relationships
);

CREATE INDEX IF NOT EXISTS idx_event_relationships_primary ON afoot.event_relationships(event_id_1);
CREATE INDEX IF NOT EXISTS idx_event_relationships_secondary ON afoot.event_relationships(event_id_2);
CREATE INDEX IF NOT EXISTS idx_event_relationships_type ON afoot.event_relationships(relationship_type);

-- RPC: Get related events for a given event
CREATE OR REPLACE FUNCTION afoot.related_events(event_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  venue_id UUID,
  venue_name TEXT,
  venue_slug TEXT,
  starts_at TIMESTAMPTZ,
  confidence NUMERIC,
  relationship_type TEXT
) AS $$
  SELECT
    CASE WHEN er.event_id_1 = event_id THEN e2.id ELSE e1.id END,
    CASE WHEN er.event_id_1 = event_id THEN e2.title ELSE e1.title END,
    CASE WHEN er.event_id_1 = event_id THEN e2.venue_id ELSE e1.venue_id END,
    CASE WHEN er.event_id_1 = event_id THEN v2.name ELSE v1.name END,
    CASE WHEN er.event_id_1 = event_id THEN v2.slug ELSE v1.slug END,
    COALESCE(eo2.starts_at, eo1.starts_at),
    er.confidence,
    er.relationship_type
  FROM afoot.event_relationships er
  LEFT JOIN afoot.events e1 ON er.event_id_1 = e1.id
  LEFT JOIN afoot.events e2 ON er.event_id_2 = e2.id
  LEFT JOIN afoot.venues v1 ON e1.venue_id = v1.id
  LEFT JOIN afoot.venues v2 ON e2.venue_id = v2.id
  LEFT JOIN afoot.event_occurrences eo1 ON e1.id = eo1.event_id AND eo1.cancelled = FALSE
  LEFT JOIN afoot.event_occurrences eo2 ON e2.id = eo2.event_id AND eo2.cancelled = FALSE
  WHERE (er.event_id_1 = event_id OR er.event_id_2 = event_id)
  ORDER BY COALESCE(eo2.starts_at, eo1.starts_at) ASC
$$ LANGUAGE SQL STABLE;
