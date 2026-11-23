'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface RelatedEvent {
  id: string;
  title: string;
  venue_name: string;
  venue_slug: string;
  starts_at: string;
  confidence?: number;
  relationship_type: string;
}

export function RelatedEventsIndicator({ eventId }: { eventId: string }) {
  const [related, setRelated] = useState<RelatedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function fetch() {
      try {
        const { data, error } = await supabase.rpc('related_events', { event_id: eventId });
        if (error) throw error;
        setRelated(data || []);
      } catch (err) {
        console.error('Failed to fetch related events:', err);
      } finally {
        setLoading(false);
      }
    }

    fetch();
  }, [eventId]);

  if (loading || related.length === 0) return null;

  return (
    <>
      {/* Small icon indicator near top (in metadata area) */}
      <span
        className="text-sm text-gray-500 cursor-help"
        title={`Also at ${related.length} other location${related.length === 1 ? '' : 's'}`}
      >
        🔗
      </span>

      {/* Expandable link at bottom */}
      <div className="mt-3 pt-3 border-t border-gray-200 text-sm">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-blue-600 hover:underline font-medium"
        >
          🔗 Also at: {related.map(r => r.venue_name).join(', ')}
        </button>

        {expanded && related.length > 0 && (
          <div className="mt-2 space-y-1 text-gray-600">
            {related.map(r => (
              <div key={r.id} className="text-xs">
                <Link
                  href={`/${r.venue_slug}/${r.id}`}
                  className="text-blue-600 hover:underline"
                >
                  {r.venue_name} · {new Date(r.starts_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
