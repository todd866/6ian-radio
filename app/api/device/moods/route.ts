import { NextResponse } from 'next/server';
import { requireAccountOrDevice, noStore } from '@/lib/http';
import { stations } from '@/lib/stations';

// The mood dial and the station mixes, for another front end (Glancebar's popover).
const MOODS = [['chill', 'Chill'], ['energise', 'Energise'], ['hiphop', 'Hip hop'], ['focus', 'Focus'], ['workout', 'Workout'], ['party', 'Party']] as const;

export async function GET() {
  const a = await requireAccountOrDevice();
  if (a instanceof NextResponse) return a;
  return NextResponse.json({
    moods: MOODS.map(([id, label]) => ({ id, label })),
    stations: stations().filter((st) => st.count > 0).map((st) => ({ id: `station:${st.id}`, label: st.name, count: st.count })),
  }, { headers: noStore });
}
