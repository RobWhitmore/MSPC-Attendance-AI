import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Person, AppEvent, Group, Roster, GroupMember } from "../types";
import moment from "moment";
import { Search, ChevronDown, ChevronRight, CheckCircle2, XCircle, MessageSquare, Calendar, X, MapPin } from "lucide-react";
import { parseEventDate, formatEventTimeRange } from "../lib/dateUtils";
import { applyOptimisticRosterUpdate } from "../lib/rosterUtils";

const CustomAttendanceCheckbox = ({ rsvp, attend, onChange, disabled }: { rsvp: string, attend: string, onChange: (nextValue: string) => void, disabled?: boolean }) => {
    const rsvpStatus = String(rsvp || "potential").toLowerCase();
    const attendStatus = String(attend || "unknown").toLowerCase();
    
    let colorClass = "";
    let isTicked = false;
    let hoverText = "";
    let nextState = "";

    if (rsvpStatus === 'booked') {
        if (attendStatus === 'no-show') {
            colorClass = "bg-blue-600 border-blue-600 text-white";
            isTicked = false;
            hoverText = "No Show";
            nextState = 'present';
        } else {
            colorClass = "bg-emerald-600 border-emerald-600 text-white";
            isTicked = true;
            hoverText = "Present";
            nextState = 'no-show';
        }
    } else if (rsvpStatus === 'cancelled') {
        if (attendStatus === 'present') {
            colorClass = "bg-orange-500 border-orange-500 text-white";
            isTicked = true;
            hoverText = "Present";
            nextState = 'cancelled';
        } else {
            colorClass = "bg-red-600 border-red-600 text-white";
            isTicked = false;
            hoverText = "Cancelled";
            nextState = 'present';
        }
    } else { // potential
        if (attendStatus === 'present') {
            colorClass = "bg-stone-800 border-stone-800 text-white";
            isTicked = true;
            hoverText = "Present";
            nextState = 'unknown';
        } else {
            colorClass = "bg-white border-stone-400 text-transparent hover:border-stone-500";
            isTicked = false;
            hoverText = "Unknown";
            nextState = 'present';
        }
    }

    return (
        <button
            type="button"
            title={hoverText}
            disabled={disabled}
            onClick={(e) => {
                e.stopPropagation();
                onChange(nextState);
            }}
            className={`w-[18px] h-[18px] rounded flex items-center justify-center transition-all border-2 mx-auto ${colorClass} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-110 shadow-sm'}`}
        >
            {isTicked && (
                <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5 text-white stroke-white">
                    <path d="M3 7.5L5.5 10L11.5 4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            )}
        </button>
    )
}

export default function LeaderPortal() {
  const { accessCode } = useParams<{ accessCode: string }>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isFetching = React.useRef(false);
    const [person, setPerson] = useState<Person | null>(null);
    const [rosters, setRosters] = useState<Roster[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [events, setEvents] = useState<AppEvent[]>([]);
    const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    
    // UI state
    const [search, setSearch] = useState("");
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [editingNoteFor, setEditingNoteFor] = useState<{eventId: string, personId: string} | null>(null);
    const [noteDraft, setNoteDraft] = useState("");
    const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({});
    const [noteModalTarget, setNoteModalTarget] = useState<{eventId: string, personId: string, name: string} | null>(null);
    const [noteModalText, setNoteModalText] = useState("");

    // Submission dialog: the event being submitted, and the extras note going with it.
    const [submitEventId, setSubmitEventId] = useState<string | null>(null);
    const [extrasDraft, setExtrasDraft] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const fetchData = async (signal?: AbortSignal, skipExpand?: boolean) => {
        if (!accessCode) return;
        if (isFetching.current) return;
        isFetching.current = true;
        try {
            const res = await fetch("/api/leader/data", {
                headers: { "x-access-code": accessCode ?? "" },
                signal
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Error ${res.status}: Leader access denied`);
            }
            const data = await res.json();
            const sortedEvents = data.events.sort((a: AppEvent, b: AppEvent) => parseEventDate(a.date).getTime() - parseEventDate(b.date).getTime());
            
            setPerson(data.person);
            setRosters(data.rosters);
            setPeople(data.people);
            setEvents(sortedEvents);
            setGroupMembers(data.groupMembers);
            setGroups(data.groups);

            // Auto-expand the first unsubmitted or upcoming event only on initial load
            if (!skipExpand && sortedEvents.length > 0 && !expandedEventId) {
                const today = new Date();
                today.setHours(0,0,0,0);
                const firstToExpand = sortedEvents.find((e: AppEvent) => {
                    const eventDate = parseEventDate(e.date);
                    const isUpcoming = eventDate >= today;
                    const isUnsubmitted = e.status !== 'submitted';
                    return isUpcoming || isUnsubmitted;
                }) || sortedEvents[0];
                setExpandedEventId(firstToExpand.id);
            }
            
        } catch (e: any) {
            if (e.name === 'AbortError') return;
            console.error("Fetch failed:", e);
            setError(e.message);
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
                isFetching.current = false;
            }
        }
    };

    useEffect(() => {
        let isSubscribed = true;
        const abortController = new AbortController();

        fetchData(abortController.signal, false);

        return () => {
            isSubscribed = false;
            abortController.abort();
            isFetching.current = false;
        };
    }, [accessCode]);

    useEffect(() => {
        if (expandedEventId && !loading) {
            fetchData(undefined, true);
        }
    }, [expandedEventId]);

    const getPersonName = (personId: string) => {
        const p = people.find(per => per.id === personId);
        if (!p) return `Unknown`;
        return `${p.firstName} ${p.lastName}`;
    };

    const getGroupName = (groupId: string) => {
        const g = groups.find(g => g.id === groupId);
        return g ? g.name : "Unknown Group";
    };

    const handleAction = async (eventId: string, targetPersonId: string, action: string, value: string) => {
        const actionKey = `${eventId}-${targetPersonId}`;
        if (pendingActions[actionKey]) return;
        setPendingActions(prev => ({ ...prev, [actionKey]: true }));

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
        } finally {
            setPendingActions(prev => {
                const updated = { ...prev };
                delete updated[actionKey];
                return updated;
            });
        }
    };

    const handleSaveNote = async () => {
        if (!editingNoteFor) return;
        await handleAction(editingNoteFor.eventId, editingNoteFor.personId, 'note', noteDraft);
        setEditingNoteFor(null);
    };

    /** Submit the roster with its extras note. True once the server has accepted it. */
    const handleSubmitRoster = async (eventId: string, extrasNote: string): Promise<boolean> => {
        setSubmitting(true);
        try {
            const res = await fetch("/api/portal/submit-attendance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accessCode, eventId, extrasNote })
            });
            if (res.ok) {
                // Refresh data
                const dataRes = await fetch("/api/leader/data", { headers: { "x-access-code": accessCode ?? "" } });
                if (dataRes.ok) {
                    const data = await dataRes.json();
                    setEvents(data.events.sort((a: AppEvent, b: AppEvent) => parseEventDate(a.date).getTime() - parseEventDate(b.date).getTime()));
                    setRosters(data.rosters);
                }
                return true;
            }
            const error = await res.json().catch(() => ({}));
            alert(`Error submitting roster: ${error.error || "Unknown error"}`);
            return false;
        } catch (e: any) {
            console.error("Submit failed", e);
            alert("Failed to submit roster.");
            return false;
        } finally {
            setSubmitting(false);
        }
    };

    const renderAttendanceRoster = (event: AppEvent) => {
        const groupMemberPersonIds = groupMembers
            .filter(gm => gm.groupId === event.groupId)
            .map(gm => gm.personId);
        
        const rosterPersonIds = rosters
            .filter(r => r.eventId === event.id)
            .map(r => r.personId);
            
        const allRelevantPersonIds = Array.from(new Set([...groupMemberPersonIds, ...rosterPersonIds]));
        
        // Process attendees with roster info
        let attendeesList = allRelevantPersonIds.map(pid => {
            const roster = rosters.find(r => r.eventId === event.id && r.personId === pid);
            const gm = groupMembers.find(g => g.groupId === event.groupId && g.personId === pid);
            const pObj = people.find(p => p.id === pid);
            return {
                personId: pid,
                name: pObj ? `${pObj.firstName} ${pObj.lastName}` : 'Unknown',
                role: gm?.role || roster?.role || 'member',
                personType: pObj?.type || 'Unknown',
                rsvp: roster?.rsvpStatus || 'potential',
                attendance: roster?.attendanceStatus || 'unknown',
                note: roster?.note || ''
            };
        });

        const typePriority: Record<string, number> = {
            'member': 1,
            'new_member': 1,
            'support': 2,
            'new_support': 2,
            'admin': 3,
            'staff': 4,
            'contact': 5,
            'unknown': 99
        };

        // Group attendees by support combinations
        let processedAttendees = new Set();
        let groupedAttendeesList: {type: 'single' | 'pair', attendees: any[]}[] = [];
        
        for (const attendee of attendeesList) {
            if (processedAttendees.has(attendee.personId)) continue;
            
            const personObj = people.find(p => p.id === attendee.personId);
            let linkedAttendee = null;

            if (personObj) {
                if (personObj.supportPersonId) {
                    linkedAttendee = attendeesList.find(a => a.personId === personObj.supportPersonId);
                } else {
                    const supportedByMe = people.find(p => p.supportPersonId === personObj.id);
                    if (supportedByMe) {
                        linkedAttendee = attendeesList.find(a => a.personId === supportedByMe.id);
                    }
                }
            }

            if (linkedAttendee && !processedAttendees.has(linkedAttendee.personId)) {
                let pair = [attendee, linkedAttendee];
                pair.sort((a, b) => {
                    const pA = typePriority[String(a.personType).toLowerCase().trim()] || 99;
                    const pB = typePriority[String(b.personType).toLowerCase().trim()] || 99;
                    if (pA !== pB) return pA - pB;
                    return a.name.localeCompare(b.name);
                });
                groupedAttendeesList.push({ type: 'pair', attendees: pair });
                processedAttendees.add(linkedAttendee.personId);
            } else {
                groupedAttendeesList.push({ type: 'single', attendees: [attendee] });
            }
            processedAttendees.add(attendee.personId);
        }

        groupedAttendeesList.sort((a, b) => {
            const leftA = a.attendees[0];
            const leftB = b.attendees[0];
            
            const pA = typePriority[String(leftA.personType).toLowerCase()] || 99;
            const pB = typePriority[String(leftB.personType).toLowerCase()] || 99;
            
            if (pA !== pB) return pA - pB;
            return leftA.name.localeCompare(leftB.name);
        });

        if (search) {
            groupedAttendeesList = groupedAttendeesList.filter(groupItem => 
                groupItem.attendees.some(a => a.name.toLowerCase().includes(search.toLowerCase()))
            );
        }

        const eventDateObj = parseEventDate(event.date);
        eventDateObj.setHours(0, 0, 0, 0);
        const todayObj = new Date();
        todayObj.setHours(0, 0, 0, 0);
        const isPastOrToday = eventDateObj.getTime() <= todayObj.getTime();

        // Check if event date is today
        const today = new Date();
        today.setHours(0,0,0,0);
        const eventDate = parseEventDate(event.date);
        eventDate.setHours(0,0,0,0);
        
        const isToday = eventDate.getTime() === today.getTime();
        const isLateAndActive = eventDate.getTime() < today.getTime() && event.status !== 'submitted';
        const isLeaderActiveView = isToday || isLateAndActive;

        if (isLeaderActiveView) {
            // Chunk groupedAttendeesList into 2 equal sub-lists
            const numTables = 2;
            const itemsPerTable = Math.ceil(groupedAttendeesList.length / numTables);
            const tables: any[][] = [];
            for (let i = 0; i < groupedAttendeesList.length; i += itemsPerTable) {
                tables.push(groupedAttendeesList.slice(i, i + itemsPerTable));
            }

            const renderTableContent = (tableItems: any[], keyPrefix: string | number) => (
                                <div key={keyPrefix} className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-x-auto max-h-[60vh] overflow-y-auto relative">
                                    <table className="table w-full text-left border-separate border-spacing-0 relative min-w-[500px]">
                                        <thead>
                                            <tr>
                                                <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider text-left w-[40%] rounded-tl-2xl bg-[#2d6a4f] text-white sticky top-0 z-20">Member</th>
                                                <th className="py-3 px-2 text-xs font-bold uppercase tracking-wider text-center w-[10%] bg-[#2d6a4f] text-white sticky top-0 z-20">Attend</th>
                                                <th className="py-3 px-2 text-xs font-bold uppercase tracking-wider text-center w-[10%] bg-[#2d6a4f] text-white sticky top-0 z-20">Attend</th>
                                                <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider text-left w-[40%] rounded-tr-2xl bg-[#2d6a4f] text-white sticky top-0 z-20">Carer</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-stone-100">
                                            {tableItems.map((groupItem, gIdx) => {
                                                const leftAttendee = groupItem.attendees[0];
                                                const rightAttendee = groupItem.type === 'pair' ? groupItem.attendees[1] : null;

                                                const leftChecked = leftAttendee ? leftAttendee.attendance === 'present' : false;
                                                const leftHasNote = leftAttendee ? !!leftAttendee.note : false;

                                                const rightChecked = rightAttendee ? rightAttendee.attendance === 'present' : false;
                                                const rightHasNote = rightAttendee ? !!rightAttendee.note : false;

                                                const isLeftMember = leftAttendee && ['member', 'new_member'].includes(String(leftAttendee.personType).toLowerCase().trim());
                                                const isNewLeft = leftAttendee && ['new_member', 'new_support'].includes(String(leftAttendee.personType).toLowerCase().trim());
                                                const isNewRight = rightAttendee && ['new_member', 'new_support'].includes(String(rightAttendee.personType).toLowerCase().trim());
                                                const hasNew = isNewLeft || isNewRight;
                                                const rowBg = hasNew 
                                                    ? 'bg-indigo-50/20' 
                                                    : (gIdx % 2 === 1 ? 'bg-stone-50/40' : 'bg-white');

                                                return (
                                                    <tr key={gIdx} className={`${rowBg} hover:bg-stone-50/80 transition-colors h-11`}>
                                                        {isLeftMember ? (
                                                            <>
                                                                <td className={`py-1 px-4 align-middle text-xs font-semibold text-stone-800 w-[40%] text-left ${isNewLeft ? 'border-l-4 border-indigo-500' : ''}`}>
                                                                    {leftAttendee ? (
                                                                        <div className="flex items-center justify-start gap-1.5 min-w-0">
                                                                            <span className="truncate text-left" title={leftAttendee.name}>
                                                                                {leftAttendee.name}
                                                                            </span>
                                                                            {isNewLeft && (
                                                                                <span className="bg-indigo-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded shadow-xs leading-none shrink-0">New</span>
                                                                            )}
                                                                            <button
                                                                                onClick={() => {
                                                                                    setNoteModalTarget({
                                                                                        eventId: event.id,
                                                                                        personId: leftAttendee.personId,
                                                                                        name: leftAttendee.name
                                                                                    });
                                                                                    setNoteModalText(leftAttendee.note || "");
                                                                                }}
                                                                                className={`shrink-0 p-1 rounded-md transition-all ${leftHasNote ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100 opacity-50 hover:opacity-100'}`}
                                                                                title={leftHasNote ? `Note: ${leftAttendee.note}` : "Add Note"}
                                                                            >
                                                                                <MessageSquare className={`w-3.5 h-3.5 ${leftHasNote ? 'fill-emerald-700' : ''}`} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="text-stone-300 italic">-</span>
                                                                    )}
                                                                </td>
                                                                <td className="py-1 px-2 text-center align-middle w-[10%]">
                                                                    {leftAttendee ? (
                                                                        <CustomAttendanceCheckbox 
                                                                            rsvp={leftAttendee.rsvp}
                                                                            attend={leftAttendee.attendance}
                                                                            onChange={(nextState) => {
                                                                                handleAction(event.id, leftAttendee.personId, 'attendance', nextState);
                                                                            }}
                                                                            disabled={!isPastOrToday}
                                                                        />
                                                                    ) : null}
                                                                </td>
                                                                <td className="py-1 px-2 text-center align-middle w-[10%] border-l border-stone-200 border-dashed">
                                                                    {rightAttendee ? (
                                                                        <CustomAttendanceCheckbox 
                                                                            rsvp={rightAttendee.rsvp}
                                                                            attend={rightAttendee.attendance}
                                                                            onChange={(nextState) => {
                                                                                handleAction(event.id, rightAttendee.personId, 'attendance', nextState);
                                                                            }}
                                                                            disabled={!isPastOrToday}
                                                                        />
                                                                    ) : null}
                                                                </td>
                                                                <td className={`py-1 px-4 align-middle text-xs font-semibold text-stone-800 w-[40%] text-left ${isNewRight ? 'border-l-4 border-indigo-500' : ''}`}>
                                                                    {rightAttendee ? (
                                                                        <div className="flex items-center justify-start gap-1.5 min-w-0">
                                                                            <span className="truncate text-left" title={rightAttendee.name}>
                                                                                {rightAttendee.name}
                                                                            </span>
                                                                            {isNewRight && (
                                                                                <span className="bg-indigo-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded shadow-xs leading-none shrink-0">New</span>
                                                                            )}
                                                                            <button
                                                                                onClick={() => {
                                                                                    setNoteModalTarget({
                                                                                        eventId: event.id,
                                                                                        personId: rightAttendee.personId,
                                                                                        name: rightAttendee.name
                                                                                    });
                                                                                    setNoteModalText(rightAttendee.note || "");
                                                                                }}
                                                                                className={`shrink-0 p-1 rounded-md transition-all ${rightHasNote ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100 opacity-50 hover:opacity-100'}`}
                                                                                title={rightHasNote ? `Note: ${rightAttendee.note}` : "Add Note"}
                                                                            >
                                                                                <MessageSquare className={`w-3.5 h-3.5 ${rightHasNote ? 'fill-emerald-700' : ''}`} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="text-stone-400 italic font-normal text-[10px]">No carer</span>
                                                                    )}
                                                                </td>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <td className="py-1 px-3 align-middle text-xs font-semibold text-stone-800 w-[35%] text-right">
                                                                    {leftAttendee ? (
                                                                        <span className={`text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full inline-block ${
                                                                            isNewLeft ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'text-stone-500 bg-stone-100'
                                                                        }`}>
                                                                            {leftAttendee.personType === 'new_member' ? 'New Member' : leftAttendee.personType === 'new_support' ? 'New Support' : leftAttendee.personType}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-stone-300 italic">-</span>
                                                                    )}
                                                                </td>
                                                                <td className="py-1 px-2 text-center align-middle w-[15%]"></td>
                                                                <td className="py-1 px-2 text-center align-middle w-[15%] border-l border-stone-200 border-dashed">
                                                                    {leftAttendee ? (
                                                                        <CustomAttendanceCheckbox 
                                                                            rsvp={leftAttendee.rsvp}
                                                                            attend={leftAttendee.attendance}
                                                                            onChange={(nextState) => {
                                                                                handleAction(event.id, leftAttendee.personId, 'attendance', nextState);
                                                                            }}
                                                                            disabled={!isPastOrToday}
                                                                        />
                                                                    ) : null}
                                                                </td>
                                                                <td className="py-1 px-3 align-middle text-xs font-semibold text-stone-800 w-[35%]">
                                                                    {leftAttendee ? (
                                                                        <div className="flex items-center justify-start gap-1.5 min-w-0">
                                                                            <span className="truncate text-left" title={leftAttendee.name}>
                                                                                {leftAttendee.name}
                                                                            </span>
                                                                            <button
                                                                                onClick={() => {
                                                                                    setNoteModalTarget({
                                                                                        eventId: event.id,
                                                                                        personId: leftAttendee.personId,
                                                                                        name: leftAttendee.name
                                                                                    });
                                                                                    setNoteModalText(leftAttendee.note || "");
                                                                                }}
                                                                                className={`shrink-0 p-1 rounded-md transition-all ${leftHasNote ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100 opacity-50 hover:opacity-100'}`}
                                                                                title={leftHasNote ? `Note: ${leftAttendee.note}` : "Add Note"}
                                                                            >
                                                                                <MessageSquare className={`w-3.5 h-3.5 ${leftHasNote ? 'fill-emerald-700' : ''}`} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="text-stone-300 italic">-</span>
                                                                    )}
                                                                </td>
                                                            </>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            );

            return (
                <div className="flex flex-col gap-6 w-full">
                    {groupedAttendeesList.length === 0 ? (
                        <div className="p-12 text-center text-stone-400 text-sm">No potential attendees found.</div>
                    ) : (
                        <>
                            <div className="block lg:hidden w-full">
                                {renderTableContent(groupedAttendeesList, 'mobile-full')}
                            </div>
                            <div className="hidden lg:grid grid-cols-2 gap-6 items-start w-full">
                                {tables.map((tableItems, tIdx) => renderTableContent(tableItems, `desktop-${tIdx}`))}
                            </div>
                        </>
                    )}
                </div>
            );
        }

        // Default cards-based view (when today is not the event date)
        const getRsvpInfo = (rsvp: string) => {
            const value = String(rsvp || "").toLowerCase().trim();
            if (value === 'booked') {
                return { label: 'Booked', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
            } else if (value === 'cancelled') {
                return { label: 'Cancelled', bg: 'bg-rose-50 text-rose-700 border-rose-200' };
            } else {
                return { label: 'Potential', bg: 'bg-stone-50 text-stone-600 border-stone-200' };
            }
        };

        const handleRsvpCycle = (attendee: any) => {
            const current = String(attendee.rsvp || "").toLowerCase().trim();
            let nextValue = 'booked';
            if (current === 'booked') {
                nextValue = 'cancelled';
            } else if (current === 'cancelled') {
                nextValue = 'potential';
            } else {
                nextValue = 'booked';
            }
            handleAction(event.id, attendee.personId, 'rsvp', nextValue);
        };

        const renderAttendeeCard = (attendee: any) => {
            const rsvpInfo = getRsvpInfo(attendee.rsvp);
            const isEditingNote = editingNoteFor?.eventId === event.id && editingNoteFor?.personId === attendee.personId;
            
            return (
                <div key={attendee.personId} id={`person-card-${attendee.personId}`} className="flex flex-col justify-between p-3.5 border border-stone-200/60 rounded-2xl bg-white flex-1 shadow-sm relative hover:shadow-md transition-shadow">
                    <div>
                        {/* Person Name & Type Badge */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            <h5 className={`font-bold text-stone-800 text-xs sm:text-sm leading-snug ${attendee.role && attendee.role.toLowerCase() !== attendee.personType.toLowerCase() ? 'md:truncate md:max-w-[120px]' : ''}`} title={attendee.name}>{attendee.name}</h5>
                            {attendee.role && attendee.role.toLowerCase() !== attendee.personType.toLowerCase() && (
                                <span className={`text-[8px] border px-1.5 py-0.5 rounded-full font-extrabold uppercase tracking-wider shrink-0 ${attendee.role.toLowerCase() === 'leader' ? 'bg-amber-100 border-amber-200/50 text-amber-800' : 'bg-stone-100 border-stone-200/50 text-stone-600'}`}>{attendee.role}</span>
                            )}
                        </div>

                        {/* Person Note Section */}
                        {(isEditingNote || attendee.note) && (
                            <div className="mb-3">
                                {isEditingNote ? (
                                    <div className="flex gap-1.5 w-full">
                                        <input 
                                            id={`note-input-${attendee.personId}`}
                                            type="text" 
                                            value={noteDraft}
                                            onChange={e => setNoteDraft(e.target.value)}
                                            className="flex-1 w-full border border-stone-300 focus:ring-1 focus:ring-amber-500 text-xs rounded-xl px-2.5 py-1 focus:outline-none bg-white"
                                            placeholder="Add a note..."
                                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                                if (e.key === 'Enter') handleSaveNote();
                                                if (e.key === 'Escape') setEditingNoteFor(null);
                                            }}
                                            onBlur={(e: React.FocusEvent<HTMLInputElement>) => handleSaveNote()}
                                            autoFocus
                                        />
                                    </div>
                                ) : attendee.note ? (
                                    <div 
                                        onClick={() => {
                                            setEditingNoteFor({eventId: event.id, personId: attendee.personId});
                                            setNoteDraft(attendee.note);
                                        }}
                                        className="group flex items-start gap-1.5 text-[11px] text-stone-400 hover:text-stone-700 font-medium w-full text-left transition-colors cursor-pointer"
                                        title="Edit Note"
                                    >
                                        <span className="italic text-stone-600 line-clamp-2 leading-relaxed font-normal">"{attendee.note}"</span>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>

                    {/* Cyclist Control Buttons: RSVP & ATTEND */}
                    <div className="space-y-2 mt-auto pt-2 border-t border-stone-200/40 flex flex-col justify-start">
                        {/* RSVP Cyclist */}
                        <div className="flex items-center justify-between gap-1.5 h-[28px]">
                            <button 
                                id={`note-btn-${attendee.personId}`}
                                onClick={() => {
                                    setEditingNoteFor({eventId: event.id, personId: attendee.personId});
                                    setNoteDraft(attendee.note);
                                }}
                                className="text-stone-400 hover:text-stone-700 transition-colors shrink-0 w-[60px] flex justify-start"
                                title="Add Note"
                            >
                                <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                            <button 
                                id={`rsvp-cycle-btn-${attendee.personId}`}
                                onClick={() => handleRsvpCycle(attendee)}
                                className={`flex-1 text-[11px] font-bold py-1 px-2.5 rounded-xl border text-center transition-all cursor-pointer hover:shadow-xs ${rsvpInfo.bg}`}
                            >
                                {rsvpInfo.label === 'Potential' ? 'RSVP' : rsvpInfo.label}
                            </button>
                        </div>
                        
                        {/* ATTEND Cyclist */}
                        <div className="flex items-center justify-between gap-1.5 h-[28px]">
                            <span className="text-[11px] font-extrabold text-stone-400 uppercase tracking-wider shrink-0 w-[60px] truncate" title={attendee.personType}>{attendee.personType}</span>
                            <div className="flex-1 flex justify-end items-center pr-2">
                                <CustomAttendanceCheckbox 
                                    rsvp={attendee.rsvp}
                                    attend={attendee.attendance}
                                    onChange={(nextState) => handleAction(event.id, attendee.personId, 'attendance', nextState)}
                                    disabled={!isPastOrToday}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            );
        };

        return (
            <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                    {groupedAttendeesList.length === 0 ? (
                        <div className="p-6 text-center text-stone-400 text-sm col-span-full">No potential attendees found.</div>
                    ) : (
                        groupedAttendeesList.map((groupItem, gIdx) => {
                            if (groupItem.type === 'pair') {
                                return (
                                    <div key={gIdx} className="bg-stone-200/60 border border-stone-300/60 rounded-2xl p-3 transition-all flex flex-col gap-3 md:col-span-2">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 divide-y md:divide-y-0 md:divide-x divide-stone-100">
                                            <div className="flex flex-col justify-between gap-3 pr-0 md:pr-4 pt-1 md:pt-0">
                                                {renderAttendeeCard(groupItem.attendees[0])}
                                            </div>
                                            <div className="flex flex-col justify-between gap-3 pl-0 md:pl-4 pt-3 md:pt-0 border-t md:border-t-0 border-stone-100">
                                                {renderAttendeeCard(groupItem.attendees[1])}
                                            </div>
                                        </div>
                                    </div>
                                );
                            } else {
                                return (
                                    <div key={gIdx} className="bg-transparent border border-transparent rounded-2xl p-0 transition-all flex flex-col justify-between gap-3">
                                        {renderAttendeeCard(groupItem.attendees[0])}
                                    </div>
                                );
                            }
                        })
                    )}
                </div>
            </div>
        );
    };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col lg:p-6 p-0">
        <div className="max-w-[1400px] mx-auto w-full bg-white min-h-screen lg:min-h-0 flex-1 min-h-0 lg:rounded-3xl lg:shadow-md border border-stone-200/80 overflow-hidden flex flex-col">
            <header className="bg-stone-800 text-white px-6 py-5 sticky top-0 z-10 flex items-center justify-between shadow-md">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center p-1">
                        <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <div>
                        <h1 className="font-bold text-lg leading-tight">Leader Dashboard</h1>
                        <p className="text-xs text-stone-400 font-medium">{person?.firstName} {person?.lastName}</p>
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full overflow-y-auto bg-stone-50/50 p-4 lg:p-8">
                {loading ? (
                    <div className="p-12 text-center text-stone-500 flex flex-col items-center gap-4 w-full max-w-2xl mx-auto mt-10">
                        <div className="w-12 h-12 border-4 border-stone-200 border-t-amber-500 rounded-full animate-spin"></div>
                        <div>
                            <p className="font-bold text-stone-700">Loading your leader dashboard...</p>
                            <p className="text-sm mt-2">Retrieving events and attendees.</p>
                        </div>
                    </div>
                ) : error ? (
                    <div className="p-12 text-center text-rose-500 flex flex-col items-center gap-4 w-full max-w-2xl mx-auto mt-10">
                        <XCircle className="w-12 h-12 text-rose-300" />
                        <div>
                            <p className="font-bold text-rose-700">Error loading dashboard</p>
                            <p className="text-sm mt-2">{error}</p>
                        </div>
                    </div>
                ) : events.length === 0 ? (
                    <div className="p-12 text-center text-stone-500 flex flex-col items-center gap-4 w-full max-w-2xl mx-auto mt-10">
                        <Calendar className="w-12 h-12 text-stone-300" />
                        <div>
                            <p className="font-bold text-stone-700">No active events found.</p>
                            <p className="text-sm mt-2">Showing events in the next 30 days and past events awaiting roster submission.</p>
                        </div>
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto w-full">
                        <h2 className="text-xl font-bold mb-6 text-stone-800">Your Events</h2>
                        <div className="grid gap-4">
                            {events.map(event => {
                                const potentialAttendees = groupMembers.filter(gm => gm.groupId === event.groupId);
                                let attendeesList = potentialAttendees.map(gm => {
                                    const roster = rosters.find(r => r.eventId === event.id && r.personId === gm.personId);
                                    return {
                                        rsvp: roster?.rsvpStatus || 'potential',
                                        attendance: roster?.attendanceStatus || 'unknown'
                                    };
                                });
                                const bookedCount = attendeesList.filter(a => a.rsvp === 'booked').length;
                                const presentCount = attendeesList.filter(a => a.attendance === 'present').length;

                                const today = new Date();
                                today.setHours(0,0,0,0);
                                const eventDate = parseEventDate(event.date);
                                eventDate.setHours(0,0,0,0);
                                const isLateAndActive = eventDate.getTime() < today.getTime() && event.status !== 'submitted';

                                return (
                                    <div key={event.id} className={`group bg-white rounded-2xl border ${isLateAndActive ? 'border-rose-400 shadow-rose-100' : 'border-stone-200/80'} shadow-sm overflow-hidden hover:shadow-md transition-all`}>
                                        <div 
                                            className={`p-5 flex items-center justify-between cursor-pointer ${isLateAndActive ? 'bg-rose-50/30' : ''}`}
                                            onClick={() => setExpandedEventId(event.id)}
                                        >
                                            <div className="min-w-0 pr-2">
                                                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isLateAndActive ? 'text-rose-600 bg-rose-100' : 'text-stone-500 bg-stone-100'} px-2.5 py-0.5 rounded-full truncate max-w-[150px]`}>
                                                        {getGroupName(event.groupId)}
                                                    </span>
                                                    <span className={`text-xs font-semibold ${isLateAndActive ? 'text-rose-600' : 'text-stone-600'}`}>
                                                        {moment(parseEventDate(event.date)).format('ddd D MMMM YYYY')} {event.time ? `• ${formatEventTimeRange(event.time, event.duration, event.title)}` : ''}
                                                    </span>
                                                </div>
                                                <h2 className={`text-lg font-bold ${isLateAndActive ? 'text-rose-900' : 'text-stone-900'} truncate`}>{event.title}</h2>
                                                <div className="text-xs text-stone-500 mt-2 font-medium flex gap-4 flex-wrap">
                                                    <span className="bg-stone-50 px-2 py-1 rounded-md">{bookedCount} / {attendeesList.length} Booked</span>
                                                    <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md">{presentCount} Present</span>
                                                    {event.status === 'submitted' ? (
                                                        <span className="text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md font-bold">✓ Submitted</span>
                                                    ) : (
                                                        <span className={`${isLateAndActive ? 'text-rose-700 bg-rose-100' : 'text-amber-700 bg-amber-50'} px-2 py-1 rounded-md font-bold`}>
                                                            {isLateAndActive ? 'Late - Awaiting Submission' : 'Awaiting Submission'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-stone-400 flex items-center gap-3 shrink-0">
                                                <div className={`w-10 h-10 rounded-full ${isLateAndActive ? 'bg-rose-100 group-hover:bg-rose-200' : 'bg-stone-50 group-hover:bg-amber-50'} flex items-center justify-center transition-colors`}>
                                                    <ChevronRight className={`w-5 h-5 ${isLateAndActive ? 'text-rose-600 group-hover:text-rose-700' : 'text-stone-400 group-hover:text-amber-600'}`} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>
        </div>

        {/* Full Screen Event Modal */}
        {expandedEventId && (() => {
            const selectedEvent = events.find(e => e.id === expandedEventId);
            if (!selectedEvent) return null;

            const potentialAttendees = groupMembers.filter(gm => gm.groupId === selectedEvent.groupId);
            let attendeesList = potentialAttendees.map(gm => {
                const roster = rosters.find(r => r.eventId === selectedEvent.id && r.personId === gm.personId);
                return {
                    rsvp: roster?.rsvpStatus || 'potential',
                    attendance: roster?.attendanceStatus || 'unknown'
                };
            });
            const bookedCount = attendeesList.filter(a => a.rsvp === 'booked').length;
            const presentCount = attendeesList.filter(a => a.attendance === 'present').length;

            return (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/40 p-0 sm:p-6 backdrop-blur-sm">
                    <div className="bg-stone-100 rounded-none sm:rounded-3xl w-full max-w-[1800px] h-full sm:h-[95vh] max-h-screen sm:max-h-[95vh] flex flex-col overflow-hidden shadow-2xl relative border-0 sm:border border-stone-200">
                        <div className="flex-1 overflow-y-auto flex flex-col relative">
                            {/* Modal Header */}
                            <div className="bg-white border-b border-stone-200 px-4 sm:px-6 py-4 flex items-center justify-between shrink-0">
                                <div className="flex items-center gap-4">
                                    <button 
                                        onClick={() => {
                                            setExpandedEventId(null);
                                            setSearch("");
                                        }}
                                        className="p-2 -ml-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
                                    >
                                        <ChevronRight className="w-6 h-6 rotate-180" />
                                    </button>
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
                                                {getGroupName(selectedEvent.groupId)}
                                            </span>
                                            <span className="text-xs font-semibold text-stone-500">
                                                {moment(parseEventDate(selectedEvent.date)).format('ddd D MMMM YYYY')} {selectedEvent.time ? `• ${formatEventTimeRange(selectedEvent.time, selectedEvent.duration, selectedEvent.title)}` : ''}
                                            </span>
                                        </div>
                                        <h2 className="text-xl font-bold text-stone-900">{selectedEvent.title}</h2>
                                    </div>
                                </div>
                            </div>

                            {/* Modal Body */}
                            <div className="flex-1 p-2.5 sm:p-6 lg:p-8 flex flex-col bg-stone-50">
                                <div className="bg-transparent max-w-full">
                                    <div className="flex items-center justify-between mb-6 pb-2 flex-wrap gap-4">
                                    <div className="relative shrink-0 w-full max-w-sm sm:w-64">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <Search className="h-4 w-4 text-stone-400" />
                                        </div>
                                        <input
                                            type="text"
                                            placeholder="Search roster..."
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            className="block w-full pl-9 pr-3 py-2 border border-stone-200 rounded-xl leading-5 bg-stone-50 placeholder-stone-400 focus:outline-none focus:bg-white focus:border-stone-400 focus:ring-0 sm:text-sm transition-colors shadow-sm"
                                        />
                                    </div>
                                    <div className="flex items-center gap-4 ml-auto">
                                        <div className="hidden md:flex text-xs text-stone-500 font-semibold gap-3 mr-2">
                                            <span className="bg-stone-100 text-stone-700 px-2.5 py-1 rounded-lg">{bookedCount} / {attendeesList.length} Booked</span>
                                            <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg">{presentCount} Present</span>
                                        </div>
                                        {selectedEvent.status === 'submitted' ? (
                                            <span className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-2xl font-bold shadow-sm border border-emerald-100 whitespace-nowrap">✓ Submitted</span>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    setExtrasDraft("");
                                                    setSubmitEventId(selectedEvent.id);
                                                }}
                                                className="px-5 py-2.5 bg-stone-800 hover:bg-stone-900 text-white text-sm font-bold rounded-2xl transition shadow-sm whitespace-nowrap"
                                            >
                                                Submit Roster
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {renderAttendanceRoster(selectedEvent)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            );
        })()}

        {/* Note Modal Popup */}
        {noteModalTarget && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
                <div className="bg-white rounded-3xl border border-stone-200 shadow-2xl overflow-hidden w-full max-w-md flex flex-col relative p-6 space-y-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="font-bold text-stone-900 text-lg">Attendee Note</h3>
                            <p className="text-xs text-stone-500 font-semibold mt-0.5">For {noteModalTarget.name}</p>
                        </div>
                        <button
                            onClick={() => setNoteModalTarget(null)}
                            className="text-stone-400 hover:text-stone-600 p-1.5 rounded-full hover:bg-stone-100 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <textarea
                        id="note-modal-textarea"
                        value={noteModalText}
                        onChange={(e) => setNoteModalText(e.target.value)}
                        className="w-full h-32 border border-stone-200 rounded-2xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-stone-50 text-stone-800"
                        placeholder="Type a note or comment here..."
                        autoFocus
                    />

                    <div className="flex justify-between items-center gap-2 pt-2">
                        {/* Delete button on the left (if a note exists) */}
                        <button
                            onClick={async () => {
                                await handleAction(noteModalTarget.eventId, noteModalTarget.personId, 'note', '');
                                setNoteModalTarget(null);
                            }}
                            className="px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                        >
                            Delete Note
                        </button>
                        
                        <div className="flex items-center gap-2 ml-auto">
                            <button
                                onClick={() => setNoteModalTarget(null)}
                                className="px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50 rounded-xl transition-colors border border-stone-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    await handleAction(noteModalTarget.eventId, noteModalTarget.personId, 'note', noteModalText);
                                    setNoteModalTarget(null);
                                }}
                                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors border border-amber-700"
                            >
                                Save Note
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        {/* Submit Roster Dialog */}
        {submitEventId && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
                <form
                    onSubmit={async (e) => {
                        e.preventDefault();
                        if (await handleSubmitRoster(submitEventId, extrasDraft)) {
                            setSubmitEventId(null);
                            setExpandedEventId(null);
                            setSearch("");
                        }
                    }}
                    className="bg-white rounded-3xl border border-stone-200 shadow-2xl overflow-hidden w-full max-w-md flex flex-col relative p-6 space-y-4"
                >
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="font-bold text-stone-900 text-lg">Submit Roster</h3>
                            <p className="text-xs text-stone-500 font-semibold mt-0.5">Attendance is recorded for group members and their carers.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setSubmitEventId(null)}
                            className="text-stone-400 hover:text-stone-600 p-1.5 rounded-full hover:bg-stone-100 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div>
                        <label htmlFor="extras-note" className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">Extras (optional)</label>
                        <textarea
                            id="extras-note"
                            value={extrasDraft}
                            onChange={e => setExtrasDraft(e.target.value)}
                            maxLength={2000}
                            className="w-full h-28 border border-stone-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-stone-50 text-stone-800"
                            placeholder="Anyone who came but isn't on the list - e.g. 2 visitors; Jane, interested in joining."
                        />
                        <p className="text-[11px] text-stone-500 font-medium mt-1">Only MSPC staff see this, and they will follow up. Please leave out medical details.</p>
                    </div>

                    <div className="flex items-center gap-2 justify-end pt-2">
                        <button
                            type="button"
                            onClick={() => setSubmitEventId(null)}
                            className="px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50 rounded-xl transition-colors border border-stone-200"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-5 py-2 bg-stone-800 hover:bg-stone-900 disabled:bg-stone-500 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
                        >
                            {submitting ? "Submitting..." : "Submit Roster"}
                        </button>
                    </div>
                </form>
            </div>
        )}
    </div>
  );
}
