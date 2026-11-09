import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Person, AppEvent, Group, Roster, GroupMember } from "../types";
import { Calendar, CheckCircle2, XCircle, MessageSquare } from "lucide-react";
import { parseEventDate, formatEventTimeRange } from "../lib/dateUtils";
import { applyOptimisticRosterUpdate } from "../lib/rosterUtils";

export default function Portal() {
  const { accessCode } = useParams<{ accessCode: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
    const [person, setPerson] = useState<Person | null>(null);
    const [rosters, setRosters] = useState<Roster[]>([]);
    const [events, setEvents] = useState<AppEvent[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
    
    const [editingNoteFor, setEditingNoteFor] = useState<{eventId: string, personId: string} | null>(null);
    const [noteDraft, setNoteDraft] = useState("");

    useEffect(() => {
        if (!accessCode) return;
        let isSubscribed = true;
        const abortController = new AbortController();

        async function fetchData() {
            try {
                const res = await fetch("/api/portal/data", {
                    headers: { "x-access-code": accessCode ?? "" },
                    signal: abortController.signal
                });
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || `Error ${res.status}: Failed to load data`);
                }
                const data = await res.json();
                if (isSubscribed) {
                    setPerson(data.person);
                    setRosters(data.rosters);
                    
                    const sortedEvents = data.events.sort((a: AppEvent, b: AppEvent) => {
                        const dateA = parseEventDate(a.date).getTime() || 0;
                        const dateB = parseEventDate(b.date).getTime() || 0;
                        return dateA - dateB;
                    });
                    
                    setEvents(sortedEvents);
                    setGroups(data.groups || []);
                    setPeople(data.people || []);
                    setGroupMembers(data.groupMembers || []);
                }
            } catch (e: any) {
                if (e.name === 'AbortError') return;
                console.error("Portal fetch failed:", e);
                if (isSubscribed) setError(e.message);
            } finally {
                if (isSubscribed) setLoading(false);
            }
        }

        fetchData();

        return () => {
            isSubscribed = false;
            abortController.abort();
        };
    }, [accessCode]);

    const handleAction = async (eventId: string, targetPersonId: string, action: string, value: string) => {
        // Optimistic Update
        const previousRosters = [...rosters];
        setRosters(prev => applyOptimisticRosterUpdate(prev, eventId, targetPersonId, action, value));

        try {
            const res = await fetch("/api/portal/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accessCode, eventId, targetPersonId, action, value })
            });

            if (!res.ok) {
                throw new Error("Action failed on server");
            }
        } catch (e) {
            console.error("Action failed", e);
            // Revert on error
            setRosters(previousRosters);
        }
    };

    const handleSaveNote = async () => {
        if (!editingNoteFor) return;
        await handleAction(editingNoteFor.eventId, editingNoteFor.personId, 'note', noteDraft);
        setEditingNoteFor(null);
    };

    const getGroupName = (groupId: string) => {
        const g = groups.find(g => g.id === groupId);
        return g ? g.name : "Unknown Group";
    };

  return (
    <div className="min-h-screen bg-stone-100 md:p-6 p-0">
        <div className="max-w-xl mx-auto bg-white min-h-screen md:min-h-0 md:rounded-2xl md:shadow-sm border border-stone-100 overflow-hidden">
            <div className="bg-stone-800 text-white p-6 relative">
                <img src="/logo.png" alt="Logo" className="w-12 h-12 object-contain absolute top-6 right-6 opacity-80" />
                <h1 className="text-xl font-semibold mb-1">Welcome back, {person?.firstName}.</h1>
                <p className="text-amber-100 text-sm">Manage your upcoming group events.</p>
            </div>
            
            <div className="p-6">
                <h2 className="text-lg font-medium text-stone-900 mb-4 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-stone-400" />
                    My Events
                </h2>
                
                {loading ? (
                    <div className="p-8 text-center text-stone-500 flex flex-col items-center gap-4 w-full">
                        <div className="w-10 h-10 border-4 border-stone-200 border-t-amber-500 rounded-full animate-spin"></div>
                        <p className="font-bold text-stone-700">Loading your schedule...</p>
                    </div>
                ) : error ? (
                    <div className="p-8 text-center text-rose-500 flex flex-col items-center gap-4 w-full">
                        <XCircle className="w-10 h-10 text-rose-300" />
                        <p className="font-bold text-rose-700">{error}</p>
                    </div>
                ) : events.length === 0 ? (
                    <p className="text-stone-500 text-sm bg-stone-100 p-4 rounded-3xl border border-stone-100">No events found for your groups.</p>
                ) : (
                    <div className="space-y-4">
                        {events.map((e, index) => {
                            return (
                                <div key={e.id + index} className="border border-stone-200 rounded-3xl p-4 flex flex-col shadow-sm">
                                    <div className="border-b border-stone-100 pb-3 mb-3">
                                        <h3 className="font-semibold text-stone-900">{e.title}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-stone-800 bg-amber-100 px-2 py-0.5 rounded-full font-medium">{getGroupName(e.groupId)}</span>
                                            <p className="text-xs text-stone-500 font-medium">{e.date} {e.time ? `• ${formatEventTimeRange(e.time, e.duration, e.title)}` : ''}</p>
                                        </div>
                                    </div>

                                    <div className="flex flex-col md:flex-row gap-4">
                                        {people.map(p => {
                                            const roster = rosters.find(r => r.eventId === e.id && r.personId === p.id);
                                            const rsvp = roster?.rsvpStatus || 'potential';
                                            const pName = `${p.firstName} ${p.lastName}`;
                                            
                                            // Check if this person is actually part of this event's group
                                            const isMemberOfGroup = groupMembers.some(gm => gm.groupId === e.groupId && gm.personId === p.id);
                                            // Or if they are already on the roster
                                            const isOnRoster = rosters.some(r => r.eventId === e.id && r.personId === p.id);

                                            // Only show people who belong to the group or are already rostered
                                            if (!isMemberOfGroup && !isOnRoster) return null;

                                            return (
                                                <div key={p.id} className="flex-1 bg-stone-100 rounded-2xl p-3 border border-stone-100">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="font-semibold text-sm text-stone-800">{pName}</span>
                                                        <span className="text-[10px] text-stone-500 font-medium capitalize">Status: {rsvp}</span>
                                                    </div>
                                                    
                                                    {roster?.note && (
                                                        <div className="mb-2 px-2 py-1 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800 italic">
                                                            "{roster.note}"
                                                        </div>
                                                    )}

                                                    <div className="flex gap-2 mb-2">
                                                        <button 
                                                          className={`flex-1 px-2 py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 rounded-xl border transition-all ${rsvp === 'booked' ? 'bg-emerald-600 border-emerald-700 text-white shadow-inner' : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'}`}
                                                          title="Book"
                                                          onClick={() => handleAction(e.id as string, p.id, 'rsvp', 'booked')}
                                                        >
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            {rsvp === 'booked' ? 'Booked' : 'Book'}
                                                        </button>
                                                        <button 
                                                          className={`flex-1 px-2 py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 rounded-xl border transition-all ${rsvp === 'cancelled' ? 'bg-rose-600 border-rose-700 text-white shadow-inner' : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'}`}
                                                          title="Cancel"
                                                          onClick={() => handleAction(e.id as string, p.id, 'rsvp', 'cancelled')}
                                                        >
                                                            <XCircle className="w-3.5 h-3.5" />
                                                            {rsvp === 'cancelled' ? 'Cancelled' : 'Cancel'}
                                                        </button>
                                                        <button 
                                                          className="px-2 py-1.5 bg-white text-stone-600 border border-stone-200 hover:bg-stone-50 rounded-xl transition-all flex items-center justify-center"
                                                          title="Add Note"
                                                          onClick={() => {
                                                              setNoteDraft(roster?.note || "");
                                                              setEditingNoteFor({eventId: e.id as string, personId: p.id});
                                                          }}
                                                        >
                                                            <MessageSquare className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>

                                                    {editingNoteFor?.eventId === e.id && editingNoteFor?.personId === p.id && (
                                                        <div className="flex gap-2">
                                                            <input 
                                                                type="text" 
                                                                value={noteDraft} 
                                                                onChange={ev => setNoteDraft(ev.target.value)}
                                                                className="flex-1 text-xs border border-amber-300 focus:ring-2 focus:ring-amber-600 rounded-xl px-2 py-1.5 focus:outline-none bg-white"
                                                                placeholder="Add a note..."
                                                                autoFocus
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') handleSaveNote();
                                                                    if (e.key === 'Escape') setEditingNoteFor(null);
                                                                }}
                                                            />
                                                            <button onClick={handleSaveNote} className="px-2 py-1 bg-stone-800 text-white text-xs font-bold rounded-xl hover:bg-stone-900">Save</button>
                                                            <button onClick={() => setEditingNoteFor(null)} className="px-2 py-1 bg-stone-200 text-stone-700 text-xs font-bold rounded-xl hover:bg-stone-300">Cancel</button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    </div>
  );
}
